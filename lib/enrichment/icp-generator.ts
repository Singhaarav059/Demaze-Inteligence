// ============================================================
// ICP Generator (Roadmap Phase 2, item 2) — 2026-07-15
// ============================================================
// Given an already-researched company, surface WHO THAT COMPANY sells to —
// named target-customer segments with reason/signals/buying indicators. This
// is NOT company_fit (lib/pipeline/scorer.ts), which scores "is this company
// a good lead FOR DEMAZE" as a single 0-100 number. This module answers a
// different question in the opposite direction: "who does the researched
// company itself sell to." No code overlap with company_fit's scoring logic
// — this produces a structurally different output (named segments), not a
// second "fit" score. See CLAUDE.md "SCOPE PIVOT" / docs/ROADMAP.md item 2.
//
// Also NOT the Company Discovery Engine (Roadmap item 3, ICP -> matching
// companies) — that's a separate, later item that will consume this one's
// segments as input, not build them.
//
// Architecture mirrors lib/enrichment/competitor-discovery.ts exactly (that
// file is documented as "the reference pattern for any future
// deterministic-list + LLM-narration feature" — see docs/DECISIONS.md):
// search-grounded, not LLM-narrated. Every segment NAME below comes only
// from search-result regex extraction, never from an LLM. The LLM (via the
// [ICP CANDIDATES] prompt block in analyze-v2.ts) only narrates
// reason/criteria/buying_indicators for segment names already in this
// code-derived list — same anti-hallucination discipline as competitors and
// deterministic_opportunities. `confidence` is always code-derived, never an
// LLM output field. LLM-only entries with no code-derived match are
// discarded by normalize.ts's merge step, not accepted.
//
// Governing principle, same as website-discovery.ts and competitor-discovery.ts:
// prefer under-confidence to over-confidence. A wrongly-named "segment" is
// worse than an honest empty list — filtering rejects aggressively rather
// than guessing.
// ============================================================

import { searchTavily, searchSerper } from './discovery-engine'
import { isSelfName } from './competitor-discovery'

export type ICPConfidence = 'high' | 'medium' | 'low'
export type ICPSufficiency = 'sufficient' | 'insufficient'

// Raw candidate, pre-filter — one per segment name surfaced by search,
// before the self-name/generic-term/too-short filter runs. Kept distinct
// from ICPSegment so the filter step has something to discard without
// mutating the final shape, same reason CompetitorCandidate stays separate
// from CompetitorProfile.
export interface ICPCandidate {
  name: string
  mention_count: number          // independent search results naming this segment
  source_urls: string[]
  snippets: string[]             // raw search snippets, for the [ICP CANDIDATES] LLM-narration input block
  explicit_serve_framing: boolean // true if a result used explicit "we serve" / "clients include" / "industries served" framing
}

// Final, filtered shape — one per surfaced target-customer segment.
// Additive to NormalizedAnalysis (see normalize.ts).
export interface ICPSegment {
  name: string
  // LLM-narrated, but constrained to only describe segment names already in
  // this code-derived list — the LLM never introduces a new segment. Same
  // anti-hallucination discipline as CompetitorProfile.why_they_compete.
  reason: string
  criteria?: string             // e.g. "multi-location, revenue $10M+" — only if evidence states it, never guessed
  signals: string[]             // evidence snippets backing this segment
  buying_indicators?: string    // what would trigger this segment's interest — only if evidence states it
  example_companies?: string[]  // named companies only if explicitly mentioned in evidence, never invented
  confidence: ICPConfidence
  source_urls: string[]
}

