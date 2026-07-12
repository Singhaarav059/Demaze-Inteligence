// ============================================================
// Web Enrichment Layer — v3 (Discovery + Recovery Pipeline)
// ============================================================
// Full 4-stage pipeline:
//   Stage 1: Discovery  — Tavily/Serper targeted search queries
//   Stage 2: Prioritize — rank, deduplicate, cap at 5 external fetches
//   Stage 3: Fetch      — Firecrawl → labeled [SOURCE:] context blocks
//   Stage 4: Recovery   — direct corporate path probing when quality poor
//
// Architecture changes from v2:
//
//   FIX 1 (truncation): enriched_context is NOT truncated here.
//     Route.ts receives the full context string; it no longer slices to 6,000 chars.
//     The evidence extractor sees ALL fetched source content.
//
//   FIX 4 (timeout): fetchWithFirecrawl() now uses a real Promise.race so that
//     the Firecrawl HTTP call is genuinely raced against a deadline.
//     The previous implementation had setTimeout(() => {}, ms) — an empty callback
//     that did nothing.
//
//   FIX 5 (unified extraction): SIGNAL_PATTERNS and extractSignalsFromText() are
//     removed entirely. All signal extraction now happens in evidence-extractor.ts
//     via re-extraction in route.ts (Step 6b). enriched_signals is always [].
//     Keeping the field for backward compatibility; signals now arrive through the
//     re-extractor which feeds scoring, clustering, and opportunities correctly.
//
//   FIX 2+3 (recovery): When content quality is poor (thin_content / no_company
//     _operations_content) OR a consumer-facing site is detected, probeRecoveryPaths()
//     runs even when Tavily returned results. The previous code only called
//     enrichFromPublicPages() when discovered.length === 0, making it unreachable
//     whenever Tavily/Serper keys were present.
// ============================================================

import { PDFParse } from 'pdf-parse'
import { discoverEvidenceSources, type DiscoveredSource } from './discovery-engine'
import {
  prioritizeSources,
  sourceTypeLabel,
  evidenceStrengthTier,
  type PrioritizedSource,
} from './source-prioritizer'

// ── Public types ──────────────────────────────────────────────

export interface EnrichedSignal {
  type: string
  quote: string
  source: string
  source_type: string
  source_tier: 'tier1' | 'tier2' | 'tier3'
  relevance: 'high' | 'medium' | 'low'
}

export interface EnrichmentResult {
  company_name: string
  domain: string
  /** FIX 5: Always []. Signals now come from the re-extractor in route.ts. */
  enriched_signals: EnrichedSignal[]
  /** FIX 1: Full content, not truncated. Route.ts no longer slices this. */
  enriched_context: string
  search_queries_run: string[]
  sources_found: string[]
  sources_used: PrioritizedSource[]
  /** FIX 2+3: Paths probed during recovery pass (empty when recovery not triggered). */
  recovery_paths_probed: string[]
  enriched_at: string
}

// ── B2C consumer-site detection ───────────────────────────────
// Detects product-catalog / dealer-facing sites (e.g. volvocars.com)
// vs. corporate / manufacturing sites (e.g. volvogroup.com).
// 3+ of these signals firing = consumer site → trigger corporate override paths.

const B2C_PATTERNS = [
  /test\s+drive/i,
  /find\s+a\s+dealer/i,
  /build\s+your\s+(car|vehicle|truck)/i,
  /schedule\s+service/i,
  /book\s+a\s+test\s+drive/i,
  /insurance\s+services/i,
  /compare\s+(cars|models|vehicles)/i,
  /certified\s+pre-?owned/i,
  /financing\s+options/i,
  /monthly\s+payment/i,
  /msrp/i,
  /starting\s+at\s+\$[\d,]+/i,
]

export function detectConsumerSite(content: string): boolean {
  const hits = B2C_PATTERNS.filter(p => p.test(content)).length
  return hits >= 3
}

// ── Recovery path lists ───────────────────────────────────────
// Probed via Firecrawl when content quality flags fire.
// These are tried on the company's own domain; the first maxProbe that
// return ≥200 chars of content are included as additional context blocks.

const RECOVERY_PATHS_STANDARD = [
  '/investor-relations',
  '/investors',
  '/ir',
  '/annual-report',
  '/sustainability',
  '/esg',
  '/newsroom',
  '/press-releases',
  '/manufacturing',
  '/operations',
  '/technology',
  '/about/company',
  '/about/operations',
  '/about/manufacturing',
  '/digital-transformation',
  '/smart-manufacturing',
  '/industry-40',
]

