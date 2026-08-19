// ============================================================
// Company Discovery Engine (Roadmap Phase 2, item 3) — 2026-07-15
// Global/3-sector rework — 2026-08-18
// ============================================================
// Given an ICP segment (e.g. an ICPSegment.name from icp-generator.ts, or
// free text typed by a user on the new /admin/company-discovery page),
// surface real, named companies that plausibly belong to that segment —
// candidates for the SDR to send into the existing 4-step research
// pipeline. This is the reverse direction from Competitor Discovery Engine
// and ICP Generator: those enrich a report for a company ALREADY being
// researched; this one finds NEW companies to research in the first place.
// See CLAUDE.md "SCOPE PIVOT" / docs/ROADMAP.md item 3.
//
// Architecture mirrors competitor-discovery.ts / icp-generator.ts (the
// documented reference pattern — see docs/DECISIONS.md): search-grounded,
// not LLM-invented. Every candidate NAME below comes only from search-result
// regex extraction, never from an LLM — there is no LLM narration step in
// this module at all (unlike competitors/ICP segments, a discovered company
// doesn't get "narrated," it either gets researched or it doesn't).
//
// Domain resolution reuses website-discovery.ts's discoverCompanyWebsite()
// directly rather than reinventing candidate-domain verification — same
// content-based, word-boundary-matched, prefer-under-confidence discipline.
// This is the expensive part (2 extra search queries + up to 4 homepage
// fetches PER candidate), so it only runs for the top-ranked survivors after
// filtering, sequentially, capped at MAX_COMPANIES.
//
// Governing principle, same as every other discovery module in this repo:
// prefer under-confidence to over-confidence. A wrong company name or a
// wrongly-attributed domain is worse than an honest empty list.
//
// 2026-08-18 rework — two entry points now share one core
// (runDiscoveryCore, below):
//   - discoverCompanies(icpSegment, exclude) — the ORIGINAL free-text
//     entry point, UNCHANGED behavior/signature (still used by the URL/
//     domain-shape guard test and available for ad hoc segment lookups).
//   - discoverCompaniesForSector(sector, options) — NEW, restricted to
//     the 3 active target sectors (lib/sector-playbook's TargetSector),
//     query-rotation-driven (company-discovery-queries.ts) instead of a
//     fixed 8-query set, and applies a pre-domain-resolution sector-signal
//     filter. Both production routes (company-discovery, demaze-leads) now
//     call this one, never the free-text path, enforcing "only these 3
//     sectors" at the code level, not just by convention.
//   - discoverCompaniesUntil(supabase, sector, targetCount, options) — the
//     target-count loop: repeatedly calls discoverCompaniesForSector() with
//     a rotating, non-repeating query batch, running each survivor through
//     company-qualification.ts's qualifyCandidate() (persistent identity/
//     dedup/already-researched/already-outreached/size-band check) until
//     targetCount genuinely NEW qualified companies are found or sources
//     are exhausted.
// Search calls across all three entry points now go through
// lib/enrichment/search-router.ts's routedSearch() (cache -> Gemini Search
// -> Serper -> Tavily, early-stopping) instead of a raw Tavily-then-Serper
// fallback — this is the G7 wiring called for in the governing plan.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { routedSearch } from './search-router'
import { escapeRegex } from '../utils/regex'
import { isSelfName } from './competitor-discovery'
import { discoverCompanyWebsite } from './website-discovery'
import { getCompletion } from '../ai/provider-factory'
import type { TargetSector } from '../sector-playbook/types'
import { generateQueryBatch } from './company-discovery-queries'
import { matchesSectorSignals, qualifyCandidate } from './company-qualification'
import {
  emptyFunnel, recordDiscovered, recordQualified, recordRejection,
  type DiscoveryFunnel,
} from './discovery-funnel'

export type CompanyMatchConfidence = 'high' | 'medium' | 'low'
export type CompanyDiscoverySufficiency = 'sufficient' | 'insufficient'

// Raw candidate, pre-filter — one per company name surfaced by search,
// before the self-name/directory/generic-term filter runs. Kept distinct
// from CompanyMatch so the filter step has something to discard without
// mutating the final shape, same reason CompetitorCandidate/ICPCandidate
// stay separate from their filtered counterparts.
export interface CompanyDiscoveryCandidate {
  name: string
  mention_count: number   // independent search results naming this candidate
  source_urls: string[]
  snippets: string[]      // raw search snippets — becomes the fallback `reason` text
  /** First-touch attribution: which routedSearch() tier / query first surfaced this candidate. */
  discoverySource?: string
  discoveryQuery?: string
}

// Final, filtered shape — one per surfaced company. `domain` is only set
// when discoverCompanyWebsite() confirms it (confidence 'high' or 'medium')
// — never a guess, same discipline as everywhere else in this codebase.
export interface CompanyMatch {
  name: string
  domain?: string
  domain_confidence?: 'high' | 'medium'
  reason: string           // code-derived, built from the matched search snippet — never LLM-narrated
  confidence: CompanyMatchConfidence
  source_urls: string[]
  discoverySource?: string
  discoveryQuery?: string
}

export interface CompanyDiscoveryResult {
  companies: CompanyMatch[]
  sufficiency: CompanyDiscoverySufficiency
  reason: string                 // human-readable summary for diagnostics/logs
  candidates_considered: number  // pre-filter candidate count, already deduped by normalized name
  /** Sum of mention_count across all deduped candidates — i.e. candidate name-mentions before dedup. `total_mentions - candidates_considered` is the raw duplicate-mention count; used by benchmarks/brightdata-comparison.ts to report a duplicate rate. */
  total_mentions?: number
  rejected_candidates?: Array<{ name: string; reason: string }>
}

// ── Name normalization (same LEGAL_SUFFIXES list as the sibling modules) ──

