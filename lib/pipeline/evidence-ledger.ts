// ============================================================
// Evidence Ledger — G2 (see docs/evidence-ledger-design.md)
// ============================================================
// Deterministic helpers that turn an already quote-verified claim (from
// normalize.ts's opportunities Path B1 / pain-points 'observed' branch) into
// a real, attributed EvidenceItem: which URL it came from (never fabricated
// — null when it can't be localized), how authoritative that source type is,
// how fresh it is, whether it's actually about the researched company, and
// a deterministic 0-100 confidence score built from those four inputs.
//
// Also does pairwise contradiction detection across a run's whole evidence
// ledger — genuinely new, nothing like it exists elsewhere in this repo
// (confirmed during the G0/G2 audits).
//
// Deliberately reuses existing helpers rather than re-deriving them:
// parseContentSegments()/ContentSegment (evidence-extractor.ts, exported for
// this), classifySourceType() (discovery-engine.ts), mentionsCompany()
// (extraction-guards.ts), significantWords() (quote-verification.ts).
// ============================================================

import { parseContentSegments, type ContentSegment } from './evidence-extractor'
import { classifySourceType, type SourceType } from '@/lib/enrichment/discovery-engine'
import { mentionsCompany } from '@/lib/enrichment/extraction-guards'
import { significantWords } from './quote-verification'
import type { EvidenceItem } from './normalize'

export type SourceAuthority = 'first_party' | 'regulatory' | 'reputable_third_party' | 'weak' | 'unknown'
export type Freshness = 'very_recent' | 'recent' | 'aging' | 'stale' | 'unknown'

// ── G2.3 — source authority (separate axis from SourceType's document-genre
// classification, see design doc) ─────────────────────────────────────────
const FIRST_PARTY_TYPES: ReadonlySet<SourceType> = new Set([
  'annual_report', 'investor_presentation', 'earnings_release',
  'earnings_call_transcript', 'executive_change_announcement',
  'official_blog', 'corporate_website', 'press_release', 'careers_page',
  'ceo_interview',
])
const THIRD_PARTY_TYPES: ReadonlySet<SourceType> = new Set(['news_article', 'sustainability_report'])

export function classifySourceAuthority(sourceType: SourceType | 'unknown' | undefined): SourceAuthority {
  if (!sourceType || sourceType === 'unknown') return 'unknown'
  if (sourceType === 'regulatory_filing') return 'regulatory'
  if (FIRST_PARTY_TYPES.has(sourceType)) return 'first_party'
  if (THIRD_PARTY_TYPES.has(sourceType)) return 'reputable_third_party'
  return 'weak' // 'other'
}

// ── G2.8 — freshness. Never invents a date: no publishedAt -> 'unknown'. ──
const DAY_MS = 24 * 60 * 60 * 1000

export function classifyFreshness(publishedAt: string | null | undefined, now: Date = new Date()): Freshness {
  if (!publishedAt) return 'unknown'
  const t = new Date(publishedAt).getTime()
  if (Number.isNaN(t)) return 'unknown'
  const ageDays = (now.getTime() - t) / DAY_MS
  if (ageDays < 0) return 'unknown'   // a "future" date is not trustworthy either
  if (ageDays < 90) return 'very_recent'
  if (ageDays < 365) return 'recent'
  if (ageDays < 365 * 3) return 'aging'
  return 'stale'
}

// ── G2.6 — company identity confidence for one evidence item ─────────────
// Reuses the exact relevance gate competitor/ICP discovery already trust
// (mentionsCompany) rather than re-deriving word-boundary matching here.
export function computeCompanyIdentityConfidence(
  quoteWindowText: string,
  companyName: string | undefined,
): 'high' | 'low' | 'unknown' {
  if (!companyName || !companyName.trim()) return 'unknown'
  return mentionsCompany(quoteWindowText, companyName) ? 'high' : 'low'
}

// ── G2.10 — attribute a verified quote back to the real source segment it
// came from, or honestly report it can't be localized. ───────────────────
export interface QuoteAttribution {
  sourceUrl: string | null
  sourceType: SourceType | 'unknown'
}

function findContainingSegment(candidates: Array<string | undefined>, segments: ContentSegment[]): ContentSegment | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue
    // quote-verification.ts's matchedSnippet is sliced from character
    // offsets computed against whitespace-NORMALIZED content, so it can
    // drift from the original (non-normalized) segment text whenever the
    // source has runs of whitespace/newlines (e.g. right after a
    // "--- PAGE: ... ---\n" header) — a plain substring check on the raw
    // `quote` string (not whitespace-collapsed) is tried first since it's
    // unaffected by that; matchedSnippet and a short anchor are fallbacks.
    const found = segments.find(s => s.text.includes(candidate))
    if (found) return found
    const anchor = candidate.slice(0, 40)
    if (anchor.length >= 15) {
      const foundByAnchor = segments.find(s => s.text.includes(anchor))
      if (foundByAnchor) return foundByAnchor
    }
  }
  return undefined
}

