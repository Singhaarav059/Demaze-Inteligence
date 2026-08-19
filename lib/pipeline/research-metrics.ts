// Per-request provider-call/cost instrumentation (plan §35: "Cost Instrumentation").
// Uses AsyncLocalStorage (Node stdlib) instead of threading a counter object through
// every scraper/discovery function signature — call sites just call recordMetric(),
// which is a no-op outside a runWithResearchMetrics() context (tests, scripts, a
// benchmark process that never wraps a request) rather than throwing, since
// instrumentation must never be able to break the pipeline it measures.
import { AsyncLocalStorage } from 'node:async_hooks'

export type ResearchMetrics = {
  firecrawlCalls: number
  firecrawlPages: number
  tavilyCalls: number
  serperCalls: number
  jinaCalls: number
  directFetchCalls: number
  geminiCalls: number
  geminiTokens: number
  nvidiaCalls: number
  nvidiaTokens: number
  cacheHits: number
  cacheMisses: number
}

function emptyMetrics(): ResearchMetrics {
  return {
    firecrawlCalls: 0, firecrawlPages: 0, tavilyCalls: 0, serperCalls: 0,
    jinaCalls: 0, directFetchCalls: 0, geminiCalls: 0, geminiTokens: 0,
    nvidiaCalls: 0, nvidiaTokens: 0, cacheHits: 0, cacheMisses: 0,
  }
}

const storage = new AsyncLocalStorage<ResearchMetrics>()

export function recordMetric(field: keyof ResearchMetrics, amount = 1): void {
  const m = storage.getStore()
  if (!m) return
  m[field] += amount
}

export function getCurrentResearchMetrics(): ResearchMetrics | null {
  return storage.getStore() ?? null
}

export function runWithResearchMetrics<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run(emptyMetrics(), fn)
}

// ponytail: flat per-unit USD estimates, not live vendor pricing lookups — re-check
// each provider's current pricing page (plan §16-19, §46) before trusting these for
// real budgeting. Good enough for relative before/after comparison in G1's baseline.
const PRICING_USD = {
  firecrawlPerPage: 0.0015,   // ~1 page ≈ 1 credit, $83/50k-credit tier
  tavilyPerCall: 0.008,       // ~1 search ≈ 1 credit, standard tier
  serperPerCall: 0.001,       // $50 / 50,000 queries
  geminiPerMillionTokens: 0.3,  // gemini-3.6-flash blended estimate
  nvidiaPerMillionTokens: 0.2,  // NIM-hosted open models, blended estimate
}

export function estimateCostUsd(m: ResearchMetrics): number {
  return (
    m.firecrawlPages * PRICING_USD.firecrawlPerPage +
    m.tavilyCalls * PRICING_USD.tavilyPerCall +
    m.serperCalls * PRICING_USD.serperPerCall +
    (m.geminiTokens / 1_000_000) * PRICING_USD.geminiPerMillionTokens +
    (m.nvidiaTokens / 1_000_000) * PRICING_USD.nvidiaPerMillionTokens
  )
}
