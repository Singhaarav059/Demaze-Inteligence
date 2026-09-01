// ============================================================
// Demaze AI Outbound Intelligence Platform
// Scrape Relevance Engine (Production Hardening Master Plan — Phase 3)
// ============================================================
//
// assessScrapeQuality() (scraper.ts) scores the SCRAPE AS A WHOLE — page
// count, char count, a locale/low-value-URL RATIO computed from the URL
// shapes selected pre-scrape. That's a coarse proxy: 15 pages of the wrong
// content currently scores identically to 15 pages of the right content
// (see CLAUDE.md's 2026-07-24 audit).
//
// This module scores each SCRAPED PAGE individually, using the page's own
// content (not just its URL), then selects the strongest corpus for
// evidence extraction. Deterministic only — no LLM call per page (Master
// Plan Rule 2: "if a bug can be fixed deterministically, do not solve it
// by adding another LLM call").
//
// Reuses, rather than reinvents:
//   - classifyUrl()          (scraper.ts)              — URL category/score
//   - mentionsCompany()      (extraction-guards.ts)     — word-boundary-safe
//                                                          company-identity match
//   - formatScrapedPages()   (scrape-utils.ts)          — corpus formatting
// This repo has a well-documented history of short-keyword substring-
// collision bugs from naive matching ('ir' matching inside 'wire') — any
// new identity check here goes through mentionsCompany(), never a fresh
// `.includes()`.
//
// Scope: operates on ScrapeResult.pages — the target company's OWN domain,
// already scraped. Does NOT touch enrichment's externally-fetched sources
// (Tavily/PDF, a separate, larger cross-domain contamination risk, out of
// scope here) and does NOT change what gets scraped — classifyUrl()/
// selectUrlsToScrape() in scraper.ts (pre-scrape "what to fetch" decision)
// are untouched. This only changes what gets INCLUDED in the content passed
// downstream to evidence extraction.
// ============================================================

import { classifyUrl, MIN_USEFUL_CHARS, type ScrapePageResult } from './scraper'
import { formatScrapedPages } from '@/lib/prompts/scrape-utils'
import { mentionsCompany } from '@/lib/enrichment/extraction-guards'

// ── Tuning constants ─────────────────────────────────────────────
// Calibrated so a well-classified page (investor/leadership/corporate/
// manufacturing, score 85-100) NEVER gets excluded purely for lacking a
// company-name mention (score stays well above REJECTION_FLOOR even after
// the full penalty) — real pages often describe operations in third person
// without repeating the brand name, and `nav`/`footer` (where a copyright-
// line mention would usually live) is deliberately excluded from scraped
// content upstream. Only a page that ALSO has a weak/generic URL category
// (score <= 30, i.e. 'other'/'article'/'dealer') AND never mentions the
// company falls below the floor — the actual "wrong company page" shape.
const IDENTITY_MATCH_BONUS = 15
const IDENTITY_MISMATCH_PENALTY = 45
const REJECTION_FLOOR = 25
const DUPLICATE_SIMILARITY_THRESHOLD = 0.85
const MAX_CORPUS_CHARS = 20_000 // matches scraper.ts's own MAX_TOTAL_CHARS cap

// Categories where legitimate own-domain content routinely never repeats
// the company's name (a job listing, a blog/press article) — exempt from
// the identity-mismatch penalty. Deliberately narrow: the master plan's own
// example pair is "/careers" and "/blog" — matching this repo's extensively
// documented "prefer under-confidence, don't over-filter" discipline rather
// than exempting every category that COULD plausibly omit the name.
const IDENTITY_EXEMPT_CATEGORIES = new Set(['careers', 'media', 'article'])

// Boilerplate URL shapes (Master Plan Step 3.1's "low priority" list:
// PRIVACY/COOKIE/TERMS/LOGIN/SIGNUP/SEARCH). classifyUrl() has no dedicated
// low-priority category for these — they simply fall to 'other'=30,
// competing on equal footing with genuine unclassified content — so this is
// a second, independent, POST-scrape-only check. It never touches
// scraper.ts's pre-scrape page selection. Same word-boundary-on-path-
// segment discipline as matchesKeyword() (scraper.ts), duplicated locally
// rather than imported — matching this codebase's established per-file
// small-helper duplication precedent (escapeRegex(), isSelfName()'s
// normalizeName(), etc. are all similarly duplicated rather than shared).
const BOILERPLATE_URL_KEYWORDS = [
  'privacy', 'privacy-policy', 'cookie', 'cookies', 'terms', 'terms-of-service',
  'terms-of-use', 'tos', 'login', 'signin', 'sign-in', 'signup', 'sign-up',
  'register', 'search', '404', 'not-found', 'sitemap',
]

