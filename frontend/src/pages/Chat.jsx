import { useCallback, useRef, useEffect, useState } from 'react'
import {
  Send, Square, Trash2, MessageSquare, User, Bot, Zap,
  Search, Cloud, Calculator, BookOpen, Clock,
  CheckCircle, ChevronDown, ChevronUp, Wrench
} from 'lucide-react'
import { chatStream } from '../api/client'
import { useApp } from '../context/AppContext'
import { PageShell, ModelSelector, EmptyState, InfoBanner, MODELS } from '../components/ui'

/* ── Tool metadata ─────────────────────────────────────── */
const TOOL_META = {
  web_search:    { icon: Search,     label: 'Web Search',  color: '#0284c7', lt: '#e0f2fe' },
  get_weather:   { icon: Cloud,      label: 'Weather',     color: '#059669', lt: '#ecfdf5' },
  get_date_time: { icon: Clock,      label: 'Date & Time', color: '#7c3aed', lt: '#f5f3ff' },
  calculator:    { icon: Calculator, label: 'Calculator',  color: '#d97706', lt: '#fffbeb' },
  wikipedia:     { icon: BookOpen,   label: 'Wikipedia',   color: '#4f46e5', lt: '#eef2ff' },
}

const MODEL_COLOR = Object.fromEntries(MODELS.map(m => [m.id, m.color]))
const MODEL_LT    = Object.fromEntries(MODELS.map(m => [m.id, m.lt]))
const MAX_TPS     = { 'phi3:mini': 80, 'mistral:7b-instruct-q4_K_M': 40, 'llama3:8b-instruct-q4_K_M': 32 }