const LEGAL_SUFFIXES = /\b(?:pvt\.?|private|ltd\.?|limited|inc\.?|incorporated|llc|corp\.?|corporation|co\.?)\b/gi

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, ' ')
    // \p{L}/\p{N} (Unicode letter/number), not \w — see website-discovery.ts's
    // normalizeCompanyName() for the full 2026-07-24 fix rationale.
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Input-shape guard ──────────────────────────────────────────────
// Real failure mode found live 2026-07-15: a user pasted a company URL
// (https://www.tcs.com/) into the ICP-segment field instead of a segment
// phrase. Nothing downstream catches this — the URL becomes 8 nonsense
// queries ("top companies in https://www.tcs.com/"), and a stray word from
// an unrelated job-posting snippet ("Provide") survived
// classifyCompanyRejection() (it's not a stopword or directory name) and
// came back as a lone low-confidence "result." An ICP segment is always a
// multi-word phrase or a bare industry term — never a single URL/domain
// token — so this is safe to reject outright rather than spend 8 queries
// producing a near-guaranteed-garbage result. Same "prefer under-confidence,
// honest empty output" discipline as the rest of this codebase.
const URL_OR_DOMAIN_SHAPE = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?$/i

export function looksLikeUrlOrDomain(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed || /\s/.test(trimmed)) return false
  return URL_OR_DOMAIN_SHAPE.test(trimmed)
}

// ── Rejection rules ───────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'top', 'best', 'list', 'guide',
  'review', 'in', 'of', 'to', 'with', 'by', 'is', 'are', 'this', 'that',
  'these', 'those', 'you', 'your', 'other', 'others',
  // The trigger vocabulary itself — same "candidate whose entire name IS the
  // trigger word" bug class found live in competitor-discovery.ts and
  // icp-generator.ts (2026-07-15).
  'companies', 'company', 'businesses', 'firms', 'players', 'vendors',
])

// Real false positive found live 2026-07-17: "Launched" was extracted as a
// standalone candidate from a garbled e-commerce product-listing snippet
// (capitalized because it started a sentence fragment, not because it's a
// proper noun), survived classifyCompanyRejection() (it isn't a stopword or
// directory name), then coincidentally resolved to a real but unrelated
// domain (launchedglobal.in) via discoverCompanyWebsite()'s loose
// single-word title-match rule — so the "confirm via domain resolution"
// second line of defense didn't catch it either. A company name is a proper
// noun; a bare capitalized common English verb/adjective almost never is.
// Scoped to single-word (no-space) candidates only — multi-word candidates
// like "Launched Global" are unaffected, since a common word combined with
// another capitalized word is far more likely to be a real brand name.
const COMMON_NON_COMPANY_WORDS = new Set([
  'launched', 'featured', 'related', 'included', 'available', 'located',
  'based', 'certified', 'approved', 'listed', 'updated', 'released',
  'established', 'rated', 'ranked', 'reviewed', 'compared', 'recommended',
  'trusted', 'verified', 'sponsored', 'presented', 'provided', 'offered',
  'designed', 'manufactured', 'supplied', 'delivered', 'required', 'shown',
])

// Known directories/aggregators/review sites/news outlets/social networks —
// a search RESULT from one of these can legitimately name real companies in
// its snippet, but the site's own brand name must never be extracted AS a
// discovered company. Same list class as competitor-discovery.ts's
// NON_COMPETITOR_NAMES (not shared/imported — this codebase's existing
// precedent duplicates these small per-file constant lists rather than
// centralizing them, see website-discovery.ts/competitor-discovery.ts
// history in docs/DECISIONS.md).
const NON_COMPANY_NAMES = [
  'G2', 'Capterra', 'TrustRadius', 'Crunchbase', 'SimilarWeb', 'Gartner',
  'Wikipedia', 'LinkedIn', 'Glassdoor', 'Indeed', 'YouTube', 'Facebook',
  'Twitter', 'Instagram', 'Reuters', 'Bloomberg', 'Forbes', 'BusinessWire',
  'PRNewswire', 'Clutch', 'Google', 'Yelp', 'Medium', 'Quora', 'Reddit',
]

// Real false positive found live 2026-08-19: "OpenAI" was extracted and
// qualified as an e-commerce company from a real article
// (builtin.com/articles/e-commerce-companies) whose own body text reads
// "Companies like OpenAI, Shopify and Amazon are leveraging agentic AI for
// personalization" — the "companies like X, Y, Z" trigger and the sector
// signal ("E-Commerce" in the article's own title) both fired correctly on
// genuinely ambiguous input; the article itself sloppily lumps an AI
// platform in with real sector operators. This is a distinct failure class
// from NON_COMPANY_NAMES above (those are never real companies at all;
// these ARE real companies, just never legitimately a manufacturing/
// automotive/ecommerce OPERATOR) — kept as its own list with its own
// rejection reason for diagnostic clarity. Deliberately narrow: only
// foundation-model/AI-research companies with literally no legitimate
// operator presence in any of the 3 target sectors — NOT general "big
// tech" names like Google/Microsoft/Amazon/Meta, which have real hardware/
// retail operations and would create false negatives if excluded here.
// "AI is transforming industry X" listicle content is common right now and
// will likely resurface this same pattern for Manufacturing/Automotive too.
const AI_PLATFORM_NOT_SECTOR_OPERATOR_NAMES = [
  'OpenAI', 'Anthropic', 'xAI', 'Mistral AI', 'Cohere', 'Stability AI',
  'Perplexity', 'DeepSeek', 'Google DeepMind', 'Hugging Face',
]

