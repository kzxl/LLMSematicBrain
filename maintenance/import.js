/**
 * import.js - Restore dữ liệu từ JSONL vào Semantic DB
 * 
 * Cách dùng:
 *   node import.js --file=backup.jsonl                   → import (skip existing)
 *   node import.js --file=backup.jsonl --overwrite        → import (overwrite existing)
 *   node import.js --file=backup.jsonl --table=qa_cache   → chỉ import 1 table
 * 
 * Format JSONL: mỗi dòng là JSON object với field _table cho biết thuộc table nào.
 */
const pool = require('../core/db');
const { embed } = require('../core/embed');
const fs = require('fs');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { file: null, overwrite: false, filterTable: null };
  
  for (const arg of args) {
    if (arg.startsWith('--file=')) opts.file = arg.split('=')[1];
    else if (arg === '--overwrite') opts.overwrite = true;
    else if (arg.startsWith('--table=')) opts.filterTable = arg.split('=')[1];
  }
  
  return opts;
}

async function importQA(row, overwrite) {
  const searchText = `${row.question} ${row.answer_context}`.toLowerCase();
  const vec = await embed(searchText);

  if (overwrite) {
    await pool.query(`
      INSERT INTO agent_qa_cache (question, answer_context, source, category, tags, keywords, embedding, search_text, confidence_score, hit_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT ((md5(lower(question)))) 
      DO UPDATE SET answer_context = $2, source = $3, category = $4, tags = $5, 
                    keywords = $6, embedding = $7, search_text = $8, 
                    confidence_score = $9, hit_count = $10, updated_at = NOW()
    `, [row.question, row.answer_context, row.source || 'manual', row.category || 'general',
        row.tags || [], row.keywords || [], JSON.stringify(vec), searchText,
        row.confidence_score || 1.0, row.hit_count || 0]);
    return 'upserted';
  } else {
    const exists = await pool.query(
      'SELECT 1 FROM agent_qa_cache WHERE question_hash = md5(lower($1))', [row.question]
    );
    if (exists.rows.length > 0) return 'skipped';
    
    await pool.query(`
      INSERT INTO agent_qa_cache (question, answer_context, source, category, tags, keywords, embedding, search_text, confidence_score, hit_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [row.question, row.answer_context, row.source || 'manual', row.category || 'general',
        row.tags || [], row.keywords || [], JSON.stringify(vec), searchText,
        row.confidence_score || 1.0, row.hit_count || 0]);
    return 'inserted';
  }
}

async function importRecipe(row, overwrite) {
  const stepNotes = (row.steps || []).map(s => s.note || s.action).join(' ');
  const searchText = `${row.intent} ${row.category} ${stepNotes}`.toLowerCase();
  const vec = await embed(searchText);

  // Check similarity
  const similar = await pool.query(`
    SELECT id FROM agent_recipes WHERE 1 - (embedding <=> $1::vector) > 0.9 LIMIT 1
  `, [JSON.stringify(vec)]);

  if (similar.rows.length > 0) {
    if (overwrite) {
      await pool.query(`
        UPDATE agent_recipes SET intent=$1, category=$2, target_pattern=$3, steps=$4,
          skills_used=$5, tools_used=$6, search_text=$7, keywords=$8, embedding=$9, updated_at=NOW()
        WHERE id=$10
      `, [row.intent, row.category, row.target_pattern, JSON.stringify(row.steps),
          row.skills_used || [], row.tools_used || [], searchText,
          row.keywords || [], JSON.stringify(vec), similar.rows[0].id]);
      return 'updated';
    }
    return 'skipped';
  }

  await pool.query(`
    INSERT INTO agent_recipes (intent, category, target_pattern, steps, skills_used, tools_used, search_text, keywords, embedding, hit_count, success_count)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `, [row.intent, row.category || 'general', row.target_pattern || '', JSON.stringify(row.steps),
      row.skills_used || [], row.tools_used || [], searchText,
      row.keywords || [], JSON.stringify(vec), row.hit_count || 0, row.success_count || 0]);
  return 'inserted';
}

async function main() {
  const opts = parseArgs();
  
  if (!opts.file) {
    console.log('Usage: node import.js --file=<backup.jsonl> [--overwrite] [--table=qa_cache|recipes]');
    process.exit(1);
  }

  if (!fs.existsSync(opts.file)) {
    console.error(`[ERROR] File not found: ${opts.file}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(opts.file, 'utf-8').split('\n').filter(l => l.trim());
  const stats = { qa_cache: { inserted: 0, updated: 0, skipped: 0 }, recipes: { inserted: 0, updated: 0, skipped: 0 }, unknown: 0 };

  try {
    for (const line of lines) {
      const row = JSON.parse(line);
      const table = row._table;
      
      if (opts.filterTable && table !== opts.filterTable) continue;

      if (table === 'qa_cache') {
        const result = await importQA(row, opts.overwrite);
        if (result === 'upserted') stats.qa_cache.updated++;
        else stats.qa_cache[result]++;
      } else if (table === 'recipes') {
        const result = await importRecipe(row, opts.overwrite);
        stats.recipes[result]++;
      } else if (table === 'registry') {
        // Registry is auto-generated by setup.js, skip import
        continue;
      } else {
        stats.unknown++;
      }
    }

    console.log('[+] Import complete:');
    if (stats.qa_cache.inserted + stats.qa_cache.updated + stats.qa_cache.skipped > 0) {
      console.log(`    qa_cache: +${stats.qa_cache.inserted} inserted, ~${stats.qa_cache.updated} updated, =${stats.qa_cache.skipped} skipped`);
    }
    if (stats.recipes.inserted + stats.recipes.updated + stats.recipes.skipped > 0) {
      console.log(`    recipes:  +${stats.recipes.inserted} inserted, ~${stats.recipes.updated} updated, =${stats.recipes.skipped} skipped`);
    }
    if (stats.unknown > 0) console.log(`    unknown:  ${stats.unknown} rows skipped`);

  } catch (err) {
    console.error('[ERROR]', err.message);
  } finally {
    await pool.end();
  }
}

main();
