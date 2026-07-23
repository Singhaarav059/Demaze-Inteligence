// ============================================================
// Website Discovery — company name -> confirmed official domain
// ============================================================
// Step zero of the "company identity" pipeline (see CLAUDE.md "Core reframe").
// Input: a company name, optionally a hint domain from the trigger source.
// Output: a confirmed domain with a confidence level, or an explicit
// not-found/ambiguous result — never a silent guess.
//
// Verification is content-based, not URL-string-based: a candidate domain is
// only trusted if the page itself identifies as the target company (word-
// boundary match against title/description/body), the same principle behind
// matchesKeyword() and classifySubject()'s word-boundary fixes this session —
// substring/URL-similarity matching is exactly the false-positive shape those
// fixes exist to avoid.
//
// Governing principle: prefer under-confidence to over-confidence. A silently
// wrong company resolved at step zero poisons every downstream stage and
// produces a confidently-wrong outreach report — worse than an honest
// "website not found" that falls through to enrichment-only evidence.
// ============================================================

import { searchTavily, searchSerper } from './discovery-engine'

// ── Public types ──────────────────────────────────────────────

export type WebsiteDiscoveryStatus = 'confirmed' | 'ambiguous' | 'not_found'
export type WebsiteDiscoveryConfidence = 'high' | 'medium' | 'none'

export interface WebsiteDiscoveryCandidate {
  domain: string
  confidence: WebsiteDiscoveryConfidence
  evidence: string
}

export interface WebsiteDiscoveryResult {
  status: WebsiteDiscoveryStatus
  domain: string | null
  confidence: WebsiteDiscoveryConfidence
  candidates: WebsiteDiscoveryCandidate[]
  reason: string
}

// ── Company name normalization ─────────────────────────────────
// Strips unambiguous legal-entity suffixes only. Deliberately does NOT strip
// words like "Group"/"Company" — these are sometimes part of the actual brand
// identity (e.g. "ATE Group"), stripping them would create false negatives.

const LEGAL_SUFFIXES = /\b(?:pvt\.?|private|ltd\.?|limited|inc\.?|incorporated|llc|corp\.?|corporation|co\.?)\b/gi

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^\w\s-]/g, ' ')   // strip punctuation except hyphens (keep "A-1" intact)
    .replace(/\s+/g, ' ')
    .trim()
}

