// ============================================================
// More - /admin/outbound
// ============================================================
// Landing page for primary nav's "More" tab. Used to be a 9-tool
// command-center hub (Overview/Pilot Review/Contacts/Campaigns/Follow-ups/
// Sales Knowledge/Suppression/Warm-Up/Integrations, all flattened to equal
// weight) - replaced in the 2026-08-31 UX restructuring with exactly what
// the locked IA calls for here: History and Settings, nothing else.
// Follow-ups was promoted to its own primary nav item (a real recurring
// job); Contacts/Campaigns/Overview/Pilot Review are internal/debug pages
// now reachable only by direct URL, not surfaced as a destination here.
// ============================================================

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { HistoryIcon, OutboundToolsIcon } from '@/components/shell/nav-icons'

const DESTINATIONS = [
  {
    href: '/admin/run-history',
    label: 'History',
    description: "Every company you've researched, and everything sent, in one place.",
    icon: HistoryIcon,
  },
  {
    href: '/admin/settings',
    label: 'Settings',
    description: 'Connected tools, mailbox health, your do-not-contact list, and the sales playbook.',
    icon: OutboundToolsIcon,
  },
] as const

export default function MorePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">More</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Everything else - past work and settings.</p>
      </div>

      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {DESTINATIONS.map(({ href, label, description, icon: Icon }) => (
          <Link key={href} href={href} className="group flex items-start gap-3 px-4 py-4 transition-colors hover:bg-accent/50">
            <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-accent text-foreground">
              <Icon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium text-foreground">{label}</h2>
                <ArrowRight className="size-3 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground/70">{description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
