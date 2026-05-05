#!/usr/bin/env node
/**
 * dashboard.js — Semantic Brain Dashboard (1-shot overview)
 * 
 * Usage: node dashboard.js
 */
const { pool } = require('../core');

(async () => {
  console.log(`\n╔═══════════════════════════════════════════════════════╗`);
  console.log(`║          SEMANTIC BRAIN — DASHBOARD                   ║`);
  console.log(`╚═══════════════════════════════════════════════════════╝\n`);

  // 1. Overview
  const dash = await pool.query('SELECT * FROM v_qa_dashboard');
  const d = dash.rows[0];
  console.log(`── Overview ──`);
  console.log(`  Total entries:   ${d.total}`);
  console.log(`  Used (>0 hits):  ${d.used} (${d.use_pct}%)`);
  console.log(`  Total hits:      ${d.total_hits}`);
  console.log(`  Proven useful:   ${d.proven_useful}`);
  console.log(`  Avg answer len:  ${d.avg_answer_len} chars`);
  console.log(`  Has code [CODE]: ${d.has_code}`);
  console.log(`  Missing tags:    ${d.no_tags}`);

  // 2. Token savings
  const trackedLog = await pool.query('SELECT SUM(tokens_saved)::int as t FROM agent_qa_querylog');
  const trackedSaved = trackedLog.rows[0].t || 0;

  const avgTokens = Math.round(d.avg_answer_len * 0.35);
  const historicSavings = (2000 - avgTokens) * d.total_hits;
  const totalSavings = historicSavings + trackedSaved;

  console.log(`\n── Token Savings ──`);
  console.log(`  Per Avg Hit:  ~${2000 - avgTokens} tokens`);
  console.log(`  RealTracked:  ${trackedSaved.toLocaleString()} tokens (from query logs)`);
  console.log(`  Total Saved:  ~${totalSavings.toLocaleString()} tokens`);
  console.log(`  Cost Saved:   ~$${(totalSavings * 1.25 / 1000000).toFixed(4)}`);

  // 3. Quality distribution
  const quality = await pool.query(`
    SELECT 
      COUNT(CASE WHEN quality_score >= 0.7 THEN 1 END) as high,
      COUNT(CASE WHEN quality_score >= 0.4 AND quality_score < 0.7 THEN 1 END) as med,
      COUNT(CASE WHEN quality_score < 0.4 THEN 1 END) as low
    FROM v_qa_quality
  `);
  const q = quality.rows[0];
  console.log(`\n── Quality Distribution ──`);
  console.log(`  High (≥0.7):  ${q.high}  ${'█'.repeat(Math.round(q.high / 2))}`);
  console.log(`  Med  (0.4-7): ${q.med}  ${'▓'.repeat(Math.round(q.med / 2))}`);
  console.log(`  Low  (<0.4):  ${q.low}  ${'░'.repeat(Math.round(q.low / 2))}`);

  // 4. Top 5 by quality
  const top = await pool.query(`
    SELECT id, LEFT(question, 55) as question, quality_score, hit_count, useful_count, answer_len
    FROM v_qa_quality ORDER BY quality_score DESC LIMIT 5
  `);
  console.log(`\n── Top 5 Quality ──`);
  top.rows.forEach(r => {
    const bar = '█'.repeat(Math.round(r.quality_score * 10));
    console.log(`  #${r.id} [${bar}] ${r.quality_score} | h:${r.hit_count} u:${r.useful_count} | ${r.question}`);
  });

  // 5. Bottom 5 (need attention)
  const bottom = await pool.query(`
    SELECT id, LEFT(question, 55) as question, quality_score, hit_count, answer_len, source
    FROM v_qa_quality ORDER BY quality_score ASC LIMIT 5
  `);
  console.log(`\n── Bottom 5 (need attention) ──`);
  bottom.rows.forEach(r => {
    console.log(`  #${r.id} [${r.quality_score}] ${r.source.padEnd(8)} ${r.answer_len}c | ${r.question}`);
  });

  // 6. Source quality
  const src = await pool.query(`
    SELECT source, COUNT(*)::int as cnt, 
      ROUND(AVG(quality_score)::numeric, 3) as avg_quality,
      SUM(hit_count)::int as hits
    FROM v_qa_quality GROUP BY source ORDER BY avg_quality DESC
  `);
  console.log(`\n── Source Quality ──`);
  src.rows.forEach(r => {
    const bar = '█'.repeat(Math.round(r.avg_quality * 10));
    console.log(`  ${r.source.padEnd(25)} n=${String(r.cnt).padStart(3)} quality=${r.avg_quality} ${bar}`);
  });

  // 7. Query log (if available)
  const log = await pool.query(`SELECT * FROM v_querylog_summary LIMIT 5`);
  if (log.rows.length > 0) {
    console.log(`\n── Recent Query Activity ──`);
    log.rows.forEach(r => {
      console.log(`  ${r.day} | ${r.queries} queries | ${r.good_hits} good / ${r.weak_hits} weak | avg: ${r.avg_score}`);
    });
  }

  console.log();
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
