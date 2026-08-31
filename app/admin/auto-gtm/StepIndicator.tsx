'use client'

// ============================================================
// StepIndicator - compact progress strip for the Auto Flow page
// ============================================================
// Presentational only. Purpose-built for this 6-step flow (restructured
// 2026-08-12 from 5 steps - the old merged "Outreach & Send" step split
// into "Campaign & Outreach" (drafting + campaign settings, no send) and
// "Review & Send" (final counts/preview, the one send action) - see
// OutreachStep.tsx and ReviewSendStep.tsx's own headers. A "Sales Strategy"
// step was briefly inserted after Research on 2026-08-13, then removed the
// same week per a corrected product direction: Auto Flow is a narrow
// outbound workflow, not a place to encode unapproved sales rules - see
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
// generic form wizard) with a slim, dense strip - a status dot
// (IntelStatus's own color language) + step label + a one-line real status
// detail per step ("2 found", "Draft ready", "Waiting"...), so the strip
// itself answers "where am I / what's done / what's next" without a giant
// visual footprint. Every `meta[i]` value is computed by page.tsx from real
// flow state (contact counts, drafting-settled signal, send outcomes) -
// this component only renders whatever it's given, it never invents a
// count. The "move forward" control (nextAction) moved out of this
// component entirely, into page.tsx's own "Next Best Action" panel - this
// component is now pure progress display.
// ============================================================

import { Search, Users, Mail, ClipboardCheck, Clock, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

// Exported so page.tsx can reuse the same labels for its step-change
// screen-reader announcement instead of duplicating this list. Kept 1:1
// with the real 6-step flow state (useAutoGtmFlow's flow.step) - the
// underlying automation is unchanged, this is display text only.
export const STEPS = [
  'Company',
  'People',
  'Contact',
  'Message',
  'Send',
  'Follow-up',
] as const

// Visual grouping only (2026-08-31 UX restructuring): the flow still has 6
// real steps (contact-info lookup is its own step because it's a separate
// async lookup with its own settle signal - see page.tsx's step 3->4
// effect), but showing it as a 6th top-level stage asks a non-technical
// user to track a distinction ("People" vs "Contact") that isn't a
// decision they make - it happens automatically. Grouped into the 5 stages
// a user actually thinks in: Company -> People (+ finding their contact
// info) -> Message -> Send -> Follow-up. Clicking a merged pill jumps to
// its first underlying step, same as before. `meta` passed in from
// page.tsx is still the full 6-length array - grouping/aggregating it
// happens only here, so page.tsx's real step-transition logic never
// changes.
const DISPLAY_GROUPS = [
  { label: 'Company', steps: [1], icon: Search },
  { label: 'People', steps: [2, 3], icon: Users },
  { label: 'Message', steps: [4], icon: Mail },
  { label: 'Send', steps: [5], icon: ClipboardCheck },
  { label: 'Follow-up', steps: [6], icon: Clock },
] as const

export type StepStatus = 'complete' | 'active' | 'waiting' | 'not_started'

export interface StepMeta {
  status: StepStatus
  /** One real, honest status line - e.g. "2 found", "4 verified". Omit rather than guess. */
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
      aria-label="Work progress"
    >
      {DISPLAY_GROUPS.map((group, gi) => {
        const firstStep = group.steps[0]
        const isCurrent = (group.steps as readonly number[]).includes(current)
        const isReached = firstStep <= maxReached
        const groupMeta = group.steps.map(s => meta[s - 1] ?? { status: 'not_started' as StepStatus })
        const isComplete = groupMeta.every(m => m.status === 'complete')
        // The active sub-step's detail if one's in flight, else whichever
        // group member has a real detail to show (last one wins - the
        // furthest-along sub-step is the most relevant to report).
        const activeMeta = groupMeta.find(m => m.status === 'active')
        const detailMeta = activeMeta ?? [...groupMeta].reverse().find(m => m.detail) ?? groupMeta[groupMeta.length - 1]
        const status: StepStatus = isComplete ? 'complete' : activeMeta ? 'active' : groupMeta[0].status
        const isLast = gi === DISPLAY_GROUPS.length - 1
        const Icon = group.icon
        return (
          <li key={group.label} className="flex shrink-0 flex-1 items-start">
            <button
              type="button"
              disabled={!isReached}
              onClick={() => isReached && onStepClick(firstStep)}
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
                {group.label}
              </span>
              <span className="text-[10px] text-muted-foreground/60">{detailMeta.detail ?? defaultDetail(status)}</span>
            </button>
            {!isLast && <div className="mt-[18px] h-px flex-1 shrink-0 bg-border" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}
