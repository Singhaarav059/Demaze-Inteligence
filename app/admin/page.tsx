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
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Search, Users, Send, Clock, TrendingUp, ArrowRight, Sparkles, History as HistoryIcon, ArrowUpRight,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { MetricTile } from '@/components/ui/metric-tile'
import { computeDailyCounts, hasSufficientTrendData } from '@/lib/analytics/daily-counts'
import { getCompanyFit } from '@/lib/pipeline/analysis-sections'

interface RunRow {
  id: string
  domain: string
  company_url: string
  created_at: string
  final_result?: Record<string, unknown> | null
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
  const [contactCount, setContactCount] = useState<number | null>(null)
  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [pipeline, setPipeline] = useState<PipelineCompany[] | null>(null)
  const [nowMs, setNowMs] = useState(0)

  useEffect(() => {
    setNowMs(Date.now())
    void (async () => {
      const [runsRes, contactsRes, overviewRes, pipelineRes] = await Promise.allSettled([
        fetch('/api/admin/test-runs?limit=100').then(r => r.json()),
        fetch('/api/admin/outbound/contacts').then(r => r.json()),
        fetch('/api/admin/outbound/overview').then(r => r.json()),
        fetch('/api/admin/outbound/pipeline').then(r => r.json()),
      ])
      if (runsRes.status === 'fulfilled' && runsRes.value.success) setRuns(runsRes.value.runs)
      else setRuns([])
      if (contactsRes.status === 'fulfilled' && contactsRes.value.success) setContactCount(contactsRes.value.contacts.length)
      if (overviewRes.status === 'fulfilled' && overviewRes.value.success) setStats(overviewRes.value.stats)
      if (pipelineRes.status === 'fulfilled' && pipelineRes.value.success) setPipeline(pipelineRes.value.companies)
      else setPipeline([])
    })()
  }, [])

  const loading = runs === null
  const highFitCount = (runs ?? []).filter(r => HIGH_FIT_LABELS.has(getCompanyFit(r.final_result ?? {})?.label ?? '')).length
  const researchedCount = runs === null ? 0 : runs.length
  const researchedSub = researchedCount === 100 ? '100+ recent' : undefined

  // Real trend only — bucketed from each run's own created_at, gated on
  // hasSufficientTrendData() so a near-empty history never renders a
  // misleadingly-flat/sparse line.
  const researchedTrend = useMemo(() => {
    if (!runs) return undefined
    const buckets = computeDailyCounts(runs.map(r => r.created_at), 14)
    return hasSufficientTrendData(buckets) ? buckets : undefined
  }, [runs])

  const dueNow = (pipeline ?? []).filter(c => c.nextFollowupDueAt && new Date(c.nextFollowupDueAt).getTime() <= nowMs)
  const recentRuns = (runs ?? []).slice(0, 6)

  const nothingYet = runs !== null && runs.length === 0

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
                <MetricTile icon={Search} label="Companies Researched" value={researchedCount} sub={researchedSub} trend={researchedTrend} />
                <MetricTile icon={TrendingUp} label="High-Fit Companies" value={highFitCount} />
                <MetricTile icon={Users} label="People Identified" value={contactCount ?? '—'} />
                <MetricTile icon={Send} label="Outreach Sent" value={stats?.totalContacted ?? '—'} />
                <MetricTile icon={Clock} label="Follow-ups Due" value={stats?.followupDueNow ?? '—'} />
              </>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
            {/* Needs your attention */}
            <div className="rounded-lg border border-border bg-card">
              <div className="border-b border-border px-4 py-2.5">
                <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Needs Your Attention</h2>
              </div>
              <div className="p-2">
                {pipeline === null ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"><Spinner className="size-4" /> Loading…</div>
                ) : dueNow.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-muted-foreground">Nothing needs attention right now.</p>
                ) : (
                  dueNow.slice(0, 6).map(c => (
                    <div key={c.runId} className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-accent/50 transition-colors">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{c.companyName}</div>
                        <div className="text-xs text-muted-foreground/70">Follow-up due · {relativeTime(c.nextFollowupDueAt!, nowMs)}</div>
                      </div>
                      <Button size="sm" variant="outline" render={<Link href="/admin/outbound/followups" />}>Review</Button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Recent activity */}
            <div className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Recent Activity</h2>
                <Link href="/admin/run-history" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  View all <ArrowRight className="size-3" />
                </Link>
              </div>
              <div className="p-2">
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
                        className="group/row flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-accent/50 transition-colors"
                      >
                        <div className="min-w-0 flex items-center gap-2">
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
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
