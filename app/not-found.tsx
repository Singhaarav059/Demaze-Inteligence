import Link from 'next/link'

// ============================================================
// Root not-found page
// ============================================================
// Next.js App Router convention: shown for any unmatched route. Root-level
// (not nested under app/admin/layout.tsx), so it applies its own dark-theme
// wrapper directly, same self-contained pattern as app/page.tsx — there was
// no not-found.tsx anywhere before this (2026-07-19 addition, Track 2).
// ============================================================

export default function NotFound() {
  return (
    <div className="dark min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-6 text-center">
      <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">404</p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground max-w-sm">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <Link
        href="/admin/auto-gtm"
        className="mt-6 inline-flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-sm px-5 py-2.5 rounded-xl transition-colors"
      >
        Open Auto Flow
      </Link>
    </div>
  )
}
