// ============================================================
// Bright Data vs. existing sources — controlled discovery benchmark
// ============================================================
// Added 2026-08-19 per explicit user instruction: Bright Data (5,000 free
// monthly credits) must be BENCHMARKED against Firecrawl/Tavily/Serper/the
// in-house crawler before it becomes any kind of default — never spend
// credits blindly, never wire it in as mandatory. This script is the
// controlled benchmark: same sectors, same queries (built once per sector,
// reused for both sources), same downstream filter/qualify pipeline
// (runDiscoveryCore, company-discovery.ts) — only the search backend
// differs between the two runs, so any difference in the numbers is
// attributable to the source, not to different queries or different
// filtering logic.
//
// Does NOT touch Supabase / company_registry — this must be re-runnable
// without polluting real discovery state or needing a live server. Sector
// and size qualification are replicated here using the same pure,
// DB-free functions company-qualification.ts's real gate uses
// (matchesSectorSignals, assessCompanySizeFromText) — "qualified" in this
// report means the same thing it means in production, just computed
// without persisting anything.
//
// Usage:
//   npm run benchmark:brightdata
//   BRIGHTDATA_BATCH_SIZE=20 BRIGHTDATA_ENRICH_SAMPLE=3 npm run benchmark:brightdata
// ============================================================

import * as fs from 'fs'
import * as path from 'path'
import { config as loadDotenv } from 'dotenv'

const cwd = process.cwd()
loadDotenv({ path: path.resolve(cwd, '.env.local') })
loadDotenv({ path: path.resolve(cwd, '.env') })

import type { TargetSector } from '../lib/sector-playbook/types'
import { getSectorPlaybook } from '../lib/sector-playbook/playbooks'
import { generateQueryBatch } from '../lib/enrichment/company-discovery-queries'
import { runDiscoveryCore, normalizeName, type CompanyDiscoveryResult, type CompanyMatch, type SearchQueryFn } from '../lib/enrichment/company-discovery'
import { matchesSectorSignals } from '../lib/enrichment/company-qualification'
import { assessCompanySizeFromText } from '../lib/enrichment/company-size'
import {
  searchBrightDataSerp, getBrightDataApiKey, getBrightDataSerpZone,
  brightDataUsage, resetBrightDataUsage, fetchBrightDataCompanyProfile,
} from '../lib/enrichment/sources/brightdata-client'

const SECTORS: TargetSector[] = ['manufacturing', 'automotive', 'ecommerce']
const BATCH_SIZE = Number(process.env.BRIGHTDATA_BATCH_SIZE ?? 12)
const ENRICH_SAMPLE = Number(process.env.BRIGHTDATA_ENRICH_SAMPLE ?? 2)
const RESULTS_PER_QUERY = 10 // mirrors company-discovery.ts's own RESULTS_PER_QUERY, for a fair comparison
const COST_PER_REQUEST_USD = process.env.BRIGHTDATA_COST_PER_REQUEST_USD
  ? Number(process.env.BRIGHTDATA_COST_PER_REQUEST_USD)
  : null // unset on purpose — Bright Data's per-product free-tier/pricing isn't hardcoded here, see README note in the summary output

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' }

interface QualifiedBreakdown {
  discovered: number
  totalMentions: number
  duplicateRate: number
  uniqueCompanies: number
  sectorRejected: number
  sizeRejected: number
  qualified: number
  requestsConsumed: number
}

function qualifyCompanies(companies: CompanyMatch[], sector: TargetSector): { qualified: number; sectorRejected: number; sizeRejected: number } {
  let qualified = 0, sectorRejected = 0, sizeRejected = 0
  for (const c of companies) {
    const text = c.reason
    if (!matchesSectorSignals(text, sector)) { sectorRejected++; continue }
    const size = assessCompanySizeFromText([text])
    if (size.verdict === 'too_large' || size.verdict === 'too_small') { sizeRejected++; continue }
    qualified++
  }
  return { qualified, sectorRejected, sizeRejected }
}

function summarize(result: CompanyDiscoveryResult, sector: TargetSector, requestsConsumed: number): QualifiedBreakdown {
  const discovered = result.candidates_considered
  const totalMentions = result.total_mentions ?? discovered
  const duplicateRate = totalMentions > 0 ? (totalMentions - discovered) / totalMentions : 0
  // Names are already unique-by-construction (runDiscoveryCore's grouped
  // Map dedupes by normalized name before this point), so companies.length
  // IS the unique count.
  const uniqueCompanies = result.companies.length
  const { qualified, sectorRejected, sizeRejected } = qualifyCompanies(result.companies, sector)
  return { discovered, totalMentions, duplicateRate, uniqueCompanies, sectorRejected, sizeRejected, qualified, requestsConsumed }
}

