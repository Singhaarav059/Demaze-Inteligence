// ============================================================
// Demaze AI Outbound Intelligence Platform
// Pipeline Step 1 — Smart Scraper (Sitemap-Aware + B2C-Safe)
// ============================================================
//
// Strategy (parallel):
//   1. Scrape homepage → markdown + links
//   2. Fetch sitemap.xml ALWAYS (parallel with homepage)
//      Supports sitemap index → follows relevant sub-sitemaps
//   3. Classify all discovered URLs into 8 buckets
//   4. Detect B2C consumer site from homepage content
//   5. If B2C: skip product/dealer pages,
//      inject corporate seed paths (/corporate, /investors, etc.)
//   6. Select top 15 high-value pages and scrape them
//
// Why this is better than the previous "follow homepage links":
//   The old approach crawled whatever the homepage linked to.
//   On consumer sites (Maruti, Volvo Cars) that's product pages
//   and dealer pages — zero corporate intelligence.
//   Sitemap-first guarantees we see every URL the site exposes,
//   then we pick the ones that have intelligence value.
//
// SDK: @mendable/firecrawl-js v4.x
//   - Use client.scrape() — NOT client.scrapeUrl() (deprecated)
//   - Response: Document { markdown?, links? }
// ============================================================

import Firecrawl from '@mendable/firecrawl-js'
import { displayURL } from '@/lib/utils/url'
import { formatScrapedPages } from '@/lib/prompts/scrape-utils'

// ── Constants ─────────────────────────────────────────────────

const MAX_TOTAL_CHARS      = 20_000  // raised from 15k — more pages, more content
const MAX_PAGE_CHARS       =  5_000
const PAGE_TIMEOUT_MS      = 20_000
const SITEMAP_TIMEOUT_MS   =  8_000
const MIN_USEFUL_CHARS     =    150
const MAX_DISCOVERED_PAGES =     15  // raised from 9

// A real, current-browser-shaped User-Agent for every fetch() this file makes
// DIRECTLY against a target site (sitemap fetch, corporate/B2B path probing,
// Jina reader). Root-caused 2026-07-23 (Muthoot Finance / A-1 Fence scraper-
// reliability investigation, see CLAUDE.md): muthootfinance.com sits behind a
// CloudFront WAF rule that hard-blocks (403) any request whose User-Agent is
// either absent (Node's fetch default) or self-identifies as a bot — the
// previous 'Mozilla/5.0 (compatible; DemazeBot/1.0)' string is exactly the
// kind of UA such a rule targets. Confirmed via direct curl: the identical
// request succeeds (200, real content) with this browser-shaped UA and fails
// (403) with either no UA or the old DemazeBot string. Does NOT change what
// Firecrawl sends — Firecrawl's SDK controls its own request headers, out of
// this codebase's control.
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// ── URL category scoring ──────────────────────────────────────
// Each URL is classified into one of these buckets.
// score = base priority for selection.
// keep_b2c = whether to keep this URL when a B2C consumer site
//            is detected. Product/dealer pages are filtered out.

const URL_CATEGORY_CONFIG: Record<
  string,
  { score: number; keep_b2c: boolean; keywords: string[] }
> = {
  investor: {
    score: 100, keep_b2c: true,
    keywords: [
      'investor', 'investors', 'investor-relations', 'ir',
      'annual-report', 'annual_report', 'annualreport',
      'earnings', 'quarterly-results', 'financial-results',
      'shareholder', 'bse', 'nse', 'sec', 'sebi',
    ],
  },
  // ── Leadership / decision-maker pages — split out from `corporate` ────
  // (2026-07-18 decision-maker discovery fix). Previously these keywords
  // lived inside `corporate` (score 90), competing equally with plain
  // "about us"/"history"/"overview" content for the same score tier — on a
  // large site with many corporate-ish pages, a real leadership/team page
  // was not reliably surviving the MAX_DISCOVERED_PAGES=15 cut. Scored
  // higher (95, just under `investor`) and checked BEFORE `corporate` in
  // this object (classifyUrl returns on first category match, in insertion
  // order) so these keywords no longer compete with the generic corporate
  // bucket at all.
  leadership: {
    score: 95, keep_b2c: true,
    keywords: [
      'leadership', 'leadership-team', 'management-team', 'senior-management',
      'executive-team', 'our-team', 'meet-the-team', 'meet-our-team',
      'core-team', 'board-of-directors', 'board-members', 'management',
      'board', 'governance', 'executive', 'executives', 'chairman',
      'md-speak', 'directors', 'founders', 'ceo',
    ],
  },
  corporate: {
    score: 90, keep_b2c: true,
    keywords: [
      'about', 'about-us', 'aboutus', 'who-we-are', 'our-story',
      'company', 'corporate', 'overview', 'history', 'values', 'mission',
    ],
  },
  manufacturing: {
    score: 85, keep_b2c: true,
    keywords: [
      'manufactur', 'operations', 'facilities', 'plant', 'factory',
      'production', 'assembly', 'capacity', 'supply-chain',
      'quality', 'engineering', 'r-and-d', 'r&d', 'research',
    ],
  },
  sustainability: {
    score: 80, keep_b2c: true,
    keywords: [
      'sustainability', 'esg', 'csr', 'environment', 'climate',
      'green', 'carbon', 'net-zero', 'social-responsibility',
    ],
  },
  careers: {
    score: 75, keep_b2c: true,
    keywords: [
      'career', 'careers', 'jobs', 'hiring', 'join-us',
      'join', 'vacancies', 'work-with-us', 'life-at',
      'people', 'team', 'talent',
    ],
  },
  technology: {
    score: 70, keep_b2c: true,
    keywords: [
      'technology', 'technolog', 'innovation', 'digital',
      'automat', 'software', 'platform', 'industry-4', 'iiot',
      'smart-manufactur', 'ai', 'data',
    ],
  },
  media: {
    score: 65, keep_b2c: true,
    keywords: [
      'news', 'newsroom', 'press', 'press-release', 'media',
      'blog', 'insights', 'announcement', 'update', 'event',
      'resource',  // /resources/ section index — articles inside score 15 via isArticleLeafUrl
    ],
  },
  // ── B2B nav pages — common for industrial/services companies ──
  // These pages (Solutions, Industries, Application, Warranty etc.)
  // carry high intelligence value but don't match any category above.
  // Without this bucket they score 0 ("other") and get crowded out
  // by blog articles that score 15 after the article-leaf fix.
  b2b_services: {
    score: 75, keep_b2c: true,
    keywords: [
      'solutions', 'services', 'industries', 'industry',
      'application', 'capabilities', 'expertise',
      'sectors', 'portfolio', 'warranty', 'partner',
    ],
  },
  // ── B2C pages — filtered when consumer site detected ─────────
  product: {
    score: 20, keep_b2c: false,
    keywords: [
      'product', 'model', 'vehicle', 'car', 'truck', 'suv',
      'sedan', 'hatchback', 'brezza', 'alto', 'swift', 'baleno',
      'arena', 'arenaworld', 'nexa', 'nexaworld', 'configure', 'compare-cars',
    ],
  },
  dealer: {
    score: 10, keep_b2c: false,
    keywords: [
      'dealer', 'showroom', 'dealership', 'locate-dealer',
      'book-test-drive', 'test-drive', 'service-center',
      'book-service', 'service-appointment', 'exchange',
      'emi', 'finance', 'insurance', 'accessories',
    ],
  },
}

