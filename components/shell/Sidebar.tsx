'use client'

// ============================================================
// Sidebar - primary app navigation for the internal SDR tool
// ============================================================

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { LayoutGroup, motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { BrandMark } from './BrandMark'
import { DotIcon } from './nav-icons'
import { NAV, NAV_GROUPS, SECONDARY_NAV, isNavActive } from './nav-config'

function SubLink({ href, label, icon: Icon, hint, active }: (typeof SECONDARY_NAV)[number] & { active: boolean }) {
  return (
    <Tooltip key={href}>
      <TooltipTrigger
        render={
          <Link
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-md py-[6px] pl-6 pr-2.5 text-[12px] transition-colors',
              active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          />
        }
      >
        <Icon className={cn('size-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground/80')} />
        <span>{label}</span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  // The Outbound group is a dropdown, not a direct link - clicking it
  // toggles visibility of every SECONDARY_NAV tool (Overview, Contacts,
  // Campaigns, Follow-ups, Sales Knowledge, Suppression, Warm-Up,
  // Integrations) inline, instead of requiring a click into the
  // /admin/outbound hub page first to see the same list. Starts open when
  // already inside that section so a deep link doesn't land with its own
  // nav collapsed.
  const outboundSectionActive = pathname.startsWith('/admin/outbound')
  const [outboundOpen, setOutboundOpen] = useState(outboundSectionActive)

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
          <span className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Intelligence Workspace
          </span>
        </span>
      </Link>

      {/* Nav - grouped into Workspace / Outbound / System (see NAV_GROUPS),
          a quiet workspace-selection feel rather than a glowing active state. */}
      <LayoutGroup id="sidebar-nav">
        <nav aria-label="Workspace" className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => {
            const items = NAV.filter((n) => (group.hrefs as readonly string[]).includes(n.href))
            if (items.length === 0) return null
            return (
              <div key={group.label}>
                <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {items.map(({ href, label, icon: Icon, hint }) => {
                    if (group.label === 'Outbound') {
                      return (
                        <div key={href}>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <button
                                  type="button"
                                  onClick={() => setOutboundOpen((v) => !v)}
                                  aria-expanded={outboundOpen}
                                  className={cn(
                                    'group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors',
                                    outboundSectionActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                                  )}
                                />
                              }
                            >
                              {outboundSectionActive && (
                                <motion.span
                                  layoutId="sidebar-active-bar"
                                  className="absolute left-0 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-primary"
                                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                                />
                              )}
                              <Icon className={cn('relative size-4 shrink-0', outboundSectionActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
                              <span className={cn('relative flex-1 text-left font-medium', outboundSectionActive ? 'text-foreground' : 'text-sidebar-foreground')}>{label}</span>
                              <ChevronDown className={cn('relative size-3.5 shrink-0 text-muted-foreground/60 transition-transform', outboundOpen && 'rotate-180')} />
                            </TooltipTrigger>
                            <TooltipContent>{hint}</TooltipContent>
                          </Tooltip>
                          <AnimatePresence initial={false}>
                            {outboundOpen && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.15 }}
                                className="overflow-hidden"
                              >
                                <div className="space-y-0.5 pt-0.5">
                                  {SECONDARY_NAV.map((link) => (
                                    <SubLink key={link.href} {...link} active={isNavActive(pathname, link.href)} />
                                  ))}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )
                    }
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
                          <Icon className={cn('relative size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
                          <span className={cn('relative font-medium', active ? 'text-foreground' : 'text-sidebar-foreground')}>{label}</span>
                        </TooltipTrigger>
                        <TooltipContent>{hint}</TooltipContent>
                      </Tooltip>
                    )
                  })}
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
          <span className="text-[11px] font-medium text-muted-foreground">Internal · Dev</span>
        </div>
      </div>
    </aside>
  )
}
