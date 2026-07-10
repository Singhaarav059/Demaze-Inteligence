// ============================================================
// Why Now Engine
// ============================================================
// Produces evidence-grounded urgency analysis.
// Every statement must cite actual evidence — no generic
// consulting language, no assumptions.
//
// Urgency scoring:
//   Expansion + Hiring + Investment = Immediate
//   Hiring or Investment alone = Near Term
//   Digital mention only = Emerging
// ============================================================

import type { SynthesisInput, WhyNowAnalysis, WhyNowTrigger, UrgencyLevel } from './types'

// Signal types that contribute to urgency (ordered by weight)
const URGENCY_WEIGHTS: Record<string, number> = {
  capacity_expansion:       35,
  recent_news_or_event:     30,
  financial_indicator:      25,
  hiring_signal:            20,
  ai_mention:               15,
  industry40_initiative:    15,
  automation_keywords:      10,
  digital_transformation:   10,
  supply_chain_signal:       8,
  multi_location_operations: 5,
}

// Urgency signal → narrative template
const TRIGGER_TEMPLATES: Record<string, string> = {
  capacity_expansion:       'actively expanding production capacity or opening new facilities',
  recent_news_or_event:     'undergoing a significant strategic event (acquisition, partnership, or leadership change)',
  financial_indicator:      'signalling capital allocation toward operational transformation',
  hiring_signal:            'aggressively hiring engineers and digital/AI talent',
  ai_mention:               'publicly committing to AI investment at a strategic level',
  industry40_initiative:    'executing an Industry 4.0 or smart manufacturing program',
  automation_keywords:      'investing in automation and robotics across operations',
  digital_transformation:   'undergoing active digital transformation',
  supply_chain_signal:      'restructuring or modernising their supply chain',
  multi_location_operations:'managing increasing complexity across multiple sites',
}

function scoreToUrgency(score: number): UrgencyLevel {
  if (score >= 60) return 'immediate'
  if (score >= 35) return 'near_term'
  return 'emerging'
}

function buildNarrative(
  company: string,
  triggers: WhyNowTrigger[],
  urgency: UrgencyLevel,
): string {
  if (triggers.length === 0) {
    return `${company} shows early-stage signals that may indicate openness to new solutions, though evidence is limited.`
  }

  const topTriggers = triggers.slice(0, 3)
  const descriptions = topTriggers.map(t => TRIGGER_TEMPLATES[t.signal_type] ?? t.signal_type)

  // Build sentences from actual evidence quotes
  const evidenceSentences = topTriggers
    .filter(t => t.evidence_quote && t.evidence_quote.length > 20)
    .slice(0, 2)
    .map(t => `"${t.evidence_quote.slice(0, 120)}" (${t.source_label})`)

  let narrative = `${company} is ${descriptions.join(', and ')}. `

  if (evidenceSentences.length > 0) {
    narrative += `Evidence supporting this includes: ${evidenceSentences.join('; ')}. `
  }

  const urgencyPhrase = urgency === 'immediate'
    ? 'This convergence of signals suggests an active transformation window — outreach now is likely to reach decision-makers mid-initiative, when external solutions are most considered.'
    : urgency === 'near_term'
    ? 'These signals indicate a building initiative. Outreach in the near term positions Demaze ahead of competitive conversations.'
    : 'While signals are early, this company is showing the foundational indicators that typically precede larger transformation investments.'

  narrative += urgencyPhrase

  return narrative
}

export function buildWhyNow(input: SynthesisInput): WhyNowAnalysis {
  const { analysis, enrichedSignals } = input
  const company = analysis.company_name || 'This company'

  // Collect triggers from LLM signals + enriched signals
  const triggerMap = new Map<string, WhyNowTrigger>()

  // From LLM signals
  for (const sig of analysis.signals) {
    const weight = URGENCY_WEIGHTS[sig.type] ?? 0
    if (weight === 0) continue
    if (!triggerMap.has(sig.type)) {
      triggerMap.set(sig.type, {
        signal_type: sig.type,
        evidence_quote: sig.evidence?.slice(0, 150) ?? '',
        source_label: 'Website Analysis',
        source_type: 'llm_evidence',
        urgency_contribution: weight,
      })
    }
  }

  // From enriched signals (override if higher-tier evidence for same signal)
  for (const es of enrichedSignals) {
    const weight = URGENCY_WEIGHTS[es.type] ?? 0
    if (weight === 0) continue
    const existing = triggerMap.get(es.type)
    const isHigherTier = es.source_tier === 'tier1' || (es.source_tier === 'tier2' && existing?.source_type === 'llm_evidence')
    if (!existing || isHigherTier) {
      triggerMap.set(es.type, {
        signal_type: es.type,
        evidence_quote: es.quote?.slice(0, 150) ?? '',
        source_label: es.source_type ? es.source_type.replace(/_/g, ' ') : 'External Source',
        source_type: es.source_type ?? 'other',
        urgency_contribution: weight + (es.source_tier === 'tier1' ? 10 : 0),
      })
    }
  }

  const triggers = Array.from(triggerMap.values())
    .sort((a, b) => b.urgency_contribution - a.urgency_contribution)

  // Compute urgency score (sum of top-3 trigger weights, max 100)
  const urgencyScore = Math.min(100, triggers.slice(0, 4).reduce((s, t) => s + t.urgency_contribution, 0))
  const urgency = scoreToUrgency(urgencyScore)

  // Detect genericity: if no evidence quotes, flag it
  const hasConcreteEvidence = triggers.some(t => t.evidence_quote.length > 30)

  const headline = triggers.length > 0
    ? `${company} is in an active transformation window: ${triggers.slice(0, 2).map(t => TRIGGER_TEMPLATES[t.signal_type] ?? t.signal_type).join(' and ')}.`
    : `${company} shows signals of potential transformation interest.`

  return {
    headline,
    triggers,
    urgency,
    urgencyScore,
    narrative: buildNarrative(company, triggers, urgency),
    genericityFlag: !hasConcreteEvidence,
  }
}
