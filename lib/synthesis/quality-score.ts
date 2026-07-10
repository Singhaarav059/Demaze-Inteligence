// ============================================================
// Intelligence Quality Score
// ============================================================
// Deterministic quality metrics across 5 dimensions.
// No LLM involvement — all computed from collected data.
// ============================================================

import type { SynthesisInput, IntelligenceQuality, IntelligenceQualityDimension } from './types'
import type { ValidatedSignal, StrategicTheme } from './types'

function dim(label: string, score: number, note: string): IntelligenceQualityDimension {
  return { label, score: Math.round(Math.min(100, Math.max(0, score))), note }
}

function overallLabel(score: number): string {
  if (score >= 80) return 'Excellent'
  if (score >= 65) return 'Good'
  if (score >= 45) return 'Fair'
  return 'Limited'
}

function overallTier(score: number): 'A' | 'B' | 'C' | 'D' {
  if (score >= 80) return 'A'
  if (score >= 65) return 'B'
  if (score >= 45) return 'C'
  return 'D'
}

export function computeIntelligenceQuality(
  input: SynthesisInput,
  validatedSignals: ValidatedSignal[],
  themes: StrategicTheme[],
): IntelligenceQuality {
  const { analysis, enrichedSignals, sourcesUsed } = input

  // ── 1. Data Coverage (how much we collected) ───────────────
  const pageCount = analysis.evidence?.length ?? 0
  const enrichedCount = enrichedSignals.length
  const fetchedSources = sourcesUsed.filter(s => s.should_fetch).length

  let coverageScore = 0
  coverageScore += Math.min(40, pageCount * 4)           // up to 40pts for 10+ evidence items
  coverageScore += Math.min(30, enrichedCount * 6)        // up to 30pts for 5+ enriched signals
  coverageScore += Math.min(30, fetchedSources * 10)      // up to 30pts for 3+ external sources

  const dataCoverage = dim(
    'Data Coverage',
    coverageScore,
    `${pageCount} evidence items, ${enrichedCount} enriched signals, ${fetchedSources} external sources fetched.`,
  )

  // ── 2. Evidence Strength (quality of what we collected) ────
  const tierCounts = { tier1: 0, tier2: 0, tier3: 0 }
  for (const es of enrichedSignals) {
    if (es.source_tier === 'tier1') tierCounts.tier1++
    else if (es.source_tier === 'tier2') tierCounts.tier2++
    else tierCounts.tier3++
  }
  for (const src of sourcesUsed.filter(s => s.should_fetch)) {
    if (['annual_report', 'investor_presentation', 'earnings_release'].includes(src.source_type)) tierCounts.tier1++
    else if (['press_release', 'careers_page', 'ceo_interview'].includes(src.source_type)) tierCounts.tier2++
  }

  const strengthScore = Math.min(100,
    tierCounts.tier1 * 25 + tierCounts.tier2 * 10 + tierCounts.tier3 * 3
  )
  const evidenceStrength = dim(
    'Evidence Strength',
    strengthScore,
    `Tier 1 (investor-grade): ${tierCounts.tier1}, Tier 2 (press/careers): ${tierCounts.tier2}, Tier 3 (web): ${tierCounts.tier3}.`,
  )

  // ── 3. Validation Strength (cross-source agreement) ────────
  const multiSourceSignals = validatedSignals.filter(s => s.sourceCount >= 2)
  const veryHighSignals = validatedSignals.filter(s => s.confidenceLevel === 'very_high')

  let validationScore = 0
  validationScore += Math.min(50, multiSourceSignals.length * 15)
  validationScore += Math.min(50, veryHighSignals.length * 25)

  const validationStrength = dim(
    'Validation Strength',
    validationScore,
    `${multiSourceSignals.length} signals validated across 2+ sources. ${veryHighSignals.length} at Very High confidence.`,
  )

  // ── 4. Signal Confidence (how strong are the signals) ──────
  const avgValidation = validatedSignals.length > 0
    ? validatedSignals.reduce((s, v) => s + v.validationScore, 0) / validatedSignals.length
    : 0

  const signalConfidence = dim(
    'Signal Confidence',
    avgValidation,
    `${validatedSignals.length} total signals detected. Average validation score: ${Math.round(avgValidation)}/100.`,
  )

  // ── 5. Opportunity Confidence ───────────────────────────────
  const criticalThemes = themes.filter(t => t.priority === 'critical')
  const importantThemes = themes.filter(t => t.priority === 'important')
  const oppScore = Math.min(100, criticalThemes.length * 40 + importantThemes.length * 20)

  const opportunityConfidence = dim(
    'Opportunity Confidence',
    oppScore,
    `${criticalThemes.length} critical themes, ${importantThemes.length} important themes identified.`,
  )

  // ── Overall (weighted average) ─────────────────────────────
  const overall = Math.round(
    dataCoverage.score * 0.20 +
    evidenceStrength.score * 0.25 +
    validationStrength.score * 0.25 +
    signalConfidence.score * 0.15 +
    opportunityConfidence.score * 0.15
  )

  return {
    data_coverage: dataCoverage,
    evidence_strength: evidenceStrength,
    validation_strength: validationStrength,
    signal_confidence: signalConfidence,
    opportunity_confidence: opportunityConfidence,
    overall,
    overall_label: overallLabel(overall),
    tier: overallTier(overall),
  }
}
