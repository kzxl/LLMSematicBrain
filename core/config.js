/**
 * config.js - Centralized config loader (dotenv)
 *
 * Load .env từ thư mục gốc project (process.cwd() hoặc cùng cấp server.js).
 * Ưu tiên: .env tại cwd → .env tại __dirname/../
 */
const path = require('path');
const fs = require('fs');

// Tìm .env file: ưu tiên cwd (nơi chạy node), fallback về thư mục project
const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '..', '.env'),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    break;
  }
}

const config = {
  db: {
    host: process.env.SEMANTIC_DB_HOST || 'localhost',
    port: parseInt(process.env.SEMANTIC_DB_PORT || '5432'),
    database: process.env.SEMANTIC_DB_NAME || 'agent_registry',
    user: process.env.SEMANTIC_DB_USER || 'postgres',
    password: process.env.SEMANTIC_DB_PASS || '',
    max: 3,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
  },
  ollama: {
    url: process.env.OLLAMA_URL || 'http://localhost:11434/api/generate',
    model: process.env.OLLAMA_MODEL || 'qwen2.5:0.5b',
  },
  embedding: {
    model: process.env.EMBEDDING_MODEL || 'Xenova/bge-m3',
    dims: parseInt(process.env.EMBEDDING_DIMS || '1024'),
  },
  domain: {
    name: process.env.DOMAIN_NAME || 'My Project',
    description: process.env.DOMAIN_DESCRIPTION || 'chuyên gia hệ thống phần mềm',
  },
  backend: process.env.MEMORY_BACKEND || 'auto', // 'ame' | 'postgres' | 'auto'
  ame: {
    pipeName: process.env.AME_PIPE || 'ame_pipe',
    defaultDb: process.env.AME_DB_PATH || path.join(__dirname, '..', 'data', 'semantic_brain.ame'),
    cliPath: process.env.AME_CLI_PATH || 'E:\\15. Other\\AgentMemoryEngine\\dist\\lite\\AgentMemoryEngine.Cli.exe',
  },
  agentRoot: process.env.AGENT_ROOT || '',
};

module.exports = config;
