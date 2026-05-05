/**
 * AppContext.jsx — v7
 * 
 * NEW:
 *  - toolsEnabled flag (toggles ReAct loop in backend)
 *  - chatSessions: persisted conversation list (localStorage)
 *  - activeChatId: which session is open
 *  - contextTokens: estimated tokens being sent per request
 */
import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'

const AppContext = createContext(null)

// ── Rough token estimator: ~4 chars per token ─────────────────────
export function estimateTokens(text) {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

// Context window sizes per model
export const CONTEXT_WINDOWS = {
  'phi3:mini':                   4096,
  'mistral:7b-instruct-q4_K_M': 8192,
  'llama3:8b-instruct-q4_K_M':  8192,
}

// ── Session helpers ───────────────────────────────────────────────
function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem('ollama_sessions') || '[]')
  } catch { return [] }
}

function saveSessions(sessions) {
  try {
    localStorage.setItem('ollama_sessions', JSON.stringify(sessions))
  } catch {}
}

function newSession() {
  return {
    id:        Date.now().toString(),
    title:     'New Chat',
    createdAt: new Date().toISOString(),
    messages:  [],
    model:     'phi3:mini',
  }
}

export function AppProvider({ children }) {
  // ── Chat state ────────────────────────────────────────────────
  const [sessions, setSessions]           = useState(() => loadSessions())
  const [activeChatId, setActiveChatId]   = useState(null)

  // Derive current session
  const activeSession = sessions.find(s => s.id === activeChatId) ?? null
  const chatMessages  = activeSession?.messages ?? []
  const chatModel     = activeSession?.model ?? 'phi3:mini'

  const [chatStats,     setChatStats]     = useState(null)
  const [chatStreaming,  setChatStreaming]  = useState(false)
  const chatAbortRef = useRef(null)

  // ── Tools toggle ──────────────────────────────────────────────
  const [toolsEnabled, setToolsEnabled] = useState(true)

  // ── Context window ────────────────────────────────────────────
  const [contextTokens, setContextTokens] = useState(0)

  // ── Layout ────────────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // ── Benchmark / Compare / Report ──────────────────────────────
  const [benchResult,     setBenchResult]     = useState(null)
  const [benchLoading,    setBenchLoading]    = useState(false)
  const [benchModel,      setBenchModel]      = useState('phi3:mini')
  const [benchRuns,       setBenchRuns]       = useState(3)
  const [benchPrompt,     setBenchPrompt]     = useState('')
  const [compareResult,   setCompareResult]   = useState(null)
  const [compareLoading,  setCompareLoading]  = useState(false)
  const [comparePrompt,   setComparePrompt]   = useState('Explain quantum entanglement in simple terms.')
  const [compareRuns,     setCompareRuns]     = useState(2)
  const [report,          setReport]          = useState(null)
  const [reportLoading,   setReportLoading]   = useState(false)

  // ── Persist sessions on change ────────────────────────────────
  useEffect(() => { saveSessions(sessions) }, [sessions])

  // ── Session CRUD ──────────────────────────────────────────────
  const createSession = useCallback(() => {
    const s = newSession()
    setSessions(prev => [s, ...prev])
    setActiveChatId(s.id)
    setChatStats(null)
    return s.id
  }, [])

  const deleteSession = useCallback((id) => {
    setSessions(prev => prev.filter(s => s.id !== id))
    setActiveChatId(prev => prev === id ? null : prev)
  }, [])

  const renameSession = useCallback((id, title) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title } : s))
  }, [])

  // Update messages in current session
  const setChatMessages = useCallback((updater) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== activeChatId) return s
      const newMsgs = typeof updater === 'function' ? updater(s.messages) : updater
      // Auto-title from first user message
      const firstUser = newMsgs.find(m => m.role === 'user')
      const title = firstUser
        ? firstUser.content.slice(0, 40) + (firstUser.content.length > 40 ? '…' : '')
        : s.title
      return { ...s, messages: newMsgs, title }
    }))
  }, [activeChatId])

  // Update model in current session
  const setChatModel = useCallback((model) => {
    setSessions(prev => prev.map(s =>
      s.id === activeChatId ? { ...s, model } : s
    ))
  }, [activeChatId])

  const clearChat = useCallback(() => {
    if (chatStreaming) return
    setChatMessages([])
    setChatStats(null)
    setContextTokens(0)
  }, [chatStreaming, setChatMessages])

  // ── Context token calculator ──────────────────────────────────
  const recalcContext = useCallback((messages, currentPrompt = '') => {
    const systemPromptTokens = 350  // approximate system prompt size
    const historyTokens = messages
      .filter(m => m.content)
      .reduce((sum, m) => sum + estimateTokens(m.content), 0)
    const promptTokens = estimateTokens(currentPrompt)
    setContextTokens(systemPromptTokens + historyTokens + promptTokens)
  }, [])

  return (
    <AppContext.Provider value={{
      // Sessions
      sessions, setSessions,
      activeChatId, setActiveChatId,
      activeSession,
      createSession, deleteSession, renameSession,

      // Current chat (derived from active session)
      chatMessages, setChatMessages,
      chatModel, setChatModel,
      chatStats, setChatStats,
      chatStreaming, setChatStreaming,
      chatAbortRef,
      clearChat,

      // Tools
      toolsEnabled, setToolsEnabled,

      // Context window
      contextTokens, setContextTokens, recalcContext,

      // Layout
      sidebarCollapsed, setSidebarCollapsed,

      // Benchmark
      benchResult, setBenchResult,
      benchLoading, setBenchLoading,
      benchModel, setBenchModel,
      benchRuns, setBenchRuns,
      benchPrompt, setBenchPrompt,

      // Compare
      compareResult, setCompareResult,
      compareLoading, setCompareLoading,
      comparePrompt, setComparePrompt,
      compareRuns, setCompareRuns,

      // Report
      report, setReport,
      reportLoading, setReportLoading,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export const useApp = () => {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be inside AppProvider')
  return ctx
}