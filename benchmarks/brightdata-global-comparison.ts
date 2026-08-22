// ============================================================
// Global controlled discovery benchmark — existing sources vs. Bright Data
// ============================================================
// Follow-up to benchmarks/brightdata-comparison.ts (commit 3fe3d49), which
// was concentrated around India/US/Indonesia. This runs explicit,
// region-targeted samples across 8 global regions x the 3 active sectors
// (Manufacturing/Automotive/E-commerce), using the SAME real, persistent
// identity/dedup + qualification system every production discovery route
// already uses (lib/companies/identity.ts's company_registry via
// lib/enrichment/company-qualification.ts's qualifyCandidate()) — not an
// in-memory approximation. This is a deliberate change from the prior
// benchmark's DB-free design: cross-source/cross-region identity dedup
// ("ABC Manufacturing Ltd" / "ABC Manufacturing" / "abcmanufacturing.com"
// must count as ONE company) can only be measured correctly against the
// real identity table, and per the governing instruction this is
// considered a feature, not a side effect — it also means every company
// this benchmark touches becomes real seed data for production discovery
// (never re-discovered/re-qualified twice), directly serving the
// "avoid repeated research" cost-optimization goal.
//
// Run order per (sector, region) cell is deliberately existing-sources
// FIRST, then Bright Data SECOND — this makes Bright Data's `duplicate`
// funnel count mean "found something existing sources already claimed
// this run" (the real incremental-value signal), while its `qualified`
// count means "found something existing sources did NOT already have."
// Overlap/shared-vs-source-only is ALSO computed independently via raw
// identity-key matching (order-agnostic), so both framings are available.
//
// SAFETY: this script defaults to DRY RUN (GLOBAL_BENCHMARK_DRY_RUN
// unset or anything other than 'false' triggers dry-run) — it prints the
// exact expected query count and a Bright Data request estimate with NO
// network calls, so the real cost can be reviewed before spending
// anything. Set GLOBAL_BENCHMARK_DRY_RUN=false to actually run it live.
//
// Usage:
//   npx tsx benchmarks/brightdata-global-comparison.ts                    (dry run, default)
//   GLOBAL_BENCHMARK_DRY_RUN=false npx tsx benchmarks/brightdata-global-comparison.ts
//   GLOBAL_BENCHMARK_QUERIES_PER_CELL=6 GLOBAL_BENCHMARK_DRY_RUN=false npx tsx ...
// ============================================================

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { config as loadDotenv } from 'dotenv'

const cwd = process.cwd()
loadDotenv({ path: path.resolve(cwd, '.env.local') })
loadDotenv({ path: path.resolve(cwd, '.env') })

import type { TargetSector } from '../lib/sector-playbook/types'
import { getSectorPlaybook } from '../lib/sector-playbook/playbooks'
import { SECTOR_SEARCH_TERMS } from '../lib/enrichment/company-discovery-queries'
import { runDiscoveryCore, type CompanyDiscoveryResult, type CompanyMatch, type SearchQueryFn } from '../lib/enrichment/company-discovery'
import { qualifyCandidate } from '../lib/enrichment/company-qualification'
import { emptyFunnel, recordDiscovered, recordQualified, recordRejection, mergeFunnels, type DiscoveryFunnel } from '../lib/enrichment/discovery-funnel'
import { buildIdentityKeys } from '../lib/companies/identity'
import { createServerClient } from '../lib/supabase/server'
import {
  searchBrightDataSerp, getBrightDataApiKey, getBrightDataSerpZone,
  brightDataUsage, resetBrightDataUsage, fetchBrightDataCompanyProfile,
} from '../lib/enrichment/sources/brightdata-client'

// ── Config ──────────────────────────────────────────────────────
export const SECTORS: TargetSector[] = ['manufacturing', 'automotive', 'ecommerce']

// Real, explicit region-targeting qualifiers — deliberately distinct
// buckets (Canada separate from "North America" = US, to avoid double-
// counting the same query twice under two names). "South Asia" used
// instead of the old rotation pool's bare "India" — broader, per the
// explicit instruction that the prior benchmark over-concentrated on
// India.
export const REGIONS: Record<string, string> = {
  'North America': 'in the United States',
  'Canada': 'in Canada',
  'Europe + UK': 'in Europe',
  'Middle East': 'in the Middle East',
  'South Asia': 'in South Asia',
  'Southeast Asia': 'in Southeast Asia',
  'Latin America': 'in Latin America',
  'Australia + New Zealand': 'in Australia and New Zealand',
}

