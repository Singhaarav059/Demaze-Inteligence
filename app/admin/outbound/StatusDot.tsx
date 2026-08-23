import { cn } from '@/lib/utils'

// ============================================================
// StatusDot - same subtle dot+label visual language as
// components/ui/intel-status.tsx, generalized to arbitrary status
// vocabularies (campaign status, send status, event type) that don't
// map onto IntelStatus's fixed research-status kind union. Local to the
// outbound section (shared by Campaigns/Overview/Followups) rather than
// promoted to components/ui - same "duplication over cross-module
// coupling for small helpers" precedent already used elsewhere in this repo.
// ============================================================

export type StatusTone = 'strong' | 'medium' | 'weak' | 'muted' | 'destructive'

const TONE_DOT: Record<StatusTone, string> = {
  strong: 'bg-signal-strong',
  medium: 'bg-signal-medium',
  weak: 'bg-signal-weak',
  muted: 'bg-muted-foreground/40',
  destructive: 'bg-destructive',
}

const TONE_TEXT: Record<StatusTone, string> = {
  strong: 'text-signal-strong',
  medium: 'text-signal-medium',
  weak: 'text-signal-weak',
  muted: 'text-muted-foreground',
  destructive: 'text-destructive',
}

export function StatusDot({
  tone,
  label,
  className,
}: {
  tone: StatusTone
  label: string
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', TONE_TEXT[tone], className)}>
      <span className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[tone])} />
      {label}
    </span>
  )
}
