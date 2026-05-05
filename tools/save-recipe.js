/**
 * save-recipe.js - Lưu Execution Plan (Recipe) sau khi Agent phân tích xong 1 task
 * 
 * Cách dùng (Agent gọi sau khi hoàn thành task):
 * node save-recipe.js '<JSON>'
 * 
 * JSON format:
 * {
 *   "intent": "Refactor feature Sales/Order theo UA conformance",
 *   "category": "refactor",
 *   "target_pattern": "Features/{Domain}/{Feature}",
 *   "steps": [
 *     {"order": 1, "action": "find-skill", "params": {"intent": "refactor UA"}, "note": "Tìm workflow phù hợp"},
 *     {"order": 2, "action": "view_file", "params": {"path": "{FeaturePath}"}, "note": "Đọc cấu trúc hiện tại"},
 *     {"order": 3, "action": "skill:ua-refactor", "params": {"FeaturePath": "...", "Branch": "MDS"}, "note": "Chạy UA refactor workflow"},
 *     {"order": 4, "action": "compile_solution", "params": {}, "note": "Build verify"},
 *     {"order": 5, "action": "git_commit", "params": {"msg": "refactor({Feature}): UA conformance"}, "note": "Commit"}
 *   ],
 *   "skills_used": ["ua-refactor", "compile_solution"],
 *   "tools_used": ["view_file", "list_dir", "run_command", "replace_file_content"]
 * }
 */
const { pool, embed, extractKeywords } = require('../core');

async function saveRecipe(jsonStr) {
  if (!jsonStr) {
    console.log('Usage: node save-recipe.js \'<JSON>\'');
    console.log('See file header for JSON format.');
    process.exit(1);
  }

  let recipe;
  try {
    recipe = JSON.parse(jsonStr);
  } catch (e) {
    console.error('[ERROR] Invalid JSON:', e.message);
    process.exit(1);
  }

  const { intent, category = 'general', target_pattern = '', steps = [], skills_used = [], tools_used = [] } = recipe;

  if (!intent || steps.length === 0) {
    console.error('[ERROR] "intent" and "steps" are required.');
    process.exit(1);
  }

  const stepNotes = steps.map(s => s.note || s.action).join(' ');
  const searchText = `${intent} ${category} ${stepNotes} ${skills_used.join(' ')} ${tools_used.join(' ')}`.toLowerCase();
  const vec = await embed(searchText);

  // Extract keywords using shared module + recipe-specific tokens
  const keywords = extractKeywords(searchText, {
    extraTokens: [...skills_used, ...tools_used, category]
  });

  try {
    // UPSERT: Check if a very similar recipe already exists (cosine > 0.9)
    const existing = await pool.query(`
      SELECT id, intent FROM agent_recipes 
      WHERE 1 - (embedding <=> $1::vector) > 0.9
      ORDER BY 1 - (embedding <=> $1::vector) DESC
      LIMIT 1
    `, [JSON.stringify(vec)]);

    if (existing.rows.length > 0) {
      const old = existing.rows[0];
      // UPDATE existing recipe instead of creating duplicate
      await pool.query(`
        UPDATE agent_recipes 
        SET intent = $1, category = $2, target_pattern = $3, steps = $4,
            skills_used = $5, tools_used = $6, search_text = $7, 
            keywords = $8, embedding = $9, updated_at = NOW()
        WHERE id = $10
      `, [intent, category, target_pattern, JSON.stringify(steps), skills_used, tools_used, searchText, keywords, JSON.stringify(vec), old.id]);

      console.log(`[~] Recipe updated: id=${old.id} (was: "${old.intent.substring(0, 60)}")`);
      console.log(`    Intent: ${intent}`);
      console.log(`    Steps: ${steps.length}`);
    } else {
      // INSERT new recipe
      const result = await pool.query(`
        INSERT INTO agent_recipes (intent, category, target_pattern, steps, skills_used, tools_used, search_text, keywords, embedding)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `, [intent, category, target_pattern, JSON.stringify(steps), skills_used, tools_used, searchText, keywords, JSON.stringify(vec)]);

      console.log(`[+] Recipe saved: id=${result.rows[0].id}`);
      console.log(`    Intent: ${intent}`);
      console.log(`    Category: ${category}`);
      console.log(`    Steps: ${steps.length}`);
      console.log(`    Skills: ${skills_used.join(', ') || 'none'}`);
      console.log(`    Tools: ${tools_used.join(', ') || 'none'}`);
    }

  } catch (err) {
    console.error('[ERROR]', err.message);
  } finally {
    await pool.end();
  }
}

saveRecipe(process.argv[2]);
