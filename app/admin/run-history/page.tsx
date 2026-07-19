'use client'

// ============================================================
// Run History — /admin/run-history
// ============================================================
// Lists all pipeline_test_runs from Supabase as report-style
// cards (company, industry, generated date, signals, top
// opportunity, top outreach angle). Clicking a row / "View
// Report" expands the same Step1Research report used elsewhere
// in the app. Raw metadata + full result JSON are still
// available, tucked behind a "debug data" toggle.
// ============================================================

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { getResearchCardData } from '@/app/admin/intelligence-lab/ResearchCard'
import { Step1Research } from '@/components/wizard/steps/Step1Research'
import { humanizeText } from '@/lib/text/humanize'
import type { RunResult } from '@/app/admin/intelligence-lab/_types'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`
}

interface Run {
  id: string
  company_url: string
  domain: string
  operation: string
  status: string
  scraped_pages: number
  failed_pages: number
  quality_score: number
  quality_note: string
  token_usage: number
  provider_used: string
  model_used: string
  execution_time_ms: number
  scrape_time_ms: number
  analysis_time_ms: number
  discovery_method: string
  error_message: string
  created_at: string
  final_result?: Record<string, unknown> | null
}

// Reconstruct a minimal RunResult from a persisted run row so the shared
// getResearchCardData()/Step1Research report renderer can be reused as-is —
// analysisResult is the only field either of those actually reads.
function toRunResult(run: Run): RunResult {
  return {
    success: true,
    domain: run.domain,
    analysisResult: run.final_result ?? undefined,
  }
}

export default function RunHistoryPage() {
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedDetail, setExpandedDetail] = useState<Record<string, unknown> | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [opFilter, setOpFilter] = useState<string>('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  async function fetchRuns() {
    setLoading(true)
    setError(null)
    try {
      const params = opFilter !== 'all' ? `?operation=${opFilter}` : ''
      const res = await fetch(`/api/admin/test-runs${params}`)
      const data = await res.json()
      if (data.success) {
        setRuns(data.runs)
      } else {
        setError(data.error ?? 'Failed to fetch runs')
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Intentional fetch-on-mount/filter-change, not a derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRuns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opFilter])

  async function fetchDetail(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      setExpandedDetail(null)
      setShowDebug(false)
      return
    }

    setExpandedId(id)
    setShowDebug(false)
    setLoadingDetail(true)
    try {
      const res = await fetch(`/api/admin/test-runs/${id}`)
      if (res.ok) {
        const data = await res.json()
        setExpandedDetail(data.run)
      } else {
        toast.error('Failed to load report detail')
        setExpandedId(null)
      }
    } catch {
      toast.error('Could not reach the run-history API')
      setExpandedId(null)
    } finally {
      setLoadingDetail(false)
    }
  }

  async function deleteRun(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/admin/test-runs/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setRuns(prev => prev.filter(r => r.id !== id))
        if (expandedId === id) { setExpandedId(null); setExpandedDetail(null); setShowDebug(false) }
        toast.success('Run deleted')
      } else {
        toast.error('Failed to delete run')
      }
    } catch {
      toast.error('Could not reach the run-history API')
    } finally {
      setDeletingId(null)
    }
  }

  const filteredRuns = runs

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Run History</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{runs.length} test runs stored</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Filter */}
          {['all', 'scraper_only', 'analysis', 'full_pipeline'].map((op) => (
            <button
              key={op}
              onClick={() => setOpFilter(op)}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${
                opFilter === op
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {op === 'all' ? 'All' : op === 'scraper_only' ? 'Scraper' : op === 'analysis' ? 'Analysis' : 'Pipeline'}
            </button>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="border-border bg-card text-foreground/90 hover:bg-accent"
            onClick={fetchRuns}
            disabled={loading}
          >
            {loading ? <Spinner className="size-3.5" /> : null}
            Refresh
          </Button>
        </div>
      </div>

      {loading && (
        <div className="text-muted-foreground text-sm">Loading runs…</div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
          <p className="text-destructive text-sm">{error}</p>
        </div>
      )}

      {!loading && filteredRuns.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <p className="text-muted-foreground text-sm">No runs yet.</p>
          <p className="text-muted-foreground/70 text-xs mt-1">
            Go to the <a href="/admin/intelligence-lab" className="text-primary underline">Intelligence Lab</a> and run a test.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {filteredRuns.map((run) => {
          const cardData = run.final_result ? getResearchCardData(toRunResult(run)) : null
          const topOpportunity = cardData?.opportunities?.[0]
            ? humanizeText((cardData.opportunities[0] as Record<string, unknown>).title)
            : ''
          const topOutreachAngle = cardData?.openingAngle ?? ''
          const industryLine = cardData
            ? [cardData.industry, cardData.subIndustry !== cardData.industry ? cardData.subIndustry : null]
                .filter(Boolean)
                .join(' — ')
            : ''
          const isExpanded = expandedId === run.id

          return (
            <div key={run.id} className="rounded-lg border border-border bg-card overflow-hidden">
              {/* Card — click-anywhere is a mouse convenience only; the "View
                  Report" button below is the real, keyboard-accessible
                  control for this action. This div previously claimed
                  role="button"/tabIndex={0} without an onKeyDown handler, so
                  keyboard users could Tab to it but never activate it — and
                  it already wraps other real buttons (View Report, Delete),
                  which is invalid to nest inside an actual <button> anyway
                  (2026-07-19 fix). */}
              <div
                onClick={() => fetchDetail(run.id)}
                className="w-full text-left px-4 py-4 hover:bg-accent transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Status dot */}
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          run.status === 'completed' ? 'bg-signal-strong' : run.status === 'error' ? 'bg-destructive' : 'bg-signal-medium'
                        }`}
                      />
                      <span className="text-foreground text-sm font-semibold truncate">
                        {cardData?.companyName ?? run.domain ?? run.company_url}
                      </span>
                      <Badge className="text-[10px] bg-accent text-muted-foreground flex-shrink-0">
                        {run.operation === 'scraper_only' ? 'Scraper' : run.operation === 'analysis' ? 'Analysis' : 'Pipeline'}
                      </Badge>
                      {run.error_message && (
                        <span className="text-destructive text-xs truncate max-w-48">{run.error_message}</span>
                      )}
                    </div>

                    {cardData ? (
                      <>
                        {industryLine && (
                          <p className="text-muted-foreground text-xs mt-1">{industryLine}</p>
                        )}
                        <p className="text-muted-foreground/70 text-xs mt-2">
                          Generated: {formatDate(run.created_at)}
                        </p>
                        <div className="mt-2 space-y-0.5 text-xs">
                          <p className="text-foreground/80">
                            Signals: <span className="text-foreground">{cardData.signalCount}</span>
                          </p>
                          {topOpportunity && (
                            <p className="text-foreground/80">
                              Top Opportunity: <span className="text-foreground">{topOpportunity}</span>
                            </p>
                          )}
                          {topOutreachAngle && (
                            <p className="text-foreground/80">
                              Top Outreach Angle: <span className="text-foreground">{topOutreachAngle}</span>
                            </p>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="text-muted-foreground/70 text-xs mt-1">
                        {run.company_url} · Generated: {formatDate(run.created_at)} · No report data available for this run.
                      </p>
                    )}

                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 border-border bg-card text-foreground/90 hover:bg-accent"
                      onClick={(e) => { e.stopPropagation(); fetchDetail(run.id) }}
                    >
                      {isExpanded ? 'Hide Report' : 'View Report'}
                    </Button>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Delete */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(run.id) }}
                      disabled={deletingId === run.id}
                      className="text-muted-foreground/70 hover:text-destructive transition-colors text-xs flex-shrink-0 px-1.5 py-0.5 rounded border border-transparent hover:border-destructive/40"
                      title="Delete this run"
                      aria-label={deletingId === run.id ? 'Deleting run…' : 'Delete this run'}
                    >
                      {deletingId === run.id ? '…' : '🗑'}
                    </button>

                    {/* Expand indicator — purely decorative, the state it
                        conveys is already in the "View Report"/"Hide Report"
                        button text above. */}
                    <span className="text-muted-foreground/70 text-xs flex-shrink-0" aria-hidden="true">
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-border px-4 py-4 space-y-4">
                  {cardData ? (
                    <Step1Research result={toRunResult(run)} />
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      No saved analysis result for this run — nothing to render as a report.
                    </p>
                  )}

                  {run.quality_note && (
                    <p className="text-muted-foreground text-xs">{run.quality_note}</p>
                  )}

                  <button
                    onClick={() => setShowDebug((v) => !v)}
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    {showDebug ? 'Hide debug data' : 'Show debug data'}
                  </button>

                  {showDebug && (
                    <div className="space-y-4">
                      {/* Metadata grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <DetailStat label="URL" value={run.company_url} mono />
                        <DetailStat label="Discovery" value={run.discovery_method ?? '—'} />
                        <DetailStat label="Provider" value={run.provider_used ?? '—'} />
                        <DetailStat label="Model" value={run.model_used ?? '—'} mono />
                        <DetailStat label="Scrape time" value={run.scrape_time_ms ? `${(run.scrape_time_ms / 1000).toFixed(1)}s` : '—'} />
                        <DetailStat label="Analysis time" value={run.analysis_time_ms ? `${(run.analysis_time_ms / 1000).toFixed(1)}s` : '—'} />
                        <DetailStat label="Failed pages" value={String(run.failed_pages ?? 0)} />
                        <DetailStat label="Pages scraped" value={String(run.scraped_pages ?? 0)} />
                        <DetailStat label="Quality" value={`${run.quality_score ?? 0}/100`} />
                        <DetailStat label="Tokens" value={run.token_usage ? run.token_usage.toLocaleString() : '—'} />
                        <DetailStat label="Execution time" value={run.execution_time_ms ? `${(run.execution_time_ms / 1000).toFixed(1)}s` : '—'} />
                        <DetailStat label="Run ID" value={run.id.slice(0, 8) + '…'} mono />
                      </div>

                      {loadingDetail ? (
                        <p className="text-muted-foreground text-xs">Loading full result…</p>
                      ) : expandedDetail ? (
                        <Card className="bg-background border-border">
                          <CardHeader className="pb-2 pt-3 px-4">
                            <CardTitle className="text-xs text-muted-foreground">Full Result JSON</CardTitle>
                          </CardHeader>
                          <CardContent className="px-4 pb-4">
                            <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap max-h-80 overflow-y-auto leading-relaxed">
                              {JSON.stringify(expandedDetail, null, 2)}
                            </pre>
                          </CardContent>
                        </Card>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={open => { if (!open) setConfirmDeleteId(null) }}
        title="Delete this saved run?"
        description="This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={deletingId !== null}
        onConfirm={() => {
          if (confirmDeleteId) void deleteRun(confirmDeleteId)
          setConfirmDeleteId(null)
        }}
      />
    </div>
  )
}

function DetailStat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-muted-foreground/70 text-xs mb-0.5">{label}</p>
      <p className={`text-foreground/90 text-xs truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}
