// ============================================================
// Fresh discovery benchmark — validates today's entity-classification /
// identity / qualification-scoring changes against real, live search
// results (not just the unit-test fixtures)
// ============================================================
// Deliberately narrower than benchmarks/brightdata-global-comparison.ts:
// existing sources only (no Bright Data — separate paid credits, not what
// this run is validating), 3 sectors x 3 representative regions x 4
// queries/cell = 36 discovery queries total, roughly 1/8 the cost of the
// full 8-region x 2-source comparison. Reuses the exact same production
// code path every real discovery route uses — runDiscoveryCore() +
// qualifyCandidate() against the real company_registry table (not an
// in-memory approximation) — so a qualified company here is a genuinely
// new, persistent seed row, same "this benchmark run doubles as real seed
// data" principle as the Bright Data comparison script.
//
// Audits every QUALIFIED company against classifyEntityType() directly
// (the new real classifier, not a re-implemented regex pattern list like
// the prior analyze-global-benchmark.ts's auditName()) — if today's fix is
// working, a genuinely qualified company should classify as COMPANY; any
// non-COMPANY classification surviving to "qualified" is a real bug to
// investigate, not expected/acceptable noise.
//
// Usage:
//   npx tsx benchmarks/fresh-discovery-benchmark.ts                 (dry run, default)
//   FRESH_BENCHMARK_DRY_RUN=false npx tsx benchmarks/fresh-discovery-benchmark.ts
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
import { runDiscoveryCore, type CompanyMatch } from '../lib/enrichment/company-discovery'
import { qualifyCandidate } from '../lib/enrichment/company-qualification'
import { emptyFunnel, recordDiscovered, recordQualified, recordRejection, mergeFunnels, type DiscoveryFunnel } from '../lib/enrichment/discovery-funnel'
import { classifyEntityType } from '../lib/enrichment/entity-classification'
import { sizeKnowledgeTierMetrics, resetSizeKnowledgeTierMetrics } from '../lib/enrichment/company-size'
import { createServerClient } from '../lib/supabase/server'

// Rough estimate only, same "good enough for relative comparison" caveat
// as lib/pipeline/research-metrics.ts's own PRICING_USD — a short system+
// user prompt (~150 input tokens) plus a capped 200-token response, at the
// same blended $0.3/M-token rate research-metrics.ts already uses for
// gemini-3.6-flash (the model this tier's live-verified calls actually
// used, per this session's earlier throwaway verification script).
const ESTIMATED_TOKENS_PER_KNOWLEDGE_CALL = 350
const GEMINI_PER_MILLION_TOKENS_USD = 0.3

const SECTORS: TargetSector[] = ['manufacturing', 'automotive', 'ecommerce']

// 3 regions, deliberately spanning distinct geographies (not 3 clustered
// ones) — enough to sanity-check the non-English-name path without paying
// for all 8 regions the full comparison benchmark covers.
const REGIONS: Record<string, string> = {
  'North America': 'in the United States',
  'South Asia': 'in South Asia',
  'Europe + UK': 'in Europe',
}

const QUERIES_PER_CELL = Number(process.env.FRESH_BENCHMARK_QUERIES_PER_CELL ?? 4)
const DRY_RUN = process.env.FRESH_BENCHMARK_DRY_RUN !== 'false'

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', red: '\x1b[31m' }

function buildRegionQueries(sector: TargetSector, regionQualifier: string, n: number): string[] {
  const terms = SECTOR_SEARCH_TERMS[sector].slice(0, n)
  return terms.map(t => `${t} ${regionQualifier}`)
}

interface CellResult {
  sector: TargetSector
  region: string
  rawDiscovered: number
  funnel: DiscoveryFunnel
  qualifiedCompanies: CompanyMatch[]
  rejectedSample: Array<{ name: string; reason: string }>
  qualificationErrors: number
}

async function runCell(
  supabase: ReturnType<typeof createServerClient>,
  sector: TargetSector, region: string, qualifier: string,
): Promise<CellResult> {
  const queries = buildRegionQueries(sector, qualifier, QUERIES_PER_CELL)
  const label = `${getSectorPlaybook(sector).label} - ${region}`
  const result = await runDiscoveryCore(queries, undefined, sector, label)

  const funnel = emptyFunnel()
  recordDiscovered(funnel, result.companies.length)
  const qualifiedCompanies: CompanyMatch[] = []
  let qualificationErrors = 0

  for (const c of result.companies) {
    let outcome: Awaited<ReturnType<typeof qualifyCandidate>> | null = null
    for (let attempt = 0; attempt < 2 && !outcome; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2000))
      try {
        outcome = await qualifyCandidate(supabase, {
          name: c.name, domain: c.domain, snippets: [c.reason],
          discoverySource: c.discoverySource ?? 'benchmark', discoveryQuery: c.discoveryQuery ?? region,
        }, sector)
      } catch (e) {
        console.warn(`  ${C.yellow}qualifyCandidate failed for "${c.name}" (attempt ${attempt + 1}/2): ${e instanceof Error ? e.message : String(e)}${C.reset}`)
      }
    }
    if (!outcome) { qualificationErrors++; continue }
    if (outcome.status === 'qualified') { recordQualified(funnel); qualifiedCompanies.push(c) }
    else if (outcome.reason) recordRejection(funnel, outcome.reason)
  }

  return {
    sector, region,
    rawDiscovered: result.candidates_considered,
    funnel, qualifiedCompanies, qualificationErrors,
    rejectedSample: (result.rejected_candidates ?? []).slice(0, 8),
  }
}

