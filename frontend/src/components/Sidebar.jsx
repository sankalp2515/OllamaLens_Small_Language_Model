import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  MessageSquare, Gauge, GitCompare, FileText,
  Zap, ChevronLeft, ChevronRight, Plus,
  Trash2, Pencil, Check, X, Wrench, WrenchIcon,
  ToggleLeft, ToggleRight
} from 'lucide-react'
import { getHealth } from '../api/client'
import { useApp, CONTEXT_WINDOWS, estimateTokens } from '../context/AppContext'

export const MODELS = [
  { id: 'phi3:mini',                   label: 'Phi-3 Mini',  vram: '2.3 GB', tps: '~63', color: '#e8613a', lt: '#fef3ee', border: 'rgba(232,97,58,.25)',  grad: 'linear-gradient(135deg,#e8613a,#f97316)' },
  { id: 'mistral:7b-instruct-q4_K_M', label: 'Mistral 7B',  vram: '4.1 GB', tps: '~28', color: '#7c3d6e', lt: '#fdf4ff', border: 'rgba(124,61,110,.25)', grad: 'linear-gradient(135deg,#7c3d6e,#a855f7)' },
  { id: 'llama3:8b-instruct-q4_K_M',  label: 'Llama 3 8B',  vram: '4.7 GB', tps: '~22', color: '#0d9488', lt: '#f0fdfa', border: 'rgba(13,148,136,.25)', grad: 'linear-gradient(135deg,#0d9488,#14b8a6)' },
]

const NAV_PAGES = [
  { to: '/benchmark', icon: Gauge,      label: 'Benchmark', sub: 'TTFT & TPS'   },
  { to: '/compare',   icon: GitCompare, label: 'Compare',   sub: 'Side-by-side' },
  { to: '/report',    icon: FileText,   label: 'Report',    sub: 'Analysis'     },
]

/* ── Rename inline input ─────────────────────────────────────── */
function RenameInput({ value, onSave, onCancel }) {
  const [val, setVal] = useState(value)
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
      <input
        ref={ref}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onSave(val); if (e.key === 'Escape') onCancel() }}
        style={{
          flex: 1, fontSize: 12, fontFamily: 'var(--ff-body)',
          background: 'var(--s1)', border: '1px solid var(--coral)',
          borderRadius: 5, padding: '2px 6px', outline: 'none',
          color: 'var(--t1)', minWidth: 0,
        }}
      />
      <button onClick={() => onSave(val)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sage)', padding: 2 }}>
        <Check size={11} />
      </button>
      <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t4)', padding: 2 }}>
        <X size={11} />
      </button>
    </div>
  )
}

