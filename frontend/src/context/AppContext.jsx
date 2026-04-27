/**
 * AppContext.jsx
 * 
 * SOLVES TWO PROBLEMS:
 * 1. State reset on tab switch — React unmounts components on navigation,
 *    wiping local state. Lifting state here means it lives above the router
 *    and survives tab switches.
 * 2. Memory / chat history — messages persist across the session.
 */

import { createContext, useContext, useState, useRef, useCallback } from 'react'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  // ── Chat state (persists across tab switches) ────────────────────────
  const [chatMessages, setChatMessages]   = useState([])
  const [chatModel, setChatModel]         = useState('phi3:mini')
  const [chatStats, setChatStats]         = useState(null)
  const [chatStreaming, setChatStreaming]  = useState(false)
  const chatAbortRef = useRef(null)

  // ── Benchmark state ──────────────────────────────────────────────────
  const [benchResult, setBenchResult]     = useState(null)
  const [benchLoading, setBenchLoading]   = useState(false)
  const [benchModel, setBenchModel]       = useState('phi3:mini')
  const [benchRuns, setBenchRuns]         = useState(3)
  const [benchPrompt, setBenchPrompt]     = useState('')

  // ── Compare state ────────────────────────────────────────────────────
  const [compareResult, setCompareResult] = useState(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const [comparePrompt, setComparePrompt] = useState('Explain quantum entanglement in simple terms.')
  const [compareRuns, setCompareRuns]     = useState(2)

  // ── Report state ─────────────────────────────────────────────────────
  const [report, setReport]               = useState(null)
  const [reportLoading, setReportLoading] = useState(false)

  // ── Sidebar collapsed ─────────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const clearChat = useCallback(() => {
    if (!chatStreaming) {
      setChatMessages([])
      setChatStats(null)
    }
  }, [chatStreaming])

  return (
    <AppContext.Provider value={{
      // Chat
      chatMessages, setChatMessages,
      chatModel, setChatModel,
      chatStats, setChatStats,
      chatStreaming, setChatStreaming,
      chatAbortRef,
      clearChat,

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

      // Layout
      sidebarCollapsed, setSidebarCollapsed,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export const useApp = () => {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}