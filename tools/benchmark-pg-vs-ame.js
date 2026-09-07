#!/usr/bin/env node
/**
 * benchmark-pg-vs-ame.js - Rigorous Performance Benchmark: PostgreSQL (pgvector) vs AME
 * 
 * Measures:
 *   1. Pure Query Latency (Pre-embedded vector / Raw engine search execution)
 *   2. End-to-End Latency (String Query -> Embedding -> Ranking -> Top-K Result)
 *   3. Statistical distribution: Min, P50, P90, P95, P99, Max, Mean, StdDev, QPS
 * 
 * Usage:
 *   node tools/benchmark-pg-vs-ame.js [--iterations=10] [--top=5]
 */

const { performance } = require('perf_hooks');
const { pool, embed, qaRankingQuery, storageAme } = require('../core');
const path = require('path');
const { execFileSync } = require('child_process');

const ITERATIONS = (() => {
  const arg = process.argv.find(a => a.startsWith('--iterations='));
  return arg ? parseInt(arg.split('=')[1], 10) : 10;
})();

const TOP_K = (() => {
  const arg = process.argv.find(a => a.startsWith('--top='));
  return arg ? parseInt(arg.split('=')[1], 10) : 5;
})();

const BENCHMARK_QUERIES = [
  "BaseForm và RunAfterShown pattern",
  "Cách truy vấn DB chuẩn trong Service layer",
  "Lỗi deadlock khi commit transaction",
  "GridControl freeze async task",
  "PopulateControls và CollectData",
  "DataAccessHelper ExecuteQueryAsync",
  "LiteSql ORM thay thế LINQ to SQL",
  "Partial Service Class FormQuery",
  "Xử lý lỗi CS1503 CS1061 sau refactor",
  "DevExpress GridColumn format currency",
  "Nguyên tắc Thin View Controller Delegation",
  "Phân hệ Inventory quản lý tồn kho",
  "Quản lý quyền phân quyền permission",
  "Thao tác xuất Excel từ GridView",
  "Khởi tạo Dependency Injection Autofac",
  "Xử lý timeout SQL Server connection",
  "Tối ưu hóa bộ nhớ và garbage collection",
  "Lỗi null reference exception khi binding data",
  "Async await task configure await false",
  "Đồng bộ hóa dữ liệu DTO giữa API và client"
];

function calculateStats(samples) {
  if (samples.length === 0) return {};
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance = sorted.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const stddev = Math.sqrt(variance);

  const p50 = sorted[Math.floor(n * 0.50)];
  const p90 = sorted[Math.floor(n * 0.90)];
  const p95 = sorted[Math.floor(n * 0.95)];
  const p99 = sorted[Math.min(n - 1, Math.floor(n * 0.99))];

  return {
    count: n,
    min: sorted[0],
    p50,
    p90,
    p95,
    p99,
    max: sorted[n - 1],
    mean,
    stddev,
    qps: (1000 / mean).toFixed(1)
  };
}

function formatRow(label, stats) {
  return `| ${label.padEnd(26)} | ${stats.count.toString().padStart(6)} | ${stats.min.toFixed(2).padStart(7)} ms | ${stats.mean.toFixed(2).padStart(7)} ms | ${stats.p50.toFixed(2).padStart(7)} ms | ${stats.p95.toFixed(2).padStart(7)} ms | ${stats.max.toFixed(2).padStart(7)} ms | ${stats.qps.padStart(9)} |`;
}