// Real false positive found live 2026-08-19 (Bright Data benchmark run,
// 3 sectors): unambiguous global mega-caps / Fortune-500-class
// conglomerates (Boeing, Tata Motors, Larsen & Toubro, Mahindra &
// Mahindra, Amazon...) were surfacing as candidates and NOT getting
// caught by detectSizeMismatch() below, because that check can only
// reject on a revenue/employee-count figure actually present in the ONE
// captured snippet — a bare listicle mention ("...companies like Boeing,
// Airbus...") has no such figure, and detectSizeMismatch() correctly
// refuses to guess when evidence is absent (same "prefer under-
// confidence" discipline documented on that function). For a small,
// deliberately narrow set of companies this universally known, no snippet
// evidence should be required — same "known entity, reject outright"
// pattern as NON_COMPANY_NAMES/AI_PLATFORM_NOT_SECTOR_OPERATOR_NAMES
// above, not a general size heuristic. Extend only when a new company
// this unambiguous surfaces, same discipline as those two lists — this is
// NOT meant to become an exhaustive Fortune 500 registry.
const KNOWN_MEGA_CAP_NAMES = [
  'Boeing', 'Tata Motors', 'Larsen & Toubro', 'Larsen and Toubro', 'L&T',
  'Mahindra & Mahindra', 'Mahindra and Mahindra', 'Ashok Leyland',
  'Toyota', 'Volkswagen', 'General Motors', 'Ford Motor', 'Honda Motor',
  'Robert Bosch', 'Magna International', 'Cummins Inc', 'Fanuc',
  'Amazon', 'Walmart', 'Alibaba', 'Flipkart',
  // Added 2026-08-19, second benchmark pass: real misses found live.
  'Apple Inc', 'PepsiCo',
  // Added 2026-08-19, third pass (batch=20 run): real misses found live.
  // "Johnson & Johnson" specifically, not bare "Johnson" — too generic,
  // would false-positive real SMEs like "Johnson Electric".
  'Rio Tinto', 'Unilever', 'Johnson & Johnson',
]

// Returns a rejection reason, or null if the candidate survives. Order
// matters for diagnostic quality, same discipline as the sibling modules'
// classifyRejection()/classifySegmentRejection().
export function classifyCompanyRejection(name: string, excludeCompanyNames: string[] | undefined): string | null {
  if (excludeCompanyNames) {
    for (const exclude of excludeCompanyNames) {
      if (exclude && isSelfName(name, exclude)) {
        return 'self-name (matches an excluded/researched company)'
      }
    }
  }
  for (const bad of NON_COMPANY_NAMES) {
    if (new RegExp(`\\b${escapeRegex(bad)}\\b`, 'i').test(name)) {
      return 'known directory/aggregator/news-outlet/social-network name, not a company'
    }
  }
  for (const aiPlatform of AI_PLATFORM_NOT_SECTOR_OPERATOR_NAMES) {
    if (new RegExp(`\\b${escapeRegex(aiPlatform)}\\b`, 'i').test(name)) {
      return 'AI/foundation-model platform, not a manufacturing/automotive/ecommerce operator (commonly name-dropped in "AI is transforming X" listicles)'
    }
  }
  for (const megaCap of KNOWN_MEGA_CAP_NAMES) {
    if (new RegExp(`\\b${escapeRegex(megaCap)}\\b`, 'i').test(name)) {
      return `known global mega-cap/conglomerate, too large for Demaze's mid-market ICP (matched "${megaCap}")`
    }
  }
  const normalized = normalizeName(name)
  if (!normalized || normalized.length < 3) {
    return 'too short/generic to be a real company name'
  }
  const words = normalized.split(' ').filter(Boolean)
  if (words.every(w => STOPWORDS.has(w))) {
    return 'generic/stopword phrase, not a company name'
  }
  if (words.length === 1 && COMMON_NON_COMPANY_WORDS.has(words[0])) {
    return 'common English word (verb/adjective), not a company name'
  }
  return null
}

// ── Candidate-name extraction (regex, no LLM) ────────────────────
// Companies are proper nouns, same shape as competitor names — reuses the
// same PROPER_NOUN capture group. Trigger vocabulary is company-list framing
// ("companies like X, Y, Z" / "leading companies include..." / "top N
// companies:") rather than competitor "vs"/"alternatives" framing.

const PROPER_NOUN = /\b[A-Z][a-zA-Z0-9&.'-]*(?:\s+[A-Z][a-zA-Z0-9&.'-]*){0,3}\b/g

const LIST_TRIGGER =
  /\b(?:top|leading|major|well-?known|notable)\s+companies\b|\bcompanies\s+(?:like|such\s+as|include[sd]?|including)\b|\bcompanies\s+in\s+this\s+space\s+include\b/i

export function extractCompaniesAfterTrigger(text: string): string[] {
  const m = LIST_TRIGGER.exec(text)
  if (!m) return []
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 200)
  const stopAt = after.search(/[.!?]/)
  const window = stopAt >= 0 ? after.slice(0, stopAt) : after
  const names = window.match(PROPER_NOUN) ?? []
  return names.map(n => n.trim()).filter(n => n.length >= 3 && n.length <= 60)
}

// Numbered-list extraction ("1. Zoho\n2. Freshworks" / "1) Chargebee") — a
// second, distinct pattern from the trigger-phrase list above. Search-result
// snippets frequently render "Top 10 X Companies" posts as a flattened
// numbered sequence with no single trigger sentence to anchor on.
const NUMBERED_ITEM = /(?:^|\n|\s)(?:\d{1,2}[.)]\s+)([A-Z][a-zA-Z0-9&.'-]*(?:\s+[A-Z][a-zA-Z0-9&.'-]*){0,3})/g

export function extractNumberedListCompanies(text: string): string[] {
  const names: string[] = []
  let match: RegExpExecArray | null
  const re = new RegExp(NUMBERED_ITEM)
  while ((match = re.exec(text)) !== null) {
    const name = match[1].trim()
    if (name.length >= 3 && name.length <= 60) names.push(name)
  }
  return names
}