// Extra paths tried when a consumer-brand site is detected.
// These sub-paths may expose the corporate / industrial division.
const RECOVERY_PATHS_CONSUMER_OVERRIDE = [
  '/group',
  '/corporate',
  '/industrial',
  '/about/volvo-group',
  '/about/the-company',
  '/about-us/the-company',
  '/about/overview',
  '/company/overview',
]

// ── FIX 4: Real Firecrawl timeout via Promise.race ───────────
// Previous: const timer = setTimeout(() => {}, timeoutMs)  — empty callback, inert.
// Now: Promise.race cancels the fetch path if the deadline fires first.

async function fetchWithFirecrawl(url: string, timeoutMs = 12_000): Promise<string | null> {
  const firecrawlKey = process.env.FIRECRAWL_API_KEY
  if (!firecrawlKey) return null

  try {
    const { default: Firecrawl } = await import('@mendable/firecrawl-js')
    const app = new Firecrawl({ apiKey: firecrawlKey })

    const result = await Promise.race([
      app.scrapeUrl(url, { formats: ['markdown'] }),
      new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
    ])

    if (!result) return null
    const r = result as Record<string, unknown>
    if (r.success && typeof r.markdown === 'string') {
      return r.markdown.slice(0, 6_000)  // per-source cap (reasonable); total is not capped
    }
    return null
  } catch {
    return null
  }
}

// ── ITEM 3: PDF fetch route ──────────────────────────────────
// Firecrawl's markdown conversion is unreliable on raw PDFs, so annual reports
// / investor presentations / earnings releases (the highest-value, very_high
// source types, disproportionately PDF-published) used to be dropped by
// isFetchable(). They now route here instead: download the bytes and extract
// text via pdf-parse v2 (same PDFParse API already used server-side in
// lib/batch/file-parser.ts). Contract matches fetchWithFirecrawl: returns
// capped text, or null on any failure (so the snippet-fallback path still fires).

const MAX_PDF_BYTES = 10 * 1024 * 1024   // skip reports larger than 10 MB

/** Extension check, tolerant of query strings / fragments (e.g. `…/ar.pdf?x=1`). */
export function isPdfUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase()
    return path.endsWith('.pdf')
  } catch {
    return url.toLowerCase().split(/[?#]/)[0].endsWith('.pdf')
  }
}

/**
 * Pure text extraction from PDF bytes — no I/O, so it's unit-testable without
 * the network. Returns capped text, or null if extraction fails or is empty.
 */
export async function extractPdfText(buffer: Buffer): Promise<string | null> {
  let parser: PDFParse | null = null
  try {
    parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    const text = (result?.text ?? '').trim()
    if (text.length < 100) return null
    return text.slice(0, 6_000)   // same per-source cap as fetchWithFirecrawl
  } catch {
    return null
  } finally {
    if (parser) { try { await parser.destroy() } catch { /* ignore */ } }
  }
}

async function fetchPdfText(url: string, timeoutMs = 15_000): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!res.ok) return null

    // Guard against non-PDF responses (a .pdf URL that 404s to an HTML page) and
    // against downloading an enormous report we'd only slice the first 6 KB of.
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
    if (contentType && !contentType.includes('pdf') && !contentType.includes('octet-stream')) return null
    const declaredLen = Number(res.headers.get('content-length') ?? '0')
    if (declaredLen && declaredLen > MAX_PDF_BYTES) return null

    const arrayBuf = await res.arrayBuffer()
    if (arrayBuf.byteLength === 0 || arrayBuf.byteLength > MAX_PDF_BYTES) return null

    return await extractPdfText(Buffer.from(arrayBuf))
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Dispatch by URL type: PDFs go through pdf-parse, everything else via Firecrawl. */
async function fetchSourceContent(url: string, timeoutMs?: number): Promise<string | null> {
  if (isPdfUrl(url)) return fetchPdfText(url, timeoutMs ?? 15_000)
  return fetchWithFirecrawl(url, timeoutMs ?? 12_000)
}

// ── Source block formatter ────────────────────────────────────

