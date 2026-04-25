import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Square, Trash2, Info, Terminal } from 'lucide-react'
import { chatStream } from '../api/client'
import { PageShell, ModelSelector, Btn, TextArea } from '../components/ui'

export default function ChatPage() {
  const [model, setModel]       = useState('phi3:mini')
  const [prompt, setPrompt]     = useState('')
  const [messages, setMessages] = useState([])
  const [streaming, setStreaming] = useState(false)
  const [stats, setStats]       = useState(null)   // last response stats
  const abortRef  = useRef(null)
  const bottomRef = useRef(null)

  // Auto-scroll on new tokens
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = useCallback(async () => {
    if (!prompt.trim() || streaming) return

    const userMsg  = { role: 'user', content: prompt.trim(), id: Date.now() }
    const botId    = Date.now() + 1
    const botMsg   = { role: 'assistant', content: '', id: botId, model }

    setMessages(prev => [...prev, userMsg, botMsg])
    setPrompt('')
    setStreaming(true)
    setStats(null)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    const startTime = Date.now()
    let firstToken  = true
    let ttft        = null

    try {
      await chatStream(
        model, userMsg.content, null,
        (token) => {
          if (firstToken) {
            ttft = Date.now() - startTime
            firstToken = false
          }
          setMessages(prev => prev.map(m =>
            m.id === botId ? { ...m, content: m.content + token } : m
          ))
        },
        (meta) => {
          const totalMs = Date.now() - startTime
          setStats({
            ttft_ms: ttft,
            total_ms: totalMs,
            tps: meta?.eval_tokens
              ? (meta.eval_tokens / (totalMs / 1000)).toFixed(1)
              : '—',
            tokens: meta?.eval_tokens ?? '—',
          })
          setStreaming(false)
        },
        ctrl.signal,
      )
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === botId ? { ...m, content: `[Error: ${err.message}]`, error: true } : m
        ))
      }
      setStreaming(false)
    }
  }, [prompt, model, streaming])

  const stop = () => { abortRef.current?.abort(); setStreaming(false) }
  const clear = () => { if (!streaming) { setMessages([]); setStats(null) } }

  const handleKey = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send()
  }

  return (
    <PageShell
      title="Chat"
      subtitle="Stream tokens from your local LLM in real time"
      actions={
        <Btn variant="ghost" small onClick={clear} disabled={streaming}>
          <Trash2 size={13} /> Clear
        </Btn>
      }
    >
      {/* Model picker */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)',
          textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Active Model
        </div>
        <ModelSelector value={model} onChange={setModel} disabled={streaming} />
      </div>

      {/* Message area */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, minHeight: 380, maxHeight: 520,
        overflowY: 'auto', marginBottom: 16, position: 'relative',
      }}>
        {messages.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: 380, gap: 12, color: 'var(--muted)' }}>
            <Terminal size={36} style={{ opacity: 0.3 }} />
            <div style={{ fontSize: 13 }}>Send a message to start</div>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted2)' }}>
              Ctrl+Enter to send
            </div>
          </div>
        ) : (
          <div style={{ padding: '20px 24px' }}>
            {messages.map((msg, i) => (
              <div key={msg.id} className="fade-up" style={{
                marginBottom: 24, display: 'flex',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                gap: 12, alignItems: 'flex-start',
              }}>
                {/* Avatar */}
                <div style={{
                  width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                  display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700,
                  background: msg.role === 'user' ? 'var(--blue)' : 'var(--accent-dim)',
                  border: `1px solid ${msg.role === 'user' ? 'var(--blue)' : 'var(--accent)'}`,
                  color: msg.role === 'user' ? '#000' : 'var(--accent)',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {msg.role === 'user' ? 'U' : 'AI'}
                </div>

                {/* Bubble */}
                <div style={{
                  maxWidth: '75%',
                  background: msg.role === 'user' ? 'var(--surface2)' : 'transparent',
                  border: msg.role === 'user' ? '1px solid var(--border)' : 'none',
                  borderRadius: 8, padding: msg.role === 'user' ? '10px 14px' : '4px 0',
                  color: msg.error ? 'var(--red)' : 'var(--text)',
                }}>
                  {/* Model tag for AI */}
                  {msg.role === 'assistant' && (
                    <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)',
                      color: 'var(--accent)', marginBottom: 6 }}>
                      ▶ {msg.model}
                    </div>
                  )}
                  <div style={{
                    fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}
                  className={
                    msg.role === 'assistant' && streaming && i === messages.length - 1 && !msg.content
                      ? '' : ''
                  }>
                    {msg.content || (
                      streaming && msg.role === 'assistant' && i === messages.length - 1
                        ? <span className="cursor-blink" style={{ color: 'var(--muted)' }}></span>
                        : ''
                    )}
                    {/* Blinking cursor at end of streaming msg */}
                    {streaming && msg.role === 'assistant' && i === messages.length - 1 && msg.content && (
                      <span className="cursor-blink" />
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="fade-up" style={{
          display: 'flex', gap: 20, marginBottom: 12,
          padding: '8px 14px', background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 6,
          fontFamily: 'var(--font-mono)', fontSize: 11,
        }}>
          <span style={{ color: 'var(--muted)' }}>
            TTFT: <strong style={{ color: 'var(--accent)' }}>{stats.ttft_ms}ms</strong>
          </span>
          <span style={{ color: 'var(--muted)' }}>
            TPS: <strong style={{ color: 'var(--accent)' }}>{stats.tps}</strong>
          </span>
          <span style={{ color: 'var(--muted)' }}>
            Tokens: <strong style={{ color: 'var(--accent)' }}>{stats.tokens}</strong>
          </span>
          <span style={{ color: 'var(--muted)' }}>
            Total: <strong style={{ color: 'var(--accent)' }}>{stats.total_ms}ms</strong>
          </span>
        </div>
      )}

      {/* Input area */}
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <TextArea
            value={prompt}
            onChange={setPrompt}
            placeholder="Ask anything… (Ctrl+Enter to send)"
            rows={3}
            disabled={streaming}
            onKeyDown={handleKey}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {streaming ? (
            <Btn onClick={stop} variant="danger">
              <Square size={14} fill="currentColor" /> Stop
            </Btn>
          ) : (
            <Btn onClick={send} disabled={!prompt.trim()}>
              <Send size={14} /> Send
            </Btn>
          )}
        </div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 6 }}>
        Streaming via SSE · Model runs entirely on your GPU · No data leaves your machine
      </div>
    </PageShell>
  )
}
