'use client'

// ============================================================
// TopBar — slim context bar above the page content
// ============================================================

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { ChevronRightIcon } from './nav-icons'
import { MobileNav } from './MobileNav'
import { NAV, SECONDARY_NAV } from './nav-config'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLinkItem,
} from '@/components/ui/dropdown-menu'

export function TopBar() {
  const pathname = usePathname()
  const entry = NAV.find((n) => n.href === pathname)
  const meta = { section: entry?.label ?? 'Workspace', hint: entry?.hint ?? '' }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/80 px-5 backdrop-blur">
      <div className="flex items-center gap-2 text-sm">
        {/* Mobile nav (sidebar hidden < md) */}
        <MobileNav />
        {/* Mobile brand (sidebar hidden < md) */}
        <Link href="/admin/intelligence-lab" className="flex items-center gap-2 md:hidden">
          <span className="grid size-6 place-items-center rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-semibold text-white">
            D
          </span>
        </Link>
        <span className="hidden text-muted-foreground md:inline">Demaze</span>
        <ChevronRightIcon className="hidden size-3.5 text-muted-foreground/50 md:inline" />
        <span className="font-medium text-foreground">{meta.section}</span>
        {meta.hint && (
          <>
            <span className="mx-1 hidden text-border sm:inline">·</span>
            <span className="hidden text-muted-foreground sm:inline">{meta.hint}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Open command palette"
          onClick={() => document.dispatchEvent(new CustomEvent('open-command-palette'))}
          className="hidden items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:flex"
        >
          Jump to…
          <kbd className="rounded border border-border/80 px-1 py-px text-[10px]">⌘K</kbd>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="More tools"
            className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {SECONDARY_NAV.map(({ href, label, icon: Icon, hint }) => (
              <DropdownMenuLinkItem key={href} href={href}>
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex flex-col leading-tight">
                  <span className="font-medium">{label}</span>
                  <span className="text-[11px] text-muted-foreground/70">{hint}</span>
                </span>
              </DropdownMenuLinkItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          Internal
        </span>
      </div>
    </header>
  )
}
