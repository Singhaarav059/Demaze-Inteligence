'use client'

// ============================================================
// MobileNav — hamburger + slide-in drawer for < md screens.
// The desktop Sidebar is hidden below md, so this is the only
// way to move between Research / Batch / History on a phone.
// Self-contained: owns its open/close state, closes on route
// change, and locks body scroll while open.
// ============================================================

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { MenuIcon, CloseIcon, DotIcon } from './nav-icons'
import { NAV } from './nav-config'

export function MobileNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // Lock body scroll while the drawer is open. Every nav link closes the
  // drawer via its own onClick, so no route-change effect is needed here.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <MenuIcon className="size-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* Drawer */}
          <aside className="absolute inset-y-0 left-0 flex w-64 max-w-[80%] flex-col border-r border-sidebar-border bg-sidebar shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-sidebar-border/60 px-4">
              <Link href="/admin/intelligence-lab" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
                <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-semibold text-white">
                  D
                </span>
                <span className="flex flex-col leading-none">
                  <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">Demaze</span>
                  <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Intelligence
                  </span>
                </span>
              </Link>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <CloseIcon className="size-5" />
              </button>
            </div>

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
                    onClick={() => setOpen(false)}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm transition-colors',
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

            <div className="border-t border-sidebar-border/60 px-4 py-3">
              <div className="flex items-center gap-2 rounded-lg bg-accent/50 px-2.5 py-2">
                <DotIcon className="size-2 text-signal-strong" />
                <span className="text-[11px] font-medium text-muted-foreground">Internal · Dev</span>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
