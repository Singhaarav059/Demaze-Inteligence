'use client'

// ============================================================
// StageProgress — honest "still working" indicator for long calls
// ============================================================
// Research and decision-maker discovery are each a single awaited API call
// with no streaming/SSE backend, so there's no real sub-stage signal to
// report — and this app's whole design philosophy (evidence_sufficiency,
// "no forced opportunities") is to never fabricate confidence that doesn't
// exist. So this renders base-ui's genuinely INDETERMINATE progress bar
// (accurate: "working, duration unknown") plus a reassurance label that
// cycles through hedged, plausible-activity text on elapsed-time bands —
// framed as likely current activity, never asserted as fact.
// ============================================================

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Progress, ProgressTrack, ProgressIndicator } from './progress'

export interface ProgressStage {
  label: string
  afterMs: number
}

export function StageProgress({
  active,
  stages,
  className,
}: {
  active: boolean
  stages: ProgressStage[]
  className?: string
}) {
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    if (!active) {
      // Reset for the next activation — this component returns null right
      // below while inactive, so this never causes a visible cascading
      // render; it just avoids a stale elapsed value flashing on reactivation.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setElapsedMs(0)
      return
    }
    const start = Date.now()
    const id = setInterval(() => setElapsedMs(Date.now() - start), 500)
    return () => clearInterval(id)
  }, [active])

  if (!active) return null

  const stage = [...stages].reverse().find((s) => elapsedMs >= s.afterMs) ?? stages[0]

  return (
    <div className={cn('space-y-1.5', className)}>
      <Progress value={null} className="w-full">
        <ProgressTrack>
          <ProgressIndicator className="w-full animate-pulse" />
        </ProgressTrack>
      </Progress>
      <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
        {stage?.label}
      </p>
    </div>
  )
}
