/**
 * openai-proxy.js - Standalone OpenAI API Wrapper for Local LLM
 * 
 * Bọc Local LLM (VD: Ollama) qua giao thức OpenAI API tương thích.
 * Tính năng:
 * 1. Tiêm RAG: Tự động chặn tin nhắn, truy vấn SemanticBrain lấy RAG context nhúng vào prompt.
 * 2. Auto-Harvest: Bắt luồng kết quả từ LLM, lọc tạp âm và tự động học/lưu tri thức mới.
 * 
 * Start: node openai-proxy.js
 * Default Port: 3458
 */
const http = require('http');
const https = require('https');
const url = require('url');
const config = require('./core/config');
const client = require('./core/client');

const PROXY_PORT = parseInt(process.env.PROXY_PORT || '3458');
const OLLAMA_HOST = new url.URL(config.ollama.url).origin; // e.g., http://localhost:11434

// Đọc nguyên JSON body của request
async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
    });
    req.on('error', reject);
  });
}

// Hàm tự động học: Lọc tạp âm và lưu kiến thức kỹ thuật
function evaluateAndSave(question, answer) {
  if (!question || !answer) return;
  
  const qTrim = question.trim();
  const aTrim = answer.trim();
  
  // 1. Heuristic độ dài: Câu hỏi quá ngắn (<15) hoặc trả lời quá ngắn (<80) thì bỏ qua
  if (qTrim.length < 15 || aTrim.length < 80) return; 

  const qLower = qTrim.toLowerCase();
  
  // 2. Chống tạp nham: Bỏ qua các câu chào hỏi, dịch thuật, viết lại câu, tóm tắt
  const junkPatterns = /^(chào|hi |hello|cảm ơn|thanks|tóm tắt|dịch|translate|viết lại|sửa lỗi chính tả|kiểm tra chính tả|bạn là ai|cho tôi hỏi)/i;
  if (junkPatterns.test(qLower) && qTrim.length < 50) return;
  
  if (qLower.includes('viết email') || qLower.includes('viết truyện')) return;

  // 3. Tiêu chí lấy: Phải có code HOẶC câu hỏi mang tính chất kỹ thuật/giải quyết vấn đề
  const hasCode = aTrim.includes('```');
  const isTechQuestion = /(làm sao|how to|lỗi|error|fix|hướng dẫn|tại sao|nguyên nhân|kiến trúc|architecture|code|bug|thuật toán|algorithm)/i.test(qLower);
  
  if (hasCode || isTechQuestion) {
    console.log(`\n[PROXY: Auto-Harvest] Ghi nhận tri thức mới: "${qTrim.substring(0, 40).replace(/\n/g, ' ')}..."`);
    
    const { spawn } = require('child_process');
    const path = require('path');
    
    // Gọi script save-qa ngầm, không block proxy
    const child = spawn('node', [
      path.join(__dirname, 'tools', 'save-qa.js'),
      qTrim,
      aTrim,
      '--source=proxy-auto',
      '--confidence=0.5', // Confidence 0.5 (cần con người hoặc cronjob duyệt lại)
      '--tags=auto-harvest'
    ], {
      detached: true,
      stdio: 'ignore' // Bỏ qua output để tránh rác console
    });
    child.unref();
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  
  // Healthcheck endpoint
  if (req.method === 'GET' && parsedUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ 
      status: 'ok', 
      service: 'semantic-openai-proxy',
      backend_llm: OLLAMA_HOST,
      rag_server_port: client.PORT,
      auto_harvest: true
    }));
  }

  // Intercept completion requests
  if (req.method === 'POST' && (parsedUrl.pathname === '/v1/chat/completions' || parsedUrl.pathname === '/api/chat/completions')) {
    try {
      const body = await readBody(req);
      if (!body || !body.messages) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Invalid request body or missing messages array.' }));
      }

      // 1. Tìm tin nhắn user cuối cùng
      let lastUserMsg = null;
      for (let i = body.messages.length - 1; i >= 0; i--) {
        if (body.messages[i].role === 'user') {
          lastUserMsg = typeof body.messages[i].content === 'string' 
                        ? body.messages[i].content 
                        : null;
          break;
        }
      }

      // 2. Truy vấn RAG (Read)
      if (lastUserMsg) {
        const isUp = await client.isServerUp();
        if (isUp) {
          const ragRes = await client.callServer(`/find-qa?q=${encodeURIComponent(lastUserMsg)}&mode=raw`, 'GET', null, 5000);
          
          if (ragRes && ragRes.status === 'HIT' && ragRes.score >= 45) {
            const contextText = `=== KIẾN THỨC BỔ SUNG TỪ HỆ THỐNG ===\nReference Question: ${ragRes.question}\nReference Context:\n${ragRes.answer}\n\n[HƯỚNG DẪN LLM] Vui lòng sử dụng kiến thức này (nếu có liên quan) để hỗ trợ phản hồi. Nếu không liên quan, hãy bỏ qua nó.`;
            
            let systemInjected = false;
            for (let i = 0; i < body.messages.length; i++) {
              if (body.messages[i].role === 'system') {
                body.messages[i].content += `\n\n${contextText}`;
                systemInjected = true;
                break;
              }
            }
            if (!systemInjected) {
              body.messages.unshift({ role: 'system', content: contextText });
            }
            
            console.log(`[PROXY] RAG Augmented (Score: ${ragRes.score}): "${lastUserMsg.substring(0, 40).replace(/\n/g, ' ')}..."`);
          }
        }
      }

      // 2.5 Tiêm "Khuôn Kỷ Luật Agent" (Agent Reinforcement Prompt)
      // Kỹ thuật này lợi dụng Recency Effect (nhớ điều cuối cùng) để ép model 3B không nói nhảm.
      const agentMold = `\n\n=== CRITICAL AGENT INSTRUCTIONS ===
You are executing as an autonomous software agent. 
1. NO CONVERSATIONAL FILLER. Never say "Here is...", "Sure", "I will do...", "Let me help".
2. OUTPUT STRICTLY the requested format. If the system prompt asks for JSON or XML, output ONLY valid JSON/XML.
3. DO NOT wrap JSON in markdown \`\`\`json blocks UNLESS the system prompt explicitly requires it.
4. Do NOT explain your code unless requested. Act like a raw API endpoint.`;

      let systemInjectedAgent = false;
      for (let i = 0; i < body.messages.length; i++) {
        if (body.messages[i].role === 'system') {
          // Bơm luật vào cuối system prompt để model chú ý nhất
          body.messages[i].content += agentMold;
          systemInjectedAgent = true;
          break;
        }
      }
      if (!systemInjectedAgent) {
        body.messages.unshift({ role: 'system', content: agentMold });
      }

      // 3. Chuyển tiếp tới LLM
      const targetUrl = new url.URL(req.url, OLLAMA_HOST);
      const isHttps = targetUrl.protocol === 'https:';
      const requestModule = isHttps ? https : http;

      const proxyOptions = {
        hostname: targetUrl.hostname,
        port: targetUrl.port,
        path: targetUrl.pathname + targetUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': req.headers['authorization'] || '',
        }
      };

      const proxyReq = requestModule.request(proxyOptions, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        
        let responseChunks = [];
        
        // Vừa stream dữ liệu về cho user ngay lập tức, vừa gom buffer lại để học
        proxyRes.on('data', chunk => {
          res.write(chunk);
          responseChunks.push(chunk);
        });
        
        // Khi stream kết thúc, phân tích để auto-harvest
        proxyRes.on('end', () => {
          res.end();
          
          if (lastUserMsg && proxyRes.statusCode === 200) {
            try {
              const fullBody = Buffer.concat(responseChunks).toString('utf8');
              let finalAnswer = '';
              
              if (fullBody.includes('data: ')) {
                 // Xử lý luồng SSE (Server-Sent Events)
                 const lines = fullBody.split('\n');
                 for (const line of lines) {
                   if (line.startsWith('data: ') && line.trim() !== 'data: [DONE]') {
                     try {
                       const data = JSON.parse(line.substring(6));
                       if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
                         finalAnswer += data.choices[0].delta.content;
                       }
                     } catch(e) {} // Bỏ qua chunk lỗi JSON
                   }
                 }
              } else {
                 // Xử lý Non-stream JSON
                 const data = JSON.parse(fullBody);
                 if (data.choices && data.choices[0].message && data.choices[0].message.content) {
                   finalAnswer = data.choices[0].message.content;
                 }
              }
              
              // Chạy bộ lọc và lưu (nếu đạt chuẩn)
              evaluateAndSave(lastUserMsg, finalAnswer);
            } catch(e) {
              // Ignore lỗi parse auto-harvest để không ảnh hưởng proxy
            }
          }
        });
      });

      proxyReq.on('error', (err) => {
        console.error('[PROXY] LLM Connection Error:', err.message);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'LLM Backend is unreachable: ' + err.message }));
        }
      });

      proxyReq.write(JSON.stringify(body));
      proxyReq.end();
      
    } catch (err) {
      console.error('[PROXY] Internal Error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    }
    return;
  }
  
  // =========================================================
  // Pass-through mọi route khác (VD: /v1/models)
  // =========================================================
  const targetUrl = new url.URL(req.url, OLLAMA_HOST);
  const isHttps = targetUrl.protocol === 'https:';
  const requestModule = isHttps ? https : http;

  const proxyOptions = {
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: { ...req.headers }
  };
  delete proxyOptions.headers.host;

  const proxyReq = requestModule.request(proxyOptions, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[PROXY] Direct Forward Error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Gateway Error' }));
    }
  });

  req.pipe(proxyReq);
});

server.listen(PROXY_PORT, () => {
  console.log(`[+] SemanticBrain OpenAI Proxy running on port ${PROXY_PORT}`);
  console.log(`    Local LLM backend: ${OLLAMA_HOST}`);
  console.log(`    RAG Engine target: http://127.0.0.1:${client.PORT}`);
  console.log(`    Auto-Harvest:      ENABLED (Filtering junk/chitchat)`);
  console.log(`\n=> Cấu hình app của bạn tới: http://localhost:${PROXY_PORT}/v1`);
});
