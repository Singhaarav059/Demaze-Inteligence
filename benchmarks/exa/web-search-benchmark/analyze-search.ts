// ============================================================
// Search snapshot analysis — normalization + objective proxy scoring
// ============================================================
// Reads the raw search-snapshot JSON (large, provider-shaped) and produces
// a compact, uniform normalized-results file plus aggregate stats. This is
// analysis tooling, not part of the benchmark's live-call path — run after
// run-search-benchmark.ts, offline, no API calls.
//
// Uses discovery-engine.ts's OWN classifySourceType()/SOURCE_STRENGTH map
// (the exact same taxonomy the live pipeline uses to value a Tavily/Serper
// result) as an objective, codebase-native proxy signal, applied uniformly
// to Tavily/Serper/Exa results alike — not a new scoring system invented to
// favor either provider.
//
// Run: npx tsx benchmarks/exa/web-search-benchmark/analyze-search.ts <snapshot-file>
// ============================================================

import fs from 'fs'
import path from 'path'
import { classifySourceType, SOURCE_STRENGTH_EXPORT_SHIM } from './source-type-shim'

interface RawRecord {
  company: string
  vertical: string
  module: string
  category: string
  query: string
  provider: string
  latencyMs: number
  ok: boolean
  error: string | null
  resultCount: number
  costDollars?: number
  raw: unknown
}

interface NormalizedResult {
  url: string
  title: string
  snippet: string
  sourceType: string
  evidenceStrength: string
  isOwnDomain: boolean
}

interface NormalizedRecord {
  company: string
  module: string
  category: string
  query: string
  provider: string
  latencyMs: number
  ok: boolean
  resultCount: number
  costDollars?: number
  results: NormalizedResult[]
}

const DOMAIN_BY_COMPANY: Record<string, string> = {
  'Ador Welding': 'adorwelding.com',
  'Bharat Forge': 'bharatforge.com',
  Chargebee: 'chargebee.com',
  'Muthoot Finance': 'muthootfinance.com',
}

function normalizeTavilySerper(raw: unknown): { url: string; title: string; snippet: string }[] {
  if (!Array.isArray(raw)) return []
  return raw.map((r: any) => ({ url: r.url ?? '', title: r.title ?? '', snippet: (r.content ?? '').slice(0, 300) }))
}

function normalizeExa(raw: unknown): { url: string; title: string; snippet: string }[] {
  const results = (raw as any)?.results
  if (!Array.isArray(results)) return []
  return results.map((r: any) => ({
    url: r.url ?? '',
    title: r.title ?? '',
    snippet: (r.text ?? (r.highlights ?? []).join(' ') ?? r.summary ?? '').slice(0, 300),
  }))
}

