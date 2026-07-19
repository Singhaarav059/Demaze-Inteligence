// ============================================================
// Competitor Discovery — schema only (2026-07-14, "Competitor Discovery
// Schema" session)
// ============================================================
// Types for Phase 2 item 1 (see Left To Do.md, CLAUDE.md "SCOPE PIVOT",
// Latest Session Handoff.md "Competitor Discovery Engine" architecture).
// Given a company already researched through the existing 4-step pipeline,
// surface who competes with it, why, and how — NOT the Company Discovery
// Engine (item 3, ICP -> matching companies), a separate later item.
//
// Search/HTTP discovery logic is deliberately NOT implemented in this file —
// this session only formalizes the contract so normalize.ts and the future
// route.ts gate can be wired against a stable shape ahead of implementation.
// See "Competitor Discovery Implementation session" in the handoff for what
// discoverCompetitors() itself still needs.
//
// Sibling pattern: same discovery -> candidates -> confidence-tier ->
// sufficiency-gate shape as website-discovery.ts (WebsiteDiscoveryResult)
// and discovery-engine.ts (DiscoveredSource) — reused, not reinvented.
// Evidence-trail convention (rejected_candidates below) follows
// evidence-extractor.ts's factorSourceMap: a debugging trail alongside the
// final output, not just the final output itself.
// ============================================================

export type CompetitorConfidence = 'high' | 'medium' | 'low'
export type CompetitorSufficiency = 'sufficient' | 'insufficient'

// Raw candidate, pre-filter — one per name surfaced by search, before the
// self-name/customer/supplier/certifying-body/news-outlet/industry-association
// filter runs (see architecture decision 4, "Filtering"). Kept distinct from
// CompetitorProfile so the filter step has something to discard without
// mutating the final shape, same reason DetectedSignal stays separate from
// the factors it feeds in evidence-extractor.ts.
export interface CompetitorCandidate {
  name: string
  mention_count: number          // independent search results naming this candidate
  source_urls: string[]
  snippets: string[]             // raw search snippets, for the [COMPETITOR CANDIDATES] LLM-narration input block
  explicit_vs_framing: boolean   // true if a result used "X vs Y" / "X alternatives" framing
}

// Final, filtered shape — one per surfaced competitor. Additive to
// NormalizedAnalysis (see normalize.ts), and is what deprecates+replaces the
// dead free-text `competitive_context` field there.
export interface CompetitorProfile {
  name: string
  domain?: string
  // LLM-narrated, but constrained to only describe candidates already in
  // this code-derived list — the LLM never introduces a new name. Same
  // anti-hallucination discipline as generateDeterministicOpportunities()
  // discarding LLM-only catalog misses (opportunity-engine.ts).
  why_they_compete: string
  market_position?: string        // only set if evidence states it, never guessed
  differentiator?: string
  // Business-understanding rebuild (2026-07-16) — LLM-classified, grounded in
  // the candidate's own snippets + the researched company's business profile.
  // 'unclear' rather than a guess when the snippets don't support a tier.
  category?: 'direct' | 'growing' | 'established' | 'unclear'
  // Resolved via website-discovery.ts's discoverCompanyWebsite(), same reuse
  // Company Discovery Engine already does — undefined if not confidently
  // resolved, never a guessed domain.
  website?: string
  similarities?: string           // only set if evidence states it, never guessed
  relative_size?: string          // only set if evidence states it, never guessed
  confidence: CompetitorConfidence
  source_urls: string[]
}

// Top-level result of the (not-yet-implemented) discoverCompetitors() call.
// Mirrors WebsiteDiscoveryResult's status+candidates+reason shape.
export interface CompetitorDiscoveryResult {
  competitors: CompetitorProfile[]
  // Same survivors as `competitors`, same order, pre-final-shaping — carries
  // the mention_count/snippets/explicit_vs_framing fields the
  // `[COMPETITOR CANDIDATES]` prompt block (analyze-v2.ts) needs to give the
  // LLM grounding to narrate from. `competitors[i].name === candidates[i].name`
  // for every i — route.ts passes `candidates` into buildNarrativeInput();
  // normalize.ts's merge step matches the LLM's narration back onto
  // `competitors` by name. Added during Implementation (this file's schema
  // from the earlier Schema session didn't anticipate needing both shapes
  // out of the same call).
  candidates: CompetitorCandidate[]
  sufficiency: CompetitorSufficiency
  reason: string                  // human-readable summary for gate diagnostics / logs — feeds the future route.ts "COMPETITOR" gate's `reason` argument (see gate() in test-analysis/route.ts)
  candidates_considered: number   // pre-filter candidate count, for diagnostics
  // Filtered-out names + why (self-name/customer/supplier/etc.) — a
  // debugging trail alongside the final list, same spirit as
  // evidence-extractor.ts's factorSourceMap mapping outcomes back to cause.
  rejected_candidates?: Array<{ name: string; reason: string }>
}

