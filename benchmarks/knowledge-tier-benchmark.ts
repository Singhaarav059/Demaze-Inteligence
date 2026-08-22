// ============================================================
// Knowledge-tier benchmark — measures assessCompanySizeViaKnowledge()'s
// real recall (mega-caps) and false-rejection rate (legitimate SMEs)
// ============================================================
// Built 2026-08-21 per the qualification-system audit's Priority 5/6: the
// mega-cap list company-discovery.ts's KNOWN_MEGA_CAP_NAMES has already
// proven is "the wrong long-term strategy, reactive by nature" — this
// benchmark measures the AI-knowledge tier's REAL performance instead of
// growing that list further. Nothing here is wired into production
// qualification logic; these are benchmark fixtures only, same "do not
// hardcode into production" discipline the governing task explicitly
// required.
//
// Two fixture sets, cheap to run (one LLM call per name, no search API
// calls — unlike fresh-discovery-benchmark.ts, which spends real
// Tavily/Serper quota on live discovery too):
//   - MEGA_CAP_FIXTURES: real, large, well-known companies across
//     manufacturing/automotive/ecommerce and multiple regions — includes
//     every name the qualification-system audit found the knowledge tier
//     missing live (Lear, Bilfinger Tebodin, etc.), verbatim, so this
//     benchmark can actually catch a regression on them.
//   - SME_FIXTURES: realistic-but-synthetic mid-market company names
//     (same naming convention as tests/company-qualification.test.ts's own
//     fixtures — "Meridian Precision Components" etc.) — deliberately NOT
//     real obscure companies, since fabricating an assumption about a real
//     company's actual size would be worse than an honest, clearly-labeled
//     synthetic name. A synthetic name the LLM has never seen is the
//     purest test of "does the knowledge tier ever hallucinate confidence
//     about a company it cannot possibly know" — any 'too_large' verdict
//     on one of these is unambiguously a false rejection, not a judgment
//     call about a real company's true scale.
//
// The desired safety property (explicitly, from the governing task):
//   uncertain -> unknown
//   confidently large -> too_large
// This benchmark measures how well that property holds — it does NOT
// exist to push toward 100% mega-cap recall by loosening the "only answer
// when confident" instruction in assessCompanySizeViaKnowledge()'s own
// prompt (lib/enrichment/company-size.ts). A rising unknown rate on real
// mega-caps is a real, honest measurement, not a bug to paper over.
//
// Usage:
//   npx tsx benchmarks/knowledge-tier-benchmark.ts                       (dry run, default)
//   KNOWLEDGE_BENCHMARK_DRY_RUN=false npx tsx benchmarks/knowledge-tier-benchmark.ts
// ============================================================

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { config as loadDotenv } from 'dotenv'

const cwd = process.cwd()
loadDotenv({ path: path.resolve(cwd, '.env.local') })
loadDotenv({ path: path.resolve(cwd, '.env') })

