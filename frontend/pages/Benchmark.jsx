import { useState } from 'react'
import { Play, Cpu, Zap, Clock, Activity } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ReferenceLine, Cell,
} from 'recharts'
import { runBenchmark } from '../api/client'
import { PageShell, ModelSelector, StatCard, Btn, TextArea } from '../components/ui'

const ACCENT = '#39d353'
const BLUE   = '#58a6ff'
const AMBER  = '#e3b341'

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)',
      borderRadius: 6, padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
      <div style={{ color: 'var(--muted)', marginBottom: 4 }}>Run {label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: <strong>{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</strong>
        </div>
      ))}
    </div>
  )
}

export default function BenchmarkPage() {
  const [model,   setModel]   = useState('phi3:mini')
  const [runs,    setRuns]    = useState(3)
  const [prompt,  setPrompt]  = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState(null)
  const [error,   setError]   = useState(null)

  const go = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await runBenchmark(model, runs, prompt || null)
      setResult(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const chartData = result?.individual_runs?.map((r, i) => ({
    run: i + 1,
    'TPS':  +r.tokens_per_second.toFixed(2),
    'TTFT': +r.time_to_first_token_ms.toFixed(0),
    'Tokens': r.eval_tokens,
  })) ?? []

  const stats = result?.stats

  return (
    <PageShell
      title="Benchmark"
      subtitle="Measure inference performance across multiple runs"
    >
      {/* Config panel */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '20px', marginBottom: 24,
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)',
          textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
          Configuration
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Model</div>
          <ModelSelector value={model} onChange={setModel} disabled={loading} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 16, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
              Custom Prompt <span style={{ color: 'var(--muted2)' }}>(optional — uses default if blank)</span>
            </div>
            <TextArea
              value={prompt}
              onChange={setPrompt}
              placeholder="Leave blank to use the default benchmark prompt…"
              rows={2}
              disabled={loading}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Runs (1–10)</div>
            <input
              type="number" min={1} max={10} value={runs}
              onChange={e => setRuns(+e.target.value)}
              disabled={loading}
              style={{
                width: '100%', background: 'var(--surface2)',
                border: '1px solid var(--border)', borderRadius: 6,
                padding: '8px 12px', color: 'var(--text)', fontSize: 20,
                fontFamily: 'var(--font-display)', fontWeight: 800,
                textAlign: 'center', outline: 'none',
              }}
            />
          </div>
        </div>

        <Btn onClick={go} loading={loading} disabled={loading}>
          <Play size={14} fill="currentColor" />
          {loading ? `Running ${runs} iterations…` : 'Run Benchmark'}
        </Btn>
        {loading && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
            Each run takes 4–15 seconds on GTX 1660 Ti · Do not close this tab
          </div>
        )}
      </div>

      {error && (
        <div style={{ background: '#1a0a0a', border: '1px solid var(--red)',
          borderRadius: 8, padding: '12px 16px', color: 'var(--red)',
          fontFamily: 'var(--font-mono)', fontSize: 12, marginBottom: 24 }}>
          ✕ {error}
        </div>
      )}

      {result && (
        <div className="fade-up">
          {/* Summary stats */}
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)',
            textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
            Results — {result.model}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
            <StatCard label="Median TPS"  value={stats.median_tps}    unit="tok/s" color={ACCENT} icon={Zap} />
            <StatCard label="Mean TTFT"   value={stats.mean_ttft_ms}  unit="ms"    color={BLUE}   icon={Clock} />
            <StatCard label="TPS Range"   value={`${stats.min_tps}–${stats.max_tps}`} color={AMBER} icon={Activity} />
            <StatCard label="Avg Tokens"  value={Math.round(stats.mean_eval_tokens)} unit="tok"  color="var(--purple)" icon={Cpu} />
          </div>

          {/* TPS chart */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '20px', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-display)',
              marginBottom: 4 }}>Tokens Per Second — per run</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>
              Run 1 is typically slower (cold GPU cache). Median is the fair metric.
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} barSize={40}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="run" tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  axisLine={false} tickLine={false} label={{ value: 'Run #', position: 'insideBottom', fill: 'var(--muted)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={stats.median_tps} stroke={ACCENT} strokeDasharray="4 4"
                  label={{ value: `median ${stats.median_tps}`, fill: ACCENT, fontSize: 10, position: 'right' }} />
                <Bar dataKey="TPS" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? '#2d5a38' : ACCENT} opacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* TTFT chart */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '20px', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-display)',
              marginBottom: 4 }}>Time To First Token (ms)</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>
              Lower is better. Under 500ms feels instant to the user.
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="run" tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={500} stroke={AMBER} strokeDasharray="4 4"
                  label={{ value: '500ms threshold', fill: AMBER, fontSize: 10, position: 'right' }} />
                <Line type="monotone" dataKey="TTFT" stroke={BLUE}
                  strokeWidth={2} dot={{ fill: BLUE, r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Raw data table */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)',
              fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
              Individual Run Details
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  {['Run', 'TPS', 'TTFT (ms)', 'Total (ms)', 'Tokens', 'Prompt Tokens'].map(h => (
                    <th key={h} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 10,
                      fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--muted)',
                      textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.individual_runs.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12,
                      color: i === 0 ? AMBER : 'var(--muted)' }}>
                      {i + 1}{i === 0 ? ' ✦ cold' : ''}
                    </td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12,
                      color: ACCENT, fontWeight: 600 }}>{r.tokens_per_second}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12,
                      color: BLUE }}>{r.time_to_first_token_ms}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12,
                      color: 'var(--text)' }}>{r.total_duration_ms.toFixed(0)}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12,
                      color: 'var(--text)' }}>{r.eval_tokens}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12,
                      color: 'var(--muted)' }}>{r.prompt_tokens}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Run ID */}
          <div style={{ marginTop: 12, fontSize: 10, color: 'var(--muted2)', fontFamily: 'var(--font-mono)' }}>
            run_id: {result.run_id} · stored in SQLite · visible in GET /benchmark/history
          </div>
        </div>
      )}
    </PageShell>
  )
}
