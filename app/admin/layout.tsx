'use client'

// ============================================================
// Admin Layout — Nav wrapper (auth removed during build phase)
// ============================================================

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Top nav */}
      <div className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-xs font-mono text-zinc-500 hover:text-zinc-300 transition-colors uppercase tracking-widest">
              Demaze
            </Link>
            <nav className="flex items-center gap-1">
              <NavLink href="/admin/intelligence-lab">Intelligence Lab</NavLink>
              <NavLink href="/admin/run-history">Run History</NavLink>
            </nav>
          </div>
          <span className="text-xs text-zinc-600 font-mono">Internal</span>
        </div>
      </div>

      <main>{children}</main>
    </div>
  )
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  // Active state handled client-side via pathname
  return (
    <Link
      href={href}
      className="text-sm text-zinc-400 hover:text-white px-3 py-1.5 rounded-md hover:bg-zinc-800 transition-colors"
    >
      {children}
    </Link>
  )
}
