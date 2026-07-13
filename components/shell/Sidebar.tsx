'use client'

// ============================================================
// Sidebar — primary app navigation for the internal SDR tool
// ============================================================

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  ResearchIcon,
  BatchIcon,
  HistoryIcon,
  DotIcon,
} from './nav-icons'

const NAV = [
  { href: '/admin/intelligence-lab', label: 'Research', icon: ResearchIcon, hint: 'Single-company brief' },
  { href: '/admin/batch-upload', label: 'Batch', icon: BatchIcon, hint: 'Lead-list upload' },
  { href: '/admin/run-history', label: 'History', icon: HistoryIcon, hint: 'Saved runs' },
] as const

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      {/* Brand */}
      <Link
        href="/admin/intelligence-lab"
        className="flex h-14 items-center gap-2.5 px-5 border-b border-sidebar-border/60"
      >
        <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-semibold text-white shadow-sm shadow-violet-950/40">
          D
        </span>
        <span className="flex flex-col leading-none">
          <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">Demaze</span>
          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Intelligence
          </span>
        </span>
      </Link>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 px-3 py-4">
        <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
          Workspace
        </p>
        {NAV.map(({ href, label, icon: Icon, hint }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
              )}
              <Icon className={cn('size-[18px] shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
              <span className="flex flex-col leading-tight">
                <span className={cn('font-medium', active && 'text-primary')}>{label}</span>
                <span className="text-[11px] text-muted-foreground/70">{hint}</span>
              </span>
            </Link>
          )
        })}
      </nav>

      {/* Footer / env */}
      <div className="border-t border-sidebar-border/60 px-4 py-3">
        <div className="flex items-center gap-2 rounded-lg bg-accent/50 px-2.5 py-2">
          <DotIcon className="size-2 text-signal-strong" />
          <span className="text-[11px] font-medium text-muted-foreground">Internal · Dev</span>
        </div>
      </div>
    </aside>
  )
}
