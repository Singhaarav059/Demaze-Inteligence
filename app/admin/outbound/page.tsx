// ============================================================
// Outbound Tools — /admin/outbound (hub / overview)
// ============================================================
// Landing page for the section: explains what it's for, then links out to
// the 4 tools with a short "use this when" note each. Added 2026-07-31 as
// the destination for the new "Outbound Tools" sidebar entry — before this,
// these pages had no on-screen entry point at all (direct URL, TopBar
// "More" menu, or Cmd+K only).
// ============================================================

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { GuideNote } from '@/components/ui/guide-note'
import { SECONDARY_NAV } from '@/components/shell/nav-config'

const WHEN_TO_USE: Record<string, string> = {
  '/admin/outbound/overview': 'You want cross-campaign stats and a single searchable table of every email ever queued or sent, rather than digging through one campaign at a time.',
  '/admin/outbound/contacts': 'You want to add a contact by hand, run Decision-Maker Discovery for a researched company outside Auto Flow, or check what’s already on file for a company.',
  '/admin/outbound/campaigns': 'You want to inspect a campaign’s send queue and event timeline, manually pause/resume one, or trigger a send/follow-up check without going through Auto Flow.',
  '/admin/outbound/followups': 'You want to see exactly what follow-up is due for whom, send one early, stop a contact’s remaining sequence, or change the follow-up cadence.',
  '/admin/outbound/suppression': 'You need to check or add an address that should never be emailed again — bounces land here automatically, unsubscribes and manual exclusions you add yourself.',
  '/admin/outbound/warmup': 'You’re about to start sending from a new mailbox and want to track its warm-up ramp, or you want to check an existing mailbox’s inbox/spam rate.',
  '/admin/outbound/integrations': 'You’re switching a capability (email finder, sending, etc.) from its mock provider to a real vendor, or connecting/reconnecting Gmail.',
}

export default function OutboundToolsOverviewPage() {
  return (
    <div className="space-y-6">
      <GuideNote>
        <p>
          <strong>What this section is.</strong> Auto Flow is the guided, one-company-at-a-time
          path through research → contacts → outreach → send, and covers most day-to-day work on
          its own. The tools below are the same underlying data, exposed directly — useful when
          you need to look something up, override a step, or configure a vendor rather than run
          the full guided flow.
        </p>
      </GuideNote>

      <div className="grid gap-3 sm:grid-cols-2">
        {SECONDARY_NAV.map(({ href, label, icon: Icon, hint }) => (
          <Link
            key={href}
            href={href}
            className="group flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4 transition-colors hover:border-border-strong hover:bg-accent/40"
          >
            <div className="flex items-center justify-between">
              <div className="grid size-9 place-items-center rounded-lg bg-accent text-foreground">
                <Icon className="size-4.5" />
              </div>
              <ArrowRight className="size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">{label}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground/80">{hint}</p>
            </div>
            <p className="mt-1 border-t border-border pt-2.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">Use this when: </span>
              {WHEN_TO_USE[href]}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
