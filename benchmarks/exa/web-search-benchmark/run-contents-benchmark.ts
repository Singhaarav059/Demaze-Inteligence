// ============================================================
// Exa Contents vs Firecrawl — real known-URL extraction benchmark
// ============================================================
// Phase 7-10 of the web-research-stack audit (benchmarks/exa/PROVIDER_AUDIT.md
// §8). Data-collection ONLY.
//
// URL sourcing: rather than guessing plausible page paths, this script calls
// the REAL, unmodified scrapeCompanyWebsite() (lib/pipeline/scraper.ts) for
// each benchmark company first — the exact same discovery+selection logic
// (mapUrl, homepage-link scoring, up to 15 selected pages, Jina fallback
// when Firecrawl's nav extraction comes back empty) production uses. The
// URLs Exa Contents is then benchmarked against are whichever real pages
// that real run actually selected and successfully fetched — never invented
// URLs. This also means the "current Firecrawl path" result for Phase 7-8
// IS this real scrapeCompanyWebsite() call, not a separate mocked-up one.
//
// Run: npm run benchmark:exa:web:contents
// Requires EXA_API_KEY, FIRECRAWL_API_KEY. Spends real Firecrawl credits
// (one full scrapeCompanyWebsite() run per company — same cost as one real
// research run would incur) plus real Exa Contents credits (one call per
// selected URL). Never run as part of `npm test`/`vitest`.
// ============================================================

import { config as loadDotenv } from 'dotenv'
import path from 'path'
import fs from 'fs'

const cwd = process.cwd()
loadDotenv({ path: path.resolve(cwd, '.env.local') })
loadDotenv({ path: path.resolve(cwd, '.env') })

import { scrapeCompanyWebsite, type ScrapeResult } from '../../../lib/pipeline/scraper'
import { exaGetContents } from '../../../lib/enrichment/sources/exa-client'
import { BENCHMARK_COMPANIES } from './companies'

// Cap URLs benchmarked per company so the total across 4 companies stays in
// the 20-30 range the audit spec suggested — prioritize variety (homepage +
// a spread of the other selected pages) over just "the first N".
const URLS_PER_COMPANY = 7

interface FirecrawlPageRecord {
  company: string
  url: string
  success: boolean
  charCount: number
  error?: string
  jinaInvolved: boolean
}

interface ContentsCallRecord {
  company: string
  url: string
  provider: 'exa-contents'
  latencyMs: number
  ok: boolean
  error: string | null
  charCount: number
  costDollars?: number
  raw: unknown
}

interface ScrapeRunRecord {
  company: string
  domain: string
  latencyMs: number
  ok: boolean
  error: string | null
  discoveryMethod?: string
  successfulUrlCount?: number
  failedUrlCount?: number
  totalCharCount?: number
  warnings?: string[]
  jinaUsed?: boolean
  raw: ScrapeResult | null
}

const scrapeRuns: ScrapeRunRecord[] = []
const firecrawlPages: FirecrawlPageRecord[] = []
const contentsCalls: ContentsCallRecord[] = []

function pickRepresentativeUrls(result: ScrapeResult, cap: number): string[] {
  const successful = result.pages.filter(p => p.success && p.url)
  if (successful.length === 0) return []

  // Prioritize pages whose path suggests a specific evidence-relevant
  // category (matches the same keyword families scraper.ts's own
  // classifyUrl() looks for) — same spirit as production's own high-value
  // page selection, applied here just to pick a representative sample for
  // this comparison, not to re-select or filter what Firecrawl already chose.
  const KEYWORDS = ['about', 'career', 'investor', 'press', 'news', 'leadership', 'team', 'management', 'case-stud', 'product', 'service']
  const homepage = successful.find(p => {
    try { return new URL(p.url).pathname === '/' || new URL(p.url).pathname === '' } catch { return false }
  })
  const keyworded = successful.filter(p => p !== homepage && KEYWORDS.some(k => p.url.toLowerCase().includes(k)))
  const rest = successful.filter(p => p !== homepage && !keyworded.includes(p))

  const ordered = [...(homepage ? [homepage] : []), ...keyworded, ...rest]
  return ordered.slice(0, cap).map(p => p.url)
}

