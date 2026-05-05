import { useCallback, useRef, useEffect, useState } from 'react'
import {
  Send, Square, Trash2, User, Bot, Zap,
  Search, Cloud, Calculator, BookOpen, Clock,
  CheckCircle, ChevronDown, ChevronUp, Wrench,
  Copy, Pencil, Check, X, Maximize2, Minimize2,
  ArrowUpRight, Sparkles
} from 'lucide-react'
import { chatStream } from '../api/client'
import { useApp, CONTEXT_WINDOWS, estimateTokens } from '../context/AppContext'
import { MODELS } from '../components/Sidebar'

/* ── Tool metadata ─────────────────────────────────────────── */
const TOOL_META = {
  web_search:    { icon: Search,     label: 'Web Search',  color: '#0369a1', lt: '#f0f9ff' },
  get_weather:   { icon: Cloud,      label: 'Weather',     color: '#0d9488', lt: '#f0fdfa' },
  get_date_time: { icon: Clock,      label: 'Date & Time', color: '#7c3d6e', lt: '#fdf4ff' },
  calculator:    { icon: Calculator, label: 'Calculator',  color: '#b45309', lt: '#fffbeb' },
  wikipedia:     { icon: BookOpen,   label: 'Wikipedia',   color: '#e8613a', lt: '#fef3ee' },
}

const MODEL_COLOR = Object.fromEntries(MODELS.map(m => [m.id, m.color]))
const MODEL_LT    = Object.fromEntries(MODELS.map(m => [m.id, m.lt]))
const MODEL_GRAD  = Object.fromEntries(MODELS.map(m => [m.id, m.grad]))
const MAX_TPS     = { 'phi3:mini': 80, 'mistral:7b-instruct-q4_K_M': 40, 'llama3:8b-instruct-q4_K_M': 32 }

const SUGGESTIONS = [
  { icon: Cloud,      color: '#0d9488', lt: '#f0fdfa', text: "What's the weather in Mumbai?",       tool: 'Weather'    },
  { icon: Search,     color: '#0369a1', lt: '#f0f9ff', text: "What happened in AI news this week?", tool: 'Web Search' },
  { icon: Calculator, color: '#b45309', lt: '#fffbeb', text: "What is 18% of 85,000?",             tool: 'Calculator' },
  { icon: Clock,      color: '#7c3d6e', lt: '#fdf4ff', text: "What day of the week is today?",      tool: 'Date'       },
  { icon: BookOpen,   color: '#e8613a', lt: '#fef3ee', text: "Explain transformer neural networks", tool: 'Wikipedia'  },
  { icon: Search,     color: '#0369a1', lt: '#f0f9ff', text: "Latest SpaceX launch news",           tool: 'Web Search' },
]

