// ============================================================
// Evidence Discovery Engine — v1
// ============================================================
// Stage 1 of the Evidence Recovery Pipeline.
// Runs targeted search queries to discover high-value URLs:
//   investor relations, annual reports, careers, expansion news
//
// Search provider: Tavily → (none). Serper was removed 2026-09-01 (see
// docs/DECISIONS.md) — it was already unfunded/non-functional in production
// at removal time, and the benchmark evidence didn't show a case where its
// fallback recovered a result Tavily genuinely missed for a reason other
// than a quota/outage failure Tavily itself was also having.
// Returns DiscoveredSource[] sorted by evidence_strength desc.
// Gracefully returns [] when no search API is configured.
// ============================================================

import { getCachedSearch, saveSearchCache } from '@/lib/cache/search-cache'

export type SourceType =
  | 'annual_report'
  | 'investor_presentation'
  | 'earnings_release'
  | 'earnings_call_transcript'
  | 'executive_change_announcement'
  | 'press_release'
  | 'careers_page'
  | 'official_blog'
  | 'ceo_interview'
  | 'news_article'
  | 'sustainability_report'
  | 'corporate_website'
  | 'regulatory_filing'
  // D.5: layoffs/restructuring and private-funding-round announcements —
  // real trigger-event content, same tier as executive_change_announcement,
  // but never a proof of a service-specific problem on their own (see
  // service-evidence.ts — deliberately not consulted there).
  | 'layoff_announcement'
  | 'funding_announcement'
  | 'other'

export type EvidenceStrength = 'very_high' | 'high' | 'medium' | 'low'
// D.5: 'risk' added for layoffs/restructuring queries — funding queries
// reuse 'investor' (same financial-position query intent as
// earnings/annual-report queries already in that bucket).
export type QueryCategory = 'investor' | 'hiring' | 'expansion' | 'strategy' | 'leadership' | 'risk'

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
  // Item 4 (2026-07-23): earnings-call / investor-call transcripts are a
  // distinct, high-value source type from a plain earnings release — they
  // carry direct management quotes, not just the numbers. Checked before
  // the generic press_release/investor_presentation branches so a URL like
  // "/investor/q3-earnings-call-transcript" classifies as a transcript, not
  // a generic investor_presentation. `\btranscript\b` uses a word boundary
  // (not a plain substring test) for the same reason the URL-classifier's
  // 'ir'/'sec' bug fix does — "transcript" alone is common enough in page
  // titles that it needs to co-occur with an earnings/investor-call cue,
  // not match in isolation.
  if (
    /earnings.?call.?transcripts?|concall.?transcripts?|investor.?call.?transcripts?/.test(u + t) ||
    (/\btranscripts?\b/.test(t) && /earnings.?call|investor.?call|concall|conference.?call|quarterly/.test(u + t))
  ) return 'earnings_call_transcript'
  // Item 4 (2026-07-23): executive-change announcements (new CEO, leadership
  // transition, management change) are a real trigger-event signal — see
  // CLAUDE.md's "named individual + explicit stated portfolio" signal
  // category. Checked before press_release so a "company appoints new CEO"
  // press release classifies by its actual content, not the generic
  // press-release URL pattern.
  if (
    /appoints?\s+new\s+(ceo|cfo|coo|cto|md|president|managing director|chairman)|appointed\s+as\s+(ceo|cfo|coo|cto|president|md|managing director|chairman)|new\s+(ceo|cfo|coo|cto|md|president|managing director)\s+(announced|named|appointed)|steps?\s+down\s+as\s+(ceo|cfo|coo|cto|president|chairman)|resigns?\s+as\s+(ceo|cfo|coo|cto|president|chairman)|leadership\s+transition|management\s+change|names?\s+new\s+(ceo|cfo|coo|cto|president)|succeeds?\s+.{0,20}\s+as\s+(ceo|cfo|coo|cto|president)/.test(u + t)
  ) return 'executive_change_announcement'
  // D.5: layoff/funding classification checked before the generic
  // press_release branch, same precedent as executive_change_announcement
  // above — a "Company X raises $10M Series A" or "Company X announces
  // layoffs" article should classify by its actual content, not the
  // generic press-release URL pattern.
  if (/lay.?offs?|job.?cuts?|workforce.?reduction/.test(u + t)) return 'layoff_announcement'
  if (/funding.?round|series.?[a-e].?funding|raises.{0,15}(?:million|billion|crore|funding)|secures.{0,15}(?:funding|investment)/.test(u + t)) return 'funding_announcement'
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
  annual_report:                  'very_high',
  investor_presentation:          'very_high',
  earnings_release:               'very_high',
  earnings_call_transcript:       'very_high',
  executive_change_announcement:  'high',
  press_release:                  'high',
  careers_page:                   'high',
  ceo_interview:                  'high',
  official_blog:                  'medium',
  news_article:                   'medium',
  sustainability_report:          'medium',
  corporate_website:              'low',
  // Not produced by classifySourceType() below — regulatory_filing comes
  // exclusively from lib/enrichment/sources/edgar-client.ts's deterministic
  // SEC EDGAR lookup, never from a Tavily/Serper search result. Kept in
  // this map anyway so it's a real SourceType the rest of the pipeline
  // (sourceTypeLabel, evidenceStrengthTier, PrioritizedSource) already
  // knows how to render, same as every other type here.
  regulatory_filing:              'very_high',
  layoff_announcement:            'high',
  funding_announcement:           'high',
  other:                          'low',
}