/* ══════════════════════════════════════════
   SIDEBAR
══════════════════════════════════════════ */
export function Sidebar() {
  const {
    sidebarCollapsed, setSidebarCollapsed,
    sessions, activeChatId, setActiveChatId,
    createSession, deleteSession, renameSession,
    chatStreaming, benchLoading, compareLoading,
    toolsEnabled, setToolsEnabled,
    contextTokens, chatModel,
  } = useApp()

  const [online, setOnline]       = useState(false)
  const [renamingId, setRenamingId] = useState(null)
  const [hoverId, setHoverId]     = useState(null)
  const navigate = useNavigate()
  const w = sidebarCollapsed ? 64 : 240

  useEffect(() => {
    const check = () => getHealth().then(() => setOnline(true)).catch(() => setOnline(false))
    check()
    const id = setInterval(check, 8000)
    return () => clearInterval(id)
  }, [])

  const busy = chatStreaming || benchLoading || compareLoading

  const handleNewChat = () => {
    createSession()
    navigate('/')
  }

  const handleSelectChat = (id) => {
    setActiveChatId(id)
    navigate('/')
  }

  // Context window display
  const ctxWindow = CONTEXT_WINDOWS[chatModel] ?? 4096
  const ctxPct    = Math.min((contextTokens / ctxWindow) * 100, 100)
  const ctxColor  = ctxPct > 80 ? 'var(--rose)' : ctxPct > 60 ? 'var(--amber)' : 'var(--sage)'

  return (
    <aside style={{
      width: w, minHeight: '100vh', flexShrink: 0,
      background: '#fff',
      borderRight: '1px solid var(--b1)',
      boxShadow: '2px 0 16px rgba(60,40,20,.04)',
      display: 'flex', flexDirection: 'column',
      position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50,
      transition: 'width .22s cubic-bezier(.4,0,.2,1)',
      overflow: 'hidden',
    }}>
      {/* Accent line */}
      <div className="accent-line" style={{ position: 'absolute', top: 0, left: 0, right: 0, borderRadius: 0 }} />

      {/* Logo + collapse */}
      <div style={{
        height: 62, padding: sidebarCollapsed ? '0 14px' : '0 14px',
        borderBottom: '1px solid var(--b1)',
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0, marginTop: 3,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9, flexShrink: 0,
            background: 'linear-gradient(135deg,var(--coral),#f97316)',
            display: 'grid', placeItems: 'center',
            boxShadow: '0 3px 10px rgba(232,97,58,.3)',
          }}>
            <Zap size={14} color="#fff" strokeWidth={2.5} />
          </div>
          {!sidebarCollapsed && (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--ff-body)', fontSize: 15, fontWeight: 800, color: 'var(--t1)', letterSpacing: '-.5px' }}>
                Ollama<span style={{ color: 'var(--coral)' }}>Lens</span>
              </div>
              <div style={{ fontSize: 9, color: 'var(--t4)', fontFamily: 'var(--ff-mono)' }}>Local AI</div>
            </div>
          )}
        </div>
        <button
          onClick={() => setSidebarCollapsed(c => !c)}
          style={{ background: 'var(--s3)', border: '1px solid var(--b1)', width: 24, height: 24, borderRadius: 6, cursor: 'pointer', display: 'grid', placeItems: 'center', color: 'var(--t4)', flexShrink: 0 }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--s4)'; e.currentTarget.style.color = 'var(--t1)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--s3)'; e.currentTarget.style.color = 'var(--t4)' }}
        >
          {sidebarCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </div>

      {/* New chat button */}
      <div style={{ padding: '10px 10px 6px', flexShrink: 0 }}>
        <button
          onClick={handleNewChat}
          style={{
            width: '100%', display: 'flex', alignItems: 'center',
            gap: 8, padding: sidebarCollapsed ? '8px 0' : '8px 12px',
            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
            background: 'var(--coral-lt)', border: '1px solid rgba(232,97,58,.2)',
            borderRadius: 9, cursor: 'pointer', transition: 'all .15s', outline: 'none',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(232,97,58,.15)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--coral-lt)' }}
        >
          <Plus size={14} color="var(--coral)" strokeWidth={2.5} />
          {!sidebarCollapsed && (
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--coral)' }}>New Chat</span>
          )}
        </button>
      </div>

      {/* Chat history */}
      {!sidebarCollapsed && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 10px' }}>
          {sessions.length > 0 && (
            <div className="label" style={{ padding: '4px 2px 6px', display: 'block' }}>Recent</div>
          )}
          {sessions.map(session => {
            const isActive  = session.id === activeChatId
            const isRenaming = renamingId === session.id
            const isHovered  = hoverId === session.id

            return (
              <div
                key={session.id}
                onMouseEnter={() => setHoverId(session.id)}
                onMouseLeave={() => setHoverId(null)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 9px', borderRadius: 8, marginBottom: 2,
                  cursor: 'pointer', transition: 'all .13s',
                  background: isActive ? 'var(--coral-lt)' : isHovered ? 'var(--s3)' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(232,97,58,.18)' : 'transparent'}`,
                }}
                onClick={() => !isRenaming && handleSelectChat(session.id)}
              >
                <MessageSquare size={12} color={isActive ? 'var(--coral)' : 'var(--t4)'} style={{ flexShrink: 0 }} />

                {isRenaming ? (
                  <RenameInput
                    value={session.title}
                    onSave={v => { renameSession(session.id, v || 'New Chat'); setRenamingId(null) }}
                    onCancel={() => setRenamingId(null)}
                  />
                ) : (
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, fontWeight: isActive ? 600 : 400,
                      color: isActive ? 'var(--coral)' : 'var(--t2)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {session.title}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--t4)', marginTop: 1 }}>
                      {session.messages.filter(m => m.role === 'user').length} messages
                    </div>
                  </div>
                )}

                {/* Actions */}
                {isHovered && !isRenaming && (
                  <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => setRenamingId(session.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t4)', padding: '2px 3px', borderRadius: 4 }}
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--t1)'; e.currentTarget.style.background = 'var(--s4)' }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--t4)'; e.currentTarget.style.background = 'none' }}
                      title="Rename">
                      <Pencil size={10} />
                    </button>
                    <button onClick={() => deleteSession(session.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t4)', padding: '2px 3px', borderRadius: 4 }}
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--rose)'; e.currentTarget.style.background = 'var(--rose-lt)' }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--t4)'; e.currentTarget.style.background = 'none' }}
                      title="Delete">
                      <Trash2 size={10} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          {sessions.length === 0 && (
            <div style={{ padding: '20px 8px', textAlign: 'center', color: 'var(--t4)', fontSize: 12 }}>
              No chats yet.<br />Click "New Chat" to start.
            </div>
          )}
        </div>
      )}

      {/* Pages nav (collapsed: show icons; expanded: bottom section) */}
      <div style={{ padding: '8px 10px', borderTop: '1px solid var(--b1)', flexShrink: 0 }}>
        {!sidebarCollapsed && (
          <div className="label" style={{ padding: '0 2px 8px', display: 'block' }}>Tools</div>
        )}
        {NAV_PAGES.map(({ to, icon: Icon, label, sub }) => (
          <NavLink key={to} to={to} style={{ textDecoration: 'none', display: 'block', marginBottom: 2 }}>
            {({ isActive }) => (
              <div
                title={sidebarCollapsed ? label : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: sidebarCollapsed ? '9px 0' : '7px 9px',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  borderRadius: 8, cursor: 'pointer', transition: 'all .13s',
                  background: isActive ? 'var(--coral-lt)' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(232,97,58,.18)' : 'transparent'}`,
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--s3)' }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
              >
                <Icon size={13} color={isActive ? 'var(--coral)' : 'var(--t3)'} />
                {!sidebarCollapsed && (
                  <span style={{ fontSize: 12, fontWeight: 500, color: isActive ? 'var(--coral)' : 'var(--t2)' }}>{label}</span>
                )}
              </div>
            )}
          </NavLink>
        ))}
      </div>

      {/* Tools toggle + Context window + Status */}
      {!sidebarCollapsed && (
        <div style={{ padding: '10px 10px 14px', borderTop: '1px solid var(--b1)', flexShrink: 0 }}>
          {/* Tools toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 10px', background: 'var(--canvas)', borderRadius: 9,
            border: '1px solid var(--b1)', marginBottom: 8, cursor: 'pointer',
          }} onClick={() => setToolsEnabled(t => !t)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Wrench size={12} color={toolsEnabled ? 'var(--coral)' : 'var(--t4)'} />
              <span style={{ fontSize: 11, fontWeight: 600, color: toolsEnabled ? 'var(--t1)' : 'var(--t3)' }}>
                AI Tools
              </span>
            </div>
            <div style={{
              width: 34, height: 18, borderRadius: 99,
              background: toolsEnabled ? 'var(--coral)' : 'var(--s4)',
              position: 'relative', transition: 'background .2s', flexShrink: 0,
            }}>
              <div style={{
                position: 'absolute', top: 2,
                left: toolsEnabled ? 18 : 2,
                width: 14, height: 14, borderRadius: '50%',
                background: '#fff', transition: 'left .2s',
                boxShadow: '0 1px 3px rgba(0,0,0,.2)',
              }} />
            </div>
          </div>

          {/* Context window */}
          <div style={{ padding: '8px 10px', background: 'var(--canvas)', borderRadius: 9, border: '1px solid var(--b1)', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Context</span>
              <span style={{ fontSize: 10, fontFamily: 'var(--ff-mono)', color: ctxColor, fontWeight: 600 }}>
                {contextTokens.toLocaleString()} / {ctxWindow.toLocaleString()}
              </span>
            </div>
            <div style={{ height: 3, background: 'var(--s4)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 99,
                background: ctxColor,
                width: `${ctxPct}%`,
                transition: 'width .3s ease',
              }} />
            </div>
            <div style={{ fontSize: 9, color: 'var(--t4)', marginTop: 4, fontFamily: 'var(--ff-mono)' }}>
              {ctxPct.toFixed(0)}% of {ctxWindow.toLocaleString()} token window
            </div>
          </div>

          {/* Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className={`status-dot ${online ? 'online' : 'offline'}`} />
            <span style={{ fontSize: 10, fontWeight: 600, color: online ? 'var(--sage)' : 'var(--rose)' }}>
              {online ? 'API online' : 'API offline'}
            </span>
            {busy && <div className="spinner" style={{ marginLeft: 'auto', width: 11, height: 11 }} />}
          </div>
        </div>
      )}

      {/* Collapsed: just status dot + tools indicator */}
      {sidebarCollapsed && (
        <div style={{ padding: '12px 0', borderTop: '1px solid var(--b1)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div className={`status-dot ${online ? 'online' : 'offline'}`} />
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: toolsEnabled ? 'var(--coral)' : 'var(--t4)' }}
            title={toolsEnabled ? 'Tools ON' : 'Tools OFF'} />
        </div>
      )}
    </aside>
  )
}