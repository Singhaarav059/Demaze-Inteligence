'use client'

// ============================================================
// StepIndicator — clickable progress header for the Auto Flow page
// ============================================================
// Presentational only. Purpose-built for this 5-step flow, not a generic
// components/ui/ Stepper, since this is currently the only consumer. Pills
// for any step already reached are clickable, so clicking one jumps the
// flow back (or forward) to that step so its full content re-expands.
//
// Also renders the flow's one "move forward" control (nextAction), pinned
// here at the top of the page next to the pills so it never depends on how
// far the user has scrolled. The flow never advances a step on its own.
// ============================================================

import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

// Exported so page.tsx can reuse the same labels for its step-change
// screen-reader announcement instead of duplicating this list.
export const STEPS = ['Research', 'Decision Makers', 'Contact Info', 'Outreach', 'Review & Send'] as const

// Matches company-discovery/page.tsx's StepHeader checkmark-morph transition
// exactly, so this pattern feels identical everywhere it appears.
const CHECKMARK_MORPH_TRANSITION = { type: 'spring', stiffness: 500, damping: 30 } as const

export function StepIndicator({
  current,
  maxReached,
  onStepClick,
  nextAction,
}: {
  current: number
  maxReached: number
  onStepClick: (step: number) => void
  nextAction?: { label: string; onClick: () => void; disabled: boolean; loading?: boolean } | null
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <LayoutGroup id="auto-gtm-steps">
        <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Auto Flow steps">
          {STEPS.map((label, i) => {
            const stepNum = i + 1
            const isCurrent = stepNum === current
            const isDone = stepNum < current
            const isReached = stepNum <= maxReached
            return (
              <div key={label} className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!isReached}
                  onClick={() => isReached && onStepClick(stepNum)}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={cn(
                    'relative flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    isReached ? 'cursor-pointer hover:border-primary/60' : 'cursor-not-allowed opacity-50',
                    isCurrent
                      ? 'border-transparent text-primary'
                      : isDone
                      ? 'border-signal-strong/40 bg-signal-strong/10 text-signal-strong'
                      : 'border-border text-muted-foreground/60'
                  )}
                >
                  {/* Sliding active-pill highlight — same LayoutGroup +
                      layoutId + spring pattern as Sidebar.tsx's active-nav
                      indicator, so the highlight glides between steps
                      instead of jumping. */}
                  {isCurrent && (
                    <motion.span
                      layoutId="step-indicator-active-pill"
                      className="absolute inset-0 rounded-full border border-primary bg-primary/10"
                      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'relative flex size-4 items-center justify-center rounded-full text-[10px] overflow-hidden',
                      isCurrent && 'bg-primary text-primary-foreground',
                      isDone && 'bg-signal-strong text-white',
                      !isCurrent && !isDone && 'bg-accent'
                    )}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {isDone ? (
                        <motion.span
                          key="check"
                          initial={{ scale: 0.5, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.5, opacity: 0 }}
                          transition={CHECKMARK_MORPH_TRANSITION}
                        >
                          ✓
                        </motion.span>
                      ) : (
                        <motion.span
                          key={`num-${stepNum}`}
                          initial={{ scale: 0.5, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.5, opacity: 0 }}
                          transition={CHECKMARK_MORPH_TRANSITION}
                        >
                          {stepNum}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </span>
                  <span className="relative">{label}</span>
                  {isDone && <span className="sr-only"> (done)</span>}
                </button>
                {stepNum < STEPS.length && <div className="h-px w-4 bg-border" aria-hidden="true" />}
              </div>
            )
          })}
        </div>
      </LayoutGroup>

      {/* The flow's one primary action — sized up from the small/dense
          buttons used elsewhere in this page (touch-target pass) since
          this is the single most-clicked control in the entire flow.
          Phase C: bumped to size="lg" so it actually reads as the
          dominant CTA it's described as, not just another default button. */}
      {nextAction && (
        <Button size="lg" onClick={nextAction.onClick} disabled={nextAction.disabled}>
          {nextAction.loading ? <Spinner className="size-3.5" /> : null}
          {nextAction.label}
        </Button>
      )}
    </div>
  )
}
