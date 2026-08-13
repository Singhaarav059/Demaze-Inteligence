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
import { filterRelevantResults, filterTopicallyRelevantResults, extractQueryTopic, looksLikeSentenceFragment, toQueryPhrase, filterAdversarialContent } from './extraction-guards'
import type { CompanyBusinessProfile } from '@/lib/pipeline/business-profile'
import { getCompletion } from '@/lib/ai/provider-factory'
import { verifyQuoteInContent, type QuoteMatchTier } from '@/lib/pipeline/quote-verification'

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
  // Business-understanding rebuild (2026-07-16) — LLM-narrated, tier must be
  // justified by the segment's evidence + fit with the researched company's
  // business profile (services/capabilities), never an arbitrary guess.
  // Tiers only (no raw 0-100 score) — consistent with every other
  // confidence-style field in this codebase.
  use_cases?: string
  market_attractiveness?: 'high' | 'medium' | 'low'
  priority?: 'high' | 'medium' | 'low'
  confidence: ICPConfidence
  source_urls: string[]
  // AI direct-knowledge rebuild (2026-08-13) — same field/rationale as
  // CompetitorProfile.source in competitor-discovery.ts. 'ai_knowledge'
  // entries have no search snippet to cite (source_urls always []).
  // 'search_synthesis' (added same day) = discoverICPSegmentsViaSearchSynthesis's
  // LLM-reads-real-search-results pass — source_urls populated from
  // wherever the quote-verified evidence actually came from.
  source?: 'search' | 'ai_knowledge' | 'search_synthesis'
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
  // Possessive pronouns — same filler-word class as 'various'/'multiple'
  // above. Found live 2026-07-16 against demazetech.com: "our clients"
  // survived because 'our' wasn't in this set, so the all-words-generic
  // check ('clients' alone is generic) never triggered on the full phrase.
  'our', 'their', 'its', 'your', 'my', 'his', 'her',
])

export function normalizeSegmentName(name: string): string {
  // \p{L}/\p{N} (Unicode letter/number), not \w — same 2026-07-24 fix as
  // website-discovery.ts's normalizeCompanyName() (a real accented segment
  // name would otherwise be mangled the same way "Möller Group" was).
  return name.toLowerCase().replace(/[^\p{L}\p{N}\s&-]/gu, ' ').replace(/\s+/g, ' ').trim()
}