function isBoilerplateUrl(path: string): boolean {
  const lower = path.toLowerCase()
  const sep = '[-_/.]'
  return BOILERPLATE_URL_KEYWORDS.some(kw => new RegExp(`(?:^|${sep})${kw}(?:${sep}|$)`).test(lower))
}

// ── Near-duplicate content detection (Master Plan Step 3.4) ─────────────
// Cheap, deterministic, no new dependency — Jaccard similarity over
// normalized word sets. Catches regional-locale clones (near-identical body
// text under different URLs) and a page re-scraped under a slightly
// different URL, without pulling in a shingling/similarity-hashing library.
function normalizeForSimilarity(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

function wordSet(text: string): Set<string> {
  return new Set(normalizeForSimilarity(text).split(' ').filter(w => w.length > 2))
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const w of a) if (b.has(w)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

function pathOf(url: string): string {
  try { return new URL(url).pathname } catch { return url }
}

// ── Syndicated news-ticker widget detection (found live, 2026-08-27) ────
// A real Lechler press page (own-domain URL, page_type 'press') had a
// third-party financial-news-ticker widget scraped verbatim alongside its
// genuine content — unrelated stock-earnings headlines and an unrelated zoo
// executive's bio, sitting on the same page. Both got tagged origin:
// 'own_site' purely because the URL is on lechler.com, and
// evidence-extractor.ts's SIGNAL_PATTERNS then matched a real, verbatim-
// quotable phrase out of the widget (a leadership_hiring hit on the zoo
// bio), which deriveWhyNowTrace() cited as the company's "Why Now" trigger.
// Quote-verification correctly proves a claimed quote is real text from a
// real source; it says nothing about whether that source is actually about
// the researched company — same gap extraction-guards.ts's header already
// documents for cross-domain search contamination, just found here in an
// own-domain page instead. Recognizable by a distinct structural shape that
// never occurs in organic company-authored prose: a relative-time news-feed
// timestamp ("N hours ago") co-occurring with earnings/stock vocabulary.
// A whole-page reject (not a block-level strip) — safer and consistent with
// this module's other hard-exclusion categories, and the safety-net
// fallback below still guards against zeroing the corpus if a company's
// entire scrape happens to be this kind of page.
const NEWS_TICKER_TIMESTAMP = /\b\d{1,2}\s*hours?\s+ago\b/i
const STOCK_MARKET_VOCAB = /\b(?:earnings|revenue\s+growth|quarterly\s+(?:highlights|results)|q[1-4]\s*20\d{2}\s+earnings|jumps?\s+\d+(?:\.\d+)?%)\b/i

export function looksLikeSyndicatedNewsTicker(text: string): boolean {
  return NEWS_TICKER_TIMESTAMP.test(text) && STOCK_MARKET_VOCAB.test(text)
}

// ── Types (Master Plan Step 3.5 naming) ──────────────────────────────────

export type RejectionReason =
  | 'scrape_failed'        // page.success === false, or empty content
  | 'thin_content'         // below MIN_USEFUL_CHARS
  | 'boilerplate'          // privacy/cookie/terms/login/search/etc.
  | 'identity_mismatch'    // weak URL category + company name never mentioned
  | 'duplicate_content'    // near-identical to an already-selected page
  | 'syndicated_content'   // third-party news-ticker widget embedded in the page — see looksLikeSyndicatedNewsTicker()

interface PageRelevance {
  category: string
  score: number
  identityMatch: boolean
  identityExempt: boolean
}

export interface CorpusSelectionResult {
  selectedPages: ScrapePageResult[]
  rejectedPages: ScrapePageResult[]
  rejectionReasons: Record<string, RejectionReason>
  relevanceScores: Record<string, number>
  corpusContent: string
  // True when every page would otherwise have been rejected and the safety
  // net below fell back to the full (unfiltered) usable-page set — matches
  // this repo's extensively documented "never silently zero a corpus"
  // discipline (CLAUDE.md's "silent zero" audit chain). When true,
  // rejectedPages/rejectionReasons are cleared (nothing was actually
  // excluded from the final corpus).
  fallbackApplied: boolean
}

function scorePage(page: ScrapePageResult, companyName: string): PageRelevance {
  const { category, score: urlScore } = classifyUrl(pathOf(page.url))
  const identityExempt = IDENTITY_EXEMPT_CATEGORIES.has(category)

  const identityMatch = mentionsCompany(page.markdown, companyName)
  let identityDelta = 0
  if (identityMatch) identityDelta = IDENTITY_MATCH_BONUS
  else if (!identityExempt) identityDelta = -IDENTITY_MISMATCH_PENALTY

  const densityDelta = page.charCount >= 2000 ? 10 : page.charCount >= 800 ? 5 : 0

  const score = Math.max(0, Math.min(100, urlScore + identityDelta + densityDelta))
  return { category, score, identityMatch, identityExempt }
}

function buildCorpusContent(pages: ScrapePageResult[]): string {
  const formatted = formatScrapedPages(pages.map(p => ({ url: p.url, markdown: p.markdown, success: p.success })))
  return formatted.length <= MAX_CORPUS_CHARS ? formatted : formatted.slice(0, MAX_CORPUS_CHARS)
}

/**
 * Select the strongest research corpus from a set of already-scraped pages.
 * Only rejects a page for a CLEAR, confident reason (scrape failure, thin
 * content, boilerplate URL, confirmed near-duplicate, or a weak-category
 * page that never mentions the company) — a merely-low-but-plausible score
 * is kept in `selectedPages`, just reported at a lower relevance score. This
 * mirrors this repo's own extensively documented "prefer under-confidence,
 * a WARN/low-score annotation is safer than exclusion" discipline.
 */
export function selectResearchCorpus(pages: ScrapePageResult[], companyName: string): CorpusSelectionResult {
  const rejectionReasons: Record<string, RejectionReason> = {}
  const relevanceScores: Record<string, number> = {}
  const rejectedPages: ScrapePageResult[] = []
  const survivors: Array<{ page: ScrapePageResult; relevance: PageRelevance }> = []

  for (const page of pages) {
    if (!page.success || page.markdown.trim().length === 0) {
      rejectionReasons[page.url] = 'scrape_failed'
      relevanceScores[page.url] = 0
      rejectedPages.push(page)
      continue
    }
    if (page.charCount < MIN_USEFUL_CHARS) {
      rejectionReasons[page.url] = 'thin_content'
      relevanceScores[page.url] = 0
      rejectedPages.push(page)
      continue
    }
    if (looksLikeSyndicatedNewsTicker(page.markdown)) {
      rejectionReasons[page.url] = 'syndicated_content'
      relevanceScores[page.url] = 0
      rejectedPages.push(page)
      continue
    }

    const relevance = scorePage(page, companyName)
    relevanceScores[page.url] = relevance.score
    survivors.push({ page, relevance })
  }

  // Highest-scoring first: among near-duplicates (e.g. an English page and
  // its non-English regional clone), the stronger one — already ranked
  // higher via classifyUrl()'s category score plus a real identity match —
  // is kept, and its weaker twin is the one flagged 'duplicate_content'.
  survivors.sort((a, b) => b.relevance.score - a.relevance.score)

  const selectedPages: ScrapePageResult[] = []
  const acceptedWordSets: Set<string>[] = []

  for (const { page, relevance } of survivors) {
    const path = pathOf(page.url)

    if (isBoilerplateUrl(path)) {
      rejectionReasons[page.url] = 'boilerplate'
      rejectedPages.push(page)
      continue
    }

    const words = wordSet(page.markdown)
    if (acceptedWordSets.some(accepted => jaccardSimilarity(accepted, words) >= DUPLICATE_SIMILARITY_THRESHOLD)) {
      rejectionReasons[page.url] = 'duplicate_content'
      rejectedPages.push(page)
      continue
    }

    // Exempt categories (careers/media/article) are never rejected on
    // identity grounds — that's the entire point of the exemption, not
    // just a bonus/penalty adjustment. A career listing or blog article can
    // legitimately score low on classifyUrl() alone (e.g. 'article' = 15)
    // without that ALSO being read as an identity-mismatch signal.
    if (!relevance.identityExempt && relevance.score < REJECTION_FLOOR && !relevance.identityMatch) {
      rejectionReasons[page.url] = 'identity_mismatch'
      rejectedPages.push(page)
      continue
    }

    selectedPages.push(page)
    acceptedWordSets.push(words)
  }

  // Safety net — this stage must never produce a worse outcome than not
  // running it at all.
  let fallbackApplied = false
  let finalSelected = selectedPages
  if (finalSelected.length === 0) {
    const usable = pages.filter(p => p.success && p.markdown.trim().length > 0 && p.charCount >= MIN_USEFUL_CHARS)
    if (usable.length > 0) {
      finalSelected = usable
      fallbackApplied = true
    }
  }

  return {
    selectedPages: finalSelected,
    rejectedPages: fallbackApplied ? [] : rejectedPages,
    rejectionReasons: fallbackApplied ? {} : rejectionReasons,
    relevanceScores,
    corpusContent: buildCorpusContent(finalSelected),
    fallbackApplied,
  }
}