// ── ICP-fit filter: company-size mismatch ─────────────────────────
// Real problem found live 2026-07-17: "top companies in Automotive"
// surfaced global mega-caps (Volkswagen, $348.6 billion revenue / 9.0
// million employees; Toyota, $311.9 billion) and, separately, defense
// primes (Lockheed Martin, RTX, GE Aerospace) — none of which resemble
// Demaze's actual proof points (lib/knowledge/demaze-proof-points.ts),
// every one of which is mid-market/SME scale (a 4-plant manufacturer, a
// 140-dealer distribution network, a single dealership group). Sending one
// of these into the research pipeline burns real search/LLM quota on a
// company with no matching Demaze proof point — this was the direct cause
// of the outreach-draft fabrication bug fixed in normalize.ts the same day
// (the LLM invented a stat because no real one applied at this scale).
//
// Detection is deliberately conservative: it only fires on unambiguous
// mega-scale facts about the candidate's OWN size (revenue/headcount/a
// "Fortune 500"-class label) found in its own search snippets — not on
// mentions of a client's or competitor's scale. Real mid-market companies
// essentially never have these numbers said about themselves, so this
// should not catch genuine Demaze-fit leads; same "prefer under-confidence,
// never silently invent a filter that guesses" discipline as the rest of
// this file. Not a hard, invisible drop — rejected candidates still surface
// in `rejected_candidates` for visibility/debugging, same as every other
// rejection reason.
//
// NOTE (2026-08-18): this stays as discoverCompanies()'s fast, coarse,
// upper-bound-only PRE-filter (unchanged, still applied before domain
// resolution). The fuller multi-metric revenue/valuation/market-cap/
// employee-count band check (lib/enrichment/company-size.ts's
// assessCompanySize()) is a separate, more thorough check applied at the
// company-qualification.ts layer, not a replacement for this one.
const REVENUE_BILLION_RE = /(?:US\$|USD|\$)\s?(\d+(?:\.\d+)?)\s*(?:billion|bn)\b/i
const EMPLOYEES_MILLION_RE = /(\d+(?:\.\d+)?)\s*million\s+employees\b/i
const EMPLOYEES_COUNT_RE = /([\d,]{5,})\+?\s*employees\b/i
const MEGA_SCALE_PHRASE_RE = /\bFortune\s?(?:50|100|500|1000)\b|\bGlobal\s?(?:500|2000)\b|\bone of the world'?s largest\b|\bmultinational conglomerate\b/i

const REVENUE_BILLION_THRESHOLD = 10
const EMPLOYEE_COUNT_THRESHOLD = 50000

export function detectSizeMismatch(snippets: string[]): string | null {
  const text = snippets.join(' ')

  const revenueMatch = REVENUE_BILLION_RE.exec(text)
  if (revenueMatch && parseFloat(revenueMatch[1]) >= REVENUE_BILLION_THRESHOLD) {
    return `too large for Demaze's mid-market ICP (~$${revenueMatch[1]} billion revenue mentioned)`
  }

  const employeesMillionMatch = EMPLOYEES_MILLION_RE.exec(text)
  if (employeesMillionMatch) {
    return `too large for Demaze's mid-market ICP (~${employeesMillionMatch[1]} million employees mentioned)`
  }

  const employeesCountMatch = EMPLOYEES_COUNT_RE.exec(text)
  if (employeesCountMatch) {
    const count = parseInt(employeesCountMatch[1].replace(/,/g, ''), 10)
    if (count >= EMPLOYEE_COUNT_THRESHOLD) {
      return `too large for Demaze's mid-market ICP (~${employeesCountMatch[1]} employees mentioned)`
    }
  }

  const phraseMatch = MEGA_SCALE_PHRASE_RE.exec(text)
  if (phraseMatch) {
    return `too large for Demaze's mid-market ICP ("${phraseMatch[0]}" mentioned)`
  }

  return null
}

// ── Confidence tiering ────────────────────────────────────────────

export function tierMatchConfidence(c: CompanyDiscoveryCandidate): CompanyMatchConfidence {
  if (c.mention_count >= 2) return 'high'
  if (c.mention_count === 1) return 'medium'
  return 'low'
}

export function fallbackReason(candidate: CompanyDiscoveryCandidate, icpSegment: string): string {
  const snippet = candidate.snippets[0]
  if (snippet) return `Surfaced via search for "${icpSegment}": "${snippet.slice(0, 150)}"`
  return `Surfaced via search for "${icpSegment}" (no snippet captured).`
}

// ── Search ─────────────────────────────────────────────────────────
// Routes every query through search-router.ts's routedSearch() (G7:
// cache -> Gemini Search -> Serper -> Tavily, stopping at the first tier
// judged sufficient) instead of a raw Tavily-then-Serper fallback — this
// directly cuts paid-call volume per query and reuses the already-wired
// search_query_cache for free on a repeat query.

// Results-per-query bumped from the sibling modules' default of 3 to 10 —
// company discovery specifically wants breadth (as many raw candidates as
// possible to filter down), unlike competitor/ICP discovery which only need
// a handful of high-signal snippets.
const RESULTS_PER_QUERY = 10

export interface QueryResultBatch {
  query: string
  tier: string
  results: Array<{ title: string; url: string; content: string }>
}

/** Swaps the search backend a discovery run uses. Only ever set explicitly
 * by a benchmark/comparison caller (see benchmarks/brightdata-comparison.ts)
 * — every existing call site is unaffected, since this defaults to the
 * normal routedSearch()-backed tier. This is the ONLY way a non-default
 * search source (e.g. Bright Data) can reach the discovery pipeline; it is
 * never selected automatically. */
export type SearchQueryFn = (query: string) => Promise<QueryResultBatch>