// ============================================================
// Implementation (2026-07-14, "Competitor Discovery Implementation" session)
// ============================================================
// Search-grounded, not LLM-narrated (docs/DECISIONS.md, decision 2): every
// candidate NAME below comes only from search results via regex extraction,
// never from an LLM. The `why_they_compete` this file writes onto each
// CompetitorProfile is a code-derived FALLBACK built from the matched
// snippet — same "LLM narrative, catalog text as fallback" shape as
// opportunity-engine.ts's `DeterministicOpportunity.strategic_challenge`
// (see normalize.ts's `llmMatch?.description || d.strategic_challenge`).
// The normalize.ts merge step (this milestone's next sub-step) overwrites
// it with the LLM's narration — from the `[COMPETITOR CANDIDATES]` prompt
// block in analyze-v2.ts — when a name-match exists; this fallback is what
// survives when it doesn't (LLM timeout, no match, etc.), same
// no-forced-empty-output discipline as everywhere else in this pipeline.
//
// Governing principle, same as website-discovery.ts: prefer under-confidence
// to over-confidence. A wrongly-named "competitor" is worse than an honest
// empty list — filtering rejects aggressively rather than guessing.
// ============================================================

import { searchTavily, searchSerper } from './discovery-engine'
import { filterRelevantResults, filterTopicallyRelevantResults, extractQueryTopic, looksLikeSentenceFragment, toQueryPhrase } from './extraction-guards'
import type { CompanyBusinessProfile } from '@/lib/pipeline/business-profile'

// ── Company-name word-boundary matching ─────────────────────────
// Same LEGAL_SUFFIXES list as website-discovery.ts, deliberately NOT
// stripping "Group"/"Company"/"Technologies" — those are sometimes the real
// brand identity (e.g. "ATE Group"), for either the researched company or a
// real competitor, and stripping them would create false negatives/positives
// in both directions.

const LEGAL_SUFFIXES = /\b(?:pvt\.?|private|ltd\.?|limited|inc\.?|incorporated|llc|corp\.?|corporation|co\.?)\b/gi

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Word-overlap self-name check — a candidate is the researched company
// itself if most of either name's significant words appear in the other,
// matched on word boundaries (not substring — same discipline as
// matchesKeyword()'s short-keyword fix).
export function isSelfName(candidateName: string, companyName: string): boolean {
  const cand = normalizeName(candidateName)
  const self = normalizeName(companyName)
  if (!cand || !self) return false
  if (cand === self) return true
  // Space-collapsed match — catches the case where companyName is a
  // domain-derived guess with no word boundary to split on (e.g.
  // guessCompanyNameFromDomain("acepipeline.com") -> "Acepipeline", one
  // word, vs. the real "Ace Pipeline" surfaced by search). Found live
  // 2026-07-15: Ace Pipeline listed itself as its own competitor because
  // word-overlap requires matching individual words and "acepipeline" has
  // none in common with ["ace", "pipeline"].
  if (cand.replace(/\s+/g, '') === self.replace(/\s+/g, '')) return true
  const candWords = cand.split(' ').filter(w => w.length > 1)
  const selfWords = self.split(' ').filter(w => w.length > 1)
  if (candWords.length === 0 || selfWords.length === 0) return false
  const overlap = candWords.filter(w => selfWords.includes(w)).length
  return overlap / candWords.length >= 0.6 || overlap / selfWords.length >= 0.6
}

