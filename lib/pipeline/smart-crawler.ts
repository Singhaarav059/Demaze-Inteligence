// Smart crawler (plan §42 G5: robots, sitemap, URL discovery, URL scoring,
// deduplication, page limits, early stopping).
//
// A crawl-POLICY layer on top of G3 (direct-fetcher.ts: raw fetch) and G4
// (html-extractor.ts: HTML → markdown). Decides which URLs to visit, in
// what order, how many, and when to stop — G3/G4 only know how to fetch and
// clean one page at a time.
//
// Reuse decision (documented per this session's own instruction): URL
// scoring/selection (`classifyUrl`, `selectUrlsToScrape`) and multi-locale
// deprioritization (`detectLocalizedUrlStructure`, `isEnglishLocaleSegment`)
// are IMPORTED directly from scraper.ts, not duplicated — that logic is
// substantial and has been fixed through several real, documented bug
// sessions (word-boundary keyword matching, lechler.com locale scoring; see
// CLAUDE.md's history on scraper.ts). Duplicating it risks silently
// drifting out of sync with scraper.ts's own future fixes. Sitemap XML tag
// extraction, URL dedup, and the corporate-sub-sitemap allowlist ARE small
// enough to duplicate (a few lines each) — same "duplication over sharing
// for small helpers" convention already established by website-
// discovery.ts/evidence-extractor.ts/competitor-discovery.ts each keeping
// their own copy of normalizeName/escapeRegex.
//
// NOT wired into the live scrape chain or app/api/admin/test-analysis —
// that's G8's job ("move Firecrawl from default to fallback"). This module
// is a standalone, directly-callable crawler proven against real sites; see
// docs/smart-crawler-comparison.md.
// G6 (cache layer) note: the per-candidate-page fetchAndExtract() call in
// crawlWebsite()'s loop now goes through lib/cache/page-cache.ts's
// fetchAndExtractCached() instead of the raw html-extractor.ts function
// directly — see docs/cache-layer-design.md. This module is STILL not
// wired into the live scrape chain; caching it doesn't change that.
import * as cheerio from 'cheerio'
import { directFetch } from './direct-fetcher'
import { extractCleanText, type FetchAndExtractResult } from './html-extractor'
import { fetchAndExtractCached } from '../cache/page-cache'
import {
  classifyUrl,
  selectUrlsToScrape,
  detectLocalizedUrlStructure,
  isEnglishLocaleSegment,
  type ScoredLink,
} from './scraper'

// Mirrors scraper.ts's own (private, unexported) MAX_DISCOVERED_PAGES —
// duplicating the number, not the logic behind it.
const DEFAULT_MAX_PAGES = 15
const SITEMAP_TIMEOUT_MS = 8_000
const DEFAULT_PAGE_TIMEOUT_MS = 15_000

// Early-stop thresholds mirror scraper.ts's own "need more" probe-trigger
// condition (`selectedHighValue < 4 || categoriesSeen.size < 3`), inverted
// into a stop condition: once at least this many high-value pages have been
// fetched across at least this many distinct categories, further fetching
// stops even if maxPages hasn't been reached.
// ponytail: a flat page-count/category-diversity heuristic, not a real
// evidence-sufficiency model (evidence-ledger.ts's confidence scoring is
// post-claim-verification, not "is there enough raw content yet" — not a
// fit here). Upgrade only if this proves too coarse in practice.
const EARLY_STOP_MIN_HIGH_VALUE_PAGES = 4
const EARLY_STOP_MIN_CATEGORIES = 3
const HIGH_VALUE_SCORE_FLOOR = 15 // same floor scraper.ts uses (article=15, dealer=10 excluded; product=20+ included)

// Same category set scraper.ts's own VALUABLE_CATEGORIES uses for its
// diversity probe trigger (private there, duplicated here for the same
// "small helper" reason as the sitemap/dedup helpers below).
const VALUABLE_CATEGORIES = new Set([
  'investor', 'leadership', 'corporate', 'manufacturing', 'sustainability',
  'careers', 'technology', 'media', 'b2b_services',
])

// ── robots.txt ────────────────────────────────────────────────────────

export interface RobotsRules {
  disallow: string[]
  allow: string[]
  fetched: boolean // false when robots.txt couldn't be fetched/parsed — fails open
}

// Parses the "User-agent: *" group (plus any group whose token mentions
// "demaze" specifically). Pure, no I/O — unit-testable against static text.
export function parseRobotsTxt(text: string): RobotsRules {
  let inRelevantGroup = false
  const disallow: string[] = []
  const allow: string[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const sepIdx = line.indexOf(':')
    if (sepIdx === -1) continue
    const key = line.slice(0, sepIdx).trim().toLowerCase()
    const value = line.slice(sepIdx + 1).trim()
    if (key === 'user-agent') {
      inRelevantGroup = value === '*' || /demaze/i.test(value)
      continue
    }
    if (!inRelevantGroup) continue
    if (key === 'disallow' && value) disallow.push(value)
    if (key === 'allow' && value) allow.push(value)
  }
  return { disallow, allow, fetched: true }
}