const QUERIES_PER_CELL = Number(process.env.GLOBAL_BENCHMARK_QUERIES_PER_CELL ?? 4)
const LINKEDIN_SAMPLE_PER_SECTOR = Number(process.env.GLOBAL_BENCHMARK_ENRICH_SAMPLE ?? 1)
const DRY_RUN = process.env.GLOBAL_BENCHMARK_DRY_RUN !== 'false'
const RESULTS_PER_QUERY = 10 // mirrors company-discovery.ts's own RESULTS_PER_QUERY
const MAX_COMPANIES_PER_CELL = 10 // mirrors company-discovery.ts's MAX_COMPANIES cap
const COST_PER_REQUEST_USD = process.env.BRIGHTDATA_COST_PER_REQUEST_USD
  ? Number(process.env.BRIGHTDATA_COST_PER_REQUEST_USD)
  : null

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', red: '\x1b[31m' }

export function buildRegionQueries(sector: TargetSector, regionQualifier: string, n: number): string[] {
  const terms = SECTOR_SEARCH_TERMS[sector].slice(0, n)
  return terms.map(t => `${t} ${regionQualifier}`)
}

// ── Cost estimate (pure math, zero network calls) ─────────────────
export interface CostEstimate {
  cells: number
  brightDataQueries: number
  brightDataRequestsWithRetryOverhead: number
  existingSourceQueries: number
  domainResolutionQueriesWorstCase: number
  domainResolutionQueriesRealistic: number
  linkedinLookups: number
  linkedinSerpRequests: number
  linkedinDatasetTriggers: number
  totalBrightDataBudgetUsedRealistic: number
  totalBrightDataBudgetUsedWorstCase: number
  percentOfFreeTierRealistic: number
  percentOfFreeTierWorstCase: number
}

export function estimateCost(): CostEstimate {
  const cells = SECTORS.length * Object.keys(REGIONS).length
  const brightDataQueries = cells * QUERIES_PER_CELL
  const brightDataRequestsWithRetryOverhead = Math.ceil(brightDataQueries * 1.15) // ~15% retry overhead observed live

  const existingSourceQueries = cells * QUERIES_PER_CELL // same query volume, spent against Tavily/Serper/Gemini/cache instead

  // Domain resolution runs for BOTH the existing-sources pass and the
  // Bright Data pass per cell, but always through website-discovery.ts's
  // own Tavily/Serper-backed search — never Bright Data — so this does
  // NOT consume Bright Data credits. Shown anyway per "show estimated
  // other provider usage."
  const domainResolutionCellPasses = cells * 2
  const domainResolutionQueriesWorstCase = domainResolutionCellPasses * MAX_COMPANIES_PER_CELL * 2
  const domainResolutionQueriesRealistic = Math.round(domainResolutionQueriesWorstCase * 0.5) // prior benchmark runs typically resolved ~50% of the MAX_COMPANIES cap, not the full cap

  const linkedinLookups = SECTORS.length * LINKEDIN_SAMPLE_PER_SECTOR
  const linkedinSerpRequests = linkedinLookups // one findLinkedInCompanyUrl() search per lookup
  const linkedinDatasetTriggers = linkedinLookups // one dataset trigger per lookup (polls are a separate, uncounted product)

  const totalBrightDataBudgetUsedRealistic = brightDataRequestsWithRetryOverhead + linkedinSerpRequests + linkedinDatasetTriggers
  const totalBrightDataBudgetUsedWorstCase = totalBrightDataBudgetUsedRealistic + Math.round(brightDataQueries * 0.15) // a second retry pass on a bad day

  return {
    cells, brightDataQueries, brightDataRequestsWithRetryOverhead, existingSourceQueries,
    domainResolutionQueriesWorstCase, domainResolutionQueriesRealistic,
    linkedinLookups, linkedinSerpRequests, linkedinDatasetTriggers,
    totalBrightDataBudgetUsedRealistic, totalBrightDataBudgetUsedWorstCase,
    percentOfFreeTierRealistic: Math.round((totalBrightDataBudgetUsedRealistic / 5000) * 1000) / 10,
    percentOfFreeTierWorstCase: Math.round((totalBrightDataBudgetUsedWorstCase / 5000) * 1000) / 10,
  }
}

function printEstimate(est: CostEstimate): void {
  console.log(`${C.bold}${C.cyan}=== DRY RUN — cost estimate, zero network calls made ===${C.reset}`)
  console.log(`  Cells (${SECTORS.length} sectors x ${Object.keys(REGIONS).length} regions): ${est.cells}`)
  console.log(`  Queries per cell: ${QUERIES_PER_CELL}`)
  console.log(`  ${C.bold}Bright Data SERP queries:${C.reset} ${est.brightDataQueries} (+ ~15% retry overhead = ~${est.brightDataRequestsWithRetryOverhead})`)
  console.log(`  Existing-sources queries (Tavily/Serper/Gemini/cache, NOT Bright Data): ${est.existingSourceQueries}`)
  console.log(`  Domain resolution (Tavily/Serper, NOT Bright Data): ~${est.domainResolutionQueriesRealistic} realistic, ${est.domainResolutionQueriesWorstCase} worst-case`)
  console.log(`  LinkedIn enrichment sample: ${est.linkedinLookups} lookups (${LINKEDIN_SAMPLE_PER_SECTOR}/sector) = ${est.linkedinSerpRequests} SERP + ${est.linkedinDatasetTriggers} dataset triggers`)
  console.log(`  ${C.bold}Total estimated Bright Data credit usage: ~${est.totalBrightDataBudgetUsedRealistic} (realistic) / ~${est.totalBrightDataBudgetUsedWorstCase} (worst case)${C.reset}`)
  console.log(`  ${C.bold}% of 5,000 free-tier budget: ~${est.percentOfFreeTierRealistic}% (realistic) / ~${est.percentOfFreeTierWorstCase}% (worst case)${C.reset}`)
  console.log(`\n  ${C.yellow}This is a DRY RUN — no requests were sent. Set GLOBAL_BENCHMARK_DRY_RUN=false to run live.${C.reset}`)
}

// ── Overlap (identity-key based, order-independent) ────────────────
export interface Overlap {
  shared: string[]
  existingOnly: string[]
  brightdataOnly: string[]
}

// Uses lib/companies/identity.ts's buildIdentityKeys — the SAME
// normalization/identity logic the real qualifyCandidate() pass uses —
// per the explicit "every source must go through the same identity
// logic" requirement, not a locally re-derived normalizer.
export function computeIdentityOverlap(existing: CompanyMatch[], brightdata: CompanyMatch[]): Overlap {
  const keyOf = (c: CompanyMatch) => {
    const k = buildIdentityKeys({ domain: c.domain, name: c.name })
    return k.domain ?? k.normalizedName
  }
  const existingMap = new Map(existing.map(c => [keyOf(c), c.name]))
  const bdMap = new Map(brightdata.map(c => [keyOf(c), c.name]))
  const shared: string[] = [], existingOnly: string[] = [], brightdataOnly: string[] = []
  for (const [key, name] of existingMap) (bdMap.has(key) ? shared : existingOnly).push(name)
  for (const [key, name] of bdMap) if (!existingMap.has(key)) brightdataOnly.push(name)
  return { shared, existingOnly, brightdataOnly }
}

// ── Cell result ─────────────────────────────────────────────────
interface CellResult {
  sector: TargetSector
  region: string
  source: 'existing' | 'brightdata'
  rawDiscovered: number
  totalMentions: number
  duplicateRateWithinSource: number
  megaCapRejected: number
  coarseSectorRejected: number
  coarseSizeRejected: number
  funnel: DiscoveryFunnel
  requestsUsed: number
  companies: CompanyMatch[]
  qualifiedCompanies: CompanyMatch[]
  qualificationErrors: number
}

function countRejectedByReason(result: CompanyDiscoveryResult, pattern: RegExp): number {
  return (result.rejected_candidates ?? []).filter(r => pattern.test(r.reason)).length
}

async function runCell(
  supabase: ReturnType<typeof createServerClient>,
  sector: TargetSector,
  region: string,
  regionQualifier: string,
  source: 'existing' | 'brightdata',
  brightDataSearchFn: SearchQueryFn,
): Promise<CellResult> {
  const queries = buildRegionQueries(sector, regionQualifier, QUERIES_PER_CELL)
  const label = `${getSectorPlaybook(sector).label} - ${region} - ${source}`

  let requestsBefore = 0
  if (source === 'brightdata') { resetBrightDataUsage(); requestsBefore = 0 }

  const result = await runDiscoveryCore(queries, undefined, sector, label, source === 'brightdata' ? brightDataSearchFn : undefined)
  const requestsUsed = source === 'brightdata' ? brightDataUsage.serpRequests : queries.length

  const funnel = emptyFunnel()
  recordDiscovered(funnel, result.companies.length)
  const qualifiedCompanies: CompanyMatch[] = []
  let qualificationErrors = 0
  for (const c of result.companies) {
    // A transient Supabase network blip must not take down the whole
    // 48-cell run (confirmed live 2026-08-19: it did, before this fix) —
    // same "retry once, then degrade gracefully rather than hard-fail"
    // discipline this codebase applies everywhere else network calls
    // happen. A candidate that still fails after one retry is skipped and
    // counted separately (qualificationErrors), never silently dropped.
    let outcome: Awaited<ReturnType<typeof qualifyCandidate>> | null = null
    for (let attempt = 0; attempt < 2 && !outcome; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2000))
      try {
        outcome = await qualifyCandidate(supabase, {
          name: c.name, domain: c.domain, snippets: [c.reason],
          discoverySource: c.discoverySource ?? source, discoveryQuery: c.discoveryQuery ?? region,
        }, sector)
      } catch (e) {
        console.warn(`  ${C.yellow}qualifyCandidate failed for "${c.name}" (attempt ${attempt + 1}/2): ${e instanceof Error ? e.message : String(e)}${C.reset}`)
      }
    }
    if (!outcome) { qualificationErrors++; continue }
    if (outcome.status === 'qualified') { recordQualified(funnel); qualifiedCompanies.push(c) }
    else if (outcome.reason) recordRejection(funnel, outcome.reason)
  }

  const totalMentions = result.total_mentions ?? result.candidates_considered
  return {
    sector, region, source,
    rawDiscovered: result.candidates_considered,
    totalMentions,
    duplicateRateWithinSource: totalMentions > 0 ? (totalMentions - result.candidates_considered) / totalMentions : 0,
    megaCapRejected: countRejectedByReason(result, /mega-cap/),
    coarseSectorRejected: countRejectedByReason(result, /outside target sector/),
    coarseSizeRejected: countRejectedByReason(result, /too large|too small/),
    funnel, requestsUsed,
    companies: result.companies,
    qualifiedCompanies,
    qualificationErrors,
  }
}

