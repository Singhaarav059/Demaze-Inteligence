'use client'

// ============================================================
// Sidebar — primary app navigation for the internal SDR tool
// ============================================================

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutGroup, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { BrandMark } from './BrandMark'
import { DotIcon } from './nav-icons'
import { NAV, NAV_GROUPS, SECONDARY_NAV, isNavActive } from './nav-config'

// Real, existing routes only (both already live in SECONDARY_NAV) — shown
// as indented children under the Outbound group so the sidebar's density
// reads closer to the reference collage without duplicating nav-config's
// NAV array (which BottomTabBar/TopBar/command palette still consume
// unchanged) or inventing a destination that doesn't exist.
const OUTBOUND_QUICK_LINKS = [
  SECONDARY_NAV.find(n => n.href === '/admin/outbound/campaigns')!,
  SECONDARY_NAV.find(n => n.href === '/admin/outbound/contacts')!,
]
// Same pattern for System — Integrations is this app's real settings
// surface (vendor providers per outbound capability), so it fills the
// "Settings" slot the reference shows under SYSTEM without inventing a
// page that doesn't exist.
const SYSTEM_QUICK_LINKS = [SECONDARY_NAV.find(n => n.href === '/admin/outbound/integrations')!]

const QUICK_LINKS_BY_GROUP: Record<string, typeof SECONDARY_NAV[number][]> = {
  Outbound: OUTBOUND_QUICK_LINKS,
  System: SYSTEM_QUICK_LINKS,
}

function QuickLink({ href, label, icon: Icon, hint, active }: (typeof SECONDARY_NAV)[number] & { active: boolean }) {
  return (
    <Tooltip key={href}>
      <TooltipTrigger
        render={
          <Link
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-md py-[6px] pl-6 pr-2.5 text-[12px] transition-colors',
              active ? 'bg-accent text-foreground' : 'text-muted-foreground/80 hover:bg-accent/60 hover:text-foreground',
            )}
          />
        }
      >
        <Icon className={cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground/60')} />
        <span>{label}</span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside aria-label="Primary" className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      {/* Brand */}
      <Link
        href="/admin"
        className="flex h-14 items-center gap-2.5 px-4 border-b border-sidebar-border"
      >
        <BrandMark size="sm" glow />
        <span className="flex flex-col leading-none">
          <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">Demaze</span>
          <span className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
            Intelligence Workspace
          </span>
        </span>
      </Link>

      {/* Nav — grouped into Workspace / Outbound / System (see NAV_GROUPS),
          a quiet workspace-selection feel rather than a glowing active state. */}
      <LayoutGroup id="sidebar-nav">
        <nav aria-label="Workspace" className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => {
            const items = NAV.filter((n) => (group.hrefs as readonly string[]).includes(n.href))
            if (items.length === 0) return null
            return (
              <div key={group.label}>
                <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {items.map(({ href, label, icon: Icon, hint }) => {
                    const active = isNavActive(pathname, href)
                    return (
                      <Tooltip key={href}>
                        <TooltipTrigger
                          render={
                            <Link
                              href={href}
                              aria-current={active ? 'page' : undefined}
                              className={cn(
                                'group relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors',
                                active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                              )}
                            />
                          }
                        >
                          {active && (
                            <motion.span
                              layoutId="sidebar-active-bar"
                              className="absolute left-0 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-primary"
                              transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                            />
                          )}
                          <Icon className={cn('relative size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground/80 group-hover:text-foreground')} />
                          <span className={cn('relative font-medium', active && 'text-foreground')}>{label}</span>
                        </TooltipTrigger>
                        <TooltipContent>{hint}</TooltipContent>
                      </Tooltip>
                    )
                  })}
                  {(QUICK_LINKS_BY_GROUP[group.label] ?? []).map(link => (
                    <QuickLink key={link.href} {...link} active={pathname === link.href || pathname.startsWith(link.href + '/')} />
                  ))}
                </div>
              </div>
            )
          })}
        </nav>
      </LayoutGroup>

      {/* Footer / env */}
      <div className="border-t border-sidebar-border px-3 py-3">
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
          <DotIcon className="size-1.5 text-signal-strong" />
          <span className="text-[11px] font-medium text-muted-foreground/70">Internal · Dev</span>
        </div>
      </div>
    </aside>
  )
}
