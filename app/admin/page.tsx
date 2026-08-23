'use client'

// ============================================================
// Workspace Overview - /admin (home)
// ============================================================
// The app previously had no landing dashboard at all - nav started
// directly at Auto Flow. This is additive only: every number here comes
// from existing endpoints (test-runs, outbound/contacts, outbound/overview,
// outbound/pipeline), nothing fabricated. If an endpoint returns nothing,
// the corresponding section shows an honest empty state instead of a
// placeholder number.
//
// Visual pass (2026-08-23): restyled to the "Demaze Intelligence" reference
// collage's composition - Card-based panels throughout (was ad hoc bordered
// divs), real week-over-week deltas on KPI tiles via computeWindowDelta(),
// and a new "Intelligence at a glance" row (research-activity bar chart,
// fit-distribution donut, outreach-sent trend) - every series here is
// bucketed from already-fetched real timestamps, nothing invented. A panel
// is simply omitted when its backing data doesn't clear
// hasSufficientTrendData()/has zero total, never padded with fake numbers.
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  Search, Users, Send, Clock, TrendingUp, ArrowRight, Sparkles, History as HistoryIcon, ArrowUpRight, Plus,
  UserSearch, Radar, Lightbulb, Mail, CheckCircle2,
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
import { CircularProgress } from '@/components/ui/circular-progress'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { staggerList, listItem } from '@/lib/motion'
import { computeDailyCounts, computeWindowDelta, hasSufficientTrendData } from '@/lib/analytics/daily-counts'
import { getCompanyFit } from '@/lib/pipeline/analysis-sections'
import { cn } from '@/lib/utils'

// A saved company-discovery search (see app/admin/company-discovery/
// page.tsx's `Segment`) with real research progress - powers "Continue
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

// Widened to also carry decision-maker-discovery display fields, same shape
// run-history's own "Discovery" tab already reads from this endpoint -
// reused for Recent Activity's merged feed below (real data, not a 2nd fetch).
interface ContactRow {
  id: string
  created_at: string
  company_name?: string
  person_name?: string
  title_hint?: string | null
  discovery_source?: string
}