export function significantWords(normalizedName: string): string[] {
  return normalizedName.split(' ').filter(w => w.length > 0)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ── Known non-corporate domain guard ────────────────────────────
// Some domains will reliably produce a false-positive content match no
// matter how strict the word-matching gets — a government portal, wiki, or
// directory/aggregator page can legitimately mention a company's name
// (even its full name) without BEING that company's own official site.
// Checked BEFORE the content-fetch/word-matching heuristics run — same
// "known-bad names checked before generic heuristics" precedent as
// competitor-discovery.ts's `NON_COMPETITOR_NAMES` list (checked before its
// length/stopword checks in `classifyRejection()`).
//
// Found live 2026-07-15 (Company Discovery Engine's live run, logged in
// CLAUDE.md): "Anadarko Petroleum" (a genuine two-word name, so it doesn't
// hit the single-word-name guard below) resolved at 'medium' confidence to
// petroleum.gov.gy — a Guyana government petroleum-industry info site, not
// Anadarko's real corporate domain. This guard rejects that domain shape
// outright, before any fetch/scoring happens. Also directly covers the
// AITG/aitg.miraheze.org false positive's domain shape (that specific case
// is already independently blocked by the single-word-name title-required
// guard in scoreCandidate(), but this guard would catch the same domain
// shape even for a multi-word name).
const NON_CORPORATE_DOMAIN_PATTERNS: RegExp[] = [
  /\.gov$/i,                     // e.g. usa.gov
  /\.gov\.[a-z]{2,3}$/i,         // e.g. petroleum.gov.gy, mca.gov.in
  /\.mil$/i,
  /\.edu$/i,
  /(?:^|\.)wikipedia\.org$/i,
  /(?:^|\.)wikimedia\.org$/i,
  /(?:^|\.)miraheze\.org$/i,     // free wiki hosting — the real AITG false positive's host
  /(?:^|\.)fandom\.com$/i,
  /(?:^|\.)wikia\.org$/i,
  /(?:^|\.)crunchbase\.com$/i,
  /(?:^|\.)linkedin\.com$/i,
  /(?:^|\.)glassdoor\.com$/i,
  /(?:^|\.)indeed\.com$/i,
  /(?:^|\.)g2\.com$/i,
  /(?:^|\.)capterra\.com$/i,
]

export function isKnownNonCorporateDomain(domain: string): boolean {
  return NON_CORPORATE_DOMAIN_PATTERNS.some(p => p.test(domain))
}

// ── Word-proximity check ─────────────────────────────────────────
// "All significant words appear somewhere in a 2000-char body snippet" is
// not, by itself, strong evidence the words refer to the same entity — a
// generic industry/government page can mention a company's most-generic
// name-word constantly (e.g. "petroleum") while only mentioning its
// distinctive word (e.g. "Anadarko") once, in an unrelated sentence, on the
// same page. Require multi-word names to have their words actually appear
// near each other (i.e. a real mention of the name, not scattered
// coincidental word matches) before trusting a body/description-only match.
// This is the enforcement of what the original body-match confidence tier
// always assumed ("3 corroborating words matching together is real
// evidence a single acronym match isn't" — see the single-word-name guard
// below) but never actually checked.
const PROXIMITY_WINDOW_CHARS = 120

export function wordsAppearTogether(words: string[], text: string, windowChars = PROXIMITY_WINDOW_CHARS): boolean {
  if (words.length <= 1) return true
  const anchorRegex = new RegExp(`\\b${escapeRegex(words[0])}\\b`, 'gi')
  let match: RegExpExecArray | null
  while ((match = anchorRegex.exec(text)) !== null) {
    const start = Math.max(0, match.index - windowChars)
    const end = Math.min(text.length, match.index + match[0].length + windowChars)
    const window = text.slice(start, end)
    if (words.every(w => new RegExp(`\\b${escapeRegex(w)}\\b`, 'i').test(window))) {
      return true
    }
    // Avoid infinite loop on zero-length matches (can't happen with \b...\b
    // word patterns, but keep the guard cheap and explicit anyway).
    if (match[0].length === 0) anchorRegex.lastIndex++
  }
  return false
}

// ── Word-boundary match ratio ───────────────────────────────────
// Fraction of the company name's significant words found as whole-word
// matches in the candidate text. A single generic word matching (e.g. "Ace"
// in both "Ace Pipeline" and "Ace Hardware") caps out well below 1.0 for any
// multi-word name — this is what keeps a single shared word from producing
// false HIGH confidence.

function wordMatchRatio(words: string[], text: string): number {
  if (words.length === 0) return 0
  const t = text.toLowerCase()
  const matched = words.filter(w => new RegExp(`\\b${escapeRegex(w)}\\b`, 'i').test(t))
  return matched.length / words.length
}

// ── Lightweight homepage identity fetch ─────────────────────────
// Plain fetch + HTML parse first — this runs against unconfirmed candidates
// (up to ~4 per request), so the common case must stay cheap. If the plain
// fetch fails or times out, fall back to a single Firecrawl scrape of the
// same URL before giving up — plain fetch has no anti-bot handling, JS
// rendering, or retry logic, so a real, correctly-named candidate domain can
// still score 'none' purely because the homepage fetch itself failed (this
// is exactly what happened live for ATE Group: Serper surfaced the right
// domain, ategroup.com, but the plain-fetch verification step timed out
// against it, so discovery fell through to 'not_found' instead of
// confirming a real match — logged in CLAUDE.md as a known, not-yet-fixed
// precision gap). Firecrawl is already used elsewhere in this pipeline
// (scraper.ts, web-enricher.ts) for exactly this reliability reason; this
// reuses the same fetchWithFirecrawl() calling pattern rather than inventing
// a new one.

export interface HomepageIdentity {
  title: string
  description: string
  bodySnippet: string
}

async function fetchHomepageIdentityPlain(url: string): Promise<HomepageIdentity | null> {
  try {
    const resp = await Promise.race([
      fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DemazeBot/1.0)' },
        redirect: 'follow',
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8_000)),
    ]) as Response

    if (!resp.ok) return null
    const html = await resp.text()

    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? ''
    const description = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i)?.[1]?.trim() ?? ''
    const bodySnippet = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2_000)

    return { title, description, bodySnippet }
  } catch {
    return null
  }
}

