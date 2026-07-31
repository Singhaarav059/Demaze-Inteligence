// ============================================================
// Outbound Tools section layout — /admin/outbound/*
// ============================================================
// Settings-app-style shell: a section header, a persistent left sub-nav
// (AdminOutboundNav), and the page content to its right. Added 2026-07-31
// alongside the new /admin/outbound hub page — previously each of the 4
// pages under here rendered its own horizontal OutboundToolsNav strip and
// its own mx-auto max-w-2xl wrapper; both are now owned by this layout so
// the 4 pages (+ the new hub) stay visually consistent by construction
// instead of by convention.
// ============================================================

import { OutboundToolsIcon } from '@/components/shell/nav-icons'
import { AdminOutboundNav } from '@/components/shell/AdminOutboundNav'

export default function OutboundToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
      <div className="mb-8 flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <OutboundToolsIcon className="size-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Outbound Tools</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manual and debug controls for the outbound send pipeline — contacts, campaigns,
            mailbox warm-up, and vendor integrations. Auto Flow covers the guided version of
            most of this inline; come here to inspect, override, or configure things directly.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-8 md:flex-row">
        <aside className="shrink-0 md:w-56">
          <AdminOutboundNav />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
