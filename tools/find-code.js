#!/usr/bin/env node
/**
 * find-code.js - Semantic Codebase Search
 * 
 * Performs vector similarity search on codebase index.
 * 
 * Usage:
 *   node find-code.js "nút Lưu của StockIn"
 *   node find-code.js "IStockOutService" --limit=3
 */
const { pool, embed } = require('../core');

const QUERY_ARG = process.argv[2];
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || 5;
const MIN_SIM = 0.35;

async function searchCodebase() {
  if (!QUERY_ARG || QUERY_ARG.startsWith('--')) {
    console.log('Usage: node find-code.js "<search query>" [--limit=5]');
    process.exit(1);
  }

  const limit = parseInt(LIMIT_ARG);
  const vec = await embed(QUERY_ARG);
  
  const res = await pool.query(`
    SELECT file_name, file_path, file_type, summary,
           1 - (embedding <=> $1::vector) AS similarity
    FROM agent_codebase_index
    WHERE 1 - (embedding <=> $1::vector) > $2
    ORDER BY similarity DESC
    LIMIT $3
  `, [JSON.stringify(vec), MIN_SIM, limit]);

  console.log(`\n============================================================`);
  console.log(`[CODE SEARCH] Query: "${QUERY_ARG}" | Limit: ${limit}`);
  console.log(`============================================================\n`);

  if (res.rows.length === 0) {
    console.log(`   ❌ No matching code files found.`);
    return;
  }

  res.rows.forEach((r, idx) => {
    const score = Math.round(r.similarity * 100);
    console.log(`[${idx + 1}] ${r.file_name} | Score: ${score}% | Type: ${r.file_type}`);
    console.log(`    Path: file:///${r.file_path}`);
    console.log(`    Summary Preview:`);
    const lines = r.summary.split('\n');
    lines.slice(3).forEach(line => {
      console.log(`       ${line}`);
    });
    console.log(`\n    ────────────────────────────────────────────`);
  });
}

(async () => {
  try {
    await searchCodebase();
  } catch (err) {
    console.error('[ERROR]', err.message);
  } finally {
    await pool.end();
  }
})();
