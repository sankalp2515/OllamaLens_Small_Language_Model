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
    fill: META[r.model]?.color ?? '#fff',
  })) ?? []

  return (
    <PageShell
      title="Compare"
      badge={compareResult?.highest_tps_model ? { label: `Winner: ${META[compareResult.highest_tps_model]?.label}`, color: 'emerald' } : undefined}
    >
      {/* Config */}
      <div className="card" style={{ padding: 20, marginBottom: 20 }}>
        <div className="label" style={{ marginBottom: 14, display: 'block' }}>Comparison setup</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 14, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 6 }}>Prompt (sent to all 3 models)</div>
            <textarea className="inp" rows={2} value={comparePrompt} onChange={e => setComparePrompt(e.target.value)} disabled={compareLoading} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>Runs per model</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {[1, 2, 3].map(n => (
                <button key={n} onClick={() => setCompareRuns(n)} disabled={compareLoading}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${compareRuns === n ? 'rgba(34,211,238,0.5)' : 'var(--b1)'}`,
                    background: compareRuns === n ? 'var(--cyan-dim)' : 'var(--s2)',
                    color: compareRuns === n ? 'var(--cyan)' : 'var(--t3)',
                    fontSize: 16, fontFamily: 'var(--ff-mono)', fontWeight: 700, transition: 'all 0.13s',
                  }}>
                  {n}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--ff-mono)' }}>
              ≈ {compareRuns * 3} total GPU runs
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="btn btn-primary" onClick={go} disabled={compareLoading || !comparePrompt.trim()}>
            {compareLoading
              ? <><div className="spinner" style={{ borderTopColor: '#000', borderColor: 'rgba(0,0,0,0.15)' }} /> Comparing models…</>
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

      {compareResult?.error && <InfoBanner type="error" style={{ marginBottom: 16 }}>✕ {compareResult.error}</InfoBanner>}

      {compareResult && !compareResult.error && (
        <div className="stagger" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Winner */}
          <div className="anim-fade-up" style={{
            background: 'var(--emerald-dim)', border: '1px solid rgba(16,185,129,.25)',
            borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <Trophy size={20} color="var(--emerald)" />
            <div>
              <div className="label" style={{ color: 'var(--emerald)', marginBottom: 3, display: 'block' }}>Fastest</div>
              <div style={{ fontFamily: 'var(--ff-display)', fontSize: 18, fontWeight: 800 }}>
                {META[compareResult.highest_tps_model]?.label}
                <span style={{ fontSize: 13, color: 'var(--t3)', fontWeight: 400, marginLeft: 10, fontFamily: 'var(--ff-body)' }}>
                  {compareResult.results[0]?.stats.median_tps} tok/s median
                </span>
              </div>
            </div>
          </div>

          {/* Charts */}
          <div className="anim-fade-up" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="card" style={{ padding: '18px 20px' }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14 }}>Median TPS</div>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={tpsData} layout="vertical" barSize={20}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'var(--t3)', fontSize: 11, fontFamily: 'var(--ff-mono)' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={80} tick={{ fill: 'var(--t2)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={v => [`${v} tok/s`, 'TPS']} contentStyle={{ background: 'var(--s3)', border: '1px solid var(--b2)', borderRadius: 8, fontFamily: 'var(--ff-mono)', fontSize: 12 }} />
                  <Bar dataKey="TPS" radius={[0, 4, 4, 0]}>
                    {tpsData.map((d, i) => <Cell key={i} fill={d.fill} opacity={0.85} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card" style={{ padding: '18px 20px' }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14 }}>Median TTFT (ms)</div>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={tpsData} layout="vertical" barSize={20}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'var(--t3)', fontSize: 11, fontFamily: 'var(--ff-mono)' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={80} tick={{ fill: 'var(--t2)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={v => [`${v} ms`, 'TTFT']} contentStyle={{ background: 'var(--s3)', border: '1px solid var(--b2)', borderRadius: 8, fontFamily: 'var(--ff-mono)', fontSize: 12 }} />
                  <Bar dataKey="TTFT" radius={[0, 4, 4, 0]}>
                    {tpsData.map((d, i) => <Cell key={i} fill={d.fill} opacity={0.55} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Model cards */}
          <div className="anim-fade-up" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {compareResult.results.map((r, i) => {
              const m = META[r.model] ?? { label: r.model, color: '#fff', dim: 'transparent', border: 'var(--b1)' }
              const winner = i === 0
              return (
                <div key={r.model} className="card" style={{
                  border: `1px solid ${winner ? m.border : 'var(--b1)'}`,
                  boxShadow: winner ? `0 0 30px ${m.color}10` : 'none',
                }}>
                  <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--b1)', background: winner ? m.dim : 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, boxShadow: winner ? `0 0 8px ${m.color}` : 'none' }} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: m.color }}>{m.label}</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--ff-mono)' }}>#{i + 1} · {r.vram_estimate_gb} GB VRAM</div>
                    </div>
                    {winner && <Trophy size={15} color={m.color} />}
                  </div>

                  <div style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, borderBottom: '1px solid var(--b1)' }}>
                    {[
                      { l: 'TPS',        v: r.stats.median_tps,                        c: m.color },
                      { l: 'TTFT',       v: `${r.stats.median_ttft_ms}ms`,             c: 'var(--sky)' },
                      { l: 'Total avg',  v: `${(r.stats.mean_total_ms/1000).toFixed(1)}s`, c: 'var(--t3)' },
                      { l: 'Avg tokens', v: Math.round(r.stats.mean_eval_tokens),      c: 'var(--t3)' },
                    ].map(s => (
                      <div key={s.l} style={{ background: 'var(--s2)', borderRadius: 6, padding: '8px 10px' }}>
                        <div className="label" style={{ marginBottom: 3, display: 'block' }}>{s.l}</div>
                        <span style={{ fontFamily: 'var(--ff-mono)', fontSize: 15, fontWeight: 600, color: s.c }}>{s.v}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ padding: '10px 14px' }}>
                    <div className="label" style={{ marginBottom: 5, display: 'block' }}>Response preview</div>
                    <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.55, maxHeight: 72, overflow: 'hidden', position: 'relative' }}>
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
        <EmptyState icon={GitCompare} title="No comparison yet" sub="Enter a prompt and click Compare All Models to run side-by-side benchmarks." />
      )}
    </PageShell>
  )
}