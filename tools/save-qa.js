/**
 * save-qa.js - Lưu (Cache) câu hỏi và trả lời lý thuyết vào Semantic Database
 *
 * Cách dùng:
 *   node tools/save-qa.js "<Question>" "<Answer>" [--source=manual|auto-qa|seed|teach] [--category=general] [--tags=tag1,tag2] [--project=erp]
 *
 * Tự động UPSERT: Nếu question đã tồn tại (theo md5 hash), sẽ UPDATE answer + ghi history.
 * Multi-tenant: --project=erp sẽ inject tag 'project:erp' để phân biệt nguồn dữ liệu.
 */
const { pool, embed, extractKeywords, inferTags, storageAme, config } = require('../core');

function parseArgs(args) {
  const opts = { source: 'manual', category: 'general', tags: [], confidence: 1.0, project: null, pinned: false };
  for (const arg of args) {
    if (arg.startsWith('--source=')) opts.source = arg.split('=')[1];
    else if (arg.startsWith('--category=')) opts.category = arg.split('=')[1];
    else if (arg.startsWith('--confidence=')) opts.confidence = parseFloat(arg.split('=')[1]);
    else if (arg.startsWith('--tags=')) opts.tags = arg.split('=')[1].split(',').map(t => t.trim()).filter(t => t);
    else if (arg.startsWith('--project=')) opts.project = arg.split('=')[1].trim().toLowerCase();
    else if (arg === '--pinned') opts.pinned = true;
  }
  // Inject project tag neu co
  if (opts.project) {
    const projectTag = `project:${opts.project}`;
    if (!opts.tags.includes(projectTag)) opts.tags.push(projectTag);
  }
  if (opts.pinned && !opts.tags.includes('pinned')) {
    opts.tags.push('pinned');
  }
  return opts;
}

async function saveQA(question, answer) {
  if (!question || !answer) {
    console.log('Usage: node save-qa.js "<Question>" "<Answer>" [--source=manual] [--confidence=1.0] [--category=general] [--tags=a,b] [--pinned]');
    process.exit(1);
  }

  const opts = parseArgs(process.argv.slice(4));
  // Tu dong update tags theo bo tu dien
  opts.tags = inferTags(question, answer, opts.tags);

  let savedToAme = false;
  try {
    const ameStatus = await storageAme.isAmeAvailable();
    if (ameStatus.available) {
      const ameRes = await storageAme.saveQA(question, answer, opts);
      console.log(`[+] AME Cognitive saved: [${opts.category || 'Episodic'}] (tags: ${opts.tags.join(',')}) via ${ameRes.backend}`);
      savedToAme = true;
    }
  } catch (ameErr) {
    console.warn(`[WARN] AME save: ${ameErr.message}`);
  }

  // If backend is explicitly AME, skip PostgreSQL
  if (config.backend === 'ame') {
    return;
  }

  const searchText = `${question} ${answer}`.toLowerCase();
  let vec = null;
  let keywords = [];

  try {
    vec = await embed(searchText);
    keywords = extractKeywords(searchText);
  } catch (embErr) {
    if (savedToAme) return; // Embedded failed but AME already persisted
  }

  try {
    // 1. Check exact question hash match
    const exactMatch = await pool.query(
      `SELECT id, question, answer_context, tags, hit_count FROM agent_qa_cache WHERE question_hash = md5(lower($1))`, [question]
    );

    let targetRow = exactMatch.rows.length > 0 ? exactMatch.rows[0] : null;
    let matchType = targetRow ? 'exact_hash' : null;

    // 2. If no exact hash, check semantic similarity threshold (>= 0.85) within same project/domain
    if (!targetRow && vec) {
      const projectTag = opts.project ? `project:${opts.project}` : null;
      const simQuery = `
        SELECT id, question, answer_context, tags, hit_count,
               1 - (embedding <=> $1::vector) AS similarity
        FROM agent_qa_cache
        WHERE ($2::text IS NULL OR $2 = ANY(tags))
          AND 1 - (embedding <=> $1::vector) >= 0.85
        ORDER BY similarity DESC
        LIMIT 1;
      `;
      const simMatch = await pool.query(simQuery, [JSON.stringify(vec), projectTag]);
      if (simMatch.rows.length > 0) {
        targetRow = simMatch.rows[0];
        matchType = `semantic_dedup (${(simMatch.rows[0].similarity * 100).toFixed(1)}% match)`;
      }
    }

    if (targetRow) {
      // Record historical version
      await pool.query(
        `INSERT INTO agent_qa_history (qa_id, old_answer, new_answer, changed_by) VALUES ($1, $2, $3, $4)`,
        [targetRow.id, targetRow.answer_context, answer, opts.source]
      );

      // Merge tags and retain pinned flag if already pinned
      const mergedTags = [...new Set([...(targetRow.tags || []), ...opts.tags])];
      if (opts.pinned && !mergedTags.includes('pinned')) {
        mergedTags.push('pinned');
      }

      // Update and strengthen existing QA entry
      await pool.query(`
        UPDATE agent_qa_cache 
        SET answer_context = $1, search_text = $2, keywords = $3, embedding = $4,
            source = $5, category = $6, tags = $7, confidence_score = $8,
            hit_count = COALESCE(hit_count, 0) + 1, updated_at = NOW()
        WHERE id = $9
      `, [answer, searchText, [...keywords], JSON.stringify(vec), opts.source, opts.category, mergedTags, opts.confidence, targetRow.id]);

      console.log(`[~] QA Cache strengthened [${matchType}]: id=${targetRow.id} (history saved, tags: ${mergedTags.join(',')})`);
    } else if (vec) {
      // Insert new entry
      const result = await pool.query(`
        INSERT INTO agent_qa_cache (question, answer_context, search_text, keywords, embedding, source, category, tags, confidence_score)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `, [question, answer, searchText, [...keywords], JSON.stringify(vec), opts.source, opts.category, opts.tags, opts.confidence]);

      console.log(`[+] QA Cache saved: id=${result.rows[0].id} (tags: ${opts.tags.join(',')})`);
    }
  } catch (err) {
    if (savedToAme) {
      console.log(`[INFO] QA successfully persisted to AME (PostgreSQL skipped/offline).`);
    } else {
      console.error('[ERROR]', err.message);
    }
  } finally {
    try {
      await pool.end();
    } catch {}
  }
}

saveQA(process.argv[2], process.argv[3]);