async function searchQueryWithTier(query: string): Promise<QueryResultBatch> {
  const routed = await routedSearch(query, { maxResults: RESULTS_PER_QUERY })
  const tier = routed.sufficientAt ?? routed.triedTiers[routed.triedTiers.length - 1] ?? 'tavily'
  return { query, tier, results: routed.results }
}

// 4 generic queries (as before) + 4 site:-restricted queries against known
// structured B2B/company directories. Serper is a Google SERP wrapper so
// `site:` operators work natively; Tavily's own index respects them loosely
// (may return fewer/no results — routedSearch already tolerates that via
// its own multi-tier fallback). These directories were picked to match this
// repo's actual target industries (manufacturing/industrial/automotive/
// SaaS/SMB, see CLAUDE.md) — not an attempt at universal coverage.
// Only used by the legacy free-text discoverCompanies() entry point —
// discoverCompaniesForSector() below uses the rotating, sector-scoped
// generator in company-discovery-queries.ts instead.
function buildCompanyDiscoveryQueries(icpSegment: string): string[] {
  return [
    `top companies in ${icpSegment}`,
    `leading ${icpSegment} companies`,
    `list of ${icpSegment} companies`,
    `${icpSegment} companies list`,
    `${icpSegment} site:crunchbase.com`,
    `${icpSegment} site:thomasnet.com`,
    `${icpSegment} site:indiamart.com`,
    `${icpSegment} site:kompass.com`,
  ]
}

// ── LLM-based extraction (validation layer, not a generator) ───────
// Regex extraction alone was the direct cause of the "India"/"Number"/
// "Employees" false positives found live 2026-07-15 — it has zero semantic
// understanding, it just matches capitalization + a numbered/trigger shape.
// This adds a second, independent extraction pass over the SAME raw search
// text via the LLM, instructed to extract only names literally present in
// the text (never invent from training knowledge). Names it finds still
// flow through the exact same classifyCompanyRejection() filter as regex
// names — this is a second candidate SOURCE, not a replacement for
// filtering, and not a narration step (contrast with competitor-discovery.ts/
// icp-generator.ts, which narrate LLM-approved candidates; this module still
// has no narration, per its original design).
// Prompt-building and response-parsing are pure/testable; the network call
// itself fails soft (timeout, missing key, bad JSON -> null, caller falls
// back to regex-only results, never hard-fails discovery).

const LLM_EXTRACTION_RESULT_CAP = 25
const LLM_EXTRACTION_TIMEOUT_MS = 25000

export function buildLLMExtractionPrompt(
  results: Array<{ title: string; content: string }>,
  icpSegment: string,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    'You are a strict text-extraction tool, not a knowledge base.',
    'You extract real company/business names that are LITERALLY PRESENT in the given search-result text.',
    'Never invent, infer, or add a company name from your own training knowledge, even if you recognize the industry — only names that appear verbatim in the text below.',
    'Reject anything that is not the proper name of an actual business: generic words, country/region names, industry or category terms, numbers, dates, page filters/navigation text, or the names of directories/aggregators/news sites/social networks themselves (e.g. Crunchbase, LinkedIn, ThomasNet, IndiaMART, Kompass, G2, Wikipedia).',
    'Respond with ONLY valid JSON, no prose, no markdown fences.',
  ].join(' ')

  const blocks = results
    .map((r, i) => `[${i}] TITLE: ${r.title || '(no title)'}\nCONTENT: ${(r.content || '').slice(0, 500)}`)
    .join('\n\n')

  const userPrompt = [
    `ICP segment being researched: "${icpSegment}"`,
    '',
    `Below are ${results.length} search-result snippets, each labeled with an index in brackets.`,
    'For EACH index, list any real company names literally present in that snippet that plausibly belong to or serve this segment.',
    'If none, use an empty array for that index. Every index from 0 to ' + (results.length - 1) + ' must appear exactly once in the output.',
    '',
    blocks,
    '',
    'Respond with a JSON array in exactly this shape:',
    '[{"index": 0, "companies": ["Name A", "Name B"]}, {"index": 1, "companies": []}]',
  ].join('\n')

  return { systemPrompt, userPrompt }
}

export function parseLLMExtractionResponse(raw: string, expectedCount: number): string[][] {
  const result: string[][] = Array.from({ length: expectedCount }, () => [])
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim()
    const start = cleaned.indexOf('[')
    const end = cleaned.lastIndexOf(']')
    const jsonText = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned
    const parsed: unknown = JSON.parse(jsonText)
    if (!Array.isArray(parsed)) return result
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const { index, companies } = item as { index?: unknown; companies?: unknown }
      if (typeof index !== 'number' || index < 0 || index >= expectedCount) continue
      if (!Array.isArray(companies)) continue
      result[index] = companies
        .filter((n): n is string => typeof n === 'string' && n.trim().length >= 2)
        .map(n => n.trim())
    }
  } catch {
    return Array.from({ length: expectedCount }, () => [])
  }
  return result
}

// Returns names per result index (parallel to `results`), or null if the LLM
// step is unavailable/failed entirely — caller treats null as "skip this
// layer," not as an error.
async function tryExtractCompaniesWithLLM(
  results: Array<{ title: string; url: string; content: string }>,
  icpSegment: string,
): Promise<string[][] | null> {
  const llmAvailable = !!process.env.NVIDIA_NIM_API_KEY
  if (!llmAvailable || results.length === 0) return null

  const capped = results.slice(0, LLM_EXTRACTION_RESULT_CAP)
  const { systemPrompt, userPrompt } = buildLLMExtractionPrompt(capped, icpSegment)

  try {
    const response = await Promise.race([
      getCompletion({ systemPrompt, userPrompt, maxTokens: 1500, temperature: 0, jsonMode: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('LLM extraction timeout')), LLM_EXTRACTION_TIMEOUT_MS)
      ),
    ])
    const perCappedResult = parseLLMExtractionResponse(response.content, capped.length)
    // Pad back out to the full results length — anything beyond the cap
    // simply wasn't sent to the LLM, not a parse failure.
    return results.map((_, i) => perCappedResult[i] ?? [])
  } catch (e) {
    console.warn('[CompanyDiscovery] LLM extraction skipped:', e instanceof Error ? e.message : String(e))
    return null
  }
}

