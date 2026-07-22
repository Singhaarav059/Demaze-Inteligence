'use client'

// ============================================================
// Root global error boundary
// ============================================================
// Next.js App Router convention: the ONLY error boundary that can catch a
// throw in the root layout itself (app/layout.tsx) — every other error.tsx
// is nested inside a layout and can't catch a failure in that layout.
// Because of that, this file must render its own <html>/<body> — it fully
// replaces the root layout when active, there is nothing above it to fall
// back on. Plain inline styles only (Tailwind/globals.css may not have
// loaded if the failure happened that early). No not-found.tsx/error.tsx
// existed anywhere before this session (2026-07-19 addition, Track 2).
// ============================================================

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[GlobalError]', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0c',
          color: '#f6f6f7',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
          padding: '24px',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ marginTop: '8px', fontSize: '0.875rem', color: '#a6a6ac', maxWidth: '28rem' }}>
          {error.message || 'The application failed to load.'}
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: '20px',
            background: '#6f63e8',
            color: '#fff',
            border: 'none',
            borderRadius: '10px',
            padding: '10px 20px',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  )
}