export function attributeQuoteToSource(
  quote: string | undefined,
  matchedSnippet: string | undefined,
  contentPool: string,
): QuoteAttribution {
  if (!quote && !matchedSnippet) return { sourceUrl: null, sourceType: 'unknown' }
  const segments = parseContentSegments(contentPool)
  const segment = findContainingSegment([quote, matchedSnippet], segments)
  if (!segment || !segment.url) return { sourceUrl: null, sourceType: 'unknown' }
  // A scraped page is the company's own site by construction —
  // 'corporate_website' regardless of which page-type bucket it fell into.
  // An enriched external source gets its real SourceType re-derived from
  // the URL via the same classifier that originally typed it
  // (discovery-engine.ts), rather than duplicating that logic here.
  const sourceType: SourceType = segment.origin === 'scraped_page'
    ? 'corporate_website'
    : classifySourceType(segment.url, '')
  return { sourceUrl: segment.url, sourceType }
}

// ── G2.5 — deterministic 0-100 confidence score, explainable term by term ──
const SOURCE_AUTHORITY_POINTS: Record<SourceAuthority, number> = {
  first_party: 40, regulatory: 40, reputable_third_party: 25, weak: 10, unknown: 5,
}
const IDENTITY_POINTS: Record<'high' | 'low' | 'unknown', number> = { high: 20, low: 5, unknown: 0 }
const DIRECTNESS_POINTS: Record<NonNullable<EvidenceItem['claimType']>, number> = {
  observed: 25, inferred: 10, hypothesis: 0,
}
const FRESHNESS_POINTS: Record<Freshness, number> = {
  very_recent: 15, recent: 10, aging: 5, stale: 0, unknown: 5,
}
const CONTRADICTION_PENALTY = 30

export function computeEvidenceConfidence(item: Pick<EvidenceItem,
  'sourceAuthority' | 'companyIdentityConfidence' | 'claimType' | 'freshness' | 'contradictionStatus'
>): number {
  const score =
    SOURCE_AUTHORITY_POINTS[item.sourceAuthority ?? 'unknown'] +
    IDENTITY_POINTS[item.companyIdentityConfidence ?? 'unknown'] +
    DIRECTNESS_POINTS[item.claimType ?? 'hypothesis'] +
    FRESHNESS_POINTS[item.freshness ?? 'unknown'] -
    (item.contradictionStatus === 'conflict' ? CONTRADICTION_PENALTY : 0)
  return Math.max(0, Math.min(100, score))
}

// ── G2.7 — contradiction detection across a run's evidence ledger ────────
// Fixed polarity-pair table, English-only, deliberately narrow first pass
// (see design doc) — catches the plan's own example shape (implementing X
// vs. lacking X) plus a few common operational-maturity pairs.
const POLARITY_PAIRS: Array<[RegExp, RegExp]> = [
  [/\b(?:implement(?:ing|ed)?|roll(?:ing|ed)?\s+out|deploy(?:ing|ed)?|adopt(?:ing|ed)?)\b/i,
   /\b(?:lacks?|no\b|without|not\s+yet|does\s+not\s+have)\b/i],
  [/\bcentraliz(?:ed|ation)\b/i, /\b(?:fragmented|siloed|decentraliz\w+|manual(?:ly)?)\b/i],
  [/\bautomat(?:ed|ion)\b/i, /\bmanual(?:ly)?\b/i],
]

function sharesRealOverlap(a: string, b: string): boolean {
  const wordsA = new Set(significantWords(a))
  const wordsB = significantWords(b)
  const overlap = wordsB.filter(w => wordsA.has(w)).length
  return overlap >= 2
}

function isContradictoryPair(a: string, b: string): boolean {
  if (!sharesRealOverlap(a, b)) return false
  return POLARITY_PAIRS.some(([pos, neg]) => (pos.test(a) && neg.test(b)) || (pos.test(b) && neg.test(a)))
}

/**
 * Mutates contradictionStatus/contradictoryEvidenceIds in place on the
 * items that conflict; leaves everything else untouched. Never removes an
 * item — both sides of a contradiction stay in the ledger, tagged, per
 * plan §10 ("never silently overwrite the earlier claim").
 */
export function detectContradictions(items: EvidenceItem[]): void {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]
      const b = items[j]
      if (!isContradictoryPair(a.quote, b.quote)) continue
      a.contradictionStatus = 'conflict'
      b.contradictionStatus = 'conflict'
      a.contradictoryEvidenceIds = [...(a.contradictoryEvidenceIds ?? []), b.id]
      b.contradictoryEvidenceIds = [...(b.contradictoryEvidenceIds ?? []), a.id]
    }
  }
}


// ── G6 (cache layer, docs/cache-layer-design.md) — cached wrapper around
// attributeQuoteToSource(). Additive only: normalize.ts's live call site
// still calls the uncached attributeQuoteToSource() directly (unchanged
// this session) — wiring the cache into that already-live call path is
// deferred, same "additive, not wired into the live pipeline" discipline
// every G0-G5 session in this file followed. This wrapper exists so a
// future session can adopt it with a one-line import swap.
import { getCachedAttribution, saveCachedAttribution } from '@/lib/cache/evidence-cache'

export function attributeQuoteToSourceCached(
  quote: string | undefined,
  matchedSnippet: string | undefined,
  contentPool: string,
): QuoteAttribution {
  const key = `${quote ?? ''} ${matchedSnippet ?? ''}`
  const cached = getCachedAttribution(key, contentPool)
  if (cached) return cached
  const result = attributeQuoteToSource(quote, matchedSnippet, contentPool)
  saveCachedAttribution(key, contentPool, result)
  return result
}
