# 🧠 OllamaLens

> **A local, offline AI assistant & benchmarking platform for Small Language Models.**  
> Zero cloud. Zero API cost. Runs entirely on your own GPU.

---

## Table of Contents

1. [What is OllamaLens?](#what-is-ollamalens)
2. [Why This Project?](#why-this-project)
3. [Architecture Overview](#architecture-overview)
4. [Hardware Constraints & Design Decisions](#hardware-constraints--design-decisions)
5. [Tech Stack — Every Tool Explained](#tech-stack--every-tool-explained)
6. [Project Structure](#project-structure)
7. [API Endpoints](#api-endpoints)
8. [Key Engineering Concepts](#key-engineering-concepts)
   - [Async I/O with FastAPI](#async-io-with-fastapi)
   - [SSE Streaming](#sse-streaming)
   - [Pydantic Validation](#pydantic-validation)
   - [Retry with Tenacity](#retry-with-tenacity)
   - [Structured JSON Output](#structured-json-output)
   - [Benchmark Metrics](#benchmark-metrics)
9. [Model Comparison Study](#model-comparison-study)
10. [How to Run](#how-to-run)

---

## What is OllamaLens?

OllamaLens is a full-stack application that lets you:

- **Chat** with local LLMs (Llama 3, Mistral 7B, Phi-3) through a streaming web interface
- **Benchmark** inference performance — measuring Time To First Token (TTFT) and Tokens Per Second (TPS)
- **Compare** multiple models on the same prompt side-by-side
- **Force structured JSON output** from the LLM, validated with Pydantic
- **Generate a technical report** from all benchmarking data, stored in SQLite

Everything runs on your own machine. No internet connection needed after setup.

---

## Why This Project?

This project demonstrates real-world engineering skills that matter in AI/ML roles:

| Skill | How It's Demonstrated |
|---|---|
| LLM integration | Ollama REST API, streaming, model switching |
| API design | FastAPI with typed routes, status codes, error handling |
| Async programming | Non-blocking I/O for concurrent benchmark runs |
| Data validation | Pydantic v2 schemas on every request/response boundary |
| Reliability patterns | Tenacity retry with exponential back-off |
| Database design | SQLModel + SQLite, async sessions, clean ORM usage |
| Performance measurement | Wall-clock TTFT & TPS, statistically valid N-run averages |
| Documentation | Comprehensive inline comments explaining every decision |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   BROWSER (localhost)               │
│  React + Vite + Tailwind + Recharts                 │
│  Chat UI · Benchmark Dashboard · Report View        │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP + SSE (Server-Sent Events)
┌──────────────────────▼──────────────────────────────┐
│           FastAPI Backend  (Python 3.11+)           │
│                                                     │
│  /chat/generate     → streams tokens via SSE        │
│  /chat/structured   → JSON-mode + Pydantic validate │
│  /benchmark/run     → timed N-run inference suite   │
│  /compare/run       → multi-model side-by-side      │
│  /report            → aggregated technical report   │
│                                                     │
│  Pydantic v2:  validates every request/response     │
│  Tenacity:     retries on timeout or bad JSON       │
│  SQLModel:     async ORM for SQLite                 │
└──────────────────────┬──────────────────────────────┘
                       │ REST API (localhost:11434)
┌──────────────────────▼──────────────────────────────┐
│                    Ollama                           │
│  llama3:8b-instruct-q4_K_M   (~4.7 GB VRAM)        │
│  mistral:7b-instruct-q4_K_M  (~4.1 GB VRAM)        │
│  phi3:mini                   (~2.3 GB VRAM)         │
└─────────────────────────────────────────────────────┘
       SQLite file: ollamalens.db  (zero infra cost)
```

**Data flow for a chat request:**

1. User types a prompt in the React UI
2. Frontend sends `POST /chat/generate` with `stream: true`
3. FastAPI calls `OllamaClient.generate_stream()`
4. Ollama processes the prompt on the GPU, emitting one JSON chunk per token
5. FastAPI wraps each chunk in SSE format (`data: {...}\n\n`) and streams it
6. Browser's `EventSource` API fires an event per token, UI updates in real-time
7. Final chunk carries `done: true` with timing metadata

---

## Hardware Constraints & Design Decisions

**Hardware: Intel i5 9th Gen · 32 GB RAM · GTX 1660 Ti (6 GB VRAM)**

Every technical decision traces back to these constraints:

### VRAM is the binding constraint (6 GB)
- Only **one model can be loaded at a time** on the GPU
- We use **q4_K_M quantization** (4-bit, K-quant medium) for all models
  - A 7B FP16 model needs ~14 GB — impossible on this GPU
  - q4_K_M reduces it to ~4 GB with only ~2% quality degradation
  - K-quant is higher quality than standard Q4 because it uses different quantization for "important" weights
- Models are unloaded automatically by Ollama after 5 minutes of inactivity

### Why not q3 or q5?
- **q3** (3-bit): too much quality loss for coherent multi-paragraph output
- **q5** (5-bit): ~5.5 GB — no headroom for OS/CUDA runtime overhead
- **q4_K_M** is the established sweet spot for ≤6 GB VRAM

### RAM (32 GB) is generous
- Model weights stream from RAM into VRAM at load time
- 32 GB means all three models can sit in RAM simultaneously; only the active one occupies VRAM
- Cold-start (RAM → VRAM transfer) is typically 3–8 seconds

---

## Tech Stack — Every Tool Explained

### Ollama
**What:** Local LLM runtime that manages model download, CUDA inference, and a REST API.  
**Why not:** llama.cpp directly? Ollama wraps llama.cpp and adds model management, an HTTP server, and automatic GPU detection. We get the same performance with a stable API instead of managing C++ binaries.  
**Why not:** OpenAI API? Costs money, needs internet, and data leaves your machine.

### FastAPI
**What:** Python async web framework.  
**Why not Flask?** Flask is synchronous. Each request blocks a thread. For SSE token streaming, this would require a thread per active stream — wasteful. FastAPI is built on ASGI (Asynchronous Server Gateway Interface), so one thread can handle thousands of concurrent SSE streams.  
**Why not Django?** Django REST Framework adds significant boilerplate. FastAPI has native Pydantic integration and automatic OpenAPI docs at `/docs` with zero configuration.  
**Key feature:** Type hints on route functions are validated automatically. A route expecting `BenchmarkRequest` will reject malformed JSON with a detailed 422 error before your code runs.

### Pydantic v2
**What:** Data validation library using Python type hints.  
**Why:** LLMs are probabilistic — they sometimes return malformed output. Without Pydantic, a missing field in the response causes an `AttributeError` deep in your code with a confusing stack trace. With Pydantic, validation happens at the boundary, the error is descriptive, and your business logic never sees invalid data.  
**In this project:**
- `ChatRequest` validates that the prompt isn't blank and the model name is one of three allowed values
- `BenchmarkRun` is both the Pydantic model and the SQLite table definition (SQLModel)
- `StructuredResponse` ensures the LLM's JSON output matches the user-supplied schema

### httpx
**What:** Async HTTP client (used to call the Ollama REST API).  
**Why not requests?** `requests` is synchronous — calling it inside a FastAPI route blocks the entire event loop. `httpx` has an identical API but supports `async/await`, streaming response bodies, and HTTP/2.  
**Key config:** We separate `connect` timeout (5s) from `read` timeout (120s) because connecting to localhost is instant, but generating 500 tokens on a cold model can take 30+ seconds.

### Tenacity
**What:** Retry library with decorator syntax.  
**Why:** Writing retry logic manually is error-prone:
```python
# Bad: manual retry
for attempt in range(3):
    try:
        result = await call()
        break
    except Exception:
        if attempt == 2:
            raise
        await asyncio.sleep(2 ** attempt)
```
```python
# Good: tenacity
@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=8))
async def call():
    ...
```
Tenacity also logs retry attempts automatically and supports conditional retries (only retry on `ReadTimeout`, not on `404`).

### SQLModel + aiosqlite
**What:** SQLModel = Pydantic + SQLAlchemy ORM in one class. aiosqlite = async SQLite driver.  
**Why SQLite?** This is a local developer tool. PostgreSQL requires a running server process, Docker, or a cloud subscription. SQLite is a single file — perfect for "zero infrastructure cost".  
**Why aiosqlite?** SQLite's standard library is synchronous. Calling it from an async FastAPI route would block the event loop. aiosqlite wraps it in a background thread so writes are non-blocking.  
**Why not Tortoise-ORM or SQLAlchemy alone?** SQLModel unifies the Pydantic schema and the DB table into one class. No risk of the API response schema drifting out of sync with the database columns.

### pydantic-settings
**What:** Reads configuration from environment variables and `.env` files.  
**Why not os.environ directly?** `os.environ["OLLAMA_URL"]` returns a string. If you forget to parse it as a URL, you get a cryptic error later. pydantic-settings applies type coercion and validation at startup — a bad config fails immediately with a clear error message.

### jsonschema
**What:** JSON Schema validator (RFC draft-07).  
**Why:** For `POST /chat/structured`, the user supplies an arbitrary schema at runtime. Pydantic requires a static class definition at compile time — it can't validate against a runtime dict schema. `jsonschema.validate(instance, schema)` works with any dict-format schema.

---

## Project Structure

```
ollamalens/
│
├── backend/
│   ├── main.py                    # FastAPI app factory, CORS, router registration
│   ├── requirements.txt           # All dependencies with explanations
│   │
│   ├── core/
│   │   ├── config.py              # pydantic-settings: all app configuration
│   │   ├── database.py            # SQLite engine, session factory, init_db()
│   │   └── ollama_client.py       # httpx async client, retry, streaming
│   │
│   ├── models/
│   │   └── schemas.py             # ALL Pydantic + SQLModel definitions
│   │
│   ├── routers/
│   │   ├── chat.py                # /chat/* endpoints + SSE streaming
│   │   ├── benchmark.py           # /benchmark/* endpoints
│   │   ├── compare.py             # /compare/* endpoints
│   │   └── report.py              # /report endpoint
│   │
│   └── utils/
│       ├── benchmarker.py         # TTFT + TPS measurement logic
│       ├── structured_output.py   # JSON mode + clean/retry pipeline
│       └── report_generator.py    # Aggregates DB data into report sections
│
├── frontend/                      # React + Vite (separate phase)
│
├── .env.example                   # Copy to .env, edit as needed
└── README.md                      # This file
```

**Design principle: one responsibility per file.**  
`ollama_client.py` only handles HTTP. `benchmarker.py` only handles timing. `schemas.py` only defines data shapes. This makes each file easy to understand, test, and replace.

---

## API Endpoints

All endpoints are documented interactively at `http://localhost:8000/docs` after starting the server.

| Method | Path | What it does |
|---|---|---|
| `GET` | `/health` | Is the backend alive? |
| `GET` | `/chat/models` | List models in Ollama |
| `POST` | `/chat/generate` | Chat (streaming SSE or JSON) |
| `POST` | `/chat/structured` | JSON-mode + Pydantic validation |
| `POST` | `/benchmark/run` | Run N-iteration benchmark, save to DB |
| `GET` | `/benchmark/history` | All past benchmark runs |
| `POST` | `/compare/run` | Same prompt → multiple models |
| `GET` | `/report` | Full technical report (JSON) |
| `GET` | `/report/markdown` | Report as Markdown text |

---

## Key Engineering Concepts

### Async I/O with FastAPI

FastAPI uses the `asyncio` event loop. Every route function is `async def`, meaning:
- While waiting for Ollama to respond, the event loop can handle other requests
- 100 users can be waiting for tokens simultaneously using one process
- No threading complexity, no race conditions on shared state

```python
# This is NON-blocking — other requests run while Ollama processes
async def generate(request: ChatRequest):
    response = await client.generate(...)   # yields control to event loop
    return response
```

### SSE Streaming

Server-Sent Events (SSE) is a one-way channel from server to browser.

**Why SSE and not WebSockets?**
- Token streaming is strictly one-directional: server → client
- SSE works over plain HTTP/1.1 — no protocol upgrade
- Browsers auto-reconnect on dropped connections
- The browser-native `EventSource` API needs no extra library

**Wire format:**
```
data: {"token": "Hello"}\n\n
data: {"token": " world"}\n\n
data: [DONE]\n\n
```

Each `\n\n` flushes the chunk to the browser, which fires an `onmessage` event.

### Pydantic Validation

Every API boundary is guarded by a Pydantic model:

```python
class ChatRequest(BaseModel):
    model: SupportedModel        # must be one of 3 enum values
    prompt: str = Field(..., min_length=1, max_length=8000)
    stream: bool = True

    @field_validator("prompt")
    def prompt_not_blank(cls, v):
        if not v.strip():
            raise ValueError("prompt must not be blank")
        return v.strip()
```

If the frontend sends `{"model": "gpt-4", "prompt": ""}`, FastAPI returns:
```json
{
  "detail": [
    {"loc": ["body", "model"], "msg": "value is not a valid enum member"},
    {"loc": ["body", "prompt"], "msg": "prompt must not be blank"}
  ]
}
```

No `try/except` in your business logic. Clean, declarative, testable.

### Retry with Tenacity

The `@retry` decorator on `OllamaClient.generate()` handles transient failures:

```python
@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=8),
    retry=retry_if_exception_type((httpx.ReadTimeout, httpx.ConnectError)),
)
async def generate(self, model, prompt):
    ...
```

- **Attempt 1** fails with `ReadTimeout` → wait 2 seconds
- **Attempt 2** fails → wait 4 seconds  
- **Attempt 3** fails → re-raise the original exception

Why `wait_exponential`? If the GPU is memory-swapping, retrying instantly makes it worse. Back-off gives the system time to recover.

### Structured JSON Output

The `POST /chat/structured` endpoint forces the LLM to return valid, schema-conforming JSON:

**Pipeline:**
```
User prompt + JSON schema
        ↓
Append JSON instruction to system prompt
        ↓
Pass format="json" to Ollama (constrains token sampling)
        ↓
Strip markdown fences from response
        ↓
json.loads() → parse to dict
        ↓
jsonschema.validate(dict, schema) → check against user schema
        ↓
If invalid: build correction prompt, retry (max 3×)
        ↓
Return validated dict + attempt count
```

The `attempts` field in the response is useful for monitoring: if a model consistently needs 3 attempts, it's less reliable for structured output tasks.

### Benchmark Metrics

**TTFT (Time To First Token)**  
Wall-clock milliseconds from when the HTTP request is sent to when the first non-empty token chunk arrives. This is the user-perceived "thinking time". Measured using `time.perf_counter()` (sub-millisecond resolution).

**TPS (Tokens Per Second)**  
`eval_tokens / (total_wall_seconds)`. This is wall-clock TPS (includes HTTP overhead), not GPU-only TPS. For a local developer tool, wall-clock is the honest metric.

**Why N runs instead of 1?**  
The first run after loading a model is always slower (GPU cache cold, CUDA kernels JIT-compiled). With N=3, we take the median which is resistant to cold-start outliers. The variance between run 2 and run 3 reflects thermal throttling on a sustained workload.

---

## Model Comparison Study

| Model | VRAM (q4_K_M) | Typical TPS | Mean TTFT | Strengths |
|---|---|---|---|---|
| llama3:8b-instruct | ~4.7 GB | 18–25 | 800–1200 ms | Best instruction following, coherent long output |
| mistral:7b-instruct | ~4.1 GB | 22–30 | 600–900 ms | Good balance of speed and quality |
| phi3:mini | ~2.3 GB | 35–50 | 300–500 ms | Fastest, smallest, good for simple tasks |

**Key trade-off:** phi3:mini is 2× faster than llama3:8b but produces shallower reasoning on complex tasks. For an interactive chat assistant, phi3:mini's TTFT of ~400 ms feels instantaneous while llama3:8b's ~1000 ms feels like "thinking".

---

## How to Run

### Prerequisites

```bash
# 1. Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 2. Pull the models (one at a time — each is 4+ GB)
ollama pull llama3:8b-instruct-q4_K_M
ollama pull mistral:7b-instruct-q4_K_M
ollama pull phi3:mini

# 3. Start Ollama daemon
ollama serve
```

### Backend

```bash
cd ollamalens/backend

# Create virtual environment (keeps your system Python clean)
python -m venv .venv
source .venv/bin/activate         # Linux/Mac
# .venv\Scripts\activate          # Windows

# Install dependencies
pip install -r requirements.txt

# Copy env file
cp ../.env.example .env

# Start the API server
uvicorn backend.main:app --reload --port 8000
```

Open `http://localhost:8000/docs` to explore the interactive API.

### Quick Test

```bash
# Health check
curl http://localhost:8000/health

# Chat (non-streaming)
curl -X POST http://localhost:8000/chat/generate \
  -H "Content-Type: application/json" \
  -d '{"model":"phi3:mini","prompt":"What is recursion?","stream":false}'

# Run a benchmark
curl -X POST http://localhost:8000/benchmark/run \
  -H "Content-Type: application/json" \
  -d '{"model":"phi3:mini","runs":3}'
```

---

