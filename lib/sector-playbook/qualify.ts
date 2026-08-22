// ============================================================
// Qualification scorecard — sector fit / company fit / opportunity evidence
// / contactability / overall
// ============================================================
// Pure, sync, no new LLM call. Reuses already-computed pipeline output
// (getCompanyFit, getPainPointsStructured's claim_type, getServiceEvidenceDebug)
// rather than re-deriving anything. Every score comes with a plain-English
// reasons list, per this feature's own "explain WHY, not just the number"
// requirement — never fabricates a reason with no backing fact.
// ============================================================

import { getCompanyFit, getPainPointsStructured, getServiceEvidenceDebug } from '@/lib/pipeline/analysis-sections'
import { classifySector, type SectorClassification } from './classify'
import { getSectorPlaybook } from './playbooks'
import type { SectorPlaybook } from './types'

export interface ScoreWithReasons {
  score: number
  reasons: string[]
}

export interface QualificationResult {
  status: 'DRAFT'
  classification: SectorClassification
  playbook: SectorPlaybook | null
  sectorFit: ScoreWithReasons
  companyFit: ScoreWithReasons
  opportunityEvidence: ScoreWithReasons
  // null = not yet determined (decision-maker discovery hasn't run for this
  // company yet) — never guessed, per this feature's "no fabricated
  // evidence" rule.
  contactability: { score: number | null; reasons: string[] }
  overall: { score: number; label: string; reasons: string[] }
  matchedOpportunities: Array<{
    possibleProblem: string
    capability: string
    tier: 'confirmed' | 'inferred'
    evidence: string
  }>
}

const SECTOR_FIT_SCORE: Record<SectorClassification['confidence'], number> = {
  high: 90,
  medium: 65,
  low: 35,
  none: 0,
}

function scoreLabel(score: number): string {
  if (score >= 75) return 'Strong'
  if (score >= 50) return 'Moderate'
  if (score >= 25) return 'Weak'
  return 'Poor'
}