async function runBenchmark() {
  console.log('\n================================================================================');
  console.log('  🏁 COMPREHENSIVE PERFORMANCE BENCHMARK: PostgreSQL vs AME COGNITIVE ENGINE');
  console.log(`  Queries: ${BENCHMARK_QUERIES.length} | Iterations/query: ${ITERATIONS} | Top-K: ${TOP_K}`);
  console.log('================================================================================\n');

  // Check AME Availability
  const ameStatus = await storageAme.isAmeAvailable();
  console.log(`⚡ AME Status: ${ameStatus.available ? `ONLINE (${ameStatus.mode})` : 'OFFLINE'}`);
  const dbPath = storageAme.resolveProjectDb();
  console.log(`📁 AME Container: ${dbPath}`);

  // Warmup Phase
  console.log('\n🔥 Warming up connection pool, caches and indexes...');
  try {
    await pool.query('SELECT 1');
    await pool.query('SELECT count(*) FROM agent_qa_cache');
  } catch (e) {
    console.error('❌ PostgreSQL connection error:', e.message);
    process.exit(1);
  }

  // Pre-generate embeddings for Pure Query Benchmark
  console.log('⏳ Pre-computing BGE-M3 vector embeddings for test queries...');
  const queryVectors = [];
  for (const q of BENCHMARK_QUERIES) {
    const vec = await embed(q);
    queryVectors.push({ query: q, vec, vecJson: JSON.stringify(vec) });
  }
  console.log('✅ All query embeddings generated and cached.\n');

  // --------------------------------------------------------------------------
  // BENCHMARK 1: PURE DATABASE QUERY TIME (Isolating Engine Retrieval Latency)
  // --------------------------------------------------------------------------
  console.log('--------------------------------------------------------------------------------');
  console.log('  TEST 1: Pure Storage Engine Latency (Vector similarity + Index search)');
  console.log('--------------------------------------------------------------------------------');

  const pgPureSamples = [];
  const ameIpcPureSamples = [];
  const ameCliPureSamples = [];

  const cliPath = storageAme.resolveCliPath();

  process.stdout.write('  -> Benchmarking PostgreSQL (Pure SQL Execution)...');
  const qq = qaRankingQuery({ limit: TOP_K, minSimilarity: 0.1, withTags: false });
  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (const item of queryVectors) {
      const t0 = performance.now();
      await pool.query(qq.text, [item.vecJson, item.query, TOP_K]);
      const t1 = performance.now();
      pgPureSamples.push(t1 - t0);
    }
  }
  console.log(` Done (${pgPureSamples.length} runs).`);

  if (ameStatus.mode === 'ipc') {
    process.stdout.write('  -> Benchmarking AME via Named Pipe IPC (query_fused)...');
    for (let iter = 0; iter < ITERATIONS; iter++) {
      for (const item of queryVectors) {
        const t0 = performance.now();
        await storageAme.queryContext(item.query, { limit: TOP_K, minSimilarity: 0.1 });
        const t1 = performance.now();
        ameIpcPureSamples.push(t1 - t0);
      }
    }
    console.log(` Done (${ameIpcPureSamples.length} runs).`);
  }

  if (cliPath) {
    process.stdout.write('  -> Benchmarking AME via CLI Process Spawning (1 run per query)...');
    for (const item of queryVectors) {
      const t0 = performance.now();
      execFileSync(cliPath, ['query', dbPath, item.query, '--top', TOP_K.toString(), '--json'], { encoding: 'utf-8', timeout: 5000 });
      const t1 = performance.now();
      ameCliPureSamples.push(t1 - t0);
    }
    console.log(` Done (${ameCliPureSamples.length} runs).`);
  }

  // --------------------------------------------------------------------------
  // BENCHMARK 2: END-TO-END AGENT QUERY TIME (Text -> Embed -> Search -> Response)
  // --------------------------------------------------------------------------
  console.log('\n--------------------------------------------------------------------------------');
  console.log('  TEST 2: End-to-End Agent Retrieval (Raw String -> Embed -> Rank -> Top-K)');
  console.log('--------------------------------------------------------------------------------');

  const pgE2ESamples = [];
  const ameIpcE2ESamples = [];

  process.stdout.write('  -> Benchmarking PostgreSQL Full Pipeline (Embed + SQL)...');
  // 2 runs per query to be mindful of ONNX CPU load
  const e2eIterations = 3;
  for (let iter = 0; iter < e2eIterations; iter++) {
    for (const q of BENCHMARK_QUERIES) {
      const t0 = performance.now();
      const vec = await embed(q);
      await pool.query(qq.text, [JSON.stringify(vec), q, TOP_K]);
      const t1 = performance.now();
      pgE2ESamples.push(t1 - t0);
    }
  }
  console.log(` Done (${pgE2ESamples.length} runs).`);

  if (ameStatus.mode === 'ipc') {
    process.stdout.write('  -> Benchmarking AME Full Pipeline (Zero-Copy SIMD IPC)...');
    for (let iter = 0; iter < e2eIterations; iter++) {
      for (const q of BENCHMARK_QUERIES) {
        const t0 = performance.now();
        await storageAme.queryContext(q, { limit: TOP_K, minSimilarity: 0.1 });
        const t1 = performance.now();
        ameIpcE2ESamples.push(t1 - t0);
      }
    }
    console.log(` Done (${ameIpcE2ESamples.length} runs).`);
  }

  // --------------------------------------------------------------------------
  // SUMMARY REPORT
  // --------------------------------------------------------------------------
  const statsPgPure = calculateStats(pgPureSamples);
  const statsAmeIpcPure = calculateStats(ameIpcPureSamples);
  const statsAmeCliPure = calculateStats(ameCliPureSamples);
  const statsPgE2E = calculateStats(pgE2ESamples);
  const statsAmeIpcE2E = calculateStats(ameIpcE2ESamples);

  console.log('\n\n================================================================================');
  console.log('  📊 BENCHMARK RESULTS MATRIX');
  console.log('================================================================================\n');

  console.log('### 1. Pure Storage Engine Retrieval Latency (Pre-embedded)');
  console.log('| Engine / Transport         | Samples|     Min   |    Mean   |    P50    |    P95    |    Max    |   Throughput|');
  console.log('| :------------------------- | :----: | :-------: | :-------: | :-------: | :-------: | :-------: | :---------: |');
  console.log(formatRow('PostgreSQL (pgvector)', statsPgPure));
  if (ameIpcPureSamples.length > 0) {
    console.log(formatRow('AME (Named Pipe IPC)', statsAmeIpcPure));
  }
  if (ameCliPureSamples.length > 0) {
    console.log(formatRow('AME (CLI Process Spawn)', statsAmeCliPure));
  }

  console.log('\n### 2. End-to-End Agent Retrieval Latency (Raw Text -> Result)');
  console.log('| Engine / Transport         | Samples|     Min   |    Mean   |    P50    |    P95    |    Max    |   Throughput|');
  console.log('| :------------------------- | :----: | :-------: | :-------: | :-------: | :-------: | :-------: | :---------: |');
  console.log(formatRow('PostgreSQL + BGE-M3 (Full)', statsPgE2E));
  if (ameIpcE2ESamples.length > 0) {
    console.log(formatRow('AME Native IPC (Full)', statsAmeIpcE2E));
  }

  console.log('\n### 3. Acceleration Factor & Speedup Ratio');
  if (statsAmeIpcPure.mean > 0) {
    const pureSpeedup = (statsPgPure.mean / statsAmeIpcPure.mean).toFixed(1);
    console.log(`  🚀 Pure Query Latency Speedup:       AME is ${pureSpeedup}x FASTER than PostgreSQL`);
  }
  if (statsAmeIpcE2E.mean > 0) {
    const e2eSpeedup = (statsPgE2E.mean / statsAmeIpcE2E.mean).toFixed(1);
    console.log(`  🚀 End-to-End Pipeline Speedup:     AME is ${e2eSpeedup}x FASTER than PostgreSQL`);
  }
  console.log('================================================================================\n');

  try {
    await pool.end();
  } catch {}
}

runBenchmark().catch(err => {
  console.error('[FATAL BENCHMARK ERROR]', err);
  process.exit(1);
});
