/**
 * list-low-score.js - Liệt kê các QA có confidence_score thấp cần Agent review
 * 
 * Usage: node list-low-score.js [--limit=10] [--threshold=0.8]
 */
const { pool } = require('../core');

async function listLowScore() {
  const args = process.argv.slice(2);
  const limitArg = args.find(a => a.startsWith('--limit='));
  const thresholdArg = args.find(a => a.startsWith('--threshold='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 10;
  const threshold = thresholdArg ? parseFloat(thresholdArg.split('=')[1]) : 0.8;

  try {
    const result = await pool.query(`
      SELECT id, question, answer_context, confidence_score, source, tags, category,
             LENGTH(answer_context) AS ans_length
      FROM agent_qa_cache 
      WHERE confidence_score < $1
      ORDER BY confidence_score ASC, created_at ASC
      LIMIT $2
    `, [threshold, limit]);

    if (result.rows.length === 0) {
      console.log(`[✓] Tất cả QA đều đạt chuẩn (>= ${threshold}). Không có gì cần review.`);
      return;
    }

    console.log(`[REVIEW] Tìm thấy ${result.rows.length} mục cần nâng cấp (threshold < ${threshold}):\n`);
    
    result.rows.forEach((r, i) => {
      console.log(`=== [${i + 1}] ID: ${r.id} | Score: ${r.confidence_score} | Source: ${r.source} | Tags: [${(r.tags || []).join(', ')}] ===`);
      console.log(`Q: ${r.question}`);
      console.log(`A: ${r.answer_context}`);
      console.log(`--- (${r.ans_length} chars)\n`);
    });

  } catch (e) {
    console.error('[ERROR]', e.message);
  } finally {
    await pool.end();
  }
}

listLowScore();