// Returns a rejection reason, or null if the candidate survives. Order
// matters for diagnostic quality, same discipline as competitor-discovery.ts's
// classifyRejection().
export function classifySegmentRejection(name: string, companyName: string): string | null {
  if (isSelfName(name, companyName)) {
    return 'self-name (this is the researched company itself, not a customer segment)'
  }
  if (looksLikeSentenceFragment(name)) {
    return 'looks like a sentence fragment, not a real segment name'
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

// Heading-style list content — the trigger phrase IS the whole heading
// ("Industries We Serve.") and each list item is its own short "sentence"
// afterward ("Healthcare. Telemedicine Platforms. Electronic Health
// Records (EHR)...") rather than a comma-separated list inside one
// sentence. Found live 2026-07-16 against demazetech.com's real scraped
// content: the inline-list window in extractSegmentsAfterTrigger came back
// empty because the character right after the trigger match IS the period
// ending the heading itself, so `after.search(/[.!?]/)` returns 0 before
// any real content is captured — a real, reproducible false negative, not
// a hypothetical case.
// Requires at least one sentence-ending mark right after (optional)
// leading whitespace — NOT bare whitespace alone, which would wrongly
// swallow the normal "Customers include hospitals..." case (the space
// between "include" and "hospitals" is whitespace with no punctuation,
// and must fall through to the inline comma-list branch below).
const LEADING_HEADING_PUNCTUATION = /^\s*[.!?]+\s*/

// Email addresses / bare domains (e.g. "contact@demazetech.com") contain a
// period that isn't a sentence boundary — splitting on /[.!?]+/ below treats
// it as one anyway, producing a junk fragment made of just the TLD ("com").
// Found live 2026-07-16 against demazetech.com's own "Industries We Serve."
// heading, which is immediately followed by a mailto-style contact line in
// the same search snippet; confirmed by the LLM's own narration on the bad
// segment: "Appears to be a parsing artifact from 'contact@demazetech.com'".
// Stripped before either extraction branch runs, not just the heading-list
// one, since the same period-inside-a-domain shape could just as easily land
// in the inline comma-list branch.
const EMAIL_OR_DOMAIN = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g

// A period-delimited "sentence" this far into the heading either isn't a
// list item anymore (real prose resumed) or is page-chrome boilerplate —
// stop collecting rather than risk absorbing junk. Checked BEFORE the
// word-count cutoff since boilerplate like "Demaze Technologies © 2025" is
// short enough to otherwise pass it.
const BOILERPLATE_LIST_ITEM = /©|all rights reserved/i
const MAX_HEADING_LIST_WORDS = 6
const MAX_HEADING_LIST_ITEMS = 8

function extractHeadingStyleList(after: string): string[] {
  const items: string[] = []
  for (const raw of after.split(/[.!?]+/)) {
    const item = raw.trim()
    if (!item) continue
    if (BOILERPLATE_LIST_ITEM.test(item)) break
    if (item.split(/\s+/).filter(Boolean).length > MAX_HEADING_LIST_WORDS) break
    items.push(item)
    if (items.length >= MAX_HEADING_LIST_ITEMS) break
  }
  return items
}

export function extractSegmentsAfterTrigger(text: string): string[] {
  const m = SEGMENT_LIST_TRIGGER.exec(text)
  if (!m) return []
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 200).replace(EMAIL_OR_DOMAIN, ' ')

  const leadingPunct = LEADING_HEADING_PUNCTUATION.exec(after)
  if (leadingPunct && leadingPunct[0].length > 0) {
    return extractHeadingStyleList(after.slice(leadingPunct[0].length)).filter(s => s.length >= 3 && s.length <= 50)
  }

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

// Grounds ICP search in what the researched company actually SELLS
// (lib/pipeline/service-offerings.ts) instead of relying only on the
// company's own site explicitly stating "we serve X" — a company that never
// uses that phrasing can still surface real buyer segments this way. Same
// bounded-supplement shape as competitor-discovery.ts's
// buildOfferingCompetitorQueries.
export function buildOfferingICPQueries(offerings: string[]): string[] {
  return offerings.slice(0, 2).map(o => `who needs "${toQueryPhrase(o)}"`)
}

// Business-understanding rebuild (2026-07-16) — richer "who needs X" query
// set drawn from business-profile.ts's structured extraction (services +
// problems solved + business outcomes) instead of the narrower
// service-offerings.ts phrase list. Runs ALONGSIDE discoverICPSegments()'s
// self-referential "we serve X" base pass (that pass is a legitimate,
// separate source — Target Segments genuinely does include industries the
// company states it serves — not the flagged problem; only Competitor
// Discovery's name-based pass was). Supersedes buildOfferingICPQueries as
// the default supplementary source in route.ts; that function stays
// exported as a fallback for when no business profile is available.
export function buildBusinessProfileICPQueries(profile: CompanyBusinessProfile): string[] {
  const phrases = [...profile.services, ...profile.problems_solved, ...profile.business_outcomes]
  return phrases.slice(0, 3).map(p => `who needs "${toQueryPhrase(p)}"`)
}

// ── Main export ───────────────────────────────────────────────────

const MAX_SEGMENTS = 5
const MAX_SNIPPETS_PER_CANDIDATE = 2

// Shared core, same split as competitor-discovery.ts's runCompetitorDiscovery.
// requireCompanyMention must be OFF for the offering-grounded pass, same
// reasoning as runCompetitorDiscovery's header comment: a query like
// `who needs "cloud architecture"` is deliberately searching for OTHER
// companies' pages, so requiring the researched company's own name to
// appear discards every legitimate result by construction. Found live
// 2026-07-16 running demazetech.com: the offering pass returned 15 real
// results, 100% filtered out by this gate before extraction ran.
// Extracted 2026-08-13 from runICPDiscovery's own body (unchanged
// behavior/messages) — same reasoning as competitor-discovery.ts's
// identical extraction, so discoverICPSegmentsViaSearchSynthesis below can
// reuse this fetch+relevance-filter step instead of duplicating it a third
// time.
async function fetchRelevantICPSearchResults(
  queries: string[],
  companyName: string,
  emptyQueriesReason: string,
  requireCompanyMention: boolean,
): Promise<
  | { results: Array<{ title: string; url: string; content: string }>; rawResultCount: number }
  | { insufficientReason: string }
> {
  const tavilyKey = process.env.TAVILY_API_KEY
  const serperKey = process.env.SERPER_API_KEY

  if (!tavilyKey && !serperKey) return { insufficientReason: 'no search API configured' }
  if (!companyName || companyName.trim().length === 0) {
    return { insufficientReason: 'no company name available to search for customer segments' }
  }
  if (queries.length === 0) return { insufficientReason: emptyQueriesReason }

  let resultsPerQuery: Array<Array<{ title: string; url: string; content: string }>>
  let allResults: Array<{ title: string; url: string; content: string }>
  try {
    resultsPerQuery = await Promise.all(queries.map(q => searchWithFallback(q, tavilyKey, serperKey)))
    allResults = resultsPerQuery.flat()
  } catch (e) {
    return { insufficientReason: `search failed: ${e instanceof Error ? e.message : String(e)}` }
  }

  if (allResults.length === 0) {
    return { insufficientReason: 'search returned no results for any ICP query' }
  }

  // Relevance gate. Two different shapes depending on which pass this is:
  //  - requireCompanyMention=true (self-referential "we serve X" base
  //    pass): drop any result that doesn't actually mention the researched
  //    company. Tavily/Serper's quoted-phrase queries don't reliably
  //    enforce this themselves (see extraction-guards.ts header for the
  //    live 2026-07-16 failure this fixes); without it, extraction runs on
  //    off-topic pages (a different company's own "industries we serve"
  //    page, unrelated social posts) and pulls their prose as if it
  //    described the researched company's customers.
  //  - requireCompanyMention=false (offering-grounded pass): the researched
  //    company's own name is deliberately NOT required (see this function's
  //    header comment) — instead, each query's own results are checked for
  //    topical overlap with the offering/problem/outcome phrase THAT query
  //    searched for (filterTopicallyRelevantResults/extractQueryTopic, see
  //    extraction-guards.ts). Without this, there was no relevance check at
  //    all on this path — same real gap found live 2026-07-18 as
  //    competitor-discovery.ts's identical requireCompanyMention=false
  //    pass (an unrelated "Top Data Analytics Companies" listicle for an
  //    industrial-IoT company).
  const rawResultCount = allResults.length
  const filtered = requireCompanyMention
    ? filterRelevantResults(allResults, companyName)
    : resultsPerQuery.flatMap((results, i) => filterTopicallyRelevantResults(results, [extractQueryTopic(queries[i])]))

  if (filtered.length === 0) {
    return {
      insufficientReason: requireCompanyMention
        ? `${rawResultCount} result(s) found but none mention "${companyName}" by name`
        : `${rawResultCount} result(s) found but none were topically relevant to the searched offering(s)`,
    }
  }

  // Adversarial-content gate (2026-08-13) — same fix, same reasoning, as
  // competitor-discovery.ts's identical addition. This is literally the
  // module that surfaced the bug live: a Facebook "SCAM" page's real,
  // genuinely-relevant, genuinely-quotable content about a fraud
  // allegation was misread as evidence of an "Investors" customer segment
  // — see extraction-guards.ts's looksLikeAdversarialContent header.
  const relevantCount = filtered.length
  const clean = filterAdversarialContent(filtered)
  if (clean.length === 0) {
    return { insufficientReason: `${relevantCount} relevant result(s) found but all were excluded as scam/fraud/complaint content, not legitimate customer-segment evidence` }
  }

  return { results: clean, rawResultCount }
}

async function runICPDiscovery(
  queries: string[],
  companyName: string,
  domain: string,
  emptyQueriesReason: string,
  requireCompanyMention: boolean = true,
): Promise<ICPDiscoveryResult> {
  // domain unused for extraction itself (segments are names, not URLs) but
  // kept as a parameter for parity with discoverCompetitors/discoverAndFetchExternalSources.
  void domain

  const fetchResult = await fetchRelevantICPSearchResults(queries, companyName, emptyQueriesReason, requireCompanyMention)
  if ('insufficientReason' in fetchResult) {
    return { segments: [], candidates: [], sufficiency: 'insufficient', reason: fetchResult.insufficientReason, candidates_considered: 0 }
  }
  const allResults = fetchResult.results

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
    source: 'search',
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

export async function discoverICPSegments(
  companyName: string,
  domain: string,
): Promise<ICPDiscoveryResult> {
  return runICPDiscovery(
    buildICPQueries(companyName),
    companyName,
    domain,
    'no company name available to search for customer segments',
  )
}

// Supplementary pass (see route.ts) — run once evidence extraction has
// surfaced what the researched company actually sells. Same pipeline as
// discoverICPSegments, grounded in offering phrases instead of "we serve"
// framing alone.
export async function discoverICPSegmentsFromOfferings(
  companyName: string,
  domain: string,
  offerings: string[],
): Promise<ICPDiscoveryResult> {
  return runICPDiscovery(
    buildOfferingICPQueries(offerings),
    companyName,
    domain,
    'no company offerings extracted to search from',
    false,
  )
}

// Business-understanding rebuild (2026-07-16) — preferred supplementary pass
// in route.ts going forward (discoverICPSegmentsFromOfferings above is the
// fallback when no business profile is available). Merged alongside
// discoverICPSegments()'s self-referential base pass, never replacing it.
export async function discoverICPSegmentsFromBusinessProfile(
  companyName: string,
  domain: string,
  profile: CompanyBusinessProfile,
): Promise<ICPDiscoveryResult> {
  return runICPDiscovery(
    buildBusinessProfileICPQueries(profile),
    companyName,
    domain,
    'no business profile available to search from',
    false,
  )
}

// Merges a supplementary result into a base result — same
// dedupe-by-normalized-name + re-rank shape as
// competitor-discovery.ts's mergeCompetitorResults.
export function mergeICPResults(
  base: ICPDiscoveryResult,
  supplement: ICPDiscoveryResult,
): ICPDiscoveryResult {
  if (supplement.segments.length === 0) return base

  const existingNames = new Set(base.segments.map(s => normalizeSegmentName(s.name)))
  const newSegments = supplement.segments.filter(s => !existingNames.has(normalizeSegmentName(s.name)))
  const newCandidates = supplement.candidates.filter(c => !existingNames.has(normalizeSegmentName(c.name)))
  if (newSegments.length === 0) return base

  const rank: Record<ICPConfidence, number> = { high: 2, medium: 1, low: 0 }
  const mergedSegments = [...base.segments, ...newSegments]
    .sort((a, b) => rank[b.confidence] - rank[a.confidence])
    .slice(0, MAX_SEGMENTS)
  const mergedNames = new Set(mergedSegments.map(s => normalizeSegmentName(s.name)))

  return {
    segments: mergedSegments,
    candidates: [...base.candidates, ...newCandidates].filter(c => mergedNames.has(normalizeSegmentName(c.name))),
    sufficiency: 'sufficient',
    reason: `${base.reason} | supplementary pass added ${newSegments.length} more`,
    candidates_considered: base.candidates_considered + supplement.candidates_considered,
    rejected_candidates: [...(base.rejected_candidates ?? []), ...(supplement.rejected_candidates ?? [])],
  }
}

// ============================================================
// AI direct-knowledge ICP discovery (2026-08-13)
// ============================================================
// Same rebuild, same rationale, as competitor-discovery.ts's
// discoverCompetitorsFromKnowledge (see that function's header comment for
// the full history) — applied here after the same live L&T run that
// surfaced the competitor contamination bug also showed a suspicious
// Target Customer Segments list (Education / Financial Services / Law
// Firms / Not-for-Profits / Performing Arts — a textbook AV-integrator
// vertical list, not plausible for a construction conglomerate). The
// self-referential "we serve X" base pass (discoverICPSegments,
// requireCompanyMention=true) is just as exposed to this failure mode as
// competitor discovery's old name-based pass was: mentioning the researched
// company's name somewhere in a result doesn't guarantee the "who we
// serve" language on that page is actually describing THIS company (a
// same-named different company, or a loosely-relevant page that happened
// to pass the mention filter).
//
// Ask the LLM directly instead: real, specific customer segments it has
// confident knowledge this company serves, with an explicit instruction to
// decline (has_knowledge: false) rather than guess.
//
// Wired as the PRIMARY path in route.ts — the existing search pipeline
// (self-referential base pass + business-profile/offering supplement) is
// now the FALLBACK, used only when this function declines. Unlike
// competitor discovery's old architecture, the pre-2026-08-13 ICP pipeline
// always merged two search sources together rather than having one
// "wrong" primary to replace — this function replaces BOTH when it
// succeeds, not just one of them, same as how the competitor rebuild fully
// bypasses its search pipeline on success.
//
// No search snippet exists for this path, so `signals`/`source_urls` are
// always [] and `candidates` is always [] — same reasoning as
// discoverCompetitorsFromKnowledge (the [ICP CANDIDATES] narrative-prompt
// block renders "None found" for these and never re-narrates them;
// normalize.ts's merge falls through to this function's own reason/
// use_cases/market_attractiveness/priority for any LLM-narration-unmatched
// skeleton).

const KNOWLEDGE_SEGMENT_SYSTEM_PROMPT = `You are a market-research assistant with broad knowledge of companies and industries. You only state a target-customer segment you have specific, confident knowledge of — a real, specific type of customer this company is known to sell to, not a generic guess based on its industry alone. When you do not have specific, confident knowledge of a company, you say so honestly instead of guessing.`

function buildKnowledgeSegmentUserPrompt(companyName: string, domain: string): string {
  return `
Company: ${companyName}${domain ? `\nWebsite: ${domain}` : ''}

List the real target customer segments THIS company sells to — who actually buys from them (e.g. "automotive OEMs", "mid-market financial institutions", "hospitals and health systems"). Describe WHO buys, not what the company itself does.

Only include a segment if you have specific, confident knowledge that this company genuinely serves that type of customer — not a generic guess based on its industry alone (e.g. do not guess "small businesses" just because it is a B2B company).

If you do not have specific, confident knowledge of THIS company's actual customer base, respond with "has_knowledge": false and an empty segments array. Do not guess or invent plausible-sounding segments in that case.

Return ONLY this JSON object, no other text:
{
  "has_knowledge": true or false,
  "segments": [
    {
      "name": "Short segment name, e.g. 'Automotive OEMs' or 'Mid-market manufacturers'",
      "reason": "1-2 sentences explaining why this is a real segment this company serves",
      "use_case": "short description of how this segment specifically uses the company's product/service",
      "criteria": "short qualifying description of this segment, e.g. '$10M+ capex projects' or 'government/PSU only' — empty string if you don't have a specific criterion",
      "example_companies": ["Real Named Client 1", "Real Named Client 2"] — ONLY real, specific, publicly-known clients/customers of THIS company that you are confident actually exist; empty array if you don't have specific named examples — never invent a plausible-sounding company name here,
      "priority": "high" or "medium" or "low" — how significant this segment is to the company's business,
      "confident": true or false
    }
  ]
}

Rules:
- Maximum ${MAX_SEGMENTS} segments, ordered most-significant first.
- Never describe the company's own products/services here — only WHO buys from them.
- "confident": true only when you have specific knowledge of this exact relationship; false for a real but less certain inference.
- "example_companies" is the highest-risk field to get wrong — a named client is a specific, checkable claim. Leave it an empty array unless you are certain, even if "confident" is otherwise true for the segment as a whole.
`.trim()
}

interface KnowledgeSegmentRaw {
  name?: unknown
  reason?: unknown
  use_case?: unknown
  criteria?: unknown
  example_companies?: unknown
  priority?: unknown
  confident?: unknown
}

/**
 * Asks the LLM directly for target-customer segments it has specific,
 * confident knowledge of — the primary ICP-discovery path as of 2026-08-13
 * (see the header comment above this function for why). Never throws;
 * returns sufficiency: 'insufficient' on any failure, decline, or
 * all-filtered result — route.ts falls back to the search pipeline in that
 * case.
 */
export async function discoverICPSegmentsFromKnowledge(
  companyName: string,
  domain: string,
): Promise<ICPDiscoveryResult> {
  if (!companyName || companyName.trim().length === 0) {
    return { segments: [], candidates: [], sufficiency: 'insufficient', reason: 'no company name available to ask about', candidates_considered: 0 }
  }

  let response
  try {
    response = await getCompletion({
      systemPrompt: KNOWLEDGE_SEGMENT_SYSTEM_PROMPT,
      userPrompt: buildKnowledgeSegmentUserPrompt(companyName, domain),
      maxTokens: 2048,
      temperature: 0.2,
      jsonMode: true,
    })
  } catch (e) {
    return {
      segments: [], candidates: [], sufficiency: 'insufficient',
      reason: `AI direct-knowledge call failed: ${e instanceof Error ? e.message : String(e)}`,
      candidates_considered: 0,
    }
  }

  let parsed: { has_knowledge?: unknown; segments?: unknown }
  try {
    const trimmed = response.content.trim()
    const stripped = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const start = stripped.indexOf('{')
    const end = stripped.lastIndexOf('}')
    parsed = JSON.parse(start !== -1 && end > start ? stripped.slice(start, end + 1) : stripped)
  } catch (e) {
    return {
      segments: [], candidates: [], sufficiency: 'insufficient',
      reason: `AI direct-knowledge response unparseable: ${e instanceof Error ? e.message : String(e)}`,
      candidates_considered: 0,
    }
  }

  if (parsed.has_knowledge !== true || !Array.isArray(parsed.segments) || parsed.segments.length === 0) {
    return {
      segments: [], candidates: [], sufficiency: 'insufficient',
      reason: 'LLM declined (has_knowledge=false or empty list) — no confident direct knowledge of this company\'s customer segments',
      candidates_considered: Array.isArray(parsed.segments) ? parsed.segments.length : 0,
    }
  }

  const raw = parsed.segments as KnowledgeSegmentRaw[]
  const rejected: Array<{ name: string; reason: string }> = []
  const survivors: ICPSegment[] = []
  const validPriority = (v: unknown): 'high' | 'medium' | 'low' | undefined =>
    (v === 'high' || v === 'medium' || v === 'low') ? v : undefined

  for (const item of raw) {
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name) continue
    // Same safety net every search-extracted segment already goes through
    // (self-name/generic-term) — a real LLM-named segment must never
    // literally be the researched company's own name.
    const rejectReason = classifySegmentRejection(name, companyName)
    if (rejectReason) {
      rejected.push({ name, reason: rejectReason })
      continue
    }
    const reason = typeof item.reason === 'string' ? item.reason.trim() : ''
    const useCase = typeof item.use_case === 'string' ? item.use_case.trim() : ''
    const criteria = typeof item.criteria === 'string' ? item.criteria.trim() : ''
    const priority = validPriority(item.priority)
    const isConfident = item.confident === true
    // example_companies is gated on isConfident IN CODE, not just the
    // prompt instruction — a named client is a specific, checkable claim
    // (the riskiest field this function emits), so it gets an extra guard
    // beyond "the model was told to be careful." Applies even if the model
    // returns names alongside confident: false; criteria (a qualifying
    // description, not a named entity) doesn't carry the same fabrication
    // risk and isn't gated the same way.
    const exampleCompanies = isConfident && Array.isArray(item.example_companies)
      ? item.example_companies.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.trim()).slice(0, 5)
      : []
    survivors.push({
      name,
      reason: reason || `AI-assessed target segment${useCase ? ` (${useCase})` : ''}.`,
      signals: [],
      criteria: criteria || undefined,
      example_companies: exampleCompanies.length > 0 ? exampleCompanies : undefined,
      use_cases: useCase || undefined,
      market_attractiveness: priority,
      priority,
      confidence: isConfident ? 'high' : 'medium',
      source_urls: [],
      source: 'ai_knowledge',
    })
  }

  const capped = survivors.slice(0, MAX_SEGMENTS)

  if (capped.length === 0) {
    return {
      segments: [], candidates: [], sufficiency: 'insufficient',
      reason: `LLM returned ${raw.length} candidate(s) but all were rejected (self-name/generic)`,
      candidates_considered: raw.length,
      rejected_candidates: rejected,
    }
  }

  return {
    segments: capped,
    candidates: [],
    sufficiency: 'sufficient',
    reason: `AI direct-knowledge: ${capped.length} of ${raw.length} confidently-known segment(s) survived filtering`,
    candidates_considered: raw.length,
    rejected_candidates: rejected.length > 0 ? rejected : undefined,
  }
}

// ============================================================
// Search-grounded LLM synthesis (2026-08-13)
// ============================================================
// Same rebuild, same motivation, as competitor-discovery.ts's
// discoverCompetitorsViaSearchSynthesis — see that function's header
// comment for the full history (the AS Agri and Aqua / Gemini-app-search-
// grounding investigation). Fetches real search results (reusing
// fetchRelevantICPSearchResults, the exact fetch+relevance-filter step
// runICPDiscovery's base pass already uses) and asks an LLM to synthesize
// target-customer segments STRICTLY from that content, with every claim
// mechanically quote-verified via verifyQuoteInContent() before being
// trusted — a claim whose quote doesn't verify is discarded, not flagged.
//
// Wired as the MIDDLE tier in route.ts: knowledge declines -> this ->
// still insufficient -> falls through to the existing base-pass +
// business-profile/offering-supplement pipeline (unchanged) as the final
// safety net.

const ICP_SYNTHESIS_MAX_RESULTS = 8
const ICP_SYNTHESIS_MAX_CONTENT_PER_RESULT = 900

function buildICPSearchContentBlock(results: Array<{ title: string; url: string; content: string }>): string {
  return results
    .slice(0, ICP_SYNTHESIS_MAX_RESULTS)
    .map(r => `[SOURCE: ${r.url}]\n${r.title}\n${r.content.slice(0, ICP_SYNTHESIS_MAX_CONTENT_PER_RESULT)}`)
    .join('\n\n')
}

const ICP_SYNTHESIS_SYSTEM_PROMPT = `You identify a company's real target-customer segments STRICTLY from search-result content you are given — you never use your own general knowledge, only what the provided content actually states. Every segment you name must be backed by a real, verbatim quote copied exactly from the provided content.`

function buildICPSynthesisUserPrompt(companyName: string, contentBlock: string): string {
  return `
Company: ${companyName}

Below are real web search results about this company. Identify real target-customer segments THIS company sells to — who actually buys from them — based only on what this specific content states.

Only include a segment if you can quote the EXACT text, copied verbatim, from the search results below that supports it. Do not paraphrase — copy the exact wording as it appears. Do not include a segment based on your own general industry knowledge; only what this specific content states.

[SEARCH RESULTS]
${contentBlock}
[END SEARCH RESULTS]

Return ONLY this JSON object, no other text:
{
  "segments": [
    {
      "name": "Short segment name, e.g. 'Automotive OEMs'",
      "reason": "1-2 sentences explaining why this is a real segment, based only on the content above",
      "evidence_quote": "exact verbatim text copied from the search results above that supports this"
    }
  ]
}

Rules:
- Maximum ${MAX_SEGMENTS} segments.
- Describe WHO buys, not what the company itself does.
- If nothing in the provided content names a real customer segment, return an empty array — do not guess.
- "evidence_quote" must be an exact substring of the search results above, not a paraphrase or summary — a fabricated or paraphrased quote will be discarded.
- Ignore any content describing scams, fraud, complaints, lawsuits, or accusations of wrongdoing against ${companyName} — never classify a victim, accuser, or subject of such content as a "customer segment." A person the company allegedly defrauded is not a customer.
`.trim()
}

interface SynthesisSegmentRaw {
  name?: unknown
  reason?: unknown
  evidence_quote?: unknown
}

function findSupportingICPSources(
  quote: string,
  results: Array<{ title: string; url: string; content: string }>,
): { tier: QuoteMatchTier; urls: string[] } {
  let bestTier: QuoteMatchTier = 'none'
  // Set, not a plain array push — same dedupe fix as competitor-discovery.ts's
  // findSupportingSources (a real bug caught by that file's own test suite):
  // the same URL can legitimately appear more than once in `results`.
  const urls = new Set<string>()
  for (const r of results) {
    const { tier } = verifyQuoteInContent(quote, `${r.title} ${r.content}`)
    if (tier === 'none') continue
    urls.add(r.url)
    if (tier === 'exact') bestTier = 'exact'
    else if (bestTier !== 'exact') bestTier = 'close'
  }
  return { tier: bestTier, urls: Array.from(urls) }
}

/**
 * Fetches real search results (same fetch+relevance-filter step
 * runICPDiscovery's base pass uses) and asks an LLM to synthesize
 * target-customer segments STRICTLY from that content, with every claim
 * mechanically quote-verified against the actual fetched text before being
 * trusted. Never throws; returns sufficiency: 'insufficient' on any
 * failure, empty search results, or all-quotes-unverified outcome —
 * route.ts falls back to the base+supplement search pipeline in that case.
 */
export async function discoverICPSegmentsViaSearchSynthesis(
  companyName: string,
  domain: string,
): Promise<ICPDiscoveryResult> {
  const fetchResult = await fetchRelevantICPSearchResults(
    buildICPQueries(companyName),
    companyName,
    'no company name available to search for customer segments',
    true,
  )
  if ('insufficientReason' in fetchResult) {
    return { segments: [], candidates: [], sufficiency: 'insufficient', reason: fetchResult.insufficientReason, candidates_considered: 0 }
  }
  const { results } = fetchResult
  void domain

  let response
  try {
    response = await getCompletion({
      systemPrompt: ICP_SYNTHESIS_SYSTEM_PROMPT,
      userPrompt: buildICPSynthesisUserPrompt(companyName, buildICPSearchContentBlock(results)),
      maxTokens: 2048,
      temperature: 0.1,
      jsonMode: true,
    })
  } catch (e) {
    return {
      segments: [], candidates: [], sufficiency: 'insufficient',
      reason: `search-synthesis call failed: ${e instanceof Error ? e.message : String(e)}`,
      candidates_considered: 0,
    }
  }

  let parsed: { segments?: unknown }
  try {
    const trimmed = response.content.trim()
    const stripped = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    const start = stripped.indexOf('{')
    const end = stripped.lastIndexOf('}')
    parsed = JSON.parse(start !== -1 && end > start ? stripped.slice(start, end + 1) : stripped)
  } catch (e) {
    return {
      segments: [], candidates: [], sufficiency: 'insufficient',
      reason: `search-synthesis response unparseable: ${e instanceof Error ? e.message : String(e)}`,
      candidates_considered: 0,
    }
  }

  if (!Array.isArray(parsed.segments) || parsed.segments.length === 0) {
    return {
      segments: [], candidates: [], sufficiency: 'insufficient',
      reason: 'search-synthesis found no customer segment named in the fetched search content',
      candidates_considered: 0,
    }
  }

  const raw = parsed.segments as SynthesisSegmentRaw[]
  const rejected: Array<{ name: string; reason: string }> = []
  const survivors: ICPSegment[] = []

  for (const item of raw) {
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name) continue
    const rejectReason = classifySegmentRejection(name, companyName)
    if (rejectReason) {
      rejected.push({ name, reason: rejectReason })
      continue
    }
    const quote = typeof item.evidence_quote === 'string' ? item.evidence_quote.trim() : ''
    const { tier, urls } = quote ? findSupportingICPSources(quote, results) : { tier: 'none' as QuoteMatchTier, urls: [] }
    if (tier === 'none') {
      rejected.push({ name, reason: 'evidence quote could not be verified against the search content it was shown' })
      continue
    }
    const reason = typeof item.reason === 'string' ? item.reason.trim() : ''
    survivors.push({
      name,
      reason: reason || `Found via search-grounded synthesis: "${quote.slice(0, 150)}"`,
      signals: [quote.slice(0, 300)],
      confidence: tier === 'exact' ? 'high' : 'medium',
      source_urls: urls,
      source: 'search_synthesis',
    })
  }

  const capped = survivors.slice(0, MAX_SEGMENTS)

  if (capped.length === 0) {
    return {
      segments: [], candidates: [], sufficiency: 'insufficient',
      reason: `LLM returned ${raw.length} candidate(s) but all were rejected (self-name/generic/unverified quote)`,
      candidates_considered: raw.length,
      rejected_candidates: rejected,
    }
  }

  return {
    segments: capped,
    candidates: [],
    sufficiency: 'sufficient',
    reason: `search-synthesis: ${capped.length} of ${raw.length} candidate(s) survived quote verification`,
    candidates_considered: raw.length,
    rejected_candidates: rejected.length > 0 ? rejected : undefined,
  }
}