// ── Rejection rules ───────────────────────────────────────────────
// Filtering stage from architecture decision 4: self-name / customer /
// supplier / certifying-body / news-outlet / association rejection.

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'vs', 'top', 'best', 'list', 'guide',
  'review', 'comparison', 'how', 'what', 'why', 'in', 'of', 'to', 'with', 'by',
  'is', 'are', 'this', 'that', 'these', 'those', 'you', 'your',
  // The LIST_TRIGGER vocabulary itself — a candidate whose entire name IS
  // the trigger word (e.g. a "Top Alternatives to X" heading re-matching
  // "Alternatives" as a proper noun right after the trigger position) is
  // the trigger, not a target. Found live 2026-07-15 running Bharat Forge
  // through the real pipeline: "Alternatives" surfaced as a medium-confidence
  // competitor with no real company behind it.
  'alternative', 'alternatives', 'competitor', 'competitors', 'rival', 'rivals',
])

// Known directories/aggregators, certifying bodies, news outlets, and social/
// professional networks — a search RESULT from one of these can still be a
// legitimate evidence source (its snippet may correctly name a real
// competitor), but the site's own brand name must never be extracted AS a
// competitor.
const NON_COMPETITOR_NAMES = [
  'G2', 'Capterra', 'TrustRadius', 'Crunchbase', 'SimilarWeb', 'Gartner',
  'Wikipedia', 'LinkedIn', 'Glassdoor', 'Indeed', 'YouTube', 'Facebook',
  'Twitter', 'Instagram', 'Reuters', 'Bloomberg', 'Forbes', 'BusinessWire',
  'PRNewswire', 'ISO', 'BSI', 'UL', 'SGS', 'TUV', 'Moneycontrol',
]

const RELATIONSHIP_DISQUALIFIER_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bcustomers?\s+(?:include|of|are)\b/i, reason: 'framed as a customer, not a competitor' },
  { pattern: /\bsuppliers?\s+(?:to|of|for)\b/i, reason: 'framed as a supplier, not a competitor' },
  { pattern: /\bcertified\s+by\b|\bcertification\s+(?:body|authority)\b/i, reason: 'framed as a certifying body, not a competitor' },
  { pattern: /\bmember\s+of\b|\bindustry\s+association\b|\bindustry\s+body\b/i, reason: 'framed as an industry association, not a competitor' },
  { pattern: /\bpartner(?:ed|ship)?\s+with\b/i, reason: 'framed as a partner, not a competitor' },
]

// Returns a rejection reason, or null if the candidate survives.
// Order matters for diagnostic quality (rejected_candidates' `reason` should
// be the most specific true cause, not the first generic check that happens
// to also match) — known-name matching runs before the generic length/
// stopword checks so e.g. "G2" is reported as a known directory name, not
// just "too short".
export function classifyRejection(name: string, companyName: string, snippets: string[]): string | null {
  if (isSelfName(name, companyName)) {
    return 'self-name (this is the researched company itself)'
  }
  for (const bad of NON_COMPETITOR_NAMES) {
    if (new RegExp(`\\b${escapeRegex(bad)}\\b`, 'i').test(name)) {
      return 'known directory/aggregator/news-outlet/certifying-body name, not a competitor'
    }
  }
  if (looksLikeSentenceFragment(name)) {
    return 'looks like a sentence fragment or asset filename, not a company name'
  }
  const normalized = normalizeName(name)
  if (!normalized || normalized.length < 3) {
    return 'too short/generic to be a real candidate name'
  }
  const words = normalized.split(' ').filter(Boolean)
  if (words.every(w => STOPWORDS.has(w))) {
    return 'generic/stopword phrase, not a company name'
  }
  const combinedSnippet = snippets.join(' ')
  for (const { pattern, reason } of RELATIONSHIP_DISQUALIFIER_PATTERNS) {
    if (pattern.test(combinedSnippet)) return reason
  }
  return null
}

// ── Candidate-name extraction (regex, no LLM) ────────────────────
// Two extraction strategies, both anchored on explicit competitor-framing
// language so we never pull arbitrary capitalized words out of unrelated
// prose:
//  1. "X vs Y" title pattern (explicit_vs_framing = true)
//  2. A list following a trigger phrase ("competitors include Y, Z" /
//     "alternatives to X: Y, Z" / "rivals are Y and Z") — explicit
//     competitor language, but not the "vs" shape specifically.

