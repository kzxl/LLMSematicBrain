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

/**
 * @param {string} text 
 * @param {number} retries - Retry count (default 2)
 * @returns {Promise<number[]>}
 */
async function embed(text, retries = 2) {
  if (!text || text.trim() === '') return new Array(MODEL_DIMS).fill(0);
  
  // Check cache first
  const cacheKey = text.trim().substring(0, 200).toLowerCase();
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const extractor = await getPipeline();
      const output = await extractor(text, { pooling: 'cls', normalize: true });
      const result = Array.from(output.data);
      cacheSet(cacheKey, result);
      return result;
    } catch (err) {
      if (attempt === retries) throw err;
      console.error(`[EMBED] Retry ${attempt + 1}/${retries}: ${err.message}`);
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

module.exports = { embed, MODEL_DIMS, MODEL_NAME };
