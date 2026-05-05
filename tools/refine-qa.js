#!/usr/bin/env node
/**
 * refine-qa.js - Tách QA entry lớn thành nhiều entries nhỏ atomic
 *
 * Usage: node refine-qa.js --id=<qa_id>
 *
 * Principle: 1 Question = 1 Atomic Answer
 * Bad:  "How to improve UX?" → "1. Do A, 2. Do B, 3. Do C..." (10 points)
 * Good: "How to add search box?" → "Use TextEdit with NullValuePrompt property"
 */

const { pool, embed, extractKeywords } = require('../core');
const path = require('path');

const QA_ID = parseInt(process.argv.find(a => a.startsWith('--id='))?.split('=')[1]);

async function refineQA() {
  if (!QA_ID) {
    console.log('Usage: node refine-qa.js --id=<qa_id>');
    console.log('Example: node refine-qa.js --id=225');
    process.exit(1);
  }

  try {
    // Get the bloated QA entry
    const result = await pool.query('SELECT * FROM agent_qa_cache WHERE id = $1', [QA_ID]);

    if (result.rows.length === 0) {
      console.log(`[ERROR] QA entry id=${QA_ID} not found`);
      process.exit(1);
    }

    const qa = result.rows[0];
    console.log(`[REFINE] Analyzing QA entry id=${QA_ID}`);
    console.log(`Question: ${qa.question}`);
    console.log(`Answer length: ${qa.answer_context.length} chars`);

    // Detect if answer contains multiple points (numbered list)
    const points = qa.answer_context.match(/(\d+)\.\s*([^.]+(?:\.[^0-9][^.]*)*)/g);

    if (!points || points.length <= 1) {
      console.log(`[OK] Answer is already atomic (${points?.length || 0} points)`);
      process.exit(0);
    }

    console.log(`[BLOATED] Found ${points.length} points in single answer`);
    console.log(`\nSuggested split:\n`);

    const suggestions = [];

    for (let i = 0; i < points.length; i++) {
      const point = points[i].replace(/^\d+\.\s*/, '').trim();

      // Generate atomic question from the point
      const atomicQuestion = await generateAtomicQuestion(qa.question, point, i + 1);
      const atomicAnswer = point;

      suggestions.push({
        question: atomicQuestion,
        answer: atomicAnswer,
        tags: qa.tags,
        source: `refined-from-${QA_ID}`
      });

      console.log(`[${i + 1}/${points.length}] Q: ${atomicQuestion}`);
      console.log(`         A: ${atomicAnswer.substring(0, 80)}${atomicAnswer.length > 80 ? '...' : ''}\n`);
    }

    // Ask user to confirm
    console.log(`\n[ACTION] Split into ${suggestions.length} atomic QA entries?`);
    console.log(`Original entry (id=${QA_ID}) will be marked as deprecated.`);
    console.log(`\nTo proceed, run:`);
    console.log(`  node refine-qa.js --id=${QA_ID} --confirm\n`);

    if (process.argv.includes('--confirm')) {
      console.log(`[SPLITTING] Creating ${suggestions.length} atomic entries...`);

      const saveQaPath = path.join(__dirname, 'save-qa.js');
      const { execFileSync } = require('child_process');

      for (const sug of suggestions) {
        execFileSync('node', [
          saveQaPath,
          sug.question,
          sug.answer,
          `--source=${sug.source}`,
          `--tags=${sug.tags.join(',')}`,
          '--confidence=1.0'
        ], { stdio: 'inherit' });
      }

      // Mark original as deprecated (low confidence)
      await pool.query(
        'UPDATE agent_qa_cache SET confidence_score = 0.3, source = $1 WHERE id = $2',
        [`deprecated-split-into-${suggestions.length}`, QA_ID]
      );

      console.log(`\n[DONE] Split complete!`);
      console.log(`  Created: ${suggestions.length} atomic entries`);
      console.log(`  Deprecated: id=${QA_ID} (confidence=0.3)`);
    }

  } catch (err) {
    console.error('[ERROR]', err.message);
  } finally {
    await pool.end();
  }
}

/**
 * Generate atomic question using LLM (fallback to simple extraction)
 */
async function generateAtomicQuestion(originalQuestion, point, index) {
  try {
    const { askLLM } = require('../core');
    const prompt = `Từ câu hỏi gốc "${originalQuestion}" và điểm chi tiết sau:
"${point}"

Hãy tạo MỘT câu hỏi ngắn gọn, tự nhiên, dạng "How to..." hoặc "Cách..." mà developer sẽ search.
CHỈ trả về câu hỏi, KHÔNG giải thích.`;

    const result = await askLLM(prompt, { maxTokens: 100 });
    const q = result.text.trim().replace(/^["']|["']$/g, '');
    if (q.length > 10 && q.length < 200) return q;
  } catch (e) {
    // LLM unavailable — fallback
  }

  // Fallback: extract key words
  const words = point.split(' ').slice(0, 8).join(' ');
  return `How to ${words.toLowerCase()}?`;
}

refineQA();