// ── B2C consumer site detection ───────────────────────────────
// Same patterns as web-enricher.ts — 3+ hits = consumer site.

const B2C_PATTERNS = [
  /test\s+drive/i,
  /find\s+a\s+dealer/i,
  /build\s+your\s+(car|vehicle|truck)/i,
  /schedule\s+service/i,
  /book\s+a?\s*(test\s+drive|showroom|service)/i,
  /compare\s+(cars|models|vehicles)/i,
  /certified\s+pre-?owned/i,
  /financing\s+options/i,
  /monthly\s+payment/i,
  /msrp/i,
  /starting\s+at\s+\$[\d,]+/i,
  /locate\s+a?\s*dealer/i,
]

export function detectB2CSite(content: string): boolean {
  return B2C_PATTERNS.filter((p) => p.test(content)).length >= 3
}

// ── Corporate seed paths ──────────────────────────────────────
// Probed directly when B2C site detected and no corporate
// URLs found via sitemap/link extraction.

const CORPORATE_SEED_PATHS = [
  // Top-level corporate entry points
  '/corporate',
  '/about',
  '/about-us',
  '/company',
  '/who-we-are',
  // Investor / financial
  '/corporate/investors',
  '/corporate/investor-relations',
  '/investor-relations',
  '/investors',
  '/ir',
  '/annual-report',
  '/corporate/annual-report',
  '/corporate/financials',
  // Corporate identity
  '/corporate/about-us',
  '/corporate/history',
  '/corporate/leadership',
  '/corporate/management',
  '/leadership',
  // Sustainability / ESG
  '/sustainability',
  '/corporate/sustainability',
  '/esg',
  '/csr',
  // Manufacturing / operations
  '/manufacturing',
  '/corporate/manufacturing',
  '/operations',
  '/facilities',
  // Technology / digital
  '/technology',
  '/corporate/technology',
  '/innovation',
  '/digital',
  // Careers
  '/careers',
  '/corporate/careers',
  '/jobs',
  // Media / press
  '/newsroom',
  '/corporate/newsroom',
  '/press-releases',
  '/media',
]

// ── Universal B2B path probing ─────────────────────────────────
// Triggered for ANY site with fewer than 4 discovered pages —
// not just B2C sites. Covers the standard page structure of
// small-to-mid industrial/manufacturing/services companies that
// have no sitemap and sparse homepage link HTML.
//
// Example: ategroup.com has a 6-item nav but Firecrawl only
// returns 1 same-domain link from the homepage body. Without this
// probe we'd scrape 2 pages; with it we scrape 6-8.

// Trimmed to 20 highest-value paths (was 40).
// Worst case: 2 batches × 4s probe timeout = 8s total (was 16s).
// Ordered by intelligence value — most useful paths first so early-exit fires sooner.
const UNIVERSAL_B2B_PATHS = [
  // Tier A: Corporate identity + leadership (highest signal density).
  // Leadership paths PROMOTED here from the old Tier D (2026-07-18,
  // decision-maker discovery fix) — probeUniversalPaths() batches candidates
  // 10 at a time and stops once maxProbe(8) results are found, so paths
  // sitting last in this array often never got probed at all once an
  // earlier batch already found 8 hits. Leadership pages are exactly the
  // kind of page a decision-maker-discovery grounding check needs, so they
  // can't be left to lowest priority.
  '/about/', '/about-us/', '/company/', '/who-we-are/',
  '/leadership/', '/management/', '/team/',
  // Tier B: Business operations (core intelligence)
  '/industries/', '/solutions/', '/services/', '/products/', '/capabilities/',
  '/operations/', '/manufacturing/', '/technology/', '/innovation/',
  // Tier C: Signals & hiring
  '/careers/', '/sustainability/', '/newsroom/', '/csr/',
]

// ── Types ─────────────────────────────────────────────────────

export interface ScrapePageResult {
  url: string
  success: boolean
  markdown: string
  charCount: number
  error?: string
}

export interface ScoredLink {
  url: string
  score: number
  tier: string
}

export interface ScrapeDebugInfo {
  homepageLinksRaw: number
  homepageLinksSameDomain: number
  linkScores: ScoredLink[]
  urlsSelectedForScraping: string[]
  sitemapChecked: boolean
  sitemapUrlsFound: number
  discoveryMethod: string
  isB2CSite: boolean
  b2cPatternsHit: number
  corporateSeedPathsProbed: number
  warnings: string[]
  errors: string[]
}

export interface ScrapeResult {
  pages: ScrapePageResult[]
  combinedContent: string
  successfulUrls: string[]
  failedUrls: string[]
  totalCharCount: number
  wasTruncated: boolean
  discoveryMethod: 'map_url' | 'sitemap' | 'link_extraction' | 'corporate_seed' | 'homepage_only'
  scrapedAt: string
  debug: ScrapeDebugInfo
}

// ── Firecrawl client ──────────────────────────────────────────

function getFirecrawlClient(): Firecrawl {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) {
    throw new Error(
      'FIRECRAWL_API_KEY is not set. Add it to .env.local — get your key at firecrawl.dev'
    )
  }
  return new Firecrawl({ apiKey })
}

// ── URL classifier ────────────────────────────────────────────

/**
 * Returns true when the URL looks like an individual article/post/event page
 * sitting inside a media or blog section, rather than the section index itself.
 *
 * Examples that return true (articles — low intelligence value):
 *   /blogs/how-to-weld-cast-iron
 *   /media-and-events/welding-championship-2023
 *   /news/product-launch-announcement
 *   /insights/five-trends-in-manufacturing
 *
 * Examples that return false (index pages — keep at score 65):
 *   /newsroom
 *   /blogs
 *   /media-and-events
 *   /news/press-releases   ← known sub-section index
 *   /blog/2023             ← date-based archive index
 */
function isArticleLeafUrl(path: string): boolean {
  const segments = path.replace(/\/$/, '').split('/').filter(Boolean)
  // Need at least 2 segments: /category/slug
  if (segments.length < 2) return false

  const firstSeg = segments[0].toLowerCase()
  const secondSeg = segments[1].toLowerCase()

  // Must be a known content/media category at depth 1
  const ARTICLE_FOLDER_KEYWORDS = [
    'blog', 'news', 'press', 'media', 'event',
    'insight', 'update', 'announcement', 'resource',
  ]
  const isContentFolder = ARTICLE_FOLDER_KEYWORDS.some((kw) => firstSeg.includes(kw))
  if (!isContentFolder) return false

  // Exclude known sub-section index names — these are category hubs, not articles
  const SUBCATEGORY_INDEXES = new Set([
    'press-releases', 'press_releases', 'videos', 'video',
    'photos', 'photo', 'gallery', 'archive', 'archives',
    'categories', 'category', 'tags', 'tag', 'all', 'latest',
    'page', 'en', 'hi', 'mr',
  ])
  if (SUBCATEGORY_INDEXES.has(secondSeg)) return false

  // Exclude date-based archive paths like /blog/2023/ or /blog/2023/01/
  if (/^\d{4}$/.test(secondSeg)) return false

  // Two or more segments with a valid second segment → individual article
  return true
}

