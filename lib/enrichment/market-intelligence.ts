// ============================================================
// Market Intelligence Layer (Roadmap Phase 2, item 6) — 2026-07-15
// ============================================================
// Given an already-researched company, surface industry-level context:
// trends, growth indicators, market challenges, industry shifts. This is
// macro context about the SECTOR the company operates in, not company-
// specific evidence (that's signals/opportunities) and not who the company
// sells to (that's icp-generator.ts).
//
// Deliberately diverges from the competitor-discovery.ts/icp-generator.ts
// "code extracts named candidates -> LLM narrates onto them by name-match"
// pattern. A trend/growth/challenge/shift item is already a full statement
// pulled from a real search snippet, not a name needing explanation — there
// is nothing for an LLM narration layer to usefully add, and adding one
// would only introduce a new hallucination surface for content that's
// already grounded. So this module is pure deterministic: search ->
// classify each candidate sentence into one of 4 categories via keyword
// regex -> dedupe -> tier confidence -> cap. No analyze-v2.ts prompt block,
// no normalize.ts merge-by-name step — normalize.ts passes `items` straight
// through. (Design decision confirmed with the user before implementation —
// see docs/DECISIONS.md.)
//
// Governing principle, same as every other discovery module in this repo:
// prefer under-confidence to over-confidence. A sentence only becomes a
// candidate if it contains explicit category-defining language — this
// module never infers a trend from context, only extracts one that's
// already stated.
// ============================================================

import { searchTavily, searchSerper } from './discovery-engine'

export type MarketIntelCategory = 'trend' | 'growth_indicator' | 'challenge' | 'shift'
export type MarketIntelConfidence = 'high' | 'medium' | 'low'
export type MarketIntelSufficiency = 'sufficient' | 'insufficient'

// Final, filtered shape — one per surfaced market-intelligence statement.
// Additive to NormalizedAnalysis (see normalize.ts). Unlike CompetitorProfile/
// ICPSegment, `statement` IS the content (extracted verbatim, capped length),
// not a code-derived fallback awaiting LLM enrichment — there is no LLM layer
// for this module.
export interface MarketIntelItem {
  statement: string
  category: MarketIntelCategory
  confidence: MarketIntelConfidence
  mention_count: number          // independent search results yielding a near-duplicate statement
  source_urls: string[]
}

export interface MarketIntelligenceResult {
  items: MarketIntelItem[]
  sufficiency: MarketIntelSufficiency
  reason: string                 // human-readable summary for gate diagnostics/logs — feeds the MARKET_INTEL gate's reason argument
  candidates_considered: number  // pre-filter candidate count, for diagnostics
  rejected_candidates?: Array<{ statement: string; reason: string }>
}

// ── Category classification (regex, no LLM) ──────────────────────
// Checked most-specific-first: a sentence carrying a concrete number/rate
// is classified as growth_indicator even if it also contains the word
// "trend", since the numeric claim is the more useful signal. `trend` is
// the generic fallback category for explicit trend language that doesn't
// fit the other three.

const GROWTH_INDICATOR_PATTERN =
  /\b(?:CAGR|compound\s+annual\s+growth|market\s+size|growing\s+at\s+\d|grow(?:th)?\s+(?:of|to|by)\s+\d|projected\s+to\s+(?:reach|grow)|expected\s+to\s+(?:reach|grow)|forecast\s+to\s+(?:reach|grow)|valued\s+at\s+\$|reach(?:ing)?\s+\$[\d,.]+\s*(?:billion|million|trillion|bn|mn))\b/i

const CHALLENGE_PATTERN =
  /\b(?:challenge|headwind|under\s+pressure|shortage|disrupt(?:ion|ed|ing)?|declin(?:e|ing|ed)|slowdown|volatil|rising\s+costs?|supply\s+chain\s+(?:issue|disruption|constraint)|labor\s+shortage|talent\s+shortage|margin\s+pressure|regulatory\s+(?:pressure|burden|challenge)|inflation(?:ary)?\s+pressure)\b/i