const PROPER_NOUN = /\b[A-Z][a-zA-Z0-9&.'-]*(?:\s+[A-Z][a-zA-Z0-9&.'-]*){0,3}\b/g

export function extractVsPair(title: string): string[] {
  // "vs" trigger is matched case-insensitively ("vs"/"Vs"/"VS") but the name
  // groups stay case-sensitive ([A-Z]...) — only the trigger word's casing
  // should be flexible, not the requirement that a candidate name look like
  // a proper noun.
  const m = title.match(/\b([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})\s+[Vv][Ss]\.?\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})\b/)
  if (!m) return []
  return [m[1].trim(), m[2].trim()]
}

const LIST_TRIGGER = /\b(?:top\s+)?competitors?(?:\s+(?:of|to|include|including|are))?\b|\balternatives?(?:\s+(?:to|include|including|are))?\b|\brivals?(?:\s+(?:include|including|are))?\b|\bcompetes?\s+with\b/i

export function extractListAfterTrigger(text: string): string[] {
  const m = LIST_TRIGGER.exec(text)
  if (!m) return []
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 200)
  const stopAt = after.search(/[.!?]/)
  const window = stopAt >= 0 ? after.slice(0, stopAt) : after
  const names = window.match(PROPER_NOUN) ?? []
  return names.map(n => n.trim()).filter(n => n.length >= 3 && n.length <= 60)
}

// Numbered-list extraction — same pattern as company-discovery.ts's
// extractNumberedListCompanies. Added 2026-07-16 alongside the
// business-understanding rebuild: `top companies offering "X"` style
// queries (buildBusinessProfileCompetitorQueries/buildOfferingCompetitorQueries)
// return "Top N Companies" listicle-shaped results that flatten to
// "1. ESAB  2. CenterLine  3. ..." with no single trigger sentence for
// extractListAfterTrigger to anchor on — found live 2026-07-16 running
// adorwelding.com through the rebuilt pipeline: a real, populated business
// profile (6 services) still produced 0 raw candidates because neither
// extractVsPair nor extractListAfterTrigger recognize this shape at all.
// Same classifyRejection() safety net applies afterward regardless of which
// extractor found the name.
const NUMBERED_ITEM = /(?:^|\n|\s)(?:\d{1,2}[.)]\s+)([A-Z][a-zA-Z0-9&.'-]*(?:\s+[A-Z][a-zA-Z0-9&.'-]*){0,3})/g

export function extractNumberedListCandidates(text: string): string[] {
  const names: string[] = []
  let match: RegExpExecArray | null
  const re = new RegExp(NUMBERED_ITEM)
  while ((match = re.exec(text)) !== null) {
    const name = match[1].trim()
    if (name.length >= 3 && name.length <= 60) names.push(name)
  }
  return names
}

// Title-prefix extraction — a "top companies offering X" search mostly
// returns one DIFFERENT COMPANY'S OWN page per result, not a single listicle
// page (that's what extractNumberedListCandidates above is for). The real
// company name sits in that page's own SEO title, e.g. "Linde Gas &
// Equipment: Welding Supply Store" or "ESAB | Welding and Cutting Products".
// Found live 2026-07-16 running adorwelding.com through the rebuilt
// pipeline: a real, populated business profile (6 services) still produced
// 0 raw candidates even with numbered-list extraction added, because a
// diagnostic peek at the actual search results showed exactly this shape —
// distinct company homepages, not listicles.
// Deliberately only matches ":" and "|" separators, not "-"/"–"/"—" — a
// bare hyphen is ambiguous with a hyphenated word inside the company name
// itself (e.g. "E-commerce Platforms"), and this is a narrow, safe-by-
// default heuristic, not an attempt to catch every title shape. Same
// classifyRejection() safety net applies afterward regardless of which
// extractor found the name.
const TITLE_PREFIX = /^([A-Z][\w&.,']*(?:\s+[A-Z&][\w&.,']*){0,4})\s*[:|]\s+(\S.*)$/