/**
 * Keyword match with path-segment awareness.
 *
 * Short keywords (≤ 3 chars, e.g. 'ir', 'ai', 'sec', 'nse', 'bse', 'csr')
 * must appear as complete path segments (between slashes or at path boundaries).
 * This prevents 'ir' from matching 'wire', 'ai' from matching 'email'/'waitlist',
 * 'sec' from matching 'security'.
 *
 * Longer keywords use a normal substring match since the probability of
 * accidental partial matches drops sharply beyond 3 chars.
 */
function matchesKeyword(urlPath: string, kw: string): boolean {
  if (kw.length <= 3) {
    // For short keywords require them to be surrounded by word-separators
    // (slash, hyphen, underscore, dot) or at path start/end.
    // This prevents 'ir' matching 'wire', 'sec' matching 'security',
    // 'ai' matching 'email', 'bse' matching 'subscribe', etc.
    // Examples that PASS:  /ir/, /corporate/ir/, /ai-solutions/, /esg/
    // Examples that FAIL:  /barbed-wire.php, /high-security/, /email-trail
    const sep = '[-_/.]'
    const re = new RegExp(`(?:^|${sep})${kw}(?:${sep}|$)`)
    return re.test(urlPath)
  }
  return urlPath.includes(kw)
}

function classifyUrl(path: string): { category: string; score: number; keep_b2c: boolean } {
  const lower = path.toLowerCase()

  for (const [category, config] of Object.entries(URL_CATEGORY_CONFIG)) {
    for (const kw of config.keywords) {
      if (matchesKeyword(lower, kw)) {
        // Detect individual blog/news/media article pages.
        // /blogs/article-slug → score 15 (low intelligence value)
        // /newsroom           → score 65 (section index — keep)
        // Only applies to 'media' category; other categories (manufacturing,
        // corporate, etc.) with deep paths are still corporate intelligence pages.
        if (category === 'media' && isArticleLeafUrl(lower)) {
          return { category: 'article', score: 15, keep_b2c: false }
        }
        return { category, score: config.score, keep_b2c: config.keep_b2c }
      }
    }
  }

  return { category: 'other', score: 30, keep_b2c: true }
}

// ── Sitemap fetching (sitemap index aware) ────────────────────
// Tries /sitemap.xml first.
// If it's a sitemap index, follows sub-sitemaps that look
// corporate (skips product/image/video sitemaps).

async function fetchSitemapUrls(baseUrl: string): Promise<string[]> {
  const base = baseUrl.replace(/\/$/, '')
  const sitemapUrl = `${base}/sitemap.xml`

  const raw = await fetchXml(sitemapUrl)
  if (!raw) return []

  // Sitemap index? Follow only CORPORATE sub-sitemaps.
  // Many consumer sites (Maruti, Volvo Cars) have sitemaps named
  // sitemap-arena.xml, sitemap-nexa.xml, sitemap-arenaworld.xml —
  // these are entirely product/dealer/marketing pages.
  // We use an allowlist: only follow sub-sitemaps whose name
  // suggests corporate intelligence value.
  if (raw.includes('<sitemapindex') || raw.includes('<sitemap>')) {
    const allSubUrls = extractTagValues(raw, 'loc').filter((u) => u.endsWith('.xml'))

    const corporateSubs = allSubUrls.filter((u) => {
      const lower = u.toLowerCase()
      return /corporate|about|investor|sustainability|esg|careers|newsroom|press|manufactur|technolog|ir[-_]/.test(lower)
    })

    // If no corporate sub-sitemaps found, skip sub-sitemap following entirely
    // and let corporate seed probing handle it instead.
    const subUrls = (corporateSubs.length > 0 ? corporateSubs : []).slice(0, 5)

    const subResults = await Promise.all(
      subUrls.map(async (u) => {
        const subRaw = await fetchXml(u)
        if (!subRaw) return []
        return extractTagValues(subRaw, 'loc').filter((l) => !l.endsWith('.xml'))
      })
    )

    return subResults.flat()
  }

  // Regular sitemap
  return extractTagValues(raw, 'loc').filter((u) => !u.endsWith('.xml'))
}

async function fetchXml(url: string): Promise<string | null> {
  try {
    const resp = await Promise.race([
      fetch(url, { headers: { 'Accept': 'application/xml, text/xml, */*', 'User-Agent': BROWSER_USER_AGENT } }),
      rejectAfter(SITEMAP_TIMEOUT_MS, `Sitemap timeout: ${url}`),
    ])
    if (!(resp as Response).ok) return null
    const text = await (resp as Response).text()
    return text.length > 100 ? text : null
  } catch {
    return null
  }
}

function extractTagValues(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'gi')
  const results: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const val = m[1].trim()
    if (val.startsWith('http')) results.push(val)
  }
  return results
}

// ── Link extraction from homepage ────────────────────────────

function extractSameDomainLinks(links: string[], baseUrl: string): string[] {
  const base = new URL(baseUrl)
  const baseDomain = base.hostname.replace(/^www\./, '')
  const seen = new Set<string>()
  const result: string[] = []

  for (const raw of links) {
    let parsed: URL
    try { parsed = new URL(raw, baseUrl) } catch { continue }

    const linkDomain = parsed.hostname.replace(/^www\./, '')
    if (linkDomain !== baseDomain) continue

    const path = parsed.pathname
    if (!path || path === '/' || path === base.pathname) continue
    if (/\.(pdf|docx|xlsx|zip|jpg|jpeg|png|gif|svg|mp4|webp)$/i.test(path)) continue
    if (parsed.pathname.split('/').filter(Boolean).length > 5) continue
    if (/\/\d{4}\/\d{2}/.test(path)) continue  // skip date-based blog paths

    const canonical = `${parsed.protocol}//${parsed.host}${path}`.replace(/\/$/, '')
    if (!seen.has(canonical)) {
      seen.add(canonical)
      result.push(canonical)
    }
  }

  return result
}

// ── Smart URL selection ───────────────────────────────────────
// Classifies all candidate URLs, filters and sorts by score.
// If B2C site: POSITIVE ALLOWLIST — only keep pages we explicitly
// identify as corporate. This prevents arenaworld-style article
// pages that have no keyword match from surviving as 'other'.
// Returns scored list for debug + selected URLs for scraping.

// Categories considered "corporate intelligence" on B2C sites.
// 'other' is intentionally excluded — unknown URLs on consumer
// sites are almost certainly still consumer content.
const CORPORATE_CATEGORIES_B2C = new Set([
  'investor', 'leadership', 'corporate', 'manufacturing',
  'sustainability', 'careers', 'technology', 'media',
])

