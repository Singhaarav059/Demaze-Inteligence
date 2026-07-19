// ============================================================
// Extraction Guards — shared by competitor-discovery.ts and icp-generator.ts
// ============================================================
// Root cause, found live 2026-07-16 running demazetech.com through
// /admin/wizard: Tavily/Serper's quoted-phrase queries (`"${companyName}"
// ...`) do NOT reliably restrict results to pages that actually mention the
// company. Both modules extracted garbage from pages with zero relation to
// the researched company — a different company's own "Industries We Serve"
// page (codemechsolutions.com) that happened to rank for the query, unrelated
// Facebook/news posts about an AWS outage that happened to contain "customers
// include," and a generic software-alternatives RSS feed
// (how2shout.com/alternatives/tag/alternatives/feed). The regex extractors
// then dutifully pulled page-chrome/prose fragments out of this irrelevant
// text as if it were a real answer: "Archives", "Alternative-H2s-48x48" (an
// image filename), "at Codemech Solutions", "some of the world's biggest
// businesses", a bare "some of the" (a truncated ellipsis).
//
// Two independent defenses, matching the two distinct ways this failed:
//   1. mentionsCompany() — a post-search relevance gate. A result is only
//      eligible for extraction if the researched company's name actually
//      appears in it. Applied to raw search results BEFORE extraction runs,
//      so irrelevant sources never contaminate the candidate pool at all.
//   2. looksLikeSentenceFragment() — a second, independent defense on the
//      extracted candidate NAME itself, for cases where the source page IS
//      legitimately about the company but a specific extracted span still
//      isn't a real name (a heading run-on like "Industries We Serve at
//      Codemech Solutions" pulling "at Codemech Solutions" as if it were an
//      industry). Real competitor names and ICP segments are noun phrases
//      ("oil and gas", "Acme Corp") — they never open with a preposition/
//      conjunction/relative pronoun, which is exactly the shape a sentence
//      continuation has.
//
// NOT applied to market-intelligence.ts — that module's growth/trend/
// challenge statements are legitimately sourced from generic industry
// reports that never mention the researched company by name (e.g. a
// marketresearchfuture.com CAGR figure for "the Deep Tech industry").
// Requiring a company-name match there would break its correct behavior.
// See that file's own classifyStatementRejection for a differently-shaped
// fix (a report-title heuristic) instead.
//
// Governing principle, same as every other discovery module in this repo:
// prefer under-confidence to over-confidence.
// ============================================================

const GENERIC_NAME_WORDS = new Set([
  'the', 'a', 'an', 'and', 'of', 'for', 'inc', 'incorporated', 'llc', 'corp',
  'corporation', 'co', 'company', 'group', 'ltd', 'limited', 'pvt', 'private',
])

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function significantWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !GENERIC_NAME_WORDS.has(w))
}

// True if `companyName`'s significant words are present, on word
// boundaries (not substring — same discipline as matchesKeyword()'s
// short-keyword fix, CLAUDE.md), somewhere in `text`. A 1-2 significant-word
// name (the common case — "Demaze", "Ador Welding") requires every word
// present; a longer name only requires a 60% majority, matching
// isSelfName()'s overlap threshold, since a page can legitimately refer to
// a long name by a shortened form in places.
export function mentionsCompany(text: string, companyName: string): boolean {
  const words = significantWords(companyName)
  if (words.length === 0) return true // nothing meaningful to check against — don't block
  const haystack = text || ''
  const present = words.filter(w => new RegExp(`\\b${escapeRegex(w)}\\b`, 'i').test(haystack))
  if (words.length <= 2) return present.length === words.length
  return present.length / words.length >= 0.6
}

const FRAGMENT_STARTERS = new Set([
  'as', 'at', 'in', 'on', 'for', 'with', 'from', 'to', 'by', 'of', 'some',
  'into', 'about', 'under', 'over', 'through', 'while', 'when', 'if',
  'because', 'that', 'which', 'who', 'whom', 'than', 'and', 'but', 'or',
])

// Image-filename/asset shape, e.g. "Alternative-H2s-48x48" — a 48x48
// thumbnail dimension embedded in a slug, found live 2026-07-16.
const DIMENSION_OR_ASSET_SHAPE = /\b\d{1,4}x\d{1,4}\b/i

export function looksLikeSentenceFragment(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return true
  if (DIMENSION_OR_ASSET_SHAPE.test(trimmed)) return true
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase().replace(/[^\w]/g, '') ?? ''
  return FRAGMENT_STARTERS.has(firstWord)
}

// Filters raw search results down to only those that mention the researched
// company, so extraction never runs on off-topic sources. Both call sites
// (discoverCompetitors, discoverICPSegments) need the identical shape and
// identical "search-result -> combined text" concatenation, so this lives
// here rather than being re-derived per module.
export function filterRelevantResults<T extends { title: string; content: string }>(
  results: T[],
  companyName: string,
): T[] {
  return results.filter(r => mentionsCompany(`${r.title} ${r.content}`, companyName))
}

