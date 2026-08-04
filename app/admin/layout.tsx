// ============================================================
// Admin Layout — app shell (sidebar + top bar)
// Forces the refined-dark theme for the whole internal tool.
// (auth removed during build phase)
// ============================================================

import { Toaster } from 'sonner'
import { Sidebar } from '@/components/shell/Sidebar'
import { TopBar } from '@/components/shell/TopBar'
import { BottomTabBar } from '@/components/shell/BottomTabBar'
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
          {/* Clears BottomTabBar's fixed height (its own min-h-14 = 3.5rem)
              plus its safe-area inset on mobile — arbitrary-value syntax,
              not a named @utility, see the note in globals.css for why.
              md:pb-0 resets it once the tab bar itself is hidden (md:hidden)
              and the desktop Sidebar takes over navigation instead. */}
          <main id="main-content" tabIndex={-1} className="flex-1 pb-[calc(3.5rem_+_env(safe-area-inset-bottom,0px))] outline-none md:pb-0">{children}</main>
        </div>
        <BottomTabBar />
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
