'use client'

// ============================================================
// Workspace Overview — /admin (home)
// ============================================================
// The app previously had no landing dashboard at all — nav started
// directly at Auto Flow. This is additive only: every number here comes
// from existing endpoints (test-runs, outbound/contacts, outbound/overview,
// outbound/pipeline), nothing fabricated. If an endpoint returns nothing,
// the corresponding section shows an honest empty state instead of a
// placeholder number.
//
// Visual pass (2026-08-23): restyled to the "Demaze Intelligence" reference
// collage's composition — Card-based panels throughout (was ad hoc bordered
// divs), real week-over-week deltas on KPI tiles via computeWindowDelta(),
// and a new "Intelligence at a glance" row (research-activity bar chart,
// fit-distribution donut, outreach-sent trend) — every series here is
// bucketed from already-fetched real timestamps, nothing invented. A panel
// is simply omitted when its backing data doesn't clear
// hasSufficientTrendData()/has zero total, never padded with fake numbers.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Search, Users, Send, Clock, TrendingUp, ArrowRight, Sparkles, History as HistoryIcon, ArrowUpRight, Plus,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { MetricTile } from '@/components/ui/metric-tile'
import { Avatar } from '@/components/ui/avatar'
import { BarTrend } from '@/components/ui/bar-trend'
import { DonutChart, type DonutSlice } from '@/components/ui/donut-chart'
import { computeDailyCounts, computeWindowDelta, hasSufficientTrendData } from '@/lib/analytics/daily-counts'
import { getCompanyFit } from '@/lib/pipeline/analysis-sections'

// A saved company-discovery search (see app/admin/company-discovery/
// page.tsx's `Segment`) with real research progress — powers "Continue
// where you left off" below. Only the fields this page actually renders.
interface DiscoverySegment {
  id: string
  name: string
  totalCount: number
  researchedCount: number
}

interface RunRow {
  id: string
  domain: string
  company_url: string
  created_at: string
  final_result?: Record<string, unknown> | null
}

interface ContactRow {
  id: string
  created_at: string
}

interface OverviewEmailRow {
  id: string
  created_at: string
}

interface PipelineCompany {
  runId: string
  companyName: string
  domain: string | null
  nextFollowupDueAt: string | null
  repliedCount: number
  lastActivityAt: string
}

interface OverviewStats {
  totalContacted: number
  followupDueNow: number
}

const HIGH_FIT_LABELS = new Set(['Strong', 'Good'])
const FIT_DONUT_COLORS: Record<string, string> = {
  Strong: 'var(--signal-strong)',
  Good: 'var(--signal-medium)',
  Moderate: 'var(--signal-weak)',
  Unscored: 'var(--signal-none)',
}

function fitBadgeTone(label?: string) {
  if (label === 'Strong') return 'bg-signal-strong/10 text-signal-strong border border-signal-strong/30'
  if (label === 'Good') return 'bg-signal-medium/10 text-signal-medium border border-signal-medium/30'
  if (label === 'Moderate') return 'bg-signal-weak/10 text-signal-weak border border-signal-weak/30'
  return 'bg-accent text-muted-foreground'
}

