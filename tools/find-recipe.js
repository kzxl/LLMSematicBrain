/**
 * find-recipe.js - Tìm Execution Plan (Recipe) có sẵn cho một task
 * 
 * Cách dùng: node find-recipe.js "refactor feature theo UA"
 */
const { pool, embed, callServer, tokenize, recipeRankingQuery } = require('../core');
const { execFileSync } = require('child_process');
const path = require('path');

async function findRecipe(intent, pathVal) {
  if (!intent || intent.trim().length === 0) {
    console.log('Usage: node find-recipe.js "<intent>" [--path "<filepath>"]');
    process.exit(1);
  }

  // Fast path: try warm server first
  const serverResult = await callServer(`/find-recipe?q=${encodeURIComponent(intent)}&path=${encodeURIComponent(pathVal || '')}`);
  if (serverResult) {
    if (serverResult.error === 'RECIPE_MISS') {
      // Server responded but no recipe — allow auto-reason fallback below
    } else if (serverResult._req) {
      console.log(JSON.stringify(serverResult));
      process.exit(0);
    }
  }

  // Slow path: direct execution  
  const query = intent.trim().toLowerCase();
  const tokens = tokenize(query);
  const vec = await embed(query);

  try {
    const rq = recipeRankingQuery({ limit: 1 });
    const result = await pool.query(rq.text, rq.params(tokens, JSON.stringify(vec), pathVal));

    if (result.rows.length === 0) {
      if (process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY) {
        try {
          const autoReasonPath = path.join(__dirname, 'auto-reason.js');
          const autoArgs = ['node', autoReasonPath, intent];
          if (pathVal) autoArgs.push('--context', pathVal);
          execFileSync(autoArgs[0], autoArgs.slice(1), { stdio: 'ignore' });
          const findRecipePath = path.join(__dirname, 'find-recipe.js');
          const findArgs = ['node', findRecipePath, intent];
          if (pathVal) findArgs.push('--path', pathVal);
          const out = execFileSync(findArgs[0], findArgs.slice(1), { encoding: 'utf-8' });
          console.log(out.trim());
        } catch (e) {
          console.log(`{"error": "RECIPE_MISS", "msg": "Auto-reasoning failed: ${e.message}"}`);
        }
        process.exit(0);
      } else {
        console.log(`{"error": "RECIPE_MISS", "msg": "Analyze manually and save-recipe.js later"}`);
        process.exit(0);
      }
    }

    const row = result.rows[0];
    await pool.query('UPDATE agent_recipes SET hit_count = hit_count + 1 WHERE id = $1', [row.id]);
    const steps = typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps;

    console.log(JSON.stringify({
      _req: row.intent,
      _id: row.id,
      pattern: row.target_pattern || undefined,
      steps: steps.map(s => ({ act: s.action, params: s.params }))
    }));

  } catch (err) {
    console.error('[ERROR]', err.message);
  } finally {
    await pool.end();
  }
}

const args = process.argv;
let intent = args[2];
let pathIndex = args.indexOf('--path');
let pathVal = '';
if (pathIndex !== -1 && pathIndex + 1 < args.length) pathVal = args[pathIndex + 1];

findRecipe(intent, pathVal);
