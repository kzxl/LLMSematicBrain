/**
 * benchmark-full.js - Benchmark TOÀN DIỆN: System Prompt + Skill Search + Recipe Cache
 * 
 * So sánh 3 kịch bản:
 *   [A] Hiện tại: Inject full listing + AI tự phân tích mỗi task
 *   [B] Semantic Skill only: Inject 0, search on-demand 
 *   [C] Semantic Skill + Recipe Cache: Search skill + lookup recipe → skip reasoning
 */
const pool = require('../core/db');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const WORKFLOWS_DIR = path.join(PROJECT_ROOT, '.agent/workflows');
const SKILLS_DIR = path.join(PROJECT_ROOT, '.agent/skills');

function estTokens(text) { return Math.ceil(text.length / 4); }

async function main() {
  try {
    // ============================================================
    // 1. ĐO SYSTEM PROMPT LISTING (HIỆN TẠI)
    // ============================================================
    const wfList = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.md')).map(f => {
      const c = fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf-8');
      const m = c.match(/(?:description|desc)\s*:\s*(.+)/);
      return `- /${f.replace('.md','')}: ${m ? m[1].trim() : ''}`;
    }).join('\n');

    const skList = fs.readdirSync(SKILLS_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => {
      const sf = path.join(SKILLS_DIR, d.name, 'SKILL.md');
      if (!fs.existsSync(sf)) return null;
      const c = fs.readFileSync(sf, 'utf-8');
      const m = c.match(/(?:description|desc)\s*:\s*(.+)/);
      return `- ${d.name}: ${m ? m[1].trim() : ''}`;
    }).filter(Boolean).join('\n');

    const listingTokens = estTokens(wfList + skList);

    // ============================================================
    // 2. ĐO SKILL SEARCH OUTPUT
    // ============================================================
    const testQueries = [
      'refactor module Inventory theo chuan UA',
      'tao service controller moi cho Production',
      'fix loi null reference trong frmOrder',
      'kiem tra chat luong code SalesOrder',
      'them dinh kem file attachment vao form',
    ];

    let totalSearchChars = 0;
    for (const q of testQueries) {
      const tokens = q.toLowerCase().split(/[\s,.\-_]+/).filter(t => t.length > 2);
      const r = await pool.query(`
        WITH s AS (
          SELECT name, type, description,
            COALESCE(similarity(search_text, $1), 0) AS ts,
            (SELECT COUNT(*) FROM unnest(keywords) kw WHERE kw = ANY($2::text[])) AS ks
          FROM agent_registry
        )
        SELECT name, type, description,
          (ts * 0.6 + LEAST(ks::float / GREATEST(array_length($2::text[], 1), 1), 1.0) * 0.4) AS sc
        FROM s WHERE ts > 0.05 OR ks > 0 ORDER BY sc DESC LIMIT 3
      `, [q.toLowerCase(), tokens]);
      
      let out = '';
      r.rows.forEach((row, i) => {
        out += `[${i+1}] ${row.name} (${row.type}) score:${(row.sc*100).toFixed(0)}%\n`;
        out += `    ${row.description}\n`;
      });
      totalSearchChars += out.length;
    }
    const avgSearchTokens = estTokens('x'.repeat(Math.ceil(totalSearchChars / testQueries.length)));

    // ============================================================
    // 3. ĐO RECIPE SEARCH OUTPUT
    // ============================================================
    let totalRecipeChars = 0;
    let recipeHits = 0;
    for (const q of testQueries) {
      const tokens = q.toLowerCase().split(/[\s,.\-_]+/).filter(t => t.length > 2);
      const r = await pool.query(`
        WITH s AS (
          SELECT id, intent, category, target_pattern, steps, skills_used, tools_used,
            COALESCE(similarity(search_text, $1), 0) AS ts,
            (SELECT COUNT(*) FROM unnest(keywords) kw WHERE kw = ANY($2::text[])) AS ks
          FROM agent_recipes
        )
        SELECT *,
          (ts * 0.5 + LEAST(ks::float / GREATEST(array_length($2::text[], 1), 1), 1.0) * 0.3) AS sc
        FROM s WHERE ts > 0.1 OR ks >= 2 ORDER BY sc DESC LIMIT 1
      `, [q.toLowerCase(), tokens]);

      if (r.rows.length > 0) {
        recipeHits++;
        const row = r.rows[0];
        const steps = typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps;
        let out = `[RECIPE HIT] id=${row.id} (${row.category})\n`;
        out += `Intent: ${row.intent}\n`;
        out += `Pattern: ${row.target_pattern}\n`;
        steps.forEach(s => { out += `  ${s.order}. ${s.action} > ${s.note}\n`; });
        out += `Skills: ${(row.skills_used||[]).join(', ')}\n`;
        totalRecipeChars += out.length;
      }
    }
    const avgRecipeTokens = recipeHits > 0 ? estTokens('x'.repeat(Math.ceil(totalRecipeChars / recipeHits))) : 0;

    // ============================================================
    // 4. ĐO AI REASONING TOKENS (ước lượng)
    // ============================================================
    // Khi Agent tự phân tích task (không có recipe):
    //   - Đọc yêu cầu → suy luận cần tool gì → chọn skill → plan steps
    //   - Trung bình: ~300-500 output tokens reasoning
    //   - Cộng thêm: view_file workflow/skill ~800 tokens input 
    const REASONING_TOKENS = 400;  // output tokens cho suy luận
    const SKILL_READ_TOKENS = 800; // input tokens đọc skill file

    // ============================================================
    // 5. TÍNH TOÁN SCENARIO
    // ============================================================
    const TURNS = 10;
    const TASKS_PER_CONV = 3; // số task cần xử lý trong 1 conversation
    const RECIPE_HIT_RATE = recipeHits / testQueries.length; // thực tế đo được

    // [A] Hiện tại: Full listing mỗi turn + AI reasoning mỗi task
    const A_listing = listingTokens * TURNS;
    const A_reasoning = (REASONING_TOKENS + SKILL_READ_TOKENS) * TASKS_PER_CONV;
    const A_total = A_listing + A_reasoning;

    // [B] Semantic Skill only: Không listing, search on-demand, vẫn reason
    const B_listing = 0;
    const B_search = avgSearchTokens * TASKS_PER_CONV;
    const B_reasoning = (REASONING_TOKENS + SKILL_READ_TOKENS) * TASKS_PER_CONV;
    const B_total = B_listing + B_search + B_reasoning;

    // [C] Semantic + Recipe: Không listing, search + recipe, skip reasoning khi HIT
    const C_listing = 0;
    const C_search = avgSearchTokens * TASKS_PER_CONV;
    const C_recipe = avgRecipeTokens * TASKS_PER_CONV * RECIPE_HIT_RATE;
    const C_reasoning = (REASONING_TOKENS + SKILL_READ_TOKENS) * TASKS_PER_CONV * (1 - RECIPE_HIT_RATE);
    const C_total = C_listing + C_search + C_recipe + C_reasoning;

    // ============================================================
    // OUTPUT
    // ============================================================
    const W = 62;
    const line = '─'.repeat(W);
    const dline = '═'.repeat(W);

    console.log(`╔${dline}╗`);
    console.log(`║  FULL BENCHMARK: Semantic Skill + Recipe Cache            ║`);
    console.log(`╚${dline}╝`);
    console.log();

    console.log(`┌${line}┐`);
    console.log(`│ 1. RAW MEASUREMENTS                                         │`);
    console.log(`├${line}┤`);
    console.log(`│ System prompt listing      : ${String(listingTokens).padStart(5)} tokens/turn            │`);
    console.log(`│ Skill search output (avg)  : ${String(avgSearchTokens).padStart(5)} tokens/query           │`);
    console.log(`│ Recipe search output (avg) : ${String(avgRecipeTokens).padStart(5)} tokens/query           │`);
    console.log(`│ AI reasoning (no recipe)   : ${String(REASONING_TOKENS).padStart(5)} output tokens/task    │`);
    console.log(`│ Skill file read (no recipe): ${String(SKILL_READ_TOKENS).padStart(5)} input tokens/task     │`);
    console.log(`│ Recipe hit rate            : ${(RECIPE_HIT_RATE*100).toFixed(0).padStart(4)}% (${recipeHits}/${testQueries.length} queries)         │`);
    console.log(`└${line}┘`);
    console.log();

    console.log(`┌${line}┐`);
    console.log(`│ 2. TOKEN COMPARISON (${TURNS} turns, ${TASKS_PER_CONV} tasks/conv)                     │`);
    console.log(`├──────────────────────┬─────────┬─────────┬─────────┬────────┤`);
    console.log(`│ Component            │ [A] Now │[B] Skill│[C] Full │  Unit  │`);
    console.log(`├──────────────────────┼─────────┼─────────┼─────────┼────────┤`);
    console.log(`│ Listing (per turn)   │${String(listingTokens).padStart(8)} │${String(0).padStart(8)} │${String(0).padStart(8)} │ input  │`);
    console.log(`│ Listing × ${TURNS} turns    │${String(A_listing).padStart(8)} │${String(0).padStart(8)} │${String(0).padStart(8)} │ input  │`);
    console.log(`│ Skill search         │${String(0).padStart(8)} │${String(B_search).padStart(8)} │${String(Math.ceil(C_search)).padStart(8)} │ input  │`);
    console.log(`│ Recipe lookup        │${String(0).padStart(8)} │${String(0).padStart(8)} │${String(Math.ceil(C_recipe)).padStart(8)} │ input  │`);
    console.log(`│ AI reasoning         │${String(A_reasoning).padStart(8)} │${String(B_reasoning).padStart(8)} │${String(Math.ceil(C_reasoning)).padStart(8)} │ out+in │`);
    console.log(`├──────────────────────┼─────────┼─────────┼─────────┼────────┤`);
    console.log(`│ TOTAL / conversation │${String(A_total).padStart(8)} │${String(B_total).padStart(8)} │${String(Math.ceil(C_total)).padStart(8)} │ tokens │`);
    console.log(`├──────────────────────┼─────────┼─────────┼─────────┼────────┤`);
    
    const savB = A_total - B_total;
    const savC = A_total - Math.ceil(C_total);
    const pctB = ((savB / A_total) * 100).toFixed(1);
    const pctC = ((savC / A_total) * 100).toFixed(1);
    console.log(`│ Saved vs [A]         │    ---  │${String(savB).padStart(8)} │${String(savC).padStart(8)} │ tokens │`);
    console.log(`│ Saved %              │    ---  │${(pctB+'%').padStart(8)} │${(pctC+'%').padStart(8)} │        │`);
    console.log(`└──────────────────────┴─────────┴─────────┴─────────┴────────┘`);
    console.log();

    // Cost estimation
    const PRICE_IN = 2.5;   // $/1M input tokens (GPT-4o)
    const PRICE_OUT = 10.0;  // $/1M output tokens
    const costA = A_total / 1e6 * PRICE_IN;
    const costB = B_total / 1e6 * PRICE_IN;
    const costC = Math.ceil(C_total) / 1e6 * PRICE_IN;

    console.log(`┌${line}┐`);
    console.log(`│ 3. COST ESTIMATE (GPT-4o: $2.5/1M in, $10/1M out)           │`);
    console.log(`├──────────────────────┬─────────────┬────────────────────────┤`);
    console.log(`│ Scenario             │ $/conv      │ $/day (×100 conv)      │`);
    console.log(`├──────────────────────┼─────────────┼────────────────────────┤`);
    console.log(`│ [A] Now              │ $${costA.toFixed(6).padStart(9)} │ $${(costA*100).toFixed(4).padStart(9)}               │`);
    console.log(`│ [B] + Semantic Skill │ $${costB.toFixed(6).padStart(9)} │ $${(costB*100).toFixed(4).padStart(9)}               │`);
    console.log(`│ [C] + Recipe Cache   │ $${costC.toFixed(6).padStart(9)} │ $${(costC*100).toFixed(4).padStart(9)}               │`);
    console.log(`└──────────────────────┴─────────────┴────────────────────────┘`);
    console.log();

    // Latency estimate
    console.log(`┌${line}┐`);
    console.log(`│ 4. RESPONSE TIME IMPACT                                     │`);
    console.log(`├──────────────────────┬─────────────┬────────────────────────┤`);
    console.log(`│ Scenario             │ First resp  │ Why                    │`);
    console.log(`├──────────────────────┼─────────────┼────────────────────────┤`);
    console.log(`│ [A] Now              │ 5-15s       │ Read prompt + reason   │`);
    console.log(`│ [B] + Semantic Skill │ 4-12s       │ Smaller prompt         │`);
    console.log(`│ [C] + Recipe Cache   │ 2-5s        │ Skip reasoning, exec!  │`);
    console.log(`└──────────────────────┴─────────────┴────────────────────────┘`);
    console.log();

    console.log(`┌${line}┐`);
    console.log(`│ 5. SEARCH ACCURACY                                          │`);
    console.log(`├${line}┤`);
    
    for (const q of testQueries) {
      const tokens = q.toLowerCase().split(/[\s,.\-_]+/).filter(t => t.length > 2);
      
      // Find skill
      const sr = await pool.query(`
        WITH s AS (SELECT name, type, COALESCE(similarity(search_text, $1), 0) AS ts,
          (SELECT COUNT(*) FROM unnest(keywords) kw WHERE kw = ANY($2::text[])) AS ks
        FROM agent_registry)
        SELECT name, type FROM s WHERE ts > 0.05 OR ks > 0 ORDER BY (ts*0.6 + LEAST(ks::float/GREATEST(array_length($2::text[],1),1),1.0)*0.4) DESC LIMIT 1
      `, [q.toLowerCase(), tokens]);
      
      // Find recipe
      const rr = await pool.query(`
        WITH s AS (SELECT id, category, intent, COALESCE(similarity(search_text, $1), 0) AS ts,
          (SELECT COUNT(*) FROM unnest(keywords) kw WHERE kw = ANY($2::text[])) AS ks
        FROM agent_recipes)
        SELECT id, category, intent FROM s WHERE ts > 0.1 OR ks >= 2 ORDER BY (ts*0.5+LEAST(ks::float/GREATEST(array_length($2::text[],1),1),1.0)*0.3) DESC LIMIT 1
      `, [q.toLowerCase(), tokens]);

      const skill = sr.rows.length > 0 ? `${sr.rows[0].name}` : 'MISS';
      const recipe = rr.rows.length > 0 ? `#${rr.rows[0].id} ${rr.rows[0].category}` : 'MISS';
      const status = rr.rows.length > 0 ? '✅' : '⚠️';
      
      console.log(`│ ${status} "${q.substring(0,38).padEnd(38)}"                     │`);
      console.log(`│    skill: ${skill.padEnd(20)} recipe: ${recipe.padEnd(20)}   │`);
    }
    console.log(`└${line}┘`);

  } catch (err) {
    console.error('[ERROR]', err.message);
  } finally {
    await pool.end();
  }
}

main();
