/**
 * list-low-score.js - List QA entries with low confidence scores
 *
 * Usage: node list-low-score.js [--threshold=0.5] [--limit=20]
 */
const { pool } = require('../core');

const THRESHOLD = parseFloat(process.argv.find(a => a.startsWith('--threshold='))?.split('=')[1] || '0.5');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '20');

async function listLowScore() {
  try {
    const result = await pool.query(`
      SELECT id, question, confidence_score, hit_count, source, tags, created_at
      FROM agent_qa_cache
      WHERE confidence_score < $1
      ORDER BY confidence_score ASC, hit_count DESC
      LIMIT $2
    `, [THRESHOLD, LIMIT]);

    if (result.rows.length === 0) {
      console.log(`[OK] No QA entries below threshold ${THRESHOLD}`);
      process.exit(0);
    }

    console.log(`[LOW CONFIDENCE] Found ${result.rows.length} entries below ${THRESHOLD}:\n`);

    result.rows.forEach((r, i) => {
      console.log(`[${i + 1}] ID: ${r.id} | Score: ${r.confidence_score.toFixed(2)} | Hits: ${r.hit_count}`);
      console.log(`    Q: ${r.question.substring(0, 80)}${r.question.length > 80 ? '...' : ''}`);
      console.log(`    Source: ${r.source} | Tags: ${r.tags.join(', ') || 'none'}`);
      console.log(`    Created: ${r.created_at.toISOString().split('T')[0]}\n`);
    });

    console.log(`\nTo refine: node .agent/tools/semantic/save-qa.js "<question>" "<better_answer>" --confidence=1.0`);
    console.log(`To delete: node .agent/tools/semantic/delete-qa.js --id=<id>`);

  } catch (err) {
    console.error('[ERROR]', err.message);
  } finally {
    await pool.end();
  }
}

listLowScore();
