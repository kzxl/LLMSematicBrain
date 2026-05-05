/**
 * evaluate-qa.js - Script bảo trì: Đọc DB các câu hỏi "smart-rag" hoặc "auto-qa" có confidence < 0.8
 * và dùng Gemini/Anthropic (Cloud LLM) đánh giá lại, sau đó nâng điểm confidence lên.
 */
const { pool, askCloud } = require('../core');

async function evaluate() {
  try {
    const result = await pool.query(`
      SELECT id, question, answer_context, source, confidence_score 
      FROM agent_qa_cache 
      WHERE confidence_score < 0.8 AND source IN ('smart-rag', 'auto-qa')
      ORDER BY created_at ASC
      LIMIT 10
    `);

    if (result.rows.length === 0) {
      console.log('[EVAL] Không có QA nào cần đánh giá (mọi thứ đều >= 0.8)');
      return;
    }

    console.log(`[EVAL] Tìm thấy ${result.rows.length} mục cần Cloud LLM chấm điểm...`);

    for (const row of result.rows) {
      console.log(`\n--- ID: ${row.id} | Nguồn: ${row.source} | Điểm cũ: ${row.confidence_score} ---`);
      console.log(`Q: ${row.question}`);
      
      const prompt = `Bạn là vị giáo sư chấm điểm kiến thức kỹ thuật hệ thống (MDS WinForms).
Dưới đây là một bộ Câu Hỏi và Câu Trả Lời được tự động tổng hợp bởi AI cấp thấp.
Nhiệm vụ của bạn:
1. Đọc kỹ, sửa lỗi dùng từ ngữ lủng củng nếu có.
2. Đánh giá câu trả lời (0.0 đến 1.0). (Chỉ chấm nội dung liên quan hệ thống, >0.8 nếu logic hợp lý).
3. Đưa ra nguyên văn câu trả lời hoàn thiện nhất (chỉ trả về JSON).

=== CÂU HỎI ===
${row.question}

=== CÂU TRẢ LỜI CŨ ===
${row.answer_context}

Yêu cầu định dạng CHỈ TRẢ VỀ JSON:
{
  "score": 0.9,
  "improved_answer": "Câu trả lời đã làm mượt..."
}`;

      try {
        const resObj = await askCloud(prompt, 'Bạn chỉ trả về cục JSON hợp lệ. Không được kèm text markdown.');
        let jsonStr = resObj.text || resObj;
        // Dọn rác
        jsonStr = jsonStr.replace(/```json/gi, '').replace(/```/g, '').trim();
        const evalData = JSON.parse(jsonStr);

        if (evalData.score && evalData.improved_answer) {
          const finalScore = parseFloat(evalData.score);
          // Ghi đè vào DB
          await pool.query(`
            UPDATE agent_qa_cache 
            SET answer_context = $1, confidence_score = $2, source = 'reviewed-cloud', updated_at = NOW()
            WHERE id = $3
          `, [evalData.improved_answer, finalScore > 0.8 ? 1.0 : finalScore, row.id]);

          // Backup vào history
          await pool.query(
            `INSERT INTO agent_qa_history (qa_id, old_answer, new_answer, changed_by) VALUES ($1, $2, $3, $4)`,
            [row.id, row.answer_context, evalData.improved_answer, 'cloud-evaluator']
          );

          console.log(`[+] Đánh giá xong xếp loại: ${finalScore} -> Đã lưu!`);
        } else {
          console.log(`[-] LLM không trả JSON hợp lệ:`, jsonStr);
        }
      } catch (e) {
        console.error(`[-] Lỗi gọi LLM cho ID ${row.id}:`, e.message);
      }
    }
  } catch (e) {
    console.error('Database Error:', e.message);
  } finally {
    await pool.end();
  }
}

evaluate();
