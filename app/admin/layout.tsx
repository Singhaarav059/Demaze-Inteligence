// ============================================================
// Admin Layout — app shell (sidebar + top bar)
// Forces the refined-dark theme for the whole internal tool.
// (auth removed during build phase)
// ============================================================

import { Toaster } from 'sonner'
import { Sidebar } from '@/components/shell/Sidebar'
import { TopBar } from '@/components/shell/TopBar'
import { MotionConfigProvider } from '@/components/shell/MotionConfigProvider'
import { CommandPalette } from '@/components/shell/CommandPalette'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfigProvider>
    <div className="dark">
      <div className="min-h-screen bg-background text-foreground">
        {/* Skip link — visually hidden until focused, so keyboard users don't
            have to tab through the full sidebar nav on every page load. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <Sidebar />
        <div className="flex min-h-screen flex-col md:pl-60">
          <TopBar />
          <main id="main-content" tabIndex={-1} className="flex-1 outline-none">{children}</main>
        </div>
      </div>
      <CommandPalette />
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: 'bg-card! border-border! text-foreground! shadow-lg',
            title: 'text-foreground!',
            description: 'text-muted-foreground!',
            actionButton: 'bg-primary! text-primary-foreground!',
            cancelButton: 'bg-accent! text-muted-foreground!',
          },
        }}
      />
    </div>
    </MotionConfigProvider>
  )
}
