'use client'

// ============================================================
// Outbound Tools - /admin/outbound (hub / command center)
// ============================================================
// Landing page for the section. Redesigned (2026-08) from a static links
// page into a real command-center: a top-level metrics row (real numbers
// only, from the same APIs the Overview/Campaigns/Contacts pages already
// call) followed by compact navigational rows into the 9 sub-tools. Added
// 2026-07-31 as the destination for the "Outbound Tools" sidebar entry.
// ============================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Send, Users, Inbox, Reply, Clock } from 'lucide-react'
import { MetricTile } from '@/components/ui/metric-tile'
import { Spinner } from '@/components/ui/spinner'
import { GuideNote } from '@/components/ui/guide-note'
import { SECONDARY_NAV } from '@/components/shell/nav-config'
import type { OverviewStats } from './overview/useOutboundOverview'

// Grouped purely for on-screen scannability - same 9 SECONDARY_NAV entries,
// same hrefs, no new data. "Execution" = day-to-day outreach work,
// "Configuration" = set-it-once vendor/knowledge setup.
const EXECUTION_HREFS = [
  '/admin/outbound/overview',
  '/admin/outbound/pilot-review',
  '/admin/outbound/contacts',
  '/admin/outbound/campaigns',
  '/admin/outbound/followups',
]

const WHEN_TO_USE: Record<string, string> = {
  '/admin/outbound/overview': 'You want cross-campaign stats and a single searchable table of every email ever queued or sent, rather than digging through one campaign at a time.',
  '/admin/outbound/pilot-review': 'You just ran research on a batch of pilot companies and need to manually confirm each one’s company/evidence/opportunity/stakeholder is right before outreach gets generated.',
  '/admin/outbound/contacts': 'You want to add a contact by hand, run Decision-Maker Discovery for a researched company outside Auto Flow, or check what’s already on file for a company.',
  '/admin/outbound/campaigns': 'You want to inspect a campaign’s send queue and event timeline, manually pause/resume one, or trigger a send/follow-up check without going through Auto Flow.',
  '/admin/outbound/followups': 'You want to see exactly what follow-up is due for whom, send one early, stop a contact’s remaining sequence, or change the follow-up cadence.',
  '/admin/outbound/suppression': 'You need to check or add an address that should never be emailed again - bounces land here automatically, unsubscribes and manual exclusions you add yourself.',
  '/admin/outbound/warmup': 'You’re about to start sending from a new mailbox and want to track its warm-up ramp, or you want to check an existing mailbox’s inbox/spam rate.',
  '/admin/outbound/integrations': 'You’re switching a capability (email finder, sending, etc.) from its mock provider to a real vendor, or connecting/reconnecting Gmail.',
}

// Flat row, not a floating padded card - quieter nav language matching
// Sidebar/AdminOutboundNav rather than a grid of individually-bordered tiles.
function ToolRow({ href, label, icon: Icon, hint }: (typeof SECONDARY_NAV)[number]) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
    >
      <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-accent text-foreground">
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-foreground">{label}</h2>
          <ArrowRight className="size-3 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground/70">{hint}</p>
        <p className="mt-1 text-xs text-muted-foreground/60">
          <span className="font-medium text-foreground/70">Use this when: </span>
          {WHEN_TO_USE[href]}
        </p>
      </div>
    </Link>
  )
}

interface HubCounts {
  stats: OverviewStats | null
  campaignCount: number | null
  contactCount: number | null
}

export default function OutboundToolsOverviewPage() {
  const execution = SECONDARY_NAV.filter(item => EXECUTION_HREFS.includes(item.href))
  const configuration = SECONDARY_NAV.filter(item => !EXECUTION_HREFS.includes(item.href))

  const [counts, setCounts] = useState<HubCounts>({ stats: null, campaignCount: null, contactCount: null })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const [overviewRes, campaignsRes, contactsRes] = await Promise.all([
          fetch('/api/admin/outbound/overview?limit=1'),
          fetch('/api/admin/outbound/campaigns'),
          fetch('/api/admin/outbound/contacts'),
        ])
        const [overviewData, campaignsData, contactsData] = await Promise.all([
          overviewRes.json(),
          campaignsRes.json(),
          contactsRes.json(),
        ])
        setCounts({
          stats: overviewData.success ? overviewData.stats : null,
          campaignCount: campaignsData.success ? campaignsData.campaigns.length : null,
          contactCount: contactsData.success ? contactsData.contacts.length : null,
        })
      } catch {
        // non-fatal - the metrics row just stays empty, the nav rows below still work
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const { stats, campaignCount, contactCount } = counts
  const replyRatePct = stats ? Math.round(stats.replyRate * 1000) / 10 : 0

  return (
    <div className="space-y-6">
      <GuideNote>
        <p>
          <strong>What this section is.</strong> Auto Flow is the guided, one-company-at-a-time
          path through research → contacts → outreach → send, and covers most day-to-day work on
          its own. The tools below are the same underlying data, exposed directly - useful when
          you need to look something up, override a step, or configure a vendor rather than run
          the full guided flow.
        </p>
      </GuideNote>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Spinner className="size-4" /> Loading metrics…
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {campaignCount !== null && <MetricTile icon={Send} label="Campaigns" value={campaignCount} />}
          {contactCount !== null && <MetricTile icon={Users} label="Contacts" value={contactCount} />}
          {stats && (
            <>
              <MetricTile icon={Inbox} label="Queued" value={stats.queued} />
              <MetricTile icon={Send} label="Contacted" value={stats.totalContacted} sub={`${stats.sentLast24h} in last 24h`} />
              <MetricTile icon={Reply} label="Replied" value={stats.replied} sub={`${replyRatePct}% reply rate`} />
              <MetricTile icon={Clock} label="Follow-ups Due" value={stats.followupDueNow} sub={`${stats.followupPending} pending`} />
            </>
          )}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Execution</h2>
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {execution.map(item => <ToolRow key={item.href} {...item} />)}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Configuration</h2>
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {configuration.map(item => <ToolRow key={item.href} {...item} />)}
        </div>
      </div>
    </div>
  )
}
