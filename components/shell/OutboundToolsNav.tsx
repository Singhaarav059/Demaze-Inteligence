'use client'

// ============================================================
// OutboundToolsNav — cross-links between the 4 pages pulled out
// of primary nav on 2026-07-18 (Contacts/Campaigns/Warm-Up/
// Integrations), plus a way back to Auto Flow.
// ============================================================
// These pages are still real, still linked to directly (a campaign's
// pause/resume controls, changing an active provider), just no longer in
// the sidebar. Landing on any one of them via a direct URL, the TopBar
// "More" menu, or the command palette previously put the other three (and
// Auto Flow) zero clicks away — this puts them one click away instead.
// ============================================================

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { SECONDARY_NAV } from './nav-config'

export function OutboundToolsNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Outbound tools" className="mb-6 flex flex-wrap items-center gap-x-1 gap-y-1.5 text-sm">
      <Link href="/admin/auto-gtm" className="text-muted-foreground transition-colors hover:text-foreground">
        ← Auto Flow
      </Link>
      <span className="mx-1.5 text-border">·</span>
      {SECONDARY_NAV.map(({ href, label }, i) => {
        const active = pathname === href || pathname.startsWith(href + '/')
        return (
          <span key={href} className="flex items-center gap-1">
            {i > 0 && <span className="mx-1 text-border">·</span>}
            <Link
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </Link>
          </span>
        )
      })}
    </nav>
  )
}