async function runCellSafely(supabase: ReturnType<typeof createServerClient>, sector: TargetSector, region: string, qualifier: string): Promise<CellResult> {
  try {
    return await runCell(supabase, sector, region, qualifier)
  } catch (e) {
    console.error(`  ${C.red}Cell failed entirely (${sector}/${region}): ${e instanceof Error ? e.message : String(e)} — recorded as empty, continuing.${C.reset}`)
    return { sector, region, rawDiscovered: 0, funnel: emptyFunnel(), qualifiedCompanies: [], rejectedSample: [], qualificationErrors: 0 }
  }
}

async function main() {
  const cells = SECTORS.length * Object.keys(REGIONS).length
  console.log(`${C.bold}${C.cyan}=== Fresh discovery benchmark ===${C.reset}`)
  console.log(`  Cells: ${cells} (${SECTORS.length} sectors x ${Object.keys(REGIONS).length} regions), ${QUERIES_PER_CELL} queries/cell = ${cells * QUERIES_PER_CELL} discovery queries`)
  console.log(`  Domain resolution: up to ~10 companies/cell x 2 search calls each (real cost, Tavily/Serper/Gemini)`)
  console.log(`  Every qualified company is written to the REAL company_registry table (persistent, not a dry-run table)`)

  if (DRY_RUN) {
    console.log(`\n  ${C.yellow}This is a DRY RUN — no requests were sent. Set FRESH_BENCHMARK_DRY_RUN=false to run live.${C.reset}`)
    return
  }

  resetSizeKnowledgeTierMetrics()
  const supabase = createServerClient()
  const allCells: CellResult[] = []
  const outDir = path.resolve(cwd, 'benchmarks/global-benchmark-results')
  const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-')

  for (const sector of SECTORS) {
    console.log(`\n${C.cyan}${C.bold}########## ${getSectorPlaybook(sector).label} ##########${C.reset}`)
    for (const [region, qualifier] of Object.entries(REGIONS)) {
      const cell = await runCellSafely(supabase, sector, region, qualifier)
      console.log(`${C.bold}-- ${region} --${C.reset} discovered=${cell.rawDiscovered} qualified=${cell.funnel.qualified} duplicate=${cell.funnel.duplicate} wrongSector=${cell.funnel.wrongSector} outsideSize=${cell.funnel.outsideSize} other=${cell.funnel.otherRejected}${cell.qualificationErrors ? ` ${C.yellow}errors=${cell.qualificationErrors}${C.reset}` : ''}`)
      if (cell.qualifiedCompanies.length > 0) {
        console.log(`  qualified: ${cell.qualifiedCompanies.map(c => c.name).join(', ')}`)
      }
      allCells.push(cell)

      fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(path.join(outDir, `fresh-run-${runTimestamp}-partial.json`), JSON.stringify({
        ranAt: new Date().toISOString(), status: 'in_progress',
        cells: allCells.map(c => ({ ...c, qualifiedCompanies: c.qualifiedCompanies.map(x => x.name) })),
      }, null, 2))
    }
  }

  // ── Entity-type audit — every qualified company should classify COMPANY.
  // Any other result reaching here is a real, live-observed bug, not
  // expected noise (unlike the old pattern-list audit, this checks against
  // the actual production classifier, so a mismatch here means the
  // classifier and the qualification gate disagree with each other).
  console.log(`\n${C.bold}${C.cyan}=== Entity-type audit of qualified companies ===${C.reset}`)
  let entityMismatches = 0
  for (const cell of allCells) {
    for (const c of cell.qualifiedCompanies) {
      const entity = classifyEntityType(c.name)
      if (entity.type !== 'COMPANY') {
        entityMismatches++
        console.log(`  ${C.red}MISMATCH${C.reset}: "${c.name}" qualified but classifyEntityType() says ${entity.type} (${entity.reason}) — ${cell.sector}/${cell.region}`)
      }
    }
  }
  console.log(entityMismatches === 0
    ? `  ${C.green}0 mismatches — every qualified company classifies as COMPANY.${C.reset}`
    : `  ${C.red}${entityMismatches} mismatch(es) found — see above.${C.reset}`)

  // ── Totals ──────────────────────────────────────────────────────
  console.log(`\n${C.bold}${C.cyan}=== TOTALS ===${C.reset}`)
  const totalFunnel = allCells.reduce((f, c) => mergeFunnels(f, c.funnel), emptyFunnel())
  console.log(`  discovered=${totalFunnel.discovered} qualified=${totalFunnel.qualified} duplicate=${totalFunnel.duplicate} alreadyResearched=${totalFunnel.alreadyResearched} alreadyOutreached=${totalFunnel.alreadyOutreached} wrongSector=${totalFunnel.wrongSector} outsideSize=${totalFunnel.outsideSize} other=${totalFunnel.otherRejected}`)
  const totalQualified = allCells.flatMap(c => c.qualifiedCompanies)
  console.log(`  All qualified companies (${totalQualified.length}): ${totalQualified.map(c => c.name).join(', ') || 'none'}`)

  // ── Knowledge-tier metrics (Phase 8, measured not assumed) ──────────
  console.log(`\n${C.bold}${C.cyan}=== AI size-knowledge tier metrics ===${C.reset}`)
  const m = sizeKnowledgeTierMetrics
  const rejectionRate = m.calls > 0 ? (m.rejections / m.calls) * 100 : 0
  const unknownRate = m.calls > 0 ? (m.unknowns / m.calls) * 100 : 0
  const callsPer100Discovered = totalFunnel.discovered > 0 ? (m.calls / totalFunnel.discovered) * 100 : 0
  const avgLatencyMs = m.calls > 0 ? Math.round(m.totalLatencyMs / m.calls) : 0
  const estimatedCostUsd = (m.calls * ESTIMATED_TOKENS_PER_KNOWLEDGE_CALL / 1_000_000) * GEMINI_PER_MILLION_TOKENS_USD
  console.log(`  Candidates entering knowledge tier: ${m.calls} (of ${totalFunnel.discovered} raw discovered = ${callsPer100Discovered.toFixed(1)} per 100)`)
  console.log(`  Rejection rate (scale=large): ${rejectionRate.toFixed(1)}% (${m.rejections}/${m.calls})`)
  console.log(`  Unknown/decline rate: ${unknownRate.toFixed(1)}% (${m.unknowns}/${m.calls})`)
  console.log(`  Avg latency per call: ${avgLatencyMs}ms (total: ${m.totalLatencyMs}ms)`)
  console.log(`  Estimated cost: ~$${estimatedCostUsd.toFixed(4)} (rough estimate, see script header)`)

  // ── Persist ─────────────────────────────────────────────────────
  const outPath = path.join(outDir, `fresh-run-${runTimestamp}.json`)
  fs.writeFileSync(outPath, JSON.stringify({
    ranAt: new Date().toISOString(),
    queriesPerCell: QUERIES_PER_CELL,
    regions: Object.keys(REGIONS),
    sectors: SECTORS,
    cells: allCells.map(c => ({ ...c, qualifiedCompanies: c.qualifiedCompanies.map(x => x.name) })),
    entityMismatches,
    sizeKnowledgeTierMetrics: { ...m, rejectionRate, unknownRate, callsPer100Discovered, avgLatencyMs, estimatedCostUsd },
  }, null, 2))
  console.log(`\n${C.dim}Written: ${path.relative(cwd, outPath)}${C.reset}`)

  const partialPath = path.join(outDir, `fresh-run-${runTimestamp}-partial.json`)
  if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath)
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMainModule) {
  main().catch(e => { console.error(e); process.exit(1) })
}
