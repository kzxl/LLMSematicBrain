/**
 * find-qa-context.js - Pre-flight Context Sweep
 *
 * Mục tiêu: Thay vì gọi find-qa.js 1 lần với 1 câu hỏi,
 * tool này tự động decompose task thành nhiều sub-query (multi-angle search),
 * sweep DB 1 lần duy nhất, dedup, và trả về toàn bộ context liên quan.
 *
 * Usage:
 *   node tools/find-qa-context.js "<task description>" [--tags=ua,winforms] [--limit=5]
 */

const { pool, embed, tokenize, qaRankingQuery, normalizeTags } = require('../core');
const path = require('path');
const fs = require('fs');

// Parse args
const task = process.argv[2];
const PROJECT = (() => {
  const arg = process.argv.find(a => a.startsWith('--project='));
  return arg ? arg.split('=')[1].trim().toLowerCase() : null;
})();
const TAGS = (() => {
  const arg = process.argv.find(a => a.startsWith('--tags='));
  const raw = arg ? arg.split('=')[1].split(',').map(t => t.trim()).filter(t => t) : [];
  const normalized = normalizeTags(raw);
  if (PROJECT && !normalized.includes(`project:${PROJECT}`)) normalized.push(`project:${PROJECT}`);
  return normalized;
})();
const LIMIT = (() => {
  const arg = process.argv.find(a => a.startsWith('--limit='));
  return arg ? parseInt(arg.split('=')[1]) : 8;
})();
const MIN_SCORE = 0.38;

/**
 * Load decomposition angles from config file
 */
const ANGLES = (() => {
  try {
    // Look for decompose-angles.json alongside this file
    const configPath = path.join(__dirname, 'decompose-angles.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')).angles || [];
  } catch (e) {
    console.warn('[WARN] decompose-angles.json not found, using empty angles');
    return [];
  }
})();

/**
 * Decompose một task description thành nhiều sub-queries để search đa góc độ
 */
function decomposeToQueries(taskDescription) {
  const queries = [taskDescription];
  const lower = taskDescription.toLowerCase();

  for (const angle of ANGLES) {
    if (new RegExp(angle.match, 'i').test(lower)) {
      for (const q of angle.queries) {
        queries.push(q.replace('{task}', taskDescription));
      }
    }
  }

  return [...new Set(queries)];
}

/**
 * Search DB với 1 query, return top rows
 */
async function searchOne(question, tagsFilter) {
  const query = question.trim().toLowerCase();
  const tokens = tokenize(query);
  const vec = await embed(query);

  const filterTags = tagsFilter.length > 0 ? tagsFilter : null;
  const qq = qaRankingQuery({ limit: 5, minSimilarity: MIN_SCORE });
  const result = await pool.query(qq.text, qq.params(tokens, JSON.stringify(vec), filterTags));

  return result.rows;
}

/**
 * Main: Multi-angle sweep + dedup + format
 */
async function findQAContext(taskDescription) {
  console.log(`[CONTEXT SWEEP] Task: "${taskDescription}"`);
  console.log(`[CONTEXT SWEEP] Tags filter: ${TAGS.length > 0 ? TAGS.join(',') : 'none'}\n`);

  const queries = decomposeToQueries(taskDescription);
  console.log(`[ANGLES] ${queries.length} sub-queries generated:`);
  queries.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
  console.log();

  const seen = new Map();

  for (const q of queries) {
    try {
      const rows = await searchOne(q, TAGS);
      rows.forEach((row, index) => {
        const rank = index + 1;
        const crossRrfAdd = 1.0 / (60.0 + rank);

        if (!seen.has(row.id)) {
          seen.set(row.id, {
            ...row,
            matched_queries: [q],
            cross_rrf_score: crossRrfAdd,
            max_db_score: row.final_score
          });
        } else {
          const existing = seen.get(row.id);
          existing.matched_queries.push(q);
          existing.cross_rrf_score += crossRrfAdd;
          existing.max_db_score = Math.max(existing.max_db_score, row.final_score);
        }
      });
    } catch (err) {
      // continue on single query failure
    }
  }

  if (seen.size === 0) {
    console.log('[CONTEXT MISS] No relevant knowledge found in DB.');
    return;
  }

  const collected = Array.from(seen.values());
  collected.sort((a, b) => b.cross_rrf_score - a.cross_rrf_score);
  const top = collected.slice(0, LIMIT);

  const ids = top.map(r => r.id);
  if (ids.length > 0) {
    await pool.query(
      `UPDATE agent_qa_cache SET hit_count = hit_count + 1 WHERE id = ANY($1::int[])`,
      [ids]
    );
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[CONTEXT RESULT] ${top.length} relevant QA entries found (from ${collected.length} total matches, ${queries.length} angles)`);
  console.log(`${'='.repeat(60)}\n`);

  top.forEach((row, i) => {
    const score = (row.max_db_score * 100).toFixed(0);
    const rrfDisplay = (row.cross_rrf_score * 100).toFixed(1);
    const tags = (row.tags || []).join(', ');
    console.log(`--- [${i + 1}] QA #${row.id} | DB_Score: ${score}% | Cross_RRF: ${rrfDisplay} | Tags: ${tags} ---`);
    console.log(`Q: ${row.question}`);
    console.log(`A: ${row.answer_context}`);
    console.log(`   [matched via: ${row.matched_queries.map(q => `"${q}"`).join(', ')}]\n`);
  });

  console.log(`${'='.repeat(60)}`);
  console.log(`[SUMMARY] ${top.length} knowledge blocks loaded. Agent should use these as pre-context before analysis.`);
  console.log(`${'='.repeat(60)}`);
}

// Entry
(async () => {
  if (!task) {
    console.log('Usage: node tools/find-qa-context.js "<task description>" [--tags=ua,winforms] [--limit=8]');
    process.exit(1);
  }

  try {
    await findQAContext(task);
  } catch (err) {
    console.error('[ERROR]', err.message);
  } finally {
    await pool.end();
  }
})();
