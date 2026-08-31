// ============================================================
// /admin/outbound/* section layout
// ============================================================
// Just a back link + the page content. Used to carry a big "Outbound
// Tools" banner (title + jargon-heavy description) repeated on every
// sub-page above that page's own real header - dropped in the 2026-08-31
// UX restructuring: every child page already has its own clear header
// (see e.g. suppression/page.tsx, integrations/page.tsx), so the banner
// was pure duplication, and its wording ("outbound send pipeline",
// "Auto Flow") was exactly the kind of internal/developer framing that
// restructuring removed. This directory now holds a mix of Settings
// pages (reached via /admin/settings) and a few pages kept for internal/
// debug use only (Contacts, Campaigns, Overview, Pilot Review - no
// longer linked from any nav surface, still fully functional by direct
// URL) - a single generic "back" link covers both cases well enough
// without pretending they're one coherent section.
// ============================================================

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function OutboundSectionLayout({ children }: { children: React.ReactNode }) {
  // /admin/outbound itself (the More landing page) has nowhere useful to
  // "go back" to within this same section - only its sub-pages need the link.
  const isIndex = usePathname() === '/admin/outbound'

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
      {!isIndex && (
        <Link
          href="/admin/outbound"
          className="mb-6 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Back
        </Link>
      )}

      {children}
    </div>
  )
}
