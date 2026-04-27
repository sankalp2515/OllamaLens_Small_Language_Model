import { useEffect, useCallback } from 'react'
import { FileText, RefreshCw, Download, ChevronRight, BarChart2 } from 'lucide-react'
import { getReport, getReportMarkdown } from '../api/client'
import { useApp } from '../context/AppContext'
import { PageShell, EmptyState, MODELS } from '../components/ui'

const MODEL_COLOR = Object.fromEntries(MODELS.map(m => [m.id, m.color]))

export default function ReportPage() {
  const { report, setReport, reportLoading, setReportLoading } = useApp()

  const load = useCallback(async () => {
    setReportLoading(true)
    try { setReport(await getReport()) }
    catch (e) { setReport({ error: e.message }) }
    finally { setReportLoading(false) }
  }, [])

  useEffect(() => { if (!report) load() }, [])

  const downloadMd = async () => {
    try {
      const md = await getReportMarkdown()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }))
      a.download = 'ollamalens-report.md'
      a.click()
    } catch (e) { alert(e.message) }
  }

  return (
    <PageShell
      title="Technical Report"
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={reportLoading}>
            <RefreshCw size={12} style={{ animation: reportLoading ? 'spin 0.7s linear infinite' : 'none' }} /> Refresh
          </button>
          <button className="btn btn-primary btn-sm" onClick={downloadMd} disabled={reportLoading || !report || report?.error}>
            <Download size={12} /> Export Markdown
          </button>
        </div>
      }
    >
      {reportLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '40px 0', color: 'var(--t3)' }}>
          <div className="spinner" /> Aggregating benchmark data…
        </div>
      )}

      {report?.error && (
        <div style={{ background: 'var(--rose-dim)', border: '1px solid rgba(244,63,94,.25)', borderRadius: 8, padding: '10px 14px', color: 'var(--rose)', fontSize: 13 }}>
          ✕ {report.error}
        </div>
      )}

      {report && !report.error && !reportLoading && (
        <div className="stagger" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Meta */}
          <div className="anim-fade-up" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="tag tag-cyan">Generated {new Date(report.generated_at).toLocaleString()}</span>
            <span className="tag tag-sky">{report.raw_stats.length} models</span>
            <span className="tag tag-emerald">{report.raw_stats.reduce((s, r) => s + r.runs, 0)} total runs</span>
          </div>

          {/* Hardware */}
          <div className="anim-fade-up card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--b1)', fontWeight: 700, fontSize: 13 }}>Hardware Profile</div>
            <div style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
              {Object.entries(report.hardware).map(([k, v]) => (
                <div key={k} style={{ background: 'var(--s2)', border: '1px solid var(--b1)', borderRadius: 8, padding: '10px 12px' }}>
                  <div className="label" style={{ marginBottom: 3, display: 'block' }}>{k.replace(/_/g, ' ')}</div>
                  <div style={{ fontSize: 13, fontFamily: 'var(--ff-mono)', color: 'var(--t1)' }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Ranking table */}
          {report.raw_stats.length > 0 && (
            <div className="anim-fade-up card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--b1)', fontWeight: 700, fontSize: 13 }}>Performance Ranking</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--s2)' }}>
                    {['Rank', 'Model', 'Median TPS', 'TTFT', 'TPS Range', 'Runs'].map(h => (
                      <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontFamily: 'var(--ff-mono)', fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid var(--b1)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.raw_stats.map((s, i) => {
                    const c = MODEL_COLOR[s.model] ?? 'var(--t2)'
                    const pct = (s.median_tps / Math.max(...report.raw_stats.map(r => r.median_tps))) * 100
                    return (
                      <tr key={s.model} style={{ borderBottom: i < report.raw_stats.length - 1 ? '1px solid var(--b1)' : 'none', transition: 'background 0.1s' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-mono)', fontSize: 12, color: i === 0 ? 'var(--cyan)' : 'var(--t3)' }}>
                          #{i + 1}{i === 0 ? ' 🏆' : ''}
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <div style={{ width: 7, height: 7, borderRadius: '50%', background: c, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, fontFamily: 'var(--ff-mono)', color: 'var(--t1)' }}>{s.model}</span>
                          </div>
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontFamily: 'var(--ff-mono)', fontSize: 14, fontWeight: 700, color: c }}>{s.median_tps}</span>
                            <div style={{ width: 60, height: 3, background: 'var(--s4)', borderRadius: 2 }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: c, borderRadius: 2 }} />
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-mono)', fontSize: 12, color: 'var(--sky)' }}>{s.median_ttft_ms}ms</td>
                        <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-mono)', fontSize: 12, color: 'var(--t3)' }}>{s.min_tps}–{s.max_tps}</td>
                        <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-mono)', fontSize: 12, color: 'var(--t3)' }}>{s.runs}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Report sections as accordions */}
          <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="label" style={{ marginBottom: 6, display: 'block' }}>Analysis Sections</div>
            {report.sections.map((s, i) => (
              <details key={i} style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--b1)' }}>
                <summary style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px',
                  background: 'var(--s1)', cursor: 'pointer', listStyle: 'none',
                  fontSize: 13, fontWeight: 600, color: 'var(--t1)', transition: 'background 0.13s',
                }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--s2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--s1)'}
                >
                  <ChevronRight size={13} color="var(--cyan)" style={{ flexShrink: 0 }} />
                  {s.title}
                </summary>
                <div style={{ padding: '12px 14px', background: 'var(--s2)', fontSize: 13, color: 'var(--t2)', lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
                  {s.content}
                </div>
              </details>
            ))}
          </div>

          {report.raw_stats.length === 0 && (
            <EmptyState icon={BarChart2} title="No benchmark data" sub="Run benchmarks first, then come back here for the full analysis report." />
          )}
        </div>
      )}

      {!report && !reportLoading && (
        <EmptyState icon={FileText} title="Report not loaded" sub="Click Refresh to generate the report from your benchmark data." />
      )}
    </PageShell>
  )
}