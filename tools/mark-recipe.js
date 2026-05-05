/**
 * mark-recipe.js
 * Cập nhật điểm feedback hệ sinh tồn tự chữa lành (Self-Healing) cho Recipe Cache
 * Cách dùng: node mark-recipe.js --id=10 --success
 */
const { pool } = require('../core');

async function mark() {
  const args = process.argv.slice(2);
  let id = null;
  let status = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--id=')) {
      id = parseInt(args[i].split('=')[1]);
    } else if (args[i] === '--success') {
      status = 'success';
    } else if (args[i] === '--fail') {
      status = 'fail';
    } else if (!id && !isNaN(parseInt(args[i]))) {
      id = parseInt(args[i]);
    }
  }

  if (!id || !status) {
    console.log("Usage: node mark-recipe.js --id=<id> [--success|--fail]");
    process.exit(1);
  }

  try {
    if (status === 'success') {
      await pool.query(`UPDATE agent_recipes SET success_count = success_count + 1, updated_at = NOW() WHERE id = $1`, [id]);
      console.log(`[+] Recipe ${id} marked as SUCCESS. Reward granted.`);
    } else {
      // Đánh dấu fail: Phạt lỗi bằng cách cập nhật timestamp, hệ thống find-recipe 
      // sẽ tự động nhận diện success_count nhỏ hơn hit_count và trừ điểm phạt.
      await pool.query(`UPDATE agent_recipes SET updated_at = NOW() WHERE id = $1`, [id]);
      console.log(`[-] Recipe ${id} marked as FAIL. Effectiveness ratio dropped.`);
    }
  } catch (err) {
    console.error("[ERROR]", err.message);
  } finally {
    await pool.end();
  }
}

mark();