// ── Locale-aware scoring ────────────────────────────────────────
// Many global corporate sites (e.g. TYPO3/Drupal multi-market sites like
// lechler.com) publish the same content under per-country/language path
// prefixes (/de/, /fr/, /es/, /de-en/, /in-en/, /be-nl/...). classifyUrl()
// scores purely on keyword content, so a French or German page can
// outscore its English counterpart just by sharing the same corporate/
// b2b_services keyword deeper in the path — and evidence-extractor.ts's
// subject-classification and SIGNAL_PATTERNS regexes are English-only, so
// a non-English page silently contributes zero usable evidence even when
// Firecrawl scrapes it successfully. Confirmed live (2026-07-24):
// lechler.com scraped 7 pages at 95/100 quality, 11 of 15 selected
// candidates were German/French/Spanish/Finnish/Dutch, and
// companySubjectCount came back 0 despite genuinely rich content existing.
// This doesn't exclude non-English pages outright (a French-only site
// still needs to surface SOMETHING) — it deprioritizes them behind
// English/unlabeled pages of the same category.
//
// A first-path-segment only counts as a real locale prefix when it (a)
// looks locale-shaped (2 letters, or 2 letters + hyphen + 2 letters) AND
// (b) repeats across 3+ distinct candidate URLs — the same "require
// repeated structural evidence, not a single match" discipline this
// codebase already uses to avoid the 'ir'-inside-'wire' false-positive
// class (see matchesKeyword()'s doc comment), applied here to a new kind
// of false positive: a one-off 2-letter segment (e.g. a genuine /ir/
// investor-relations page) is not a site-wide locale switcher. Segments
// that collide with an existing short (<=3 char) category keyword
// (currently 'ir', 'ai') are excluded outright regardless of repetition,
// since classifyUrl() already gives those a real, more specific meaning.
const LOCALE_SEGMENT_RE = /^[a-z]{2}(-[a-z]{2})?$/i
const MIN_LOCALE_REPEAT = 3
const NON_ENGLISH_LOCALE_PENALTY = 40

const SHORT_CATEGORY_KEYWORDS = new Set(
  Object.values(URL_CATEGORY_CONFIG)
    .flatMap((c) => c.keywords)
    .filter((kw) => kw.length <= 3)
)

function firstPathSegment(path: string): string | undefined {
  return path.split('/').filter(Boolean)[0]?.toLowerCase()
}

export function detectLocalizedUrlStructure(urls: string[]): Set<string> {
  const counts = new Map<string, number>()
  for (const url of urls) {
    let path: string
    try { path = new URL(url).pathname } catch { continue }
    const seg = firstPathSegment(path)
    if (!seg || !LOCALE_SEGMENT_RE.test(seg) || SHORT_CATEGORY_KEYWORDS.has(seg)) continue
    counts.set(seg, (counts.get(seg) ?? 0) + 1)
  }
  const confirmed = new Set<string>()
  for (const [seg, count] of counts) {
    if (count >= MIN_LOCALE_REPEAT) confirmed.add(seg)
  }
  return confirmed
}

export function isEnglishLocaleSegment(seg: string): boolean {
  return seg === 'en' || seg.endsWith('-en')
}

export function selectUrlsToScrape(
  candidates: string[],
  isB2C: boolean,
  limit: number,
  localeSegments: Set<string> = new Set()
): { selected: string[]; scored: ScoredLink[] } {
  const seen = new Set<string>()
  const scored: ScoredLink[] = []

  for (const url of candidates) {
    let path: string
    try { path = new URL(url).pathname } catch { continue }

    if (seen.has(url)) continue
    seen.add(url)

    const { category, score: baseScore } = classifyUrl(path)

    if (isB2C) {
      // Positive allowlist: on consumer sites, only keep pages we
      // positively identify as corporate. Drops product, dealer,
      // and 'other' (unrecognised paths that are likely still B2C).
      if (!CORPORATE_CATEGORIES_B2C.has(category)) continue
    }

    const seg = firstPathSegment(path)
    const score = seg && localeSegments.has(seg) && !isEnglishLocaleSegment(seg)
      ? Math.max(0, baseScore - NON_ENGLISH_LOCALE_PENALTY)
      : baseScore

    scored.push({ url, score, tier: category })
  }

  scored.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
  return { selected: scored.slice(0, limit).map((s) => s.url), scored }
}

// ── Corporate seed probing ────────────────────────────────────
// When B2C site detected, check if selected URLs include any
// corporate content. If not (or too few), probe known paths.

async function probeCorporateSeeds(
  client: Firecrawl,
  baseUrl: string,
  alreadyHave: Set<string>,
  maxProbe: number
): Promise<string[]> {
  const base = baseUrl.replace(/\/$/, '')

  const candidates = CORPORATE_SEED_PATHS
    .map(p => `${base}${p}`)
    .filter(url => !alreadyHave.has(url))

  // Probe in parallel batches of 10 (same reasoning as probeUniversalPaths)
  const PROBE_CONCURRENCY = 10
  const found: string[] = []

  for (let i = 0; i < candidates.length && found.length < maxProbe; i += PROBE_CONCURRENCY) {
    const batch = candidates.slice(i, i + PROBE_CONCURRENCY)
    const settled = await Promise.allSettled(
      batch.map(async (url) => {
        // Use GET + Range:bytes=0-0 instead of HEAD.
        // Many servers (Cloudflare, CloudFront, nginx hardened) block HEAD
        // with 405 even when the page exists.
        const resp = await Promise.race([
          fetch(url, { method: 'GET', redirect: 'follow', headers: { Range: 'bytes=0-0', 'User-Agent': BROWSER_USER_AGENT } }),
          rejectAfter(4_000, 'probe timeout'),
        ]) as Response
        return (resp.ok || resp.status === 206) ? url : null
      })
    )
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        found.push(r.value)
        if (found.length >= maxProbe) break
      }
    }
  }

  return found
}

// ── Universal B2B path probing ─────────────────────────────────
// Supplements or replaces link extraction for small B2B sites.
// Same HEAD-check mechanism as probeCorporateSeeds but runs for
// ALL sites (not just B2C) when page discovery is thin.

async function probeUniversalPaths(
  baseUrl: string,
  alreadyHave: Set<string>,
  maxProbe: number,
): Promise<string[]> {
  const base = baseUrl.replace(/\/$/, '')

  // Build candidate list up-front, excluding already-known URLs
  const candidates = UNIVERSAL_B2B_PATHS
    .map(p => {
      const url = `${base}${p}`
      return { url, normalized: url.replace(/\/$/, '') }
    })
    .filter(({ url, normalized }) => !alreadyHave.has(url) && !alreadyHave.has(normalized))

  // Probe in parallel batches of 10 instead of sequentially.
  // Sequential worst case: 40 paths × 4 s = 160 s.
  // Parallel (10/batch): ceil(40/10) × 4 s = 16 s.
  const PROBE_CONCURRENCY = 10
  const found: string[] = []

  for (let i = 0; i < candidates.length && found.length < maxProbe; i += PROBE_CONCURRENCY) {
    const batch = candidates.slice(i, i + PROBE_CONCURRENCY)
    const settled = await Promise.allSettled(
      batch.map(async ({ url, normalized }) => {
        const resp = await Promise.race([
          fetch(url, { method: 'GET', redirect: 'follow', headers: { Range: 'bytes=0-0', 'User-Agent': BROWSER_USER_AGENT } }),
          rejectAfter(4_000, 'probe timeout'),
        ]) as Response
        if (resp.ok || resp.status === 206) {
          alreadyHave.add(url)
          alreadyHave.add(normalized)
          return url
        }
        return null
      })
    )
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        found.push(r.value)
        if (found.length >= maxProbe) break
      }
    }
  }

  return found
}

// ── Firecrawl mapUrl — primary URL discovery ──────────────────
// Firecrawl's map endpoint crawls the site and returns every URL it finds,
// including JS-nav pages, sub-pages, and paginated routes — without scraping.
// This is the most reliable discovery mechanism for small B2B sites (like
// ategroup.com) where nav is JavaScript-rendered and invisible to link extraction.
//
// Returns [] gracefully on timeout or error so other discovery paths still run.

