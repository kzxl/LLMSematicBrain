#!/usr/bin/env node
/**
 * view-qa.js - Progressive L1 Deep Inspection
 *
 * Retrieves the full context, code snippets, metadata, and revision history
 * for a specific QA item by its numeric ID.
 *
 * Usage:
 *   node tools/view-qa.js <id>
 */

const { pool } = require('../core');

const ID = parseInt(process.argv[2], 10);

if (!ID || isNaN(ID)) {
  console.log('Usage: node tools/view-qa.js <id>');
  process.exit(1);
}

async function viewQA(id) {
  try {
    const result = await pool.query(`
      SELECT id, question, answer_context, source, category, tags,
             confidence_score, hit_count, useful_count, created_at, updated_at
      FROM agent_qa_cache
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      console.error(`❌ [NOT FOUND] QA item #${id} does not exist in SemanticBrain.`);
      process.exit(1);
    }

    const row = result.rows[0];

    // Increment hit_count
    await pool.query('UPDATE agent_qa_cache SET hit_count = COALESCE(hit_count, 0) + 1 WHERE id = $1', [id]);

    // Check history revisions
    const histResult = await pool.query(`
      SELECT id, old_answer, changed_by, changed_at
      FROM agent_qa_history
      WHERE qa_id = $1
      ORDER BY changed_at DESC
      LIMIT 3
    `, [id]);

    console.log(`\n╔═══════════════════════════════════════════════════════════════╗`);
    console.log(`║ 📖 DEEP INSPECTION: QA #${row.id}`.padEnd(64) + `║`);
    console.log(`╚═══════════════════════════════════════════════════════════════╝`);
    console.log(`📌 Tags:       ${(row.tags || []).join(', ') || 'none'}`);
    console.log(`🏷️ Category:   ${row.category || 'general'}`);
    console.log(`🎯 Confidence: ${(row.confidence_score * 100).toFixed(0)}% | Hits: ${row.hit_count || 0} | Useful: ${row.useful_count || 0}`);
    console.log(`🕒 Updated:    ${new Date(row.updated_at).toLocaleString()}`);
    console.log(`\n── Question / Technical Symptom ───────────────────────────────`);
    console.log(row.question);
    console.log(`\n── Root Cause, Solution & Gotchas ─────────────────────────────`);
    console.log(row.answer_context);

    if (histResult.rows.length > 0) {
      console.log(`\n── Revision History (${histResult.rows.length} previous version(s)) ──────────────`);
      histResult.rows.forEach((h, idx) => {
        const preview = (h.old_answer || '').replace(/\r?\n+/g, ' ').substring(0, 100);
        console.log(`  [v${idx + 1}] (${h.changed_by || 'agent'}) ${preview}...`);
      });
    }
    console.log(`\n═══════════════════════════════════════════════════════════════\n`);
  } catch (err) {
    console.error('[ERROR]', err.message);
  } finally {
    await pool.end();
  }
}

viewQA(ID);
