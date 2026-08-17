// ============================================================
// Decision-maker role recommendation — from research, not a new AI call
// ============================================================
// Spec ask: recommend WHICH titles to search for based on what the
// research actually found (operational pain -> Ops titles, tech pain ->
// CTO/CIO, sales/marketing pain -> CRO/VP Sales), and show why. This is
// pure keyword pattern-matching over already-computed pipeline output
// (getOpportunities/getPainPointsStructured/getOutreachIntelligence, the
// same getters lib/outbound/generation/assemble-input.ts already reuses
// rather than re-deriving) — no new AI call, no new vendor cost, and
// nothing here discovers WHO to contact (that stays Prospeo's job); this
// only narrows the TITLES searched for.
// ============================================================

import { getOpportunities, getPainPointsStructured, getOutreachIntelligence } from '@/lib/pipeline/analysis-sections'
import { classifySector } from '@/lib/sector-playbook/classify'
import { getSectorPlaybook } from '@/lib/sector-playbook/playbooks'
import { DEFAULT_TARGET_TITLES } from './types'

export interface RoleRecommendationGroup {
  titles: string[]
  reason: string
  // false only for the generic DEFAULT_TARGET_TITLES fallback — lets a
  // caller distinguish "we found a real signal" from "nothing matched" for
  // display purposes (e.g. only showing a "Recommended for this company"
  // section when this is true) without doing a fragile array-content
  // comparison against DEFAULT_TARGET_TITLES itself.
  fromResearch: boolean
}

interface RoleGroupDef {
  keywords: RegExp
  titles: string[]
  label: string
}

// Order matters only for display — a company can match more than one group
// (e.g. both an operational AND a technology signal), and all matches are
// returned rather than picking just one, since a real company frequently
// has more than one relevant buying center.
const ROLE_GROUPS: RoleGroupDef[] = [
  {
    keywords: /\b(operations?|manufactur\w*|plant|production|facilit(?:y|ies)|supply chain|logistics|warehous\w*|assembly line)\b/i,
    titles: ['VP Operations', 'COO', 'Plant Head', 'General Manager'],
    label: 'operational',
  },
  {
    keywords: /\b(technology|technical debt|\bIT\b|software|platform|data (?:pipeline|infrastructure)|\bAI\b|automation|digital transformation|engineering team|infrastructure|cybersecurity)\b/i,
    titles: ['CTO', 'CIO', 'Head of IT', 'VP Engineering'],
    label: 'technology',
  },
  {
    keywords: /\b(sales pipeline|sales team|marketing|revenue growth|customer acquisition|lead generation|demand generation|brand awareness|go-to-market)\b/i,
    titles: ['CRO', 'VP Sales', 'Head of Marketing'],
    label: 'sales & marketing',
  },
]

function collectResearchText(analysisResult: Record<string, unknown> | null | undefined): string {
  if (!analysisResult) return ''
  const opportunityText = getOpportunities(analysisResult)
    .map(o => `${typeof o.title === 'string' ? o.title : ''} ${typeof o.description === 'string' ? o.description : ''}`)
  const painPointText = getPainPointsStructured(analysisResult)
    .map(p => (typeof p.title === 'string' ? p.title : ''))
  const outreach = getOutreachIntelligence(analysisResult)
  const outreachText = outreach
    ? [outreach.likely_problem, outreach.recommended_service, outreach.why_contact].filter(Boolean).join(' ')
    : ''
  return [...opportunityText, ...painPointText, outreachText].join(' ')
}

// Falls back to DEFAULT_TARGET_TITLES (the existing generic executive list)
// with an honest "no specific signal" reason when nothing matches — never
// silently returns an empty recommendation.
export function recommendTitlesFromResearch(
  analysisResult: Record<string, unknown> | null | undefined
): RoleRecommendationGroup[] {
  // DRAFT sector playbook roles take priority when the company confidently
  // matches one of the 3 target sectors (lib/sector-playbook) — these are
  // the sector's own draft decision-maker candidates (Part 11 of the sector-
  // playbook spec), a better-targeted starting point than the generic
  // keyword groups below. Falls through to the keyword groups when no
  // sector match exists, unchanged from before.
  const classification = classifySector(analysisResult)
  if (classification.sector && classification.confidence !== 'none') {
    const playbook = getSectorPlaybook(classification.sector)
    return [{
      titles: playbook.decisionMakerRoles,
      reason: `${classification.reason} (DRAFT ${playbook.label} playbook role candidates.)`,
      fromResearch: true,
    }]
  }

  const text = collectResearchText(analysisResult)
  const matched = text.trim() ? ROLE_GROUPS.filter(g => g.keywords.test(text)) : []

  if (matched.length === 0) {
    return [{
      titles: [...DEFAULT_TARGET_TITLES],
      reason: 'No specific operational, technology, or sales/marketing signal detected yet — showing common executive titles.',
      fromResearch: false,
    }]
  }

  return matched.map(g => ({
    titles: g.titles,
    reason: `Research surfaced ${g.label} signals for this company.`,
    fromResearch: true,
  }))
}