async function fetchMapUrls(client: Firecrawl, baseUrl: string): Promise<string[]> {
  try {
    const result = await Promise.race([
      client.mapUrl(baseUrl, { limit: 50, includeSubdomains: false }),
      rejectAfter(12_000, 'mapUrl timeout'),
    ]) as unknown as Record<string, unknown>

    if (!result?.links || !Array.isArray(result.links)) return []

    // Handle both SearchResultWeb[] (v4 client: { url, title }) and string[] (v1 client)
    return (result.links as Array<unknown>)
      .map(l => typeof l === 'string' ? l : (l as Record<string, unknown>)?.url as string)
      .filter((u): u is string => typeof u === 'string' && u.startsWith('http'))
  } catch (e) {
    console.log(`[Scraper] mapUrl failed: ${String(e).slice(0, 120)}`)
    return []
  }
}

// ── Web search fallback ───────────────────────────────────────
// When Firecrawl cannot scrape the target site directly (blocked
// by Cloudflare / anti-bot, very slow, empty response), we search
// the web for content about the company instead.
//
// The rest of the pipeline sees a normal ScrapeResult with the
// same shape — it does not know or care whether content came from
// direct scraping or search results.
//
// Triggered automatically when scraping yields < 800 chars.

async function searchFallbackScrape(
  client: Firecrawl,
  baseUrl: string,
): Promise<ScrapeResult | null> {
  let hostname: string
  try {
    hostname = new URL(baseUrl).hostname.replace(/^www\./, '')
  } catch {
    return null
  }

  // adorwelding.com → "ador welding"
  // bharat-forge.com → "bharat forge"
  // muthootfinance.com → "muthoot finance"
  const companyName = hostname
    .replace(/\.(com|co\.in|in|net|org|io|ltd|biz|co)$/, '')
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim()

  if (!companyName) return null

  const queries = [
    `"${companyName}" company about manufacturing industrial operations`,
    `${companyName} company overview business`,
  ]

  const debugInfo: ScrapeDebugInfo = {
    homepageLinksRaw: 0,
    homepageLinksSameDomain: 0,
    linkScores: [],
    urlsSelectedForScraping: [],
    sitemapChecked: false,
    sitemapUrlsFound: 0,
    discoveryMethod: 'homepage_only',
    isB2CSite: false,
    b2cPatternsHit: 0,
    corporateSeedPathsProbed: 0,
    warnings: [`Direct scraping failed, using web search fallback for "${companyName}"`],
    errors: [],
  }

  console.log(`[Scraper] Web search fallback for "${companyName}" (${baseUrl})`)

  const allPages: ScrapePageResult[] = []

  // Firecrawl's search API — same key, no extra integration needed
  // SDK response shape varies by version. Log it once so we can verify.
  // Possible shapes:
  //   v1:  { data: [{ url, markdown, description }] }
  //   v4:  { success, data: [...] }  OR  { success, web: { results: [...] } }
  type SearchResult = { url: string; title?: string; description?: string; markdown?: string }
  type SearchResponse = {
    data?: SearchResult[]
    web?: { results?: SearchResult[] }
    results?: SearchResult[]
  }

  let rawSearchLogged = false

  for (const query of queries) {
    if (allPages.length >= 8) break
    try {
      const result = await Promise.race([
        (client as unknown as {
          search(q: string, opts: Record<string, unknown>): Promise<SearchResponse>
        }).search(query, {
          limit: 5,
          scrapeOptions: { formats: ['markdown'] },
        }),
        rejectAfter(45_000, `Search fallback timeout for query "${query}"`),
      ])

      // Log the raw structure once per scrape call so we can verify the shape
      if (!rawSearchLogged) {
        rawSearchLogged = true
        console.log('[Scraper] Raw search response shape:', JSON.stringify(result, null, 2).slice(0, 1000))
      }

      // Normalise across all known SDK response shapes
      const res = result as SearchResponse
      const hits: SearchResult[] =
        Array.isArray(res?.data)              ? res.data!
        : Array.isArray(res?.results)         ? res.results!
        : Array.isArray(res?.web?.results)    ? res.web!.results!
        : []

      if (hits.length === 0) {
        console.warn(`[Scraper] Search fallback: no hits for query "${query}" — raw keys: ${Object.keys(res ?? {}).join(', ')}`)
      }

      for (const hit of hits) {
        const raw = hit.markdown ?? hit.description ?? ''
        if (!raw || raw.trim().length < 100) continue
        const cleaned = cleanMarkdown(raw).slice(0, MAX_PAGE_CHARS)
        allPages.push({
          url: hit.url,
          success: true,
          markdown: `[Source: web search result]\n\n${cleaned}`,
          charCount: cleaned.length,
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      debugInfo.warnings.push(`Search query failed: ${msg.slice(0, 120)}`)
      console.warn(`[Scraper] Search fallback query failed: ${msg.slice(0, 120)}`)
    }
  }

  if (allPages.length === 0) {
    console.warn(`[Scraper] Web search fallback produced no results for "${companyName}"`)
    return null
  }

  console.log(`[Scraper] Web search fallback: ${allPages.length} results for "${companyName}"`)
  return buildResult(allPages, 'homepage_only', debugInfo)
}

// ── Jina.ai reader (Tier 1 fallback) ──────────────────────────
// Jina.ai's r.jina.ai renders JavaScript and returns clean markdown.
// No API key required. Handles Google Sites, Wix, Webflow, and
// sites where Firecrawl is blocked or returns empty content.
//
// URL format: https://r.jina.ai/{full-target-url}

// Extract all markdown links from Jina-rendered content.
// Jina renders JS navigation, so we get links invisible to Firecrawl's scraper.
// Used as a supplement when Firecrawl homepage scrape returns 0 nav links.
function extractLinksFromMarkdown(markdown: string, baseUrl: string): string[] {
  const baseDomain = new URL(baseUrl).hostname.replace(/^www\./, '')
  const links: string[] = []

  // Match [text](url) patterns
  const mdLinkRe = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = mdLinkRe.exec(markdown)) !== null) {
    const href = m[2]
    try {
      const u = new URL(href)
      if (u.hostname.replace(/^www\./, '') === baseDomain) {
        links.push(href.split('#')[0]) // strip fragments
      }
    } catch { /* invalid URL */ }
  }

  return links
}

async function fetchViaJina(url: string): Promise<ScrapePageResult> {
  const jinaUrl = `https://r.jina.ai/${url}`
  try {
    const resp = await Promise.race([
      fetch(jinaUrl, {
        headers: {
          'Accept': 'text/plain, text/markdown, */*',
          'User-Agent': BROWSER_USER_AGENT,
          'X-No-Cache': 'true',
        },
      }),
      rejectAfter(15_000, `Jina timeout for ${url}`),
    ]) as Response

    if (!resp.ok) {
      return { url, success: false, markdown: '', charCount: 0, error: `Jina HTTP ${resp.status}` }
    }

    const raw = await resp.text()
    if (!raw || raw.trim().length < 50) {
      return { url, success: false, markdown: '', charCount: 0, error: 'Jina returned empty content' }
    }

    const cleaned = cleanMarkdown(raw).slice(0, MAX_PAGE_CHARS)
    return { url, success: true, markdown: cleaned, charCount: cleaned.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { url, success: false, markdown: '', charCount: 0, error: `Jina failed: ${message.slice(0, 120)}` }
  }
}

async function jinaFullScrape(
  baseUrl: string,
  debugInfo: ScrapeDebugInfo,
): Promise<ScrapeResult | null> {
  console.log(`[Scraper] Jina.ai Tier-1 fallback for ${displayURL(baseUrl)}`)

  // Homepage first — if Jina can't get this, nothing else will work
  const homePage = await fetchViaJina(baseUrl)
  if (!homePage.success || homePage.charCount < 100) {
    console.log(`[Scraper] Jina: homepage failed — ${homePage.error}`)
    return null
  }

  // 5 highest-value B2B paths in parallel — don't block on any single one
  const KEY_PATHS = ['/about', '/about-us', '/company', '/products', '/services']
  const base = baseUrl.replace(/\/$/, '')

  const subPages = await Promise.all(
    KEY_PATHS.map(p => fetchViaJina(`${base}${p}`))
  )

  const allPages: ScrapePageResult[] = [
    homePage,
    ...subPages.filter(p => p.success && p.charCount >= MIN_USEFUL_CHARS),
  ]

  console.log(`[Scraper] Jina: ${allPages.length} pages fetched (${allPages.reduce((s, p) => s + p.charCount, 0)} chars)`)
  debugInfo.warnings.push(`Jina.ai reader used as Tier-1 fallback (${allPages.length} pages)`)
  return buildResult(allPages, 'homepage_only', debugInfo)
}

// ── Main export ───────────────────────────────────────────────

export async function scrapeCompanyWebsite(baseUrl: string): Promise<ScrapeResult> {
  const safeBase = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`
  const client = getFirecrawlClient()

  const debugInfo: ScrapeDebugInfo = {
    homepageLinksRaw: 0,
    homepageLinksSameDomain: 0,
    linkScores: [],
    urlsSelectedForScraping: [],
    sitemapChecked: false,
    sitemapUrlsFound: 0,
    discoveryMethod: 'homepage_only',
    isB2CSite: false,
    b2cPatternsHit: 0,
    corporateSeedPathsProbed: 0,
    warnings: [],
    errors: [],
  }

  console.log(`[Scraper] Starting smart scrape of ${displayURL(safeBase)}`)

  // ── Step 1+2+3: Homepage + sitemap + mapUrl (all parallel) ──
  // mapUrl is the primary discovery mechanism — it crawls the full site
  // and returns all URLs including those in JS-rendered navigation.
  // Sitemap and homepage links are supplements / fallbacks.
  const [homepage, sitemapUrls, rawMapUrls] = await Promise.all([
    scrapeHomepageWithLinks(client, safeBase),
    fetchSitemapUrls(safeBase).then((urls) => {
      debugInfo.sitemapChecked = true
      debugInfo.sitemapUrlsFound = urls.length
      return urls
    }),
    fetchMapUrls(client, safeBase),
  ])

  const allResults: ScrapePageResult[] = [homepage.page]
  debugInfo.homepageLinksRaw = homepage.links.length

  if (!homepage.page.success) {
    debugInfo.errors.push(`Homepage failed: ${homepage.page.error}`)
    console.warn(`[Scraper] Homepage failed: ${homepage.page.error}`)
    // Tier 1: Jina.ai reader (JS rendering, Google Sites, basic anti-bot bypass)
    const jinaResult = await jinaFullScrape(safeBase, debugInfo)
    if (jinaResult && jinaResult.totalCharCount > 300) {
      console.log(`[Scraper] Jina rescued scrape (${jinaResult.totalCharCount} chars)`)
      return jinaResult
    }
    // Tier 2: Firecrawl web search fallback
    const fallback = await searchFallbackScrape(client, safeBase)
    if (fallback && fallback.totalCharCount > 200) return fallback
    return buildResult(allResults, 'homepage_only', debugInfo)
  }

  console.log(
    `[Scraper] Homepage: ${homepage.page.charCount} chars, ${homepage.links.length} raw links`
  )

  // ── Step 3: B2C detection ────────────────────────────────────
  // Two signals — either one triggers B2C mode:
  //
  // Signal A: homepage content patterns (only works if body text has "find a dealer" etc.)
  //   Problem: we exclude nav/header tags, so these phrases often don't appear.
  //
  // Signal B: raw link URL patterns (more reliable — homepage always links to product pages)
  //   arena/, nexa/, /book-showroom, /test-drive, /configure, /compare-cars

  const b2cHits = B2C_PATTERNS.filter((p) => p.test(homepage.page.markdown)).length

  const B2C_URL_PATTERNS = [
    /\/arena\//i, /\/nexa\//i, /\/arenaworld\//i,
    /test-drive/i, /book-showroom/i, /book-a-test/i,
    /locate-dealer/i, /find-dealer/i,
    /\/configure/i, /compare-cars/i,
    /book-service/i, /service-appointment/i,
  ]
  const b2cLinkHits = homepage.links.filter(
    (l) => B2C_URL_PATTERNS.some((p) => p.test(l))
  ).length

  const isB2C = b2cHits >= 3 || b2cLinkHits >= 3
  debugInfo.isB2CSite = isB2C
  debugInfo.b2cPatternsHit = b2cHits + b2cLinkHits

  if (isB2C) {
    console.log(`[Scraper] B2C site detected (${b2cHits} patterns) — filtering product/dealer pages`)
  }

  // ── Step 4: Collect + classify all candidate URLs ────────────
  let homepageLinks = extractSameDomainLinks(homepage.links, safeBase)
  debugInfo.homepageLinksSameDomain = homepageLinks.length

  // If Firecrawl found 0 nav links (JS-rendered nav — Google Sites, Webflow, etc.)
  // fetch homepage via Jina which renders JS, then extract links from markdown.
  if (homepageLinks.length === 0) {
    const jinaHome = await fetchViaJina(safeBase)
    if (jinaHome.success && jinaHome.markdown.length > 100) {
      const jinaLinks = extractLinksFromMarkdown(jinaHome.markdown, safeBase)
      if (jinaLinks.length > 0) {
        console.log(`[Scraper] Jina link extraction: ${jinaLinks.length} nav links found (Firecrawl found 0)`)
        homepageLinks = jinaLinks
        debugInfo.homepageLinksSameDomain = jinaLinks.length
        debugInfo.warnings.push(`Jina.ai used for JS-rendered nav link extraction (${jinaLinks.length} links)`)
      }
    }
  }

  const baseDomain = new URL(safeBase).hostname.replace(/^www\./, '')

  // Filter all sources to same domain
  const mapSameDomain = rawMapUrls.filter((u) => {
    try { return new URL(u).hostname.replace(/^www\./, '') === baseDomain }
    catch { return false }
  })
  const sitemapSameDomain = sitemapUrls.filter((u) => {
    try { return new URL(u).hostname.replace(/^www\./, '') === baseDomain }
    catch { return false }
  })

  // Priority order: mapUrl first (most complete), then sitemap, then homepage links
  // Exclude safeBase — it was already scraped in Step 1 (homepage fetch)
  const homepageNorm = safeBase.replace(/\/$/, '')
  const allCandidates = deduplicateUrls([...mapSameDomain, ...sitemapSameDomain, ...homepageLinks])
    .filter(u => u.replace(/\/$/, '') !== homepageNorm)

  console.log(`[Scraper] Homepage links found: ${homepageLinks.length}`)
  console.log(`[Scraper] mapUrl URLs found: ${mapSameDomain.length}`)
  console.log(`[Scraper] Sitemap URLs found: ${sitemapSameDomain.length}`)
  console.log(`[Scraper] Total candidates: ${allCandidates.length}`)

  const localeSegments = detectLocalizedUrlStructure(allCandidates)
  const nonEnglishLocaleSegments = [...localeSegments].filter((seg) => !isEnglishLocaleSegment(seg))
  if (nonEnglishLocaleSegments.length > 0) {
    console.log(`[Scraper] Multi-locale site detected — deprioritizing non-English locale prefixes: ${nonEnglishLocaleSegments.join(', ')}`)
  }

  const { selected, scored } = selectUrlsToScrape(allCandidates, isB2C, MAX_DISCOVERED_PAGES, localeSegments)
  debugInfo.linkScores = scored

  let pagesToScrape = selected
  let discoveryMethod: ScrapeResult['discoveryMethod'] =
    mapSameDomain.length > 0    ? 'map_url'
    : sitemapSameDomain.length > 3 ? 'sitemap'
    : homepageLinks.length > 0  ? 'link_extraction'
    : 'homepage_only'

  // ── Step 5: Corporate seed probing (B2C fallback) ───────────
  // If B2C site and fewer than 4 corporate/manufacturing pages
  // were selected, probe seed paths directly.
  if (isB2C) {
    const corporateCount = scored.filter(
      (s) => CORPORATE_CATEGORIES_B2C.has(s.tier)
    ).length

    if (corporateCount < 4) {
      console.log(
        `[Scraper] B2C site — only ${corporateCount} corporate URLs found, probing seed paths`
      )
      const alreadyHave = new Set([safeBase, ...pagesToScrape])
      const seeded = await probeCorporateSeeds(client, safeBase, alreadyHave, 8)
      debugInfo.corporateSeedPathsProbed = seeded.length

      if (seeded.length > 0) {
        console.log(`[Scraper] Seed paths found: ${seeded.length}`)
        // Classify seeds and insert at front
        const { selected: seededSelected, scored: seededScored } = selectUrlsToScrape(
          seeded, false, 8  // don't B2C-filter seeds — they're already corporate
        )
        pagesToScrape = deduplicateUrls([...seededSelected, ...pagesToScrape]).slice(0, MAX_DISCOVERED_PAGES)
        debugInfo.linkScores = [...seededScored, ...scored]
        discoveryMethod = 'corporate_seed'
      }
    }
  }

  // ── Step 5b: B2B path probing ─────────────────────────────────
  // Runs when selected pages lack corporate depth. Two triggers:
  //   a) Quantity: fewer than 4 high-value pages (blog-heavy sitemap)
  //   b) Diversity: only 1-2 category buckets represented (e.g. mapUrl
  //      returned only /core-leadership/* sub-pages, missing /industries/,
  //      /csr/, /solutions/ which aren't in mapUrl at all)
  //
  // Probed paths go to the FRONT so they displace low-value trailing pages
  // when deduplication slices to MAX_DISCOVERED_PAGES.
  const mapEmpty         = mapSameDomain.length === 0
  const sitemapEmpty     = sitemapSameDomain.length === 0
  const selectedSlice    = scored.slice(0, pagesToScrape.length)
  const selectedHighValue = selectedSlice.filter(s => s.score > 15).length

  const VALUABLE_CATEGORIES = new Set([
    'investor', 'leadership', 'corporate', 'manufacturing', 'sustainability',
    'careers', 'technology', 'media', 'b2b_services',
  ])
  const categoriesSeen = new Set(
    selectedSlice.map(s => s.tier).filter(t => VALUABLE_CATEGORIES.has(t))
  )
  const needsDiversityProbe = categoriesSeen.size < 3

  if (selectedHighValue < 4 || needsDiversityProbe) {
    const reason = (mapEmpty && sitemapEmpty)
      ? `mapUrl + sitemap both empty, only ${pagesToScrape.length} pages`
      : needsDiversityProbe
        ? `only ${categoriesSeen.size} category/ies (${[...categoriesSeen].join(', ')}) — missing key sections`
        : `only ${selectedHighValue} high-value pages (blog-heavy discovery)`
    console.log(`[Scraper] B2B path probing — ${reason}`)

    const b2bAlreadyHave = new Set([safeBase, ...pagesToScrape])
    const b2bPaths = await probeUniversalPaths(safeBase, b2bAlreadyHave, 8)
    debugInfo.corporateSeedPathsProbed += b2bPaths.length

    if (b2bPaths.length > 0) {
      console.log(`[Scraper] Path probe: ${b2bPaths.length} paths found`)
      // Prepend probed paths — they displace trailing articles when sliced
      pagesToScrape = deduplicateUrls([...b2bPaths, ...pagesToScrape]).slice(0, MAX_DISCOVERED_PAGES)
      if (discoveryMethod === 'homepage_only' || discoveryMethod === 'link_extraction') {
        discoveryMethod = 'corporate_seed'
      }
    }
  }

  if (pagesToScrape.length === 0) {
    debugInfo.warnings.push('No pages discovered beyond homepage')
    const partial = buildResult(allResults, 'homepage_only', debugInfo)
    if (partial.totalCharCount < 800) {
      const fallback = await searchFallbackScrape(client, safeBase)
      if (fallback && fallback.totalCharCount > partial.totalCharCount) return fallback
    }
    return partial
  }

  debugInfo.urlsSelectedForScraping = pagesToScrape
  debugInfo.discoveryMethod = discoveryMethod

  console.log(
    `[Scraper] Final candidates selected: ${pagesToScrape.length} (method: ${discoveryMethod})`
  )

  // ── Step 6: Scrape selected pages ───────────────────────────
  const discoveredResults = await scrapePages(client, pagesToScrape, debugInfo)
  allResults.push(...discoveredResults)

  const useful = allResults.filter((p) => p.success && p.charCount >= MIN_USEFUL_CHARS)
  const failed = allResults.filter((p) => !p.success || p.charCount < MIN_USEFUL_CHARS)

  console.log(`[Scraper] Done — ${useful.length} useful, ${failed.length} failed/thin`)

  const finalResult = buildResult(allResults, discoveryMethod, debugInfo)

  // If content is too thin (blocked pages, JS-only site, etc.) — try Jina first,
  // then web search. Each tier only activates if the previous yielded less.
  if (finalResult.totalCharCount < 800) {
    console.log(`[Scraper] Content too thin (${finalResult.totalCharCount} chars) — trying Jina Tier-1`)
    const jinaResult = await jinaFullScrape(safeBase, debugInfo)
    if (jinaResult && jinaResult.totalCharCount > finalResult.totalCharCount) {
      console.log(`[Scraper] Jina improved content to ${jinaResult.totalCharCount} chars`)
      return jinaResult
    }
    console.log(`[Scraper] Jina did not improve content — trying web search Tier-2`)
    const fallback = await searchFallbackScrape(client, safeBase)
    if (fallback && fallback.totalCharCount > finalResult.totalCharCount) {
      console.log(`[Scraper] Using web search fallback (${fallback.totalCharCount} chars)`)
      return fallback
    }
  }

  return finalResult
}

// ── Homepage scrape with link extraction ─────────────────────

async function scrapeHomepageWithLinks(
  client: Firecrawl,
  baseUrl: string
): Promise<{ page: ScrapePageResult; links: string[] }> {
  const url = baseUrl.replace(/\/$/, '')

  try {
    const response = await Promise.race([
      client.scrape(url, {
        formats: ['markdown', 'links'],
        // 'nav' and 'header' intentionally NOT excluded — these tags contain
        // navigation <a href> links that feed page discovery. Without them,
        // Firecrawl only returns body links and we miss the entire site nav.
        // Minor nav text in markdown is acceptable and cleaned below.
        excludeTags: ['footer', 'aside', 'script', 'style', 'noscript'],
        waitFor: 3000,
        removeBase64Images: true,
      }),
      rejectAfter(PAGE_TIMEOUT_MS, `Homepage scrape timed out`),
    ])

    const markdown = response?.markdown ?? ''
    const links: string[] = Array.isArray((response as Record<string, unknown>)?.links)
      ? (response as Record<string, unknown>).links as string[]
      : []

    if (!markdown || markdown.trim().length === 0) {
      return {
        page: { url, success: false, markdown: '', charCount: 0, error: 'Homepage returned empty content' },
        links,
      }
    }

    const cleaned = cleanMarkdown(markdown)
    const truncated = cleaned.slice(0, MAX_PAGE_CHARS)

    return {
      page: { url, success: true, markdown: truncated, charCount: truncated.length },
      links,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      page: { url, success: false, markdown: '', charCount: 0, error: message },
      links: [],
    }
  }
}

// ── Page scraping ─────────────────────────────────────────────

async function scrapePages(
  client: Firecrawl,
  urls: string[],
  debugInfo: ScrapeDebugInfo
): Promise<ScrapePageResult[]> {
  const CONCURRENCY = 3
  // Early-exit threshold: if accumulated useful chars exceed this after any batch,
  // stop requesting more pages. Prevents wasting 60s scraping 15 pages when 5 suffice.
  const EARLY_EXIT_CHARS = 12_000
  const results: ScrapePageResult[] = []

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map((url) => scrapeSinglePage(client, url, debugInfo))
    )
    results.push(...batchResults)

    // Early exit: enough content collected — no need to keep scraping
    const accumulatedChars = results
      .filter(p => p.success && p.charCount >= MIN_USEFUL_CHARS)
      .reduce((sum, p) => sum + p.charCount, 0)
    if (accumulatedChars >= EARLY_EXIT_CHARS) {
      console.log(`[Scraper] Early exit after ${results.length} pages (${accumulatedChars} chars ≥ ${EARLY_EXIT_CHARS} threshold)`)
      break
    }
  }

  return results
}

async function scrapeSinglePage(
  client: Firecrawl,
  url: string,
  debugInfo: ScrapeDebugInfo
): Promise<ScrapePageResult> {
  try {
    const response = await Promise.race([
      client.scrape(url, {
        formats: ['markdown'],
        excludeTags: ['nav', 'footer', 'header', 'aside', 'script', 'style', 'noscript'],
        waitFor: 3000,
        removeBase64Images: true,
      }),
      rejectAfter(PAGE_TIMEOUT_MS, `Scrape timeout for ${url}`),
    ])

    const markdown = response?.markdown ?? ''

    if (!markdown || markdown.trim().length === 0) {
      return { url, success: false, markdown: '', charCount: 0, error: 'Empty content' }
    }

    const cleaned = cleanMarkdown(markdown)
    const truncated = cleaned.slice(0, MAX_PAGE_CHARS)

    return { url, success: true, markdown: truncated, charCount: truncated.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isRoutine =
      message.includes('404') ||
      message.includes('timeout') ||
      message.includes('Not Found') ||
      message.includes('redirect')

    if (!isRoutine) {
      debugInfo.warnings.push(`Unexpected error on ${url}: ${message}`)
      console.warn(`[Scraper] Unexpected error on ${url}: ${message}`)
    }

    return { url, success: false, markdown: '', charCount: 0, error: message }
  }
}

// ── Helpers ───────────────────────────────────────────────────

function cleanMarkdown(raw: string): string {
  return raw
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/^https?:\/\/\S+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[-=*]{3,}\s*$/gm, '')
    .replace(/^(Home|Menu|Navigation|Skip to content|Back to top)\s*$/gim, '')
    .replace(/^[|+]+[-|+]*\s*$/gm, '')
    .trim()
}

function deduplicateUrls(urls: string[]): string[] {
  const seen = new Set<string>()
  return urls.filter((u) => {
    if (seen.has(u)) return false
    seen.add(u)
    return true
  })
}

function rejectAfter(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(message)), ms)
  )
}

function buildResult(
  pages: ScrapePageResult[],
  discoveryMethod: ScrapeResult['discoveryMethod'],
  debugInfo: ScrapeDebugInfo
): ScrapeResult {
  const useful = pages.filter((p) => p.success && p.charCount >= MIN_USEFUL_CHARS)
  const failed = pages.filter((p) => !p.success || p.charCount < MIN_USEFUL_CHARS)

  const { combined, wasTruncated } = combineAndTruncate(useful, MAX_TOTAL_CHARS)

  return {
    pages,
    combinedContent: combined,
    successfulUrls: useful.map((p) => p.url),
    failedUrls: failed.map((p) => p.url),
    totalCharCount: combined.length,
    wasTruncated,
    discoveryMethod,
    scrapedAt: new Date().toISOString(),
    debug: { ...debugInfo, discoveryMethod },
  }
}

function combineAndTruncate(
  pages: ScrapePageResult[],
  maxChars: number
): { combined: string; wasTruncated: boolean } {
  if (pages.length === 0) {
    return { combined: '[No content could be extracted from this website]', wasTruncated: false }
  }

  const combined = formatScrapedPages(
    pages.map((p) => ({ url: p.url, markdown: p.markdown, success: p.success }))
  )

  if (combined.length <= maxChars) {
    return { combined, wasTruncated: false }
  }
    const truncated = combined.slice(0, maxChars)
  const lastBreak = truncated.lastIndexOf('\n\n')
  return {
    combined: lastBreak > maxChars * 0.5 ? truncated.slice(0, lastBreak) : truncated,
    wasTruncated: true,
  }
}

// ── Quality assessment ────────────────────────────────────────

export function assessScrapeQuality(result: ScrapeResult): { score: number; note: string } {
  const pageCount = result.successfulUrls.length
  const totalChars = result.totalCharCount

  let score = 0

  // Page count
  if (pageCount === 0) score = 0
  else if (pageCount === 1) score = 30
  else if (pageCount <= 3) score = 55
  else if (pageCount <= 6) score = 70
  else if (pageCount <= 10) score = 80
  else score = 90

  // Content volume bonus
  if (totalChars >= 15_000) score = Math.min(100, score + 10)
  else if (totalChars >= 8_000) score = Math.min(100, score + 5)

  // Discovery method bonus
  if (result.discoveryMethod === 'map_url' || result.discoveryMethod === 'sitemap') {
    score = Math.min(100, score + 5)
  }

  const note = pageCount === 0 ? 'No usable content scraped'
    : pageCount === 1 ? 'Homepage only -- limited depth'
    : pageCount <= 3 ? 'Light scrape -- key pages captured'
    : pageCount <= 6 ? 'Good scrape -- multiple sections covered'
    : 'Deep scrape -- comprehensive coverage'

  return { score, note }
}
