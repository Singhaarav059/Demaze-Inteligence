// ============================================================
// Synthesis Orchestrator — V3.4
// ============================================================
// Runs all synthesis engines in sequence.
// Input: already-collected evidence (NormalizedAnalysis + enrichment)
// Output: SynthesisResult — no new data fetched here.
// ============================================================

import type { SynthesisInput, SynthesisResult } from './types'
import { buildValidatedSignals } from './validator'
import { buildStrategicThemes } from './theme-engine'
import { buildWhyNow } from './why-now-engine'
import { computeIntelligenceQuality } from './quality-score'

export type { SynthesisInput, SynthesisResult } from './types'
export type {
  ValidatedSignal,
  StrategicTheme,
  WhyNowAnalysis,
  IntelligenceQuality,
  PriorityLevel,
  ConfidenceLevel,
  UrgencyLevel,
} from './types'

export function synthesizeIntelligence(input: SynthesisInput): SynthesisResult {
  // 1. Validate signals across sources
  const validatedSignals = buildValidatedSignals(input)

  // 2. Cluster into strategic themes
  const strategicThemes = buildStrategicThemes(validatedSignals, input)

  // 3. Build Why Now analysis
  const whyNow = buildWhyNow(input)

  // 4. Compute intelligence quality score
  const intelligenceQuality = computeIntelligenceQuality(input, validatedSignals, strategicThemes)

  return {
    validatedSignals,
    strategicThemes,
    whyNow,
    intelligenceQuality,
    synthesizedAt: new Date().toISOString(),
  }
}
