'use client'

// ============================================================
// Outbound Overview - /admin/outbound/overview
// ============================================================
// Session 1 of the "Outreach Control Center" build: cross-campaign
// aggregate stats (total sent/queued/replied/bounced/follow-ups pending)
// plus one searchable, filterable table of every email ever queued/sent
// across every campaign - the thing the per-campaign Campaigns page
// deliberately doesn't show. Read-only; sending/pausing/replying/follow-up
// actions still live on the Campaigns page (linked from each row here).
// Later sessions add: real reply content, per-contact follow-up control,
// multi-mailbox sending, suppression list, send-rate limits.
// ============================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Search, Mail, Inbox, Reply, Ban, Clock, Send, Eye, UserX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { GuideNote } from '@/components/ui/guide-note'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { MetricTile } from '@/components/ui/metric-tile'
import { computeDailyCounts, hasSufficientTrendData } from '@/lib/analytics/daily-counts'
import { useOutboundOverview } from './useOutboundOverview'
import { PilotFunnelPanel } from './PilotFunnelPanel'
import { StatusDot, type StatusTone } from '../StatusDot'

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'queued', label: 'Queued' },
  { value: 'sent', label: 'Sent' },
  { value: 'followup_1', label: 'Follow-up 1' },
  { value: 'followup_2', label: 'Follow-up 2' },
  { value: 'followup_3', label: 'Follow-up 3' },
  { value: 'replied', label: 'Replied' },
  { value: 'bounced', label: 'Bounced' },
  { value: 'stopped', label: 'Stopped' },
]

function statusTone(status: string): StatusTone {
  if (status === 'replied') return 'strong'
  if (status === 'bounced') return 'destructive'
  if (status === 'queued') return 'muted'
  if (status.startsWith('followup')) return 'medium'
  if (status === 'stopped') return 'muted'
  return 'strong'
}

function statusLabel(status: string) {
  const found = STATUS_OPTIONS.find(o => o.value === status)
  return found ? found.label : status
}

function formatDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

interface CampaignOption {
  id: string
  name: string
}