function formatSourceBlock(
  url: string,
  label: string,
  strength: string,
  tier: string,
  content: string,
): string {
  return [
    `[SOURCE: ${label} (${strength.replace(/_/g, ' ').toUpperCase()} confidence) | ${tier} | ${url}]`,
    content.trim().slice(0, 5_500),
    `[END SOURCE: ${label}]`,
  ].join('\n')
}

function formatDiscoveredSourceBlock(src: PrioritizedSource, content: string): string {
  return formatSourceBlock(
    src.url,
    sourceTypeLabel(src.source_type),
    src.evidence_strength,
    evidenceStrengthTier(src.evidence_strength),
    content,
  )
}

// ── FIX 5: Stage 3 — Fetch only, no signal extraction ────────
// Previous: extractSignalsFromText() ran here using a separate 10-pattern set.
//   Those signals only fed synthesis, not scoring/clustering/opportunities.
// Now: context blocks are returned; the evidence-extractor.ts re-extraction
//   pass in route.ts (Step 6b) handles all signal detection from enriched content.

async function fetchPrioritizedSources(
  prioritized: PrioritizedSource[],
): Promise<{ contextBlocks: string[]; fetched: PrioritizedSource[] }> {
  const toFetch = prioritized.filter(s => s.should_fetch)
  const contextBlocks: string[] = []
  const fetched: PrioritizedSource[] = []

  const chunks: PrioritizedSource[][] = []
  for (let i = 0; i < toFetch.length; i += 3) chunks.push(toFetch.slice(i, i + 3))

  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map(async src => ({ src, content: await fetchSourceContent(src.url) }))
    )
    for (const { src, content } of results) {
      if (content && content.length > 100) {
        fetched.push(src)
        contextBlocks.push(formatDiscoveredSourceBlock(src, content))
      } else if (!content && src.snippet && src.snippet.length > 50) {
        // Firecrawl failed — include snippet so the extractor has at least some evidence
        fetched.push(src)
        contextBlocks.push(
          formatDiscoveredSourceBlock(src, src.snippet + '\n(snippet only — full page fetch failed)')
        )
      }
    }
  }

  return { contextBlocks, fetched }
}

// ── FIX 2+3: Stage 4 — Recovery path probing ─────────────────
// Triggered when:
//   - options.recovery === true  (thin_content or no_company_operations_content)
//   - isConsumerSite === true    (B2C patterns detected in website content)
//   - discovered.length === 0   (no Tavily/Serper results at all)
//
// Probes corporate sub-paths on the company's OWN domain even when Tavily
// already returned external results. This fills the gap for companies like
// Mahindra where Firecrawl hit financial-services pages instead of manufacturing.
//
// Exported (item 2, 2026-07-12): recovery genuinely depends on scrape output
// (isConsumerSite, content-quality) so route.ts calls this directly after
// scrape completes, separately from discoverAndFetchExternalSources() below
// which route.ts kicks off before scrape even starts.

export async function probeRecoveryPaths(
  domain: string,
  isConsumerSite: boolean,
  maxProbe = 6,
): Promise<{ contextBlocks: string[]; pathsProbed: string[] }> {
  const paths = [
    ...RECOVERY_PATHS_STANDARD,
    ...(isConsumerSite ? RECOVERY_PATHS_CONSUMER_OVERRIDE : []),
  ]

  // Parallel probing — run all paths concurrently, take first maxProbe that return content
  const CONCURRENCY = 8
  const results: Array<{ path: string; content: string }> = []

  for (let i = 0; i < paths.length && results.length < maxProbe; i += CONCURRENCY) {
    const batch = paths.slice(i, i + CONCURRENCY)
    const settled = await Promise.all(
      batch.map(async path => {
        const url = `https://${domain}${path}`
        const content = await fetchSourceContent(url, 8_000)
        return { path, content: content && content.length >= 200 ? content : null }
      })
    )
    for (const { path, content } of settled) {
      if (content && results.length < maxProbe) results.push({ path, content })
    }
  }

  const contextBlocks: string[] = []
  const pathsProbed: string[] = []

  for (const { path, content } of results) {
    pathsProbed.push(`https://${domain}${path}`)

    const label = /investor|ir|annual/.test(path) ? 'Investor Relations'
      : /newsroom|press/.test(path)               ? 'Press Release'
      : /sustain|esg/.test(path)                  ? 'Sustainability Report'
      : /manufactur|operat|technolog|smart|industr|digital/.test(path) ? 'Operations Page'
      : 'Corporate Website'

    const strength = /investor|ir|annual/.test(path)  ? 'very_high'
      : /newsroom|press|sustain|esg/.test(path)        ? 'high'
      : 'medium'

    const tier = strength === 'very_high' ? 'tier1'
      : strength === 'high'              ? 'tier2'
      : 'tier3'

    contextBlocks.push(formatSourceBlock(`https://${domain}${path}`, label, strength, tier, content))
  }

  return { contextBlocks, pathsProbed }
}

