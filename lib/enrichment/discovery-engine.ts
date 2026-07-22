// ============================================================
// Evidence Discovery Engine — v1
// ============================================================
// Stage 1 of the Evidence Recovery Pipeline.
// Runs targeted search queries to discover high-value URLs:
//   investor relations, annual reports, careers, expansion news
//
// Search provider priority: Tavily → Serper → (none)
// Returns DiscoveredSource[] sorted by evidence_strength desc.
// Gracefully returns [] when no search API is configured.
// ============================================================

import { getCachedSearch, saveSearchCache } from '@/lib/cache/search-cache'

export type SourceType =
  | 'annual_report'
  | 'investor_presentation'
  | 'earnings_release'
  | 'press_release'
  | 'careers_page'
  | 'official_blog'
  | 'ceo_interview'
  | 'news_article'
  | 'sustainability_report'
  | 'corporate_website'
  | 'other'

export type EvidenceStrength = 'very_high' | 'high' | 'medium' | 'low'
export type QueryCategory = 'investor' | 'hiring' | 'expansion' | 'strategy' | 'leadership'

export interface DiscoveredSource {
  url: string
  title: string
  snippet: string
  source_type: SourceType
  evidence_strength: EvidenceStrength
  priority_score: number          // 0-100, used for ranking
  query_category: QueryCategory
}

// ── Source type detection ──────────────────────────────────────

export function classifySourceType(url: string, title: string): SourceType {
  const u = url.toLowerCase()
  const t = title.toLowerCase()

  if (/annual.?report|annual-report|annualreport/.test(u + t)) return 'annual_report'
  if (/investor.?presentation|investor-presentation|ir\.pdf/.test(u + t)) return 'investor_presentation'
  if (/earnings.?release|earnings-release|quarterly.?results|q[1-4].{0,5}results/.test(u + t)) return 'earnings_release'
  if (/press.?release|press-release|newsroom|news-release/.test(u + t)) return 'press_release'
  if (/careers|jobs|hiring|vacancies|work-with-us|join-us/.test(u + t)) return 'careers_page'
  if (/blog|insights|perspectives|thought-leadership/.test(u + t)) return 'official_blog'
  if (/interview|ceo.?speak|md.?speak|chairman.?speak/.test(u + t)) return 'ceo_interview'
  if (/sustainability|esg|csr|environment-report/.test(u + t)) return 'sustainability_report'
  if (/investor|ir\.|shareholders|bse|nse|sec\.gov|bseindia|nseindia|moneycontrol/.test(u)) return 'investor_presentation'
  if (/linkedin\.com|glassdoor|naukri|indeed/.test(u)) return 'careers_page'
  if (/reuters|bloomberg|economictimes|livemint|businessline|businesswire|prnewswire/.test(u)) return 'news_article'

  return 'other'
}

// ── Evidence strength by source type ─────────────────────────

const SOURCE_STRENGTH: Record<SourceType, EvidenceStrength> = {
  annual_report:          'very_high',
  investor_presentation:  'very_high',
  earnings_release:       'very_high',
  press_release:          'high',
  careers_page:           'high',
  ceo_interview:          'high',
  official_blog:          'medium',
  news_article:           'medium',
  sustainability_report:  'medium',
  corporate_website:      'low',
  other:                  'low',
}

const PRIORITY_SCORE: Record<SourceType, number> = {
  annual_report:          100,
  investor_presentation:  95,
  earnings_release:       90,
  press_release:          75,
  careers_page:           70,
  ceo_interview:          65,
  official_blog:          50,
  news_article:           45,
  sustainability_report:  40,
  corporate_website:      20,
  other:                  10,
}

// ── Search query templates ────────────────────────────────────

function buildDiscoveryQueries(companyName: string): Array<{ query: string; category: QueryCategory }> {
  const c = companyName
  const yr = new Date().getFullYear()
  return [
    // ── Investor (highest evidence tier) ────────────────────────
    { query: `"${c}" annual report ${yr}`,                         category: 'investor' },
    { query: `"${c}" investor presentation ${yr}`,                  category: 'investor' },
    { query: `"${c}" quarterly results earnings ${yr}`,             category: 'investor' },

    // ── Hiring (strong intent signals) ──────────────────────────
    { query: `"${c}" AI machine learning engineer jobs hiring`,     category: 'hiring' },
    { query: `"${c}" digital transformation IT SAP ERP careers`,    category: 'hiring' },
    { query: `"${c}" automation robotics engineer vacancies`,       category: 'hiring' },

    // ── Expansion / capacity ─────────────────────────────────────
    { query: `"${c}" new plant factory greenfield expansion ${yr}`, category: 'expansion' },
    { query: `"${c}" capacity increase manufacturing growth`,       category: 'expansion' },

    // ── Digital transformation / ERP / MES ──────────────────────
    { query: `"${c}" ERP SAP Oracle MES implementation digital`,    category: 'strategy' },
    { query: `"${c}" Industry 4.0 smart factory IIoT initiative`,   category: 'strategy' },

    // ── AI & automation strategy ─────────────────────────────────
    { query: `"${c}" AI automation strategy CEO interview ${yr}`,   category: 'strategy' },

    // ── Recent news (acquisition, partnership, milestone) ────────
    { query: `"${c}" acquisition merger partnership news ${yr}`,    category: 'expansion' },

    // ── Leadership / decision-makers (2026-07-18 decision-maker discovery
    // fix — real leadership/team pages are frequently thin on the company's
    // own site or missed entirely by the scraper's page selection; a
    // dedicated search query surfaces named executives from third-party
    // coverage — interviews, "leadership team" bios, press mentions — as a
    // supplementary source, same "search-grounded" discipline as every
    // other query here) ──────────────────────────────────────────
    { query: `"${c}" leadership team executives`,                   category: 'leadership' },
    { query: `"${c}" CEO CTO management team`,                      category: 'leadership' },
  ]
}