async function fetchHomepageIdentityViaFirecrawl(url: string): Promise<HomepageIdentity | null> {
  const firecrawlKey = process.env.FIRECRAWL_API_KEY
  if (!firecrawlKey) return null

  try {
    const { default: Firecrawl } = await import('@mendable/firecrawl-js')
    const app = new Firecrawl({ apiKey: firecrawlKey })

    const result = await Promise.race([
      app.scrapeUrl(url, { formats: ['markdown'] }),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 12_000)),
    ])

    if (!result) return null
    const r = result as Record<string, unknown>
    // NOTE: the installed @mendable/firecrawl-js version returns the scraped
    // document directly (just { markdown, metadata, ... }) on success and
    // throws (caught below) on failure — there is no `.success` field on this
    // SDK version despite some older call sites in this repo checking for one
    // (see fetchWithFirecrawl() in web-enricher.ts, same stale assumption,
    // confirmed live: `r.success` is `undefined` on a real successful scrape).
    // Presence of markdown/metadata is the actual success signal here.
    const metadata = (r.metadata ?? {}) as { title?: string; description?: string }
    const markdown = typeof r.markdown === 'string' ? r.markdown : ''
    const bodySnippet = markdown
      .replace(/[#*_`>\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2_000)

    if (!metadata.title && !metadata.description && !bodySnippet) return null
    return { title: metadata.title ?? '', description: metadata.description ?? '', bodySnippet }
  } catch {
    return null
  }
}

async function fetchHomepageIdentity(url: string): Promise<HomepageIdentity | null> {
  const plain = await fetchHomepageIdentityPlain(url)
  if (plain) return plain
  return fetchHomepageIdentityViaFirecrawl(url)
}

// ── Confidence scoring ───────────────────────────────────────────

export function scoreCandidate(words: string[], identity: HomepageIdentity): { confidence: WebsiteDiscoveryConfidence; evidence: string } {
  const titleRatio = wordMatchRatio(words, identity.title)
  const descRatio = wordMatchRatio(words, identity.description)
  const bodyRatio = wordMatchRatio(words, identity.bodySnippet)

  if (titleRatio === 1) {
    return { confidence: 'high', evidence: `full name match in page title: "${identity.title.slice(0, 100)}"` }
  }

  // Single-word (typically acronym-style) company names are a real collision
  // trap: "AITG" has ratio=1 against ANY page that mentions the string "AITG"
  // even once, anywhere, with no other word to corroborate it's the same
  // entity. Found live: "AITG" wrongly confirmed against aitg.miraheze.org (an
  // unrelated wiki) via a body-text-only match, because no other candidate
  // scored anything either, so there was nothing to trigger ambiguity
  // detection. A body/description-only match is far too weak a signal for a
  // single-word name — require a title match (handled above) or refuse to
  // confirm at all. Does not affect multi-word names (e.g. "A-1 Fence
  // Products" still confirms correctly on a body match, since 3 corroborating
  // words matching together is real evidence a single acronym match isn't).
  if (words.length === 1 && titleRatio < 1) {
    return { confidence: 'none', evidence: 'single-word/acronym-style name — body or description match alone is too weak to confirm without a title match' }
  }

  if (titleRatio >= 0.5 || descRatio === 1 || bodyRatio === 1) {
    // Body/description-only matches (no partial title match) additionally
    // require the words to appear NEAR each other in the source text, not
    // just present somewhere in a 2000-char snippet — see
    // wordsAppearTogether()'s header comment. A partial title match is
    // exempt: the title itself is short, so "all significant words present"
    // in it is already strong proximity evidence on its own.
    if (titleRatio < 0.5) {
      const sourceText = descRatio === 1 ? identity.description : identity.bodySnippet
      if (!wordsAppearTogether(words, sourceText)) {
        return {
          confidence: 'none',
          evidence: 'name words matched individually but not together in the same mention — likely coincidental/unrelated occurrences, not the company\'s own site',
        }
      }
    }
    const where = titleRatio >= 0.5 ? `partial match in title: "${identity.title.slice(0, 100)}"`
      : descRatio === 1 ? `full match in meta description: "${identity.description.slice(0, 100)}"`
      : `full match in page body`
    return { confidence: 'medium', evidence: where }
  }
  return { confidence: 'none', evidence: 'no meaningful word-boundary match against title/description/body' }
}

// ── Candidate domain extraction from search results ──────────────

function extractDomain(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
}

