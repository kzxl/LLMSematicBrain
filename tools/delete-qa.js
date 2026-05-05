/**
 * delete-qa.js - Delete QA entry from cache
 *
 * Usage: node delete-qa.js --id=123
 */
const { pool } = require('../core');

const ID = parseInt(process.argv.find(a => a.startsWith('--id='))?.split('=')[1]);

async function deleteQA() {
  if (!ID) {
    console.log('Usage: node delete-qa.js --id=<id>');
    process.exit(1);
  }

  try {
    // Check if exists
    const check = await pool.query('SELECT id, question FROM agent_qa_cache WHERE id = $1', [ID]);

    if (check.rows.length === 0) {
      console.log(`[ERROR] QA entry id=${ID} not found`);
      process.exit(1);
    }

    const qa = check.rows[0];
    console.log(`[DELETE] Removing QA entry id=${ID}`);
    console.log(`    Q: ${qa.question.substring(0, 100)}${qa.question.length > 100 ? '...' : ''}`);

    // Delete from history first (foreign key)
    await pool.query('DELETE FROM agent_qa_history WHERE qa_id = $1', [ID]);

    // Delete from cache
    await pool.query('DELETE FROM agent_qa_cache WHERE id = $1', [ID]);

    console.log(`[OK] QA entry deleted successfully`);

  } catch (err) {
    console.error('[ERROR]', err.message);
  } finally {
    await pool.end();
  }
}

deleteQA();
