# Semantic Brain

Local RAG knowledge base với Vector Search — chạy hoàn toàn offline, không gọi API bên ngoài (trừ Ollama LLM fallback).

## Stack

| Thành phần | Công nghệ |
|---|---|
| Embedding | `@xenova/transformers` + BGE-M3 (1024d, ~570MB, local) |
| Vector DB | PostgreSQL + pgvector |
| LLM | Ollama (local) → Gemini/Anthropic (cloud fallback) |
| Search | Hybrid RRF (cosine + FTS) |

## Cài đặt

```bash
git clone <repo>
cd SemanticBrain
npm install
cp .env.example .env
# Điền config vào .env
npm start
```

## Cấu hình `.env`

```env
SEMANTIC_DB_HOST=localhost
SEMANTIC_DB_PORT=5432
SEMANTIC_DB_NAME=agent_registry
SEMANTIC_DB_USER=postgres
SEMANTIC_DB_PASS=

OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=qwen2.5-coder:3b

DOMAIN_NAME=My Project
DOMAIN_DESCRIPTION=chuyên gia hệ thống phần mềm

AGENT_ROOT=                    # Path gốc chứa skills/workflows (cho find-skill)
SEMANTIC_PORT=3457
```

## Dùng chung 1 server cho nhiều project (Multi-tenant)

Thêm `--project=<tên>` vào mọi lệnh — hệ thống tự inject tag `project:xxx` để phân biệt nguồn dữ liệu:

```bash
# ERP Project
node tools/find-qa.js "câu hỏi" --project=erp --tags=ua,inventory
node tools/save-qa.js "Q" "A" --project=erp --tags=inventory
node tools/post-task.js "bài học task" --project=erp --tags=inventory,ua

# HelpDesk Project  
node tools/find-qa.js "câu hỏi" --project=helpdesk --tags=backend
node tools/save-qa.js "Q" "A" --project=helpdesk --tags=backend,mongodb
node tools/post-task.js "bài học task" --project=helpdesk --tags=backend,refactor
```

Nếu không truyền `--project`, query sẽ search toàn bộ DB (cross-project).

## CLI Tools

```bash
npm run start                  # Khởi server warm (port 3457)
npm run dev                    # Server với auto-reload
npm run proxy                  # Chạy OpenAI Proxy có Auto-Harvest RAG (port 3458)

node tools/find-qa.js "<Q>" [--project=erp] [--tags=ua] [--raw]
node tools/find-qa-context.js "<task>" [--project=erp] [--tags=ua] [--limit=8]
node tools/find-qa-deep.js "<Q>" [--tags=ua]
node tools/find-skill.js "<intent>"
node tools/save-qa.js "<Q>" "<A>" [--project=erp] [--tags=a,b] [--source=manual]
node tools/post-task.js "<summary>" [--project=erp] --tags=ua,inventory
node tools/stats.js
node tools/qa-health.js
node tools/dashboard.js
```

## OpenAI Proxy (Auto-Harvest & RAG Injector)

`openai-proxy.js` là một máy chủ giả lập chuẩn OpenAI API (`/v1/chat/completions`) bọc quanh Local LLM (VD: Ollama). 
Nó có 2 tính năng chính để biến các mô hình nhỏ (như `qwen2.5:3b`) trở nên thông minh:
1. **RAG Injection:** Tự động bắt câu hỏi, tra cứu DB (qua port 3457) và nhúng tri thức vào Prompt.
2. **Auto-Harvest:** Bắt luồng stream trả về, tự động lọc tạp âm và lưu các câu trả lời chứa kiến thức/kỹ thuật vào DB.
3. **Agent Reinforcement:** Tự động tiêm các luật cực kỳ khắt khe vào System Prompt (Khuôn Agent) để chống bệnh nói lảm nhảm của các model size nhỏ.

Chỉ cần chạy `npm run proxy` và trỏ Editor (Cursor, Continue) tới `http://localhost:3458/v1`.

## HTTP API (khi server đang chạy)

```
GET  /health
GET  /find-qa?q=<query>&tags=<t1,t2>&project=erp&mode=smart|raw
GET  /find-recipe?q=<intent>
GET  /find-skill?q=<intent>&top=3
GET  /find-tags?tags=<t1,t2>&mode=or|and
GET  /find-qa-deep?q=<query>&depth=3
POST /save-qa   { question, answer, tags, project }
POST /mark-recipe { id, success }
POST /shutdown
```

## Setup DB Schema

```bash
node maintenance/setup.js
```

## Thêm Project Mới

1. Deploy server này lên host (1 lần duy nhất)
2. Trong project mới, gọi tools với `--project=<ten_project>`
3. Không cần cài thêm gì — toàn bộ data lưu cùng 1 PostgreSQL, phân biệt bằng tags

## Tích hợp vào Agent Rules (ví dụ ERP)

Thay đổi trong `.agent` global rules:
```
node E:\Tools\SemanticBrain\tools\find-qa-context.js "<mô tả task>" --tags=<domain> --project=erp
node E:\Tools\SemanticBrain\tools\post-task.js "<bài học>" --tags=<domain>,<type> --project=erp
```
