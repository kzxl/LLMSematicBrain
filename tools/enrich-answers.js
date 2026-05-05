#!/usr/bin/env node
/**
 * enrich-answers.js — Nâng cấp answers thành Rich Format (concept + code + gotcha)
 * 
 * Dùng LLM để rewrite answers ngắn thành format:
 *   [CONCEPT] 1-2 câu mô tả
 *   [CODE] snippet C# thực tế
 *   [GOTCHA] edge cases / lỗi phổ biến
 *
 * Usage:
 *   node enrich-answers.js                    # Dry-run top 20 short answers
 *   node enrich-answers.js --fix              # Apply enrichment
 *   node enrich-answers.js --id=4             # Enrich specific entry
 *   node enrich-answers.js --min-hits=3       # Only entries with >= 3 hits
 */
const { pool, askLLM, embed, extractKeywords } = require('../core');

const DRY_RUN = !process.argv.includes('--fix');
const SPECIFIC_ID = process.argv.find(a => a.startsWith('--id='))?.split('=')[1];
const MIN_HITS = parseInt(process.argv.find(a => a.startsWith('--min-hits='))?.split('=')[1] || '1');
const MAX_ANSWER_LEN = 500; // Only enrich short answers

const SYSTEM_PROMPT = `Bạn là chuyên gia C# WinForms DevExpress trong hệ thống ERP MDS.

NHIỆM VỤ: Viết lại câu trả lời theo format RICH gồm 3 phần bắt buộc:

[CONCEPT] 1-2 câu mô tả ngắn gọn vấn đề
[CODE] Một code snippet C# thực tế (5-15 dòng), minh họa pattern chính
[GOTCHA] 1-2 edge cases hoặc lỗi phổ biến cần tránh

QUY TẮC:
- Tổng tối đa 600 chars
- Code phải compilable, dùng MDS patterns thực tế (BaseForm, Service, Controller)
- GOTCHA phải là kinh nghiệm thực, không phải theory
- Viết bằng tiếng Việt (trừ code)
- Trả về ĐÚNG format trên, không thêm gì khác`;

async function enrichEntry(row) {
  const prompt = `Câu hỏi: ${row.question}\nCâu trả lời hiện tại (${row.answer_len} chars): ${row.answer_context}\n\nViết lại theo format RICH:`;
  
  try {
    const result = await askLLM(prompt, { system: SYSTEM_PROMPT, maxTokens: 800 });
    const enriched = result.text.trim();
    
    // Validate: must contain all 3 sections
    if (!enriched.includes('[CONCEPT]') || !enriched.includes('[CODE]') || !enriched.includes('[GOTCHA]')) {
      return { success: false, reason: 'Missing sections', text: enriched };
    }
    
    if (enriched.length < 100) {
      return { success: false, reason: 'Too short', text: enriched };
    }
    
    return { success: true, text: enriched };
  } catch (e) {
    return { success: false, reason: e.message, text: '' };
  }
}

async function run() {
  console.log(`╔═══════════════════════════════════════════════╗`);
  console.log(`║  ANSWER ENRICHMENT — Rich Format Upgrade      ║`);
  console.log(`║  Mode: ${DRY_RUN ? 'DRY-RUN' : '⚡ FIX'}  Min hits: ${MIN_HITS}                  ║`);
  console.log(`╚═══════════════════════════════════════════════╝\n`);

  let query, params;
  if (SPECIFIC_ID) {
    query = `SELECT id, question, answer_context, LENGTH(answer_context) as answer_len, hit_count
             FROM agent_qa_cache WHERE id = $1`;
    params = [parseInt(SPECIFIC_ID)];
  } else {
    query = `SELECT id, question, answer_context, LENGTH(answer_context) as answer_len, hit_count
             FROM agent_qa_cache 
             WHERE hit_count >= $1 
               AND LENGTH(answer_context) < $2
               AND answer_context NOT LIKE '%[CODE]%'
             ORDER BY hit_count DESC LIMIT 20`;
    params = [MIN_HITS, MAX_ANSWER_LEN];
  }

  const entries = await pool.query(query, params);
  
  if (entries.rows.length === 0) {
    console.log('✅ No entries need enrichment (all have code examples or are long enough).');
    await pool.end();
    return;
  }

  console.log(`Found ${entries.rows.length} entries to enrich:\n`);

  let enriched = 0;
  for (const row of entries.rows) {
    console.log(`── #${row.id} [${row.hit_count} hits, ${row.answer_len}c] ──`);
    console.log(`Q: ${row.question.substring(0, 70)}`);
    
    const result = await enrichEntry(row);
    
    if (!result.success) {
      console.log(`  ❌ SKIP: ${result.reason}`);
      continue;
    }

    console.log(`  ✅ Enriched (${result.text.length}c):`);
    console.log(`  ${result.text.substring(0, 150)}...\n`);

    if (!DRY_RUN) {
      const searchText = `${row.question} ${result.text}`.toLowerCase();
      const vec = await embed(searchText);
      const keywords = extractKeywords(searchText);

      await pool.query(`
        UPDATE agent_qa_cache 
        SET answer_context = $1, search_text = $2, keywords = $3, embedding = $4, updated_at = NOW()
        WHERE id = $5
      `, [result.text, searchText, keywords, JSON.stringify(vec), row.id]);
      enriched++;
    }
  }

  console.log(`\n═══════════════════════════════════════════════`);
  if (DRY_RUN) {
    console.log(`[DRY-RUN] Preview complete. Run with --fix to apply.`);
  } else {
    console.log(`[DONE] ${enriched} entries enriched with Rich Format.`);
  }

  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
