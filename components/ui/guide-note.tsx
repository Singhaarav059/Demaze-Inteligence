// ============================================================
// GuideNote - small explanatory callout ("what is this page for,
// when should I use it"), used across the /admin/outbound section
// so every tool leads with the same visually-distinct guidance
// block instead of a plain muted paragraph.
// ============================================================

import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export function GuideNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex gap-2.5 rounded-lg border border-border bg-accent/30 px-4 py-3', className)}>
      <Info className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="space-y-1.5 text-sm text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">
        {children}
      </div>
    </div>
  )
}
