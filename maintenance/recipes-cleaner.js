/**
 * recipes-cleaner.js
 * Quét toàn bộ table, gộp các recipe trùng lặp (similarity > 0.95), giữ lại bản có success_ratio lớn nhất.
 */
const pool = require('../core/db');
const { MODEL_DIMS } = require('../core');

async function clean() {
  try {
    console.log('[*] Sàng lọc và Dọn dẹp Recipe trùng lặp...');
    
    // Nạp toàn bộ Recipe lên RAM để so khớp Cosine Distance
    const result = await pool.query('SELECT id, intent, embedding, hit_count, success_count FROM agent_recipes ORDER BY id ASC');
    const rows = result.rows;
    let deletedCount = 0;
    const toDelete = new Set();
    
    if (rows.length === 0) {
      console.log("[-] Không có Recipe nào trong Cache.");
      process.exit(0);
    }

    // Duyệt tìm bản ghi Duplicate
    for (let i = 0; i < rows.length; i++) {
      if (toDelete.has(rows[i].id)) continue;
      
      const duplicates = [rows[i]];
      const e1 = typeof rows[i].embedding === 'string' ? JSON.parse(rows[i].embedding) : rows[i].embedding;
      if (!e1 || !e1.length) continue;

      for (let j = i + 1; j < rows.length; j++) {
        if (toDelete.has(rows[j].id)) continue;
        
        const e2 = typeof rows[j].embedding === 'string' ? JSON.parse(rows[j].embedding) : rows[j].embedding;
        if (!e2 || !e2.length) continue;

        // Tính Cosine L2 (do mình đã normalize, dot product = cosine similarity)
        let dot = 0;
        for (let k = 0; k < MODEL_DIMS; k++) dot += (e1[k]*e2[k]);
        
        if (dot > 0.95) {
          duplicates.push(rows[j]);
        }
      }

      if (duplicates.length > 1) {
        // Có trùng, chọn thằng mạnh nhất để giữ lại
        duplicates.sort((a, b) => {
          const ratioA = a.hit_count > 0 ? (a.success_count / a.hit_count) : 0;
          const ratioB = b.hit_count > 0 ? (b.success_count / b.hit_count) : 0;
          if (ratioA !== ratioB) return ratioB - ratioA; // Giữ ratio to nhất
          return b.hit_count - a.hit_count; // Hoặc cái nào được dùng nhiều nhất
        });
        
        const winner = duplicates[0];
        console.log(`[=] Gom ${duplicates.length} recipes giống intent: "${winner.intent}" (Giữ lại ID: ${winner.id})`);
        for (let j = 1; j < duplicates.length; j++) {
          toDelete.add(duplicates[j].id);
        }
      }
    }

    if (toDelete.size > 0) {
      const arr = Array.from(toDelete);
      await pool.query('DELETE FROM agent_recipes WHERE id = ANY($1::int[])', [arr]);
      console.log(`[+] Đã xóa dứt điểm ${toDelete.size} recipes trùng lặp/chất lượng kém.`);
    } else {
      console.log(`[-] Không có rác dư thừa để dọn.`);
    }
  } catch (err) {
    console.error("[ERROR]", err.message);
  } finally {
    await pool.end();
  }
}

clean();