import { classifyEntityType } from '../lib/enrichment/entity-classification'
import {
  assessCompanySizeViaKnowledge, sizeKnowledgeTierMetrics, resetSizeKnowledgeTierMetrics,
} from '../lib/enrichment/company-size'

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', red: '\x1b[31m' }

// Verbatim from the qualification-system audit's own list, plus a modest
// spread of additional well-known names across manufacturing/automotive/
// ecommerce and regions the task asked this benchmark to cover.
const MEGA_CAP_FIXTURES = [
  'BMW', 'Audi', 'Mini', 'Porsche', 'Volvo', 'Jaguar', 'Land Rover',
  'Maruti Suzuki', 'JCB', 'Tencent', 'Jacobs Solutions', 'Fluor',
  'Murata Manufacturing', 'Murata Vietnam', 'Robert Bosch GmbH',
  "O'Reilly Automotive", 'Lear', 'Bilfinger Tebodin',
  // Additional spread — real, well-known, distinct sector/region coverage.
  'Samsung Electronics', 'Siemens AG', 'Foxconn', 'Nestle', 'JD.com',
  'Reliance Retail', 'SAIC Motor', 'Schneider Electric',
]

// Realistic-but-synthetic mid-market names — see header for why these,
// not real obscure companies. One per active sector, spread across
// regions this repo's own discovery benchmark already targets.
const SME_FIXTURES = [
  'Meridian Precision Components',       // manufacturing, generic
  'Alden Auto Components',               // automotive
  'Northgate Marketplace',               // ecommerce
  'Sundaram Forge Industries',           // manufacturing, South Asia
  'Volten Auto Parts GmbH',              // automotive, Europe
  'Kestrel Retail Group',                // ecommerce, UK
  'Pacific Rim Fabrication Works',       // manufacturing, SE Asia
  'Highland Drivetrain Systems',         // automotive, US
  'Coral Bay Commerce Ltd',              // ecommerce, SE Asia
  'Ironbridge Metal Works',              // manufacturing, UK
  'Delta Valley Auto Suppliers',         // automotive, South Asia
  'Riverstone Retail Holdings',          // ecommerce, US
]

interface FixtureOutcome {
  name: string
  entityType: string
  verdict: 'too_large' | 'unknown'
  reasoning: string
}

async function runFixtureSet(names: string[]): Promise<FixtureOutcome[]> {
  const out: FixtureOutcome[] = []
  for (const name of names) {
    const entity = classifyEntityType(name)
    const size = await assessCompanySizeViaKnowledge(name)
    out.push({ name, entityType: entity.type, verdict: size.verdict === 'too_large' ? 'too_large' : 'unknown', reasoning: size.reason })
  }
  return out
}

async function main() {
  console.log(`${C.bold}${C.cyan}=== Knowledge-tier benchmark ===${C.reset}`)
  console.log(`  Mega-cap fixtures: ${MEGA_CAP_FIXTURES.length}, SME fixtures: ${SME_FIXTURES.length}`)
  console.log(`  ${MEGA_CAP_FIXTURES.length + SME_FIXTURES.length} LLM calls total, no search API cost`)

  const dryRun = process.env.KNOWLEDGE_BENCHMARK_DRY_RUN !== 'false'
  if (dryRun) {
    console.log(`\n  ${C.yellow}This is a DRY RUN — no LLM calls were made. Set KNOWLEDGE_BENCHMARK_DRY_RUN=false to run live.${C.reset}`)
    return
  }

  resetSizeKnowledgeTierMetrics()
  const startedAt = Date.now()

  console.log(`\n${C.bold}${C.cyan}=== Mega-cap recall ===${C.reset}`)
  const megaResults = await runFixtureSet(MEGA_CAP_FIXTURES)
  for (const r of megaResults) {
    const ok = r.verdict === 'too_large'
    console.log(`  ${ok ? C.green + 'REJECTED' : C.red + 'UNKNOWN '}${C.reset} ${r.name} — ${r.reasoning}`)
  }
  const megaRejected = megaResults.filter(r => r.verdict === 'too_large').length
  const megaUnknown = megaResults.length - megaRejected
  const megaRecall = (megaRejected / megaResults.length) * 100

  console.log(`\n${C.bold}${C.cyan}=== SME false-rejection rate ===${C.reset}`)
  const smeResults = await runFixtureSet(SME_FIXTURES)
  for (const r of smeResults) {
    const ok = r.verdict === 'unknown'
    console.log(`  ${ok ? C.green + 'PRESERVED' : C.red + 'REJECTED '}${C.reset} ${r.name} — ${r.reasoning}`)
  }
  const smeFalselyRejected = smeResults.filter(r => r.verdict === 'too_large').length
  const smePreserved = smeResults.length - smeFalselyRejected
  const smeFalseRejectionRate = (smeFalselyRejected / smeResults.length) * 100

  console.log(`\n${C.bold}${C.cyan}=== TOTALS ===${C.reset}`)
  console.log(`  Mega-cap recall: ${megaRecall.toFixed(1)}% (${megaRejected}/${megaResults.length} correctly rejected, ${megaUnknown} unknown)`)
  console.log(`  SME false-rejection rate: ${smeFalseRejectionRate.toFixed(1)}% (${smeFalselyRejected}/${smeResults.length} incorrectly rejected, ${smePreserved} correctly preserved)`)

  const m = sizeKnowledgeTierMetrics
  const totalMs = Date.now() - startedAt
  const avgLatencyMs = m.calls > 0 ? Math.round(m.totalLatencyMs / m.calls) : 0
  // Same rough per-call cost estimate as fresh-discovery-benchmark.ts (see
  // that script's header for the basis) — for relative comparison only.
  const ESTIMATED_TOKENS_PER_CALL = 350
  const GEMINI_PER_MILLION_TOKENS_USD = 0.3
  const estimatedCostUsd = (m.calls * ESTIMATED_TOKENS_PER_CALL / 1_000_000) * GEMINI_PER_MILLION_TOKENS_USD
  console.log(`\n${C.bold}${C.cyan}=== Cost/latency ===${C.reset}`)
  console.log(`  Calls: ${m.calls}, avg latency: ${avgLatencyMs}ms, wall time: ${totalMs}ms`)
  console.log(`  Estimated cost: ~$${estimatedCostUsd.toFixed(4)} (rough estimate)`)

  const outDir = path.resolve(cwd, 'benchmarks/global-benchmark-results')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `knowledge-tier-run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(outPath, JSON.stringify({
    ranAt: new Date().toISOString(),
    megaCap: { fixtures: MEGA_CAP_FIXTURES.length, rejected: megaRejected, unknown: megaUnknown, recallPct: megaRecall, results: megaResults },
    sme: { fixtures: SME_FIXTURES.length, falselyRejected: smeFalselyRejected, preserved: smePreserved, falseRejectionRatePct: smeFalseRejectionRate, results: smeResults },
    latency: { avgLatencyMs, totalMs, calls: m.calls, estimatedCostUsd },
  }, null, 2))
  console.log(`\n${C.dim}Written: ${path.relative(cwd, outPath)}${C.reset}`)
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMainModule) {
  main().catch(e => { console.error(e); process.exit(1) })
}