// ── Already-researched dedup (cross-search, legacy) ─────────────────
// discoverCompanies() itself has no DB access (kept Supabase-free, same as
// every other lib/enrichment module — I/O happens at the route layer). This
// is the pure matching logic the API route calls after fetching
// pipeline_test_runs, so a repeat search (same segment re-run, or a
// different segment surfacing an overlapping company) doesn't resurface a
// company already sent through the research pipeline.
//
// NOTE (2026-08-18): superseded operationally by the persistent
// company_registry table (lib/companies/identity.ts) + company-
// qualification.ts's qualifyCandidate(), which both discovery routes now
// use instead of this function. Left in place, unchanged and still tested
// — it's not wired into either production route anymore, but nothing about
// it is broken, and removing it would mean deleting 10 passing tests for
// no functional gain.

export interface AlreadyResearchedRecord {
  companyUrl: string | null
  domain: string | null
}

export function normalizeDomain(input: string): string {
  let s = input.trim().toLowerCase()
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '')
  s = s.split('/')[0]
  return s
}

export function filterAlreadyResearched(
  companies: CompanyMatch[],
  history: AlreadyResearchedRecord[],
): { survivors: CompanyMatch[]; filteredOut: Array<{ name: string; reason: string }> } {
  const seenDomains = new Set<string>()
  const seenNames = new Set<string>()

  for (const h of history) {
    if (h.domain) seenDomains.add(normalizeDomain(h.domain))
    if (h.companyUrl) {
      const looksLikeDomainOrUrl = /^https?:\/\//i.test(h.companyUrl) || h.companyUrl.includes('.')
      if (looksLikeDomainOrUrl) {
        seenDomains.add(normalizeDomain(h.companyUrl))
      } else {
        const key = normalizeName(h.companyUrl)
        if (key) seenNames.add(key)
      }
    }
  }

  const survivors: CompanyMatch[] = []
  const filteredOut: Array<{ name: string; reason: string }> = []

  for (const c of companies) {
    const domainMatch = !!c.domain && seenDomains.has(normalizeDomain(c.domain))
    const nameMatch = !c.domain && seenNames.has(normalizeName(c.name))
    if (domainMatch || nameMatch) {
      filteredOut.push({ name: c.name, reason: 'already researched in a prior run' })
    } else {
      survivors.push(c)
    }
  }

  return { survivors, filteredOut }
}

// ── Shared core ───────────────────────────────────────────────────
// Both discoverCompanies() (legacy free-text) and discoverCompaniesForSector()
// (new, sector-restricted) delegate here — the search/extract/classify/
// tier/domain-resolution pipeline is identical either way; only how the
// query list is built, and whether a sector filter applies, differs.

// Raised from 6 — wider search net (more queries, more results/query) should
// actually surface more candidates to the user, not get truncated back down.
const MAX_COMPANIES = 10
const MAX_SNIPPETS_PER_CANDIDATE = 2