// ── Main exports (item 2, 2026-07-12) ───────────────────────────
// Previously a single enrichCompanyIntelligence() call ran discovery+fetch
// (stages 1-3) and recovery (stage 4) sequentially, and only started after
// the website scrape finished — even though stages 1-3 need only domain +
// a company-name guess, both known before scraping starts. Split in two so
// route.ts can kick off discovery+fetch immediately (concurrent with the
// scrape) and run recovery separately once scrape output is actually needed
// (isConsumerSite, content-quality). See CLAUDE.md Item 2 for the full
// rationale. EnrichmentResult's shape is unchanged — buildEnrichmentResult()
// below assembles the exact same object either function used to return.

/**
 * Stages 1–3: discover candidate sources (Tavily → Serper), prioritize,
 * fetch via Firecrawl. Needs only domain + companyName — safe to call
 * before or independently of a website scrape.
 */
export async function discoverAndFetchExternalSources(
  domain: string,
  companyName: string,
): Promise<{ discovered: DiscoveredSource[]; prioritized: PrioritizedSource[]; contextBlocks: string[] }> {
  const tavilyKey = process.env.TAVILY_API_KEY
  const serperKey = process.env.SERPER_API_KEY

  // ── Stage 1: Discovery (Tavily → Serper) ─────────────────────
  let discovered: DiscoveredSource[] = []
  if (tavilyKey || serperKey) {
    discovered = await discoverEvidenceSources(companyName || domain, domain)
    console.log(`[Enrichment] Discovery: ${discovered.length} sources via ${tavilyKey ? 'Tavily' : 'Serper'}`)
  }

  // ── Stage 2: Prioritize ───────────────────────────────────────
  const prioritized = discovered.length > 0 ? prioritizeSources(discovered, 5) : []

  // ── Stage 3: Fetch external discovered sources ────────────────
  const { contextBlocks, fetched } = prioritized.length > 0
    ? await fetchPrioritizedSources(prioritized)
    : { contextBlocks: [], fetched: [] }

  console.log(`[Enrichment] External: ${fetched.length} fetched → ${contextBlocks.length} blocks`)

  return { discovered, prioritized, contextBlocks }
}

/**
 * Assembles the final EnrichmentResult from discovery+fetch output (stages
 * 1-3) and recovery output (stage 4, may be empty arrays if recovery wasn't
 * triggered). Pure — no I/O. Returns null if no content blocks were
 * collected at all, matching the previous enrichCompanyIntelligence()
 * behavior.
 */
export function buildEnrichmentResult(
  companyName: string,
  domain: string,
  discovered: DiscoveredSource[],
  prioritized: PrioritizedSource[],
  externalBlocks: string[],
  recoveryBlocks: string[],
  recoveryPaths: string[],
): EnrichmentResult | null {
  const allBlocks = [...externalBlocks, ...recoveryBlocks]

  if (allBlocks.length === 0) {
    console.log(`[Enrichment] No content blocks collected — returning null`)
    return null
  }

  const enrichedContext = [
    '[EXTERNAL INTELLIGENCE — Evidence Recovery Pipeline]',
    `[External sources: ${externalBlocks.length} | Recovery paths: ${recoveryPaths.length} | Total blocks: ${allBlocks.length}]`,
    '',
    ...allBlocks,
    '',
    '[END EXTERNAL INTELLIGENCE]',
  ].join('\n')

  console.log(`[Enrichment] Context built: ${enrichedContext.length} chars | ${allBlocks.length} blocks`)

  return {
    company_name: companyName,
    domain,
    enriched_signals: [],
    enriched_context: enrichedContext,
    search_queries_run: discovered.map(d => d.url),
    sources_found: discovered.map(d => d.url),
    sources_used: prioritized,
    recovery_paths_probed: recoveryPaths,
    enriched_at: new Date().toISOString(),
  }
}
