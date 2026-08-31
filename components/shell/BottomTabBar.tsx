'use client'

// ============================================================
// BottomTabBar - native-app-style bottom tab navigation, mobile only.
// ============================================================
// Replaces MobileNav's hamburger+drawer as the primary way to move between
// the primary NAV sections on a phone (2026-08-04 mobile pass - "make the
// admin product feel like an app"; Home added later, grid-cols tracks
// NAV.length). A persistent bottom tab bar, not a drawer you have to open,
// is the single most recognizable native-app navigation pattern (iOS Tab
// Bar / Android Bottom Navigation) - MobileNav's drawer pattern is more
// "mobile website" than "app". SECONDARY_NAV (History, Connected Tools,
// Mailbox Health, etc.) is one tap deeper, under the "More" tab's own
// page - this bar is only for the 5 primary NAV entries.
//
// pb-safe (env(safe-area-inset-bottom)) keeps tab labels clear of the iOS
// home-indicator gesture area - see app/globals.css and the viewport-fit=
// cover viewport export in app/layout.tsx that makes the env() value real.
// ============================================================

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { NAV, isNavActive } from './nav-config'

// Tab-bar-specific short labels - nav-config.ts's canonical labels (used by
// Sidebar/TopBar/command palette) stay unchanged; "Find Companies" alone
// doesn't fit a 6-way bottom tab without wrapping or truncating awkwardly.
const SHORT_LABEL: Record<string, string> = {
  'Find Companies': 'Find',
}

export function BottomTabBar() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-sidebar-border bg-sidebar/95 backdrop-blur md:hidden"
    >
      <div className="grid grid-cols-5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isNavActive(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className={cn('size-5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
              <span className="leading-none">{SHORT_LABEL[label] ?? label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