// Both sources routinely hit MAX_COMPANIES's cap, so "qualified" counts
// alone can't answer the actual question this benchmark exists to answer:
// is Bright Data finding DIFFERENT companies, or just re-finding the same
// ones existing sources already surface? Overlap by normalized name is
// the real signal.
interface Overlap {
  shared: string[]
  existingOnly: string[]
  brightdataOnly: string[]
}

function computeOverlap(existing: CompanyMatch[], brightdata: CompanyMatch[]): Overlap {
  const existingNames = new Map(existing.map(c => [normalizeName(c.name), c.name]))
  const bdNames = new Map(brightdata.map(c => [normalizeName(c.name), c.name]))
  const shared: string[] = [], existingOnly: string[] = [], brightdataOnly: string[] = []
  for (const [key, name] of existingNames) (bdNames.has(key) ? shared : existingOnly).push(name)
  for (const [key, name] of bdNames) if (!existingNames.has(key)) brightdataOnly.push(name)
  return { shared, existingOnly, brightdataOnly }
}

function printRow(label: string, b: QualifiedBreakdown): void {
  const cost = COST_PER_REQUEST_USD !== null && b.qualified > 0
    ? `$${((b.requestsConsumed * COST_PER_REQUEST_USD) / b.qualified).toFixed(3)}`
    : 'n/a'
  console.log(
    `  ${C.bold}${label.padEnd(16)}${C.reset}` +
    `discovered=${String(b.discovered).padEnd(4)} ` +
    `dupRate=${(b.duplicateRate * 100).toFixed(0).padStart(3)}% ` +
    `unique=${String(b.uniqueCompanies).padEnd(4)} ` +
    `sectorFail=${String(b.sectorRejected).padEnd(3)} ` +
    `sizeFail=${String(b.sizeRejected).padEnd(3)} ` +
    `${C.green}qualified=${String(b.qualified).padEnd(3)}${C.reset} ` +
    `requests=${String(b.requestsConsumed).padEnd(4)} ` +
    `cost/qualified=${cost}`
  )
}

