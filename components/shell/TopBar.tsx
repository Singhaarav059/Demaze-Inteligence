'use client'

// ============================================================
// TopBar — slim context bar above the page content
// ============================================================

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRightIcon } from './nav-icons'

const SECTIONS: Record<string, { section: string; hint: string }> = {
  '/admin/intelligence-lab': { section: 'Research', hint: 'Single-company intelligence brief' },
  '/admin/batch-upload': { section: 'Batch', hint: 'Upload & research a lead list' },
  '/admin/run-history': { section: 'History', hint: 'Previously saved research runs' },
}

export function TopBar() {
  const pathname = usePathname()
  const meta = SECTIONS[pathname] ?? { section: 'Workspace', hint: '' }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/80 px-5 backdrop-blur">
      <div className="flex items-center gap-2 text-sm">
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

      <span className="rounded-md border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        Internal
      </span>
    </header>
  )
}
