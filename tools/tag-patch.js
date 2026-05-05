#!/usr/bin/env node
/**
 * tag-patch.js — Auto-patch tags cho entries thiếu tags
 * Dùng keyword analysis + LLM (nếu có) để gán tags phù hợp
 * 
 * Usage:
 *   node tag-patch.js              # Dry-run
 *   node tag-patch.js --fix        # Apply
 */
const { pool, inferTags } = require('../core');

const DRY_RUN = !process.argv.includes('--fix');

async function run() {
  const result = await pool.query(`
    SELECT id, question, answer_context, tags
    FROM agent_qa_cache
    ORDER BY id
  `);

  console.log(`╔═══════════════════════════════════════════════╗`);
  console.log(`║  TAG AUTO-PATCH (TWO-LEVEL UPGRADE)           ║`);
  console.log(`║  Mode: ${DRY_RUN ? 'DRY-RUN' : '⚡ FIX'}  Entries: ${result.rows.length.toString().padEnd(3)}            ║`);
  console.log(`╚═══════════════════════════════════════════════╝\n`);

  if (result.rows.length === 0) {
    console.log('✅ All entries have tags.');
    return;
  }

  let patched = 0;
  let skipped = 0;

  for (const row of result.rows) {
    const tags = inferTags(row.question, row.answer_context, row.tags);
    
    if (tags.length === 0) {
      tags.push('general');
    }

    console.log(`[${row.id}] ${row.question.substring(0, 60)}...`);
    console.log(`  → tags: ${tags.join(', ')}`);

    if (!DRY_RUN) {
      await pool.query(
        'UPDATE agent_qa_cache SET tags = $1 WHERE id = $2',
        [tags, row.id]
      );
      patched++;
    }
  }

  console.log(`\n═══════════════════════════════════════════════`);
  if (DRY_RUN) {
    console.log(`[DRY-RUN] ${result.rows.length} entries would be patched. Run with --fix to apply.`);
  } else {
    console.log(`[DONE] ${patched} entries patched with auto-inferred tags.`);
  }
}

(async () => {
  try { await run(); }
  catch (e) { console.error('[ERROR]', e.message); }
  finally { await pool.end(); }
})();