function emptyCellResult(sector: TargetSector, region: string, source: 'existing' | 'brightdata'): CellResult {
  return {
    sector, region, source, rawDiscovered: 0, totalMentions: 0, duplicateRateWithinSource: 0,
    megaCapRejected: 0, coarseSectorRejected: 0, coarseSizeRejected: 0,
    funnel: emptyFunnel(), requestsUsed: 0, companies: [], qualifiedCompanies: [], qualificationErrors: 0,
  }
}

// Defense in depth beyond runCell()'s own per-candidate retry — covers a
// failure in discovery itself (not just qualification), so one bad cell
// (out of 48) can't take down the whole run. Confirmed necessary live
// 2026-08-19: a transient Supabase fetch failure crashed the entire
// process at cell 2 before this fix existed.
async function runCellSafely(
  supabase: ReturnType<typeof createServerClient>,
  sector: TargetSector, region: string, qualifier: string,
  source: 'existing' | 'brightdata', brightDataSearchFn: SearchQueryFn,
): Promise<CellResult> {
  try {
    return await runCell(supabase, sector, region, qualifier, source, brightDataSearchFn)
  } catch (e) {
    console.error(`  ${C.red}Cell failed entirely (${sector}/${region}/${source}): ${e instanceof Error ? e.message : String(e)} — recorded as empty, continuing.${C.reset}`)
    return emptyCellResult(sector, region, source)
  }
}