// Widened the same way, matching run-history's "Outreach" tab shape.
interface OverviewEmailRow {
  id: string
  created_at: string
  status?: string
  updated_at?: string
  outbound_contacts?: { person_name: string; company_name: string } | null
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

type AttentionKind = 'due' | 'upcoming' | 'new_research'
interface AttentionItem { kind: AttentionKind; key: string; companyName: string; ts: string; href: string; cta: string }

function attentionBadge(kind: AttentionKind) {
  if (kind === 'due') return { label: 'Follow-up due', tone: 'bg-destructive/10 text-destructive border border-destructive/30' }
  if (kind === 'upcoming') return { label: 'Upcoming', tone: 'bg-accent text-muted-foreground border border-border' }
  return { label: 'Research complete', tone: 'bg-signal-strong/10 text-signal-strong border border-signal-strong/30' }
}

interface ActivityItem {
  key: string
  ts: string
  kind: 'research' | 'discovery' | 'outreach'
  title: string
  subtitle: string
  href: string
  fitLabel?: string
}

const ACTIVITY_ICON: Record<ActivityItem['kind'], { Icon: typeof Search; tone: string }> = {
  research: { Icon: Search, tone: 'bg-primary/15 text-primary' },
  discovery: { Icon: UserSearch, tone: 'bg-signal-medium/15 text-signal-medium' },
  outreach: { Icon: Send, tone: 'bg-signal-strong/15 text-signal-strong' },
}

// Real Auto Flow steps (see StepIndicator.tsx's own STEPS list) - purely
// descriptive orientation content, no numbers/metrics claimed, so it's safe
// to always show regardless of how much real data exists yet.
const PIPELINE_STAGES: { title: string; description: string; href: string; Icon: typeof Search }[] = [
  { title: 'Research', description: 'Deep company intelligence: real signals, pain points, and opportunities, not a generic profile.', href: '/admin/wizard', Icon: Radar },
  { title: 'Decision Makers', description: 'Automatically finds the people most likely to care about this, no manual search.', href: '/admin/auto-gtm', Icon: UserSearch },
  { title: 'Contact Info', description: 'Email, phone, and LinkedIn looked up automatically for each person found.', href: '/admin/outbound/contacts', Icon: Mail },
  { title: 'Personalized Outreach', description: 'AI-drafted messages grounded in real evidence, not a filled-in template.', href: '/admin/auto-gtm', Icon: Lightbulb },
  { title: 'Review & Send', description: 'One explicit confirmation before anything goes out, every time.', href: '/admin/outbound/campaigns', Icon: CheckCircle2 },
  { title: 'Track & Follow Up', description: 'Opens, replies, and automatic follow-ups, tracked per contact.', href: '/admin/outbound/followups', Icon: Clock },
]

// Handles both directions (a past activity timestamp, or a future
// follow-up due date) with one function instead of two near-duplicates.
function relativeTime(iso: string, nowMs: number): string {
  const ms = nowMs - new Date(iso).getTime()
  const future = ms < 0
  const hours = Math.floor(Math.abs(ms) / (1000 * 60 * 60))
  if (hours < 1) return future ? 'due soon' : 'just now'
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  return future ? `in ${days}d` : `${days}d ago`
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
        // enough real per-day timestamps to bucket a trend/delta from -
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

  // Real trend/delta only - bucketed from each source's own real
  // timestamps. Both the sparkline AND the delta chip are gated on the same
  // hasSufficientTrendData() bar: a %-change computed by splitting a
  // near-empty history in half is technically real math but reads as a
  // misleading swing (e.g. 1 event -> 5 events = "+400%") - same "don't
  // show what isn't backed by enough real activity" rule as the chart.
  const researchedBuckets = useMemo(() => runs && computeDailyCounts(runs.map(r => r.created_at), 14), [runs])
  const researchedSufficient = researchedBuckets ? hasSufficientTrendData(researchedBuckets) : false
  const researchedTrend = researchedSufficient ? researchedBuckets! : undefined
  const researchedDelta = researchedSufficient ? computeWindowDelta(researchedBuckets!, 7).deltaPct : undefined

  const contactBuckets = useMemo(() => contacts && computeDailyCounts(contacts.map(c => c.created_at), 14), [contacts])
  const contactSufficient = contactBuckets ? hasSufficientTrendData(contactBuckets) : false
  const contactTrend = contactSufficient ? contactBuckets! : undefined
  const contactDelta = contactSufficient ? computeWindowDelta(contactBuckets!, 7).deltaPct : undefined

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
    return Object.entries(counts).map(([label, value]) => ({
      label,
      value,
      colorVar: FIT_DONUT_COLORS[label],
      // Jumps straight to the matching companies in History instead of just
      // showing the split.
      href: `/admin/run-history?fit=${encodeURIComponent(label)}`,
    }))
  }, [runs])

  const dueNow = (pipeline ?? []).filter(c => c.nextFollowupDueAt && new Date(c.nextFollowupDueAt).getTime() <= nowMs)
  const upcoming = (pipeline ?? [])
    .filter(c => c.nextFollowupDueAt && new Date(c.nextFollowupDueAt).getTime() > nowMs)
    .sort((a, b) => new Date(a.nextFollowupDueAt!).getTime() - new Date(b.nextFollowupDueAt!).getTime())
  // Recently completed research with no follow-up signal yet - real, useful
  // "something just happened" context (not just follow-up reminders), so
  // this card never reads as near-empty when there's little overdue.
  const newlyResearched = (runs ?? []).filter(r => nowMs - new Date(r.created_at).getTime() < 48 * 60 * 60 * 1000)
  const attentionItems: AttentionItem[] = [
    ...dueNow.map(c => ({ kind: 'due' as const, key: `due-${c.runId}`, companyName: c.companyName, ts: c.nextFollowupDueAt!, href: '/admin/outbound/followups', cta: 'Review' })),
    ...upcoming.map(c => ({ kind: 'upcoming' as const, key: `upcoming-${c.runId}`, companyName: c.companyName, ts: c.nextFollowupDueAt!, href: '/admin/outbound/followups', cta: 'Review' })),
    ...newlyResearched.map(r => ({
      kind: 'new_research' as const,
      key: `research-${r.id}`,
      companyName: (r.final_result?.company_name as string | undefined) ?? r.domain ?? r.company_url,
      ts: r.created_at,
      href: '/admin/run-history',
      cta: 'View',
    })),
  ].slice(0, 6)

  // Recent Activity - merges the same 3 real event sources run-history's own
  // "All" tab already merges (research/decision-maker-found/email-sent),
  // reusing data this page already fetches rather than a 4th API call.
  const activityItems: ActivityItem[] = [
    ...(runs ?? []).map(r => ({
      key: `research-${r.id}`,
      ts: r.created_at,
      kind: 'research' as const,
      title: (r.final_result?.company_name as string | undefined) ?? r.domain ?? r.company_url,
      subtitle: 'Research completed',
      href: '/admin/run-history',
      fitLabel: getCompanyFit(r.final_result ?? {})?.label,
    })),
    ...(contacts ?? [])
      .filter(c => c.discovery_source === 'decision_maker_discovery')
      .map(c => ({
        key: `discovery-${c.id}`,
        ts: c.created_at,
        kind: 'discovery' as const,
        title: c.person_name ?? 'Unknown contact',
        subtitle: `New contact · ${c.company_name ?? 'Unknown company'}`,
        href: '/admin/outbound/contacts',
      })),
    ...(sentEmails ?? []).map(e => ({
      key: `outreach-${e.id}`,
      ts: e.updated_at ?? e.created_at,
      kind: 'outreach' as const,
      title: e.outbound_contacts?.person_name ?? 'Unknown contact',
      subtitle: `Email ${e.status ?? 'sent'} · ${e.outbound_contacts?.company_name ?? 'Unknown company'}`,
      href: '/admin/outbound/overview',
    })),
  ]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 6)

  const nothingYet = runs !== null && runs.length === 0
  const hasGlanceData = Boolean(researchedTrend || fitDonutSlices.some(s => s.value > 0) || sentTrend)

  // Shared between the desktop 3-up grid and the mobile tab switcher below -
  // one content definition per chart, two layouts.
  function renderResearchActivity() {
    return (
      <div>
        <p className="text-xs font-medium text-muted-foreground">Research activity</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground/60">Last 14 days</p>
        {researchedTrend ? (
          <BarTrend data={researchedTrend} label="Research activity trend" className="mt-3" />
        ) : (
          <p className="mt-4 text-xs text-muted-foreground/60">Not enough recent activity to chart yet.</p>
        )}
      </div>
    )
  }

  function renderOpportunityDistribution() {
    return (
      <div>
        <p className="text-xs font-medium text-muted-foreground">Opportunity distribution</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground/60">By fit</p>
        {fitDonutSlices.some(s => s.value > 0) ? (
          <div className="mt-3"><DonutChart slices={fitDonutSlices} /></div>
        ) : (
          <p className="mt-4 text-xs text-muted-foreground/60">No scored companies yet.</p>
        )}
      </div>
    )
  }

  function renderOutreachPerformance() {
    return (
      <div>
        <p className="text-xs font-medium text-muted-foreground">Outreach performance</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground/60">Emails sent · last 14 days</p>
        {sentTrend ? (
          <BarTrend data={sentTrend} label="Outreach sent trend" className="mt-3" />
        ) : (
          <p className="mt-4 text-xs text-muted-foreground/60">Not enough send history to chart yet.</p>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Intelligence Workspace</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground">{greeting()}</h1>
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
          {loading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex h-[70px] items-center rounded-lg border border-border bg-card px-4"><Spinner className="size-4" /></div>
              ))}
            </div>
          ) : (
            <motion.div
              variants={staggerList}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
            >
              <motion.div variants={listItem}>
                <Link href="/admin/run-history" className="block">
                  <MetricTile icon={Search} label="Companies Researched" value={researchedCount} sub={researchedSub} trend={researchedTrend} delta={researchedDelta} className="transition-colors hover:border-border-strong hover:bg-accent/40" />
                </Link>
              </motion.div>
              <motion.div variants={listItem}>
                <Link href="/admin/run-history?fit=Strong,Good" className="block">
                  <MetricTile icon={TrendingUp} label="High-Fit Companies" value={highFitCount} className="transition-colors hover:border-border-strong hover:bg-accent/40" />
                </Link>
              </motion.div>
              <motion.div variants={listItem}>
                <Link href="/admin/outbound/contacts" className="block">
                  <MetricTile icon={Users} label="People Identified" value={contacts?.length ?? '-'} trend={contactTrend} delta={contactDelta} className="transition-colors hover:border-border-strong hover:bg-accent/40" />
                </Link>
              </motion.div>
              <motion.div variants={listItem}>
                <Link href="/admin/outbound/overview" className="block">
                  <MetricTile icon={Send} label="Outreach Sent" value={stats?.totalContacted ?? '-'} trend={sentTrend} delta={sentDelta} className="transition-colors hover:border-border-strong hover:bg-accent/40" />
                </Link>
              </motion.div>
              <motion.div variants={listItem}>
                <Link href="/admin/outbound/followups" className="block">
                  <MetricTile icon={Clock} label="Follow-ups Due" value={stats?.followupDueNow ?? '-'} className="transition-colors hover:border-border-strong hover:bg-accent/40" />
                </Link>
              </motion.div>
            </motion.div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
            {/* Needs your attention */}
            <Card>
              <CardHeader className="border-b border-border">
                <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Needs Your Attention</CardTitle>
              </CardHeader>
              <CardContent className="p-2">
                {pipeline === null ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"><Spinner className="size-4" /> Loading…</div>
                ) : attentionItems.length === 0 ? (
                  <EmptyState icon={Clock} title="Nothing needs attention right now" className="border-none py-6" />
                ) : (
                  <motion.div variants={staggerList} initial="hidden" animate="visible">
                    {attentionItems.map(item => {
                      const badge = attentionBadge(item.kind)
                      return (
                        <motion.div key={item.key} variants={listItem} className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/50">
                          <Avatar name={item.companyName} size="xs" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-foreground">{item.companyName}</span>
                              <Badge className={`shrink-0 text-[9px] px-1.5 py-0 ${badge.tone}`}>{badge.label}</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground/70">{relativeTime(item.ts, nowMs)}</div>
                          </div>
                          <Button size="sm" variant="outline" render={<Link href={item.href} />}>{item.cta}</Button>
                        </motion.div>
                      )
                    })}
                  </motion.div>
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
                ) : activityItems.length === 0 ? (
                  <EmptyState icon={HistoryIcon} title="No research yet" className="border-none py-6" />
                ) : (
                  <motion.div variants={staggerList} initial="hidden" animate="visible">
                    {activityItems.map(item => {
                      const { Icon, tone } = ACTIVITY_ICON[item.kind]
                      return (
                        <motion.div key={item.key} variants={listItem}>
                          <Link
                            href={item.href}
                            className="group/row flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/50"
                          >
                            {item.kind === 'research' ? (
                              <Avatar name={item.title} size="xs" ringColorVar={item.fitLabel ? FIT_DONUT_COLORS[item.fitLabel] : undefined} />
                            ) : (
                              <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full', tone)}>
                                <Icon className="size-3" />
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-sm text-foreground">{item.title}</span>
                                {item.kind === 'research' && item.fitLabel && (
                                  <Badge className={`text-[10px] ${fitBadgeTone(item.fitLabel)}`}>{item.fitLabel}</Badge>
                                )}
                              </div>
                              <p className="truncate text-xs text-muted-foreground/60">{item.subtitle}</p>
                            </div>
                            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground/60">
                              {relativeTime(item.ts, nowMs)}
                              <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover/row:opacity-100" />
                            </span>
                          </Link>
                        </motion.div>
                      )
                    })}
                  </motion.div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Continue where you left off - real saved-search progress, powered by
              company_discovery_segments (see app/admin/company-discovery/page.tsx's
              Segment type and /api/admin/company-discovery/segments). Omitted
              entirely while segments are still loading (null) so it never
              flashes an empty state before the real data arrives. */}
          {segments !== null && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Continue Where You Left Off</h2>
              {/* auto-fit (not auto-fill/a fixed column count) so a short
                  list - e.g. 1 real segment + the "start new" card - stretches
                  to fill the row instead of leaving a dead empty column. */}
              <motion.div variants={staggerList} initial="hidden" animate="visible" className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
                {segments.map(seg => {
                  const pct = seg.totalCount > 0 ? Math.round((seg.researchedCount / seg.totalCount) * 100) : 0
                  return (
                    <motion.div key={seg.id} variants={listItem}>
                      <Card size="sm">
                        <CardContent className="space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{seg.name}</p>
                              <p className="text-xs text-muted-foreground/70 mt-0.5">{seg.totalCount} compan{seg.totalCount === 1 ? 'y' : 'ies'}</p>
                            </div>
                            <CircularProgress value={pct} size={36} thickness={3.5} />
                          </div>
                          <p className="text-[11px] text-muted-foreground/60">{seg.researchedCount} of {seg.totalCount} researched</p>
                          <Button size="sm" className="w-full" render={<Link href={`/admin/company-discovery?resumeSegmentId=${seg.id}`} />}>Continue</Button>
                        </CardContent>
                      </Card>
                    </motion.div>
                  )
                })}
                <motion.div variants={listItem}>
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
                </motion.div>
              </motion.div>
            </div>
          )}

          {/* Intelligence at a glance - omitted entirely if nothing here clears the real-data bar.
              Desktop keeps the 3-up grid; mobile swaps to a tab switcher (same 3 pieces, one
              content function each) instead of 3 stacked charts down the page. */}
          {hasGlanceData && (
            <Card>
              <CardHeader className="border-b border-border">
                <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Intelligence at a Glance</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="hidden gap-6 md:grid md:grid-cols-3">
                  {renderResearchActivity()}
                  {renderOpportunityDistribution()}
                  {renderOutreachPerformance()}
                </div>
                <Tabs defaultValue="research" className="md:hidden">
                  <TabsList>
                    <TabsTrigger value="research">Research</TabsTrigger>
                    <TabsTrigger value="fit">Fit</TabsTrigger>
                    <TabsTrigger value="outreach">Outreach</TabsTrigger>
                  </TabsList>
                  <TabsContent value="research" className="pt-4">{renderResearchActivity()}</TabsContent>
                  <TabsContent value="fit" className="pt-4">{renderOpportunityDistribution()}</TabsContent>
                  <TabsContent value="outreach" className="pt-4">{renderOutreachPerformance()}</TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          )}

          {/* How Auto Flow works - static, descriptive (no numbers claimed),
              same real 6 steps StepIndicator.tsx already defines for Auto
              Flow itself. Not gated on any data threshold - it's product
              orientation, not a data panel, so it's fine to always show. */}
          <Card>
            <CardHeader className="border-b border-border">
              <CardTitle className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">How Auto Flow Works</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <motion.div variants={staggerList} initial="hidden" animate="visible" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {PIPELINE_STAGES.map(stage => (
                  <motion.div key={stage.title} variants={listItem}>
                    <Link
                      href={stage.href}
                      className="flex h-full flex-col gap-2 rounded-lg border border-border bg-card p-3 transition-colors hover:border-border-strong hover:bg-accent/40"
                    >
                      <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <stage.Icon className="size-3.5" />
                      </span>
                      <span className="text-sm font-medium text-foreground">{stage.title}</span>
                      <span className="text-xs leading-relaxed text-muted-foreground/70">{stage.description}</span>
                    </Link>
                  </motion.div>
                ))}
              </motion.div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
