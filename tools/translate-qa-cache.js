#!/usr/bin/env node
/**
 * translate-qa-cache.js - QA Cache Translation to Telegraphic English
 * 
 * Scans Postgres QA Cache for Vietnamese answers, translates them
 * to Telegraphic English via LLM, and updates database records & embeddings.
 * 
 * Usage:
 *   node translate-qa-cache.js [--dry-run] [--limit=5]
 */
const { pool, embed } = require('../core');
const { askLLM } = require('../core/llm-local');

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='))?.split('=')[1];

const SYSTEM_PROMPT = `You are a professional technical editor and translator.

NHIỆM VỤ: Dịch câu trả lời (Answer) kỹ thuật sau sang tiếng Anh cực kỳ rút gọn (Telegraphic English).

RULES:
- Keep it extremely brief and focused.
- Use short bullet points.
- Remove conversational filler words (e.g., "Trong phần này", "Chúng ta cần", "Hãy chắc chắn", "Ví dụ").
- Preserve C# code blocks, SQL queries, and technical terms EXACTLY.
- Output ONLY the translated answer. Do not wrap in chat formatting.`;

async function translateCache() {
  console.log(`\n╔═══════════════════════════════════════════════╗`);
  console.log(`║  QA CACHE TRANSLATOR — Semantic Optimization  ║`);
  console.log(`║  Mode: ${DRY_RUN ? 'DRY-RUN (preview)' : '⚡ LIVE (updating DB)'}${DRY_RUN ? '       ' : '       '}║`);
  console.log(`╚═══════════════════════════════════════════════╝\n`);

  // Query entries with Vietnamese characters in answer_context
  // Using posix regex in PostgreSQL to match Vietnamese diacritics
  const queryLimit = LIMIT_ARG ? `LIMIT ${parseInt(LIMIT_ARG)}` : '';
  const res = await pool.query(`
    SELECT id, question, answer_context, tags
    FROM agent_qa_cache
    WHERE answer_context ~ '[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]'
    ORDER BY id ASC
    ${queryLimit}
  `);

  console.log(`[SCAN] Found ${res.rows.length} entries containing Vietnamese answers.`);
  if (res.rows.length === 0) {
    console.log('[SKIP] No Vietnamese entries to translate.');
    return;
  }

  for (let i = 0; i < res.rows.length; i++) {
    const row = res.rows[i];
    console.log(`\n[${i + 1}/${res.rows.length}] Processing QA #${row.id}: "${row.question.substring(0, 50)}..."`);
    console.log(`--- [ORIGINAL ANSWER] ---`);
    console.log(row.answer_context);
    
    console.log(`[LLM] Translating...`);
    try {
      const translation = await askLLM(row.answer_context, { system: SYSTEM_PROMPT, maxTokens: 800 });
      const englishAnswer = translation.text.trim();
      
      console.log(`--- [TRANSLATED ANSWER] ---`);
      console.log(englishAnswer);
      console.log(`---------------------------`);

      if (!DRY_RUN) {
        const newSearchText = `${row.question} ${englishAnswer}`.toLowerCase();
        const vec = await embed(newSearchText);
        
        await pool.query(`
          UPDATE agent_qa_cache 
          SET answer_context = $1, search_text = $2, embedding = $3, updated_at = NOW()
          WHERE id = $4
        `, [englishAnswer, newSearchText, JSON.stringify(vec), row.id]);
        
        console.log(`✅ QA #${row.id} updated successfully (re-embedded).`);
      }
    } catch (err) {
      console.error(`❌ Failed to process QA #${row.id}:`, err.message);
    }
  }

  console.log(`\n[DONE] Translation process complete.`);
}

(async () => {
  try {
    await translateCache();
  } catch (err) {
    console.error('[CRITICAL]', err.message);
  } finally {
    await pool.end();
  }
})();