function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: analyze-search.ts <snapshot-file>')
    process.exit(1)
  }
  const raw: RawRecord[] = JSON.parse(fs.readFileSync(file, 'utf-8'))

  const normalized: NormalizedRecord[] = raw.map((r) => {
    const items = r.provider === 'exa' || r.provider === 'exa-fast' ? normalizeExa(r.raw) : normalizeTavilySerper(r.raw)
    const domain = DOMAIN_BY_COMPANY[r.company] ?? ''
    const results: NormalizedResult[] = items.map((it) => {
      const sourceType = classifySourceType(it.url, it.title)
      return {
        url: it.url,
        title: it.title,
        snippet: it.snippet,
        sourceType,
        evidenceStrength: SOURCE_STRENGTH_EXPORT_SHIM[sourceType] ?? 'low',
        isOwnDomain: !!domain && it.url.includes(domain),
      }
    })
    return {
      company: r.company,
      module: r.module,
      category: r.category,
      query: r.query,
      provider: r.provider,
      latencyMs: r.latencyMs,
      ok: r.ok,
      resultCount: r.resultCount,
      costDollars: r.costDollars,
      results,
    }
  })

  const outPath = file.replace('search-snapshot-', 'search-normalized-')
  fs.writeFileSync(outPath, JSON.stringify(normalized, null, 2))
  console.log(`Normalized ${normalized.length} records -> ${outPath}`)

  // ── Aggregate stats by provider ────────────────────────────────────
  const byProvider = new Map<string, { queries: number; totalResults: number; strengthCounts: Record<string, number>; totalLatency: number; totalCost: number; zeroResultQueries: number }>()
  for (const rec of normalized) {
    if (!byProvider.has(rec.provider)) {
      byProvider.set(rec.provider, { queries: 0, totalResults: 0, strengthCounts: {}, totalLatency: 0, totalCost: 0, zeroResultQueries: 0 })
    }
    const agg = byProvider.get(rec.provider)!
    agg.queries++
    agg.totalResults += rec.resultCount
    agg.totalLatency += rec.latencyMs
    agg.totalCost += rec.costDollars ?? 0
    if (rec.resultCount === 0) agg.zeroResultQueries++
    for (const res of rec.results) {
      agg.strengthCounts[res.evidenceStrength] = (agg.strengthCounts[res.evidenceStrength] ?? 0) + 1
    }
  }

  console.log('\n=== Aggregate by provider (main run + mode comparison + cache check, ALL rows) ===')
  for (const [provider, agg] of byProvider) {
    console.log(`\n${provider}:`)
    console.log(`  queries: ${agg.queries}, zero-result: ${agg.zeroResultQueries} (${(100 * agg.zeroResultQueries / agg.queries).toFixed(1)}%)`)
    console.log(`  total results: ${agg.totalResults}, avg/query: ${(agg.totalResults / agg.queries).toFixed(2)}`)
    console.log(`  avg latency: ${(agg.totalLatency / agg.queries).toFixed(0)}ms`)
    console.log(`  total cost: $${agg.totalCost.toFixed(4)}`)
    console.log(`  evidence-strength distribution: ${JSON.stringify(agg.strengthCounts)}`)
  }

  // ── By module (evidence_discovery / icp / competitor / market_intel) ──
  console.log('\n=== By module x provider (main run only) ===')
  const byModuleProvider = new Map<string, { queries: number; totalResults: number; veryHighOrHigh: number }>()
  for (const rec of normalized) {
    if (rec.module === 'mode_comparison' || rec.module === 'cache_hit_check') continue
    const key = `${rec.module}|${rec.provider}`
    if (!byModuleProvider.has(key)) byModuleProvider.set(key, { queries: 0, totalResults: 0, veryHighOrHigh: 0 })
    const agg = byModuleProvider.get(key)!
    agg.queries++
    agg.totalResults += rec.resultCount
    agg.veryHighOrHigh += rec.results.filter(r => r.evidenceStrength === 'very_high' || r.evidenceStrength === 'high').length
  }
  for (const [key, agg] of [...byModuleProvider.entries()].sort()) {
    console.log(`  ${key}: ${agg.queries} queries, ${agg.totalResults} results, ${agg.veryHighOrHigh} high/very-high-strength (${(100 * agg.veryHighOrHigh / Math.max(1, agg.totalResults)).toFixed(1)}%)`)
  }

  // ── Domain overlap between providers, per query (main run only) ───────
  console.log('\n=== Cross-provider domain overlap (main run, per query-group) ===')
  const byQueryKey = new Map<string, Map<string, Set<string>>>()
  for (const rec of normalized) {
    if (rec.module === 'mode_comparison' || rec.module === 'cache_hit_check') continue
    const key = `${rec.company}|${rec.query}`
    if (!byQueryKey.has(key)) byQueryKey.set(key, new Map())
    const providers = byQueryKey.get(key)!
    const domains = new Set(rec.results.map(r => { try { return new URL(r.url).hostname.replace(/^www\./, '') } catch { return r.url } }))
    providers.set(rec.provider, domains)
  }
  let totalGroups = 0
  let anyOverlapGroups = 0
  let tavilyExaOverlapSum = 0
  let serperExaOverlapSum = 0
  for (const [, providers] of byQueryKey) {
    const tavily = providers.get('tavily') ?? new Set()
    const serper = providers.get('serper') ?? new Set()
    const exa = providers.get('exa') ?? new Set()
    totalGroups++
    const tavilyExaOverlap = [...tavily].filter(d => exa.has(d)).length
    const serperExaOverlap = [...serper].filter(d => exa.has(d)).length
    tavilyExaOverlapSum += tavilyExaOverlap
    serperExaOverlapSum += serperExaOverlap
    if (tavilyExaOverlap > 0 || serperExaOverlap > 0) anyOverlapGroups++
  }
  console.log(`  ${totalGroups} query-groups compared`)
  console.log(`  avg Tavily∩Exa domain overlap per query: ${(tavilyExaOverlapSum / totalGroups).toFixed(2)}`)
  console.log(`  avg Serper∩Exa domain overlap per query: ${(serperExaOverlapSum / totalGroups).toFixed(2)}`)
  console.log(`  query-groups with ANY cross-provider domain overlap: ${anyOverlapGroups}/${totalGroups} (${(100 * anyOverlapGroups / totalGroups).toFixed(1)}%)`)

  // ── Cache hit check (Phase 5) ──────────────────────────────────────
  console.log('\n=== Cache check: first occurrence vs cache_hit_check re-run (Ador Welding, first 5 queries) ===')
  const firstRun = normalized.filter(r => r.module !== 'cache_hit_check' && r.company === 'Ador Welding' && r.provider === 'tavily').slice(0, 5)
  const cacheRun = normalized.filter(r => r.module === 'cache_hit_check' && r.provider === 'tavily')
  for (let i = 0; i < cacheRun.length; i++) {
    const first = firstRun[i]
    const second = cacheRun[i]
    const sameUrls = first && second && JSON.stringify(first.results.map(r => r.url)) === JSON.stringify(second.results.map(r => r.url))
    console.log(`  "${second.query}": first=${first?.latencyMs}ms, rerun=${second.latencyMs}ms, identical URL set=${sameUrls}`)
  }
}

main()
