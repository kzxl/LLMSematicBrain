/**
 * embed.js - BGE-M3 Embedding (1024d) via @xenova/transformers
 * 
 * Upgrade từ MiniLM-L12 (384d) → BGE-M3 (1024d)
 * - Multilingual (Vietnamese rất tốt)
 * - INT8 quantized (~570MB, ~800MB RAM)
 * - 16GB dev machine: dư sức
 * 
 * Features: LRU cache (50 entries) + retry with backoff
 */

const config = require('./config');

let pipelinePromise = null;

// Config-driven model selection
const MODEL_NAME = config.embedding?.model || 'Xenova/bge-m3';
const MODEL_DIMS = config.embedding?.dims || 1024;

// Simple LRU cache — avoids re-embedding repeated queries
const CACHE_MAX = 50;
const embedCache = new Map();

function cacheGet(key) {
  if (!embedCache.has(key)) return null;
  const val = embedCache.get(key);
  embedCache.delete(key);
  embedCache.set(key, val);
  return val;
}

function cacheSet(key, val) {
  if (embedCache.size >= CACHE_MAX) {
    embedCache.delete(embedCache.keys().next().value);
  }
  embedCache.set(key, val);
}

async function getPipeline() {
  if (!pipelinePromise) {
    const { pipeline, env } = await import('@xenova/transformers');
    env.allowLocalModels = true;
    
    console.error(`[EMBED] Loading ${MODEL_NAME} (${MODEL_DIMS}d)...`);
    pipelinePromise = pipeline('feature-extraction', MODEL_NAME, {
      quantized: true,
      progress_callback: (p) => {
        if (p.status === 'downloading') {
          console.error(`[EMBED] Downloading: ${p.file} (${Math.round((p.loaded||0)/1024/1024)}MB)`);
        }
      }
    });
  }
  return pipelinePromise;
}

const crypto = require('crypto');

let tableChecked = false;
async function ensureCacheTable() {
  if (tableChecked) return;
  try {
    const pool = require('./db');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_query_embedding_cache (
        query_hash VARCHAR(32) PRIMARY KEY,
        query_text TEXT NOT NULL,
        embedding VECTOR(1024) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    tableChecked = true;
  } catch (err) {
    console.error('[EMBED CACHE] Table check failed:', err.message);
  }
}

function getMd5(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

async function getDatabaseCachedEmbedding(text) {
  try {
    await ensureCacheTable();
    const hash = getMd5(text.trim().toLowerCase());
    const pool = require('./db');
    const res = await pool.query(
      'SELECT embedding FROM agent_query_embedding_cache WHERE query_hash = $1',
      [hash]
    );
    if (res.rows.length > 0) {
      const rawEmb = res.rows[0].embedding;
      if (typeof rawEmb === 'string') {
        return rawEmb.replace(/[\[\]]/g, '').split(',').map(Number);
      }
      return rawEmb;
    }
  } catch (err) {
    // Silently fallback if table query fails
  }
  return null;
}

async function saveDatabaseCachedEmbedding(text, embedding) {
  try {
    await ensureCacheTable();
    const hash = getMd5(text.trim().toLowerCase());
    const pool = require('./db');
    await pool.query(`
      INSERT INTO agent_query_embedding_cache (query_hash, query_text, embedding)
      VALUES ($1, $2, $3::vector)
      ON CONFLICT (query_hash) DO NOTHING
    `, [hash, text, JSON.stringify(embedding)]);
  } catch (err) {
    // Silently ignore save failures
  }
}

/**
 * @param {string} text 
 * @param {number} retries - Retry count (default 2)
 * @returns {Promise<number[]>}
 */
async function embed(text, retries = 2) {
  if (!text || text.trim() === '') return new Array(MODEL_DIMS).fill(0);
  
  // Check memory cache first
  const cacheKey = text.trim().substring(0, 200).toLowerCase();
  const cachedMemory = cacheGet(cacheKey);
  if (cachedMemory) return cachedMemory;

  // Check database cache next
  const cachedDb = await getDatabaseCachedEmbedding(text);
  if (cachedDb) {
    // Sync to memory cache for fast subsequent hits
    cacheSet(cacheKey, cachedDb);
    return cachedDb;
  }
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const extractor = await getPipeline();
      const output = await extractor(text, { pooling: 'cls', normalize: true });
      const result = Array.from(output.data);
      
      // Save to both caches
      cacheSet(cacheKey, result);
      await saveDatabaseCachedEmbedding(text, result);
      
      return result;
    } catch (err) {
      if (attempt === retries) throw err;
      console.error(`[EMBED] Retry ${attempt + 1}/${retries}: ${err.message}`);
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

module.exports = { embed, MODEL_DIMS, MODEL_NAME };
