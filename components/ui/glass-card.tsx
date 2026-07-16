import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'

// Thin extension of Card applying the Explee-aligned glass-panel utility
// (see app/globals.css) — alpha-white-over-dark elevation via backdrop
// blur instead of a flat card color. Generic primitive, not wizard-specific.
export function GlassCard({ className, ...props }: React.ComponentProps<typeof Card>) {
  return <Card className={cn('glass-panel', className)} {...props} />
}

export function GlassCardStrong({ className, ...props }: React.ComponentProps<typeof Card>) {
  return <Card className={cn('glass-panel-strong', className)} {...props} />
}