export async function fetchRobotsTxt(baseUrl: string): Promise<RobotsRules> {
  try {
    const origin = new URL(baseUrl).origin
    const res = await directFetch(`${origin}/robots.txt`, SITEMAP_TIMEOUT_MS)
    if (!res.ok || !res.text) return { disallow: [], allow: [], fetched: false } // fail open
    return parseRobotsTxt(res.text)
  } catch {
    return { disallow: [], allow: [], fetched: false } // fail open
  }
}

// Standard robots.txt semantics: longest matching prefix rule wins, Allow
// beats Disallow on an exact-length tie. A missing/unfetchable robots.txt
// (`fetched: false`) always allows — same "prefer under-confidence, never
// silently block legitimate research" discipline as website-discovery.ts's
// ambiguous-match handling, and matches how every real browser/crawler
// treats a missing robots.txt.
export function isPathAllowed(path: string, rules: RobotsRules): boolean {
  if (!rules.fetched) return true
  let bestLen = -1
  let allowed = true
  for (const d of rules.disallow) {
    if (path.startsWith(d) && d.length > bestLen) { bestLen = d.length; allowed = false }
  }
  for (const a of rules.allow) {
    if (path.startsWith(a) && a.length >= bestLen) { bestLen = a.length; allowed = true }
  }
  return allowed
}

// ── Sitemap discovery ────────────────────────────────────────────────
// Fetches go through G3's directFetch() (not a bare fetch(), not
// Firecrawl) — same browser UA, retry, and metrics counting as every other
// call this module makes.

function extractLocValues(xml: string): string[] {
  const re = /<loc[^>]*>([^<]+)<\/loc>/gi
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const v = m[1].trim()
    if (v.startsWith('http')) out.push(v)
  }
  return out
}

async function fetchXml(url: string): Promise<string | null> {
  const res = await directFetch(url, SITEMAP_TIMEOUT_MS)
  if (!res.ok || !res.text || res.text.length < 100) return null
  return res.text
}

// Mirrors scraper.ts's fetchSitemapUrls(): a sitemap index only follows
// corporate-shaped sub-sitemaps (skips product/image/video sitemaps on
// large sites) — same allowlist regex, duplicated for the same "small
// helper" reason as extractLocValues above.
export async function discoverSitemapUrls(baseUrl: string): Promise<string[]> {
  const base = baseUrl.replace(/\/$/, '')
  const raw = await fetchXml(`${base}/sitemap.xml`)
  if (!raw) return []

  if (raw.includes('<sitemapindex') || raw.includes('<sitemap>')) {
    const subUrls = extractLocValues(raw)
      .filter((u) => u.endsWith('.xml'))
      .filter((u) => /corporate|about|investor|sustainability|esg|careers|newsroom|press|manufactur|technolog|ir[-_]/i.test(u))
      .slice(0, 5)
    const subResults = await Promise.all(
      subUrls.map(async (u) => {
        const subRaw = await fetchXml(u)
        return subRaw ? extractLocValues(subRaw).filter((l) => !l.endsWith('.xml') && !NON_PAGE_EXTENSION_RE.test(l)) : []
      })
    )
    return subResults.flat()
  }

  return extractLocValues(raw).filter((u) => !u.endsWith('.xml') && !NON_PAGE_EXTENSION_RE.test(u))
}

// ── Homepage link extraction ─────────────────────────────────────────
// Genuinely new for G5 — neither G3 nor G4 extracts links (G4's
// fetchAndExtract() only returns markdown, not the raw HTML a link
// extractor needs). Reuses cheerio, already a dependency since G4.

// Shared by both homepage-link extraction and sitemap discovery — G4's
// extractCleanText() only handles HTML; a non-HTML candidate always fails
// fetchAndExtract() (`non-HTML content-type`), so filtering these out here
// is a URL-scoring/discovery concern (G5's own job), not scope creep.
// Real bug this fixed (live-verified, see docs/smart-crawler-comparison.md):
// bharatforge.com's sitemap is dominated by investor-report PDFs scoring
// 100 (top `investor` category) — before this filter, all top-15
// highest-scored candidates were PDFs and 0 of 15 fetches succeeded.
const NON_PAGE_EXTENSION_RE = /\.(pdf|docx|xlsx|zip|jpg|jpeg|png|gif|svg|mp4|webp)$/i

export function extractSameDomainLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html)
  let base: URL
  try { base = new URL(baseUrl) } catch { return [] }
  const baseDomain = base.hostname.replace(/^www\./, '')
  const seen = new Set<string>()
  const out: string[] = []
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')
    if (!href) return
    let parsed: URL
    try { parsed = new URL(href, baseUrl) } catch { return }
    if (parsed.hostname.replace(/^www\./, '') !== baseDomain) return
    const path = parsed.pathname
    if (!path || path === '/' || path === base.pathname) return
    if (NON_PAGE_EXTENSION_RE.test(path)) return
    const canonical = `${parsed.protocol}//${parsed.host}${path}`.replace(/\/$/, '')
    if (!seen.has(canonical)) { seen.add(canonical); out.push(canonical) }
  })
  return out
}

