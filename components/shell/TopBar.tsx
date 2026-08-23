'use client'

// ============================================================
// TopBar - slim context bar above the page content
// ============================================================

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { MoreHorizontal, Search, ChevronLeft } from 'lucide-react'
import { BrandMark } from './BrandMark'
import { NAV, SECONDARY_NAV, isNavActive } from './nav-config'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLinkItem,
} from '@/components/ui/dropdown-menu'

export function TopBar() {
  const pathname = usePathname()
  const router = useRouter()
  // Exact match first, then longest-prefix startsWith - same active-detection
  // shape as Sidebar.tsx, needed now that /admin/outbound has real sub-pages
  // (previously every NAV entry was a single page, so exact match alone
  // was enough).
  const entry =
    NAV.find((n) => n.href === pathname) ??
    NAV.find((n) => n.href !== '/admin' && pathname.startsWith(n.href + '/'))
  const meta = { section: entry?.label ?? 'Workspace', hint: entry?.hint ?? '' }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-5 backdrop-blur">
      <div className="flex items-center gap-2 text-sm">
        {/* Mobile brand (sidebar hidden < md - BottomTabBar covers primary
            nav on mobile instead, so there's no hamburger trigger here
            anymore, just the brand mark). */}
        <Link href="/admin" className="flex items-center gap-2 md:hidden">
          <BrandMark size="sm" />
        </Link>
        <button
          type="button"
          aria-label="Go back"
          onClick={() => router.back()}
          className="hidden size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:flex"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="hidden font-medium text-foreground md:inline">{meta.section}</span>
        {meta.hint && (
          <span className="hidden text-muted-foreground sm:inline">· {meta.hint}</span>
        )}
      </div>

      {/* Centered jump-to-page trigger - opens the same CommandPalette as
          ⌘K. Styled as a wide search bar per the visual reference, but the
          copy stays honest: this jumps between the app's existing pages,
          it is not a full-text search over companies/people (no such index
          exists in this app). */}
      <button
        type="button"
        aria-label="Open command palette"
        onClick={() => document.dispatchEvent(new CustomEvent('open-command-palette'))}
        className="mx-auto flex w-full max-w-md items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 text-left">Jump to a page…</span>
        <kbd className="hidden shrink-0 rounded border border-border/80 px-1 py-px text-[10px] sm:inline">⌘K</kbd>
      </button>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="More tools"
            className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:size-8"
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
        {/* Hidden on the narrowest phones - with BottomTabBar covering
            primary nav now, TopBar's mobile row only has real room for the
            brand mark + section label + the two buttons above. */}
        <span className="hidden shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline-block">
          Internal
        </span>
      </div>
    </header>
  )
}
