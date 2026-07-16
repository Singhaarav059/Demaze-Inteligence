// ============================================================
// Proof Point Matcher — lib/knowledge/proof-point-matcher.ts
// ============================================================
// Pure, deterministic, zero I/O — matches the researched company against
// DEMAZE_PROOF_POINTS by industry-tag overlap. Same shape as
// lib/pipeline/service-evidence.ts's regex-pattern-with-label matching
// against a fixed catalog, NOT the search-grounded discovery modules
// (competitor-discovery.ts / icp-generator.ts / market-intelligence.ts) —
// there's no live search here, the candidate list is static.
//
// Two independent signals combine into one detected-tag set:
//   1. CompanyProfile.company_type flags (structural business-model
//      classification, e.g. "this company manufactures physical goods" —
//      already computed by evidence-extractor.ts by the time this runs).
//   2. Keyword hits on the raw scraped/enriched content for VERTICAL
//      language CompanyProfile doesn't capture (automotive/dealership,
//      trading, fintech, ecommerce, media) — CompanyProfile's flags are
//      business-model types, not industry verticals, so they only cover
//      manufacturing/industrial/fintech/distribution/ecommerce, not
//      automotive or media.
//
// Governing principle, same as every other discovery module in this repo:
// prefer under-confidence to over-confidence. Returns [] when nothing
// scores rather than forcing a generic proof point onto an unrelated
// company — same "9th outcome, no forced fit" discipline as
// service-evidence.ts's threshold gate.
//
// capability_tags on ProofPoint are not scored here (v1) — kept on the
// data for future refinement (e.g. weighting by matched Demaze service)
// and for UI display, not because they're unused by design.
// ============================================================

import type { CompanyProfile } from '../pipeline/evidence-extractor'
import { DEMAZE_PROOF_POINTS, type ProofPoint } from './demaze-proof-points'

type IndustryKeywordPattern = [RegExp, string]

const INDUSTRY_KEYWORD_PATTERNS: IndustryKeywordPattern[] = [
  [/\b(?:dealership|dealer network|automotive|OEM|car manufactur\w+|vehicle)\b/i, 'automotive'],
  [/\b(?:trading platform|brokerage|stock exchange|algorithmic trading|forex)\b/i, 'trading'],
  [/\b(?:fintech|payment gateway|digital wallet|lending platform|\bnbfc\b)\b/i, 'fintech'],
  [/\b(?:e-?commerce|online marketplace|d2c brand|online store)\b/i, 'ecommerce'],
  [/\b(?:film production|storyboard|content production|media house|advertising agency)\b/i, 'media'],
  [/\b(?:distribut\w+\s+network|distributor|secondary sales)\b/i, 'distribution'],
]

const COMPANY_TYPE_TAG_BOOST: Array<[keyof CompanyProfile['company_type'], string[]]> = [
  ['manufacturer', ['manufacturing', 'industrial']],
  ['industrial_vendor', ['manufacturing', 'industrial']],
  ['financial_institution', ['fintech', 'financial_institution']],
  ['logistics_operator', ['distribution', 'supply-chain']],
  ['retailer', ['ecommerce', 'retail']],
]

const PROVENANCE_RANK: Record<ProofPoint['provenance'], number> = {
  named_client: 0,
  composite_illustrative: 1,
}

/** Detected industry tags from content keywords + company_type flags, for callers that want the raw signal (e.g. diagnostics/tests). */
export function detectIndustryTags(websiteContent: string, companyProfile: CompanyProfile): Set<string> {
  const tags = new Set<string>()

  for (const [re, tag] of INDUSTRY_KEYWORD_PATTERNS) {
    if (re.test(websiteContent)) tags.add(tag)
  }
  for (const [flag, boostTags] of COMPANY_TYPE_TAG_BOOST) {
    if (companyProfile.company_type[flag]) {
      for (const t of boostTags) tags.add(t)
    }
  }

  return tags
}

/**
 * Ranks DEMAZE_PROOF_POINTS by industry-tag overlap with the researched
 * company. Ties broken by provenance (named_client ranked ahead of
 * composite_illustrative, since a real named-client result is stronger
 * evidence than an illustrative one), then by declaration order. Returns
 * [] when no proof point's industry_tags overlap the detected set at all.
 */
export function matchProofPoints(
  websiteContent: string,
  companyProfile: CompanyProfile,
  maxResults = 2,
): ProofPoint[] {
  const detectedTags = detectIndustryTags(websiteContent, companyProfile)
  if (detectedTags.size === 0) return []

  const scored = DEMAZE_PROOF_POINTS
    .map((pp, index) => ({
      pp,
      index,
      score: pp.industry_tags.filter(t => detectedTags.has(t)).length,
    }))
    .filter(x => x.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      PROVENANCE_RANK[a.pp.provenance] - PROVENANCE_RANK[b.pp.provenance] ||
      a.index - b.index
    )

  return scored.slice(0, maxResults).map(x => x.pp)
}