// ── Topical relevance for the offering-grounded pass ─────────────────
// Found live 2026-07-18 running ATE Group (an industrial-IoT/cooling-
// solutions/precision-components company) through the offering-grounded
// competitor pass (competitor-discovery.ts's
// discoverCompetitorsFromBusinessProfile /
// discoverCompetitorsFromOfferings, and icp-generator.ts's equivalent
// discoverICPSegmentsFromBusinessProfile / discoverICPSegmentsFromOfferings
// — both share this exact shape): those passes deliberately run with
// requireCompanyMention=false (a query like `top companies offering
// "industrial IoT"` is SUPPOSED to return other companies' pages, so
// mentionsCompany() above would wrongly reject every legitimate hit — see
// runCompetitorDiscovery/runICPDiscovery's own header comments). But with
// that gate off, there was NO relevance check of any kind: a completely
// unrelated "Top Data Analytics Companies to Watch in 2026" listicle
// (Accenture/Deloitte/IBM/Capgemini/PwC/Teradata) was extracted as if it
// named ATE Group's real competitors, because extractNumberedListCandidates
// blindly pulls any numbered capitalized list out of ANY returned result
// with zero check that the result is actually about the right
// industry/offering.
//
// extractQueryTopic() pulls the quoted phrase back out of a query string
// built by the offering-grounded query builders (all shaped `top companies
// offering "X"` / `"X" competitors` / `who needs "X"`), so a search RESULT
// can be checked against the specific phrase that produced THAT query,
// without the caller needing to separately pass the topic down alongside
// the query string (queries is already the single source of truth for what
// was searched).
export function extractQueryTopic(query: string): string {
  const m = query.match(/"([^"]+)"/)
  return m ? m[1] : query
}

// True if `text` shares real topical overlap with `topic` (the offering/
// positioning phrase a search query was built from), on word boundaries —
// same word-boundary discipline as mentionsCompany(), not substring
// matching. Deliberately MORE lenient than mentionsCompany(): the only
// thing worth catching on this path is a result with essentially nothing to
// do with the searched topic (the data-analytics-listicle case above), not
// penalizing a legitimately related result for using different wording
// ("IoT platforms" vs. "Industrial IoT" must still match — any one shared
// significant word is enough for a short topic phrase). Longer topic
// phrases (4+ significant words, e.g. a full market-positioning sentence)
// require a real fraction of the words to overlap, not just one generic
// shared word, so an unrelated result can't sneak through on a single
// coincidental match.
export function mentionsTopic(text: string, topic: string): boolean {
  const words = significantWords(topic)
  if (words.length === 0) return true // nothing meaningful to check against — don't block
  const haystack = text || ''
  const present = words.filter(w => new RegExp(`\\b${escapeRegex(w)}\\b`, 'i').test(haystack))
  if (present.length === 0) return false // near-zero overlap — the case this exists to catch
  if (words.length <= 3) return true // any real shared word is enough for a short topic phrase
  return present.length / words.length >= 0.34
}

// Filters raw search results down to only those with topical overlap with
// AT LEAST ONE of the given topics, so the offering-grounded pass (where
// mentionsCompany-based filterRelevantResults is deliberately skipped)
// still has some relevance gate instead of none. Same "search-result ->
// combined text" concatenation as filterRelevantResults.
export function filterTopicallyRelevantResults<T extends { title: string; content: string }>(
  results: T[],
  topics: string[],
): T[] {
  if (topics.length === 0) return results
  return results.filter(r => topics.some(topic => mentionsTopic(`${r.title} ${r.content}`, topic)))
}

// Shortens a full extracted offering phrase (e.g. "Cloud architectures that
// ensure scalability, security, and resilience for modern businesses",
// see lib/pipeline/service-offerings.ts) down to a search-safe noun phrase
// (e.g. "Cloud architectures") for use inside a quoted search query. Found
// live 2026-07-16 running demazetech.com through the wizard: the
// offering-grounded competitor/ICP queries (competitor-discovery.ts /
// icp-generator.ts) returned zero results because the quoted phrase was a
// full descriptive sentence, which almost never matches anything else on
// the web verbatim. Display text (company_offerings) is untouched by this —
// only the derived query string is shortened.
const QUERY_CLAUSE_BREAK = /\b(?:that|which|for|to)\b/i

export function toQueryPhrase(offering: string, maxWords = 6): string {
  const clauseMatch = QUERY_CLAUSE_BREAK.exec(offering)
  const clipped = clauseMatch && clauseMatch.index > 8 ? offering.slice(0, clauseMatch.index) : offering
  return clipped.trim().split(/\s+/).slice(0, maxWords).join(' ').replace(/[,;:]+$/, '')
}
