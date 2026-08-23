'use client'

// ============================================================
// StepIndicator — compact progress strip for the Auto Flow page
// ============================================================
// Presentational only. Purpose-built for this 6-step flow (restructured
// 2026-08-12 from 5 steps — the old merged "Outreach & Send" step split
// into "Campaign & Outreach" (drafting + campaign settings, no send) and
// "Review & Send" (final counts/preview, the one send action) — see
// OutreachStep.tsx and ReviewSendStep.tsx's own headers. A "Sales Strategy"
// step was briefly inserted after Research on 2026-08-13, then removed the
// same week per a corrected product direction: Auto Flow is a narrow
// outbound workflow, not a place to encode unapproved sales rules — see
// CLAUDE.md's Sales Intelligence section for the full history. The
// underlying Sales Knowledge/Sales Intelligence infrastructure this step
// used still exists for future use, it's just not wired into this flow
// anymore), not a generic components/ui/ Stepper, since this is currently
// the only consumer. Steps already reached are clickable, so clicking one
// jumps the flow back (or forward) to that step so its full content
// re-expands.
//
// REDESIGNED (intelligence-workspace pass): replaced the old giant
// numbered-circle/pill stepper (which dominated the screen and read as a
// generic form wizard) with a slim, dense strip — a status dot
// (IntelStatus's own color language) + step label + a one-line real status
// detail per step ("2 found", "Draft ready", "Waiting"...), so the strip
// itself answers "where am I / what's done / what's next" without a giant
// visual footprint. Every `meta[i]` value is computed by page.tsx from real
// flow state (contact counts, drafting-settled signal, send outcomes) —
// this component only renders whatever it's given, it never invents a
// count. The "move forward" control (nextAction) moved out of this
// component entirely, into page.tsx's own "Next Best Action" panel — this
// component is now pure progress display.
// ============================================================

import { Search, Users, IdCard, Mail, ClipboardCheck, Clock, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

// Exported so page.tsx can reuse the same labels for its step-change
// screen-reader announcement instead of duplicating this list.
export const STEPS = [
  'Research',
  'Decision Makers',
  'Contact Info',
  'Campaign & Outreach',
  'Review & Send',
  'Track & Follow Up',
] as const

const STEP_ICONS = [Search, Users, IdCard, Mail, ClipboardCheck, Clock] as const

export type StepStatus = 'complete' | 'active' | 'waiting' | 'not_started'

export interface StepMeta {
  status: StepStatus
  /** One real, honest status line — e.g. "2 found", "4 verified". Omit rather than guess. */
  detail?: string
}

function defaultDetail(status: StepStatus): string {
  if (status === 'complete') return 'Complete'
  if (status === 'active') return 'In progress'
  if (status === 'waiting') return 'Waiting'
  return 'Not started'
}

export function StepIndicator({
  current,
  maxReached,
  meta,
  onStepClick,
}: {
  current: number
  maxReached: number
  meta: StepMeta[]
  onStepClick: (step: number) => void
}) {
  return (
    <ol
      className="flex items-start gap-0 overflow-x-auto"
      role="group"
      aria-label="Auto Flow progress"
    >
      {STEPS.map((label, i) => {
        const stepNum = i + 1
        const isCurrent = stepNum === current
        const isReached = stepNum <= maxReached
        const isComplete = meta[i]?.status === 'complete'
        const isLast = stepNum === STEPS.length
        const Icon = STEP_ICONS[i]
        const m = meta[i] ?? { status: 'not_started' as StepStatus }
        return (
          <li key={label} className="flex shrink-0 flex-1 items-start">
            <button
              type="button"
              disabled={!isReached}
              onClick={() => isReached && onStepClick(stepNum)}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'flex min-w-[104px] flex-col items-center gap-1.5 rounded-md px-1.5 py-1 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                isReached ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
              )}
            >
              <span
                className={cn(
                  'grid size-9 shrink-0 place-items-center rounded-full border transition-colors',
                  isCurrent && 'border-primary bg-primary text-primary-foreground shadow-[0_0_0_4px_var(--primary)]/10',
                  !isCurrent && isComplete && 'border-primary/40 bg-primary/15 text-primary',
                  !isCurrent && !isComplete && isReached && 'border-border-strong bg-card text-muted-foreground group-hover:text-foreground',
                  !isCurrent && !isComplete && !isReached && 'border-border bg-transparent text-muted-foreground/50'
                )}
                style={isCurrent ? { boxShadow: '0 0 0 4px color-mix(in oklab, var(--primary) 15%, transparent)' } : undefined}
              >
                {isComplete && !isCurrent ? <Check className="size-4" /> : <Icon className="size-4" />}
              </span>
              <span className={cn('text-[11px] font-medium leading-tight', isCurrent ? 'text-foreground' : 'text-muted-foreground')}>
                {label}
              </span>
              <span className="text-[10px] text-muted-foreground/60">{m.detail ?? defaultDetail(m.status)}</span>
            </button>
            {!isLast && <div className="mt-[18px] h-px flex-1 shrink-0 bg-border" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}
