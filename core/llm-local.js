/**
 * llm-local.js - Module kết nối Local LLM (Ollama) cho hệ thống Semantic
 * 
 * Hỗ trợ: Ollama (localhost:11434) + fallback Gemini/Anthropic API
 * Model mặc định: qwen2.5:0.5b (397MB, chạy CPU)
 */

const config = require('./config');

const OLLAMA_URL = config.ollama.url;
const DEFAULT_MODEL = config.ollama.model;

/**
 * Gọi Local LLM (Ollama) để suy luận
 * @param {string} prompt - Câu hỏi/prompt
 * @param {object} opts - { model, system, maxTokens }
 * @returns {Promise<string>} - Câu trả lời text
 */
async function askLocal(prompt, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const system = opts.system || '';

  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        system,
        stream: false,
        options: {
          num_predict: opts.maxTokens || 512,
          temperature: 0.3,
        }
      })
    });

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    const text = data.response?.trim() || '';
    return { text, source: `ollama/${model}` };
  } catch (err) {
    return askCloud(prompt, system);
  }
}

/**
 * Stream Local LLM (Ollama)
 */
async function askLocalStream(prompt, opts, onToken) {
  const model = opts.model || DEFAULT_MODEL;
  const system = opts.system || '';
  
  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        system,
        stream: true,
        options: {
          num_predict: opts.maxTokens || 512,
          temperature: 0.3,
        }
      })
    });

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    
    let fullText = '';
    // Native Node fetch streaming
    for await (const chunk of res.body) {
      const texts = new TextDecoder().decode(chunk).split('\n').filter(x => x.trim());
      for (const t of texts) {
        try {
          const json = JSON.parse(t);
          if (json.response) {
            fullText += json.response;
            if (onToken) onToken(json.response);
          }
        } catch(e) {}
      }
    }
    return { text: fullText.trim(), source: `ollama/${model}` };
  } catch (err) {
    // Cloud fallback won't stream properly in this simple implementation, so we mock it
    const fallback = await askCloud(prompt, system);
    if (onToken) {
      // Fake small chunks
      const words = fallback.text.split(' ');
      for (const w of words) {
        onToken(w + ' ');
        await new Promise(r => setTimeout(r, 10)); // tiny delay
      }
    }
    return fallback;
  }
}

/**
 * Fallback: Gọi Gemini/Anthropic nếu Ollama offline
 */
async function askCloud(prompt, system) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (geminiKey) {
    console.error('[LLM] Using Gemini (cloud fallback)');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
    const body = { contents: [{ parts: [{ text: prompt }] }] };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return { text: data.candidates[0].content.parts[0].text.trim(), source: 'gemini' };
  }

  if (anthropicKey) {
    console.error('[LLM] Using Anthropic (cloud fallback)');
    const url = 'https://api.anthropic.com/v1/messages';
    const body = { model: 'claude-3-opus-20240229', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] };
    if (system) body.system = system;
    const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return { text: data.content[0].text.trim(), source: 'anthropic' };
  }

  throw new Error('No LLM available (Ollama offline + no API keys)');
}

/**
 * Tọa độ tập trung gọi LLM (tự động fallback)
 */
async function askLLM(prompt, opts = {}) {
  try {
    return await askLocal(prompt, opts);
  } catch (err) {
    if (err.message.includes('No LLM available')) throw err;
    console.error(`[LLM] Local failed (${err.message}). Falling back to Cloud...`);
    return await askCloud(prompt, opts.system);
  }
}

/**
 * Hàm lõi để hỗ trợ Deep Reasoning (Chain-of-Thought)
 * Khóa model vào luồng tư duy chậm (Slow Thinking) rồi mới lấy output.
 */
async function askWithReasoning(prompt, opts = {}) {
  const reasonSystem = `Khởi động luồng tư duy chậm (Deep Reasoning).
Bạn PHẢI phân tích yêu cầu step-by-step và bọc nguyên bộ logic đó bên trong thẻ XML <thought_process> ... </thought_process> TRƯỚC KHI sinh ra kết quả cuối cùng.`;

  const finalSystem = opts.system ? `${opts.system}\n\n${reasonSystem}` : reasonSystem;
  
  if (opts.jsonSchema) {
    prompt += `\n\n[WARNING] Output cuối cùng (bên ngoài thought_process) CHỈ ĐƯỢC PHÉP CHỨA JSON, không bọc markdown.`;
  }

  const llmResult = await askLLM(prompt, { ...opts, system: finalSystem });
  const rawText = llmResult.text;
  const llmSource = llmResult.source;

  // Tách reasoning block
  const thoughtMatch = rawText.match(/<thought[_\-]?process>([\s\S]*?)<\/thought[_\-]?process>/i);
  let reasoning = thoughtMatch ? thoughtMatch[1].trim() : '';

  let resultText = rawText.replace(/<thought[_\-]?process>[\s\S]*?<\/thought[_\-]?process>/gi, '').trim();

  if (opts.jsonSchema) {
    resultText = resultText.replace(/```json/gi, '').replace(/```/g, '').trim();
  }

  return { reasoning, result: resultText, source: llmSource };
}

module.exports = { askLLM, askWithReasoning, askLocal, askLocalStream, askCloud, DEFAULT_MODEL };
