import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  MessageSquare, Gauge, GitCompare, FileText,
  Activity, ChevronRight, Cpu, Zap
} from 'lucide-react'
import { getHealth } from '../api/client'

const NAV = [
  { to: '/',          icon: MessageSquare, label: 'Chat',       sub: 'Stream tokens live'       },
  { to: '/benchmark', icon: Gauge,         label: 'Benchmark',  sub: 'Measure TTFT & TPS'       },
  { to: '/compare',   icon: GitCompare,    label: 'Compare',    sub: 'Side-by-side models'      },
  { to: '/report',    icon: FileText,      label: 'Report',     sub: 'Technical analysis'       },
]

/* ── Sidebar ─────────────────────────────────────────────────────────── */
export function Sidebar() {
  const [health, setHealth] = useState(null)

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth({ status: 'error' }))
    const id = setInterval(() =>
      getHealth().then(setHealth).catch(() => setHealth({ status: 'error' })),
      10000
    )
    return () => clearInterval(id)
  }, [])

  const online = health?.status === 'ok'

  return (
    <aside style={{
      width: 220, minHeight: '100vh', background: 'var(--surface)',
      borderRight: '1px solid var(--border)', display: 'flex',
      flexDirection: 'column', flexShrink: 0, position: 'fixed',
      top: 0, left: 0, bottom: 0, zIndex: 50,
    }}>
      {/* Logo */}
      <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: 'var(--accent-dim)', border: '1px solid var(--accent)',
            display: 'grid', placeItems: 'center',
          }}>
            <Zap size={14} color="var(--accent)" />
          </div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>
            Ollama<span style={{ color: 'var(--accent)' }}>Lens</span>
          </span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          Local SLM Platform
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 12px', overflowY: 'auto' }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase',
          color: 'var(--muted)', padding: '8px 8px 6px', marginBottom: 4 }}>
          Navigation
        </div>
        {NAV.map(({ to, icon: Icon, label, sub }) => (
          <NavLink key={to} to={to} end={to === '/'} style={{ textDecoration: 'none' }}>
            {({ isActive }) => (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 10px', borderRadius: 6, marginBottom: 2,
                background: isActive ? 'var(--accent-dim)' : 'transparent',
                border: `1px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface2)' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
              >
                <Icon size={15} color={isActive ? 'var(--accent)' : 'var(--muted)'} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600,
                    color: isActive ? 'var(--accent)' : 'var(--text)' }}>{label}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.2 }}>{sub}</div>
                </div>
                {isActive && <ChevronRight size={12} color="var(--accent)" />}
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Status */}
      <div style={{ padding: '16px', borderTop: '1px solid var(--border)' }}>
        <div style={{ background: 'var(--surface2)', borderRadius: 8,
          border: '1px solid var(--border)', padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: online ? 'var(--accent)' : 'var(--red)',
              ...(online ? { animation: 'pulse-dot 2s ease-in-out infinite' } : {})
            }} className={online ? 'pulse' : ''} />
            <span style={{ fontSize: 11, fontWeight: 600,
              color: online ? 'var(--accent)' : 'var(--red)' }}>
              {online ? 'Backend Online' : 'Backend Offline'}
            </span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.8 }}>
            <div>GPU: GTX 1660 Ti</div>
            <div>VRAM: 6 GB</div>
            <div>Quant: q4_K_M</div>
          </div>
        </div>
      </div>
    </aside>
  )
}

/* ── Page shell ─────────────────────────────────────────────────────────── */
export function PageShell({ title, subtitle, children, actions }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{
        padding: '20px 28px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface)', display: 'flex',
        alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 40,
      }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-display)',
            color: 'var(--text)', marginBottom: 1 }}>{title}</h1>
          {subtitle && <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0 }}>{subtitle}</p>}
        </div>
        {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
      </div>
      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 28 }}>
        {children}
      </div>
    </div>
  )
}

/* ── Model selector ─────────────────────────────────────────────────────── */
const MODELS = [
  { id: 'phi3:mini',                    label: 'Phi-3 Mini',    vram: '2.3 GB', speed: 'Fast',     color: 'var(--amber)'  },
  { id: 'mistral:7b-instruct-q4_K_M',  label: 'Mistral 7B',    vram: '4.1 GB', speed: 'Balanced', color: 'var(--blue)'   },
  { id: 'llama3:8b-instruct-q4_K_M',   label: 'Llama 3 8B',    vram: '4.7 GB', speed: 'Quality',  color: 'var(--purple)' },
]

export function ModelSelector({ value, onChange, disabled }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {MODELS.map(m => (
        <button key={m.id} onClick={() => onChange(m.id)} disabled={disabled}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 14px', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
            border: `1px solid ${value === m.id ? m.color : 'var(--border)'}`,
            background: value === m.id ? `${m.color}15` : 'var(--surface2)',
            opacity: disabled ? 0.5 : 1, transition: 'all 0.15s',
          }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: m.color }} />
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: value === m.id ? m.color : 'var(--text)' }}>
              {m.label}
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
              {m.vram} · {m.speed}
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}

/* ── Stat card ──────────────────────────────────────────────────────────── */
export function StatCard({ label, value, unit, color = 'var(--accent)', icon: Icon }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '16px 20px',
      borderLeft: `3px solid ${color}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)',
          textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
        {Icon && <Icon size={14} color={color} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 26, fontWeight: 800, fontFamily: 'var(--font-display)', color }}>{value}</span>
        {unit && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{unit}</span>}
      </div>
    </div>
  )
}

/* ── Button ─────────────────────────────────────────────────────────────── */
export function Btn({ children, onClick, disabled, variant = 'primary', small, loading }) {
  const styles = {
    primary: { background: 'var(--accent)', color: '#000', border: '1px solid var(--accent)' },
    ghost:   { background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)' },
    danger:  { background: 'transparent', color: 'var(--red)', border: '1px solid var(--red)' },
  }
  return (
    <button onClick={onClick} disabled={disabled || loading}
      style={{
        ...styles[variant],
        padding: small ? '5px 12px' : '8px 18px',
        borderRadius: 6, cursor: (disabled || loading) ? 'not-allowed' : 'pointer',
        fontSize: small ? 12 : 13, fontWeight: 600, fontFamily: 'var(--font-sans)',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        opacity: (disabled || loading) ? 0.6 : 1, transition: 'opacity 0.15s',
      }}>
      {loading && <div className="spin" style={{ width: 12, height: 12, border: '2px solid currentColor',
        borderTopColor: 'transparent', borderRadius: '50%' }} />}
      {children}
    </button>
  )
}

/* ── Textarea ───────────────────────────────────────────────────────────── */
export function TextArea({ value, onChange, placeholder, rows = 3, disabled, onKeyDown }) {
  return (
    <textarea
      value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} rows={rows} disabled={disabled}
      onKeyDown={onKeyDown}
      style={{
        width: '100%', background: 'var(--surface2)',
        border: '1px solid var(--border)', borderRadius: 6,
        padding: '10px 14px', color: 'var(--text)', resize: 'vertical',
        fontFamily: 'var(--font-sans)', fontSize: 13, lineHeight: 1.6,
        outline: 'none', transition: 'border-color 0.15s',
      }}
      onFocus={e => e.target.style.borderColor = 'var(--accent)'}
      onBlur={e => e.target.style.borderColor = 'var(--border)'}
    />
  )
}

export { MODELS }
