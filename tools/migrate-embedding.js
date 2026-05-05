#!/usr/bin/env node
/**
 * migrate-embedding.js — Migrate DB từ 384d → 1024d (BGE-M3)
 * 
 * Bước 1: ALTER column vector dimension
 * Bước 2: Re-embed toàn bộ entries
 * Bước 3: Rebuild HNSW index
 * 
 * Usage:
 *   node migrate-embedding.js --dry-run    # Preview only
 *   node migrate-embedding.js              # Execute migration
 */
const { pool, embed, MODEL_DIMS, MODEL_NAME, extractKeywords } = require('../core');

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  console.log(`╔═══════════════════════════════════════════════════╗`);
  console.log(`║  EMBEDDING MIGRATION                              ║`);
  console.log(`║  Target: ${MODEL_NAME.padEnd(30)} ${MODEL_DIMS}d  ║`);
  console.log(`║  Mode:   ${DRY_RUN ? 'DRY-RUN' : '⚡ MIGRATE'}                                ║`);
  console.log(`╚═══════════════════════════════════════════════════╝\n`);

  // Check current state
  const colInfo = await pool.query(`
    SELECT data_type, udt_name FROM information_schema.columns 
    WHERE table_name = 'agent_qa_cache' AND column_name = 'embedding'
  `);
  console.log(`[INFO] Current column type: ${colInfo.rows[0]?.udt_name || 'unknown'}`);

  const count = await pool.query('SELECT COUNT(*)::int as cnt FROM agent_qa_cache');
  console.log(`[INFO] Entries to re-embed: ${count.rows[0].cnt}`);
  
  if (DRY_RUN) {
    // Test embedding with new model
    console.log(`\n[TEST] Embedding test...`);
    const start = Date.now();
    const vec = await embed('BaseForm RunAfterShown pattern trong MDS WinForms');
    console.log(`[TEST] Dimensions: ${vec.length} (expected: ${MODEL_DIMS})`);
    console.log(`[TEST] Time: ${Date.now() - start}ms`);
    console.log(`[TEST] First 5 values: [${vec.slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`);
    
    console.log(`\n[DRY-RUN] Run without --dry-run to start migration.`);
    console.log(`[EST] Estimated time: ${count.rows[0].cnt * 200 / 1000}s (${count.rows[0].cnt} entries × ~200ms)`);
    await pool.end();
    return;
  }

  // Step 1: Drop old index
  console.log(`\n── Step 1: Drop old indexes ──`);
  await pool.query('DROP INDEX IF EXISTS idx_qa_embedding_hnsw');
  console.log(`   ✅ HNSW index dropped`);

  // Step 2: Drop + recreate embedding columns with new dimension
  console.log(`\n── Step 2: Recreate embedding columns (${MODEL_DIMS}d) ──`);
  
  // pgvector cannot ALTER dimension with existing data → must drop + add
  await pool.query(`ALTER TABLE agent_qa_cache DROP COLUMN embedding`);
  await pool.query(`ALTER TABLE agent_qa_cache ADD COLUMN embedding vector(${MODEL_DIMS})`);
  console.log(`   ✅ agent_qa_cache → vector(${MODEL_DIMS})`);
  
  try {
    await pool.query(`ALTER TABLE agent_recipes DROP COLUMN embedding`);
    await pool.query(`ALTER TABLE agent_recipes ADD COLUMN embedding vector(${MODEL_DIMS})`);
    console.log(`   ✅ agent_recipes → vector(${MODEL_DIMS})`);
  } catch (e) { console.log(`   ⚠️ agent_recipes: ${e.message.substring(0, 60)}`); }
  
  try {
    await pool.query(`ALTER TABLE agent_registry DROP COLUMN embedding`);
    await pool.query(`ALTER TABLE agent_registry ADD COLUMN embedding vector(${MODEL_DIMS})`);
    console.log(`   ✅ agent_registry → vector(${MODEL_DIMS})`);
  } catch (e) { console.log(`   ⚠️ agent_registry: ${e.message.substring(0, 60)}`); }

  // Step 3: Re-embed all entries
  console.log(`\n── Step 3: Re-embed ${count.rows[0].cnt} entries ──`);
  const entries = await pool.query('SELECT id, question, answer_context FROM agent_qa_cache ORDER BY id');
  
  let done = 0;
  const startTime = Date.now();
  
  for (const row of entries.rows) {
    const searchText = `${row.question} ${row.answer_context}`.toLowerCase();
    const vec = await embed(searchText);
    const keywords = extractKeywords(searchText);
    
    await pool.query(
      'UPDATE agent_qa_cache SET embedding = $1, keywords = $2 WHERE id = $3',
      [JSON.stringify(vec), keywords, row.id]
    );
    
    done++;
    if (done % 10 === 0 || done === entries.rows.length) {
      const elapsed = (Date.now() - startTime) / 1000;
      const eta = (elapsed / done * (entries.rows.length - done)).toFixed(0);
      process.stdout.write(`\r   Progress: ${done}/${entries.rows.length} (${(elapsed).toFixed(1)}s, ETA: ${eta}s)`);
    }
  }
  console.log(`\n   ✅ All entries re-embedded`);

  // Step 3b: Re-embed agent_recipes
  const recipes = await pool.query('SELECT id, intent FROM agent_recipes');
  if (recipes.rows.length > 0) {
    console.log(`\n── Step 3b: Re-embed ${recipes.rows.length} recipes ──`);
    for (const row of recipes.rows) {
      const vec = await embed(row.intent.toLowerCase());
      await pool.query('UPDATE agent_recipes SET embedding = $1 WHERE id = $2', [JSON.stringify(vec), row.id]);
    }
    console.log(`   ✅ Recipes re-embedded`);
  }

  // Step 3c: Re-embed agent_registry
  const registry = await pool.query('SELECT id, name, description FROM agent_registry');
  if (registry.rows.length > 0) {
    console.log(`\n── Step 3c: Re-embed ${registry.rows.length} registry entries ──`);
    for (const row of registry.rows) {
      const searchText = `${row.name} ${row.description || ''}`.toLowerCase();
      const vec = await embed(searchText);
      await pool.query('UPDATE agent_registry SET embedding = $1 WHERE id = $2', [JSON.stringify(vec), row.id]);
    }
    console.log(`   ✅ Registry re-embedded`);
  }

  // Step 4: Rebuild HNSW index
  console.log(`\n── Step 4: Rebuild HNSW index ──`);
  await pool.query(`CREATE INDEX idx_qa_embedding_hnsw ON agent_qa_cache USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64)`);
  console.log(`   ✅ HNSW index rebuilt`);

  // Verify
  console.log(`\n── Verification ──`);
  const testVec = await embed('baseform runaftershown');
  const verify = await pool.query(`
    SELECT id, question, 1-(embedding<=>$1::vector) as sim 
    FROM agent_qa_cache ORDER BY embedding<=>$1::vector LIMIT 3
  `, [JSON.stringify(testVec)]);
  
  verify.rows.forEach(r => {
    console.log(`   #${r.id} [${(r.sim * 100).toFixed(1)}%] ${r.question.substring(0, 60)}`);
  });

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`[DONE] Migration completed in ${totalTime}s`);
  console.log(`   Model: ${MODEL_NAME} (${MODEL_DIMS}d)`);
  console.log(`   Entries: ${done} QA + ${recipes.rows.length} recipes + ${registry.rows.length} registry`);
  console.log(`═══════════════════════════════════════════════\n`);

  await pool.end();
}

run().catch(e => { console.error('[FATAL]', e); process.exit(1); });
