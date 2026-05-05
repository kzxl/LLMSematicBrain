/**
 * seed.js - Seed recipes từ file JSON vào DB
 * 
 * Cách dùng: node seed.js [file.json]
 * Default: seed-recipes.json
 */
const pool = require('../core/db');
const fs = require('fs');
const path = require('path');

async function seed(file) {
  const filePath = path.resolve(__dirname, file || 'seed-recipes.json');
  
  if (!fs.existsSync(filePath)) {
    console.error(`[ERROR] File not found: ${filePath}`);
    process.exit(1);
  }

  const recipes = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  let count = 0;

  for (const recipe of recipes) {
    const { intent, category = 'general', target_pattern = '', steps = [], skills_used = [], tools_used = [] } = recipe;

    const stepNotes = steps.map(s => s.note || s.action).join(' ');
    const searchText = `${intent} ${category} ${stepNotes} ${skills_used.join(' ')} ${tools_used.join(' ')}`.toLowerCase();

    const keywords = new Set();
    intent.split(/[\s,.\-_]+/).filter(w => w.length > 2).forEach(w => keywords.add(w.toLowerCase()));
    skills_used.forEach(s => keywords.add(s.toLowerCase()));
    tools_used.forEach(t => keywords.add(t.toLowerCase()));
    if (category) keywords.add(category.toLowerCase());

    await pool.query(`
      INSERT INTO agent_recipes (intent, category, target_pattern, steps, skills_used, tools_used, search_text, keywords)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [intent, category, target_pattern, JSON.stringify(steps), skills_used, tools_used, searchText, [...keywords]]);
    count++;
    console.log(`  [+] ${category}: "${intent}"`);
  }

  console.log(`\n[DONE] Seeded ${count} recipes`);

  const stats = await pool.query('SELECT category, COUNT(*) as count FROM agent_recipes GROUP BY category ORDER BY count DESC');
  console.log('\n[RECIPE STATS]');
  stats.rows.forEach(r => console.log(`  ${r.category}: ${r.count}`));

  await pool.end();
}

seed(process.argv[2]);
