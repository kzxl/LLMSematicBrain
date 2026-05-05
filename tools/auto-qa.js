/**
 * auto-qa.js
 * Sử dụng Gemini (với API Key từ ENV) để tự suy luận Trả lời (Answer Context) 
 * cho Question bị missing và gọi save-qa.js lưu lại DB.
 */
const { execFileSync } = require('child_process');
const { askWithReasoning } = require('../core');
const path = require('path');

async function autoQA(question) {

    const prompt = `You are a strict technical database semantic proxy. The user has a system-related question or wants an explanation: "${question}".
Please provide a detailed, accurate, and concise reasoning context or explanation. Focus purely on technical details, system constraints, or logic without conversational filler.`;

    let answerText = '';

    try {
        console.log(`[QA AUTO-REASON] Đang suy luận Answer cho "${question}"...`);
        const response = await askWithReasoning(prompt);
        answerText = response.result;
        
        // Use save-qa.js to store it — safe argument passing (no shell injection)
        console.log(`[QA AUTO-REASON] Đã sinh xong Answer [via: ${response.source}]. Tiến hành lưu...`);
        const savePath = path.join(__dirname, 'save-qa.js');
        execFileSync('node', [savePath, question, answerText, `--source=auto-qa:${response.source}`], { encoding: 'utf-8' });
    } catch (e) {
        console.error('[ERROR] Failed to save reasoned QA.', e.message);
        process.exit(1);
    }
}

autoQA(process.argv[2]);
