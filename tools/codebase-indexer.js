#!/usr/bin/env node
/**
 * codebase-indexer.js - Semantic Codebase Indexer
 * 
 * Scans C# files (WinForm & API), parses class structures,
 * extracts names/namespaces/methods/injected deps,
 * and saves BGE-M3 1024d embeddings to Postgres DB.
 * 
 * Usage:
 *   node codebase-indexer.js [--dry-run]
 *   node codebase-indexer.js e:/00.ERP/ERP/Winform/MOP
 */
const { pool, embed } = require('../core');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const TARGET_PATH = process.argv[2] && !process.argv[2].startsWith('--')
  ? path.resolve(process.argv[2])
  : null;

const IGNORE_DIRS = ['obj', 'bin', 'packages', '.vs', '.git', 'node_modules', 'temp_old_designers'];
const SCAN_ROOTS = TARGET_PATH ? [TARGET_PATH] : [
  'e:/00.ERP/ERP/Winform',
  'e:/00.ERP/ERP/API'
];

/**
 * Initialize Database Table
 */
async function initDb() {
  console.log('[DB] Ensuring agent_codebase_index table exists...');
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE IF NOT EXISTS agent_codebase_index (
      id SERIAL PRIMARY KEY,
      file_path TEXT UNIQUE NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      embedding vector(1024),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_codebase_embedding 
    ON agent_codebase_index USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
  `);
}

/**
 * Recursively find files
 */
function getFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file).replace(/\\/g, '/');
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      if (IGNORE_DIRS.includes(file.toLowerCase())) continue;
      getFiles(filePath, fileList);
    } else if (stat.isFile() && file.endsWith('.cs') && !file.endsWith('.Designer.cs') && !file.endsWith('.resx')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

/**
 * Parse metadata from C# file content
 */
function parseCSharpMetadata(content, filePath) {
  const nsMatch = content.match(/namespace\s+([A-Za-z0-9_.]+)/);
  const namespace = nsMatch ? nsMatch[1] : 'Unknown';
  
  const classMatch = content.match(/(?:public|private|internal|protected)?\s+(?:partial\s+)?class\s+([A-Za-z0-9_]+)/);
  const className = classMatch ? classMatch[1] : path.basename(filePath, '.cs');
  
  // Detect file type
  let fileType = 'csharp';
  if (filePath.includes('Controller')) fileType = 'controller';
  else if (filePath.includes('Service')) fileType = 'service';
  else if (filePath.includes('DTO') || filePath.includes('Dto')) fileType = 'dto';
  else if (filePath.includes('Models') || filePath.includes('Entity')) fileType = 'model';
  else if (className.startsWith('frm') || className.startsWith('uc') || content.includes('XtraForm') || content.includes('XtraUserControl') || content.includes('BaseForm')) {
    fileType = 'view';
  }

  // Find Injected Dependencies in Constructor (simple regex match of standard DI interfaces)
  const deps = [];
  const constructorRegex = new RegExp(`public\\s+${className}\\s*\\(([^)]*)\\)`, 'i');
  const constrMatch = content.match(constructorRegex);
  if (constrMatch && constrMatch[1]) {
    const params = constrMatch[1].split(',');
    for (let p of params) {
      p = p.trim();
      const parts = p.split(/\s+/);
      if (parts.length >= 2) {
        const typeName = parts[parts.length - 2];
        if (typeName.startsWith('I') && typeName.charAt(1) === typeName.charAt(1).toUpperCase()) {
          deps.push(typeName);
        }
      }
    }
  }

  // Find Public methods / main Actions
  const methods = [];
  const methodRegex = /(?:public|internal)\s+(?:async\s+)?(?:Task<[A-Za-z0-9_<>\s[\]]+>|Task|[A-Za-z0-9_<>\s[\]]+)\s+([A-Za-z0-9_]+)\s*\(/g;
  let m;
  while ((m = methodRegex.exec(content)) !== null) {
    if (!['override', 'new', 'if', 'while', 'using'].includes(m[1]) && !methods.includes(m[1]) && m[1] !== className) {
      methods.push(m[1]);
    }
  }

  return { namespace, className, fileType, deps, methods: methods.slice(0, 15) };
}

/**
 * Scan and index
 */
async function indexCodebase() {
  await initDb();
  
  console.log(`[SCAN] Searching files in roots:`, SCAN_ROOTS);
  let allFiles = [];
  for (const root of SCAN_ROOTS) {
    allFiles = allFiles.concat(getFiles(root));
  }
  console.log(`[SCAN] Found ${allFiles.length} target C# files.`);

  if (DRY_RUN) {
    console.log(`[DRY-RUN] Will index ${allFiles.length} files. Exiting.`);
    return;
  }

  let indexed = 0;
  for (let i = 0; i < allFiles.length; i++) {
    const filePath = allFiles[i];
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const meta = parseCSharpMetadata(content, filePath);
      const fileName = path.basename(filePath);
      
      const summary = `File: ${fileName}
Path: ${filePath}
Type: ${meta.fileType}
Namespace: ${meta.namespace}
Class: ${meta.className}
Dependencies: ${meta.deps.join(', ') || 'None'}
Methods: ${meta.methods.join(', ') || 'None'}`;

      const vec = await embed(summary);

      await pool.query(`
        INSERT INTO agent_codebase_index (file_path, file_name, file_type, summary, embedding, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (file_path) 
        DO UPDATE SET file_name = EXCLUDED.file_name, file_type = EXCLUDED.file_type, 
                      summary = EXCLUDED.summary, embedding = EXCLUDED.embedding, updated_at = NOW()
      `, [filePath, fileName, meta.fileType, summary, JSON.stringify(vec)]);
      
      indexed++;
      if (indexed % 50 === 0 || indexed === allFiles.length) {
        console.log(`[INDEX] Processed ${indexed}/${allFiles.length} files...`);
      }
    } catch (err) {
      console.error(`[ERROR] Failed to index ${filePath}:`, err.message);
    }
  }

  console.log(`\n[DONE] Codebase semantic indexing complete. Indexed ${indexed} files.`);
}

// Run
(async () => {
  try {
    await indexCodebase();
  } catch (err) {
    console.error('[CRITICAL]', err.message);
  } finally {
    await pool.end();
  }
})();