export async function runDiscoveryCore(
  queries: string[],
  excludeCompanyNames: string[] | undefined,
  sector: TargetSector | undefined,
  segmentLabel: string,
  searchFn: SearchQueryFn = searchQueryWithTier,
): Promise<CompanyDiscoveryResult> {
  let batches: QueryResultBatch[]
  try {
    batches = await Promise.all(queries.map(q => searchFn(q)))
  } catch (e) {
    return {
      companies: [], sufficiency: 'insufficient',
      reason: `search failed: ${e instanceof Error ? e.message : String(e)}`,
      candidates_considered: 0,
    }
  }

  const allResults: Array<{ title: string; url: string; content: string }> = []
  const allResultsMeta: Array<{ tier: string; query: string }> = []
  for (const b of batches) {
    for (const r of b.results) {
      allResults.push(r)
      allResultsMeta.push({ tier: b.tier, query: b.query })
    }
  }

  if (allResults.length === 0) {
    return { companies: [], sufficiency: 'insufficient', reason: 'search returned no results for any company-discovery query', candidates_considered: 0 }
  }

  // ── Extract + group raw candidates by normalized name ─────────────
  const llmNamesByResult = await tryExtractCompaniesWithLLM(allResults, segmentLabel)

  const grouped = new Map<string, {
    displayName: string; mention_count: number; source_urls: Set<string>; snippets: string[]
    discoverySource: string; discoveryQuery: string
  }>()

  for (let i = 0; i < allResults.length; i++) {
    const r = allResults[i]
    const meta = allResultsMeta[i]
    const names = [
      ...extractCompaniesAfterTrigger(r.title),
      ...extractCompaniesAfterTrigger(r.content),
      ...extractNumberedListCompanies(r.content),
      ...(llmNamesByResult?.[i] ?? []),
    ]
    const namesInThisResult = new Set(names.map(n => n.trim()).filter(Boolean))

    for (const name of namesInThisResult) {
      const key = normalizeName(name)
      if (!key) continue
      const existing = grouped.get(key)
      // Combine title + content, not content-with-title-as-fallback. Real
      // bug found live 2026-08-19: a numbered-list-style result's content
      // is often a bare enumeration ("1. George Weston · 2. NOVAGOLD
      // Resources · 3. Magna International · ...") with zero descriptive
      // words, while the actual sector context ("Canada's Top 10
      // Manufacturers") sits in the title — which the old title-as-
      // fallback-only logic discarded entirely whenever content was
      // non-empty, starving the sector-signal check of the one piece of
      // text that actually carried the signal. Magna International (a
      // real automotive-parts manufacturer) was wrongly rejected as
      // wrong_sector this exact way.
      const snippetText = [r.title, r.content].filter(Boolean).join(' — ').slice(0, 300)
      if (existing) {
        existing.mention_count += 1
        existing.source_urls.add(r.url)
        if (existing.snippets.length < MAX_SNIPPETS_PER_CANDIDATE) existing.snippets.push(snippetText)
      } else {
        grouped.set(key, {
          displayName: name,
          mention_count: 1,
          source_urls: new Set([r.url]),
          snippets: [snippetText],
          discoverySource: meta.tier,
          discoveryQuery: meta.query,
        })
      }
    }
  }

  // ── Filter ──────────────────────────────────────────────────────
  const rejected: Array<{ name: string; reason: string }> = []
  const survivors: CompanyDiscoveryCandidate[] = []

  for (const c of grouped.values()) {
    const rejectReason = classifyCompanyRejection(c.displayName, excludeCompanyNames)
    if (rejectReason) {
      rejected.push({ name: c.displayName, reason: rejectReason })
      continue
    }
    const sizeMismatchReason = detectSizeMismatch(c.snippets)
    if (sizeMismatchReason) {
      rejected.push({ name: c.displayName, reason: sizeMismatchReason })
      continue
    }
    survivors.push({
      name: c.displayName,
      mention_count: c.mention_count,
      source_urls: Array.from(c.source_urls),
      snippets: c.snippets,
      discoverySource: c.discoverySource,
      discoveryQuery: c.discoveryQuery,
    })
  }

  // ── Sector filter (only for the sector-restricted entry point) ─────
  // Cheap, pre-domain-resolution — reject a candidate with zero sector-
  // signal-word matches in its own snippets BEFORE spending a
  // discoverCompanyWebsite() call on it (the real cost saving finding G
  // flagged). Uses the same lib/sector-playbook signal vocabulary
  // company-qualification.ts's final gate also checks — this is a cheap
  // early pass, not a replacement for that authoritative check.
  let sectorFiltered = survivors
  if (sector) {
    const stillOk: CompanyDiscoveryCandidate[] = []
    for (const c of survivors) {
      if (matchesSectorSignals(c.snippets.join(' '), sector)) {
        stillOk.push(c)
      } else {
        rejected.push({ name: c.name, reason: `outside target sector (${sector})` })
      }
    }
    sectorFiltered = stillOk
  }

  const totalMentions = Array.from(grouped.values()).reduce((sum, c) => sum + c.mention_count, 0)

  if (sectorFiltered.length === 0) {
    return {
      companies: [],
      sufficiency: 'insufficient',
      reason: `${grouped.size} raw candidate(s) found, all rejected (self-name/directory/generic-term${sector ? '/wrong-sector' : ''})`,
      candidates_considered: grouped.size,
      total_mentions: totalMentions,
      rejected_candidates: rejected,
    }
  }

  // ── Confidence tiering + cap (pre-domain-resolution rank) ──────────
  const rank: Record<CompanyMatchConfidence, number> = { high: 2, medium: 1, low: 0 }
  const tiered = sectorFiltered
    .map(c => ({ candidate: c, confidence: tierMatchConfidence(c) }))
    .sort((a, b) => rank[b.confidence] - rank[a.confidence] || b.candidate.mention_count - a.candidate.mention_count)
    .slice(0, MAX_COMPANIES)

  // ── Domain resolution — sequential, only for the capped survivor set.
  // This is the expensive step (2 search queries + up to 4 homepage fetches
  // PER candidate via discoverCompanyWebsite()) — deliberately sequential,
  // not Promise.all, same "respect real quota limits" discipline as
  // batch-upload's researchSelected() loop (CLAUDE.md Item 7).
  // A candidate with no confirmable domain is capped at 'low' confidence
  // regardless of mention count — same "prefer under-confidence" discipline
  // as the rest of this codebase (e.g. website-discovery.ts's single-word-
  // name rule). This is a second, independent defense against the
  // "India"/"Number"/"Employees" false-positive class: even if a junk name
  // slipped past both extraction and the name-based filter, it almost
  // certainly won't resolve to a real confirmed company domain either.
  const companies: CompanyMatch[] = []
  for (const { candidate, confidence } of tiered) {
    const site = await discoverCompanyWebsite(candidate.name)
    const domainConfirmed = site.status === 'confirmed' && site.confidence !== 'none'
    companies.push({
      name: candidate.name,
      domain: domainConfirmed ? site.domain ?? undefined : undefined,
      domain_confidence: site.status === 'confirmed' && site.confidence !== 'none' ? site.confidence : undefined,
      reason: fallbackReason(candidate, segmentLabel),
      confidence: domainConfirmed ? confidence : 'low',
      source_urls: candidate.source_urls,
      discoverySource: candidate.discoverySource,
      discoveryQuery: candidate.discoveryQuery,
    })
  }

  return {
    companies,
    sufficiency: 'sufficient',
    reason: `${companies.length} of ${grouped.size} raw candidate(s) survived filtering`,
    candidates_considered: grouped.size,
    total_mentions: totalMentions,
    rejected_candidates: rejected,
  }
}

// ── Main export — legacy free-text entry point (UNCHANGED behavior) ────