// Top-level result of discoverICPSegments(). Mirrors CompetitorDiscoveryResult's
// segments+candidates+sufficiency+reason shape.
export interface ICPDiscoveryResult {
  segments: ICPSegment[]
  // Same survivors as `segments`, same order, pre-final-shaping — carries
  // the mention_count/snippets/explicit_serve_framing fields the
  // [ICP CANDIDATES] prompt block needs to give the LLM grounding to narrate
  // from. `segments[i].name === candidates[i].name` for every i.
  candidates: ICPCandidate[]
  sufficiency: ICPSufficiency
  reason: string                 // human-readable summary for gate diagnostics/logs — feeds the ICP gate's reason argument
  candidates_considered: number  // pre-filter candidate count, for diagnostics
  rejected_candidates?: Array<{ name: string; reason: string }>
}

// ── Rejection rules ───────────────────────────────────────────────

// Generic terms that are themselves the trigger vocabulary or too vague to
// be a real segment (e.g. a "customers include..." result that dead-ends on
// the word "businesses" itself). Same STOPWORDS-repeats-the-trigger-word bug
// class documented in competitor-discovery.ts (found live 2026-07-15,
// "Alternatives" self-matching its own trigger).
const GENERIC_SEGMENT_TERMS = new Set([
  'clients', 'customers', 'companies', 'businesses', 'organizations',
  'industries', 'sectors', 'verticals', 'markets', 'partners', 'users',
  'them', 'us', 'you', 'various', 'multiple', 'several', 'many', 'others',
  'products', 'services', 'solutions', 'the world', 'the globe', 'worldwide',
])

