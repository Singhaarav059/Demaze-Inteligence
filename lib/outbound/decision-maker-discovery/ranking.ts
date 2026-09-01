// ============================================================
// Decision-Maker Discovery — Seniority Ranking
// ============================================================
// Pure presentation/ordering layer, applied uniformly to every provider's
// output at the same call site as groundCandidates() (provider-factory.ts)
// — same "shared post-processing, never duplicated per-provider" pattern.
// Sorts by seniority tier (via the existing classifyRoleCategory(), which
// already never affects WHO is discovered — see role-category.ts), then
// LinkedIn-URL presence, then existing confidence, as tiebreakers. No
// numeric score is invented — the sort key is the ordered tier plus two
// simple booleans, nothing synthesized to look more precise than it is.
// ============================================================

import { classifyRoleCategory, type RoleCategory } from './role-category'
import type { DecisionMakerCandidate, DecisionMakerConfidence } from './types'

const ROLE_CATEGORY_RANK: Record<RoleCategory, number> = {
  'ceo-founder-owner': 0,
  'cxo-executive': 1,
  vp: 2,
  director: 3,
  head: 4,
  manager: 5,
  other: 6,
}

const CONFIDENCE_RANK: Record<DecisionMakerConfidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

export function rankCandidates(candidates: DecisionMakerCandidate[]): DecisionMakerCandidate[] {
  return [...candidates].sort((a, b) => {
    const roleDiff = ROLE_CATEGORY_RANK[classifyRoleCategory(a.title)] - ROLE_CATEGORY_RANK[classifyRoleCategory(b.title)]
    if (roleDiff !== 0) return roleDiff

    const linkedinDiff = (b.linkedinUrl ? 1 : 0) - (a.linkedinUrl ? 1 : 0)
    if (linkedinDiff !== 0) return linkedinDiff

    return CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]
  })
}
