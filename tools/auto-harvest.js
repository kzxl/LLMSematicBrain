#!/usr/bin/env node
/**
 * auto-harvest.js — Post-Task Self-Learning Pipeline
 *
 * Nhận text tóm tắt (walkthrough/summary) → dùng LLM phân tích →
 * tách thành atomic QA pairs → lưu DB tự động.
 *
 * Usage:
 *   node auto-harvest.js "<summary text>" --tags=ua,inventory
 *   node auto-harvest.js --file=walkthrough.md --tags=ua,refactor
 *   node auto-harvest.js "<summary>" --tags=ua --dry-run    # Preview only
 *
 * LLM sẽ:
 *   1. Phân tích text, extract bài học kỹ thuật
 *   2. Lọc spam (typo, env-specific, one-off code)
 *   3. Tách thành atomic Q&A pairs
 *   4. Gắn tags phù hợp
 */
const { pool, askLLM, embed, extractKeywords } = require('../core');
const fs = require('fs');
const path = require('path');

// Parse args
const DRY_RUN = process.argv.includes('--dry-run');
const TAGS = (() => {
  const arg = process.argv.find(a => a.startsWith('--tags='));
  return arg ? arg.split('=')[1].split(',').map(t => t.trim()).filter(t => t) : [];
})();
const FILE_ARG = process.argv.find(a => a.startsWith('--file='))?.split('=')[1];
const TEXT_ARG = process.argv[2];

const SYSTEM_PROMPT = `Bạn là chuyên gia rút trích kiến thức kỹ thuật từ các phiên làm việc coding.

NHIỆM VỤ: Đọc summary/walkthrough bên dưới, extract các bài học kỹ thuật dưới dạng Q&A pairs.

QUY TẮC CHỌN LỌC (BỘ LỌC SPAM):
- ✅ LƯU: Design patterns, architecture decisions, bug patterns (root cause + fix), performance insights, WinForms/DevExpress tricks
- ❌ BỎ: Typos, syntax errors, env setup, business-specific one-off code, simple variable naming

QUY TẮC ATOMIC:
- Mỗi Q&A pair = 1 bài học duy nhất, tối đa 200 từ cho Answer
- Question phải là câu hỏi tự nhiên mà developer khác sẽ hỏi
- Answer phải actionable, có thể áp dụng ngay

OUTPUT: Trả về JSON array (không markdown wrapping):
[
  {
    "question": "Câu hỏi tự nhiên?",
    "answer": "Câu trả lời ngắn gọn, kỹ thuật, actionable.",
    "tags": ["tag1", "tag2"]
  }
]

Nếu KHÔNG có bài học nào đáng lưu, trả về: []`;

