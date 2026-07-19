'use client'

// ============================================================
// Admin route error boundary
// ============================================================
// Next.js App Router convention: catches a render-time throw anywhere
// under app/admin/ that isn't already handled by a try/catch. Nested
// inside app/admin/layout.tsx, so Sidebar/TopBar stay mounted — only the
// page content below them is replaced by this fallback. Before this file
// existed, a render throw anywhere in the admin app had no boundary at
// all and fell through to Next.js's generic root-level handling, which
// unmounts the whole app shell (2026-07-19 fix, see CLAUDE.md Track 2).
// ============================================================

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[AdminError]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-center">
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-6 py-8">
        <h1 className="text-base font-semibold text-destructive">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message || 'An unexpected error occurred while rendering this page.'}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button size="sm" onClick={reset}>Try again</Button>
          <Button size="sm" variant="outline" onClick={() => { window.location.href = '/admin/auto-gtm' }}>
            Back to Auto Flow
          </Button>
        </div>
      </div>
    </div>
  )
}
