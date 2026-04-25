import { useState, useEffect } from 'react'
import { FileText, RefreshCw, Download, ChevronRight } from 'lucide-react'
import { getReport, getReportMarkdown } from '../api/client'
import { PageShell, StatCard, Btn } from '../components/ui'

const AMBER = '#e3b341'
const BLUE  = '#58a6ff'

export default function ReportPage() {
  const [report,   setReport]   = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [mdLoading,setMdLoading]= useState(false)

  const load = async () => {
    setLoading(true); setError(null)
    try { setReport(await getReport()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const downloadMd = async () => {
    setMdLoading(true)
    try {
      const md = await getReportMarkdown()
      const blob = new Blob([md], { type: 'text/markdown' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'ollamalens-report.md'
      a.click()
    } catch (e) { alert(e.message) }
    finally { setMdLoading(false) }
  }

  if (loading) return (
    <PageShell title="Report" subtitle="Technical comparison from benchmark data">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: 300, gap: 16, color: 'var(--muted)' }}>
        <div className="spin" style={{ width: 28, height: 28, border: '2px solid var(--accent)',
          borderTopColor: 'transparent', borderRadius: '50%' }} />
        <div style={{ fontSize: 13 }}>Aggregating benchmark data…</div>
      </div>
    </PageShell>
  )

  return (
    <PageShell
      title="Technical Report"
      subtitle="Auto-generated from all benchmark runs stored in SQLite"
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" small onClick={load}>
            <RefreshCw size={12} /> Refresh
          </Btn>
          <Btn small onClick={downloadMd} loading={mdLoading}>
            <Download size={12} /> Export Markdown
          </Btn>
        </div>
      }
    >
      {error && (
        <div style={{ background: '#1a0a0a', border: '1px solid var(--red)',
          borderRadius: 8, padding: '12px 16px', color: 'var(--red)',
          fontFamily: 'var(--font-mono)', fontSize: 12, marginBottom: 24 }}>
          ✕ {error}
        </div>
      )}

      {report && (
        <>
          {/* Meta */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
            <div style={{ padding: '6px 14px', background: 'var(--surface)',
              border: '1px solid var(--border)', borderRadius: 20,
              fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
              Generated: {new Date(report.generated_at).toLocaleString()}
            </div>
            <div style={{ padding: '6px 14px', background: 'var(--surface)',
              border: '1px solid var(--border)', borderRadius: 20,
              fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
              Models: {report.raw_stats.length}
            </div>
          </div>

          {/* Hardware profile */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '20px', marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-display)',
              marginBottom: 14, color: BLUE }}>Hardware Profile</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {Object.entries(report.hardware).map(([k, v]) => (
                <div key={k} style={{ background: 'var(--surface2)',
                  border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase',
                    letterSpacing: 0.5, marginBottom: 4 }}>{k.replace(/_/g, ' ')}</div>
                  <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Model stats summary */}
          {report.raw_stats.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)',
                fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                Model Performance Summary
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--surface2)' }}>
                    {['Rank','Model','Median TPS','Mean TTFT','Min TPS','Max TPS','Runs'].map(h => (
                      <th key={h} style={{ padding: '8px 16px', textAlign: 'left', fontSize: 10,
                        fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--muted)',
                        textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.raw_stats.map((s, i) => (
                    <tr key={s.model} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12,
                        color: i === 0 ? 'var(--accent)' : 'var(--muted)' }}>
                        #{i + 1} {i === 0 ? '🏆' : ''}
                      </td>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 11,
                        color: 'var(--text)' }}>{s.model}</td>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12,
                        color: 'var(--accent)', fontWeight: 600 }}>{s.median_tps}</td>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12,
                        color: BLUE }}>{s.median_ttft_ms} ms</td>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12,
                        color: 'var(--muted)' }}>{s.min_tps}</td>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12,
                        color: 'var(--muted)' }}>{s.max_tps}</td>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12,
                        color: 'var(--muted)' }}>{s.runs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Report sections */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)',
              textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
              Report Sections
            </div>
            {report.sections.map((section, i) => (
              <div key={i} style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 10, marginBottom: 12, overflow: 'hidden',
              }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ChevronRight size={14} color="var(--accent)" />
                  <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                    {section.title}
                  </div>
                </div>
                <div style={{ padding: '16px 20px' }}>
                  <pre style={{ fontFamily: 'var(--font-sans)', fontSize: 13, lineHeight: 1.7,
                    whiteSpace: 'pre-wrap', color: 'var(--text)', margin: 0 }}>
                    {section.content}
                  </pre>
                </div>
              </div>
            ))}
          </div>

          {report.raw_stats.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>
              <FileText size={36} style={{ opacity: 0.3, marginBottom: 12 }} />
              <div style={{ fontSize: 14 }}>No benchmark data yet.</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Run some benchmarks first on the Benchmark page.</div>
            </div>
          )}
        </>
      )}
    </PageShell>
  )
}
