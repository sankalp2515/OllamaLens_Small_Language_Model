import { useCallback } from 'react'
import { GitCompare, Trophy } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { compareModels } from '../api/client'
import { useApp } from '../context/AppContext'
import { PageShell, EmptyState, InfoBanner, ChartTooltip, MODELS } from '../components/ui'

const META = Object.fromEntries(MODELS.map(m => [m.id, m]))

export default function ComparePage() {
  const {
    compareResult, setCompareResult,
    compareLoading, setCompareLoading,
    comparePrompt, setComparePrompt,
    compareRuns, setCompareRuns,
  } = useApp()

  const go = useCallback(async () => {
    if (!comparePrompt.trim()) return
    setCompareLoading(true)
    try {
      const res = await compareModels(comparePrompt.trim(), null, compareRuns)
      setCompareResult(res)
    } catch (e) {
      setCompareResult({ error: e.message })
    } finally {
      setCompareLoading(false)
    }
  }, [comparePrompt, compareRuns])

  const tpsData = compareResult?.results?.map(r => ({
    name: META[r.model]?.label ?? r.model,
    TPS:  r.stats.median_tps,
    TTFT: r.stats.median_ttft_ms,
    fill: META[r.model]?.color ?? '#888',
  })) ?? []

  return (
    <PageShell
      title="Compare"
      badge={compareResult?.highest_tps_model ? { label: `Winner: ${META[compareResult.highest_tps_model]?.label}`, color: 'sage' } : undefined}
    >
      {/* Config */}
      <div className="card" style={{ padding: 22, marginBottom: 22 }}>
        <div className="label" style={{ marginBottom: 16, display: 'block' }}>Comparison Setup</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 14, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 6 }}>Prompt (sent to all 3 models)</div>
            <textarea className="inp" rows={2}
              value={comparePrompt} onChange={e => setComparePrompt(e.target.value)}
              disabled={compareLoading}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>Runs per model</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {[1, 2, 3].map(n => (
                <button key={n} onClick={() => setCompareRuns(n)} disabled={compareLoading}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 9,
                    border: `1.5px solid ${compareRuns === n ? 'rgba(232,97,58,.5)' : 'var(--b1)'}`,
                    background: compareRuns === n ? 'var(--coral-lt)' : 'var(--canvas)',
                    color: compareRuns === n ? 'var(--coral)' : 'var(--t3)',
                    fontSize: 16, fontFamily: 'var(--ff-mono)', fontWeight: 600,
                    cursor: 'pointer', transition: 'all .13s', outline: 'none',
                  }}>
                  {n}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: 'var(--t4)', fontFamily: 'var(--ff-mono)' }}>
              ≈ {compareRuns * 3} total GPU runs
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="btn btn-primary" onClick={go} disabled={compareLoading || !comparePrompt.trim()}>
            {compareLoading
              ? <><div className="spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,.3)' }} /> Comparing…</>
              : <><GitCompare size={13} /> Compare All Models</>
            }
          </button>
          {compareLoading && (
            <span style={{ fontSize: 12, color: 'var(--t3)', fontFamily: 'var(--ff-mono)' }}>
              Models run sequentially on single GPU
            </span>
          )}
        </div>
      </div>

      {compareResult?.error && (
        <InfoBanner type="error" style={{ marginBottom: 18 }}>✕ {compareResult.error}</InfoBanner>
      )}

      {compareResult && !compareResult.error && (
        <div className="stagger" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Winner banner */}
          <div className="anim-fade-up" style={{
            background: 'linear-gradient(135deg, #fff8f5, var(--coral-lt))',
            border: '1px solid rgba(232,97,58,.2)', borderRadius: 14,
            padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14,
            boxShadow: 'var(--shadow-sm)',
          }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,var(--coral),#f97316)', display: 'grid', placeItems: 'center', boxShadow: '0 4px 12px rgba(232,97,58,.3)', flexShrink: 0 }}>
              <Trophy size={18} color="#fff" />
            </div>
            <div>
              <div className="label" style={{ color: 'var(--coral)', marginBottom: 3, display: 'block' }}>Fastest model</div>
              <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-.5px' }}>
                {META[compareResult.highest_tps_model]?.label}
                <span style={{ fontSize: 13, color: 'var(--t3)', fontWeight: 400, marginLeft: 10 }}>
                  {compareResult.results[0]?.stats.median_tps} tok/s median
                </span>
              </div>
            </div>
          </div>

          {/* Charts */}
          <div className="anim-fade-up" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="card" style={{ padding: '20px 22px' }}>
              <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-.3px', marginBottom: 16 }}>Median TPS</div>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={tpsData} layout="vertical" barSize={22}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'var(--t4)', fontSize: 11, fontFamily: 'var(--ff-mono)' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={80} tick={{ fill: 'var(--t2)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={v => [`${v} tok/s`, 'TPS']} contentStyle={{ background: 'var(--s1)', border: '1px solid var(--b2)', borderRadius: 10, fontFamily: 'var(--ff-mono)', fontSize: 12, boxShadow: 'var(--shadow-md)' }} />
                  <Bar dataKey="TPS" radius={[0, 5, 5, 0]}>
                    {tpsData.map((d, i) => <Cell key={i} fill={d.fill} opacity={0.85} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card" style={{ padding: '20px 22px' }}>
              <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-.3px', marginBottom: 16 }}>TTFT (ms) — lower is better</div>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={tpsData} layout="vertical" barSize={22}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'var(--t4)', fontSize: 11, fontFamily: 'var(--ff-mono)' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={80} tick={{ fill: 'var(--t2)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={v => [`${v} ms`, 'TTFT']} contentStyle={{ background: 'var(--s1)', border: '1px solid var(--b2)', borderRadius: 10, fontFamily: 'var(--ff-mono)', fontSize: 12, boxShadow: 'var(--shadow-md)' }} />
                  <Bar dataKey="TTFT" radius={[0, 5, 5, 0]}>
                    {tpsData.map((d, i) => <Cell key={i} fill={d.fill} opacity={0.55} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Model cards */}
          <div className="anim-fade-up" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {compareResult.results.map((r, i) => {
              const m = META[r.model] ?? { label: r.model, color: '#888', lt: '#f5f5f5', border: 'rgba(0,0,0,.1)', grad: 'linear-gradient(135deg,#888,#aaa)' }
              const isWinner = i === 0
              return (
                <div key={r.model} className="card" style={{
                  overflow: 'hidden',
                  border: `1px solid ${isWinner ? m.color + '35' : 'var(--b1)'}`,
                  boxShadow: isWinner ? `0 4px 20px ${m.color}12, var(--shadow-sm)` : 'var(--shadow-sm)',
                  transform: isWinner ? 'translateY(-2px)' : 'none',
                }}>
                  {/* Card header */}
                  <div style={{
                    padding: '14px 16px', borderBottom: '1px solid var(--b0)',
                    background: isWinner ? m.lt : 'var(--canvas)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, boxShadow: isWinner ? `0 0 6px ${m.color}` : 'none' }} />
                        <span style={{ fontSize: 14, fontWeight: 800, color: m.color, letterSpacing: '-.3px' }}>{m.label}</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--t4)', fontFamily: 'var(--ff-mono)' }}>
                        #{i + 1} · {r.vram_estimate_gb} GB VRAM
                      </div>
                    </div>
                    {isWinner && (
                      <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,var(--coral),#f97316)', display: 'grid', placeItems: 'center', boxShadow: '0 2px 8px rgba(232,97,58,.3)' }}>
                        <Trophy size={13} color="#fff" />
                      </div>
                    )}
                  </div>

                  {/* Stats grid */}
                  <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, borderBottom: '1px solid var(--b0)' }}>
                    {[
                      { l: 'Median TPS', v: r.stats.median_tps,                                c: m.color },
                      { l: 'TTFT',       v: `${r.stats.median_ttft_ms}ms`,                    c: 'var(--teal)' },
                      { l: 'Total avg',  v: `${(r.stats.mean_total_ms / 1000).toFixed(1)}s`,  c: 'var(--t3)' },
                      { l: 'Avg tokens', v: Math.round(r.stats.mean_eval_tokens),              c: 'var(--t3)' },
                    ].map(s => (
                      <div key={s.l} style={{ background: 'var(--canvas)', borderRadius: 8, padding: '8px 10px' }}>
                        <div className="label" style={{ marginBottom: 3, display: 'block' }}>{s.l}</div>
                        <span style={{ fontFamily: 'var(--ff-mono)', fontSize: 16, fontWeight: 700, color: s.c }}>{s.v}</span>
                      </div>
                    ))}
                  </div>

                  {/* Preview */}
                  <div style={{ padding: '11px 16px' }}>
                    <div className="label" style={{ marginBottom: 5, display: 'block' }}>Response preview</div>
                    <div style={{ fontSize: 12, color: 'var(--t3)', lineHeight: 1.55, maxHeight: 72, overflow: 'hidden', position: 'relative' }}>
                      {r.response_preview}
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 24, background: 'linear-gradient(transparent, var(--s1))' }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!compareResult && !compareLoading && (
        <EmptyState icon={GitCompare} title="No comparison yet" sub="Enter a prompt and click Compare All Models to benchmark side-by-side." />
      )}
    </PageShell>
  )
}