export async function discoverCompanies(
  icpSegment: string,
  excludeCompanyNames?: string[],
): Promise<CompanyDiscoveryResult> {
  if (!icpSegment || icpSegment.trim().length === 0) {
    return { companies: [], sufficiency: 'insufficient', reason: 'no ICP segment given to search for', candidates_considered: 0 }
  }
  if (looksLikeUrlOrDomain(icpSegment)) {
    return {
      companies: [],
      sufficiency: 'insufficient',
      reason: `"${icpSegment.trim()}" looks like a company URL/domain, not an ICP segment. This field expects a segment description (e.g. "oil and gas", "automotive manufacturers", "mid-size SaaS companies"), not the company itself. To find companies similar to a specific company, research that company first and copy one of its "Target Customer Segments," or use Competitor Discovery on that company's report.`,
      candidates_considered: 0,
    }
  }

  const tavilyKey = process.env.TAVILY_API_KEY
  const serperKey = process.env.SERPER_API_KEY
  if (!tavilyKey && !serperKey && !process.env.GEMINI_VERTEX_API_KEY) {
    return { companies: [], sufficiency: 'insufficient', reason: 'no search API configured', candidates_considered: 0 }
  }

  const queries = buildCompanyDiscoveryQueries(icpSegment.trim())
  return runDiscoveryCore(queries, excludeCompanyNames, undefined, icpSegment.trim())
}

// ── New: sector-restricted entry point ─────────────────────────────
// The ONLY entry point either production discovery route calls — enforces
// "discover only Manufacturing/Automotive/E-commerce" at the code level.
// `refinement` is an optional free-text addition (what used to be the
// standalone "ICP segment" field) — always composed WITH a sector, never
// searched standalone.

export interface DiscoverForSectorOptions {
  refinement?: string
  excludeCompanyNames?: string[]
  /** Carries rotation state across repeated calls (the target-count loop) so each call explores new query combinations instead of repeating itself. */
  usedCombos?: Set<string>
  batchSize?: number
  /** Benchmark/comparison hook only — see SearchQueryFn. Never set by production callers. */
  searchFn?: SearchQueryFn
}

const DEFAULT_SECTOR_BATCH_SIZE = 8

export async function discoverCompaniesForSector(
  sector: TargetSector,
  options: DiscoverForSectorOptions = {},
): Promise<CompanyDiscoveryResult> {
  const tavilyKey = process.env.TAVILY_API_KEY
  const serperKey = process.env.SERPER_API_KEY
  if (!tavilyKey && !serperKey && !process.env.GEMINI_VERTEX_API_KEY) {
    return { companies: [], sufficiency: 'insufficient', reason: 'no search API configured', candidates_considered: 0 }
  }

  const usedCombos = options.usedCombos ?? new Set<string>()
  const batchSize = options.batchSize ?? DEFAULT_SECTOR_BATCH_SIZE
  const queries = generateQueryBatch(sector, usedCombos, batchSize)

  if (options.refinement?.trim()) {
    queries.push(`${options.refinement.trim()} ${sector} company`)
  }

  if (queries.length === 0) {
    return {
      companies: [], sufficiency: 'insufficient',
      reason: `discovery query pool exhausted for sector "${sector}" — no new region/directory combination left to try`,
      candidates_considered: 0,
    }
  }

  const label = options.refinement?.trim() ? `${options.refinement.trim()} (${sector})` : sector
  return runDiscoveryCore(queries, options.excludeCompanyNames, sector, label, options.searchFn)
}

// ── New: target-count discovery loop ────────────────────────────────
// Repeatedly calls discoverCompaniesForSector() with a rotating query
// batch, running every survivor through company-qualification.ts's
// qualifyCandidate() (persistent identity dedup + already-researched +
// already-outreached + sector + size-band check, all against the
// company_registry table) until `targetCount` genuinely NEW qualified
// companies are found, the query pool is exhausted, or a safety cap on
// iterations is hit. Needs a Supabase client (qualifyCandidate() writes to
// company_registry) — the one place in this module that isn't Supabase-free.

export interface DiscoverUntilResult {
  companies: CompanyMatch[]
  funnel: DiscoveryFunnel
  iterationsUsed: number
  stoppedReason: 'target_reached' | 'sources_exhausted' | 'max_iterations'
}

const MAX_DISCOVERY_ITERATIONS = 15
const ITERATION_BATCH_SIZE = 8

export async function discoverCompaniesUntil(
  supabase: SupabaseClient,
  sector: TargetSector,
  targetCount: number,
  options: { refinement?: string; excludeCompanyNames?: string[] } = {},
): Promise<DiscoverUntilResult> {
  const usedCombos = new Set<string>()
  const funnel = emptyFunnel()
  const qualified: CompanyMatch[] = []
  let iterations = 0

  while (iterations < MAX_DISCOVERY_ITERATIONS && qualified.length < targetCount) {
    iterations++
    const comboCountBefore = usedCombos.size

    const result = await discoverCompaniesForSector(sector, {
      refinement: options.refinement,
      excludeCompanyNames: options.excludeCompanyNames,
      usedCombos,
      batchSize: ITERATION_BATCH_SIZE,
    })

    if (usedCombos.size === comboCountBefore) {
      // generateQueryBatch() had nothing new to give — the combo pool for
      // this sector is exhausted, further looping would just repeat.
      return { companies: qualified, funnel, iterationsUsed: iterations, stoppedReason: 'sources_exhausted' }
    }

    recordDiscovered(funnel, result.companies.length)

    for (const candidate of result.companies) {
      const outcome = await qualifyCandidate(supabase, {
        name: candidate.name,
        domain: candidate.domain,
        snippets: [candidate.reason],
        discoverySource: candidate.discoverySource ?? null,
        discoveryQuery: candidate.discoveryQuery ?? options.refinement ?? sector,
      }, sector)

      if (outcome.status === 'qualified') {
        recordQualified(funnel)
        qualified.push(candidate)
        if (qualified.length >= targetCount) break
      } else if (outcome.reason) {
        recordRejection(funnel, outcome.reason)
      }
    }
  }

  return {
    companies: qualified.slice(0, targetCount),
    funnel,
    iterationsUsed: iterations,
    stoppedReason: qualified.length >= targetCount ? 'target_reached' : 'max_iterations',
  }
}