export default function ChatPage() {
  const {
    chatMessages, setChatMessages,
    chatModel, setChatModel,
    chatStats, setChatStats,
    chatStreaming, setChatStreaming,
    chatAbortRef, clearChat,
    toolsEnabled,
    contextTokens, recalcContext,
    sidebarCollapsed,
    activeChatId, createSession, setActiveChatId,
  } = useApp()

  const [liveTps,    setLiveTps]    = useState(null)
  const [liveTtft,   setLiveTtft]   = useState(null)
  const [liveTokens, setLiveTokens] = useState(0)
  const [activeTool, setActiveTool] = useState(null)
  const [inputExpanded, setInputExpanded] = useState(false)
  const [editingId, setEditingId]   = useState(null)
  const [editText,  setEditText]    = useState('')
  const [copied,    setCopied]      = useState(null)

  const bottomRef   = useRef(null)
  const inputRef    = useRef(null)
  const tokCountRef = useRef(0)
  const t0Ref       = useRef(null)
  const firstTokRef = useRef(null)

  const hasMessages = chatMessages.length > 0
  const ml = sidebarCollapsed ? 64 : 240

  // Auto-create session when landing on chat with no active session
  useEffect(() => {
    if (!activeChatId) createSession()
  }, [activeChatId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  useEffect(() => {
    if (!chatStreaming) { setLiveTps(null); setLiveTokens(0); setActiveTool(null) }
  }, [chatStreaming])

  // Recalculate context on message change
  useEffect(() => {
    const prompt = inputRef.current?.value ?? ''
    recalcContext(chatMessages, prompt)
  }, [chatMessages, recalcContext])

  const send = useCallback(async (overrideText) => {
    const text = (overrideText || inputRef.current?.value || '').trim()
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
        // onToken
        (token) => {
          const now = Date.now()
          if (firstTokRef.current === null) {
            firstTokRef.current = now - t0Ref.current
            setLiveTtft(firstTokRef.current)
            setActiveTool(null)
          }
          tokCountRef.current += 1
          setLiveTokens(tokCountRef.current)
          const elapsed = (now - (t0Ref.current + (firstTokRef.current ?? 0))) / 1000
          if (elapsed > 0.5 && tokCountRef.current > 3) {
            setLiveTps((tokCountRef.current / elapsed).toFixed(1))
          }
          setChatMessages(prev => prev.map(m =>
            m.id === botId ? { ...m, content: m.content + token } : m
          ))
        },
        // onToolStart
        ({ tool, args }) => {
          setActiveTool({ tool, args })
          setChatMessages(prev => prev.map(m =>
            m.id === botId
              ? { ...m, toolCalls: [...(m.toolCalls || []), { tool, args, result: null, done: false }] }
              : m
          ))
        },
        // onToolResult
        ({ tool, result }) => {
          setChatMessages(prev => prev.map(m =>
            m.id === botId
              ? { ...m, toolCalls: m.toolCalls.map(tc => tc.tool === tool && !tc.done ? { ...tc, result, done: true } : tc) }
              : m
          ))
        },
        // onDone
        (meta) => {
          const totalMs = Date.now() - t0Ref.current
          setChatMessages(prev => {
            const botM = prev.find(m => m.id === botId)
            const toolCount = botM?.toolCalls?.length || meta?.tool_calls?.length || 0
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
        toolsEnabled,
      )
    } catch (err) {
      if (err.name !== 'AbortError') {
        setChatMessages(prev => prev.map(m =>
          m.id === botId ? { ...m, content: `Error: ${err.message}`, error: true, streaming: false } : m
        ))
      }
      setChatStreaming(false)
    }
  }, [chatModel, chatStreaming, chatMessages, toolsEnabled])

  const stop = () => { chatAbortRef.current?.abort(); setChatStreaming(false) }
  const handleKey = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() }
  }

  // Copy message
  const copyMessage = async (text, id) => {
    await navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  // Edit message (user only) — resends from that point
  const startEdit = (msg) => {
    setEditingId(msg.id)
    setEditText(msg.content)
  }

  const submitEdit = async (msgId) => {
    const newText = editText.trim()
    if (!newText) return
    // Remove this message and everything after it, then resend
    setChatMessages(prev => {
      const idx = prev.findIndex(m => m.id === msgId)
      return idx >= 0 ? prev.slice(0, idx) : prev
    })
    setEditingId(null)
    setEditText('')
    // Small delay to let state settle
    setTimeout(() => send(newText), 50)
  }

  const msgCount   = chatMessages.filter(m => m.role === 'user').length
  const memTurns   = Math.min(chatMessages.filter(m => m.content && !m.error).length, 10)
  const modelColor = MODEL_COLOR[chatModel] ?? 'var(--coral)'
  const modelLt    = MODEL_LT[chatModel]   ?? 'var(--coral-lt)'
  const modelGrad  = MODEL_GRAD[chatModel] ?? 'linear-gradient(135deg,var(--coral),#f97316)'
  const maxTps     = MAX_TPS[chatModel] ?? 70
  const activeModel = MODELS.find(m => m.id === chatModel)

  return (
    <div style={{
      marginLeft: ml, flex: 1, display: 'flex', flexDirection: 'column',
      height: '100vh', transition: 'margin-left .22s cubic-bezier(.4,0,.2,1)',
      overflow: 'hidden',
    }}>

      {/* ── TOP BAR ── */}
      <header style={{
        height: 58, padding: '0 24px', flexShrink: 0,
        borderBottom: '1px solid var(--b1)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(250,249,247,0.95)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 1px 0 var(--b1)',
        zIndex: 40,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ fontFamily: 'var(--ff-body)', fontSize: 17, fontWeight: 800, color: 'var(--t1)', letterSpacing: '-.5px' }}>
            {hasMessages ? 'Chat' : 'New Chat'}
          </h1>
          {hasMessages && memTurns > 0 && (
            <span className="tag tag-coral">🧠 {memTurns} turns</span>
          )}
          {/* Tools status */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 99, fontSize: 10, fontFamily: 'var(--ff-mono)',
            background: toolsEnabled ? 'var(--sage-lt)' : 'var(--s3)',
            color: toolsEnabled ? 'var(--sage)' : 'var(--t4)',
            border: `1px solid ${toolsEnabled ? 'var(--sage-b)' : 'var(--b1)'}`,
          }}>
            <Wrench size={9} />
            {toolsEnabled ? 'Tools ON' : 'Tools OFF'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {hasMessages && (
            <button className="btn btn-ghost btn-sm" onClick={clearChat} disabled={chatStreaming}>
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>
      </header>

      {/* ── MAIN SCROLLABLE AREA ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {!hasMessages ? (

          /* ══ HERO WELCOME ══ */
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: 40 }}>
            {/* Decorative header */}
            <div style={{
              width: '100%', minHeight: 240,
              background: 'linear-gradient(180deg,#fff8f5 0%,rgba(250,249,247,0) 100%)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'flex-end', paddingBottom: 28, position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: -50, left: '15%', width: 280, height: 280, borderRadius: '50%', background: 'radial-gradient(circle,rgba(232,97,58,.08) 0%,transparent 70%)', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', top: -30, right: '12%', width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle,rgba(124,61,110,.06) 0%,transparent 70%)', pointerEvents: 'none' }} />

              <div className="anim-slide-up" style={{
                width: 68, height: 68, borderRadius: 20, marginBottom: 18,
                background: modelGrad, display: 'grid', placeItems: 'center',
                boxShadow: `0 10px 28px ${modelColor}30, 0 4px 10px ${modelColor}20, inset 0 1px 0 rgba(255,255,255,.25)`,
              }}>
                <Sparkles size={28} color="#fff" strokeWidth={1.5} />
              </div>

              <div className="anim-slide-up" style={{ textAlign: 'center', animationDelay: '50ms' }}>
                <h1 style={{ fontFamily: 'var(--ff-body)', fontSize: 34, fontWeight: 900, color: 'var(--t1)', letterSpacing: '-1.5px', lineHeight: 1.08, marginBottom: 10 }}>
                  Hi, how can I help you?
                </h1>
                <p style={{ fontSize: 14, color: 'var(--t3)', lineHeight: 1.65, maxWidth: 400, margin: '0 auto' }}>
                  Running <strong style={{ color: modelColor }}>{activeModel?.label}</strong> locally on your GPU.
                  {toolsEnabled ? ' Tools connected for real-time data.' : ' Tools are disabled — pure model mode.'}
                </p>
              </div>
            </div>

            {/* Model pills */}
            <div className="anim-slide-up" style={{ display: 'flex', gap: 8, marginBottom: 28, flexWrap: 'wrap', justifyContent: 'center', animationDelay: '90ms' }}>
              {MODELS.map(m => {
                const active = chatModel === m.id
                return (
                  <button key={m.id} onClick={() => setChatModel(m.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 99,
                      border: `1.5px solid ${active ? m.color + '55' : 'var(--b1)'}`,
                      background: active ? m.lt : '#fff', cursor: 'pointer', transition: 'all .15s', outline: 'none',
                      boxShadow: active ? `0 2px 10px ${m.color}20` : 'var(--shadow-xs)',
                      transform: active ? 'translateY(-1px)' : 'none',
                    }}
                    onMouseEnter={e => { if (!active) { e.currentTarget.style.boxShadow='var(--shadow-sm)'; e.currentTarget.style.transform='translateY(-1px)' } }}
                    onMouseLeave={e => { if (!active) { e.currentTarget.style.boxShadow='var(--shadow-xs)'; e.currentTarget.style.transform='none' } }}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: active ? m.color : 'var(--t4)', boxShadow: active ? `0 0 0 3px ${m.color}25` : 'none' }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: active ? m.color : 'var(--t2)' }}>{m.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--t4)', fontFamily: 'var(--ff-mono)' }}>{m.tps}</span>
                  </button>
                )
              })}
            </div>

            {/* Hero input */}
            <div className="anim-slide-up" style={{ width: '100%', maxWidth: 640, padding: '0 24px', marginBottom: 24, animationDelay: '130ms' }}>
              <div style={{
                background: '#fff', border: '1.5px solid var(--b1)', borderRadius: 20,
                padding: '16px 18px 12px',
                boxShadow: '0 4px 20px rgba(60,40,20,.08)',
                transition: 'border-color .15s, box-shadow .15s',
              }}
                onFocusCapture={e => { e.currentTarget.style.borderColor='var(--coral)'; e.currentTarget.style.boxShadow='0 0 0 3px var(--coral-mid),0 4px 20px rgba(60,40,20,.08)' }}
                onBlurCapture={e => { e.currentTarget.style.borderColor='var(--b1)'; e.currentTarget.style.boxShadow='0 4px 20px rgba(60,40,20,.08)' }}
              >
                <textarea ref={inputRef} rows={3}
                  placeholder="Ask me anything — weather, news, math, general knowledge…"
                  onKeyDown={handleKey}
                  onChange={() => recalcContext(chatMessages, inputRef.current?.value ?? '')}
                  style={{ width: '100%', background: 'transparent', border: 'none', resize: 'none', outline: 'none', fontSize: 15, fontFamily: 'var(--ff-body)', color: 'var(--t1)', lineHeight: 1.65, marginBottom: 10 }}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, color: 'var(--t4)' }}><kbd>Ctrl</kbd>+<kbd>Enter</kbd> to send</span>
                  <button className="btn btn-primary" onClick={() => send()} style={{ borderRadius: 12, padding: '8px 20px', fontSize: 14 }}>
                    <Send size={14} /> Send
                  </button>
                </div>
              </div>
            </div>

            {/* Suggestion cards */}
            <div className="anim-slide-up" style={{ width: '100%', maxWidth: 640, padding: '0 24px', animationDelay: '170ms' }}>
              <div className="label" style={{ textAlign: 'center', marginBottom: 12, display: 'block' }}>Powered suggestions</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 9 }}>
                {SUGGESTIONS.map(({ icon: Icon, color, lt, text, tool }) => (
                  <button key={text} onClick={() => send(text)}
                    style={{ background: '#fff', border: '1px solid var(--b1)', borderRadius: 13, padding: '13px 14px', cursor: 'pointer', textAlign: 'left', transition: 'all .18s', boxShadow: 'var(--shadow-xs)', position: 'relative', overflow: 'hidden' }}
                    onMouseEnter={e => { e.currentTarget.style.transform='translateY(-3px)'; e.currentTarget.style.boxShadow='var(--shadow-md)'; e.currentTarget.style.borderColor=color+'40'; e.currentTarget.style.background=lt }}
                    onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='var(--shadow-xs)'; e.currentTarget.style.borderColor='var(--b1)'; e.currentTarget.style.background='#fff' }}
                  >
                    <ArrowUpRight size={11} color="var(--t5)" style={{ position: 'absolute', top: 9, right: 9 }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
                      <div style={{ width: 24, height: 24, borderRadius: 7, background: lt, border: `1px solid ${color}20`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                        <Icon size={11} color={color} />
                      </div>
                      <span style={{ fontSize: 9, fontWeight: 700, color, fontFamily: 'var(--ff-mono)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{tool}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.45 }}>{text}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

        ) : (

          /* ══ ACTIVE CHAT ══ */
          <>
            {/* Model strip */}
            <div style={{ padding: '8px 24px', borderBottom: '1px solid var(--b1)', display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, background: '#fff' }}>
              <span className="label" style={{ marginRight: 4 }}>Model</span>
              {MODELS.map(m => {
                const active = chatModel === m.id
                return (
                  <button key={m.id} onClick={() => setChatModel(m.id)} disabled={chatStreaming}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '4px 11px', borderRadius: 99,
                      border: `1px solid ${active ? m.color+'45' : 'var(--b1)'}`,
                      background: active ? m.lt : 'transparent', cursor: 'pointer',
                      transition: 'all .13s', outline: 'none', fontSize: 11, fontWeight: 600,
                      color: active ? m.color : 'var(--t3)',
                    }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: active ? m.color : 'var(--t4)' }} />
                    {m.label}
                  </button>
                )
              })}
            </div>

            {/* Messages scroll area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 8px' }}>
              <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {chatMessages.map((msg, i) => (
                  <MessageBubble
                    key={msg.id} msg={msg}
                    isLast={i === chatMessages.length - 1}
                    streaming={chatStreaming}
                    modelColor={modelColor} modelLt={modelLt}
                    editingId={editingId} editText={editText}
                    setEditText={setEditText}
                    onCopy={copyMessage} copied={copied}
                    onEdit={startEdit} onEditSubmit={submitEdit}
                    onEditCancel={() => { setEditingId(null); setEditText('') }}
                  />
                ))}
                <div ref={bottomRef} />
              </div>
            </div>

            {/* ── STATIC BOTTOM BAR (never scrolls away) ── */}
            <div style={{ flexShrink: 0, borderTop: '1px solid var(--b1)', background: '#fff' }}>

              {/* Tool running indicator */}
              {activeTool && (
                <div className="anim-tool-pop" style={{ padding: '8px 24px' }}>
                  <ToolRunningBadge tool={activeTool.tool} args={activeTool.args} />
                </div>
              )}

              {/* Live metrics */}
              {chatStreaming && !activeTool && (
                <div style={{ display: 'flex', borderBottom: '1px solid var(--b0)' }}>
                  <MetricCell label="Live TPS" val={liveTps ?? '…'} unit="tok/s" color={modelColor} showBar maxTps={maxTps} liveTps={liveTps} flex={2} />
                  <MetricCell label="TTFT"   val={liveTtft !== null ? `${liveTtft}ms` : '…'} color="var(--teal)" />
                  <MetricCell label="Tokens" val={liveTokens} color="var(--sage)" last />
                </div>
              )}

              {/* Final stats */}
              {chatStats && !chatStreaming && (
                <div style={{ display: 'flex', borderBottom: '1px solid var(--b0)' }}>
                  <MetricCell label="TPS"    val={chatStats.tps}           unit="tok/s" color={modelColor} />
                  <MetricCell label="TTFT"   val={`${chatStats.ttft_ms}ms`}             color="var(--teal)" />
                  <MetricCell label="Tokens" val={chatStats.tokens}                      color="var(--sage)" />
                  <MetricCell label="Tools"  val={chatStats.tool_count ?? 0} unit={chatStats.tool_count === 1 ? 'call' : 'calls'} color="var(--plum)" last />
                </div>
              )}

              {/* Input area */}
              <div style={{ padding: '12px 24px 14px', maxWidth: 760, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
                <div style={{
                  background: '#fff', border: `1.5px solid ${chatStreaming ? 'rgba(232,97,58,.35)' : 'var(--b1)'}`,
                  borderRadius: 14, padding: '10px 14px',
                  boxShadow: chatStreaming ? '0 0 0 3px var(--coral-mid)' : 'var(--shadow-sm)',
                  transition: 'all .15s',
                }}>
                  <textarea
                    ref={inputRef}
                    rows={inputExpanded ? 8 : 2}
                    placeholder="Ask anything…"
                    disabled={chatStreaming}
                    onKeyDown={handleKey}
                    onChange={() => recalcContext(chatMessages, inputRef.current?.value ?? '')}
                    style={{
                      width: '100%', background: 'transparent', border: 'none',
                      resize: 'none', outline: 'none', fontSize: 14,
                      fontFamily: 'var(--ff-body)', color: 'var(--t1)',
                      lineHeight: 1.6, marginBottom: 8,
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 11, color: 'var(--t4)' }}>
                        <kbd>Ctrl</kbd>+<kbd>Enter</kbd>
                      </span>
                      {/* Expand toggle */}
                      <button onClick={() => setInputExpanded(e => !e)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t4)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 4px', borderRadius: 5 }}
                        title={inputExpanded ? 'Collapse input' : 'Expand input'}
                        onMouseEnter={e => { e.currentTarget.style.color='var(--t1)'; e.currentTarget.style.background='var(--s3)' }}
                        onMouseLeave={e => { e.currentTarget.style.color='var(--t4)'; e.currentTarget.style.background='none' }}
                      >
                        {inputExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                        <span>{inputExpanded ? 'Collapse' : 'Expand'}</span>
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {chatStreaming
                        ? <button className="btn btn-danger btn-sm" onClick={stop}><Square size={11} fill="currentColor" /> Stop</button>
                        : <button className="btn btn-primary btn-sm" onClick={() => send()} style={{ borderRadius: 10 }}><Send size={12} /> Send</button>
                      }
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ── Metric cell ─────────────────────────────────────────────── */
function MetricCell({ label, val, unit, color, last, flex = 1, showBar, maxTps, liveTps }) {
  return (
    <div style={{ flex, padding: '8px 16px', borderRight: last ? 'none' : '1px solid var(--b0)' }}>
      <div className="label" style={{ marginBottom: 3, display: 'block' }}>{label}</div>
      <span style={{ fontFamily: 'var(--ff-mono)', fontSize: 14, fontWeight: 700, color }}>
        {val}
        {unit && <span style={{ fontSize: 10, color: 'var(--t4)', marginLeft: 3 }}>{unit}</span>}
      </span>
      {showBar && (
        <div className="tps-bar-track" style={{ marginTop: 4 }}>
          <div className="tps-bar-fill" style={{ width: `${Math.min((parseFloat(liveTps) / maxTps) * 100 || 0, 100)}%`, background: `linear-gradient(90deg,${color}70,${color})` }} />
        </div>
      )}
    </div>
  )
}

/* ── Tool running badge ──────────────────────────────────────── */
function ToolRunningBadge({ tool, args }) {
  const meta = TOOL_META[tool] ?? { icon: Wrench, label: tool, color: 'var(--coral)', lt: 'var(--coral-lt)' }
  const Icon = meta.icon
  const argVal = (args && Object.values(args)[0]?.toString().slice(0, 50)) ?? ''
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', background: meta.lt, border: `1px solid ${meta.color}25`, borderRadius: 10 }}>
      <div className="spinner" style={{ borderTopColor: meta.color, borderColor: `${meta.color}20` }} />
      <div style={{ width: 24, height: 24, borderRadius: 7, background: meta.color+'18', display: 'grid', placeItems: 'center' }}>
        <Icon size={11} color={meta.color} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: meta.color }}>{meta.label}</span>
      {argVal && <span style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--ff-mono)' }}>"{argVal}"</span>}
      <span style={{ fontSize: 10, color: 'var(--t4)', marginLeft: 'auto', fontFamily: 'var(--ff-mono)' }}>fetching…</span>
    </div>
  )
}

/* ── Tool call log ───────────────────────────────────────────── */
function ToolCallLog({ toolCalls }) {
  const [open, setOpen] = useState(false)
  if (!toolCalls?.length) return null
  return (
    <div style={{ marginBottom: 7 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', color: 'var(--t4)', fontSize: 11, fontFamily: 'var(--ff-mono)' }}>
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        <Wrench size={9} />
        {toolCalls.length} tool call{toolCalls.length !== 1 ? 's' : ''}
        {toolCalls.every(t => t.done) && <CheckCircle size={9} color="var(--sage)" />}
      </button>
      {open && (
        <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {toolCalls.map((tc, i) => {
            const meta = TOOL_META[tc.tool] ?? { icon: Wrench, label: tc.tool, color: 'var(--coral)', lt: 'var(--coral-lt)' }
            const Icon = meta.icon
            const argVal = (tc.args && Object.values(tc.args)[0]?.toString().slice(0, 40)) ?? ''
            return (
              <div key={i} style={{ borderRadius: 9, border: `1px solid ${meta.color}20`, overflow: 'hidden', borderLeft: `2px solid ${meta.color}`, fontSize: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: meta.lt }}>
                  <Icon size={10} color={meta.color} />
                  <span style={{ fontWeight: 700, color: meta.color, fontFamily: 'var(--ff-mono)' }}>{meta.label}</span>
                  {argVal && <span style={{ color: 'var(--t3)' }}>"{argVal}"</span>}
                  <div style={{ marginLeft: 'auto' }}>
                    {tc.done ? <CheckCircle size={10} color="var(--sage)" /> : <div className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5, borderTopColor: meta.color, borderColor: `${meta.color}20` }} />}
                  </div>
                </div>
                {tc.result && (
                  <div style={{ padding: '6px 10px', color: 'var(--t2)', lineHeight: 1.5, maxHeight: 64, overflow: 'hidden', position: 'relative', fontFamily: 'var(--ff-mono)', fontSize: 11 }}>
                    {tc.result.slice(0, 200)}{tc.result.length > 200 ? '…' : ''}
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 20, background: 'linear-gradient(transparent,#fff)' }} />
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

/* ── Message bubble with edit + copy ────────────────────────── */
function MessageBubble({ msg, isLast, streaming, modelColor, modelLt, editingId, editText, setEditText, onCopy, copied, onEdit, onEditSubmit, onEditCancel }) {
  const [hovered, setHovered] = useState(false)
  const isUser      = msg.role === 'user'
  const isStreaming = isLast && streaming && !isUser
  const isEditing   = editingId === msg.id
  const wasCopied   = copied === msg.id

  return (
    <div
      className="anim-fade-up"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', flexDirection: isUser ? 'row-reverse' : 'row', gap: 10, padding: '5px 0', alignItems: 'flex-start', position: 'relative' }}
    >
      {/* Avatar */}
      <div style={{
        width: 30, height: 30, borderRadius: 9, flexShrink: 0,
        display: 'grid', placeItems: 'center',
        background: isUser ? 'var(--canvas)' : modelLt,
        border: `1px solid ${isUser ? 'var(--b1)' : modelColor+'25'}`,
        boxShadow: isUser ? 'none' : `0 2px 8px ${modelColor}12`,
      }}>
        {isUser ? <User size={13} color="var(--t3)" /> : <Bot size={13} color={modelColor} />}
      </div>

      {/* Bubble */}
      <div style={{
        maxWidth: '76%',
        background: isUser ? '#fff' : 'transparent',
        border: isUser ? '1px solid var(--b1)' : 'none',
        borderRadius: isUser ? '13px 3px 13px 13px' : '3px 13px 13px 13px',
        padding: isUser ? '10px 14px' : '1px 0',
        boxShadow: isUser ? 'var(--shadow-xs)' : 'none',
        color: msg.error ? 'var(--rose)' : 'var(--t1)',
      }}>
        {/* Model label */}
        {!isUser && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, fontFamily: 'var(--ff-mono)', fontSize: 10, color: modelColor }}>
            <Zap size={8} strokeWidth={3} /> {msg.model}
          </div>
        )}

        {/* Tool log */}
        {!isUser && <ToolCallLog toolCalls={msg.toolCalls} />}

        {/* Editing user message */}
        {isEditing ? (
          <div>
            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              autoFocus
              rows={3}
              style={{ width: '100%', background: 'var(--s3)', border: '1px solid var(--coral)', borderRadius: 8, padding: '8px 10px', outline: 'none', fontFamily: 'var(--ff-body)', fontSize: 14, color: 'var(--t1)', resize: 'vertical' }}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onEditSubmit(msg.id); if (e.key === 'Escape') onEditCancel() }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button className="btn btn-primary btn-sm" onClick={() => onEditSubmit(msg.id)}><Check size={11} /> Send</button>
              <button className="btn btn-ghost btn-sm" onClick={onEditCancel}><X size={11} /> Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 14, lineHeight: 1.78, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: msg.error ? 'var(--rose)' : isUser ? 'var(--t1)' : 'var(--t2)' }}>
            {msg.content || (isStreaming && <span style={{ color: 'var(--t4)', fontStyle: 'italic', fontSize: 13 }}>Thinking…</span>)}
            {isStreaming && msg.content && <span className="stream-cursor" />}
          </div>
        )}
      </div>

      {/* Hover actions */}
      {hovered && !isEditing && !isStreaming && msg.content && (
        <div style={{
          display: 'flex', gap: 4,
          position: 'absolute', top: 4,
          ...(isUser ? { left: 46 } : { right: 46 }),
          background: '#fff', border: '1px solid var(--b1)',
          borderRadius: 8, padding: '3px 5px',
          boxShadow: 'var(--shadow-md)', zIndex: 10,
        }}>
          <button
            onClick={() => onCopy(msg.content, msg.id)}
            title="Copy"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 5px', borderRadius: 5, color: wasCopied ? 'var(--sage)' : 'var(--t3)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
            onMouseEnter={e => { e.currentTarget.style.background='var(--s3)'; e.currentTarget.style.color='var(--t1)' }}
            onMouseLeave={e => { e.currentTarget.style.background='none'; e.currentTarget.style.color=wasCopied?'var(--sage)':'var(--t3)' }}
          >
            {wasCopied ? <Check size={11} /> : <Copy size={11} />}
            {wasCopied ? 'Copied' : 'Copy'}
          </button>
          {isUser && (
            <button
              onClick={() => onEdit(msg)}
              title="Edit & resend"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 5px', borderRadius: 5, color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
              onMouseEnter={e => { e.currentTarget.style.background='var(--s3)'; e.currentTarget.style.color='var(--t1)' }}
              onMouseLeave={e => { e.currentTarget.style.color='var(--t3)'; e.currentTarget.style.background='none' }}
            >
              <Pencil size={11} /> Edit
            </button>
          )}
        </div>
      )}
    </div>
  )
}