// ── Tavily search ─────────────────────────────────────────────
// Exported for reuse by website-discovery.ts — same search provider, different
// purpose (identity resolution vs. evidence discovery), no reason to duplicate
// the HTTP call logic.
//
// Cached (2026-07-21): every discovery module in this codebase (Enrichment
// Discovery, Competitor Discovery, ICP Generator, Market Intelligence,
// Website Discovery, Company Discovery) funnels through this one function,
// so caching here covers all of them for free. A cache hit costs one
// Supabase read instead of one Tavily credit ($0.008) — a repeat run of an
// already-researched company (batch retries, reprocessing) previously
// re-paid the full ~40-query search bill from scratch every time. See
// lib/cache/search-cache.ts for the read/write helpers and TTL.

export async function searchTavily(
  query: string,
  apiKey: string,
  maxResults: number = 3,
): Promise<Array<{ title: string; url: string; content: string }>> {
  const cached = await getCachedSearch('tavily', query, maxResults)
  if (cached) return cached

  try {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: maxResults,
        include_answer: false,
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!resp.ok) return []
    const data = await resp.json() as { results?: Array<{ title: string; url: string; content: string }> }
    const results = data.results ?? []
    if (results.length > 0) saveSearchCache('tavily', query, maxResults, results)
    return results
  } catch {
    return []
  }
}

// ── Serper search (fallback) ──────────────────────────────────
// Exported for reuse by website-discovery.ts — see note above. Cached the
// same way as searchTavily() above.

export async function searchSerper(
  query: string,
  apiKey: string,
  numResults: number = 3,
): Promise<Array<{ title: string; url: string; content: string }>> {
  const cached = await getCachedSearch('serper', query, numResults)
  if (cached) return cached

  try {
    const resp = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: numResults }),
      signal: AbortSignal.timeout(10000),
    })
    if (!resp.ok) return []
    const data = await resp.json() as { organic?: Array<{ title: string; link: string; snippet: string }> }
    const results = (data.organic ?? []).map(r => ({ title: r.title, url: r.link, content: r.snippet }))
    if (results.length > 0) saveSearchCache('serper', query, numResults, results)
    return results
  } catch {
    return []
  }
}

// ── Main export ───────────────────────────────────────────────

/**
 * Discover high-value evidence URLs for a company.
 * Returns sorted DiscoveredSource[] (best first).
 * Returns [] if no search API key is configured.
 */
export async function discoverEvidenceSources(
  companyName: string,
  domain: string,
): Promise<DiscoveredSource[]> {
  const tavilyKey = process.env.TAVILY_API_KEY
  const serperKey = process.env.SERPER_API_KEY

  if (!tavilyKey && !serperKey) {
    console.log('[discovery] No search API key — skipping discovery')
    return []
  }

  const queries = buildDiscoveryQueries(companyName || domain.split('.')[0])
  const results: DiscoveredSource[] = []
  const seenUrls = new Set<string>()

  // Run queries in parallel with a concurrency cap of 3
  const chunks: Array<typeof queries> = []
  for (let i = 0; i < queries.length; i += 3) chunks.push(queries.slice(i, i + 3))

  for (const chunk of chunks) {
    await Promise.all(chunk.map(async ({ query, category }) => {
      // Try Tavily first, but fall through to Serper whenever Tavily comes back
      // empty — not just when the key is absent. A failed/quota-exceeded Tavily
      // call also resolves to [] (see searchTavily's catch), which previously
      // meant a real outage silently produced zero results instead of falling
      // back to a configured Serper key.
      let raw = tavilyKey ? await searchTavily(query, tavilyKey) : []
      if (raw.length === 0 && serperKey) {
        raw = await searchSerper(query, serperKey)
      }

      for (const r of raw) {
        if (!r.url || seenUrls.has(r.url)) continue
        // Skip only the company's own domain (already scraped). PDFs are kept —
        // they're fetched via pdf-parse downstream (Item 3), not dropped here.
        // Guard domain being empty/undefined (company-name-only input, no website
        // resolved yet) — `url.includes('')` is always true in JS, which would
        // silently exclude every single result and break discovery entirely.
        if (domain && r.url.includes(domain)) continue

        seenUrls.add(r.url)

        const source_type = classifySourceType(r.url, r.title)
        const evidence_strength = SOURCE_STRENGTH[source_type]
        const priority_score = PRIORITY_SCORE[source_type]

        results.push({
          url: r.url,
          title: r.title || '',
          snippet: (r.content || '').slice(0, 300),
          source_type,
          evidence_strength,
          priority_score,
          query_category: category,
        })
      }
    }))
  }

  // Sort by priority score descending, take top 8 candidates for prioritizer
  results.sort((a, b) => b.priority_score - a.priority_score)
  return results.slice(0, 8)
}
