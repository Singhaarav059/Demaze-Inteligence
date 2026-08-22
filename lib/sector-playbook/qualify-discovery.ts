// ============================================================
// Qualification scorecard — lightweight (Explee + Gemini-grounded-signals)
// research path
// ============================================================
// Returns the SAME QualificationResult shape qualify.ts's qualifyCompany()
// does, so the existing SectorQualificationCard/CompactSectorBadge UI
// renders unchanged for either research path — this is a second producer of
// that type, not a new type or a new UI. Reuses classifySector()/
// getSectorPlaybook()/buildOverallScore() directly; only the score inputs
// differ, because the lightweight path has no scraped content, no
// company_fit heuristic, and no decision-maker step of its own.
//
// "Company fit" here is honestly NOT a size/revenue judgment — there is no
// documented Demaze ICP employee/revenue threshold to score against (the one
// that used to exist, tied to the removed Apollo integration, is gone — see
// CLAUDE.md's Coresignal-reset entry). Scoring "goodness" against a
// threshold nobody has confirmed would be exactly the fabricated-confidence
// this feature's own spec explicitly forbids. Instead it scores how much
// real Explee firmographic data exists — a genuinely measurable signal (a
// thin record is harder to qualify/personalize against than a rich one) —
// and says so plainly in its own reason text rather than implying a
// judgment it isn't making.
// ============================================================

import { classifySector } from './classify'
import { getSectorPlaybook } from './playbooks'
import { buildOverallScore, type QualificationResult, type ScoreWithReasons } from './qualify'
import type { SectorClassification } from './classify'
import type { CompanyResearchResult } from '@/lib/research/company-signals'

export interface DiscoveredCompanyFirmographics {
  industry?: string | null
  employeeCount?: number | null
  hqLocation?: string | null
  founded?: number | null
  revenueAnnual?: number | null
}

const SECTOR_FIT_SCORE: Record<SectorClassification['confidence'], number> = {
  high: 90,
  medium: 65,
  low: 35,
  none: 0,
}

export function qualifyDiscoveredCompany(
  firmographics: DiscoveredCompanyFirmographics,
  result: CompanyResearchResult,
): QualificationResult {
  const classification = classifySector({
    industry: firmographics.industry ?? undefined,
    company_summary: [result.whatThisSuggests, ...result.signals.map(s => s.description)].filter(Boolean).join(' '),
  })
  const playbook = classification.sector ? getSectorPlaybook(classification.sector) : null

  const sectorFit: ScoreWithReasons = {
    score: SECTOR_FIT_SCORE[classification.confidence],
    reasons: [classification.reason],
  }

  const known: string[] = []
  const missing: string[] = []
  if (firmographics.employeeCount != null) known.push(`${firmographics.employeeCount.toLocaleString()} employees`)
  else missing.push('employee count')
  if (firmographics.hqLocation) known.push(`HQ ${firmographics.hqLocation}`)
  else missing.push('HQ')
  if (firmographics.founded != null) known.push(`founded ${firmographics.founded}`)
  else missing.push('founding year')
  if (firmographics.revenueAnnual != null) known.push(`~$${Math.round(firmographics.revenueAnnual).toLocaleString()} revenue`)
  else missing.push('revenue')

  const companyFit: ScoreWithReasons = {
    score: Math.min(100, known.length * 25),
    reasons: known.length > 0
      ? [`Firmographic profile on file: ${known.join(', ')}${missing.length ? ` (${missing.join(', ')} not disclosed)` : ''}. Reflects data available, not a size/revenue judgment — no Demaze ICP threshold is defined yet.`]
      : ['No firmographic data available for this company yet.'],
  }

  const matchedOpportunities: QualificationResult['matchedOpportunities'] = result.opportunities.map(o => ({
    possibleProblem: o.opportunity,
    capability: o.service,
    // Never 'confirmed' here — that tier means the old pipeline's mechanical
    // quote-verification against a real scraped corpus. A grounded-search
    // opportunity is real search-informed reasoning, not independently
    // re-verified, so it's tagged the more conservative tier.
    tier: 'inferred' as const,
    evidence: o.evidence,
  }))

  const opportunityEvidence: ScoreWithReasons = {
    score: Math.min(100, result.opportunities.length * 35 + Math.min(result.potentialPainPoints.length, 3) * 15),
    reasons:
      matchedOpportunities.length > 0
        ? matchedOpportunities.map(m => `Reasonable inference: ${m.possibleProblem}`)
        : result.potentialPainPoints.length > 0
        ? result.potentialPainPoints.map(p => `Reasonable inference: ${p}`)
        : ['No specific opportunity evidence found in recent public signals yet.'],
  }

  const contactability: QualificationResult['contactability'] = {
    score: null,
    reasons: ['Not yet determined — use "Find decision makers" to check.'],
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
