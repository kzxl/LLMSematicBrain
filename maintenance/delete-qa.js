/**
 * delete-qa.js - Xóa một QA entry khỏi DB (dọn rác)
 * 
 * Usage: node delete-qa.js <ID>
 */
const { pool } = require('../core');

async function deleteQA() {
  const id = parseInt(process.argv[2]);
  if (!id || isNaN(id)) {
    console.log('Usage: node delete-qa.js <ID>');
    process.exit(1);
  }

  try {
    // Backup to history before deleting
    const existing = await pool.query('SELECT question, answer_context FROM agent_qa_cache WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      console.log(`[!] ID ${id} không tồn tại.`);
      return;
    }

    await pool.query(
      `INSERT INTO agent_qa_history (qa_id, old_answer, new_answer, changed_by) VALUES ($1, $2, $3, $4)`,
      [id, existing.rows[0].answer_context, '[DELETED]', 'agent-cleanup']
    );
    await pool.query('DELETE FROM agent_qa_cache WHERE id = $1', [id]);
    console.log(`[x] Đã xóa QA id=${id}: "${existing.rows[0].question.substring(0, 50)}..."`);
  } catch (e) {
    console.error('[ERROR]', e.message);
  } finally {
    await pool.end();
  }
}

deleteQA();