export default function ChatPage() {
  const {
    chatMessages, setChatMessages,
    chatModel, setChatModel,
    chatStats, setChatStats,
    chatStreaming, setChatStreaming,
    chatAbortRef, clearChat,
  } = useApp()

  const [liveTps,    setLiveTps]    = useState(null)
  const [liveTtft,   setLiveTtft]   = useState(null)
  const [liveTokens, setLiveTokens] = useState(0)
  const [activeTool, setActiveTool] = useState(null)  // {tool, args}

  const bottomRef   = useRef(null)
  const inputRef    = useRef(null)
  const tokCountRef = useRef(0)
  const t0Ref       = useRef(null)
  const firstTokRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMessages])
  useEffect(() => { if (!chatStreaming) { setLiveTps(null); setLiveTokens(0); setActiveTool(null) } }, [chatStreaming])

  const send = useCallback(async () => {
    const text = inputRef.current?.value?.trim()
    if (!text || chatStreaming) return

    const historySnapshot = chatMessages
      .filter(m => !m.streaming && m.content && !m.error)
      .map(m => ({ role: m.role, content: m.content }))

    const userMsg = { role: 'user',      content: text, id: Date.now() }
    const botId   = Date.now() + 1
    const botMsg  = { role: 'assistant', content: '', id: botId, model: chatModel, streaming: true, toolCalls: [] }

    setChatMessages(prev => [...prev, userMsg, botMsg])
    if (inputRef.current) inputRef.current.value = ''
    setChatStreaming(true)
    setChatStats(null)
    setActiveTool(null)
    setLiveTtft(null)
    setLiveTps(null)
    setLiveTokens(0)
    tokCountRef.current = 0
    t0Ref.current       = Date.now()
    firstTokRef.current = null

    const ctrl = new AbortController()
    chatAbortRef.current = ctrl

    try {
      await chatStream(
        chatModel, text, historySnapshot, null,

        // onToken — live metrics
        (token) => {
          const now = Date.now()
          if (firstTokRef.current === null) {
            firstTokRef.current = now - t0Ref.current
            setLiveTtft(firstTokRef.current)
            setActiveTool(null)   // tool finished once tokens start
          }
          tokCountRef.current += 1
          setLiveTokens(tokCountRef.current)
          const elapsed = (now - (t0Ref.current + firstTokRef.current)) / 1000
          if (elapsed > 0.2) setLiveTps((tokCountRef.current / elapsed).toFixed(1))
          setChatMessages(prev => prev.map(m =>
            m.id === botId ? { ...m, content: m.content + token } : m
          ))
        },

        // onToolStart — show indicator, add to message log
        ({ tool, args }) => {
          setActiveTool({ tool, args })
          setChatMessages(prev => prev.map(m =>
            m.id === botId
              ? { ...m, toolCalls: [...(m.toolCalls || []), { tool, args, result: null, done: false }] }
              : m
          ))
        },

        // onToolResult — update the log entry, mark done
        ({ tool, result }) => {
          setChatMessages(prev => prev.map(m =>
            m.id === botId
              ? {
                  ...m,
                  toolCalls: m.toolCalls.map(tc =>
                    tc.tool === tool && !tc.done ? { ...tc, result, done: true } : tc
                  )
                }
              : m
          ))
        },

        // onDone — freeze final stats with CORRECT tool_calls count
        (meta) => {
          const totalMs = Date.now() - t0Ref.current
          // Count tool calls from the message state (most reliable source)
          setChatMessages(prev => {
            const botMsg = prev.find(m => m.id === botId)
            const toolCount = botMsg?.toolCalls?.length || meta?.tool_calls?.length || 0
            setChatStats({
              ttft_ms:    firstTokRef.current ?? 0,
              total_ms:   totalMs,
              tps: tokCountRef.current > 0
                ? (tokCountRef.current / ((totalMs - (firstTokRef.current ?? 0)) / 1000)).toFixed(1)
                : '—',
              tokens:     tokCountRef.current,
              tool_count: toolCount,
            })
            return prev.map(m => m.id === botId ? { ...m, streaming: false } : m)
          })
          setChatStreaming(false)
        },

        ctrl.signal,
      )
    } catch (err) {
      if (err.name !== 'AbortError') {
        setChatMessages(prev => prev.map(m =>
          m.id === botId ? { ...m, content: `Error: ${err.message}`, error: true, streaming: false } : m
        ))
      }
      setChatStreaming(false)
    }
  }, [chatModel, chatStreaming, chatMessages])

  const stop      = () => { chatAbortRef.current?.abort(); setChatStreaming(false) }
  const handleKey = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() } }

  const msgCount   = chatMessages.filter(m => m.role === 'user').length
  const memTurns   = Math.min(chatMessages.filter(m => m.content && !m.error).length, 10)
  const modelColor = MODEL_COLOR[chatModel] ?? 'var(--indigo)'
  const modelLt    = MODEL_LT[chatModel]   ?? 'var(--indigo-lt)'
  const maxTps     = MAX_TPS[chatModel] ?? 70

  return (
    <PageShell
      title="Chat"
      badge={msgCount > 0 ? { label: `${memTurns} turns`, color: 'indigo' } : undefined}
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {msgCount > 0 && <span className="tag tag-emerald">🧠 {memTurns} in memory</span>}
          <span className="tag tag-sky" title="5 tools enabled">🔧 5 tools</span>
          <button className="btn btn-ghost btn-sm" onClick={clearChat}
            disabled={chatStreaming || chatMessages.length === 0}>
            <Trash2 size={12} /> Clear
          </button>
        </div>
      }
    >
      <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px - 48px)', gap: 14 }}>

        {/* Model selector */}
        <div>
          <div className="label" style={{ marginBottom: 10, display: 'block' }}>Active model</div>
          <ModelSelector value={chatModel} onChange={setChatModel} disabled={chatStreaming} />
        </div>

        {/* Tool hints (empty state) */}
        {chatMessages.length === 0 && <ToolHints />}

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {chatMessages.length === 0
            ? <EmptyState icon={MessageSquare} title="Start chatting" sub="Ask about weather, today's date, math, or recent events — tools will fetch real data." />
            : (
              <>
                {chatMessages.map((msg, i) => (
                  <MessageBubble key={msg.id} msg={msg}
                    isLast={i === chatMessages.length - 1}
                    streaming={chatStreaming}
                    modelColor={modelColor} modelLt={modelLt}
                  />
                ))}
                <div ref={bottomRef} />
              </>
            )
          }
        </div>

        {/* Active tool indicator */}
        {activeTool && <ToolRunningBadge tool={activeTool.tool} args={activeTool.args} />}

        {/* Live metrics (streaming, no tool active) */}
        {chatStreaming && !activeTool && (
          <div className="anim-fade-in" style={{ display: 'flex', gap: 0, background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ flex: 1, padding: '10px 14px', borderRight: '1px solid var(--b1)' }}>
              <div className="label" style={{ marginBottom: 4, display: 'block' }}>Live TPS</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 5 }}>
                <span style={{ fontFamily: 'var(--ff-mono)', fontSize: 22, fontWeight: 600, color: modelColor, letterSpacing: '-1px' }}>
                  {liveTps ?? '…'}
                </span>
                <span style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--ff-mono)' }}>tok/s</span>
              </div>
              <div className="tps-bar-track">
                <div className="tps-bar-fill" style={{ width: `${Math.min((parseFloat(liveTps) / maxTps) * 100 || 0, 100)}%`, background: `linear-gradient(90deg, ${modelColor}80, ${modelColor})` }} />
              </div>
            </div>
            <div style={{ padding: '10px 14px', borderRight: '1px solid var(--b1)', minWidth: 90 }}>
              <div className="label" style={{ marginBottom: 4, display: 'block' }}>TTFT</div>
              <span style={{ fontFamily: 'var(--ff-mono)', fontSize: 16, fontWeight: 600, color: 'var(--sky)' }}>
                {liveTtft !== null ? `${liveTtft}ms` : '…'}
              </span>
            </div>
            <div style={{ padding: '10px 14px', minWidth: 80 }}>
              <div className="label" style={{ marginBottom: 4, display: 'block' }}>Tokens</div>
              <span style={{ fontFamily: 'var(--ff-mono)', fontSize: 16, fontWeight: 600, color: 'var(--emerald)' }}>
                {liveTokens}
              </span>
            </div>
          </div>
        )}

        {/* Final stats */}
        {chatStats && !chatStreaming && (
          <div className="anim-fade-in" style={{ display: 'flex', gap: 0, background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 10, overflow: 'hidden' }}>
            {[
              { label: 'TPS',    val: chatStats.tps,           unit: 'tok/s', color: modelColor },
              { label: 'TTFT',   val: `${chatStats.ttft_ms}ms`, unit: '',     color: 'var(--sky)' },
              { label: 'Tokens', val: chatStats.tokens,         unit: '',     color: 'var(--emerald)' },
              { label: 'Tools',  val: chatStats.tool_count ?? 0, unit: chatStats.tool_count === 1 ? 'call' : 'calls', color: 'var(--violet)' },
            ].map(({ label, val, unit, color }, i, arr) => (
              <div key={label} style={{ flex: 1, padding: '10px 14px', borderRight: i < arr.length - 1 ? '1px solid var(--b1)' : 'none' }}>
                <div className="label" style={{ marginBottom: 4, display: 'block' }}>{label}</div>
                <span style={{ fontFamily: 'var(--ff-mono)', fontSize: 16, fontWeight: 600, color }}>
                  {val}<span style={{ fontSize: 10, color: 'var(--t3)', marginLeft: 2 }}>{unit}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{
          background: 'var(--s1)',
          border: `1px solid ${chatStreaming ? 'rgba(79,70,229,.4)' : 'var(--b2)'}`,
          borderRadius: 12, padding: '12px 14px',
          transition: 'border-color .15s, box-shadow .15s',
          boxShadow: chatStreaming ? '0 0 0 3px rgba(79,70,229,.08)' : 'none',
        }}>
          <textarea ref={inputRef} rows={3} className="inp"
            placeholder='Ask anything… e.g. "What is the weather in Mumbai?" or "What is 18% of 85000?"'
            disabled={chatStreaming} onKeyDown={handleKey}
            style={{ background: 'transparent', border: 'none', padding: 0, resize: 'none', marginBottom: 10, boxShadow: 'none' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 11, color: 'var(--t3)', display: 'flex', gap: 10 }}>
              <span><kbd>Ctrl</kbd>+<kbd>Enter</kbd> to send</span>
              {memTurns > 0 && <span>History: {memTurns} turns</span>}
            </div>
            {chatStreaming
              ? <button className="btn btn-danger btn-sm" onClick={stop}><Square size={11} fill="currentColor" /> Stop</button>
              : <button className="btn btn-primary btn-sm" onClick={send}><Send size={12} /> Send</button>
            }
          </div>
        </div>
      </div>
    </PageShell>
  )
}

/* ═══════════════════════════════════════════
   TOOL RUNNING BADGE
═══════════════════════════════════════════ */
function ToolRunningBadge({ tool, args }) {
  const meta = TOOL_META[tool] ?? { icon: Wrench, label: tool, color: 'var(--indigo)', lt: 'var(--indigo-lt)' }
  const Icon = meta.icon
  const argVal = (args && Object.values(args)[0]?.toString().slice(0, 50)) ?? ''

  return (
    <div className="anim-tool-pop" style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
      background: meta.lt, border: `1px solid ${meta.color}25`,
      borderRadius: 10,
    }}>
      <div className="spinner" style={{ borderTopColor: meta.color, borderColor: `${meta.color}25` }} />
      <Icon size={14} color={meta.color} />
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: meta.color }}>{meta.label}</span>
        {argVal && <span style={{ fontSize: 11, color: 'var(--t3)', marginLeft: 8, fontFamily: 'var(--ff-mono)' }}>"{argVal}"</span>}
      </div>
      <span style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--ff-mono)' }}>running…</span>
    </div>
  )
}

