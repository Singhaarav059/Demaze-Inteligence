'use client'

// ============================================================
// Run History — /admin/run-history
// ============================================================
// Redesigned into an activity workspace (redesign brief Section 23):
// tabs for All / Research / Discovery / Outreach, each backed by real,
// already-persisted event data — no fabricated activity types.
//
// - Research tab: unchanged — pipeline_test_runs, as report-style cards
//   (company, industry, generated date, signals, top opportunity, top
//   outreach angle). Clicking a row / "View Report" expands the same
//   Step1Research report used elsewhere in the app.
// - Discovery tab: outbound_contacts rows with discovery_source =
//   'decision_maker_discovery' (migration 010) — i.e. real "Decision maker
//   found" events. Company-discovery CANDIDATE events (the ICP -> matching
//   companies search results) are never persisted as their own log —
//   they're ephemeral until a candidate is explicitly researched, at which
//   point they become a normal Research-tab run — so there is no separate
//   "companies discovered" event to show here; this tab is honestly scoped
//   to what's actually real.
// - Outreach tab: outbound_campaign_contacts rows (via the existing
//   /api/admin/outbound/overview endpoint) — real send/reply/bounce status
//   per contact, with real updated_at timestamps.
// - All tab: the three real sources above, merged and sorted chronologically.
// ============================================================

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { History, UserSearch, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { MetricTile } from '@/components/ui/metric-tile'
import { IntelStatus, type IntelStatusKind } from '@/components/ui/intel-status'
import { computeDailyCounts, hasSufficientTrendData } from '@/lib/analytics/daily-counts'
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

// Relative-day bucket label for the "All" activity timeline — local calendar
// day, not a 24h rolling window (matches how a person actually thinks about
// "today"/"yesterday"). Falls back to formatDate() for anything older.
function relativeDayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unknown date'
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return formatDate(iso)
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

// Discovery tab — outbound_contacts rows sourced from real decision-maker
// discovery (migration 010's discovery_source column), never manually-typed
// contacts. Fields kept to exactly what GET /api/admin/outbound/contacts
// already returns.
interface DiscoveryContact {
  id: string
  company_name: string
  person_name: string
  title_hint: string | null
  discovery_source: string
  discovery_confidence: string | null
  discovery_provider: string | null
  created_at: string
}

// Outreach tab — reuses the exact row shape GET /api/admin/outbound/overview
// already returns for its own "Emails" table.
interface OutreachEmail {
  id: string
  status: string
  updated_at: string
  outbound_contacts: { person_name: string; company_name: string; email: string | null } | null
  outbound_campaigns: { name: string } | null
  outbound_generated_content: { selected_subject_line: string | null } | null
}

function outreachStatusVariant(status: string) {
  if (status === 'replied') return 'default' as const
  if (status === 'bounced') return 'destructive' as const
  if (status === 'queued') return 'outline' as const
  return 'secondary' as const
}

function outreachStatusLabel(status: string) {
  if (status.startsWith('followup_')) return `Follow-up ${status.slice(-1)}`
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function runIntelStatus(run: Run): IntelStatusKind {
  if (run.status === 'completed') return 'complete'
  if (run.status === 'error') return 'failed'
  return 'needs_review'
}

// A single point in the merged "All" timeline — one shape covering all
// three real event sources, so they can be sorted and rendered uniformly.
interface ActivityItem {
  key: string
  ts: string
  kind: 'research' | 'discovery' | 'outreach'
  title: string
  subtitle: string
}

export default function RunHistoryPage() {
  const router = useRouter()
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedDetail, setExpandedDetail] = useState<Record<string, unknown> | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [opFilter, setOpFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'company'>('newest')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Discovery + Outreach tabs — fetched once, independent of the Research
  // tab's opFilter/sort, since they're a different real data source.
  const [discoveryContacts, setDiscoveryContacts] = useState<DiscoveryContact[]>([])
  const [discoveryLoading, setDiscoveryLoading] = useState(true)
  const [outreachEmails, setOutreachEmails] = useState<OutreachEmail[]>([])
  const [outreachLoading, setOutreachLoading] = useState(true)

  async function fetchRuns() {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ limit: '100' })
      if (opFilter !== 'all') qs.set('operation', opFilter)
      const res = await fetch(`/api/admin/test-runs?${qs.toString()}`)
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

  useEffect(() => {
    void (async () => {
      setDiscoveryLoading(true)
      try {
        const res = await fetch('/api/admin/outbound/contacts')
        const data = await res.json()
        if (data.success) {
          setDiscoveryContacts(
            (data.contacts as DiscoveryContact[]).filter(c => c.discovery_source === 'decision_maker_discovery')
          )
        }
      } catch {
        // non-fatal — the Discovery tab just shows its empty state
      } finally {
        setDiscoveryLoading(false)
      }
    })()

    void (async () => {
      setOutreachLoading(true)
      try {
        const res = await fetch('/api/admin/outbound/overview?limit=200')
        const data = await res.json()
        if (data.success) setOutreachEmails(data.emails)
      } catch {
        // non-fatal — the Outreach tab just shows its empty state
      } finally {
        setOutreachLoading(false)
      }
    })()
  }, [])

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

  // Client-side only — the API already returns everything opFilter asked
  // for, so no new fetch/route is needed for this. Sorts by domain (not the
  // fancier report-derived company name) to avoid re-running
  // getResearchCardData() a second time just for a sort key.
  const filteredRuns = useMemo(() => {
    const list = [...runs]
    if (sortBy === 'oldest') {
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    } else if (sortBy === 'company') {
      list.sort((a, b) => (a.domain || a.company_url).localeCompare(b.domain || b.company_url))
    } else {
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    }
    return list
  }, [runs, sortBy])

  // Groups the Research tab into Today / Yesterday / <date> timeline
  // sections — only when chronologically sorted; an alphabetical company
  // sort can't produce contiguous day groups, so that view stays a flat
  // list instead of relabeling out-of-order groups.
  const groupedRuns = useMemo(() => {
    if (sortBy === 'company') return [{ label: null as string | null, items: filteredRuns }]
    const groups: { label: string | null; items: Run[] }[] = []
    for (const run of filteredRuns) {
      const label = relativeDayLabel(run.created_at)
      const last = groups[groups.length - 1]
      if (last && last.label === label) last.items.push(run)
      else groups.push({ label, items: [run] })
    }
    return groups
  }, [filteredRuns, sortBy])

  // Research volume over time (redesign brief Section 24) — real data only:
  // computed from the already-fetched runs, gated on genuine sufficiency so
  // an account with only a handful of runs never sees a near-empty chart.
  const researchDaily = useMemo(() => computeDailyCounts(runs.map(r => r.created_at), 14), [runs])
  const showResearchTrend = hasSufficientTrendData(researchDaily)

  // "All" tab — the three real event sources merged into one chronological
  // feed. Purely a client-side merge of already-fetched arrays; no new data
  // source, no fabricated event types.
  const allActivity = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = []
    for (const r of runs) {
      const cardData = r.final_result ? getResearchCardData(toRunResult(r)) : null
      items.push({
        key: `research-${r.id}`,
        ts: r.created_at,
        kind: 'research',
        title: `Company researched — ${cardData?.companyName ?? r.domain ?? r.company_url}`,
        subtitle: formatDate(r.created_at),
      })
    }
    for (const c of discoveryContacts) {
      items.push({
        key: `discovery-${c.id}`,
        ts: c.created_at,
        kind: 'discovery',
        title: `Decision maker found — ${c.person_name}${c.title_hint ? `, ${c.title_hint}` : ''}`,
        subtitle: `${c.company_name} · ${formatDate(c.created_at)}`,
      })
    }
    for (const e of outreachEmails) {
      items.push({
        key: `outreach-${e.id}`,
        ts: e.updated_at,
        kind: 'outreach',
        title: `Outreach ${outreachStatusLabel(e.status).toLowerCase()} — ${e.outbound_contacts?.person_name ?? 'Unknown contact'}`,
        subtitle: `${e.outbound_contacts?.company_name ?? '—'} · ${formatDate(e.updated_at)}`,
      })
    }
    return items.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
  }, [runs, discoveryContacts, outreachEmails])

  // Groups the same sorted list into Today / Yesterday / <date> sections —
  // pure client-side bucketing of already-sorted real timestamps, no new
  // data source.
  const groupedActivity = useMemo(() => {
    const groups: { label: string; items: ActivityItem[] }[] = []
    for (const item of allActivity.slice(0, 100)) {
      const label = relativeDayLabel(item.ts)
      const last = groups[groups.length - 1]
      if (last && last.label === label) last.items.push(item)
      else groups.push({ label, items: [item] })
    }
    return groups
  }, [allActivity])

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">History</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Every research run, decision-maker find, and outreach event in one place.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <MetricTile
          icon={History}
          label="Research runs"
          value={runs.length}
          sub={showResearchTrend ? `${researchDaily.reduce((sum, b) => sum + b.count, 0)} in last 14 days` : undefined}
          trend={showResearchTrend ? researchDaily : undefined}
        />
        <MetricTile icon={UserSearch} label="Decision makers found" value={discoveryContacts.length} />
        <MetricTile icon={Send} label="Outreach events" value={outreachEmails.length} />
      </div>

      <Tabs defaultValue="research">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="research">Research</TabsTrigger>
          <TabsTrigger value="discovery">Discovery</TabsTrigger>
          <TabsTrigger value="outreach">Outreach</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4 space-y-3">
          {allActivity.length === 0 ? (
            <EmptyState
              icon={History}
              title="No activity yet"
              description="Research a company, find a decision maker, or send outreach to see it here."
            />
          ) : (
            <div className="space-y-4">
              {groupedActivity.map(group => (
                <div key={group.label}>
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide">
                    {group.label}
                  </h3>
                  <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
                    {group.items.map(item => {
                      const Icon = item.kind === 'research' ? History : item.kind === 'discovery' ? UserSearch : Send
                      const tone = item.kind === 'research' ? 'text-signal-strong' : item.kind === 'discovery' ? 'text-primary' : 'text-signal-medium'
                      return (
                      <div key={item.key} className="flex items-center gap-3 px-4 py-2.5">
                        <span className={`flex size-6 shrink-0 items-center justify-center rounded-md bg-accent ${tone}`}>
                          <Icon className="size-3.5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-foreground text-sm truncate">{item.title}</p>
                          <p className="text-muted-foreground/70 text-xs">{item.subtitle}</p>
                        </div>
                      </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="research" className="mt-4 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
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
            <Select
              items={[
                { value: 'newest', label: 'Newest first' },
                { value: 'oldest', label: 'Oldest first' },
                { value: 'company', label: 'Company (A–Z)' },
              ]}
              value={sortBy}
              onValueChange={value => setSortBy(value as typeof sortBy)}
            >
              <SelectTrigger aria-label="Sort runs" className="h-auto w-auto rounded-md border-border bg-card px-2 py-1.5 text-xs text-muted-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
                <SelectItem value="company">Company (A–Z)</SelectItem>
              </SelectContent>
            </Select>
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

          {loading && (
            <div className="text-muted-foreground text-sm">Loading runs…</div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
              <p className="text-destructive text-sm">{error}</p>
            </div>
          )}

          {!loading && filteredRuns.length === 0 && (
            <EmptyState
              icon={History}
              title="No runs yet"
              description="Go to the Intelligence Lab and run a test to see it here."
              action={
                <Button size="sm" variant="outline" render={<a href="/admin/intelligence-lab" />}>
                  Open Intelligence Lab
                </Button>
              }
            />
          )}

          <div className="space-y-4">
            {groupedRuns.map((group, groupIndex) => (
              <div key={group.label ?? `runs-${groupIndex}`}>
                {group.label && (
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide">
                    {group.label}
                  </h3>
                )}
                <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
                  {group.items.map((run) => {
                    const cardData = run.final_result ? getResearchCardData(toRunResult(run)) : null
                    const topOpportunity = cardData?.opportunities?.[0]
                      ? humanizeText((cardData.opportunities[0] as Record<string, unknown>).title)
                      : ''
                    const industryLine = cardData
                      ? [cardData.industry, cardData.subIndustry !== cardData.industry ? cardData.subIndustry : null]
                          .filter(Boolean)
                          .join(' · ')
                      : ''
                    // Short, real outcome summary line — no fabricated
                    // detail, only fields already on getResearchCardData().
                    const outcomeSummary = cardData
                      ? [
                          industryLine,
                          cardData.companyFit?.label ? `Fit: ${cardData.companyFit.label}` : null,
                          `${cardData.signalCount} signal${cardData.signalCount === 1 ? '' : 's'}`,
                          topOpportunity ? `Top opportunity: ${topOpportunity}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : `${run.company_url} · No report data available for this run.`
                    const isExpanded = expandedId === run.id

                    return (
                      <div key={run.id} className="group">
                        {/* Row — click-anywhere is a mouse convenience only; the
                            "View Report" button is the real, keyboard-accessible
                            control for this action. This div previously claimed
                            role="button"/tabIndex={0} without an onKeyDown
                            handler, so keyboard users could Tab to it but never
                            activate it — and it already wraps other real buttons
                            (View Report, Delete), which is invalid to nest inside
                            an actual <button> anyway (2026-07-19 fix). */}
                        <div
                          onClick={() => fetchDetail(run.id)}
                          className="w-full text-left px-4 py-2.5 hover:bg-accent transition-colors cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <IntelStatus status={runIntelStatus(run)} />
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
                              <p className="text-muted-foreground/70 text-xs mt-1 truncate">
                                {outcomeSummary} · {formatDate(run.created_at)}
                              </p>
                            </div>

                            {/* Actions — subtle by default, brought to full
                                emphasis on hover/keyboard-focus (opacity, not
                                display:none, so they stay tabbable and visible
                                on touch devices — no discoverability loss vs.
                                the always-visible buttons this replaces). */}
                            <div className="flex items-center gap-1.5 flex-shrink-0 opacity-70 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-border bg-card text-foreground/90 hover:bg-accent"
                                onClick={(e) => { e.stopPropagation(); fetchDetail(run.id) }}
                              >
                                {isExpanded ? 'Hide Report' : 'View Report'}
                              </Button>
                              {/* Only offered when there's a real analysis result
                                  to build contacts/outreach on top of (cardData is
                                  null for scraper-only runs or a run that failed
                                  before producing a result) — never for an
                                  incomplete run. Always opens at step 2 (Decision
                                  Makers — Auto Flow's step numbering, see
                                  StepIndicator.tsx; a "Sales Strategy" step
                                  briefly sat at step 2 between 2026-08-13 and its
                                  removal the same week, which is why this used to
                                  say step=3); Auto Flow's own resumeFromRun()
                                  unlocks further pills (Contact Info / Campaign &
                                  Outreach) once it discovers contacts or a
                                  campaign already exist for this run, so this
                                  link never needs to guess how far a given run
                                  actually got. */}
                              {cardData && run.status === 'completed' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-border bg-card text-foreground/90 hover:bg-accent"
                                  onClick={(e) => { e.stopPropagation(); router.push(`/admin/auto-gtm?runId=${run.id}&step=2`) }}
                                >
                                  Resume in Auto Flow
                                </Button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(run.id) }}
                                disabled={deletingId === run.id}
                                className="text-muted-foreground/70 hover:text-destructive transition-colors text-xs flex-shrink-0 px-1.5 py-1 rounded border border-transparent hover:border-destructive/40"
                                title="Delete this run"
                                aria-label={deletingId === run.id ? 'Deleting run…' : 'Delete this run'}
                              >
                                {deletingId === run.id ? '…' : '🗑'}
                              </button>
                              {/* Expand indicator — purely decorative, the state
                                  it conveys is already in the "View
                                  Report"/"Hide Report" button text above. */}
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
                                No saved analysis result for this run, nothing to render as a report.
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
                                  <DetailStat label="Discovery" value={run.discovery_method ?? 'N/A'} />
                                  <DetailStat label="Provider" value={run.provider_used ?? 'N/A'} />
                                  <DetailStat label="Model" value={run.model_used ?? 'N/A'} mono />
                                  <DetailStat label="Scrape time" value={run.scrape_time_ms ? `${(run.scrape_time_ms / 1000).toFixed(1)}s` : 'N/A'} />
                                  <DetailStat label="Analysis time" value={run.analysis_time_ms ? `${(run.analysis_time_ms / 1000).toFixed(1)}s` : 'N/A'} />
                                  <DetailStat label="Failed pages" value={String(run.failed_pages ?? 0)} />
                                  <DetailStat label="Pages scraped" value={String(run.scraped_pages ?? 0)} />
                                  <DetailStat label="Quality" value={`${run.quality_score ?? 0}/100`} />
                                  <DetailStat label="Tokens" value={run.token_usage ? run.token_usage.toLocaleString() : 'N/A'} />
                                  <DetailStat label="Execution time" value={run.execution_time_ms ? `${(run.execution_time_ms / 1000).toFixed(1)}s` : 'N/A'} />
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
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="discovery" className="mt-4">
          {discoveryLoading ? (
            <div className="text-muted-foreground text-sm">Loading…</div>
          ) : discoveryContacts.length === 0 ? (
            <EmptyState
              icon={UserSearch}
              title="No decision makers found yet"
              description="Run Decision-Maker Discovery from a company's Auto Flow to see results here."
            />
          ) : (
            <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
              {discoveryContacts.map(c => (
                <div key={c.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-foreground text-sm font-semibold">{c.person_name}</span>
                    {c.title_hint && <span className="text-muted-foreground/70 text-xs">{c.title_hint}</span>}
                    {c.discovery_confidence && (
                      <Badge className="text-[10px] bg-accent text-muted-foreground">{c.discovery_confidence} confidence</Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground/70 text-xs mt-1">
                    {c.company_name} · {c.discovery_provider ?? 'unknown provider'} · {formatDate(c.created_at)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="outreach" className="mt-4">
          {outreachLoading ? (
            <div className="text-muted-foreground text-sm">Loading…</div>
          ) : outreachEmails.length === 0 ? (
            <EmptyState
              icon={Send}
              title="No outreach sent yet"
              description="Send a campaign from Auto Flow or the Campaigns page to see activity here."
            />
          ) : (
            <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
              {outreachEmails.map(e => (
                <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-foreground text-sm truncate">{e.outbound_contacts?.person_name ?? 'Unknown contact'}</span>
                      <Badge variant={outreachStatusVariant(e.status)}>{outreachStatusLabel(e.status)}</Badge>
                    </div>
                    <p className="text-muted-foreground/70 text-xs truncate">
                      {e.outbound_contacts?.company_name}
                      {e.outbound_campaigns?.name ? ` · ${e.outbound_campaigns.name}` : ''}
                      {e.outbound_generated_content?.selected_subject_line ? ` · "${e.outbound_generated_content.selected_subject_line}"` : ''}
                    </p>
                  </div>
                  <span className="text-muted-foreground/60 text-xs flex-shrink-0">{formatDate(e.updated_at)}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

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
