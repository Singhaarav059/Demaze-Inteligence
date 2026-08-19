import { describe, it, expect } from 'vitest'
import { runWithResearchMetrics, recordMetric, getCurrentResearchMetrics, estimateCostUsd } from '@/lib/pipeline/research-metrics'

describe('research-metrics', () => {
  it('is a no-op outside a run context', () => {
    recordMetric('firecrawlCalls')
    expect(getCurrentResearchMetrics()).toBeNull()
  })

  it('accumulates within a run context and stays isolated across concurrent runs', async () => {
    const [a, b] = await Promise.all([
      runWithResearchMetrics(async () => {
        recordMetric('firecrawlCalls')
        recordMetric('firecrawlPages', 3)
        await new Promise(r => setTimeout(r, 5))
        recordMetric('tavilyCalls')
        return getCurrentResearchMetrics()
      }),
      runWithResearchMetrics(async () => {
        recordMetric('serperCalls', 2)
        return getCurrentResearchMetrics()
      }),
    ])
    expect(a).toMatchObject({ firecrawlCalls: 1, firecrawlPages: 3, tavilyCalls: 1, serperCalls: 0 })
    expect(b).toMatchObject({ firecrawlCalls: 0, serperCalls: 2 })
  })

  it('estimates cost from page/call/token counts only', () => {
    const cost = estimateCostUsd({
      firecrawlCalls: 5, firecrawlPages: 10, tavilyCalls: 4, serperCalls: 2,
      jinaCalls: 1, directFetchCalls: 3, geminiCalls: 1, geminiTokens: 1_000_000,
      nvidiaCalls: 0, nvidiaTokens: 0, cacheHits: 0, cacheMisses: 0,
    })
    expect(cost).toBeCloseTo(10 * 0.0015 + 4 * 0.008 + 2 * 0.001 + 0.3, 5)
  })
})