const SHIFT_PATTERN =
  /\b(?:shift(?:ing)?\s+(?:toward|towards|from|to|in)|transition(?:ing)?\s+(?:to|toward|towards)|mov(?:e|ing)\s+(?:away\s+from|from|to|toward|towards)|pivot(?:ing)?\s+to|increasingly\s+(?:adopting|moving|turning)|migrat(?:e|ing|ion)\s+(?:to|toward))\b/i

const TREND_PATTERN =
  /\b(?:trend|emerging|key\s+trend|latest\s+trend|industry\s+trend|growing\s+demand|rising\s+demand|gaining\s+(?:traction|momentum))\b/i

export function classifyCategory(sentence: string): MarketIntelCategory | null {
  if (GROWTH_INDICATOR_PATTERN.test(sentence)) return 'growth_indicator'
  if (CHALLENGE_PATTERN.test(sentence)) return 'challenge'
  if (SHIFT_PATTERN.test(sentence)) return 'shift'
  if (TREND_PATTERN.test(sentence)) return 'trend'
  return null
}

// A statement "has a strong indicator" if it carries a concrete number/
// percentage/currency figure — same role as CompetitorCandidate's
// explicit_vs_framing / ICPCandidate's explicit_serve_framing in the
// confidence formula below, just named for what this module actually checks.
const STRONG_INDICATOR_PATTERN = /[\d](?:[.,]\d+)?\s*%|\$[\d,.]+\s*(?:billion|million|trillion|bn|mn)?|\bCAGR\b/i

export function hasStrongIndicator(sentence: string): boolean {
  return STRONG_INDICATOR_PATTERN.test(sentence)
}

// ── Sentence extraction + sanity filtering ────────────────────────

function splitSentences(text: string): string[] {
  return text
    .split(/[.!?]+(?:\s+|$)/)
    .map(s => s.trim())
    .filter(Boolean)
}

// Returns a rejection reason, or null if the sentence survives. Only called
// on sentences that already matched a category pattern — this is a sanity
// filter on THOSE, not a second classification pass.
export function classifyStatementRejection(sentence: string): string | null {
  const trimmed = sentence.trim()
  if (trimmed.length < 30 || trimmed.length > 280) {
    return 'too short/long to be a useful standalone statement'
  }
  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length < 5) {
    return 'too few words to be a real statement'
  }
  const letters = trimmed.replace(/[^a-zA-Z]/g, '')
  if (letters.length > 0 && letters === letters.toUpperCase() && letters.length > 8) {
    return 'looks like a navigation/heading fragment, not a sentence'
  }
  return null
}

function normalizeStatement(s: string): string {
  return s.toLowerCase().replace(/[^\w\s%$]/g, ' ').replace(/\s+/g, ' ').trim()
}

// ── Confidence tiering ────────────────────────────────────────────
// Same rank/formula shape as competitor-discovery.ts / icp-generator.ts's
// tierConfidence — mention_count + a "strong evidence" boolean.

export function tierConfidence(mentionCount: number, strongIndicator: boolean): MarketIntelConfidence {
  if (mentionCount >= 2 && strongIndicator) return 'high'
  if ((mentionCount >= 2 && !strongIndicator) || (mentionCount === 1 && strongIndicator)) return 'medium'
  return 'low'
}

// ── Search ─────────────────────────────────────────────────────────
// Duplicated per-query Tavily→Serper fallback — same shape as
// competitor-discovery.ts/icp-generator.ts's searchWithFallback, kept as its
// own copy rather than a shared import, matching this codebase's existing
// precedent (see CLAUDE.md "Item 1" history for why).

async function searchWithFallback(
  query: string,
  tavilyKey: string | undefined,
  serperKey: string | undefined,
): Promise<Array<{ title: string; url: string; content: string }>> {
  if (tavilyKey) {
    const results = await searchTavily(query, tavilyKey)
    if (results.length > 0) return results
  }
  if (serperKey) return searchSerper(query, serperKey)
  return []
}

function buildMarketIntelQueries(companyName: string): string[] {
  return [
    `"${companyName}" industry trends`,
    `"${companyName}" market growth`,
    `"${companyName}" industry challenges`,
    `"${companyName}" industry outlook`,
  ]
}

// ── Main export ───────────────────────────────────────────────────

const MAX_ITEMS = 8
const MAX_REJECTED_LOGGED = 20

