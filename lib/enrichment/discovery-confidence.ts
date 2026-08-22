// ============================================================
// Discovery confidence score — a structured rubric, not an average
// ============================================================
// Turns the individual signals company-qualification.ts already computes
// (entity type, domain confirmation, sector-signal match, size verdict,
// mention count) into one 0-100 score plus a QUALIFIED/REVIEW/REJECTED
// verdict, for audit visibility — "why did this candidate qualify" should
// be answerable without re-reading qualifyCandidate()'s control flow.
//
// Deliberately NOT a flat average of unrelated signals (explicitly warned
// against in the governing task): any hard disqualifier — already a
// duplicate, wrong entity type, wrong sector, wrong size — short-circuits
// straight to REJECTED/score 0, regardless of how strong the other signals
// are. A famous, well-known company with a perfectly confirmed domain and
// 3 sector-signal mentions still can't buy its way past "too large for the
// target band" by scoring well elsewhere — that's the literal failure mode
// (Ford qualifying because it's obviously automotive) this scorer exists to
// prevent. The weighted sum below only ever runs among candidates that
// already cleared every hard gate.
//
// Does NOT change what gets persisted to company_registry — this is purely
// additive diagnostic output layered onto qualifyCandidate()'s existing,
// unchanged qualified/disqualified decision (see that function for where
// this is wired in). Adding a genuinely new persisted verdict/rejection-
// reason value would need a migration (company_registry.rejection_reason
// has a CHECK constraint); this stays code-only by design.
// ============================================================

import type { EntityType } from './entity-classification'
import type { SizeVerdict } from './company-size'

export type QualificationVerdict = 'QUALIFIED' | 'REVIEW' | 'REJECTED'

export interface DiscoveryScoreInputs {
  entityType: EntityType
  isDuplicateOrAlreadyClaimed: boolean
  sectorSignalMatch: 'match' | 'no_evidence' | 'no_match'
  sizeVerdict: SizeVerdict
  domainConfirmed: boolean
  domainConfidence?: 'high' | 'medium'
  mentionCount?: number
}

export interface DiscoveryScore {
  score: number
  verdict: QualificationVerdict
  reasons: string[]
}

const QUALIFIED_THRESHOLD = 70
const REVIEW_THRESHOLD = 40

export function scoreDiscoveryCandidate(inputs: DiscoveryScoreInputs): DiscoveryScore {
  // ── Hard gates — any one of these short-circuits to REJECTED/0,
  // regardless of every other signal's strength.
  if (inputs.isDuplicateOrAlreadyClaimed) {
    return { score: 0, verdict: 'REJECTED', reasons: ['already known: duplicate, already researched, or already outreached'] }
  }
  if (inputs.entityType !== 'COMPANY' && inputs.entityType !== 'UNKNOWN') {
    return { score: 0, verdict: 'REJECTED', reasons: [`entity type is ${inputs.entityType}, not a company`] }
  }
  if (inputs.sizeVerdict === 'too_large' || inputs.sizeVerdict === 'too_small') {
    return { score: 0, verdict: 'REJECTED', reasons: [`size evidence places it ${inputs.sizeVerdict === 'too_large' ? 'above' : 'below'} the target band`] }
  }
  if (inputs.sectorSignalMatch === 'no_match') {
    return { score: 0, verdict: 'REJECTED', reasons: ['no sector-signal match in available evidence'] }
  }

  // ── Weighted score among survivors of every hard gate above.
  const reasons: string[] = []
  let score = 0

  if (inputs.entityType === 'COMPANY') {
    score += 25
  } else {
    score += 10
    reasons.push('entity type could not be confirmed as COMPANY')
  }

  if (inputs.domainConfirmed) {
    score += inputs.domainConfidence === 'high' ? 25 : 15
  } else {
    reasons.push('no confirmed company domain')
  }

  if (inputs.sectorSignalMatch === 'match') {
    score += 25
  } else {
    score += 10
    reasons.push('no sector-signal evidence available to confirm fit (neither confirmed nor contradicted)')
  }

  if (inputs.sizeVerdict === 'within_range') {
    score += 15
  } else {
    score += 8
    reasons.push('company size could not be confirmed from available evidence')
  }

  score += Math.min(inputs.mentionCount ?? 1, 3) * 3

  score = Math.min(Math.round(score), 100)

  const verdict: QualificationVerdict =
    score >= QUALIFIED_THRESHOLD ? 'QUALIFIED' : score >= REVIEW_THRESHOLD ? 'REVIEW' : 'REJECTED'

  if (reasons.length === 0) reasons.push('all signals confirmed')
  return { score, verdict, reasons }
}
