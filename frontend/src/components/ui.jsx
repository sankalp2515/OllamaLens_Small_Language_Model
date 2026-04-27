import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  MessageSquare, Gauge, GitCompare, FileText,
  Zap, ChevronLeft, ChevronRight,
  Activity, Clock, Cpu, TrendingUp
} from 'lucide-react'
import { getHealth } from '../api/client'
import { useApp } from '../context/AppContext'

/* ── Nav ─────────────────────────────────────────────────── */
const NAV = [
  { to: '/',          icon: MessageSquare, label: 'Chat',      sub: 'Stream tokens'  },
  { to: '/benchmark', icon: Gauge,         label: 'Benchmark', sub: 'TTFT & TPS'     },
  { to: '/compare',   icon: GitCompare,    label: 'Compare',   sub: 'Side-by-side'   },
  { to: '/report',    icon: FileText,      label: 'Report',    sub: 'Analysis'       },
]

export const MODELS = [
  { id: 'phi3:mini',                   label: 'Phi-3 Mini',  vram: '2.3 GB', tps: '~63', color: '#4f46e5', lt: '#eef2ff', border: 'rgba(79,70,229,.25)'  },
  { id: 'mistral:7b-instruct-q4_K_M', label: 'Mistral 7B',  vram: '4.1 GB', tps: '~28', color: '#7c3aed', lt: '#f5f3ff', border: 'rgba(124,58,237,.25)' },
  { id: 'llama3:8b-instruct-q4_K_M',  label: 'Llama 3 8B',  vram: '4.7 GB', tps: '~22', color: '#059669', lt: '#ecfdf5', border: 'rgba(5,150,105,.25)'  },
]