// A listicle title itself often looks like a proper-noun prefix followed by
// a colon ("Top 10 Welding Companies: A Complete Guide") — LIST_TRIGGER's
// vocabulary (top/competitor/alternative/rival) appearing anywhere in the
// captured prefix is a strong signal this is the LISTICLE'S title, not a
// real company name, so it's rejected here directly rather than relying on
// classifyRejection's STOPWORDS check (which only rejects when EVERY word
// is a stopword — "Top 10 X" survives that check since "10"/"X" aren't).
const LISTICLE_PREFIX_WORDS = /\b(?:top|best|leading|competitors?|alternatives?|rivals?)\b/i

// Same market-research-report-title fingerprint market-intelligence.ts
// already fixed for growth_indicator statements ("Deep Tech Market Size,
// Share, Growth, Outlook, Trends 2035" satisfies a pattern but is a title,
// not real content) — found live 2026-07-16 running adorwelding.com through
// this new extractor: "Welding Consumables Market Size, Share" (a market-
// research report title, not a company) slipped past the listicle-word
// check above since it contains none of that vocabulary.
const MARKET_REPORT_TITLE_WORDS = /\bmarket\s+(?:size|share|growth|report|outlook|forecast)\b|\bindustry\s+report\b/i

export function extractTitleCompanyName(title: string): string[] {
  const m = TITLE_PREFIX.exec(title.trim())
  if (!m) return []
  const name = m[1].trim()
  if (name.length < 3 || name.length > 60) return []
  if (LISTICLE_PREFIX_WORDS.test(name) || MARKET_REPORT_TITLE_WORDS.test(name)) return []
  return [name]
}

// ── Confidence tiering ────────────────────────────────────────────

export function tierConfidence(c: CompetitorCandidate): CompetitorConfidence {
  if (c.mention_count >= 2 && c.explicit_vs_framing) return 'high'
  if ((c.mention_count >= 2 && !c.explicit_vs_framing) || (c.mention_count === 1 && c.explicit_vs_framing)) return 'medium'
  return 'low'
}

export function fallbackWhyTheyCompete(candidate: CompetitorCandidate): string {
  const snippet = candidate.snippets[0]
  const framing = candidate.explicit_vs_framing
    ? 'named directly as a competitor/alternative'
    : 'listed among competitors'
  if (snippet) return `Surfaced via search, ${framing}: "${snippet.slice(0, 150)}"`
  return `Surfaced via search, ${framing} in results (no snippet captured).`
}

// ── Search ─────────────────────────────────────────────────────────
// Duplicated per-query Tavily→Serper fallback (not the key-absence-only
// check) — same shape and same reasoning as website-discovery.ts's
// searchWithFallback: a failed/quota-exhausted Tavily call must not look
// like "no results" when a configured Serper key could still answer it.
// Kept as its own copy rather than a shared import, matching this
// codebase's existing precedent (website-discovery.ts didn't dedupe against
// discovery-engine.ts's copy either — see CLAUDE.md "Item 1" history).

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

function buildCompetitorQueries(companyName: string): string[] {
  return [
    `"${companyName}" competitors`,
    `"${companyName}" vs`,
    `"${companyName}" alternatives`,
    `top competitors of "${companyName}"`,
  ]
}

// Grounds competitor search in what the researched company actually SELLS
// (lib/pipeline/service-offerings.ts) rather than only its brand name — a
// company with no existing "X vs Y" comparison article or press coverage
// still surfaces real same-level competitors this way, since the query no
// longer depends on someone else having already written about this specific
// company. Capped at the top 2 extracted offerings x 1 query each (bounded
// supplementary pass, not a full second base-query set).
export function buildOfferingCompetitorQueries(offerings: string[]): string[] {
  return offerings.slice(0, 2).map(o => `top companies offering "${toQueryPhrase(o)}"`)
}

// Primary competitor query builder (2026-07-16 rebuild) — grounds search in
// the researched company's actual business (services + market positioning,
// from business-profile.ts's structured 8-question extraction) rather than
// its name OR the narrower service-offerings.ts phrase list. This replaces
// the old name-based discoverCompetitors() as the sole primary pass in
// route.ts (buildCompetitorQueries/discoverCompetitors stay exported for
// their still-used extraction/filtering internals, just no longer wired
// into the pipeline as a competitor SOURCE — see route.ts wiring comment).
// Same 2-3 items x 1 query shape as buildOfferingCompetitorQueries, just
// drawing from richer, more reliably-populated fields.
export function buildBusinessProfileCompetitorQueries(profile: CompanyBusinessProfile): string[] {
  const queries: string[] = profile.services
    .slice(0, 3)
    .map(s => `top companies offering "${toQueryPhrase(s)}"`)
  if (profile.market_positioning.trim().length > 0) {
    queries.push(`"${toQueryPhrase(profile.market_positioning)}" competitors`)
  }
  return queries
}

