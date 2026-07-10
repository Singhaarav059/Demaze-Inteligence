// ============================================================
// Outreach Intelligence Engine
// ============================================================
// Generates per-role contact cards: KPI, pain, angle,
// opportunity, and Demaze relevance score.
// ============================================================

import type { SynthesisInput, OutreachCard, DemazeRelevanceScore, StrategicTheme } from './types'

// ── Role database ─────────────────────────────────────────────

interface RoleProfile {
  role: string
  likely_kpi: string
  likely_pain: string
  base_angle: string
}

const ROLE_PROFILES: Record<string, RoleProfile> = {
  'COO': {
    role: 'COO',
    likely_kpi: 'Production efficiency, on-time delivery, unit cost reduction',
    likely_pain: 'Limited cross-plant visibility; decisions made on lagging data',
    base_angle: 'Operational Intelligence',
  },
  'CTO': {
    role: 'CTO',
    likely_kpi: 'Digital transformation velocity, tech debt reduction, platform reliability',
    likely_pain: 'Fragmented data systems; no unified intelligence layer across plants',
    base_angle: 'AI & Data Platform',
  },
  'VP Operations': {
    role: 'VP Operations',
    likely_kpi: 'Throughput, OEE, maintenance cost, safety incidents',
    likely_pain: 'Reactive maintenance; limited predictive capability on equipment',
    base_angle: 'Predictive Operations',
  },
  'VP Manufacturing': {
    role: 'VP Manufacturing',
    likely_kpi: 'Production yield, scrap rate, cycle time, capacity utilization',
    likely_pain: 'Manual quality inspection; no real-time production intelligence',
    base_angle: 'Manufacturing Intelligence',
  },
  'Head of Digital': {
    role: 'Head of Digital',
    likely_kpi: 'Digital initiative ROI, adoption rate, time-to-deployment',
    likely_pain: 'AI projects stuck in proof-of-concept; no path to production scale',
    base_angle: 'Applied AI Acceleration',
  },
  'Chief Digital Officer': {
    role: 'Chief Digital Officer',
    likely_kpi: 'Digital revenue contribution, transformation program KPIs',
    likely_pain: 'Slow AI adoption across business units despite investment',
    base_angle: 'Enterprise AI Strategy',
  },
  'VP Supply Chain': {
    role: 'VP Supply Chain',
    likely_kpi: 'Inventory turns, supplier OTD, procurement cost savings',
    likely_pain: 'Supply chain blind spots; reactive to disruptions',
    base_angle: 'Supply Chain Intelligence',
  },
  'VP Engineering': {
    role: 'VP Engineering',
    likely_kpi: 'Engineering efficiency, product quality, design cycle time',
    likely_pain: 'Manual QA processes; engineering data siloed across teams',
    base_angle: 'Engineering Analytics',
  },
  'CFO': {
    role: 'CFO',
    likely_kpi: 'ROI on technology investment, cost per unit, working capital',
    likely_pain: 'Difficulty quantifying ROI on digital transformation spend',
    base_angle: 'ROI-Grounded Analytics',
  },
  'CEO': {
    role: 'CEO',
    likely_kpi: 'Revenue growth, market position, transformation progress',
    likely_pain: 'Competitive pressure from digitally-native manufacturers',
    base_angle: 'Strategic Competitive Intelligence',
  },
  'Plant Manager': {
    role: 'Plant Manager',
    likely_kpi: 'OEE, downtime, throughput, energy consumption',
    likely_pain: 'No unified view of plant health; reactive problem-solving',
    base_angle: 'Plant Intelligence Platform',
  },
  'Head of IT': {
    role: 'Head of IT',
    likely_kpi: 'System uptime, integration cost, data platform scalability',
    likely_pain: 'Legacy system integration; data in silos across OT and IT',
    base_angle: 'IT-OT Integration',
  },
}

// Default profile when role is not in our database
function defaultProfile(role: string): RoleProfile {
  return {
    role,
    likely_kpi: 'Operational excellence, cost reduction, competitive positioning',
    likely_pain: 'Fragmented data; limited real-time visibility across operations',
    base_angle: 'Intelligent Operations',
  }
}

// ── Demaze relevance scoring ──────────────────────────────────

function scoreRelevance(
  opportunity: string,
  themes: StrategicTheme[],
): { score: DemazeRelevanceScore; why: string } {
  const opp = opportunity.toLowerCase()

  // Strong fit: AI, automation, analytics, predictive
  if (/ai|machine learning|predictive|analytics|intelligence|automation/i.test(opp)) {
    const matchingTheme = themes.find(t =>
      ['ai_digital_strategy', 'manufacturing_transformation'].includes(t.id)
    )
    return {
      score: matchingTheme ? 'very_strong' : 'strong',
      why: matchingTheme
        ? `Directly aligned with the company's ${matchingTheme.name} theme.`
        : 'Core Demaze capability with clear manufacturing/automotive application.',
    }
  }

  // Strong fit: supply chain, digital transformation
  if (/supply chain|digital transform|erp|mes|sap|integration/i.test(opp)) {
    return {
      score: 'strong',
      why: 'Aligns with Demaze enterprise integration and transformation capabilities.',
    }
  }

  // Moderate fit: operations, process
  if (/operation|process|efficiency|quality|production/i.test(opp)) {
    return {
      score: 'moderate',
      why: 'Operational improvement opportunity — Demaze can deliver, but requires scoping.',
    }
  }

  return {
    score: 'weak',
    why: 'Opportunity exists but falls outside Demaze core service area.',
  }
}

// ── Main export ───────────────────────────────────────────────

export function buildOutreachCards(
  input: SynthesisInput,
  themes: StrategicTheme[],
): OutreachCard[] {
  const roles = input.analysis.recommended_contact_roles ?? []
  if (roles.length === 0) return []

  // Pick the most relevant opportunity per theme
  const topOpportunity = input.analysis.opportunities?.[0]?.title ?? 'AI-Powered Operations Intelligence'
  const topTheme = themes[0]

  return roles.slice(0, 5).map(role => {
    const profile = ROLE_PROFILES[role] ?? defaultProfile(role)
    const relevance = scoreRelevance(topOpportunity, themes)

    // Customize the message angle using top theme if available
    const angle = topTheme
      ? `${profile.base_angle} — positioned within the company's ${topTheme.name} initiative.`
      : profile.base_angle

    return {
      role: profile.role,
      likely_kpi: profile.likely_kpi,
      likely_pain: profile.likely_pain,
      message_angle: angle,
      relevant_opportunity: topOpportunity,
      demaze_relevance: relevance.score,
      why_relevant: relevance.why,
    }
  })
}
