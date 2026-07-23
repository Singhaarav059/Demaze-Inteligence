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

// A real, current-browser-shaped User-Agent — see the identical constant +
// comment in lib/pipeline/scraper.ts (2026-07-23 Muthoot Finance / A-1 Fence
// scraper-reliability investigation) for the root cause this fixes: the old
// self-identifying 'DemazeBot' UA got hard-blocked (403) by at least one
// real target site's CloudFront WAF, confirmed via direct curl. Duplicated
// here rather than shared, matching this repo's existing precedent of
// duplicating small constants across enrichment/pipeline modules rather than
// adding a new shared import for a one-line string.
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

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

function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^\w\s-]/g, ' ')   // strip punctuation except hyphens (keep "A-1" intact)
    .replace(/\s+/g, ' ')
    .trim()
}

function significantWords(normalizedName: string): string[] {
  return normalizedName.split(' ').filter(w => w.length > 0)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

interface HomepageIdentity {
  title: string
  description: string
  bodySnippet: string
}

async function fetchHomepageIdentityPlain(url: string): Promise<HomepageIdentity | null> {
  try {
    const resp = await Promise.race([
      fetch(url, {
        headers: { 'User-Agent': BROWSER_USER_AGENT },
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

function scoreCandidate(words: string[], identity: HomepageIdentity): { confidence: WebsiteDiscoveryConfidence; evidence: string } {
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
