/**
 * save-qa.js - Lưu (Cache) câu hỏi và trả lời lý thuyết vào Semantic Database
 *
 * Cách dùng:
 *   node tools/save-qa.js "<Question>" "<Answer>" [--source=manual|auto-qa|seed|teach] [--category=general] [--tags=tag1,tag2] [--project=erp]
 *
 * Tự động UPSERT: Nếu question đã tồn tại (theo md5 hash), sẽ UPDATE answer + ghi history.
 * Multi-tenant: --project=erp sẽ inject tag 'project:erp' để phân biệt nguồn dữ liệu.
 */
const { pool, embed, extractKeywords, inferTags } = require('../core');

function parseArgs(args) {
  const opts = { source: 'manual', category: 'general', tags: [], confidence: 1.0, project: null };
  for (const arg of args) {
    if (arg.startsWith('--source=')) opts.source = arg.split('=')[1];
    else if (arg.startsWith('--category=')) opts.category = arg.split('=')[1];
    else if (arg.startsWith('--confidence=')) opts.confidence = parseFloat(arg.split('=')[1]);
    else if (arg.startsWith('--tags=')) opts.tags = arg.split('=')[1].split(',').map(t => t.trim()).filter(t => t);
    else if (arg.startsWith('--project=')) opts.project = arg.split('=')[1].trim().toLowerCase();
  }
  // Inject project tag nếu có
  if (opts.project) {
    const projectTag = `project:${opts.project}`;
    if (!opts.tags.includes(projectTag)) opts.tags.push(projectTag);
  }
  return opts;
}

async function saveQA(question, answer) {
  if (!question || !answer) {
    console.log('Usage: node save-qa.js "<Question>" "<Answer>" [--source=manual] [--confidence=1.0] [--category=general] [--tags=a,b]');
    process.exit(1);
  }

  const opts = parseArgs(process.argv.slice(4));
  // Tu dong update tags theo bo tu dien
  opts.tags = inferTags(question, answer, opts.tags);

  const searchText = `${question} ${answer}`.toLowerCase();
  const vec = await embed(searchText);

  const keywords = extractKeywords(searchText);

  try {
    // Check if question already exists (dedup by hash)
    const existing = await pool.query(
      `SELECT id, answer_context FROM agent_qa_cache WHERE question_hash = md5(lower($1))`, [question]
    );

    if (existing.rows.length > 0) {
      const old = existing.rows[0];
      // Log history before overwriting
      await pool.query(
        `INSERT INTO agent_qa_history (qa_id, old_answer, new_answer, changed_by) VALUES ($1, $2, $3, $4)`,
        [old.id, old.answer_context, answer, opts.source]
      );
      // Update existing entry
      await pool.query(`
        UPDATE agent_qa_cache 
        SET answer_context = $1, search_text = $2, keywords = $3, embedding = $4,
            source = $5, category = $6, tags = $7, confidence_score = $8, updated_at = NOW()
        WHERE id = $9
      `, [answer, searchText, [...keywords], JSON.stringify(vec), opts.source, opts.category, opts.tags, opts.confidence, old.id]);

      console.log(`[~] QA Cache updated: id=${old.id} (history saved)`);
    } else {
      // Insert new entry
      const result = await pool.query(`
        INSERT INTO agent_qa_cache (question, answer_context, search_text, keywords, embedding, source, category, tags, confidence_score)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `, [question, answer, searchText, [...keywords], JSON.stringify(vec), opts.source, opts.category, opts.tags, opts.confidence]);

      console.log(`[+] QA Cache saved: id=${result.rows[0].id}`);
    }
  } catch (err) {
    console.error('[ERROR]', err.message);
  } finally {
    await pool.end();
  }
}

saveQA(process.argv[2], process.argv[3]);
