// ============================================================
// Company Discovery Engine (Roadmap Phase 2, item 3) — 2026-07-15
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
// ============================================================

import { searchTavily, searchSerper } from './discovery-engine'
import { isSelfName } from './competitor-discovery'
import { discoverCompanyWebsite } from './website-discovery'
import { getCompletion } from '../ai/provider-factory'

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
}

export interface CompanyDiscoveryResult {
  companies: CompanyMatch[]
  sufficiency: CompanyDiscoverySufficiency
  reason: string                 // human-readable summary for diagnostics/logs
  candidates_considered: number  // pre-filter candidate count
  rejected_candidates?: Array<{ name: string; reason: string }>
}

// ── Name normalization (same LEGAL_SUFFIXES list as the sibling modules) ──

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
// Duplicated per-query Tavily→Serper fallback, same shape as the sibling
// discovery modules — kept as its own copy rather than a shared import,
// matching this codebase's existing precedent (see website-discovery.ts /
// competitor-discovery.ts / icp-generator.ts, each has its own copy).

// Results-per-query bumped from the sibling modules' default of 3 to 10 —
// company discovery specifically wants breadth (as many raw candidates as
// possible to filter down), unlike competitor/ICP discovery which only need
// a handful of high-signal snippets. Scoped locally via the new maxResults
// param on searchTavily/searchSerper rather than changing their defaults,
// so competitor-discovery.ts/icp-generator.ts/website-discovery.ts are
// unaffected.
const RESULTS_PER_QUERY = 10

async function searchWithFallback(
  query: string,
  tavilyKey: string | undefined,
  serperKey: string | undefined,
): Promise<Array<{ title: string; url: string; content: string }>> {
  if (tavilyKey) {
    const results = await searchTavily(query, tavilyKey, RESULTS_PER_QUERY)
    if (results.length > 0) return results
  }
  if (serperKey) return searchSerper(query, serperKey, RESULTS_PER_QUERY)
  return []
}

// 4 generic queries (as before) + 4 site:-restricted queries against known
// structured B2B/company directories. Serper is a Google SERP wrapper so
// `site:` operators work natively; Tavily's own index respects them loosely
// (may return fewer/no results — searchWithFallback already tolerates that).
// These directories were picked to match this repo's actual target
// industries (manufacturing/industrial/automotive/SaaS/SMB, see CLAUDE.md) —
// not an attempt at universal coverage.
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
  const llmAvailable = !!(process.env.NVIDIA_NIM_API_KEY || process.env.OPENROUTER_API_KEY)
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

// ── Already-researched dedup (cross-search) ─────────────────────────
// discoverCompanies() itself has no DB access (kept Supabase-free, same as
// every other lib/enrichment module — I/O happens at the route layer). This
// is the pure matching logic the API route calls after fetching
// pipeline_test_runs, so a repeat search (same segment re-run, or a
// different segment surfacing an overlapping company) doesn't resurface a
// company already sent through the research pipeline.

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

// ── Main export ───────────────────────────────────────────────────

// Raised from 6 — wider search net (more queries, more results/query) should
// actually surface more candidates to the user, not get truncated back down.
const MAX_COMPANIES = 10
const MAX_SNIPPETS_PER_CANDIDATE = 2

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
      reason: `"${icpSegment.trim()}" looks like a company URL/domain, not an ICP segment. This field expects a segment description (e.g. "oil and gas", "automotive manufacturers", "mid-size SaaS companies") — not the company itself. To find companies similar to a specific company, research that company first and copy one of its "Target Customer Segments," or use Competitor Discovery on that company's report.`,
      candidates_considered: 0,
    }
  }

  const tavilyKey = process.env.TAVILY_API_KEY
  const serperKey = process.env.SERPER_API_KEY

  if (!tavilyKey && !serperKey) {
    return { companies: [], sufficiency: 'insufficient', reason: 'no search API configured', candidates_considered: 0 }
  }

  const queries = buildCompanyDiscoveryQueries(icpSegment.trim())
  let allResults: Array<{ title: string; url: string; content: string }>
  try {
    const resultsPerQuery = await Promise.all(queries.map(q => searchWithFallback(q, tavilyKey, serperKey)))
    allResults = resultsPerQuery.flat()
  } catch (e) {
    return {
      companies: [], sufficiency: 'insufficient',
      reason: `search failed: ${e instanceof Error ? e.message : String(e)}`,
      candidates_considered: 0,
    }
  }

  if (allResults.length === 0) {
    return { companies: [], sufficiency: 'insufficient', reason: 'search returned no results for any company-discovery query', candidates_considered: 0 }
  }

  // ── Extract + group raw candidates by normalized name ─────────────
  // LLM extraction is a second, independent pass over the same raw text
  // (see tryExtractCompaniesWithLLM above) — soft-fails to null if
  // unavailable, in which case this falls back to regex-only exactly like
  // before.
  const llmNamesByResult = await tryExtractCompaniesWithLLM(allResults, icpSegment.trim())

  const grouped = new Map<string, { displayName: string; mention_count: number; source_urls: Set<string>; snippets: string[] }>()

  for (let i = 0; i < allResults.length; i++) {
    const r = allResults[i]
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
      const snippetText = (r.content || r.title).slice(0, 300)
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
    })
  }

  if (survivors.length === 0) {
    return {
      companies: [],
      sufficiency: 'insufficient',
      reason: `${grouped.size} raw candidate(s) found, all rejected (self-name/directory/generic-term)`,
      candidates_considered: grouped.size,
      rejected_candidates: rejected,
    }
  }

  // ── Confidence tiering + cap (pre-domain-resolution rank) ──────────
  const rank: Record<CompanyMatchConfidence, number> = { high: 2, medium: 1, low: 0 }
  const tiered = survivors
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
      reason: fallbackReason(candidate, icpSegment),
      confidence: domainConfirmed ? confidence : 'low',
      source_urls: candidate.source_urls,
    })
  }

  return {
    companies,
    sufficiency: 'sufficient',
    reason: `${companies.length} of ${grouped.size} raw candidate(s) survived filtering`,
    candidates_considered: grouped.size,
    rejected_candidates: rejected,
  }
}