export async function discoverMarketIntelligence(
  companyName: string,
  domain: string,
): Promise<MarketIntelligenceResult> {
  const tavilyKey = process.env.TAVILY_API_KEY
  const serperKey = process.env.SERPER_API_KEY

  if (!tavilyKey && !serperKey) {
    return { items: [], sufficiency: 'insufficient', reason: 'no search API configured', candidates_considered: 0 }
  }
  if (!companyName || companyName.trim().length === 0) {
    return { items: [], sufficiency: 'insufficient', reason: 'no company name available to search for market intelligence', candidates_considered: 0 }
  }

  // domain unused for extraction itself (statements are text, not URLs) but
  // kept as a parameter for parity with discoverCompetitors/discoverICPSegments.
  void domain

  const queries = buildMarketIntelQueries(companyName)
  let allResults: Array<{ title: string; url: string; content: string }>
  try {
    const resultsPerQuery = await Promise.all(queries.map(q => searchWithFallback(q, tavilyKey, serperKey)))
    allResults = resultsPerQuery.flat()
  } catch (e) {
    return {
      items: [], sufficiency: 'insufficient',
      reason: `search failed: ${e instanceof Error ? e.message : String(e)}`,
      candidates_considered: 0,
    }
  }

  if (allResults.length === 0) {
    return { items: [], sufficiency: 'insufficient', reason: 'search returned no results for any market-intelligence query', candidates_considered: 0 }
  }

  // ── Extract + classify + group by normalized statement ───────────
  const grouped = new Map<string, {
    displayStatement: string
    category: MarketIntelCategory
    mention_count: number
    source_urls: Set<string>
    strongIndicator: boolean
  }>()
  const rejected: Array<{ statement: string; reason: string }> = []
  let candidatesConsidered = 0

  for (const r of allResults) {
    const sentences = [...splitSentences(r.title), ...splitSentences(r.content)]
    for (const sentence of sentences) {
      const category = classifyCategory(sentence)
      if (!category) continue
      candidatesConsidered++

      const rejectReason = classifyStatementRejection(sentence)
      if (rejectReason) {
        if (rejected.length < MAX_REJECTED_LOGGED) rejected.push({ statement: sentence, reason: rejectReason })
        continue
      }

      const key = normalizeStatement(sentence).slice(0, 60)
      if (!key) continue
      const existing = grouped.get(key)
      const strong = hasStrongIndicator(sentence)
      if (existing) {
        existing.mention_count += 1
        existing.source_urls.add(r.url)
        existing.strongIndicator = existing.strongIndicator || strong
      } else {
        grouped.set(key, {
          displayStatement: sentence.length > 240 ? `${sentence.slice(0, 237)}...` : sentence,
          category,
          mention_count: 1,
          source_urls: new Set([r.url]),
          strongIndicator: strong,
        })
      }
    }
  }

  if (grouped.size === 0) {
    return {
      items: [],
      sufficiency: 'insufficient',
      reason: candidatesConsidered > 0
        ? `${candidatesConsidered} raw candidate(s) found, all rejected (too short/fragment)`
        : 'no sentences matched trend/growth/challenge/shift language in any search result',
      candidates_considered: candidatesConsidered,
      rejected_candidates: rejected,
    }
  }

  // ── Confidence tiering + cap ──────────────────────────────────────
  const rank: Record<MarketIntelConfidence, number> = { high: 2, medium: 1, low: 0 }
  const tiered = Array.from(grouped.values())
    .map(c => ({ candidate: c, confidence: tierConfidence(c.mention_count, c.strongIndicator) }))
    .sort((a, b) => rank[b.confidence] - rank[a.confidence] || b.candidate.mention_count - a.candidate.mention_count)
    .slice(0, MAX_ITEMS)

  const items: MarketIntelItem[] = tiered.map(({ candidate, confidence }) => ({
    statement: candidate.displayStatement,
    category: candidate.category,
    confidence,
    mention_count: candidate.mention_count,
    source_urls: Array.from(candidate.source_urls),
  }))

  return {
    items,
    sufficiency: 'sufficient',
    reason: `${items.length} of ${grouped.size} raw candidate(s) survived filtering`,
    candidates_considered: candidatesConsidered,
    rejected_candidates: rejected,
  }
}