function normalizeSegmentName(name: string): string {
  return name.toLowerCase().replace(/[^\w\s&-]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Returns a rejection reason, or null if the candidate survives. Order
// matters for diagnostic quality, same discipline as competitor-discovery.ts's
// classifyRejection().
export function classifySegmentRejection(name: string, companyName: string): string | null {
  if (isSelfName(name, companyName)) {
    return 'self-name (this is the researched company itself, not a customer segment)'
  }
  const normalized = normalizeSegmentName(name)
  if (!normalized || normalized.length < 3) {
    return 'too short/generic to be a real segment name'
  }
  if (GENERIC_SEGMENT_TERMS.has(normalized)) {
    return 'generic/stopword term, not a specific segment'
  }
  const words = normalized.split(' ').filter(Boolean)
  if (words.every(w => GENERIC_SEGMENT_TERMS.has(w))) {
    return 'generic/stopword phrase, not a specific segment'
  }
  return null
}

// ── Candidate-name extraction (regex, no LLM) ────────────────────
// One extraction strategy: a list of segment names following explicit
// serve/customer framing ("industries we serve", "clients include",
// "serving the X industry", "customers range from"). Anchored on explicit
// language so we never pull arbitrary noun phrases out of unrelated prose.
// Unlike competitor names (proper nouns), segment names are frequently
// lowercase industry terms ("automotive manufacturers", "food and
// beverage") — so extraction splits a delimited list rather than matching
// PROPER_NOUN shapes.

const SEGMENT_LIST_TRIGGER =
  /\b(?:industries|sectors|verticals)\s+(?:we\s+serve|served|include[sd]?|including|are|across|spanning)\b|\b(?:clients?|customers?)\s+(?:include[sd]?|including|across|are|range\s+from)\b|\bserving\s+(?:the\s+)?/i

// Idiomatic two-word industry terms where "and" is part of the name, not a
// list separator (found live 2026-07-15 — "oil and gas" was being split into
// two segments, "oil" + "gas"). Protected before the naive \band\b split
// below, then restored. Not exhaustive — covers the common cases rather than
// attempting general conjunction-vs-idiom disambiguation.
const COMPOUND_SEGMENT_IDIOMS = [
  'oil and gas', 'food and beverage', 'textile and apparel', 'iron and steel',
  'pulp and paper', 'health and wellness', 'travel and tourism',
  'media and entertainment', 'sales and marketing', 'research and development',
  'arts and crafts', 'hotels and resorts',
]

// Swaps each idiom match for a token containing no "and" substring (so the
// later \band\b split can't see inside it), recording the original text to
// restore after splitting. A prior version tried preserving the idiom by
// replacing only its internal spaces with a placeholder character, but \b
// (a \w/\W transition) still matched "and" on either side of that
// placeholder since the placeholder itself is non-word -- the split still
// broke "oil and gas" apart. A same-token substitution avoids that entirely.
function splitSegmentList(text: string): string[] {
  const idiomMatches: string[] = []
  let protectedText = text
  for (const idiom of COMPOUND_SEGMENT_IDIOMS) {
    const re = new RegExp('\\b' + idiom.replace(/ /g, '\\s+') + '\\b', 'gi')
    protectedText = protectedText.replace(re, (m) => {
      const token = `IDIOM${idiomMatches.length}`
      idiomMatches.push(m)
      return token
    })
  }

  return protectedText
    .split(/,|;|\band\b|&/i)
    .map((s) => {
      let restored = s.replace(/^(?:the|a|an)\s+/i, '').trim()
      idiomMatches.forEach((original, i) => {
        restored = restored.split(`IDIOM${i}`).join(original)
      })
      return restored.trim()
    })
    .filter(Boolean)
}

// A trigger match sometimes leaves a leftover connector word right after it
// (e.g. "industries we serve" matches, but the source text continues
// "...serve include automotive..." — "include" wasn't part of the matched
// trigger). Stripped here as a post-processing step rather than trying to
// enumerate every trigger+connector combination in the regex itself.
const LEFTOVER_CONNECTOR = /^\s*(?:include[sd]?|including|are|range\s+from|across|spanning|of|[:\-])\s*/i

export function extractSegmentsAfterTrigger(text: string): string[] {
  const m = SEGMENT_LIST_TRIGGER.exec(text)
  if (!m) return []
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 200)
  const stopAt = after.search(/[.!?]/)
  const window = (stopAt >= 0 ? after.slice(0, stopAt) : after).replace(LEFTOVER_CONNECTOR, '')
  return splitSegmentList(window).filter(s => s.length >= 3 && s.length <= 50)
}

// ── Confidence tiering ────────────────────────────────────────────

export function tierConfidence(c: ICPCandidate): ICPConfidence {
  if (c.mention_count >= 2 && c.explicit_serve_framing) return 'high'
  if ((c.mention_count >= 2 && !c.explicit_serve_framing) || (c.mention_count === 1 && c.explicit_serve_framing)) return 'medium'
  return 'low'
}

export function fallbackReason(candidate: ICPCandidate): string {
  const snippet = candidate.snippets[0]
  const framing = candidate.explicit_serve_framing
    ? 'named directly as a served customer segment'
    : 'mentioned alongside the company\'s customer base'
  if (snippet) return `Surfaced via search, ${framing}: "${snippet.slice(0, 150)}"`
  return `Surfaced via search, ${framing} in results (no snippet captured).`
}

// ── Search ─────────────────────────────────────────────────────────
// Duplicated per-query Tavily→Serper fallback, same shape as
// competitor-discovery.ts's searchWithFallback — kept as its own copy
// rather than a shared import, matching this codebase's existing precedent.

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

function buildICPQueries(companyName: string): string[] {
  return [
    `"${companyName}" "we serve"`,
    `"${companyName}" clients include`,
    `"${companyName}" industries served`,
    `"${companyName}" customers include`,
    `who does "${companyName}" sell to`,
  ]
}

// ── Main export ───────────────────────────────────────────────────

const MAX_SEGMENTS = 5
const MAX_SNIPPETS_PER_CANDIDATE = 2

export async function discoverICPSegments(
  companyName: string,
  domain: string,
): Promise<ICPDiscoveryResult> {
  const tavilyKey = process.env.TAVILY_API_KEY
  const serperKey = process.env.SERPER_API_KEY

  if (!tavilyKey && !serperKey) {
    return { segments: [], candidates: [], sufficiency: 'insufficient', reason: 'no search API configured', candidates_considered: 0 }
  }
  if (!companyName || companyName.trim().length === 0) {
    return { segments: [], candidates: [], sufficiency: 'insufficient', reason: 'no company name available to search for customer segments', candidates_considered: 0 }
  }

  // domain unused for extraction itself (segments are names, not URLs) but
  // kept as a parameter for parity with discoverCompetitors/discoverAndFetchExternalSources.
  void domain

  const queries = buildICPQueries(companyName)
  let allResults: Array<{ title: string; url: string; content: string }>
  try {
    const resultsPerQuery = await Promise.all(queries.map(q => searchWithFallback(q, tavilyKey, serperKey)))
    allResults = resultsPerQuery.flat()
  } catch (e) {
    return {
      segments: [], candidates: [], sufficiency: 'insufficient',
      reason: `search failed: ${e instanceof Error ? e.message : String(e)}`,
      candidates_considered: 0,
    }
  }

  if (allResults.length === 0) {
    return { segments: [], candidates: [], sufficiency: 'insufficient', reason: 'search returned no results for any ICP query', candidates_considered: 0 }
  }

  // ── Extract + group raw candidates by normalized name ─────────────
  const grouped = new Map<string, { displayName: string; mention_count: number; source_urls: Set<string>; snippets: string[]; explicit_serve_framing: boolean }>()

  for (const r of allResults) {
    const names = [...extractSegmentsAfterTrigger(r.title), ...extractSegmentsAfterTrigger(r.content)]
    const namesInThisResult = new Set(names.map(n => n.trim()).filter(Boolean))

    for (const name of namesInThisResult) {
      const key = normalizeSegmentName(name)
      if (!key) continue
      const existing = grouped.get(key)
      const snippetText = (r.content || r.title).slice(0, 300)
      if (existing) {
        existing.mention_count += 1
        existing.source_urls.add(r.url)
        if (existing.snippets.length < MAX_SNIPPETS_PER_CANDIDATE) existing.snippets.push(snippetText)
        existing.explicit_serve_framing = true
      } else {
        grouped.set(key, {
          displayName: name,
          mention_count: 1,
          source_urls: new Set([r.url]),
          snippets: [snippetText],
          explicit_serve_framing: true,
        })
      }
    }
  }

  // ── Filter ──────────────────────────────────────────────────────
  const rejected: Array<{ name: string; reason: string }> = []
  const survivors: ICPCandidate[] = []

  for (const c of grouped.values()) {
    const rejectReason = classifySegmentRejection(c.displayName, companyName)
    if (rejectReason) {
      rejected.push({ name: c.displayName, reason: rejectReason })
      continue
    }
    survivors.push({
      name: c.displayName,
      mention_count: c.mention_count,
      source_urls: Array.from(c.source_urls),
      snippets: c.snippets,
      explicit_serve_framing: c.explicit_serve_framing,
    })
  }

  if (survivors.length === 0) {
    return {
      segments: [],
      candidates: [],
      sufficiency: 'insufficient',
      reason: `${grouped.size} raw candidate(s) found, all rejected (self-name/generic-term)`,
      candidates_considered: grouped.size,
      rejected_candidates: rejected,
    }
  }

  // ── Confidence tiering + cap ──────────────────────────────────────
  const rank: Record<ICPConfidence, number> = { high: 2, medium: 1, low: 0 }
  const tiered = survivors
    .map(c => ({ candidate: c, confidence: tierConfidence(c) }))
    .sort((a, b) => rank[b.confidence] - rank[a.confidence] || b.candidate.mention_count - a.candidate.mention_count)
    .slice(0, MAX_SEGMENTS)

  const segments: ICPSegment[] = tiered.map(({ candidate, confidence }) => ({
    name: candidate.name,
    reason: fallbackReason(candidate),
    signals: candidate.snippets,
    confidence,
    source_urls: candidate.source_urls,
  }))

  return {
    segments,
    candidates: tiered.map(({ candidate }) => candidate),
    sufficiency: 'sufficient',
    reason: `${segments.length} of ${grouped.size} raw candidate(s) survived filtering`,
    candidates_considered: grouped.size,
    rejected_candidates: rejected,
  }
}
