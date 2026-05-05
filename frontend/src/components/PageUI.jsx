/**
 * PageUI.jsx
 * Shared layout and UI components used by Benchmark, Compare, Report pages.
 * Separated from Sidebar.jsx to keep files focused.
 */
import { useApp } from '../context/AppContext'
import { MODELS } from './Sidebar'

/* ═══════════════════════════════════════════
   PAGE SHELL
═══════════════════════════════════════════ */
export function PageShell({ title, badge, actions, children }) {
  const { sidebarCollapsed } = useApp()
  const ml = sidebarCollapsed ? 64 : 240

  return (
    <div style={{
      marginLeft: ml, flex: 1, display: 'flex', flexDirection: 'column',
      minHeight: '100vh', transition: 'margin-left .22s cubic-bezier(.4,0,.2,1)',
    }}>
      <header style={{
        height: 58, padding: '0 28px',
        borderBottom: '1px solid var(--b1)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 40,
        background: 'rgba(250,249,247,0.95)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 1px 0 var(--b1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{
            fontFamily: 'var(--ff-body)', fontSize: 17, fontWeight: 800,
            color: 'var(--t1)', letterSpacing: '-.5px',
          }}>{title}</h1>
          {badge && (
            <span className={`tag tag-${badge.color ?? 'coral'}`}>{badge.label}</span>
          )}
        </div>
        {actions && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{actions}</div>}
      </header>
      <div style={{ flex: 1, padding: '28px', overflowY: 'auto' }}>
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
    <div style={{ display: 'flex', gap: 10 }}>
      {MODELS.map(m => {
        const active = value === m.id
        return (
          <button key={m.id} onClick={() => onChange(m.id)} disabled={disabled}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 11,
              padding: '12px 16px', borderRadius: 13,
              cursor: disabled ? 'not-allowed' : 'pointer',
              background: active ? m.lt : 'var(--s1)',
              border: `1.5px solid ${active ? m.color + '40' : 'var(--b1)'}`,
              transition: 'all .15s', outline: 'none', opacity: disabled ? .5 : 1,
              boxShadow: active ? `0 3px 14px ${m.color}18, inset 0 1px 0 rgba(255,255,255,.9)` : 'var(--shadow-xs)',
              transform: active ? 'translateY(-1px)' : 'none',
            }}
            onMouseEnter={e => { if (!disabled && !active) { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.borderColor = 'var(--b2)'; e.currentTarget.style.transform = 'translateY(-1px)' } }}
            onMouseLeave={e => { if (!disabled && !active) { e.currentTarget.style.boxShadow = 'var(--shadow-xs)'; e.currentTarget.style.borderColor = 'var(--b1)'; e.currentTarget.style.transform = 'none' } }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', flexShrink: 0,
              background: active ? m.grad : 'var(--canvas)',
              boxShadow: active ? `0 3px 10px ${m.color}30` : 'none',
              transition: 'all .15s',
            }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: active ? '#fff' : m.color, opacity: active ? 1 : .6 }} />
            </div>
            <div style={{ textAlign: 'left', flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: active ? m.color : 'var(--t1)', marginBottom: 2, letterSpacing: '-.2px' }}>
                {m.label}
              </div>
              <div style={{ fontSize: 10, color: 'var(--t4)', fontFamily: 'var(--ff-mono)' }}>
                {m.vram} · {m.tps} tok/s
              </div>
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
export function StatCard({ label, value, unit, color = 'var(--coral)', icon: Icon }) {
  return (
    <div style={{
      background: 'var(--s1)', border: '1px solid var(--b1)',
      borderRadius: 14, padding: '18px 20px',
      boxShadow: 'var(--shadow-sm)', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 3, background: color, opacity: .85,
        borderRadius: '14px 14px 0 0',
      }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span className="label">{label}</span>
        {Icon && (
          <div style={{ width: 28, height: 28, borderRadius: 7, background: color + '15', display: 'grid', placeItems: 'center' }}>
            <Icon size={13} color={color} strokeWidth={2} />
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontFamily: 'var(--ff-mono)', fontSize: 26, fontWeight: 600, color, letterSpacing: '-1.5px', lineHeight: 1 }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontSize: 11, color: 'var(--t4)', fontFamily: 'var(--ff-mono)' }}>{unit}</span>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   EMPTY STATE
═══════════════════════════════════════════ */
export function EmptyState({ icon: Icon, title, sub }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', gap: 16 }}>
      <div style={{
        width: 60, height: 60, borderRadius: 18, background: 'var(--canvas)',
        border: '1px solid var(--b1)', display: 'grid', placeItems: 'center',
        boxShadow: 'var(--shadow-md)',
      }}>
        <Icon size={24} color="var(--t4)" strokeWidth={1.5} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--t2)', marginBottom: 8 }}>{title}</div>
        {sub && <div style={{ fontSize: 13, color: 'var(--t3)', maxWidth: 300, lineHeight: 1.65 }}>{sub}</div>}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   INFO BANNER
═══════════════════════════════════════════ */
export function InfoBanner({ type = 'info', children }) {
  const cfg = {
    info:    { bg: 'var(--sky-lt)',   border: 'var(--sky-b)',   color: 'var(--sky)' },
    success: { bg: 'var(--sage-lt)',  border: 'var(--sage-b)',  color: 'var(--sage)' },
    warning: { bg: 'var(--amber-lt)', border: 'var(--amber-b)', color: 'var(--amber)' },
    error:   { bg: 'var(--rose-lt)',  border: 'var(--rose-b)',  color: 'var(--rose)' },
  }[type]
  return (
    <div style={{
      background: cfg.bg, border: `1px solid ${cfg.border}`,
      borderRadius: 10, padding: '11px 15px',
      fontSize: 13, color: cfg.color, lineHeight: 1.6,
    }}>
      {children}
    </div>
  )
}

/* ═══════════════════════════════════════════
   CHART TOOLTIP
═══════════════════════════════════════════ */
export function ChartTooltip({ active, payload, label, suffix = '' }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--s1)', border: '1px solid var(--b2)',
      borderRadius: 10, padding: '10px 14px',
      fontFamily: 'var(--ff-mono)', fontSize: 12,
      boxShadow: 'var(--shadow-lg)',
    }}>
      <div style={{ color: 'var(--t4)', marginBottom: 6, fontSize: 11 }}>Run {label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || 'var(--t1)', display: 'flex', gap: 12, justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--t3)' }}>{p.name}</span>
          <span style={{ fontWeight: 700 }}>
            {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}{suffix}
          </span>
        </div>
      ))}
    </div>
  )
}