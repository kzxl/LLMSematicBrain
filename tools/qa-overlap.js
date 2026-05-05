#!/usr/bin/env node
/**
 * qa-overlap.js — Duplicate/Overlap Detector
 *
 * Scan toàn bộ QA Cache, tìm cặp entries có vector similarity > threshold.
 * Suggest merge hoặc delete để giảm noise trong search results.
 *
 * Usage:
 *   node qa-overlap.js                    # Report duplicates (>0.92 similarity)
 *   node qa-overlap.js --threshold=0.85   # Custom threshold
 *   node qa-overlap.js --delete-lower     # Auto-delete entry có ít hits hơn trong mỗi cặp
 */
const { pool } = require('../core');

const THRESHOLD = parseFloat(process.argv.find(a => a.startsWith('--threshold='))?.split('=')[1] || '0.92');
const AUTO_DELETE = process.argv.includes('--delete-lower');

async function findOverlaps() {
  console.log(`╔═══════════════════════════════════════════════╗`);
  console.log(`║  QA OVERLAP DETECTOR                          ║`);
  console.log(`║  Threshold: ${THRESHOLD}  Mode: ${AUTO_DELETE ? 'AUTO-DELETE' : 'REPORT'}${AUTO_DELETE ? '  ' : '         '}║`);
  console.log(`╚═══════════════════════════════════════════════╝\n`);

  // Find all pairs with high similarity
  const result = await pool.query(`
    SELECT 
      a.id as id_a, b.id as id_b,
      LEFT(a.question, 60) as q_a, LEFT(b.question, 60) as q_b,
      a.hit_count as hits_a, b.hit_count as hits_b,
      a.confidence_score as conf_a, b.confidence_score as conf_b,
      a.source as src_a, b.source as src_b,
      1 - (a.embedding <=> b.embedding) as similarity
    FROM agent_qa_cache a
    JOIN agent_qa_cache b ON a.id < b.id
    WHERE 1 - (a.embedding <=> b.embedding) > $1
    ORDER BY similarity DESC
    LIMIT 30
  `, [THRESHOLD]);

  if (result.rows.length === 0) {
    console.log(`✅ No overlapping entries found (threshold: ${THRESHOLD})`);
    return;
  }

  console.log(`⚠️  Found ${result.rows.length} overlapping pairs:\n`);

  const toDelete = [];

  result.rows.forEach((r, i) => {
    const sim = (r.similarity * 100).toFixed(1);
    const keepA = r.hits_a >= r.hits_b;
    const keepId = keepA ? r.id_a : r.id_b;
    const dropId = keepA ? r.id_b : r.id_a;

    console.log(`── Pair ${i + 1} (${sim}% similar) ──`);
    console.log(`  ${keepA ? '✅ KEEP' : '❌ DROP'} [${r.id_a}] ${r.q_a}...`);
    console.log(`    hits: ${r.hits_a} | conf: ${r.conf_a} | src: ${r.src_a}`);
    console.log(`  ${keepA ? '❌ DROP' : '✅ KEEP'} [${r.id_b}] ${r.q_b}...`);
    console.log(`    hits: ${r.hits_b} | conf: ${r.conf_b} | src: ${r.src_b}`);
    console.log();

    toDelete.push(dropId);
  });

  // Dedup delete list (an entry might appear in multiple pairs)
  const uniqueDeletes = [...new Set(toDelete)];

  if (AUTO_DELETE) {
    console.log(`\n[DELETING] ${uniqueDeletes.length} lower-hit entries...`);
    for (const id of uniqueDeletes) {
      await pool.query('DELETE FROM agent_qa_cache WHERE id = $1', [id]);
      console.log(`  [-] Deleted QA #${id}`);
    }
    console.log(`\n[DONE] Deleted ${uniqueDeletes.length} duplicate entries.`);
  } else {
    console.log(`═══════════════════════════════════════════════`);
    console.log(`${uniqueDeletes.length} entries suggested for deletion: [${uniqueDeletes.join(', ')}]`);
    console.log(`Run with --delete-lower to auto-clean.`);
    console.log(`Or manual: node delete-qa.js <id>`);
    console.log(`═══════════════════════════════════════════════`);
  }
}

(async () => {
  try {
    await findOverlaps();
  } catch (err) {
    console.error('[ERROR]', err.message);
  } finally {
    await pool.end();
  }
})();
