// ============================================================
// Strategic Theme Synthesis Engine
// ============================================================
// Clusters validated signals into StrategicThemes.
// Themes are the primary reasoning layer — opportunities
// should originate from themes, not isolated signals.
//
// Priority scoring:
//   Tier-1 evidence + leadership mention → Critical
//   Tier-2 evidence + 3+ signals → Important
//   Single-tier or weak signals → Secondary
// ============================================================

import type { ValidatedSignal, StrategicTheme, PriorityLevel, ConfidenceLevel, ValidatedSignalEvidence } from './types'
import type { SynthesisInput } from './types'

// ── Theme definitions ─────────────────────────────────────────
// Each theme has: trigger signals, name, tagline, business impact, Demaze angle

interface ThemeDefinition {
  id: string
  name: string
  tagline: string
  triggerSignals: string[]        // any of these signals activates the theme
  requiredSignalCount: number     // min signals needed to form this theme
  businessImpact: string
  demazeAngle: string
}

const THEME_DEFINITIONS: ThemeDefinition[] = [
  {
    id: 'manufacturing_transformation',
    name: 'Manufacturing Transformation',
    tagline: 'Operational modernization across production, automation, and plant intelligence',
    triggerSignals: ['capacity_expansion', 'automation_keywords', 'industry40_initiative', 'hiring_signal', 'digital_transformation'],
    requiredSignalCount: 2,
    businessImpact: 'Company is scaling or modernizing manufacturing operations, creating demand for intelligence, automation, and process optimization solutions.',
    demazeAngle: 'Plant intelligence, production analytics, and predictive maintenance positioned as enablers of the transformation initiative.',
  },
  {
    id: 'ai_digital_strategy',
    name: 'AI & Digital Strategy',
    tagline: 'Active investment in AI, data, and digital infrastructure',
    triggerSignals: ['ai_mention', 'digital_transformation', 'hiring_signal', 'industry40_initiative'],
    requiredSignalCount: 2,
    businessImpact: 'Company has committed to AI/digital investment at a strategic level, signaling budget allocation and executive sponsorship.',
    demazeAngle: 'AI implementation support, data platform buildout, and applied AI for manufacturing/automotive use cases.',
  },
  {
    id: 'enterprise_scaling',
    name: 'Enterprise Scaling',
    tagline: 'Multi-site expansion with increasing operational complexity',
    triggerSignals: ['capacity_expansion', 'multi_location_operations', 'recent_news_or_event', 'financial_indicator'],
    requiredSignalCount: 2,
    businessImpact: 'Growth across geographies or facilities creates coordination, visibility, and standardization challenges at scale.',
    demazeAngle: 'Cross-plant analytics, enterprise dashboards, and unified data infrastructure to manage distributed operations.',
  },
  {
    id: 'supply_chain_intelligence',
    name: 'Supply Chain Intelligence',
    tagline: 'Procurement, logistics, and vendor network under pressure',
    triggerSignals: ['supply_chain_signal', 'multi_location_operations', 'automation_keywords', 'digital_transformation'],
    requiredSignalCount: 2,
    businessImpact: 'Supply chain complexity demands real-time visibility, predictive procurement, and supplier risk management.',
    demazeAngle: 'Supply chain analytics, demand sensing, and vendor intelligence platforms.',
  },
  {
    id: 'talent_technology_buildout',
    name: 'Talent & Technology Buildout',
    tagline: 'Aggressive hiring in engineering, data, and digital roles',
    triggerSignals: ['hiring_signal', 'ai_mention', 'digital_transformation'],
    requiredSignalCount: 2,
    businessImpact: 'High hiring volume in technical roles indicates internal capability buildout — company is investing in the people to execute transformation.',
    demazeAngle: 'Advisory, integration, and acceleration services alongside internal team buildout.',
  },
  {
    id: 'strategic_event_response',
    name: 'Strategic Event Response',
    tagline: 'Recent news or leadership event creating organizational urgency',
    triggerSignals: ['recent_news_or_event', 'hiring_signal', 'capacity_expansion'],
    requiredSignalCount: 2,
    businessImpact: 'Merger, acquisition, leadership change, or expansion announcement typically creates a 6–18 month window of receptivity to new solutions.',
    demazeAngle: 'Position as strategic partner during transition — integration analytics, visibility tooling, or capability acceleration.',
  },
]

// ── Priority scoring ──────────────────────────────────────────

function computePriorityScore(
  theme: ThemeDefinition,
  matchedSignals: ValidatedSignal[],
): number {
  let score = 0

  // Signal count factor (max 40pts)
  score += Math.min(40, matchedSignals.length * 10)

  // Confidence factor (max 40pts)
  const topConf = matchedSignals[0]?.validationScore ?? 0
  score += Math.round(topConf * 0.4)

  // Any very_high validation = bonus (max 20pts)
  const hasVeryHigh = matchedSignals.some(s => s.confidenceLevel === 'very_high')
  const hasHigh = matchedSignals.some(s => s.confidenceLevel === 'high')
  if (hasVeryHigh) score += 20
  else if (hasHigh) score += 10

  return Math.min(100, score)
}

function scoreToPriority(score: number): PriorityLevel {
  if (score >= 70) return 'critical'
  if (score >= 45) return 'important'
  return 'secondary'
}

function signalsToConfidence(signals: ValidatedSignal[]): ConfidenceLevel {
  const maxScore = Math.max(...signals.map(s => s.validationScore), 0)
  if (maxScore >= 80) return 'very_high'
  if (maxScore >= 60) return 'high'
  if (maxScore >= 40) return 'medium'
  return 'low'
}

// ── Main export ───────────────────────────────────────────────

export function buildStrategicThemes(
  validatedSignals: ValidatedSignal[],
  _input: SynthesisInput,
): StrategicTheme[] {
  const activeSignalTypes = new Set(validatedSignals.map(s => s.signal_type))
  const signalByType = new Map(validatedSignals.map(s => [s.signal_type, s]))

  const themes: StrategicTheme[] = []

  for (const def of THEME_DEFINITIONS) {
    // Which trigger signals are active?
    const matchedSignals = def.triggerSignals
      .filter(t => activeSignalTypes.has(t))
      .map(t => signalByType.get(t)!)
      .filter(Boolean)
      .sort((a, b) => b.validationScore - a.validationScore)

    if (matchedSignals.length < def.requiredSignalCount) continue

    // Collect supporting evidence from matched signals
    const allEvidence: ValidatedSignalEvidence[] = []
    const seenQuotes = new Set<string>()
    for (const sig of matchedSignals) {
      for (const ev of sig.supportingEvidence) {
        if (!seenQuotes.has(ev.quote)) {
          seenQuotes.add(ev.quote)
          allEvidence.push(ev)
        }
      }
    }

    const priorityScore = computePriorityScore(def, matchedSignals)

    themes.push({
      id: def.id,
      name: def.name,
      tagline: def.tagline,
      signals: matchedSignals,
      signalTypes: matchedSignals.map(s => s.signal_type),
      supportingEvidence: allEvidence.slice(0, 6),
      confidence: signalsToConfidence(matchedSignals),
      businessImpact: def.businessImpact,
      priority: scoreToPriority(priorityScore),
      priorityScore,
      demazeAngle: def.demazeAngle,
    })
  }

  // Sort: critical first, then by priorityScore
  themes.sort((a, b) => {
    const order: Record<PriorityLevel, number> = { critical: 0, important: 1, secondary: 2 }
    if (order[a.priority] !== order[b.priority]) return order[a.priority] - order[b.priority]
    return b.priorityScore - a.priorityScore
  })

  return themes
}