async function main() {
  const apiKey = getBrightDataApiKey()
  const zone = getBrightDataSerpZone()
  const brightDataConfigured = !!apiKey && !!zone
  if (!brightDataConfigured) {
    console.log(`${C.yellow}BRIGHTDATA_API_KEY / BRIGHTDATA_SERP_ZONE not set — running existing-sources baseline only, skipping Bright Data comparison.${C.reset}\n`)
  }

  const brightDataSearchFn: SearchQueryFn = async (query) => ({
    query, tier: 'brightdata', results: await searchBrightDataSerp(query, RESULTS_PER_QUERY),
  })

  const runResults: Record<string, { existing: QualifiedBreakdown; brightdata?: QualifiedBreakdown }> = {}
  const rawResults: Record<string, { existing: CompanyDiscoveryResult; brightdata?: CompanyDiscoveryResult }> = {}
  const overlaps: Record<string, Overlap> = {}

  for (const sector of SECTORS) {
    const label = getSectorPlaybook(sector).label
    console.log(`${C.cyan}${C.bold}=== ${label} ===${C.reset}`)

    // Same query batch (same terms x regions x directories, per
    // company-discovery-queries.ts's rotation) fed to BOTH sources — this
    // is what makes the comparison apples-to-apples.
    const queries = generateQueryBatch(sector, new Set(), BATCH_SIZE)
    console.log(`  ${C.dim}${queries.length} queries (spans multiple regions per company-discovery-queries.ts's rotation)${C.reset}`)

    const existingResult = await runDiscoveryCore(queries, undefined, sector, label)
    const existingBreakdown = summarize(existingResult, sector, queries.length /* 1 request-equivalent per query via routedSearch, actual vendor call count varies by cache/tier */)
    printRow('existing:', existingBreakdown)
    runResults[sector] = { existing: existingBreakdown }
    rawResults[sector] = { existing: existingResult }

    if (brightDataConfigured) {
      resetBrightDataUsage()
      const bdResult = await runDiscoveryCore(queries, undefined, sector, label, brightDataSearchFn)
      const bdBreakdown = summarize(bdResult, sector, brightDataUsage.serpRequests)
      printRow('brightdata:', bdBreakdown)
      runResults[sector].brightdata = bdBreakdown
      rawResults[sector].brightdata = bdResult

      const overlap = computeOverlap(existingResult.companies, bdResult.companies)
      overlaps[sector] = overlap
      console.log(
        `  ${C.bold}overlap:${C.reset}        shared=${overlap.shared.length} ` +
        `existing-only=${overlap.existingOnly.length} brightdata-only=${C.green}${overlap.brightdataOnly.length}${C.reset}`
      )
      if (overlap.brightdataOnly.length > 0) console.log(`    ${C.dim}brightdata-only: ${overlap.brightdataOnly.join(', ')}${C.reset}`)
    }
    console.log()
  }

  // ── Small, deliberate LinkedIn enrichment sample (never blind/looped
  // over every discovered company — a handful of real profile lookups is
  // enough to tell whether Bright Data's LinkedIn Company dataset returns
  // usable data at all). Skipped entirely if Bright Data isn't configured.
  const enrichmentSamples: Array<{ company: string; sector: TargetSector; success: boolean; fields: string[] }> = []
  if (brightDataConfigured && ENRICH_SAMPLE > 0) {
    console.log(`${C.cyan}${C.bold}=== LinkedIn company enrichment sample (${ENRICH_SAMPLE}/sector) ===${C.reset}`)
    for (const sector of SECTORS) {
      const pool = rawResults[sector].brightdata?.companies ?? rawResults[sector].existing.companies
      const sample = pool.slice(0, ENRICH_SAMPLE)
      for (const c of sample) {
        const profile = await fetchBrightDataCompanyProfile(c.name)
        const fields = profile ? Object.entries(profile).filter(([k, v]) => k !== 'raw' && v !== undefined).map(([k]) => k) : []
        enrichmentSamples.push({ company: c.name, sector, success: !!profile, fields })
        console.log(`  ${profile ? C.green + '✓' : C.dim + '✗'}${C.reset} ${c.name} ${profile ? `(${fields.join(', ')})` : '(no match / not found)'}`)
      }
    }
    console.log()
  }

  // ── Decision-framework note — overlap (net-new companies), not raw
  // qualified count, is the real signal: both sources routinely hit
  // MAX_COMPANIES's cap, so equal qualified counts don't mean equal value.
  console.log(`${C.bold}Decision inputs (primary / secondary / enrichment / fallback / specific-cases-only):${C.reset}`)
  for (const sector of SECTORS) {
    const overlap = overlaps[sector]
    if (!overlap) continue
    const total = overlap.shared.length + overlap.existingOnly.length + overlap.brightdataOnly.length
    const netNewPct = total > 0 ? Math.round((overlap.brightdataOnly.length / total) * 100) : 0
    console.log(
      `  ${getSectorPlaybook(sector).label}: ${overlap.brightdataOnly.length} of ${total} companies (${netNewPct}%) came ONLY from Bright Data — ` +
      (netNewPct === 0 ? 'zero net-new coverage this run, existing sources found everything Bright Data did'
        : netNewPct < 20 ? 'minor incremental coverage'
        : netNewPct < 50 ? 'meaningful incremental coverage — candidate for a secondary/enrichment source'
        : 'majority net-new — candidate for a primary/co-primary source in this sector')
    )
  }
  if (COST_PER_REQUEST_USD === null) {
    console.log(`  ${C.dim}Set BRIGHTDATA_COST_PER_REQUEST_USD to compute $/qualified-company; Bright Data's free-tier credit semantics differ per product (SERP vs. dataset), so this script reports raw request counts by default rather than guessing a blended $ figure.${C.reset}`)
  }

  // ── Persist ─────────────────────────────────────────────────────
  const outDir = path.resolve(cwd, 'benchmarks/brightdata-results')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(outPath, JSON.stringify({
    ranAt: new Date().toISOString(),
    batchSize: BATCH_SIZE,
    brightDataConfigured,
    results: runResults,
    overlaps,
    companyNames: Object.fromEntries(SECTORS.map(s => [s, {
      existing: rawResults[s].existing.companies.map(c => c.name),
      brightdata: rawResults[s].brightdata?.companies.map(c => c.name) ?? [],
    }])),
    enrichmentSamples,
  }, null, 2))
  console.log(`\n${C.dim}Written: ${path.relative(cwd, outPath)}${C.reset}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