// ── Main export ───────────────────────────────────────────────────

const MAX_COMPETITORS = 5
const MAX_SNIPPETS_PER_CANDIDATE = 2

// Shared core: search -> relevance-filter -> extract -> group -> reject ->
// tier -> cap. Both the name-only pass (discoverCompetitors) and the
// offering-grounded supplementary pass (discoverCompetitorsFromOfferings)
// call this with a different query set — everything after "what are the
// queries" is identical, so it lives here once rather than duplicated.
//
// requireCompanyMention gates the mentionsCompany relevance filter below.
// It must be OFF for the offering-grounded pass: a query like
// `top companies offering "cloud architecture"` is deliberately searching
// for OTHER companies, so requiring the researched company's own name to
// appear in each result is self-defeating — it discards every legitimate
// result by construction. Found live 2026-07-16 running demazetech.com:
// the offering pass returned real results but 100% were filtered out by
// this gate before extraction ever ran. Self-name/directory/disqualifier
// rejection (classifyRejection, below) still applies either way — that's
// the correct place to exclude the researched company itself.
async function runCompetitorDiscovery(
  queries: string[],
  companyName: string,
  domain: string,
  emptyQueriesReason: string,
  requireCompanyMention: boolean = true,
): Promise<CompetitorDiscoveryResult> {
  const tavilyKey = process.env.TAVILY_API_KEY
  const serperKey = process.env.SERPER_API_KEY

  if (!tavilyKey && !serperKey) {
    return { competitors: [], candidates: [], sufficiency: 'insufficient', reason: 'no search API configured', candidates_considered: 0 }
  }
  if (!companyName || companyName.trim().length === 0) {
    return { competitors: [], candidates: [], sufficiency: 'insufficient', reason: 'no company name available to search for competitors', candidates_considered: 0 }
  }
  if (queries.length === 0) {
    return { competitors: [], candidates: [], sufficiency: 'insufficient', reason: emptyQueriesReason, candidates_considered: 0 }
  }

  let resultsPerQuery: Array<Array<{ title: string; url: string; content: string }>>
  let allResults: Array<{ title: string; url: string; content: string }>
  try {
    resultsPerQuery = await Promise.all(queries.map(q => searchWithFallback(q, tavilyKey, serperKey)))
    allResults = resultsPerQuery.flat()
  } catch (e) {
    return {
      competitors: [], candidates: [], sufficiency: 'insufficient',
      reason: `search failed: ${e instanceof Error ? e.message : String(e)}`,
      candidates_considered: 0,
    }
  }

  if (allResults.length === 0) {
    return { competitors: [], candidates: [], sufficiency: 'insufficient', reason: 'search returned no results for any competitor query', candidates_considered: 0 }
  }

  // Relevance gate. Two different shapes depending on which pass this is:
  //  - requireCompanyMention=true (name-based base pass): drop any result
  //    that doesn't actually mention the researched company. Tavily/Serper's
  //    quoted-phrase queries don't reliably enforce this themselves (see
  //    extraction-guards.ts header for the live 2026-07-16 failure this
  //    fixes); without it, extraction runs on off-topic pages and pulls
  //    page-chrome as if it were a competitor.
  //  - requireCompanyMention=false (offering-grounded pass): the researched
  //    company's own name is deliberately NOT required (see this function's
  //    header comment) — instead, each query's own results are checked for
  //    topical overlap with the offering/positioning phrase THAT query
  //    searched for (filterTopicallyRelevantResults/extractQueryTopic, see
  //    extraction-guards.ts). Without this, there was no relevance check at
  //    all on this path — found live 2026-07-18 running ATE Group (an
  //    industrial-IoT/cooling-solutions company): an unrelated "Top Data
  //    Analytics Companies to Watch in 2026" listicle (Accenture/Deloitte/
  //    IBM/Capgemini/PwC/Teradata) was extracted as if it named ATE Group's
  //    real competitors.
  const rawResultCount = allResults.length
  if (requireCompanyMention) {
    allResults = filterRelevantResults(allResults, companyName)
  } else {
    allResults = resultsPerQuery.flatMap((results, i) => filterTopicallyRelevantResults(results, [extractQueryTopic(queries[i])]))
  }
  if (allResults.length === 0) {
    return {
      competitors: [], candidates: [], sufficiency: 'insufficient',
      reason: requireCompanyMention
        ? `${rawResultCount} result(s) found but none mention "${companyName}" by name`
        : `${rawResultCount} result(s) found but none were topically relevant to the searched offering(s)`,
      candidates_considered: 0,
    }
  }

  // ── Extract + group raw candidates by normalized name ─────────────
  // domain is unused for extraction itself (candidates are names, not
  // URLs) but kept as a parameter for parity with discoverAndFetchExternalSources
  // and to leave room for a future same-domain self-result skip, mirroring
  // discovery-engine.ts's `r.url.includes(domain)` guard, without adding
  // dead code for it now.
  void domain

  const grouped = new Map<string, { displayName: string; mention_count: number; source_urls: Set<string>; snippets: string[]; explicit_vs_framing: boolean }>()

  for (const r of allResults) {
    const vsNames = extractVsPair(r.title)
    const listNames = [...extractListAfterTrigger(r.title), ...extractListAfterTrigger(r.content)]
    const numberedNames = [...extractNumberedListCandidates(r.title), ...extractNumberedListCandidates(r.content)]
    const titleNames = extractTitleCompanyName(r.title)
    const explicitSet = new Set(vsNames)
    // Dedupe within this single result first — a name appearing in both the
    // "vs" title match and the list match for the SAME result must only
    // increment mention_count once (mention_count counts distinct search
    // results, per the CompetitorCandidate field comment).
    const namesInThisResult = new Set([...vsNames, ...listNames, ...numberedNames, ...titleNames].map(n => n.trim()).filter(Boolean))

    for (const name of namesInThisResult) {
      const key = normalizeName(name)
      if (!key) continue
      const existing = grouped.get(key)
      const snippetText = (r.content || r.title).slice(0, 300)
      if (existing) {
        existing.mention_count += 1
        existing.source_urls.add(r.url)
        if (existing.snippets.length < MAX_SNIPPETS_PER_CANDIDATE) existing.snippets.push(snippetText)
        if (explicitSet.has(name)) existing.explicit_vs_framing = true
      } else {
        grouped.set(key, {
          displayName: name,
          mention_count: 1,
          source_urls: new Set([r.url]),
          snippets: [snippetText],
          explicit_vs_framing: explicitSet.has(name),
        })
      }
    }
  }

  // ── Filter ──────────────────────────────────────────────────────
  const rejected: Array<{ name: string; reason: string }> = []
  const survivors: CompetitorCandidate[] = []

  for (const c of grouped.values()) {
    const rejectReason = classifyRejection(c.displayName, companyName, c.snippets)
    if (rejectReason) {
      rejected.push({ name: c.displayName, reason: rejectReason })
      continue
    }
    survivors.push({
      name: c.displayName,
      mention_count: c.mention_count,
      source_urls: Array.from(c.source_urls),
      snippets: c.snippets,
      explicit_vs_framing: c.explicit_vs_framing,
    })
  }

  if (survivors.length === 0) {
    return {
      competitors: [],
      candidates: [],
      sufficiency: 'insufficient',
      reason: `${grouped.size} raw candidate(s) found, all rejected (self-name/directory/disqualified relationship)`,
      candidates_considered: grouped.size,
      rejected_candidates: rejected,
    }
  }

  // ── Confidence tiering + cap ──────────────────────────────────────
  const rank: Record<CompetitorConfidence, number> = { high: 2, medium: 1, low: 0 }
  const tiered = survivors
    .map(c => ({ candidate: c, confidence: tierConfidence(c) }))
    .sort((a, b) => rank[b.confidence] - rank[a.confidence] || b.candidate.mention_count - a.candidate.mention_count)
    .slice(0, MAX_COMPETITORS)

  const competitors: CompetitorProfile[] = tiered.map(({ candidate, confidence }) => ({
    name: candidate.name,
    why_they_compete: fallbackWhyTheyCompete(candidate),
    confidence,
    source_urls: candidate.source_urls,
  }))

  return {
    competitors,
    candidates: tiered.map(({ candidate }) => candidate),
    sufficiency: 'sufficient',
    reason: `${competitors.length} of ${grouped.size} raw candidate(s) survived filtering`,
    candidates_considered: grouped.size,
    rejected_candidates: rejected,
  }
}

