import { cn } from '@/lib/utils'

// ============================================================
// IntelStatus — one consistent status vocabulary used everywhere a
// company/contact/campaign's research or send state is shown, instead
// of ad hoc colored pills per page. Subtle dot + label, not a loud badge.
// ============================================================

export type IntelStatusKind =
  | 'not_researched'
  | 'researching'
  | 'complete'
  | 'failed'
  | 'needs_review'
  | 'already_researched'

const STATUS: Record<IntelStatusKind, { label: string; dot: string; text: string; pulse?: boolean }> = {
  not_researched: { label: 'Not researched', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
  researching: { label: 'Researching', dot: 'bg-signal-medium', text: 'text-signal-medium', pulse: true },
  complete: { label: 'Research complete', dot: 'bg-signal-strong', text: 'text-signal-strong' },
  failed: { label: 'Research failed', dot: 'bg-destructive', text: 'text-destructive' },
  needs_review: { label: 'Needs review', dot: 'bg-signal-weak', text: 'text-signal-weak' },
  already_researched: { label: 'Already researched', dot: 'bg-muted-foreground/60', text: 'text-muted-foreground' },
}

export function IntelStatus({
  status,
  label,
  className,
}: {
  status: IntelStatusKind
  /** Override the default label (e.g. "Researched 3d ago") while keeping the status color/dot. */
  label?: string
  className?: string
}) {
  const s = STATUS[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', s.text, className)}>
      <span className={cn('relative size-1.5 shrink-0 rounded-full', s.dot)}>
        {s.pulse && <span className={cn('absolute inset-0 animate-ping rounded-full', s.dot)} />}
      </span>
      {label ?? s.label}
    </span>
  )
}
