// ============================================================
// Outbound Tools section layout - /admin/outbound/*
// ============================================================
// Just a section header + the page content - no second in-page nav rail.
// Used to render AdminOutboundNav (a persistent left sub-nav) alongside the
// content, but that duplicated the exact same 9-link list the Sidebar's own
// "Outbound" dropdown already shows - on every single sub-page, with zero
// added information over the sidebar copy. Removed 2026-08-23; the real
// "what does each tool do" content still lives on the hub page's own
// Execution/Configuration rows (app/admin/outbound/page.tsx), which add
// genuine explanatory text the sidebar doesn't - that one wasn't touched.
// ============================================================

import Link from 'next/link'
import { OutboundToolsIcon } from '@/components/shell/nav-icons'

export default function OutboundToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
      <Link
        href="/admin/auto-gtm"
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Back to Auto Flow
      </Link>
      <div className="mb-8 flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <OutboundToolsIcon className="size-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Outbound Tools</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manual and debug controls for the outbound send pipeline - contacts, campaigns,
            mailbox warm-up, and vendor integrations. Auto Flow covers the guided version of
            most of this inline; come here to inspect, override, or configure things directly.
          </p>
        </div>
      </div>

      {children}
    </div>
  )
}
