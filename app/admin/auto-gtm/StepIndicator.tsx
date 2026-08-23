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

import { cn } from '@/lib/utils'
import { IntelStatus, type IntelStatusKind } from '@/components/ui/intel-status'

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

export type StepStatus = 'complete' | 'active' | 'waiting' | 'not_started'

export interface StepMeta {
  status: StepStatus
  /** One real, honest status line — e.g. "2 found", "4 verified". Omit rather than guess. */
  detail?: string
}

function statusToIntelStatus(status: StepStatus): IntelStatusKind {
  if (status === 'complete') return 'complete'
  if (status === 'active') return 'researching'
  return 'not_researched'
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
      className="flex items-stretch gap-0 overflow-x-auto"
      role="group"
      aria-label="Auto Flow progress"
    >
      {STEPS.map((label, i) => {
        const stepNum = i + 1
        const isCurrent = stepNum === current
        const isReached = stepNum <= maxReached
        const isLast = stepNum === STEPS.length
        const m = meta[i] ?? { status: 'not_started' as StepStatus }
        return (
          <li key={label} className="flex shrink-0 items-stretch">
            <button
              type="button"
              disabled={!isReached}
              onClick={() => isReached && onStepClick(stepNum)}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'flex min-w-[104px] flex-col items-start gap-0.5 rounded-md px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                isCurrent && 'bg-primary/10',
                isReached ? 'cursor-pointer hover:bg-accent/40' : 'cursor-not-allowed opacity-50'
              )}
            >
              <IntelStatus
                status={statusToIntelStatus(m.status)}
                label={label}
                className={cn('text-[10px] font-semibold uppercase tracking-wide', isCurrent ? '' : m.status === 'not_started' ? 'opacity-70' : '')}
              />
              <span className="pl-3 text-[11px] text-muted-foreground/70">{m.detail ?? defaultDetail(m.status)}</span>
            </button>
            {!isLast && <div className="mx-1 my-auto h-px w-3 shrink-0 bg-border" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}
