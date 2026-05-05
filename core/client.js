/**
 * client.js - Hybrid Client: thử gọi warm server trước, fallback direct execution
 * 
 * Dùng bởi CLI scripts để tự động chọn fast path nếu server đang chạy.
 */
const http = require('http');
const config = require('./config');

const PORT = parseInt(process.env.SEMANTIC_PORT || '3457');
const TIMEOUT = 500; // ms — nếu server không respond trong 500ms thì fallback

/**
 * Gọi server endpoint, trả về JSON nếu thành công, null nếu server offline
 */
function callServer(path, method = 'GET', body = null, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const opts = {
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method,
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Gọi server và đọc luồng stream (Server-Sent Events) dành cho AI sinh chữ
 */
function streamServer(path, onToken) {
  return new Promise((resolve) => {
    http.get({ hostname: '127.0.0.1', port: PORT, path, timeout: 60000 }, (res) => {
      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk.toString();
        let lines = buffer.split('\n');
        buffer = lines.pop(); // Giữ lại dòng chưa hoàn chỉnh
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.replace('data: ', '').trim();
            if (payload === '[DONE]') break;
            try {
              const parsed = JSON.parse(payload);
              if (parsed.token) onToken(parsed.token);
              if (parsed.full_answer) {
                resolve({ 
                  status: parsed.status, 
                  text: parsed.full_answer, 
                  source: parsed.source, 
                  topScore: parsed.topScore,
                  question: parsed.question
                });
              }
            } catch (e) {}
          }
        }
      });
      res.on('end', () => resolve(null));
    }).on('error', () => resolve(null)).on('timeout', function() { this.destroy(); resolve(null); });
  });
}

/**
 * Check server health
 */
async function isServerUp() {
  const r = await callServer('/health', 'GET', null, 500);
  return r && r.status === 'ok';
}

module.exports = { callServer, streamServer, isServerUp, PORT };