async function main() {
  const exaKey = process.env.EXA_API_KEY
  const firecrawlKey = process.env.FIRECRAWL_API_KEY
  if (!exaKey || !firecrawlKey) {
    console.error('EXA_API_KEY and FIRECRAWL_API_KEY must both be set. Aborting — no live calls made.')
    process.exit(1)
  }

  console.log(`\n=== Step 1: real scrapeCompanyWebsite() per company (current Firecrawl path) ===`)
  const urlsByCompany = new Map<string, string[]>()

  for (const company of BENCHMARK_COMPANIES) {
    const start = Date.now()
    try {
      const result = await scrapeCompanyWebsite(`https://${company.domain}`)
      const latencyMs = Date.now() - start
      const jinaUsed = result.debug.warnings.some(w => /jina/i.test(w))
      scrapeRuns.push({
        company: company.name,
        domain: company.domain,
        latencyMs,
        ok: true,
        error: null,
        discoveryMethod: result.discoveryMethod,
        successfulUrlCount: result.successfulUrls.length,
        failedUrlCount: result.failedUrls.length,
        totalCharCount: result.totalCharCount,
        warnings: result.debug.warnings,
        jinaUsed,
        raw: result,
      })
      for (const page of result.pages) {
        firecrawlPages.push({
          company: company.name,
          url: page.url,
          success: page.success,
          charCount: page.charCount,
          error: page.error,
          jinaInvolved: jinaUsed,
        })
      }
      console.log(`[firecrawl-scrape] ${company.name} — ${latencyMs}ms — ${result.successfulUrls.length} pages ok, ${result.failedUrls.length} failed, discovery=${result.discoveryMethod}, jina=${jinaUsed}`)
      urlsByCompany.set(company.name, pickRepresentativeUrls(result, URLS_PER_COMPANY))
    } catch (e) {
      const latencyMs = Date.now() - start
      const error = e instanceof Error ? e.message : String(e)
      scrapeRuns.push({ company: company.name, domain: company.domain, latencyMs, ok: false, error, raw: null })
      console.log(`[firecrawl-scrape] ${company.name} — ${latencyMs}ms — ERROR: ${error}`)
      urlsByCompany.set(company.name, [])
    }
  }

  console.log(`\n=== Step 2: Exa Contents on the SAME real URLs Firecrawl just fetched ===`)
  for (const company of BENCHMARK_COMPANIES) {
    const urls = urlsByCompany.get(company.name) ?? []
    for (const url of urls) {
      const start = Date.now()
      try {
        const r = await exaGetContents({ urls: [url], text: true, subpages: 0 }, exaKey)
        const latencyMs = Date.now() - start
        const text = r.results[0]?.text ?? ''
        contentsCalls.push({
          company: company.name,
          url,
          provider: 'exa-contents',
          latencyMs,
          ok: true,
          error: null,
          charCount: text.length,
          costDollars: r.costDollars?.total,
          raw: r,
        })
        console.log(`[exa-contents] ${company.name} :: ${url} — ${latencyMs}ms — ${text.length} chars`)
      } catch (e) {
        const latencyMs = Date.now() - start
        const error = e instanceof Error ? e.message : String(e)
        contentsCalls.push({ company: company.name, url, provider: 'exa-contents', latencyMs, ok: false, error, charCount: 0, raw: null })
        console.log(`[exa-contents] ${company.name} :: ${url} — ${latencyMs}ms — ERROR: ${error}`)
      }
    }
  }

  const outDir = path.resolve(cwd, 'benchmarks/exa/web-search-benchmark')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `contents-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(outPath, JSON.stringify({ scrapeRuns, firecrawlPages, contentsCalls }, null, 2))

  const totalUrls = [...urlsByCompany.values()].reduce((n, arr) => n + arr.length, 0)
  console.log(`\n${scrapeRuns.length} scrape runs, ${totalUrls} URLs benchmarked against Exa Contents, ${contentsCalls.filter(c => !c.ok).length} Contents error(s).`)
  console.log(`Snapshot written to ${outPath}`)
}

main()