export default function OutboundOverviewPage() {
  const {
    stats,
    emails,
    total,
    offset,
    pageSize,
    loading,
    filters,
    setStatus,
    setCampaignId,
    setSearch,
    nextPage,
    prevPage,
    refresh,
  } = useOutboundOverview()

  const [searchDraft, setSearchDraft] = useState('')
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([])
  const [sentTimestamps, setSentTimestamps] = useState<string[] | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/admin/outbound/campaigns')
        const data = await res.json()
        if (data.success) setCampaigns(data.campaigns.map((c: CampaignOption) => ({ id: c.id, name: c.name })))
      } catch {
        // non-fatal - the campaign filter just stays empty
      }
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/admin/outbound/overview/activity')
        const data = await res.json()
        if (data.success) setSentTimestamps(data.sentTimestamps)
      } catch {
        // non-fatal - the sparkline just stays hidden, same as insufficient data
      }
    })()
  }, [])

  // Real data only (redesign brief Section 24) - the sparkline renders
  // exclusively when there's enough genuine send activity to read as a
  // trend, never a near-empty placeholder chart.
  const dailySends = sentTimestamps ? computeDailyCounts(sentTimestamps, 14) : null
  const showSendsTrend = dailySends !== null && hasSufficientTrendData(dailySends)

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchDraft.trim()), 300)
    return () => clearTimeout(handle)
  }, [searchDraft, setSearch])

  const replyRatePct = stats ? Math.round(stats.replyRate * 1000) / 10 : 0

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Overview</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Every email queued or sent, across every campaign, in one place.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
          {loading ? <Spinner className="size-3.5" /> : null}
          Refresh
        </Button>
      </div>

      <GuideNote>
        <p>
          Read-only - the aggregate stats and full email table across every campaign, which the
          per-campaign Campaigns page deliberately doesn&apos;t show. Click a row&apos;s campaign name to
          jump there for sending, pausing, or follow-up actions.
        </p>
      </GuideNote>

      {!stats ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Spinner className="size-4" /> Loading stats…
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <MetricTile
            icon={Send}
            label="Total Contacted"
            value={stats.totalContacted}
            sub={`${stats.sentLast24h} in last 24h`}
            trend={showSendsTrend && dailySends ? dailySends : undefined}
          />
          <MetricTile icon={Inbox} label="Queued" value={stats.queued} />
          <MetricTile icon={Reply} label="Replied" value={stats.replied} sub={`${replyRatePct}% reply rate`} />
          <MetricTile icon={Ban} label="Bounced" value={stats.bounced} />
          <MetricTile icon={Clock} label="Follow-ups Pending" value={stats.followupPending} sub={`${stats.followupDueNow} due now`} />
          <MetricTile icon={Mail} label="All Contacted Statuses" value={Object.keys(stats.byStatus).length} sub="distinct statuses in use" />
          {/* Secondary signals - not the primary business metric (Pilot Readiness Plan D4) */}
          <MetricTile icon={Eye} label="Opened" value={stats.opened} />
          <MetricTile icon={UserX} label="Unsubscribed" value={stats.unsubscribed} />
        </div>
      )}

      <PilotFunnelPanel />

      <div className="rounded-lg border border-border bg-card px-5 py-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1 sm:col-span-1">
              <Label htmlFor="overview-search">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
                <Input
                  id="overview-search"
                  className="pl-8"
                  placeholder="Name, company, or email…"
                  value={searchDraft}
                  onChange={e => setSearchDraft(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="overview-status">Status</Label>
              <Select items={STATUS_OPTIONS} value={filters.status ?? ''} onValueChange={value => setStatus((value as string) || null)}>
                <SelectTrigger id="overview-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="overview-campaign">Campaign</Label>
              <Select
                items={[{ value: '', label: 'All campaigns' }, ...campaigns.map(c => ({ value: c.id, label: c.name }))]}
                value={filters.campaignId ?? ''}
                onValueChange={value => setCampaignId((value as string) || null)}
              >
                <SelectTrigger id="overview-campaign">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All campaigns</SelectItem>
                  {campaigns.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
      </div>

      <div className="rounded-lg border border-border bg-card px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Emails</h2>
            <span className="text-xs text-muted-foreground/60">
              {total > 0 ? `${offset + 1}–${Math.min(offset + pageSize, total)} of ${total}` : '0 results'}
            </span>
          </div>

          {loading && emails.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Spinner className="size-4" /> Loading…
            </div>
          ) : emails.length === 0 ? (
            <EmptyState icon={Inbox} title="No emails match these filters" className="border-none py-6" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground/60 border-b border-border">
                    <th className="py-1.5 pr-3 font-medium">Contact</th>
                    <th className="py-1.5 pr-3 font-medium">Campaign</th>
                    <th className="py-1.5 pr-3 font-medium">Subject</th>
                    <th className="py-1.5 pr-3 font-medium">Status</th>
                    <th className="py-1.5 pr-3 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {emails.map(row => (
                    <tr key={row.id} className="border-b border-border/50 last:border-0">
                      <td className="py-2 pr-3">
                        <div className="text-foreground">{row.outbound_contacts?.person_name ?? '-'}</div>
                        <div className="text-muted-foreground/60">
                          {row.outbound_contacts?.company_name}
                          {row.outbound_contacts?.email ? ` · ${row.outbound_contacts.email}` : ''}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <Link
                          href={`/admin/outbound/campaigns?campaign=${row.campaign_id}`}
                          className="text-foreground hover:text-primary transition-colors"
                        >
                          {row.outbound_campaigns?.name ?? '-'}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 max-w-48 truncate text-muted-foreground">
                        {row.outbound_generated_content?.selected_subject_line ?? '-'}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusDot tone={statusTone(row.status)} label={statusLabel(row.status)} />
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground/60 whitespace-nowrap">
                        {formatDate(row.updated_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {total > pageSize && (
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button size="sm" variant="outline" disabled={offset === 0 || loading} onClick={prevPage}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={offset + pageSize >= total || loading} onClick={nextPage}>
                Next
              </Button>
            </div>
          )}
      </div>
    </div>
  )
}