const PRIORITY_SCORE: Record<SourceType, number> = {
  annual_report:                  100,
  investor_presentation:          95,
  earnings_release:               90,
  earnings_call_transcript:       88,
  executive_change_announcement:  82,
  press_release:                  75,
  careers_page:                   70,
  ceo_interview:                  65,
  official_blog:                  50,
  news_article:                   45,
  sustainability_report:          40,
  corporate_website:              20,
  regulatory_filing:              98,
  layoff_announcement:            80,
  funding_announcement:           80,
  other:                          10,
}

// ── Search query templates ────────────────────────────────────

// Exported for unit testing (Item 4, 2026-07-23) — same reasoning as
// isPdfUrl/extractPdfText in web-enricher.ts: query-template shape is
// unit-testable without spending real search-API quota, so it should be.
export function buildDiscoveryQueries(companyName: string): Array<{ query: string; category: QueryCategory }> {
  const c = companyName
  const yr = new Date().getFullYear()
  return [
    // ── Investor (highest evidence tier) ────────────────────────
    { query: `"${c}" annual report ${yr}`,                         category: 'investor' },
    { query: `"${c}" investor presentation ${yr}`,                  category: 'investor' },
    { query: `"${c}" quarterly results earnings ${yr}`,             category: 'investor' },

    // ── Investor call transcripts / financial disclosures (Item 4,
    // 2026-07-23 — previously only surfaced incidentally via the generic
    // investor queries above; these target the transcript/disclosure
    // content specifically, e.g. management commentary that a plain
    // "quarterly results" query tends to miss in favor of just the
    // headline numbers) ─────────────────────────────────────────
    { query: `"${c}" earnings call transcript ${yr}`,               category: 'investor' },
    { query: `"${c}" investor call transcript quarterly results`,   category: 'investor' },

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

    // ── Executive-change announcements (Item 4, 2026-07-23 — a real
    // trigger-event signal per CLAUDE.md's "named individual + explicit
    // stated portfolio" signal category; previously had no dedicated
    // query template at all, so this only surfaced by accident) ───────
    { query: `"${c}" appoints new CEO`,                             category: 'leadership' },
    { query: `"${c}" CEO steps down leadership transition`,         category: 'leadership' },
    { query: `"${c}" management change appointment ${yr}`,          category: 'leadership' },

    // ── D.5: Layoffs / restructuring & funding rounds ────────────
    // Minimum necessary templates (D.5 audit) — real trigger-event content
    // the pipeline had zero coverage for. Supporting timing/pressure
    // triggers only; never wired into service-evidence.ts's detectors, so
    // a hit here alone can never produce a deterministic opportunity.
    { query: `"${c}" layoffs job cuts restructuring workforce reduction ${yr}`, category: 'risk' },
    { query: `"${c}" raises funding Series A B C investment round ${yr}`,       category: 'investor' },
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
//
// A non-ok response or a thrown error still returns [] to the caller (every
// caller in this codebase treats [] as "no sources this pass" and degrades
// gracefully, per CLAUDE.md's "never hard-fail" rule) — but each failure
// path now logs a distinct warning first. Before this, both a real failure
// (bad key, quota exhausted, network error) and a genuine zero-result query
// were completely silent and indistinguishable from each other — exactly
// the gap that let Serper's account running out of credits look like "zero
// relevant results" for weeks in the 2026-09-01 web-research benchmark. This
// keeps the same graceful-degradation contract for every existing caller
// (no return-type change) while making a failure observable in logs.

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
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      console.warn(`[discovery] Tavily request FAILED (not a zero-result query) — HTTP ${resp.status}: ${body.slice(0, 200)}`)
      return []
    }
    const data = await resp.json() as { results?: Array<{ title: string; url: string; content: string }> }
    const results = data.results ?? []
    if (results.length > 0) saveSearchCache('tavily', query, maxResults, results)
    return results
  } catch (err) {
    console.warn(`[discovery] Tavily request FAILED (not a zero-result query) — ${err instanceof Error ? err.message : String(err)}`)
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

  if (!tavilyKey) {
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
      const raw = await searchTavily(query, tavilyKey)

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
