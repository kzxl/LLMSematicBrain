/**
 * find-skill.js - Semantic Skill/Workflow Discovery Tool
 *
 * Usage: node tools/find-skill.js "<intent>" [top_n]
 * Output: Top N matches với path tương đối từ AGENT_ROOT
 */
const { pool, embed, callServer, tokenize, skillRankingQuery } = require('../core');
const config = require('../core/config');

const TOP_N = parseInt(process.argv[3]) || 3;
const AGENT_ROOT = config.agentRoot;

async function search(intent) {
  if (!intent || intent.trim().length === 0) {
    console.log('Usage: node tools/find-skill.js "<intent>" [top_n]');
    process.exit(1);
  }

  // Fast path: try warm server first
  const serverResult = await callServer(`/find-skill?q=${encodeURIComponent(intent)}&top=${TOP_N}`);
  if (serverResult && Array.isArray(serverResult) && serverResult.length > 0) {
    serverResult.forEach((r, i) => {
      console.log(`[${i + 1}] ${r.name} | ${r.type} | ${r.path}`);
      console.log(`    > ${r.desc}`);
    });
    process.exit(0);
  }
  if (serverResult && Array.isArray(serverResult) && serverResult.length === 0) {
    console.log(`[NO MATCH] "${intent}"`);
    process.exit(0);
  }

  // Slow path: direct execution
  const query = intent.trim().toLowerCase();
  const tokens = tokenize(query);
  const vec = await embed(query);

  try {
    const sq = skillRankingQuery();
    const result = await pool.query(sq.text, sq.params(tokens, TOP_N, JSON.stringify(vec)));

    if (result.rows.length === 0) {
      console.log(`[NO MATCH] "${intent}"`);
      process.exit(0);
    }

    result.rows.forEach((r, i) => {
      // Hiển thị path tương đối từ AGENT_ROOT nếu có, không thì giữ nguyên absolute path
      const relPath = (AGENT_ROOT && r.path.startsWith(AGENT_ROOT))
        ? r.path.substring(AGENT_ROOT.length + 1).replace(/\\/g, '/')
        : r.path;
      const desc = r.description ? r.description.substring(0, 100) + (r.description.length > 100 ? '...' : '') : '(no desc)';
      console.log(`[${i + 1}] ${r.name} | ${r.type} | ${relPath}`);
      console.log(`    > ${desc}`);
    });

  } catch (err) {
    console.error('[ERROR]', err.message);
  } finally {
    await pool.end();
  }
}

search(process.argv[2]);
