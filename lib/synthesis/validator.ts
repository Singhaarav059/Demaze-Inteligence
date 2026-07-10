// ============================================================
// Multi-Source Validation Engine
// ============================================================
// Cross-references LLM evidence items with enriched signals
// to compute deterministic confidence per signal type.
//
// Confidence rules:
//   1 unique source type → Low     (0-39)
//   2 unique source types → Medium  (40-59)
//   3 unique source types → High    (60-79)
//   4+ unique source types → Very High (80-100)
// ============================================================

import type { SynthesisInput, ValidatedSignal, ValidatedSignalEvidence, ConfidenceLevel } from './types'

// Human-readable signal names
const SIGNAL_NAMES: Record<string, string> = {
  ai_mention:                'AI Adoption Signal',
  automation_keywords:       'Automation & Robotics',
  capacity_expansion:        'Capacity Expansion',
  digital_transformation:    'Digital Transformation',
  hiring_signal:             'Strategic Hiring',
  multi_location_operations: 'Multi-Site Operations',
  recent_news_or_event:      'Recent Strategic Event',
  industry40_initiative:     'Industry 4.0 Initiative',
  financial_indicator:       'Financial Investment Signal',
  supply_chain_signal:       'Supply Chain Initiative',
}

// Source type → human label
function srcLabel(type: string): string {
  const m: Record<string, string> = {
    annual_report:          'Annual Report',
    investor_presentation:  'Investor Presentation',
    earnings_release:       'Earnings Release',
    press_release:          'Press Release',
    careers_page:           'Careers Page',
    ceo_interview:          'CEO Interview',
    official_blog:          'Official Blog',
    news_article:           'News Article',
    sustainability_report:  'Sustainability Report',
    llm_evidence:           'Website Analysis',
  }
  return m[type] ?? type
}

function scoreToConfidence(score: number): ConfidenceLevel {
  if (score >= 80) return 'very_high'
  if (score >= 60) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

function sourceCountToScore(count: number): number {
  if (count >= 4) return 90
  if (count === 3) return 75
  if (count === 2) return 55
  return 30
}

export function buildValidatedSignals(input: SynthesisInput): ValidatedSignal[] {
  const { analysis, enrichedSignals } = input

  // Collect all evidence by signal type
  const signalMap = new Map<string, ValidatedSignalEvidence[]>()

  // ── Layer 1: LLM evidence items ────────────────────────────
  for (const ev of analysis.evidence) {
    const type = ev.category  // ai_mention | automation_keywords | etc.
    if (!type) continue
    if (!signalMap.has(type)) signalMap.set(type, [])
    signalMap.get(type)!.push({
      quote: ev.quote?.slice(0, 200) ?? '',
      source_type: 'llm_evidence',
      source_label: 'Website Analysis',
      url: ev.source_page,
    })
  }

  // ── Layer 2: LLM signals array ─────────────────────────────
  for (const sig of analysis.signals) {
    const type = sig.type
    if (!type) continue
    if (!signalMap.has(type)) signalMap.set(type, [])
    // Only add if not already covered by evidence
    const existing = signalMap.get(type)!
    const alreadyHasWebsite = existing.some(e => e.source_type === 'llm_evidence')
    if (!alreadyHasWebsite) {
      existing.push({
        quote: sig.evidence?.slice(0, 200) ?? '',
        source_type: 'llm_evidence',
        source_label: 'Website Analysis',
      })
    }
  }

  // ── Layer 3: Enriched signals from recovery pipeline ───────
  for (const es of enrichedSignals) {
    const type = es.type
    if (!type) continue
    if (!signalMap.has(type)) signalMap.set(type, [])
    signalMap.get(type)!.push({
      quote: es.quote?.slice(0, 200) ?? '',
      source_type: es.source_type ?? 'other',
      source_label: srcLabel(es.source_type ?? 'other'),
      url: es.source,
    })
  }

  // ── Build ValidatedSignal per type ─────────────────────────
  const results: ValidatedSignal[] = []

  for (const [signalType, evidenceItems] of signalMap) {
    // Count unique source types
    const uniqueSourceTypes = [...new Set(evidenceItems.map(e => e.source_type))]
    const sourceCount = uniqueSourceTypes.length
    const validationScore = sourceCountToScore(sourceCount)
    const confidenceLevel = scoreToConfidence(validationScore)

    // Deduplicate evidence by source_type (keep best quote per type)
    const seenTypes = new Set<string>()
    const dedupedEvidence: ValidatedSignalEvidence[] = []
    for (const ev of evidenceItems) {
      if (!seenTypes.has(ev.source_type)) {
        seenTypes.add(ev.source_type)
        dedupedEvidence.push(ev)
      }
    }

    results.push({
      id: `vs_${signalType}`,
      name: SIGNAL_NAMES[signalType] ?? signalType.replace(/_/g, ' '),
      signal_type: signalType,
      supportingEvidence: dedupedEvidence.slice(0, 4),
      supportingSourceTypes: uniqueSourceTypes,
      sourceCount,
      validationScore,
      confidenceLevel,
    })
  }

  // Sort: highest validation score first
  results.sort((a, b) => b.validationScore - a.validationScore)
  return results
}
