'use client'

// ============================================================
// WizardShell — Research-only result display.
// ============================================================
// Used to cascade through 4 staged sections (Research, Competitors,
// ICP, Find Companies) mirroring Explee's multi-stage choreography.
// Competitors/ICP/Company-Discovery have moved to the separate
// "Discover" workflow (app/admin/company-discovery) — Research now does
// exactly one thing (single-company or batch report), so the staged-reveal
// stepper had nothing left to stage. Simplified to a direct render of the
// one remaining section.
// ============================================================

import type { RunResult } from '@/app/admin/intelligence-lab/_types'
import { Step1Research } from './steps/Step1Research'

export function WizardShell({
  result,
  running,
  error,
}: {
  result: RunResult | null
  running: boolean
  error: string | null
}) {
  const hasAnalysis = Boolean(result?.success && result.analysisResult && !result.parseError)

  if (!result && !running) return null

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {result && !hasAnalysis && !error && result.parseError && (
        <div className="rounded-lg border border-signal-medium/30 bg-signal-medium/10 px-4 py-3 text-sm text-signal-medium">
          Analysis returned but could not be parsed: {result.parseError}
        </div>
      )}

      {hasAnalysis && result && <Step1Research result={result} />}
    </div>
  )
}
