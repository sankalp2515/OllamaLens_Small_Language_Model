import { useCallback } from 'react'
import { Play, Zap, Clock, Activity, Cpu, TrendingUp } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ReferenceLine, Cell,
} from 'recharts'
import { runBenchmark } from '../api/client'
import { useApp } from '../context/AppContext'
import { PageShell, ModelSelector, StatCard, EmptyState, ChartTooltip, MODELS } from '../components/ui'

const MODEL_COLOR = Object.fromEntries(MODELS.map(m => [m.id, m.color]))

export default function BenchmarkPage() {
  const {
    benchResult, setBenchResult,
    benchLoading, setBenchLoading,
    benchModel, setBenchModel,
    benchRuns, setBenchRuns,
    benchPrompt, setBenchPrompt,
  } = useApp()

  const go = useCallback(async () => {
    setBenchLoading(true)
    try {
      const res = await runBenchmark(benchModel, benchRuns, benchPrompt || null)
      setBenchResult(res)
    } catch (e) {
      setBenchResult({ error: e.message })
    } finally {
      setBenchLoading(false)
    }
  }, [benchModel, benchRuns, benchPrompt])

  const color    = MODEL_COLOR[benchModel] ?? 'var(--coral)'
  const stats    = benchResult?.stats
  const chartData = benchResult?.individual_runs?.map((r, i) => ({
    run:    i + 1,
    TPS:    +r.tokens_per_second.toFixed(2),
    TTFT:   +r.time_to_first_token_ms.toFixed(0),
    Tokens: r.eval_tokens,
  })) ?? []

  return (
    <PageShell
      title="Benchmark"
      badge={stats ? { label: `${stats.median_tps} tok/s`, color: 'coral' } : undefined}
    >
      {/* Config */}
      <div className="card" style={{ padding: 22, marginBottom: 22 }}>
        <div className="label" style={{ marginBottom: 16, display: 'block' }}>Configuration</div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>Select model</div>
          <ModelSelector value={benchModel} onChange={setBenchModel} disabled={benchLoading} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 14, marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 6 }}>
              Custom prompt <span style={{ color: 'var(--t4)' }}>(optional)</span>
            </div>
            <textarea className="inp" rows={2}
              value={benchPrompt} onChange={e => setBenchPrompt(e.target.value)}
              disabled={benchLoading}
              placeholder="Leave blank for default recursion prompt…"
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 8 }}>Iterations</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[1, 3, 5].map(n => (
                <button key={n} onClick={() => setBenchRuns(n)} disabled={benchLoading}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 9,
                    border: `1.5px solid ${benchRuns === n ? color + '55' : 'var(--b1)'}`,
                    background: benchRuns === n ? color + '12' : 'var(--canvas)',
                    color: benchRuns === n ? color : 'var(--t3)',
                    fontSize: 16, fontFamily: 'var(--ff-mono)', fontWeight: 600,
                    cursor: 'pointer', transition: 'all .13s', outline: 'none',
                    boxShadow: benchRuns === n ? `0 2px 8px ${color}18` : 'none',
                  }}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="btn btn-primary" onClick={go} disabled={benchLoading}>
            {benchLoading
              ? <><div className="spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,.3)' }} /> Running {benchRuns} iterations…</>
              : <><Play size={13} fill="currentColor" /> Run Benchmark</>
            }
          </button>
          {benchLoading && (
            <span style={{ fontSize: 12, color: 'var(--t3)', fontFamily: 'var(--ff-mono)' }}>
              ~{4 * benchRuns}–{15 * benchRuns}s on GTX 1660 Ti
            </span>
          )}
        </div>
      </div>

      {/* Error */}
      {benchResult?.error && (
        <div style={{ background: 'var(--rose-lt)', border: '1px solid var(--rose-b)', borderRadius: 10, padding: '10px 14px', color: 'var(--rose)', fontSize: 13, marginBottom: 22 }}>
          ✕ {benchResult.error}
        </div>
      )}

      {/* Results */}
      {stats && !benchResult?.error && (
        <div className="stagger" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Stat cards */}
          <div className="anim-fade-up" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <StatCard label="Median TPS"   value={stats.median_tps}                   unit="tok/s"  color={color}           icon={Zap} />
            <StatCard label="Mean TTFT"    value={stats.mean_ttft_ms}                 unit="ms"     color="var(--teal)"     icon={Clock} />
            <StatCard label="TPS Range"    value={`${stats.min_tps}–${stats.max_tps}`}              color="var(--t2)"       icon={Activity} />
            <StatCard label="Avg Tokens"   value={Math.round(stats.mean_eval_tokens)} unit="tok"    color="var(--plum)"     icon={Cpu} />
          </div>

          {/* Charts */}
          <div className="anim-fade-up" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="card" style={{ padding: '20px 22px' }}>
              <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-.3px', marginBottom: 3 }}>Tokens / Second</div>
              <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 16 }}>Run 1 (cold) shaded — median is the reliable number</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartData} barSize={34}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="run" tick={{ fill: 'var(--t4)', fontSize: 11, fontFamily: 'var(--ff-mono)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--t4)', fontSize: 11, fontFamily: 'var(--ff-mono)' }} axisLine={false} tickLine={false} width={34} />
                  <Tooltip content={<ChartTooltip suffix=" tok/s" />} />
                  <ReferenceLine y={stats.median_tps} stroke={color} strokeDasharray="4 4" opacity={0.5} />
                  <Bar dataKey="TPS" radius={[5, 5, 0, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={i === 0 ? 'var(--s4)' : color} opacity={i === 0 ? 0.5 : 0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card" style={{ padding: '20px 22px' }}>
              <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-.3px', marginBottom: 3 }}>Time To First Token</div>
              <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 16 }}>Under 500ms feels instant to users</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="run" tick={{ fill: 'var(--t4)', fontSize: 11, fontFamily: 'var(--ff-mono)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--t4)', fontSize: 11, fontFamily: 'var(--ff-mono)' }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip content={<ChartTooltip suffix=" ms" />} />
                  <ReferenceLine y={500} stroke="var(--amber)" strokeDasharray="4 4" opacity={0.6}
                    label={{ value: '500ms', fill: 'var(--amber)', fontSize: 10, position: 'right' }} />
                  <Line type="monotone" dataKey="TTFT" stroke="var(--teal)" strokeWidth={2.5}
                    dot={{ fill: 'var(--teal)', r: 4, strokeWidth: 0 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Table */}
          <div className="anim-fade-up card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--b1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-.3px' }}>Individual Runs</span>
              <span className="tag tag-coral">{benchResult.model}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--canvas)' }}>
                    {['Run', 'TPS', 'TTFT (ms)', 'Total (ms)', 'Tokens', 'Prompt Tok'].map(h => (
                      <th key={h} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 10, fontFamily: 'var(--ff-mono)', fontWeight: 600, color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid var(--b1)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {benchResult.individual_runs.map((r, i) => (
                    <tr key={i}
                      style={{ borderBottom: i < benchResult.individual_runs.length - 1 ? '1px solid var(--b0)' : 'none', transition: 'background .1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--canvas)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--ff-mono)', fontSize: 12, color: i === 0 ? 'var(--amber)' : 'var(--t4)' }}>
                        #{i + 1}{i === 0 ? ' · cold' : ''}
                      </td>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--ff-mono)', fontSize: 12, color, fontWeight: 700 }}>{r.tokens_per_second}</td>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--ff-mono)', fontSize: 12, color: 'var(--teal)' }}>{r.time_to_first_token_ms}</td>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--ff-mono)', fontSize: 12, color: 'var(--t2)' }}>{r.total_duration_ms.toFixed(0)}</td>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--ff-mono)', fontSize: 12, color: 'var(--t2)' }}>{r.eval_tokens}</td>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--ff-mono)', fontSize: 12, color: 'var(--t4)' }}>{r.prompt_tokens}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '8px 16px', borderTop: '1px solid var(--b0)', fontSize: 10, color: 'var(--t4)', fontFamily: 'var(--ff-mono)' }}>
              run_id: {benchResult.run_id}
            </div>
          </div>
        </div>
      )}

      {!benchResult && !benchLoading && (
        <EmptyState icon={TrendingUp} title="No benchmark data yet" sub="Pick a model above and click Run Benchmark to measure inference performance on your GPU." />
      )}
    </PageShell>
  )
}