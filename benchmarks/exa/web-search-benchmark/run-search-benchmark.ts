// ============================================================
// Exa Search vs Tavily — real research-query benchmark
// ============================================================
// Phase 1-6 of the web-research-stack audit (benchmarks/exa/PROVIDER_AUDIT.md
// §8). Data-collection ONLY, same discipline as provider-benchmark.ts — this
// script makes real, credit-spending calls and dumps a raw snapshot; it does
// not classify relevance or write the report. Judgment calls (is this result
// actually useful evidence?) are made by hand against the snapshot afterward.
//
// Serper was part of this comparison in the original 2026-09-01 run (see
// search-snapshot-2026-09-01T05-50-47-338Z.json and
// WEB_RESEARCH_BENCHMARK_REPORT.md) — its account turned out to be out of
// credits at the time. It has since been removed from the product entirely
// (docs/DECISIONS.md), so this script no longer calls it; a re-run only
// compares Tavily vs Exa.
//
// Run: npm run benchmark:exa:web:search
// Requires EXA_API_KEY, TAVILY_API_KEY. Never run as part of `npm test`/
// `vitest` — explicitly opt-in, same as every other benchmarks/ script in
// this repo.
//
// Cache safety: production's searchTavily() defaults to maxResults=3 and
// caches by the exact (provider, query, maxResults) triple in the LIVE
// search_query_cache Supabase table. This benchmark deliberately uses
// maxResults=5 for every call so it can never read or overwrite a real
// production cache row for the same query — it still exercises the real
// caching code path (a genuine write, then a genuine read-back), just under
// a key production never uses. Nothing about the cache implementation is
// touched.
// ============================================================

import { config as loadDotenv } from 'dotenv'
import path from 'path'
import fs from 'fs'

const cwd = process.cwd()
loadDotenv({ path: path.resolve(cwd, '.env.local') })
loadDotenv({ path: path.resolve(cwd, '.env') })

import { searchTavily } from '../../../lib/enrichment/discovery-engine'
import { exaSearch } from '../../../lib/enrichment/sources/exa-client'
import { BENCHMARK_COMPANIES } from './companies'
import { allQueriesForCompany } from './query-templates'

// Distinct from production's default of 3 — see header comment.
const BENCHMARK_MAX_RESULTS = 5

interface CallRecord {
  company: string
  vertical: string
  module: string
  category: string
  query: string
  provider: 'tavily' | 'serper' | 'exa' | 'exa-fast'
  latencyMs: number
  ok: boolean
  error: string | null
  resultCount: number
  costDollars?: number
  raw: unknown
}

const records: CallRecord[] = []

async function call(
  base: Omit<CallRecord, 'latencyMs' | 'ok' | 'error' | 'resultCount' | 'raw' | 'costDollars'>,
  fn: () => Promise<{ count: number; cost?: number; raw: unknown }>,
): Promise<void> {
  const start = Date.now()
  try {
    const { count, cost, raw } = await fn()
    const latencyMs = Date.now() - start
    records.push({ ...base, latencyMs, ok: true, error: null, resultCount: count, costDollars: cost, raw })
    console.log(`[${base.provider}/${base.module}] ${base.company} :: ${base.query.slice(0, 60)} — ${latencyMs}ms — ${count} result(s)`)
  } catch (e) {
    const latencyMs = Date.now() - start
    const error = e instanceof Error ? e.message : String(e)
    records.push({ ...base, latencyMs, ok: false, error, resultCount: 0, raw: null })
    console.log(`[${base.provider}/${base.module}] ${base.company} :: ${base.query.slice(0, 60)} — ${latencyMs}ms — ERROR: ${error}`)
  }
}

// Concurrency cap of 3, same shape as discoverEvidenceSources()'s own
// chunking — real-world-representative pacing, not just "as fast as possible".
async function runChunked<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn))
  }
}