function relativeTime(iso: string, nowMs: number): string {
  const ms = nowMs - new Date(iso).getTime()
  const hours = Math.floor(ms / (1000 * 60 * 60))
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function WorkspaceOverviewPage() {
  const [runs, setRuns] = useState<RunRow[] | null>(null)
  const [contacts, setContacts] = useState<ContactRow[] | null>(null)
  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [sentEmails, setSentEmails] = useState<OverviewEmailRow[] | null>(null)
  const [pipeline, setPipeline] = useState<PipelineCompany[] | null>(null)
  const [segments, setSegments] = useState<DiscoverySegment[] | null>(null)
  const [nowMs, setNowMs] = useState(0)

  useEffect(() => {
    setNowMs(Date.now())
    void (async () => {
      const [runsRes, contactsRes, overviewRes, pipelineRes, segmentsRes] = await Promise.allSettled([
        fetch('/api/admin/test-runs?limit=100').then(r => r.json()),
        fetch('/api/admin/outbound/contacts').then(r => r.json()),
        // limit=200 (the endpoint's max) so the returned `emails` rows carry
        // enough real per-day timestamps to bucket a trend/delta from —
        // still the same existing endpoint/param, no new backend code.
        fetch('/api/admin/outbound/overview?limit=200').then(r => r.json()),
        fetch('/api/admin/outbound/pipeline').then(r => r.json()),
        fetch('/api/admin/company-discovery/segments?limit=2').then(r => r.json()),
      ])
      if (runsRes.status === 'fulfilled' && runsRes.value.success) setRuns(runsRes.value.runs)
      else setRuns([])
      if (contactsRes.status === 'fulfilled' && contactsRes.value.success) setContacts(contactsRes.value.contacts)
      if (overviewRes.status === 'fulfilled' && overviewRes.value.success) {
        setStats(overviewRes.value.stats)
        setSentEmails(overviewRes.value.emails ?? [])
      }
      if (pipelineRes.status === 'fulfilled' && pipelineRes.value.success) setPipeline(pipelineRes.value.companies)
      else setPipeline([])
      if (segmentsRes.status === 'fulfilled' && segmentsRes.value.success) setSegments(segmentsRes.value.segments)
      else setSegments([])
    })()
  }, [])

  const loading = runs === null
  const highFitCount = (runs ?? []).filter(r => HIGH_FIT_LABELS.has(getCompanyFit(r.final_result ?? {})?.label ?? '')).length
  const researchedCount = runs === null ? 0 : runs.length
  const researchedSub = researchedCount === 100 ? '100+ recent' : undefined

  // Real trend/delta only — bucketed from each source's own real
  // timestamps. Both the sparkline AND the delta chip are gated on the same
  // hasSufficientTrendData() bar: a %-change computed by splitting a
  // near-empty history in half is technically real math but reads as a
  // misleading swing (e.g. 1 event -> 5 events = "+400%") — same "don't
  // show what isn't backed by enough real activity" rule as the chart.
  const researchedBuckets = useMemo(() => runs && computeDailyCounts(runs.map(r => r.created_at), 14), [runs])
  const researchedSufficient = researchedBuckets ? hasSufficientTrendData(researchedBuckets) : false
  const researchedTrend = researchedSufficient ? researchedBuckets! : undefined
  const researchedDelta = researchedSufficient ? computeWindowDelta(researchedBuckets!, 7).deltaPct : undefined

  const contactBuckets = useMemo(() => contacts && computeDailyCounts(contacts.map(c => c.created_at), 14), [contacts])
  const contactDelta = contactBuckets && hasSufficientTrendData(contactBuckets) ? computeWindowDelta(contactBuckets, 7).deltaPct : undefined

  const sentBuckets = useMemo(() => sentEmails && computeDailyCounts(sentEmails.map(e => e.created_at), 14), [sentEmails])
  const sentSufficient = sentBuckets ? hasSufficientTrendData(sentBuckets) : false
  const sentTrend = sentSufficient ? sentBuckets! : undefined
  const sentDelta = sentSufficient ? computeWindowDelta(sentBuckets!, 7).deltaPct : undefined

  const fitDonutSlices: DonutSlice[] = useMemo(() => {
    const counts: Record<string, number> = { Strong: 0, Good: 0, Moderate: 0, Unscored: 0 }
    for (const r of runs ?? []) {
      const label = getCompanyFit(r.final_result ?? {})?.label
      if (label && label in counts) counts[label] += 1
      else counts.Unscored += 1
    }
    return Object.entries(counts).map(([label, value]) => ({ label, value, colorVar: FIT_DONUT_COLORS[label] }))
  }, [runs])

  const dueNow = (pipeline ?? []).filter(c => c.nextFollowupDueAt && new Date(c.nextFollowupDueAt).getTime() <= nowMs)
  const recentRuns = (runs ?? []).slice(0, 6)

  const nothingYet = runs !== null && runs.length === 0
  const hasGlanceData = Boolean(researchedTrend || fitDonutSlices.some(s => s.value > 0) || sentTrend)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Intelligence Workspace</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{greeting()}</h1>
      </div>

      {nothingYet ? (
        <EmptyState
          icon={Sparkles}
          title="No companies researched yet"
          description="Start by discovering companies that match your target market, or research one directly."
          action={
            <div className="flex items-center justify-center gap-2">
              <Button size="sm" render={<Link href="/admin/company-discovery" />}>Discover Companies</Button>
              <Button size="sm" variant="outline" render={<Link href="/admin/wizard" />}>Research a Company</Button>
            </div>
          }
        />
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex h-[70px] items-center rounded-lg border border-border bg-card px-4"><Spinner className="size-4" /></div>
              ))
            ) : (
              <>
                <MetricTile icon={Search} label="Companies Researched" value={researchedCount} sub={researchedSub} trend={researchedTrend} delta={researchedDelta} />
                <MetricTile icon={TrendingUp} label="High-Fit Companies" value={highFitCount} />
                <MetricTile icon={Users} label="People Identified" value={contacts?.length ?? '—'} delta={contactDelta} />
                <MetricTile icon={Send} label="Outreach Sent" value={stats?.totalContacted ?? '—'} trend={sentTrend} delta={sentDelta} />
                <MetricTile icon={Clock} label="Follow-ups Due" value={stats?.followupDueNow ?? '—'} />
              </>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
            {/* Needs your attention */}
            <Card>
              <CardHeader className="border-b border-border">
                <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Needs Your Attention</CardTitle>
              </CardHeader>
              <CardContent className="p-2">
                {pipeline === null ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"><Spinner className="size-4" /> Loading…</div>
                ) : dueNow.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-muted-foreground">Nothing needs attention right now.</p>
                ) : (
                  dueNow.slice(0, 6).map(c => (
                    <div key={c.runId} className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/50">
                      <Avatar name={c.companyName} size="xs" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">{c.companyName}</div>
                        <div className="text-xs text-muted-foreground/70">Follow-up due · {relativeTime(c.nextFollowupDueAt!, nowMs)}</div>
                      </div>
                      <Button size="sm" variant="outline" render={<Link href="/admin/outbound/followups" />}>Review</Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Recent activity */}
            <Card>
              <CardHeader className="flex items-center justify-between border-b border-border">
                <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Recent Activity</CardTitle>
                <Link href="/admin/run-history" className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
                  View all <ArrowRight className="size-3" />
                </Link>
              </CardHeader>
              <CardContent className="p-2">
                {loading ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"><Spinner className="size-4" /> Loading…</div>
                ) : recentRuns.length === 0 ? (
                  <EmptyState icon={HistoryIcon} title="No research yet" className="border-none py-6" />
                ) : (
                  recentRuns.map(run => {
                    const fit = getCompanyFit(run.final_result ?? {})
                    const name = (run.final_result?.company_name as string | undefined) ?? run.domain ?? run.company_url
                    return (
                      <Link
                        key={run.id}
                        href="/admin/run-history"
                        className="group/row flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/50"
                      >
                        <Avatar name={name} size="xs" />
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="truncate text-sm text-foreground">{name}</span>
                          {fit?.label && <Badge className={`text-[10px] ${fitBadgeTone(fit.label)}`}>{fit.label}</Badge>}
                        </div>
                        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground/60">
                          {relativeTime(run.created_at, nowMs)}
                          <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover/row:opacity-100" />
                        </span>
                      </Link>
                    )
                  })
                )}
              </CardContent>
            </Card>
          </div>

          {/* Continue where you left off — real saved-search progress, powered by
              company_discovery_segments (see app/admin/company-discovery/page.tsx's
              Segment type and /api/admin/company-discovery/segments). Omitted
              entirely while segments are still loading (null) so it never
              flashes an empty state before the real data arrives. */}
          {segments !== null && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Continue Where You Left Off</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {segments.map(seg => {
                  const pct = seg.totalCount > 0 ? Math.round((seg.researchedCount / seg.totalCount) * 100) : 0
                  return (
                    <Card key={seg.id} size="sm">
                      <CardContent className="space-y-3">
                        <div>
                          <p className="text-sm font-medium text-foreground truncate">{seg.name}</p>
                          <p className="text-xs text-muted-foreground/70 mt-0.5">{seg.totalCount} compan{seg.totalCount === 1 ? 'y' : 'ies'}</p>
                        </div>
                        <div className="space-y-1">
                          <div className="h-1.5 w-full rounded-full bg-accent overflow-hidden">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                          <p className="text-[11px] text-muted-foreground/60">{seg.researchedCount} of {seg.totalCount} researched</p>
                        </div>
                        <Button size="sm" className="w-full" render={<Link href={`/admin/company-discovery?resumeSegmentId=${seg.id}`} />}>Continue</Button>
                      </CardContent>
                    </Card>
                  )
                })}
                <Card size="sm">
                  <CardContent className="flex h-full flex-col items-center justify-center gap-2 text-center py-6">
                    <div className="flex size-8 items-center justify-center rounded-full bg-accent text-muted-foreground">
                      <Plus className="size-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">Start a new search</p>
                      <p className="text-xs text-muted-foreground/70 mt-0.5">Find new companies to target</p>
                    </div>
                    <Button size="sm" variant="outline" className="w-full" render={<Link href="/admin/company-discovery" />}>New Search</Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* Intelligence at a glance — omitted entirely if nothing here clears the real-data bar */}
          {hasGlanceData && (
            <Card>
              <CardHeader className="border-b border-border">
                <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Intelligence at a Glance</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-6 pt-4 md:grid-cols-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Research activity</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground/60">Last 14 days</p>
                  {researchedTrend ? (
                    <BarTrend data={researchedTrend} label="Research activity trend" className="mt-3" />
                  ) : (
                    <p className="mt-4 text-xs text-muted-foreground/60">Not enough recent activity to chart yet.</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Opportunity distribution</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground/60">By fit</p>
                  {fitDonutSlices.some(s => s.value > 0) ? (
                    <div className="mt-3"><DonutChart slices={fitDonutSlices} /></div>
                  ) : (
                    <p className="mt-4 text-xs text-muted-foreground/60">No scored companies yet.</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Outreach performance</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground/60">Emails sent · last 14 days</p>
                  {sentTrend ? (
                    <BarTrend data={sentTrend} label="Outreach sent trend" className="mt-3" />
                  ) : (
                    <p className="mt-4 text-xs text-muted-foreground/60">Not enough send history to chart yet.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