// Falls back to Serper per-query when Tavily returns nothing — not just when
// the Tavily key is absent entirely. Discovered while wiring this up: Tavily
// can fail for reasons that have nothing to do with the query (quota exhausted
// returns HTTP 432, silently swallowed by searchTavily's catch-all error
// handling) — without this, a Tavily outage/quota issue would make discovery
// look like "no candidates found" instead of actually trying the other
// configured provider. This is a real gap `discoverEvidenceSources()` in
// discovery-engine.ts also has (same "prefer Tavily, no fallback on failure"
// shape) — not fixed there, out of scope for this file.
async function searchWithFallback(
  query: string,
  tavilyKey: string | undefined,
  serperKey: string | undefined,
): Promise<Array<{ title: string; url: string; content: string }>> {
  if (tavilyKey) {
    const tavilyResults = await searchTavily(query, tavilyKey)
    if (tavilyResults.length > 0) return tavilyResults
  }
  if (serperKey) return searchSerper(query, serperKey)
  return []
}

async function searchCandidateDomains(companyName: string): Promise<string[]> {
  const tavilyKey = process.env.TAVILY_API_KEY
  const serperKey = process.env.SERPER_API_KEY
  if (!tavilyKey && !serperKey) return []

  const queries = [
    `"${companyName}" official website`,
    `${companyName} company website`,
  ]

  const results = await Promise.all(
    queries.map(q => searchWithFallback(q, tavilyKey, serperKey))
  )

  const domains: string[] = []
  const seen = new Set<string>()
  for (const raw of results.flat()) {
    const domain = extractDomain(raw.url)
    if (!domain || seen.has(domain)) continue
    seen.add(domain)
    domains.push(domain)
  }
  return domains
}

// ── Main export ───────────────────────────────────────────────

const CONFIDENCE_GAP_FOR_AMBIGUITY = 0   // two candidates tie at the same confidence tier = ambiguous
const MAX_CANDIDATES_VERIFIED = 4

export async function discoverCompanyWebsite(
  companyName: string,
  knownDomain?: string,
): Promise<WebsiteDiscoveryResult> {
  const normalized = normalizeCompanyName(companyName)
  const words = significantWords(normalized)

  if (words.length === 0) {
    return { status: 'not_found', domain: null, confidence: 'none', candidates: [], reason: 'company name did not normalize to any significant words' }
  }

  // Known domain (if provided by the trigger) goes first, but is still verified,
  // not trusted blindly — same principle as everything else here.
  const searchDomains = await searchCandidateDomains(companyName)
  const domainsToCheck = [
    ...(knownDomain ? [knownDomain.replace(/^www\./, '')] : []),
    ...searchDomains.filter(d => d !== knownDomain),
  ].slice(0, MAX_CANDIDATES_VERIFIED)

  if (domainsToCheck.length === 0) {
    return { status: 'not_found', domain: null, confidence: 'none', candidates: [], reason: 'no search API configured or no candidate domains found' }
  }

  const candidates: WebsiteDiscoveryCandidate[] = []
  for (const domain of domainsToCheck) {
    if (isKnownNonCorporateDomain(domain)) {
      candidates.push({
        domain,
        confidence: 'none',
        evidence: 'known non-corporate domain pattern (government/wiki/directory/aggregator hosting) — not a plausible official company site',
      })
      continue
    }
    const identity = await fetchHomepageIdentity(`https://${domain}`)
    if (!identity) {
      candidates.push({ domain, confidence: 'none', evidence: 'homepage fetch failed or timed out' })
      continue
    }
    const { confidence, evidence } = scoreCandidate(words, identity)
    candidates.push({ domain, confidence, evidence })
  }

  const rank: Record<WebsiteDiscoveryConfidence, number> = { high: 2, medium: 1, none: 0 }
  candidates.sort((a, b) => rank[b.confidence] - rank[a.confidence])

  const top = candidates[0]
  const second = candidates[1]

  if (top.confidence === 'none') {
    return {
      status: 'not_found',
      domain: null,
      confidence: 'none',
      candidates,
      reason: `checked ${candidates.length} candidate domain(s), none identified as "${companyName}" on their own homepage`,
    }
  }

  // Ambiguous: top two candidates tied at the same confidence tier — don't
  // silently pick one when the evidence doesn't actually distinguish them.
  if (second && rank[second.confidence] === rank[top.confidence] - CONFIDENCE_GAP_FOR_AMBIGUITY && rank[second.confidence] > 0) {
    return {
      status: 'ambiguous',
      domain: null,
      confidence: 'none',
      candidates,
      reason: `${candidates.filter(c => c.confidence === top.confidence).length} candidates tied at "${top.confidence}" confidence, could not disambiguate which is the real "${companyName}"`,
    }
  }

  return {
    status: 'confirmed',
    domain: top.domain,
    confidence: top.confidence,
    candidates,
    reason: top.evidence,
  }
}