function writeCheckpoint(outDir: string, timestamp: string, data: unknown): void {
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, `run-${timestamp}-partial.json`), JSON.stringify(data, null, 2))
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  const est = estimateCost()
  printEstimate(est)
  if (DRY_RUN) return

  const apiKey = getBrightDataApiKey()
  const zone = getBrightDataSerpZone()
  if (!apiKey || !zone) {
    console.error(`${C.red}BRIGHTDATA_API_KEY / BRIGHTDATA_SERP_ZONE not set — cannot run live.${C.reset}`)
    process.exit(1)
  }

  const supabase = createServerClient()
  const brightDataSearchFn: SearchQueryFn = async (query) => ({
    query, tier: 'brightdata', results: await searchBrightDataSerp(query, RESULTS_PER_QUERY),
  })

  const allCells: CellResult[] = []
  const overlapsByCell: Record<string, Overlap> = {}
  const enrichmentSamples: Array<{ company: string; sector: TargetSector; success: boolean; websiteMatch: boolean | null; fields: string[] }> = []
  const outDir = path.resolve(cwd, 'benchmarks/global-benchmark-results')
  const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-')

  for (const sector of SECTORS) {
    console.log(`\n${C.cyan}${C.bold}########## ${getSectorPlaybook(sector).label} ##########${C.reset}`)
    const sectorCells: CellResult[] = []

    for (const [region, qualifier] of Object.entries(REGIONS)) {
      console.log(`${C.bold}-- ${region} --${C.reset}`)

      const existingCell = await runCellSafely(supabase, sector, region, qualifier, 'existing', brightDataSearchFn)
      console.log(`  existing:   discovered=${existingCell.rawDiscovered} qualified=${existingCell.funnel.qualified} duplicate=${existingCell.funnel.duplicate} wrongSector=${existingCell.funnel.wrongSector} outsideSize=${existingCell.funnel.outsideSize} megaCap=${existingCell.megaCapRejected} requests=${existingCell.requestsUsed}${existingCell.qualificationErrors ? ` ${C.yellow}errors=${existingCell.qualificationErrors}${C.reset}` : ''}`)
      sectorCells.push(existingCell)
      allCells.push(existingCell)

      const bdCell = await runCellSafely(supabase, sector, region, qualifier, 'brightdata', brightDataSearchFn)
      console.log(`  brightdata: discovered=${bdCell.rawDiscovered} qualified=${bdCell.funnel.qualified} duplicate=${bdCell.funnel.duplicate} wrongSector=${bdCell.funnel.wrongSector} outsideSize=${bdCell.funnel.outsideSize} megaCap=${bdCell.megaCapRejected} requests=${bdCell.requestsUsed}${bdCell.qualificationErrors ? ` ${C.yellow}errors=${bdCell.qualificationErrors}${C.reset}` : ''}`)
      sectorCells.push(bdCell)
      allCells.push(bdCell)

      const overlap = computeIdentityOverlap(existingCell.companies, bdCell.companies)
      overlapsByCell[`${sector}:${region}`] = overlap
      console.log(`  overlap:    shared=${overlap.shared.length} existing-only=${overlap.existingOnly.length} brightdata-only=${C.green}${overlap.brightdataOnly.length}${C.reset}`)

      // Checkpoint after every cell — a late failure loses at most one
      // cell's worth of progress, not the whole run.
      writeCheckpoint(outDir, runTimestamp, {
        ranAt: new Date().toISOString(), status: 'in_progress', queriesPerCell: QUERIES_PER_CELL,
        cellsCompleted: allCells.length, cellsTotal: SECTORS.length * Object.keys(REGIONS).length * 2,
        cells: allCells.map(c => ({ ...c, companies: c.companies.map(x => x.name), qualifiedCompanies: c.qualifiedCompanies.map(x => x.name) })),
        overlapsByCell,
      })
    }

    // Small, deliberate LinkedIn enrichment sample — from this sector's
    // qualified pool across all regions, never looped over every company.
    const qualifiedPool = sectorCells.flatMap(c => c.qualifiedCompanies)
    const sample = qualifiedPool.slice(0, LINKEDIN_SAMPLE_PER_SECTOR)
    for (const c of sample) {
      const profile = await fetchBrightDataCompanyProfile(c.name)
      const fields = profile ? Object.entries(profile).filter(([k, v]) => k !== 'raw' && v !== undefined).map(([k]) => k) : []
      const websiteMatch = profile?.website && c.domain
        ? profile.website.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').includes(c.domain.toLowerCase())
        : null
      enrichmentSamples.push({ company: c.name, sector, success: !!profile, websiteMatch, fields })
      console.log(`  ${profile ? C.green + '✓' : C.dim + '✗'}${C.reset} LinkedIn: ${c.name} ${profile ? `(${fields.join(', ')})` : '(no match)'}`)
    }
  }

  // ── Aggregate ────────────────────────────────────────────────────
  function aggregate(cells: CellResult[], source: 'existing' | 'brightdata') {
    const filtered = cells.filter(c => c.source === source)
    return {
      rawDiscovered: filtered.reduce((s, c) => s + c.rawDiscovered, 0),
      megaCapRejected: filtered.reduce((s, c) => s + c.megaCapRejected, 0),
      coarseSectorRejected: filtered.reduce((s, c) => s + c.coarseSectorRejected, 0),
      coarseSizeRejected: filtered.reduce((s, c) => s + c.coarseSizeRejected, 0),
      funnel: filtered.reduce((f, c) => mergeFunnels(f, c.funnel), emptyFunnel()),
      requestsUsed: filtered.reduce((s, c) => s + c.requestsUsed, 0),
    }
  }

  console.log(`\n${C.bold}${C.cyan}=== TOTALS ===${C.reset}`)
  for (const sector of SECTORS) {
    const sectorCells = allCells.filter(c => c.sector === sector)
    const existingAgg = aggregate(sectorCells, 'existing')
    const bdAgg = aggregate(sectorCells, 'brightdata')
    console.log(`\n${C.bold}${getSectorPlaybook(sector).label}${C.reset}`)
    console.log(`  existing:   qualified=${existingAgg.funnel.qualified} duplicate=${existingAgg.funnel.duplicate} wrongSector=${existingAgg.funnel.wrongSector + existingAgg.coarseSectorRejected} outsideSize=${existingAgg.funnel.outsideSize + existingAgg.coarseSizeRejected + existingAgg.megaCapRejected} requests=${existingAgg.requestsUsed}`)
    console.log(`  brightdata: qualified=${bdAgg.funnel.qualified} duplicate=${bdAgg.funnel.duplicate} wrongSector=${bdAgg.funnel.wrongSector + bdAgg.coarseSectorRejected} outsideSize=${bdAgg.funnel.outsideSize + bdAgg.coarseSizeRejected + bdAgg.megaCapRejected} requests=${bdAgg.requestsUsed}`)
    const cost = COST_PER_REQUEST_USD !== null && bdAgg.funnel.qualified > 0
      ? `$${((bdAgg.requestsUsed * COST_PER_REQUEST_USD) / bdAgg.funnel.qualified).toFixed(3)}`
      : 'Cost not yet measurable'
    console.log(`  brightdata cost/qualified: ${cost}`)
  }

  // ── Persist ─────────────────────────────────────────────────────
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `run-${runTimestamp}.json`)
  fs.writeFileSync(outPath, JSON.stringify({
    ranAt: new Date().toISOString(),
    queriesPerCell: QUERIES_PER_CELL,
    regions: Object.keys(REGIONS),
    sectors: SECTORS,
    cells: allCells.map(c => ({ ...c, companies: c.companies.map(x => x.name), qualifiedCompanies: c.qualifiedCompanies.map(x => x.name) })),
    overlapsByCell,
    enrichmentSamples,
  }, null, 2))
  console.log(`\n${C.dim}Written: ${path.relative(cwd, outPath)}${C.reset}`)

  // Successful full completion — the per-cell checkpoint is superseded by
  // this final file, remove it rather than leave two files to reconcile.
  const partialPath = path.join(outDir, `run-${runTimestamp}-partial.json`)
  if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath)
}

// Guards main() from firing on `import` (e.g. tests/brightdata-global-
// comparison.test.ts importing the pure helpers above) — only runs when
// this file is the actual entrypoint (`npx tsx benchmarks/....ts`).
// Without this, importing the module for testing would trigger a real
// dry-run (or worse, a live run if GLOBAL_BENCHMARK_DRY_RUN=false was
// already set in the environment) as an import side effect.
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMainModule) {
  main().catch(e => { console.error(e); process.exit(1) })
}
