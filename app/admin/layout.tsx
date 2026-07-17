// ============================================================
// Admin Layout — app shell (sidebar + top bar)
// Forces the refined-dark theme for the whole internal tool.
// (auth removed during build phase)
// ============================================================

import { Toaster } from 'sonner'
import { Sidebar } from '@/components/shell/Sidebar'
import { TopBar } from '@/components/shell/TopBar'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark">
      <div className="min-h-screen bg-background text-foreground">
        <Sidebar />
        <div className="flex min-h-screen flex-col md:pl-60">
          <TopBar />
          <main className="flex-1">{children}</main>
        </div>
      </div>
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
  )
}
