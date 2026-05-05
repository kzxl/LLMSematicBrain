/**
 * setup.js - Tạo bảng + Index tất cả skills/workflows vào PostgreSQL
 * 
 * Chạy: node setup.js
 * Chạy lại: node setup.js --reindex (xoá sạch + index lại)
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { embed, MODEL_DIMS } = require('../core');
const config = require('../core/config');
const { extractRegistryKeywords } = require('../core/keywords');

// __dirname = .agent/tools/semantic/maintenance → lên 4 cấp = E:\00.ERP\ERP
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
const WORKFLOWS_DIR = path.join(PROJECT_ROOT, '.agent/workflows');
const SKILLS_DIR = path.join(PROJECT_ROOT, '.agent/skills');

// --- DB Setup (tạo database nếu chưa có) ---
const adminPool = new Pool({
  ...config.db,
  database: 'postgres',
  max: 2,
});

const appPool = new Pool(config.db);

async function ensureDatabase() {
  const client = await adminPool.connect();
  try {
    const res = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = 'agent_registry'"
    );
    if (res.rows.length === 0) {
      await client.query('CREATE DATABASE agent_registry');
      console.log('[+] Created database: agent_registry');
    } else {
      console.log('[=] Database agent_registry already exists');
    }
  } finally {
    client.release();
    await adminPool.end();
  }
}

async function createTables() {
  const client = await appPool.connect();
  try {
    // Enable extensions
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');

    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_registry (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('skill', 'workflow')),
        path TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        keywords TEXT[] DEFAULT '{}',
        content_preview TEXT DEFAULT '',
        search_text TEXT DEFAULT '',
        embedding vector(${MODEL_DIMS}),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(name, type)
      )
    `);

    // HNSW index cho vector search
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_registry_vector 
      ON agent_registry USING hnsw (embedding vector_cosine_ops)
    `);

    // Keyword array index
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_registry_keywords 
      ON agent_registry USING GIN(keywords)
    `);

    // === RECIPE TABLE: Execution Plan Cache ===
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_recipes (
        id SERIAL PRIMARY KEY,
        intent TEXT NOT NULL,
        category VARCHAR(50) NOT NULL DEFAULT 'general',
        target_pattern TEXT DEFAULT '',
        
        -- Execution plan (chuỗi bước xử lý)
        steps JSONB NOT NULL DEFAULT '[]',
        skills_used TEXT[] DEFAULT '{}',
        tools_used TEXT[] DEFAULT '{}',
        
        -- Metadata
        search_text TEXT DEFAULT '',
        embedding vector(${MODEL_DIMS}),
        keywords TEXT[] DEFAULT '{}',
        hit_count INT DEFAULT 0,
        success_count INT DEFAULT 0,
        
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_recipes_vector 
      ON agent_recipes USING hnsw (embedding vector_cosine_ops)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_recipes_keywords 
      ON agent_recipes USING GIN(keywords)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_recipes_category 
      ON agent_recipes(category)
    `);

    // === QA CACHE TABLE: Semantic Knowledge Base ===
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_qa_cache (
        id SERIAL PRIMARY KEY,
        question TEXT NOT NULL,
        answer_context TEXT NOT NULL,
        
        -- Classification
        source VARCHAR(50) DEFAULT 'manual',
        category VARCHAR(50) DEFAULT 'general',
        tags TEXT[] DEFAULT '{}',
        
        -- Metadata để back-search
        search_text TEXT DEFAULT '',
        embedding vector(${MODEL_DIMS}),
        keywords TEXT[] DEFAULT '{}',
        
        -- Deduplication
        question_hash TEXT GENERATED ALWAYS AS (md5(lower(question))) STORED,
        
        -- Telemetry
        hit_count INT DEFAULT 0,
        confidence_score FLOAT DEFAULT 1.0,
        
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_qa_vector 
      ON agent_qa_cache USING hnsw (embedding vector_cosine_ops)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_qa_keywords 
      ON agent_qa_cache USING GIN(keywords)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_qa_tags 
      ON agent_qa_cache USING GIN(tags)
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_unique_question 
      ON agent_qa_cache(question_hash)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_qa_category 
      ON agent_qa_cache(category)
    `);

    // === QA HISTORY TABLE: Audit Trail for Re-teaching ===
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_qa_history (
        id SERIAL PRIMARY KEY,
        qa_id INT REFERENCES agent_qa_cache(id) ON DELETE CASCADE,
        old_answer TEXT,
        new_answer TEXT,
        changed_by VARCHAR(50) DEFAULT 'agent',
        changed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // === RECIPE ↔ REGISTRY: Cross-reference ===
    // Add registry_ids column to recipes if not exists
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE agent_recipes ADD COLUMN registry_ids INT[] DEFAULT '{}';
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$
    `);

    console.log('[+] Tables & indexes created (registry + recipes + qa_cache + qa_history)');
  } finally {
    client.release();
  }
}

// --- Parse YAML Frontmatter ---
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const yaml = match[1];
  const result = {};
  for (const line of yaml.split('\n')) {
    const kv = line.match(/^(\w+)\s*:\s*(.+)/);
    if (kv) result[kv[1].trim()] = kv[2].trim();
  }
  return result;
}

function extractContentPreview(content, maxLen = 200) {
  // Cắt frontmatter, lấy đoạn đầu
  const body = content.replace(/^---[\s\S]*?---\r?\n?/, '').trim();
  return body.substring(0, maxLen).replace(/\n/g, ' ');
}

// extractKeywords — delegated to shared keywords.js module

// --- Index Workflows ---
async function indexWorkflows() {
  const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.md'));
  let count = 0;

  for (const file of files) {
    const filePath = path.join(WORKFLOWS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const fm = parseFrontmatter(content);
    const name = path.basename(file, '.md');
    const description = fm.description || fm.desc || '';
    const preview = extractContentPreview(content);
    const keywords = extractRegistryKeywords(name, description, content);
    const searchText = `${name} ${description} ${preview}`.toLowerCase();
    const vec = await embed(searchText);

    await appPool.query(`
      INSERT INTO agent_registry (name, type, path, description, keywords, content_preview, search_text, embedding)
      VALUES ($1, 'workflow', $2, $3, $4, $5, $6, $7)
      ON CONFLICT (name, type) 
      DO UPDATE SET description = $3, keywords = $4, content_preview = $5, 
                    search_text = $6, embedding = $7, updated_at = NOW()
    `, [name, filePath, description, keywords, preview, searchText, JSON.stringify(vec)]);
    count++;
  }

  console.log(`[+] Indexed ${count} workflows`);
}

// --- Index Skills ---
async function indexSkills() {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.log('[!] Skills directory not found, skipping');
    return;
  }

  const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());
  
  let count = 0;

  for (const dir of dirs) {
    const skillFile = path.join(SKILLS_DIR, dir.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    const content = fs.readFileSync(skillFile, 'utf-8');
    const fm = parseFrontmatter(content);
    const name = dir.name;
    const description = fm.description || fm.desc || '';
    const preview = extractContentPreview(content);
    const keywords = extractRegistryKeywords(name, description, content);
    const searchText = `${name} ${description} ${preview}`.toLowerCase();
    const vec = await embed(searchText);

    await appPool.query(`
      INSERT INTO agent_registry (name, type, path, description, keywords, content_preview, search_text, embedding)
      VALUES ($1, 'skill', $2, $3, $4, $5, $6, $7)
      ON CONFLICT (name, type)
      DO UPDATE SET description = $3, keywords = $4, content_preview = $5,
                    search_text = $6, embedding = $7, updated_at = NOW()
    `, [name, skillFile, description, keywords, preview, searchText, JSON.stringify(vec)]);
    count++;
  }

  console.log(`[+] Indexed ${count} skills`);
}

// --- Main ---
async function main() {
  const reindex = process.argv.includes('--reindex');

  try {
    await ensureDatabase();

    if (reindex) {
      await appPool.query('DROP TABLE IF EXISTS agent_registry CASCADE');
      await appPool.query('DROP TABLE IF EXISTS agent_recipes CASCADE');
      await appPool.query('DROP TABLE IF EXISTS agent_qa_cache CASCADE');
      console.log('[!] Dropped existing tables for full reindex');
    }

    await createTables();

    await indexWorkflows();
    await indexSkills();

    // Stats
    const stats = await appPool.query(`
      SELECT type, COUNT(*) as count FROM agent_registry GROUP BY type
    `);
    console.log('\n[REGISTRY STATS]');
    stats.rows.forEach(r => console.log(`  ${r.type}: ${r.count} items`));

    const total = await appPool.query('SELECT COUNT(*) as total FROM agent_registry');
    console.log(`  TOTAL: ${total.rows[0].total} items indexed`);

  } catch (err) {
    console.error('[ERROR]', err.message);
  } finally {
    await appPool.end();
  }
}

main();