async function harvest(inputText) {
  if (!inputText || inputText.trim().length < 50) {
    console.log('Usage: node auto-harvest.js "<summary>" --tags=ua,inventory [--dry-run]');
    console.log('       node auto-harvest.js --file=walkthrough.md --tags=ua');
    console.log('\nInput must be at least 50 characters.');
    process.exit(1);
  }

  console.log(`╔═══════════════════════════════════════════════╗`);
  console.log(`║  AUTO-HARVEST — Post-Task Self-Learning       ║`);
  console.log(`║  Mode: ${DRY_RUN ? 'DRY-RUN (preview)' : '⚡ SAVE (writing DB)'}${DRY_RUN ? '       ' : '       '}║`);
  console.log(`╚═══════════════════════════════════════════════╝\n`);

  console.log(`[INPUT] ${inputText.length} chars | Tags: ${TAGS.length > 0 ? TAGS.join(',') : 'auto-detect'}`);
  console.log(`[LLM] Analyzing and extracting knowledge...\n`);

  // Ask LLM to extract atomic QA pairs
  const prompt = `=== PHIÊN LÀM VIỆC ===\n${inputText}\n\n=== EXTRACTION ===\nPhân tích và trả về JSON array các bài học:`;

  const result = await askLLM(prompt, { system: SYSTEM_PROMPT, maxTokens: 1500 });

  // Parse LLM response
  let pairs = [];
  try {
    // Try direct parse
    let jsonText = result.text.trim();
    // Strip markdown code blocks if present
    jsonText = jsonText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    pairs = JSON.parse(jsonText);
  } catch (e) {
    // Try to extract JSON array from mixed text
    const match = result.text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        pairs = JSON.parse(match[0]);
      } catch (e2) {
        console.error('[ERROR] LLM returned invalid JSON:', result.text.substring(0, 200));
        process.exit(1);
      }
    } else {
      console.log('[SKIP] LLM found no knowledge worth saving.');
      process.exit(0);
    }
  }

  if (!Array.isArray(pairs) || pairs.length === 0) {
    console.log('[SKIP] No actionable knowledge extracted (spam filter active).');
    process.exit(0);
  }

  // Validate and display
  console.log(`[EXTRACTED] ${pairs.length} atomic QA pairs:\n`);

  const validPairs = [];
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (!p.question || !p.answer) {
      console.log(`  [${i + 1}] ⚠️ SKIP — missing question or answer`);
      continue;
    }
    if (p.answer.length < 15) {
      console.log(`  [${i + 1}] ⚠️ SKIP — answer too short (${p.answer.length} chars)`);
      continue;
    }

    // Merge input tags with LLM-suggested tags
    const mergedTags = [...new Set([...TAGS, ...(p.tags || [])])];

    console.log(`  [${i + 1}] Q: ${p.question}`);
    console.log(`     A: ${p.answer.substring(0, 120)}${p.answer.length > 120 ? '...' : ''}`);
    console.log(`     Tags: ${mergedTags.join(', ')}\n`);

    validPairs.push({ ...p, tags: mergedTags });
  }

  if (validPairs.length === 0) {
    console.log('[RESULT] No valid pairs after filtering.');
    process.exit(0);
  }

  // Save to DB
  if (DRY_RUN) {
    console.log(`\n[DRY-RUN] ${validPairs.length} pairs would be saved. Run without --dry-run to save.`);
    return;
  }

  console.log(`\n[SAVING] Writing ${validPairs.length} entries to DB...`);
  let saved = 0;

  for (const p of validPairs) {
    try {
      const searchText = `${p.question} ${p.answer}`.toLowerCase();
      const vec = await embed(searchText);
      const keywords = extractKeywords(searchText);

      // Check existing
      const existing = await pool.query(
        'SELECT id FROM agent_qa_cache WHERE question_hash = md5(lower($1))',
        [p.question]
      );

      if (existing.rows.length > 0) {
        console.log(`  [~] Updated existing QA #${existing.rows[0].id}`);
        await pool.query(`
          UPDATE agent_qa_cache 
          SET answer_context=$1, search_text=$2, keywords=$3, embedding=$4,
              source='auto-harvest', tags=$5, confidence_score=0.9, updated_at=NOW()
          WHERE id=$6
        `, [p.answer, searchText, keywords, JSON.stringify(vec), p.tags, existing.rows[0].id]);
      } else {
        const res = await pool.query(`
          INSERT INTO agent_qa_cache (question, answer_context, search_text, keywords, embedding, source, category, tags, confidence_score)
          VALUES ($1, $2, $3, $4, $5, 'auto-harvest', 'general', $6, 0.9)
          RETURNING id
        `, [p.question, p.answer, searchText, keywords, JSON.stringify(vec), p.tags]);
        console.log(`  [+] Saved QA #${res.rows[0].id}`);
      }
      saved++;
    } catch (err) {
      console.error(`  [!] Error saving "${p.question.substring(0, 40)}...": ${err.message}`);
    }
  }

  console.log(`\n[DONE] ${saved}/${validPairs.length} QA pairs saved (source: auto-harvest, conf: 0.9)`);
}

// Entry
(async () => {
  let inputText;

  if (FILE_ARG) {
    const filePath = path.resolve(FILE_ARG);
    if (!fs.existsSync(filePath)) {
      console.error(`[ERROR] File not found: ${filePath}`);
      process.exit(1);
    }
    inputText = fs.readFileSync(filePath, 'utf-8');
  } else {
    inputText = TEXT_ARG;
  }

  try {
    await harvest(inputText);
  } catch (err) {
    console.error('[ERROR]', err.message);
  } finally {
    await pool.end();
  }
})();