export function qualifyCompany(
  analysisResult: Record<string, unknown> | null | undefined,
  opts: { decisionMakerCount?: number; verifiedEmailCount?: number } = {}
): QualificationResult {
  const data = analysisResult ?? {}
  const classification = classifySector(analysisResult)
  const playbook = classification.sector ? getSectorPlaybook(classification.sector) : null

  const sectorFit: ScoreWithReasons = {
    score: SECTOR_FIT_SCORE[classification.confidence],
    reasons: [classification.reason],
  }

  const companyFitRaw = getCompanyFit(data)
  const companyFit: ScoreWithReasons = {
    score: typeof companyFitRaw?.value === 'number' ? companyFitRaw.value : 0,
    reasons: companyFitRaw?.rationale
      ? [companyFitRaw.rationale]
      : ['No company-fit signal computed yet — research this company first.'],
  }

  const matchedOpportunities: QualificationResult['matchedOpportunities'] = []
  if (playbook) {
    const painPoints = getPainPointsStructured(data)
    const serviceDebug = getServiceEvidenceDebug(data)

    for (const pattern of playbook.opportunityPatterns) {
      // Confirmed: a code-verified service-evidence match at medium/strong
      // for this pattern's capability.
      const serviceEntry = serviceDebug?.services?.find(
        s => s.service === pattern.capability && !s.disqualified && s.surfaced && (s.threshold === 'medium' || s.threshold === 'strong')
      )
      if (serviceEntry) {
        matchedOpportunities.push({
          possibleProblem: pattern.possibleProblem,
          capability: pattern.capability,
          tier: 'confirmed',
          evidence: serviceEntry.evidence?.[0]?.snippet ?? `Verified evidence detected for ${pattern.capability}.`,
        })
        continue
      }

      // Inferred: an already-marked 'inferred' (or unlabeled legacy) pain
      // point loosely mentions this pattern's signal word.
      const signalWord = pattern.signal.split(/\s+/).find(w => w.length > 4) ?? pattern.signal
      const inferredHit = painPoints.find(p => {
        const text = [p.title, p.evidence, p.reasoning].filter((x): x is string => typeof x === 'string').join(' ').toLowerCase()
        return text.includes(signalWord.toLowerCase())
      })
      if (inferredHit) {
        matchedOpportunities.push({
          possibleProblem: pattern.possibleProblem,
          capability: pattern.capability,
          tier: 'inferred',
          evidence: typeof inferredHit.title === 'string' ? inferredHit.title : pattern.signal,
        })
      }
    }
  }

  const confirmedCount = matchedOpportunities.filter(m => m.tier === 'confirmed').length
  const inferredCount = matchedOpportunities.filter(m => m.tier === 'inferred').length
  const opportunityEvidence: ScoreWithReasons = {
    score: Math.min(100, confirmedCount * 35 + inferredCount * 15),
    reasons:
      matchedOpportunities.length > 0
        ? matchedOpportunities.map(m => `${m.tier === 'confirmed' ? 'Confirmed' : 'Inferred'}: ${m.possibleProblem}`)
        : playbook
        ? ['No specific opportunity evidence detected yet for this sector\'s patterns.']
        : ['Company is outside the current target sectors — no opportunity patterns to check.'],
  }

  const contactability: { score: number | null; reasons: string[] } =
    opts.decisionMakerCount === undefined
      ? { score: null, reasons: ['Not yet determined — run Decision Maker Discovery first.'] }
      : {
          score: opts.decisionMakerCount === 0 ? 10 : Math.min(100, 40 + opts.decisionMakerCount * 10 + (opts.verifiedEmailCount ?? 0) * 10),
          reasons:
            opts.decisionMakerCount === 0
              ? ['No decision-makers found yet.']
              : [`${opts.decisionMakerCount} decision-maker candidate(s) found${opts.verifiedEmailCount ? `, ${opts.verifiedEmailCount} with a verified email` : ''}.`],
        }

  return {
    status: 'DRAFT',
    classification,
    playbook,
    sectorFit,
    companyFit,
    opportunityEvidence,
    contactability,
    overall: buildOverallScore(sectorFit, companyFit, opportunityEvidence, contactability, classification.sector ? (playbook?.label ?? '') : 'outside target sectors'),
    matchedOpportunities,
  }
}

// Extracted (2026-08-22) so qualify-discovery.ts's lightweight-pipeline
// scorer can share the exact same weighting/label formula instead of
// re-deriving it — same 4-pillar weighted average, dropping contactability
// entirely (not treating it as 0) whenever it isn't known yet.
export function buildOverallScore(
  sectorFit: ScoreWithReasons,
  companyFit: ScoreWithReasons,
  opportunityEvidence: ScoreWithReasons,
  contactability: { score: number | null; reasons: string[] },
  sectorLabel: string,
): QualificationResult['overall'] {
  const weighted = [
    { score: sectorFit.score, weight: 0.3 },
    { score: companyFit.score, weight: 0.25 },
    { score: opportunityEvidence.score, weight: 0.25 },
    ...(contactability.score !== null ? [{ score: contactability.score, weight: 0.2 }] : []),
  ]
  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0)
  const overallScore = Math.round(weighted.reduce((s, w) => s + w.score * w.weight, 0) / totalWeight)

  const overallReasons = [
    `Sector fit: ${scoreLabel(sectorFit.score)} (${sectorLabel})`,
    `Company fit: ${scoreLabel(companyFit.score)}`,
    `Opportunity evidence: ${scoreLabel(opportunityEvidence.score)}`,
    contactability.score !== null ? `Contactability: ${scoreLabel(contactability.score)}` : 'Contactability: not yet determined',
  ]

  return { score: overallScore, label: scoreLabel(overallScore), reasons: overallReasons }
}
