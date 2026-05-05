/**
 * search.js - [DEPRECATED] Semantic Skill Search Tool
 * 
 * ⚠️ DEPRECATED: Sử dụng find-skill.js thay thế (vector search chính xác hơn).
 * File này giữ lại để backward compatibility.
 * 
 * Luồng tìm kiếm (legacy — trigram only):
 *   1. Trigram similarity trên search_text (fuzzy, language-agnostic)
 *   2. Keyword array overlap 
 *   3. LIKE fallback cho exact substring match
 *   4. Rank + dedup → Top N
 */
const pool = require('../core/db');

const TOP_N = 3;

async function search(intent) {
  if (!intent || intent.trim().length === 0) {
    console.log('Usage: node search.js "<intent>"');
    process.exit(1);
  }

  const query = intent.trim().toLowerCase();
  
  // Tách intent thành tokens cho keyword matching
  const tokens = query.split(/[\s,.\-_]+/).filter(t => t.length > 2);

  try {
    const result = await pool.query(`
      WITH scored AS (
        SELECT 
          name, type, path, description, content_preview,
          -- Score 1: Trigram similarity (0-1)
          COALESCE(similarity(search_text, $1), 0) AS trgm_score,
          -- Score 2: Keyword overlap count
          (
            SELECT COUNT(*) FROM unnest(keywords) kw 
            WHERE kw = ANY($2::text[])
          ) AS kw_score
        FROM agent_registry
      )
      SELECT 
        name, type, path, description, content_preview,
        (trgm_score * 0.6 + LEAST(kw_score::float / GREATEST(array_length($2::text[], 1), 1), 1.0) * 0.4) AS final_score
      FROM scored
      WHERE trgm_score > 0.05 OR kw_score > 0
      ORDER BY final_score DESC
      LIMIT $3
    `, [query, tokens, TOP_N]);

    if (result.rows.length === 0) {
      console.log(`[NO MATCH] "${intent}" — không tìm thấy skill/workflow phù hợp.`);
      process.exit(0);
    }

    // Output cực gọn — tối ưu token cho AI đọc
    result.rows.forEach((r, i) => {
      const score = (r.final_score * 100).toFixed(0);
      console.log(`[${i + 1}] ${r.name} (${r.type}) score:${score}%`);
      console.log(`    ${r.description || '(no description)'}`);
      console.log(`    → ${r.path}`);
    });

  } catch (err) {
    console.error('[ERROR]', err.message);
  } finally {
    await pool.end();
  }
}

search(process.argv[2]);
