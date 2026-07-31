'use client'

// ============================================================
// AdminOutboundNav — persistent sub-nav for the /admin/outbound
// section (Overview + Contacts/Campaigns/Warm-Up/Integrations).
// ============================================================
// Replaces the old horizontal OutboundToolsNav tab strip (2026-07-31
// redesign) with a settings-app-style vertical nav, rendered once by
// app/admin/outbound/layout.tsx rather than duplicated into each page.
// Same SECONDARY_NAV data source as the TopBar "More" menu and Cmd+K —
// see nav-config.ts's own comment on why this stays one list, three
// presentations.
// ============================================================

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SECONDARY_NAV } from './nav-config'

export function AdminOutboundNav() {
  const pathname = usePathname()
  const onHub = pathname === '/admin/outbound'

  // Labeled "Guide" (not "Overview") deliberately — SECONDARY_NAV already
  // has a real Overview page (/admin/outbound/overview, cross-campaign
  // stats) spread in below; this hub link is a different thing (what each
  // tool is for), so it needs a name that doesn't collide with theirs.
  const items = [
    { href: '/admin/outbound', label: 'Guide', icon: BookOpen, hint: 'What each tool below is for' },
    ...SECONDARY_NAV,
  ]

  return (
    <nav aria-label="Outbound tools" className="space-y-3">
      <Link
        href="/admin/auto-gtm"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Back to Auto Flow
      </Link>
      <div className="space-y-0.5">
        {items.map(({ href, label, icon: Icon, hint }) => {
          const active = href === '/admin/outbound' ? onHub : pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group relative flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
              )}
              <Icon className={cn('mt-0.5 size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
              <span className="flex flex-col leading-tight">
                <span className={cn('font-medium', active && 'text-primary')}>{label}</span>
                <span className="text-[11px] text-muted-foreground/70">{hint}</span>
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
