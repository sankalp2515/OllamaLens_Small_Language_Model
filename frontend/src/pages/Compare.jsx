import { useState } from 'react'
import { GitCompare, Trophy, Zap, Clock } from 'lucide-react'
import { RadarChart, PolarGrid, PolarAngleAxis, Radar,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell } from 'recharts'
import { compareModels } from '../api/client'
import { PageShell, Btn, TextArea } from '../components/ui'

const MODEL_COLORS = {
  'phi3:mini':                   '#e3b341',
  'mistral:7b-instruct-q4_K_M': '#58a6ff',
  'llama3:8b-instruct-q4_K_M':  '#bc8cff',
}
const MODEL_SHORT = {
  'phi3:mini':                   'Phi-3 Mini',
  'mistral:7b-instruct-q4_K_M': 'Mistral 7B',
  'llama3:8b-instruct-q4_K_M':  'Llama 3 8B',
}

const Pill = ({ label, value, color }) => (
  <div style={{ textAlign: 'center' }}>
    <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-display)', color }}>{value}</div>
    <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
  </div>
)

export default function ComparePage() {
  const [prompt, setPrompt]     = useState('Explain quantum entanglement in simple terms.')
  const [runsEach, setRunsEach] = useState(2)
  const [loading, setLoading]   = useState(false)
  const [result,  setResult]    = useState(null)
  const [error,   setError]     = useState(null)

  const go = async () => {
    if (!prompt.trim()) return
    setLoading(true); setError(null); setResult(null)
    try {
      const res = await compareModels(prompt.trim(), null, runsEach)
      setResult(res)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  // Build chart data from results
  const barData = result?.results?.map(r => ({
    name: MODEL_SHORT[r.model] ?? r.model,
    TPS:  r.stats.median_tps,
    TTFT: r.stats.median_ttft_ms,
    VRAM: r.vram_estimate_gb,
    fill: MODEL_COLORS[r.model] ?? '#fff',
  })) ?? []

  const maxTps = Math.max(...barData.map(d => d.TPS), 1)

  return (
    <PageShell
      title="Model Comparison"
      subtitle="Same prompt → all three models → ranked by performance"
    >
      {/* Input */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 16, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Prompt (sent to all models)</div>
            <TextArea value={prompt} onChange={setPrompt} rows={2} disabled={loading} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Runs each</div>
            <input type="number" min={1} max={5} value={runsEach}
              onChange={e => setRunsEach(+e.target.value)} disabled={loading}
              style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '8px 12px', color: 'var(--text)',
                fontSize: 20, fontFamily: 'var(--font-display)', fontWeight: 800,
                textAlign: 'center', outline: 'none' }} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Btn onClick={go} loading={loading} disabled={loading || !prompt.trim()}>
            <GitCompare size={14} />
            {loading ? 'Running across all models…' : 'Compare All Models'}
          </Btn>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            ~{runsEach * 3} total runs · models run sequentially on single GPU
          </div>
        </div>
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
          {/* Winner banner */}
          <div style={{ background: 'linear-gradient(135deg, #0d2218, #0d1a0d)',
            border: '1px solid var(--accent)', borderRadius: 10,
            padding: '16px 20px', marginBottom: 24,
            display: 'flex', alignItems: 'center', gap: 12 }}>
            <Trophy size={20} color="var(--accent)" />
            <div>
              <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: 0.5 }}>Fastest Model</div>
              <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)' }}>
                {MODEL_SHORT[result.highest_tps_model] ?? result.highest_tps_model}
                <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400,
                  marginLeft: 8, fontFamily: 'var(--font-sans)' }}>
                  {result.results[0]?.stats.median_tps} tok/s median
                </span>
              </div>
            </div>
          </div>

          {/* TPS bar chart */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-display)',
              marginBottom: 16 }}>Median Tokens Per Second</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={barData} layout="vertical" barSize={28}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={90}
                  tick={{ fill: 'var(--text)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => [`${v} tok/s`, 'TPS']}
                  contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)',
                    borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 12 }} />
                <Bar dataKey="TPS" radius={[0, 4, 4, 0]}>
                  {barData.map((d, i) => <Cell key={i} fill={d.fill} opacity={0.85} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* VRAM bar */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-display)',
              marginBottom: 16 }}>VRAM Usage (GB) — q4_K_M</div>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={barData} layout="vertical" barSize={22}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" domain={[0, 6]} tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={90}
                  tick={{ fill: 'var(--text)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => [`${v} GB`, 'VRAM']}
                  contentStyle={{ background: 'var(--surface2)', border: '1px solid var(--border)',
                    borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 12 }} />
                <Bar dataKey="VRAM" radius={[0, 4, 4, 0]}>
                  {barData.map((d, i) => <Cell key={i} fill={d.fill} opacity={0.5} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Model cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {result.results.map((r, i) => {
              const color = MODEL_COLORS[r.model] ?? '#fff'
              const isWinner = i === 0
              return (
                <div key={r.model} style={{
                  background: 'var(--surface)', borderRadius: 10,
                  border: `1px solid ${isWinner ? color : 'var(--border)'}`,
                  overflow: 'hidden',
                }}>
                  {/* Header */}
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)',
                    background: isWinner ? `${color}10` : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-display)', color }}>
                        #{i + 1} {MODEL_SHORT[r.model] ?? r.model}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                        {r.vram_estimate_gb} GB VRAM
                      </div>
                    </div>
                    {isWinner && <Trophy size={16} color={color} />}
                  </div>
                  {/* Stats */}
                  <div style={{ padding: '14px 16px', display: 'grid',
                    gridTemplateColumns: '1fr 1fr', gap: 12, borderBottom: '1px solid var(--border)' }}>
                    <Pill label="Median TPS"  value={r.stats.median_tps}    color={color} />
                    <Pill label="TTFT ms"     value={r.stats.median_ttft_ms} color="var(--blue)" />
                    <Pill label="Mean Total"  value={`${(r.stats.mean_total_ms/1000).toFixed(1)}s`} color="var(--muted)" />
                    <Pill label="Avg Tokens"  value={Math.round(r.stats.mean_eval_tokens)} color="var(--muted)" />
                  </div>
                  {/* Response preview */}
                  <div style={{ padding: '12px 16px' }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6,
                      fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Response preview</div>
                    <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5,
                      maxHeight: 100, overflow: 'hidden', position: 'relative' }}>
                      {r.response_preview}
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 30,
                        background: 'linear-gradient(transparent, var(--surface))' }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </PageShell>
  )
}