export async function discoverCompetitors(
  companyName: string,
  domain: string,
): Promise<CompetitorDiscoveryResult> {
  return runCompetitorDiscovery(
    buildCompetitorQueries(companyName),
    companyName,
    domain,
    'no company name available to search for competitors',
  )
}

// Supplementary pass (see route.ts) — run once evidence extraction has
// surfaced what the researched company actually sells. Same search/extract/
// filter/tier pipeline as discoverCompetitors, just grounded in offering
// phrases instead of the company name alone. Returns the same "insufficient"
// shape rather than throwing when there are no offerings to search from.
export async function discoverCompetitorsFromOfferings(
  companyName: string,
  domain: string,
  offerings: string[],
): Promise<CompetitorDiscoveryResult> {
  return runCompetitorDiscovery(
    buildOfferingCompetitorQueries(offerings),
    companyName,
    domain,
    'no company offerings extracted to search from',
    false,
  )
}

// Business-understanding rebuild (2026-07-16) — the sole PRIMARY competitor
// pass wired into route.ts going forward. Grounds search entirely in what
// the researched company does (services + market positioning), never its
// name — the flaw a real user session flagged in the old
// discoverCompetitors() base pass (name-collision risk, e.g. an unrelated
// same-named company winning the search). discoverCompetitorsFromOfferings()
// above is kept as a fallback merge-in when the business profile is empty/
// times out (see route.ts), and the old name-based discoverCompetitors() is
// no longer called from the pipeline at all (kept only for its still-used
// extraction/filtering internals and existing unit test coverage).
export async function discoverCompetitorsFromBusinessProfile(
  companyName: string,
  domain: string,
  profile: CompanyBusinessProfile,
): Promise<CompetitorDiscoveryResult> {
  return runCompetitorDiscovery(
    buildBusinessProfileCompetitorQueries(profile),
    companyName,
    domain,
    'no business profile available to search from',
    false,
  )
}