/* ═══════════════════════════════════════════
   TOOL CALL LOG (inside message, collapsible)
═══════════════════════════════════════════ */
function ToolCallLog({ toolCalls }) {
  const [open, setOpen] = useState(false)
  if (!toolCalls?.length) return null
  const done = toolCalls.filter(t => t.done).length

  return (
    <div style={{ marginBottom: 8 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 5,
        background: 'none', border: 'none', cursor: 'pointer',
        padding: '3px 0', color: 'var(--t3)', fontSize: 11,
        fontFamily: 'var(--ff-mono)',
      }}>
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        <Wrench size={10} />
        <span>{toolCalls.length} tool call{toolCalls.length !== 1 ? 's' : ''}</span>
        {done > 0 && <CheckCircle size={9} color="var(--emerald)" />}
      </button>

      {open && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {toolCalls.map((tc, i) => {
            const meta = TOOL_META[tc.tool] ?? { icon: Wrench, label: tc.tool, color: 'var(--indigo)', lt: 'var(--indigo-lt)' }
            const Icon = meta.icon
            const argVal = (tc.args && Object.values(tc.args)[0]?.toString().slice(0, 40)) ?? ''
            return (
              <div key={i} className="tool-card" style={{ borderLeft: `2px solid ${meta.color}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: meta.lt }}>
                  <Icon size={11} color={meta.color} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: meta.color }}>{meta.label}</span>
                  {argVal && <span style={{ color: 'var(--t3)', fontSize: 10 }}>"{argVal}"</span>}
                  <div style={{ marginLeft: 'auto' }}>
                    {tc.done
                      ? <CheckCircle size={10} color="var(--emerald)" />
                      : <div className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5, borderTopColor: meta.color, borderColor: `${meta.color}25` }} />
                    }
                  </div>
                </div>
                {tc.result && (
                  <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--t2)', lineHeight: 1.55, maxHeight: 70, overflow: 'hidden', position: 'relative' }}>
                    {tc.result.slice(0, 220)}{tc.result.length > 220 ? '…' : ''}
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 20, background: 'linear-gradient(transparent, var(--s1))' }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════
   MESSAGE BUBBLE
═══════════════════════════════════════════ */
function MessageBubble({ msg, isLast, streaming, modelColor, modelLt }) {
  const isUser      = msg.role === 'user'
  const isStreaming = isLast && streaming && !isUser

  return (
    <div className="anim-fade-up" style={{
      display: 'flex', flexDirection: isUser ? 'row-reverse' : 'row',
      gap: 10, padding: '5px 0', alignItems: 'flex-start',
    }}>
      {/* Avatar */}
      <div style={{
        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
        display: 'grid', placeItems: 'center',
        background: isUser ? 'var(--s2)' : modelLt,
        border: `1px solid ${isUser ? 'var(--b1)' : 'transparent'}`,
      }}>
        {isUser ? <User size={13} color="var(--t2)" /> : <Bot size={13} color={modelColor} />}
      </div>

      {/* Bubble */}
      <div style={{
        maxWidth: '74%',
        background: isUser ? 'var(--s2)' : 'transparent',
        border: isUser ? '1px solid var(--b1)' : 'none',
        borderRadius: isUser ? '10px 3px 10px 10px' : '3px 10px 10px 10px',
        padding: isUser ? '9px 13px' : '1px 0',
        color: msg.error ? 'var(--rose)' : 'var(--t1)',
      }}>
        {/* Model label */}
        {!isUser && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, fontFamily: 'var(--ff-mono)', fontSize: 10, color: modelColor }}>
            <Zap size={8} /> {msg.model}
          </div>
        )}

        {/* Tool call log */}
        {!isUser && <ToolCallLog toolCalls={msg.toolCalls} />}

        {/* Content */}
        <div style={{ fontSize: 14, lineHeight: 1.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {msg.content || (isStreaming && <span style={{ color: 'var(--t3)', fontStyle: 'italic', fontSize: 13 }}>Thinking…</span>)}
          {isStreaming && msg.content && <span className="stream-cursor" />}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   TOOL HINTS (shown when chat is empty)
═══════════════════════════════════════════ */
function ToolHints() {
  const hints = [
    { icon: Search,     color: '#0284c7', lt: '#e0f2fe', text: 'What happened in AI news this week?' },
    { icon: Cloud,      color: '#059669', lt: '#ecfdf5', text: 'What is the weather in Mumbai right now?' },
    { icon: Calculator, color: '#d97706', lt: '#fffbeb', text: 'What is 18% of 85,000?' },
    { icon: Clock,      color: '#7c3aed', lt: '#f5f3ff', text: 'What day of the week is today?' },
    { icon: BookOpen,   color: '#4f46e5', lt: '#eef2ff', text: 'Explain what a transformer neural network is' },
  ]
  return (
    <div style={{ background: 'var(--s1)', border: '1px solid var(--b1)', borderRadius: 10, padding: '14px 16px' }}>
      <div className="label" style={{ marginBottom: 10, display: 'block' }}>🔧 Try these tool-powered prompts</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {hints.map(({ icon: Icon, color, lt, text }) => (
          <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--t2)' }}>
            <div style={{ width: 22, height: 22, borderRadius: 6, background: lt, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon size={11} color={color} />
            </div>
            <span style={{ color: 'var(--t3)', fontStyle: 'italic' }}>"{text}"</span>
          </div>
        ))}
      </div>
    </div>
  )
}