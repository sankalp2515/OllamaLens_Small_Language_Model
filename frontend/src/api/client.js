/**
 * api/client.js — v3 with tool use support
 *
 * The SSE stream now emits typed events instead of raw tokens:
 *   {"type": "tool_start",  "tool": "web_search", "args": {...}}
 *   {"type": "tool_result", "tool": "web_search", "result": "..."}
 *   {"type": "token",       "token": "The answer is..."}
 *   {"type": "done",        "eval_tokens": 42, "tool_calls": [...]}
 *   [DONE]
 *
 * chatStream() now accepts callbacks for each event type so the
 * frontend can show a "🔍 Searching…" indicator during tool execution.
 */

const BASE = '/api'

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  return res.json()
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.statusText}`)
  return res.json()
}

/**
 * Streaming chat with tool use and conversation memory.
 *
 * @param {string}   model    - model enum string
 * @param {string}   prompt   - current user message
 * @param {Array}    history  - [{role, content}, ...] all previous turns
 * @param {string}   system   - optional system prompt override
 * @param {Function} onToken       - (token: string) => void
 * @param {Function} onToolStart   - ({tool, args}) => void
 * @param {Function} onToolResult  - ({tool, result}) => void
 * @param {Function} onDone        - ({eval_tokens, tool_calls}) => void
 * @param {AbortSignal} signal     - for cancellation
 */
export async function chatStream(
  model, prompt, history = [], system = null,
  onToken, onToolStart, onToolResult, onDone, signal
) {
  const res = await fetch(`${BASE}/chat/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, history, system, stream: true }),
    signal,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Stream failed')
  }

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer    = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()  // keep incomplete last line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()

      if (raw === '[DONE]') { onDone && onDone(); return }

      try {
        const evt = JSON.parse(raw)

        switch (evt.type) {
          case 'token':
            onToken && onToken(evt.token)
            break
          case 'tool_start':
            onToolStart && onToolStart({ tool: evt.tool, args: evt.args })
            break
          case 'tool_result':
            onToolResult && onToolResult({ tool: evt.tool, result: evt.result })
            break
          case 'done':
            onDone && onDone({
              eval_tokens:    evt.eval_tokens,
              total_duration: evt.total_duration_ms,
              tool_calls:     evt.tool_calls || [],
            })
            break
        }
      } catch { /* ignore parse errors on partial chunks */ }
    }
  }
}

// ── Non-streaming (benchmark, structured output) ──────────────────────
export const chatGenerate = (model, prompt) =>
  post('/chat/generate', { model, prompt, history: [], stream: false })

export const listModels = () => get('/chat/models')

export const chatStructured = (model, prompt, json_schema) =>
  post('/chat/structured', { model, prompt, json_schema, stream: false })

// ── Benchmark ─────────────────────────────────────────────────────────
export const runBenchmark = (model, runs = 3, prompt = null) =>
  post('/benchmark/run', { model, runs, ...(prompt ? { prompt } : {}) })

export const getBenchmarkHistory = (model = null, limit = 50) =>
  get(`/benchmark/history${model
    ? `?model=${encodeURIComponent(model)}&limit=${limit}`
    : `?limit=${limit}`}`)

// ── Compare ───────────────────────────────────────────────────────────
export const compareModels = (prompt, models = null, runs_per_model = 2) =>
  post('/compare/run', { prompt, models, runs_per_model })

// ── Report ────────────────────────────────────────────────────────────
export const getReport         = () => get('/report')
export const getReportMarkdown = () => fetch(`${BASE}/report/markdown`).then(r => r.text())

// ── Health ────────────────────────────────────────────────────────────
export const getHealth = () => get('/health')