// ── Dedup ─────────────────────────────────────────────────────────────
// Trivial (Set-based unique filter) — same class as scraper.ts's own
// private deduplicateUrls(), duplicated rather than imported.
export function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>()
  return urls.filter((u) => (seen.has(u) ? false : (seen.add(u), true)))
}

// ── Orchestration ────────────────────────────────────────────────────

export interface CrawlOptions {
  maxPages?: number // max pages fetched BEYOND the homepage (mirrors scraper.ts's MAX_DISCOVERED_PAGES semantics)
  pageTimeoutMs?: number
}

export interface CrawlDebugInfo {
  robotsFetched: boolean
  robotsDisallowedSkipped: number
  candidatesFound: number
  sitemapUrlsFound: number
  homepageLinksFound: number
  discoveryMethod: 'sitemap' | 'homepage_links' | 'none'
  pagesAttemptedBeyondHomepage: number
  earlyStopped: boolean
  scored: ScoredLink[]
}

export interface CrawlResult {
  baseUrl: string
  pages: FetchAndExtractResult[]
  debug: CrawlDebugInfo
}

export async function crawlWebsite(baseUrl: string, options: CrawlOptions = {}): Promise<CrawlResult> {
  const maxPages = Math.max(0, options.maxPages ?? DEFAULT_MAX_PAGES)
  const pageTimeoutMs = options.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS

  const [homepageFetch, robots, sitemapUrls] = await Promise.all([
    directFetch(baseUrl, pageTimeoutMs),
    fetchRobotsTxt(baseUrl),
    discoverSitemapUrls(baseUrl),
  ])

  const pages: FetchAndExtractResult[] = []
  let homepageLinks: string[] = []
  if (homepageFetch.ok && homepageFetch.text && homepageFetch.isHtml) {
    const { title, markdown, charCount } = extractCleanText(homepageFetch.text)
    if (markdown) pages.push({ url: homepageFetch.url, success: true, markdown, charCount, title })
    homepageLinks = extractSameDomainLinks(homepageFetch.text, homepageFetch.url)
  }

  const discoveryMethod: CrawlDebugInfo['discoveryMethod'] =
    sitemapUrls.length > 0 ? 'sitemap' : homepageLinks.length > 0 ? 'homepage_links' : 'none'

  const homepageNorm = baseUrl.replace(/\/$/, '')
  const allCandidates = dedupeUrls([...sitemapUrls, ...homepageLinks])
    .filter((u) => u.replace(/\/$/, '') !== homepageNorm)

  const localeSegments = detectLocalizedUrlStructure(allCandidates)
  // isB2C is a homepage-content-pattern signal (scraper.ts's own B2C
  // detection) — out of scope for proving crawl policy standalone; treat
  // every crawl as non-B2C (the more permissive path, keeps 'other'-tier
  // pages in play) so this module doesn't need scraper.ts's B2C content
  // patterns wired in. Revisit if a future session wires this into a
  // B2C-aware pipeline.
  const { scored } = selectUrlsToScrape(allCandidates, false, allCandidates.length, localeSegments)

  let disallowedSkipped = 0
  const allowedCandidates = scored.filter((s) => {
    let path: string
    try { path = new URL(s.url).pathname } catch { return true }
    const ok = isPathAllowed(path, robots)
    if (!ok) disallowedSkipped++
    return ok
  })

  // Fetch in score-descending order (selectUrlsToScrape already sorts this
  // way), stopping at maxPages OR once the high-value/category-diversity
  // floor is met (early stopping).
  const categoriesSeen = new Set<string>()
  let highValueCount = 0
  let earlyStopped = false
  let attempted = 0

  for (const candidate of allowedCandidates) {
    if (attempted >= maxPages) break
    attempted++
    const result = await fetchAndExtractCached(candidate.url, pageTimeoutMs)
    if (result.success) {
      pages.push(result)
      if (VALUABLE_CATEGORIES.has(candidate.tier)) categoriesSeen.add(candidate.tier)
      if (candidate.score > HIGH_VALUE_SCORE_FLOOR) highValueCount++
      if (highValueCount >= EARLY_STOP_MIN_HIGH_VALUE_PAGES && categoriesSeen.size >= EARLY_STOP_MIN_CATEGORIES) {
        earlyStopped = true
        break
      }
    }
  }

  return {
    baseUrl,
    pages,
    debug: {
      robotsFetched: robots.fetched,
      robotsDisallowedSkipped: disallowedSkipped,
      candidatesFound: allCandidates.length,
      sitemapUrlsFound: sitemapUrls.length,
      homepageLinksFound: homepageLinks.length,
      discoveryMethod,
      pagesAttemptedBeyondHomepage: attempted,
      earlyStopped,
      scored,
    },
  }
}

// isEnglishLocaleSegment is re-exported for parity/testability — this
// module doesn't call it directly (selectUrlsToScrape already consumes it
// internally via localeSegments), but keeping it importable alongside the
// rest of the reused scraper.ts surface avoids a second import line at
// call sites that want to inspect locale decisions from CrawlResult.scored.
export { isEnglishLocaleSegment }
