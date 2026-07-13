'use client'

// ============================================================
// Run History — /admin/run-history
// ============================================================
// Lists all pipeline_test_runs from Supabase.
// Clicking a row expands the full result JSON.
// ============================================================

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'


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
    fetchRuns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opFilter])

  async function fetchDetail(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      setExpandedDetail(null)
      return
    }

    setExpandedId(id)
    setLoadingDetail(true)
    try {
      const res = await fetch(`/api/admin/test-runs/${id}`)
      if (res.ok) {
        const data = await res.json()
        setExpandedDetail(data.run)
      }
    } catch {
      // ignore — show partial data from list
    } finally {
      setLoadingDetail(false)
    }
  }

  async function deleteRun(id: string) {
    if (!window.confirm('Delete this saved run? This cannot be undone.')) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/admin/test-runs/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setRuns(prev => prev.filter(r => r.id !== id))
        if (expandedId === id) { setExpandedId(null); setExpandedDetail(null) }
      }
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
          >
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
        {filteredRuns.map((run) => (
          <div key={run.id} className="rounded-lg border border-border bg-card overflow-hidden">
            {/* Row */}
            <div
              onClick={() => fetchDetail(run.id)}
              role="button"
              tabIndex={0}
              className="w-full text-left px-4 py-3 hover:bg-accent transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3 flex-wrap">
                {/* Status dot */}
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    run.status === 'completed' ? 'bg-signal-strong' : run.status === 'error' ? 'bg-destructive' : 'bg-signal-medium'
                  }`}
                />

                {/* Domain */}
                <span className="text-foreground text-sm font-mono min-w-0 truncate">
                  {run.domain ?? run.company_url}
                </span>

                {/* Operation badge */}
                <Badge className="text-[10px] bg-accent text-muted-foreground flex-shrink-0">
                  {run.operation === 'scraper_only' ? 'Scraper' : run.operation === 'analysis' ? 'Analysis' : 'Pipeline'}
                </Badge>

                {/* Stats */}
                <span className="text-muted-foreground text-xs">{run.scraped_pages ?? 0} pages</span>
                <span className="text-muted-foreground text-xs">Q: {run.quality_score ?? 0}/100</span>
                {run.token_usage > 0 && (
                  <span className="text-muted-foreground text-xs">{run.token_usage?.toLocaleString()} tokens</span>
                )}
                {run.execution_time_ms > 0 && (
                  <span className="text-muted-foreground text-xs">
                    {(run.execution_time_ms / 1000).toFixed(1)}s
                  </span>
                )}

                {/* Error indicator */}
                {run.error_message && (
                  <span className="text-destructive text-xs truncate max-w-48">{run.error_message}</span>
                )}

                {/* Timestamp */}
                <span className="text-muted-foreground/70 text-xs ml-auto flex-shrink-0">
                  {new Date(run.created_at).toLocaleString()}
                </span>

                {/* Delete */}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteRun(run.id) }}
                  disabled={deletingId === run.id}
                  className="text-muted-foreground/70 hover:text-destructive transition-colors text-xs flex-shrink-0 px-1.5 py-0.5 rounded border border-transparent hover:border-destructive/40"
                  title="Delete this run"
                >
                  {deletingId === run.id ? '…' : '🗑'}
                </button>

                {/* Expand indicator */}
                <span className="text-muted-foreground/70 text-xs flex-shrink-0">
                  {expandedId === run.id ? '▲' : '▼'}
                </span>
              </div>
            </div>

            {/* Expanded detail */}
            {expandedId === run.id && (
              <div className="border-t border-border px-4 py-4 space-y-4">
                {loadingDetail ? (
                  <p className="text-muted-foreground text-xs">Loading detail…</p>
                ) : (
                  <>
                    {/* Metadata grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <DetailStat label="URL" value={run.company_url} mono />
                      <DetailStat label="Discovery" value={run.discovery_method ?? '—'} />
                      <DetailStat label="Provider" value={run.provider_used ?? '—'} />
                      <DetailStat label="Model" value={run.model_used ?? '—'} mono />
                      <DetailStat label="Scrape time" value={run.scrape_time_ms ? `${(run.scrape_time_ms / 1000).toFixed(1)}s` : '—'} />
                      <DetailStat label="Analysis time" value={run.analysis_time_ms ? `${(run.analysis_time_ms / 1000).toFixed(1)}s` : '—'} />
                      <DetailStat label="Failed pages" value={String(run.failed_pages ?? 0)} />
                      <DetailStat label="Run ID" value={run.id.slice(0, 8) + '…'} mono />
                    </div>

                    {run.quality_note && (
                      <p className="text-muted-foreground text-xs">{run.quality_note}</p>
                    )}

                    {/* Full result JSON if we loaded it */}
                    {expandedDetail && (
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
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
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
