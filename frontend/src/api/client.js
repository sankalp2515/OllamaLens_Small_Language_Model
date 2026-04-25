/**
 * api/client.js
 * All communication with the FastAPI backend.
 * Base URL uses Vite's proxy (/api → localhost:8000).
 */

const BASE = '/api'

// ── Helpers ──────────────────────────────────────────────────────────────
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

// ── Chat ─────────────────────────────────────────────────────────────────

/** Non-streaming single response */
export const chatGenerate = (model, prompt, system = null) =>
  post('/chat/generate', { model, prompt, system, stream: false })

/**
 * Streaming chat — calls onToken(text) for each token, onDone(meta) at end.
 * Uses the browser's native EventSource-compatible fetch streaming.
 */
export async function chatStream(model, prompt, system = null, onToken, onDone, signal) {
  const res = await fetch(`${BASE}/chat/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, system, stream: true }),
    signal,
  })

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() // keep incomplete last line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') { onDone && onDone(); return }
      try {
        const parsed = JSON.parse(data)
        if (parsed.token) onToken(parsed.token)
        if (parsed.done) onDone && onDone(parsed)
      } catch {}
    }
  }
}

export const listModels = () => get('/chat/models')

// ── Structured output ─────────────────────────────────────────────────────
export const chatStructured = (model, prompt, json_schema) =>
  post('/chat/structured', { model, prompt, json_schema, stream: false })

// ── Benchmark ─────────────────────────────────────────────────────────────
export const runBenchmark = (model, runs = 3, prompt = null) =>
  post('/benchmark/run', { model, runs, ...(prompt ? { prompt } : {}) })

export const getBenchmarkHistory = (model = null, limit = 50) =>
  get(`/benchmark/history${model ? `?model=${encodeURIComponent(model)}&limit=${limit}` : `?limit=${limit}`}`)

// ── Compare ───────────────────────────────────────────────────────────────
export const compareModels = (prompt, models = null, runs_per_model = 2) =>
  post('/compare/run', { prompt, models, runs_per_model })

// ── Report ────────────────────────────────────────────────────────────────
export const getReport = () => get('/report')
export const getReportMarkdown = () =>
  fetch(`${BASE}/report/markdown`).then(r => r.text())

// ── Health ────────────────────────────────────────────────────────────────
export const getHealth = () => get('/health')