/* ═══════════════════════════════════════════
   SIDEBAR
═══════════════════════════════════════════ */
export function Sidebar() {
  const [online, setOnline] = useState(false)
  const { sidebarCollapsed, setSidebarCollapsed, chatStreaming, benchLoading, compareLoading } = useApp()
  const w = sidebarCollapsed ? 60 : 220

  useEffect(() => {
    const check = () => getHealth().then(() => setOnline(true)).catch(() => setOnline(false))
    check()
    const id = setInterval(check, 8000)
    return () => clearInterval(id)
  }, [])

  const busy = chatStreaming || benchLoading || compareLoading
  const busyLabel = chatStreaming ? 'Streaming…' : benchLoading ? 'Benchmarking…' : 'Comparing…'

  return (
    <aside style={{
      width: w, minHeight: '100vh', flexShrink: 0,
      background: 'var(--s1)',
      borderRight: '1px solid var(--b1)',
      display: 'flex', flexDirection: 'column',
      position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50,
      transition: 'width .22s cubic-bezier(.4,0,.2,1)',
      overflow: 'hidden',
    }}>

      {/* Logo */}
      <div style={{
        height: 56, padding: sidebarCollapsed ? '0 12px' : '0 16px',
        borderBottom: '1px solid var(--b1)',
        display: 'flex', alignItems: 'center',
        justifyContent: sidebarCollapsed ? 'center' : 'space-between',
        flexShrink: 0,
      }}>
        {!sidebarCollapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7,
              background: 'var(--indigo-lt)', border: '1px solid rgba(79,70,229,.25)',
              display: 'grid', placeItems: 'center', flexShrink: 0,
            }}>
              <Zap size={13} color="var(--indigo)" strokeWidth={2.5} />
            </div>
            <span style={{ fontFamily: 'var(--ff-body)', fontSize: 15, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-.3px' }}>
              Ollama<span style={{ color: 'var(--indigo)' }}>Lens</span>
            </span>
          </div>
        )}
        {sidebarCollapsed && (
          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--indigo-lt)', border: '1px solid rgba(79,70,229,.25)', display: 'grid', placeItems: 'center' }}>
            <Zap size={13} color="var(--indigo)" strokeWidth={2.5} />
          </div>
        )}
        {!sidebarCollapsed && (
          <button onClick={() => setSidebarCollapsed(true)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)', padding: 4, borderRadius: 5, display: 'grid', placeItems: 'center' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--t1)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--t3)'}>
            <ChevronLeft size={14} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto', overflowX: 'hidden' }}>
        {!sidebarCollapsed && (
          <div className="label" style={{ padding: '4px 8px 8px', display: 'block' }}>Menu</div>
        )}
        {NAV.map(({ to, icon: Icon, label, sub }) => (
          <NavLink key={to} to={to} end={to === '/'} style={{ textDecoration: 'none', display: 'block', marginBottom: 2 }}>
            {({ isActive }) => (
              <div
                title={sidebarCollapsed ? label : undefined}
                style={{
                  display: 'flex', alignItems: 'center',
                  gap: 10, padding: sidebarCollapsed ? '10px 0' : '8px 10px',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  borderRadius: 8, cursor: 'pointer', transition: 'all .13s',
                  background: isActive ? 'var(--indigo-lt)' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(79,70,229,.2)' : 'transparent'}`,
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--s2)' }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
              >
                <Icon size={15} color={isActive ? 'var(--indigo)' : 'var(--t3)'} strokeWidth={isActive ? 2.5 : 2} style={{ flexShrink: 0 }} />
                {!sidebarCollapsed && (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: isActive ? 'var(--indigo)' : 'var(--t1)', lineHeight: 1.2 }}>{label}</div>
                    <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 1 }}>{sub}</div>
                  </div>
                )}
              </div>
            )}
          </NavLink>
        ))}
        {sidebarCollapsed && (
          <button onClick={() => setSidebarCollapsed(false)}
            style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)', padding: '8px 0', display: 'grid', placeItems: 'center', borderRadius: 8 }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--t1)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--t3)'}>
            <ChevronRight size={14} />
          </button>
        )}
      </nav>

      {/* Busy indicator */}
      {busy && !sidebarCollapsed && (
        <div style={{ margin: '0 8px 8px', padding: '8px 10px', background: 'var(--indigo-lt)', border: '1px solid rgba(79,70,229,.2)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="spinner" />
          <span style={{ fontSize: 11, color: 'var(--indigo)', fontFamily: 'var(--ff-mono)' }}>{busyLabel}</span>
        </div>
      )}

      {/* Status */}
      <div style={{ padding: sidebarCollapsed ? '12px 0' : '12px', borderTop: '1px solid var(--b1)', flexShrink: 0, display: 'flex', justifyContent: sidebarCollapsed ? 'center' : 'stretch' }}>
        {sidebarCollapsed
          ? <div className={`status-dot ${online ? 'online' : 'offline'}`} />
          : (
            <div style={{ background: 'var(--s2)', border: '1px solid var(--b1)', borderRadius: 10, padding: '10px 12px', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                <div className={`status-dot ${online ? 'online' : 'offline'}`} />
                <span style={{ fontSize: 11, fontWeight: 600, color: online ? 'var(--emerald)' : 'var(--rose)' }}>
                  {online ? 'Backend online' : 'Backend offline'}
                </span>
              </div>
              <div style={{ fontFamily: 'var(--ff-mono)', fontSize: 10, color: 'var(--t3)', lineHeight: 2 }}>
                <div>GTX 1660 Ti · 6 GB VRAM</div>
                <div>q4_K_M quantization</div>
              </div>
            </div>
          )
        }
      </div>
    </aside>
  )
}

/* ═══════════════════════════════════════════
   PAGE SHELL
═══════════════════════════════════════════ */
export function PageShell({ title, badge, actions, children }) {
  const { sidebarCollapsed } = useApp()
  const ml = sidebarCollapsed ? 60 : 220

  return (
    <div style={{ marginLeft: ml, flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh', transition: 'margin-left .22s cubic-bezier(.4,0,.2,1)' }}>
      <header style={{
        height: 56, padding: '0 24px',
        borderBottom: '1px solid var(--b1)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 40,
        background: 'rgba(248,250,252,.9)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ fontFamily: 'var(--ff-body)', fontSize: 16, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-.3px' }}>
            {title}
          </h1>
          {badge && <span className={`tag tag-${badge.color ?? 'indigo'}`}>{badge.label}</span>}
        </div>
        {actions && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{actions}</div>}
      </header>
      <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
        {children}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   MODEL SELECTOR
═══════════════════════════════════════════ */
export function ModelSelector({ value, onChange, disabled }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {MODELS.map(m => {
        const active = value === m.id
        return (
          <button key={m.id} onClick={() => onChange(m.id)} disabled={disabled}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', borderRadius: 10,
              cursor: disabled ? 'not-allowed' : 'pointer',
              background: active ? m.lt : 'var(--s2)',
              border: `1px solid ${active ? m.border : 'var(--b1)'}`,
              transition: 'all .15s', outline: 'none',
              opacity: disabled ? .5 : 1,
              boxShadow: active ? `0 1px 4px ${m.color}20` : 'none',
            }}
            onMouseEnter={e => { if (!disabled && !active) { e.currentTarget.style.background = 'var(--s3)'; e.currentTarget.style.borderColor = 'var(--b2)' } }}
            onMouseLeave={e => { if (!disabled && !active) { e.currentTarget.style.background = 'var(--s2)'; e.currentTarget.style.borderColor = 'var(--b1)' } }}
          >
            <div style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: active ? m.color : 'var(--t3)',
              transition: 'all .15s',
            }} />
            <div style={{ textAlign: 'left', flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: active ? m.color : 'var(--t1)', marginBottom: 1 }}>{m.label}</div>
              <div style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--ff-mono)' }}>{m.vram} · {m.tps} tok/s</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

/* ═══════════════════════════════════════════
   STAT CARD
═══════════════════════════════════════════ */
export function StatCard({ label, value, unit, color = 'var(--indigo)', icon: Icon }) {
  return (
    <div className="card" style={{ padding: '16px 18px', borderLeft: `2px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="label">{label}</span>
        {Icon && <Icon size={13} color={color} strokeWidth={2} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontFamily: 'var(--ff-mono)', fontSize: 24, fontWeight: 600, color, letterSpacing: '-1px', lineHeight: 1 }}>{value}</span>
        {unit && <span style={{ fontSize: 11, color: 'var(--t3)', fontFamily: 'var(--ff-mono)' }}>{unit}</span>}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   EMPTY STATE
═══════════════════════════════════════════ */
export function EmptyState({ icon: Icon, title, sub }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', gap: 14 }}>
      <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--s2)', border: '1px solid var(--b1)', display: 'grid', placeItems: 'center' }}>
        <Icon size={22} color="var(--t3)" strokeWidth={1.5} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--t2)', marginBottom: 6 }}>{title}</div>
        {sub && <div style={{ fontSize: 13, color: 'var(--t3)', maxWidth: 300, lineHeight: 1.6 }}>{sub}</div>}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   INFO BANNER
═══════════════════════════════════════════ */
export function InfoBanner({ type = 'info', children }) {
  const cfg = {
    info:    { bg: 'var(--sky-lt)',     border: 'rgba(2,132,199,.2)',   color: 'var(--sky)' },
    success: { bg: 'var(--emerald-lt)', border: 'rgba(5,150,105,.2)',   color: 'var(--emerald)' },
    warning: { bg: 'var(--amber-lt)',   border: 'rgba(217,119,6,.2)',   color: 'var(--amber)' },
    error:   { bg: 'var(--rose-lt)',    border: 'rgba(225,29,72,.2)',   color: 'var(--rose)' },
  }[type]
  return (
    <div style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 8, padding: '10px 14px', fontSize: 13, color: cfg.color, lineHeight: 1.6 }}>
      {children}
    </div>
  )
}

/* ═══════════════════════════════════════════
   RECHARTS TOOLTIP
═══════════════════════════════════════════ */
export function ChartTooltip({ active, payload, label, suffix = '' }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--s1)', border: '1px solid var(--b2)', borderRadius: 8, padding: '10px 14px', fontFamily: 'var(--ff-mono)', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,.1)' }}>
      <div style={{ color: 'var(--t3)', marginBottom: 6, fontSize: 11 }}>Run {label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || 'var(--t1)', display: 'flex', gap: 12, justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--t2)' }}>{p.name}</span>
          <span style={{ fontWeight: 600 }}>{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}{suffix}</span>
        </div>
      ))}
    </div>
  )
}