// Merges a supplementary result into a base result — new survivors are
// appended and re-ranked, duplicates (by normalized name, same identity
// check as self-name filtering) are dropped in favor of the base entry so
// an already-found competitor isn't overwritten by a lower-quality
// duplicate from the second pass.
export function mergeCompetitorResults(
  base: CompetitorDiscoveryResult,
  supplement: CompetitorDiscoveryResult,
): CompetitorDiscoveryResult {
  if (supplement.competitors.length === 0) return base

  const existingNames = new Set(base.competitors.map(c => normalizeName(c.name)))
  const newCompetitors = supplement.competitors.filter(c => !existingNames.has(normalizeName(c.name)))
  const newCandidates = supplement.candidates.filter(c => !existingNames.has(normalizeName(c.name)))
  if (newCompetitors.length === 0) return base

  const rank: Record<CompetitorConfidence, number> = { high: 2, medium: 1, low: 0 }
  const mergedCompetitors = [...base.competitors, ...newCompetitors]
    .sort((a, b) => rank[b.confidence] - rank[a.confidence])
    .slice(0, MAX_COMPETITORS)
  const mergedNames = new Set(mergedCompetitors.map(c => normalizeName(c.name)))

  return {
    competitors: mergedCompetitors,
    candidates: [...base.candidates, ...newCandidates].filter(c => mergedNames.has(normalizeName(c.name))),
    sufficiency: 'sufficient',
    reason: `${base.reason} | supplementary pass added ${newCompetitors.length} more`,
    candidates_considered: base.candidates_considered + supplement.candidates_considered,
    rejected_candidates: [...(base.rejected_candidates ?? []), ...(supplement.rejected_candidates ?? [])],
  }
}