async function main() {
  const tavilyKey = process.env.TAVILY_API_KEY
  const exaKey = process.env.EXA_API_KEY
  if (!tavilyKey || !exaKey) {
    console.error('TAVILY_API_KEY and EXA_API_KEY must both be set. Aborting — no live calls made.')
    process.exit(1)
  }

  console.log(`\n=== Main run: ${BENCHMARK_COMPANIES.length} companies x full real query set x 2 providers ===`)
  for (const company of BENCHMARK_COMPANIES) {
    const queries = allQueriesForCompany(company.name)
    console.log(`\n--- ${company.name} (${company.vertical}) — ${queries.length} queries ---`)

    await runChunked(queries, 3, async (q) => {
      const base = { company: company.name, vertical: company.vertical, module: (q as any).module ?? 'unknown', category: q.category, query: q.query }

      await call({ ...base, provider: 'tavily' }, async () => {
        const r = await searchTavily(q.query, tavilyKey, BENCHMARK_MAX_RESULTS)
        return { count: r.length, raw: r }
      })

      // Phase 4: cheapest sensible Exa configuration — 'auto' type, no
      // domain/date filters (none of these 4 query builders need them —
      // e.g. the year is already folded into the query text itself, not
      // expressed as a startPublishedDate filter production doesn't use
      // either).
      await call({ ...base, provider: 'exa' }, async () => {
        const r = await exaSearch({ query: q.query, type: 'auto', numResults: BENCHMARK_MAX_RESULTS }, exaKey)
        return { count: r.results.length, cost: r.costDollars?.total, raw: r }
      })
    })
  }

  // ── Phase 4b: Exa search-mode comparison (auto vs fast) ──────────────
  // Small, separate, targeted block — not run for every query (cost
  // discipline). 2 queries x 2 companies = 4 queries, each run under both
  // modes.
  console.log('\n=== Phase 4b: Exa auto vs fast mode (4 queries) ===')
  const modeCompanies = BENCHMARK_COMPANIES.slice(0, 2)
  for (const company of modeCompanies) {
    const sample = allQueriesForCompany(company.name).slice(0, 2)
    for (const q of sample) {
      const base = { company: company.name, vertical: company.vertical, module: 'mode_comparison', category: q.category, query: q.query }
      await call({ ...base, provider: 'exa' }, async () => {
        const r = await exaSearch({ query: q.query, type: 'auto', numResults: BENCHMARK_MAX_RESULTS }, exaKey)
        return { count: r.results.length, cost: r.costDollars?.total, raw: r }
      })
      await call({ ...base, provider: 'exa-fast' }, async () => {
        const r = await exaSearch({ query: q.query, type: 'fast', numResults: BENCHMARK_MAX_RESULTS }, exaKey)
        return { count: r.results.length, cost: r.costDollars?.total, raw: r }
      })
    }
  }

  // ── Phase 5: cold vs cache-hit ────────────────────────────────────────
  // Re-run 5 already-executed (query, maxResults=5) pairs a second time —
  // the FIRST call above already wrote them to search_query_cache; this
  // second call should read that row back rather than hitting the network.
  // Uses the real, unmodified searchTavily/searchSerper cache code path.
  console.log('\n=== Phase 5: cache cold vs hit (5 queries re-run) ===')
  const cacheSample = allQueriesForCompany(BENCHMARK_COMPANIES[0].name).slice(0, 5)
  for (const q of cacheSample) {
    const base = { company: BENCHMARK_COMPANIES[0].name, vertical: BENCHMARK_COMPANIES[0].vertical, module: 'cache_hit_check', category: q.category, query: q.query }
    await call({ ...base, provider: 'tavily' }, async () => {
      const r = await searchTavily(q.query, tavilyKey, BENCHMARK_MAX_RESULTS)
      return { count: r.length, raw: r }
    })
  }

  const outDir = path.resolve(cwd, 'benchmarks/exa/web-search-benchmark')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `search-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(outPath, JSON.stringify(records, null, 2))

  const errors = records.filter(r => !r.ok)
  console.log(`\n${records.length} calls total, ${errors.length} error(s).`)
  console.log(`Snapshot written to ${outPath}`)
}

main()
