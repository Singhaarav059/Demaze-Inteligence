// ============================================================
// Settings - /admin/settings
// ============================================================
// New in the 2026-08-31 UX restructuring: groups the four
// configuration/supporting pages that used to sit as equal-weight items
// in a flat 9-tool "Outbound Tools" list (Integrations, Warm-Up,
// Suppression, Sales Knowledge) under one Settings destination, reached
// via More. These are configure-once tools, not core workflow - they
// should feel like it. The pages themselves are untouched (same routes,
// same logic), only their entry point and labels changed.
// ============================================================

import Link from 'next/link'
import { ArrowRight, Plug, Flame, Ban, Library } from 'lucide-react'

const SETTINGS = [
  {
    href: '/admin/outbound/integrations',
    label: 'Connected Tools',
    description: 'The outside tools Demaze uses to find people, verify emails, and send.',
    icon: Plug,
  },
  {
    href: '/admin/outbound/warmup',
    label: 'Mailbox Health',
    description: 'How ready your sending mailbox is to send in volume without landing in spam.',
    icon: Flame,
  },
  {
    href: '/admin/outbound/suppression',
    label: 'Do-not-contact List',
    description: 'Addresses that should never be emailed again - bounced, unsubscribed, or excluded by hand.',
    icon: Ban,
  },
  {
    href: '/admin/outbound/sales-knowledge',
    label: 'Sales Playbook',
    description: 'What Demaze sells, who it sells to, and the proof - used to shape outreach.',
    icon: Library,
  },
] as const

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <Link
          href="/admin/outbound"
          className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Back to More
        </Link>
        <h1 className="text-lg font-semibold text-foreground">Settings</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Configuration that rarely needs to change.</p>
      </div>

      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {SETTINGS.map(({ href, label, description, icon: Icon }) => (
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
