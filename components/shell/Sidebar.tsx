'use client'

// ============================================================
// Sidebar - primary app navigation for the internal SDR tool
// ============================================================

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ComponentType } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { BrandMark } from './BrandMark'
import { NAV, isNavActive } from './nav-config'

function NavLink({ href, label, icon: Icon, hint, active }: { href: string; label: string; icon: ComponentType<{ className?: string }>; hint: string; active: boolean }) {
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
          <span className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Intelligence Workspace
          </span>
        </span>
      </Link>

      {/* Nav - flat, 5 destinations. Used to be grouped/nested with an
          expandable "Outreach" dropdown when primary nav carried 9+ tools;
          removed with the 2026-08-31 UX restructuring once Contacts/
          Campaigns/Overview/Pilot Review dropped out of user-facing nav
          entirely (still real pages, just not nav destinations - see
          nav-config.ts's header comment). Five flat links need no grouping. */}
      <nav aria-label="Workspace" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {NAV.map(({ href, label, icon: Icon, hint }) => (
          <NavLink key={href} href={href} label={label} icon={Icon} hint={hint} active={isNavActive(pathname, href)} />
        ))}
      </nav>
    </aside>
  )
}
