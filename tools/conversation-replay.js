#!/usr/bin/env node
/**
 * conversation-replay.js — Scan past conversation logs → extract missed knowledge
 * 
 * Đọc overview.txt từ các conversations gần đây, tìm patterns thường lặp lại
 * mà chưa tồn tại trong DB → harvest tự động.
 *
 * Usage:
 *   node conversation-replay.js                    # Scan recent 5 conversations
 *   node conversation-replay.js --count=10         # Scan 10 conversations
 *   node conversation-replay.js --dry-run          # Preview only
 */
const { pool, askLLM, embed, extractKeywords } = require('../core');
const fs = require('fs');
const path = require('path');

const BRAIN_DIR = path.resolve('C:/Users/phong.vo/.gemini/antigravity/brain');
const DRY_RUN = process.argv.includes('--dry-run');
const COUNT = parseInt(process.argv.find(a => a.startsWith('--count='))?.split('=')[1] || '5');

const EXTRACT_PROMPT = `Bạn là chuyên gia phân tích conversation log của AI coding agent.

NHIỆM VỤ: Đọc đoạn conversation overview dưới đây và extract các BÀI HỌC KỸ THUẬT có giá trị tái sử dụng.

QUY TẮC:
- Chỉ extract bài học agent đã ÁP DỤNG THÀNH CÔNG (không phải thất bại)
- Bài học phải là patterns/tricks CỤ THỂ cho MDS WinForms / DevExpress / C# ERP
- BỎ QUA: commit messages, file navigation, build commands, format/typo fixes
- Mỗi bài học = 1 Q&A pair ngắn gọn

OUTPUT: JSON array (không markdown):
[{"question":"...","answer":"...","tags":["tag1","tag2"]}]

Nếu KHÔNG có bài học đáng lưu, trả về: []`;

async function getRecentConversations() {
  if (!fs.existsSync(BRAIN_DIR)) {
    console.log('[ERROR] Brain directory not found:', BRAIN_DIR);
    return [];
  }

  // Search for multiple possible source files per conversation
  const sourceFiles = [
    '.system_generated/logs/overview.txt',
    'walkthrough.md',
    'implementation_plan.md',
  ];

  const dirs = fs.readdirSync(BRAIN_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      for (const sf of sourceFiles) {
        const filePath = path.join(BRAIN_DIR, d.name, sf);
        if (fs.existsSync(filePath)) {
          const stat = fs.statSync(filePath);
          return { id: d.name, path: filePath, mtime: stat.mtime, type: sf.split('/').pop() };
        }
      }
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, COUNT);

  return dirs;
}

async function checkExisting(question) {
  const vec = await embed(question.toLowerCase());
  const result = await pool.query(`
    SELECT id, question, 1 - (embedding <=> $1::vector) as similarity
    FROM agent_qa_cache
    WHERE 1 - (embedding <=> $1::vector) > 0.85
    LIMIT 1
  `, [JSON.stringify(vec)]);
  return result.rows.length > 0 ? result.rows[0] : null;
}

async function run() {
  console.log(`╔═══════════════════════════════════════════════╗`);
  console.log(`║  CONVERSATION REPLAY HARVESTER                ║`);
  console.log(`║  Mode: ${DRY_RUN ? 'DRY-RUN' : '⚡ SAVE'}  Scan: ${COUNT} recent convs        ║`);
  console.log(`╚═══════════════════════════════════════════════╝\n`);

  const convs = await getRecentConversations();
  console.log(`[SCAN] Found ${convs.length} conversations with logs\n`);

  let totalExtracted = 0;
  let totalSaved = 0;
  let totalDuplicate = 0;

  for (const conv of convs) {
    const overview = fs.readFileSync(conv.path, 'utf-8');
    
    // Take a meaningful chunk (not too large for LLM)
    const chunk = overview.substring(0, 6000);
    if (chunk.length < 200) {
      console.log(`[SKIP] ${conv.id.substring(0, 8)}... — too short`);
      continue;
    }

    console.log(`── Conv ${conv.id.substring(0, 8)}... (${(overview.length / 1024).toFixed(0)}KB) ──`);

    try {
      const result = await askLLM(
        `=== CONVERSATION LOG ===\n${chunk}\n\n=== EXTRACTION ===\nExtract bài học:`,
        { system: EXTRACT_PROMPT, maxTokens: 1500 }
      );

      let pairs = [];
      try {
        let jsonText = result.text.trim().replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const match = jsonText.match(/\[[\s\S]*\]/);
        pairs = match ? JSON.parse(match[0]) : JSON.parse(jsonText);
      } catch (e) {
        console.log(`  [PARSE ERROR] ${e.message}`);
        continue;
      }

      if (!Array.isArray(pairs) || pairs.length === 0) {
        console.log(`  [SKIP] No knowledge extracted`);
        continue;
      }

      totalExtracted += pairs.length;
      console.log(`  Extracted ${pairs.length} potential lessons:`);

      for (const p of pairs) {
        if (!p.question || !p.answer || p.answer.length < 20) continue;

        // Check duplicate
        const existing = await checkExisting(p.question);
        if (existing) {
          console.log(`  [DUP] "${p.question.substring(0, 50)}..." ≈ #${existing.id} (${(existing.similarity * 100).toFixed(0)}%)`);
          totalDuplicate++;
          continue;
        }

        console.log(`  [NEW] Q: ${p.question.substring(0, 60)}`);
        console.log(`        Tags: ${(p.tags || []).join(',')}`);

        if (!DRY_RUN) {
          const searchText = `${p.question} ${p.answer}`.toLowerCase();
          const vec = await embed(searchText);
          const keywords = extractKeywords(searchText);

          await pool.query(`
            INSERT INTO agent_qa_cache (question, answer_context, search_text, keywords, embedding, source, category, tags, confidence_score)
            VALUES ($1, $2, $3, $4, $5, 'conv-replay', 'general', $6, 0.85)
          `, [p.question, p.answer, searchText, keywords, JSON.stringify(vec), p.tags || []]);
          totalSaved++;
        }
      }
    } catch (e) {
      console.log(`  [ERROR] ${e.message}`);
    }
    console.log();
  }

  console.log(`═══════════════════════════════════════════════`);
  console.log(`Extracted: ${totalExtracted} | Duplicates: ${totalDuplicate} | New: ${totalExtracted - totalDuplicate}`);
  if (DRY_RUN) {
    console.log(`[DRY-RUN] Run without --dry-run to save ${totalExtracted - totalDuplicate} new entries.`);
  } else {
    console.log(`[DONE] Saved ${totalSaved} new entries from conversation replay.`);
  }

  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
