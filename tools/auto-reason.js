/**
 * auto-reason.js
 * Sử dụng Gemini (với API Key từ ENV) để tự suy luận Workflow (Recipe) 
 * cho intent bị missing và gọi save-recipe.js lưu lại DB.
 */
const { execFileSync } = require('child_process');
const { askWithReasoning, pool } = require('../core');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function getSkills() {
    const res = await pool.query('SELECT name, type, description FROM agent_registry');
    return res.rows.map(r => `[${r.type.toUpperCase()}] ${r.name}: ${r.description}`).join('\n');
}

async function reason(intent, contextStr) {

    const availableSkills = await getSkills();
    // Note: pool not ended here — save-recipe.js uses its own connection
    // Pool will be garbage collected on process exit

    const prompt = `You are a zero-knowledge agent orchestrator. The user wants to do the following task: "${intent}".
Context / Active Workspace: ${contextStr || 'No specific active file'}

Here are the available skills and workflows in the registry:
${availableSkills}

Create an execution plan (recipe) JSON with the exact following schema:
{
  "intent": "${intent}",
  "category": "general",
  "target_pattern": "",
  "steps": [
    {"action": "find-skill", "params": {"intent": "..."}},
    {"action": "skill:<skill_name>", "params": {"...": "..."}},
    {"action": "view_file", "params": {"path": "..."}}
  ],
  "skills_used": ["..."],
  "tools_used": ["..."]
}

If Context / Active Workspace contains a filepath or workspace state, extract a generalized filepath Regex/Glob pattern (e.g., **/*Service.cs, Features/{Domain}/*, etc.) and put it in the "target_pattern" field. Otherwise, leave it empty.

First, analyze the user's intent step-by-step using a Chain-of-Thought approach to design the best workflow. Wrap your internal reasoning inside <thought_process> ... </thought_process> XML tags.
After that, output the final valid raw JSON data exactly matching the schema. Do not use markdown code blocks for the JSON.`;

    let recipeJson = '';

    try {
        console.log(`[REASON] Đang suy luận Recipe cho "${intent}"...`);
        const response = await askWithReasoning(prompt, { jsonSchema: true });
        recipeJson = response.result;

        // Validate JSON parsing
        JSON.parse(recipeJson);
        
        // Write to temp file to avoid shell escaping issues entirely
        const tmpFile = path.join(os.tmpdir(), `recipe_${Date.now()}.json`);
        fs.writeFileSync(tmpFile, recipeJson, 'utf-8');
        
        console.log(`[REASON] Đã sinh xong Recipe cho "${intent}". Tiến hành lưu...`);
        const savePath = path.join(__dirname, 'save-recipe.js');
        const saveOut = execFileSync('node', [savePath, recipeJson], { encoding: 'utf-8' });
        console.log(saveOut);
        
        // Cleanup temp file
        try { fs.unlinkSync(tmpFile); } catch (_) {}
    } catch (e) {
        console.error('[ERROR] Failed to save reasoned plan.', e.message, "\nGot:", recipeJson);
        process.exit(1);
    }
}

const args = process.argv;
let intent = args[2];
let contextIndex = args.indexOf('--context');
let contextStr = '';
if (contextIndex !== -1 && contextIndex + 1 < args.length) {
    contextStr = args[contextIndex + 1];
}

reason(intent, contextStr);
