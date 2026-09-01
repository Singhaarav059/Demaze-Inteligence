// ============================================================
// searchFallbackScrape() — real Firecrawl v2 /search response shape (2026-09-01)
// ============================================================
// Regression for a real, live bug found via the web-research benchmark
// (see docs/DECISIONS.md, benchmarks/exa/web-search-benchmark/
// WEB_RESEARCH_BENCHMARK_REPORT.md §12 bug #2): searchFallbackScrape()
// checked `Array.isArray(res?.data)` first, assuming an old v1-shaped
// `{ data: [...] }` response. The installed @mendable/firecrawl-js's real
// v2 `search()` (node_modules/@mendable/firecrawl-js/dist/index.js) groups
// results under `.web`/`.news`/`.images` directly and defines `.data` as a
// GETTER THAT THROWS on access, specifically to catch this exact mistake.
// Merely evaluating `res?.data` triggered the throw, which silently broke
// this whole fallback path in production — confirmed live against Muthoot
// Finance, whose entire scrape depends on it.
//
// This fake client's `.search()` mirrors the REAL SDK object shape,
// including the throwing `.data` getter — a test built directly against
// `{ web: [...] }` alone wouldn't actually prove the old code was broken;
// this proves both that the old check would have thrown and that the fix
// no longer touches it.
// ============================================================

import { describe, it, expect } from 'vitest'
import { searchFallbackScrape } from '../lib/pipeline/scraper'
import type Firecrawl from '@mendable/firecrawl-js'

interface RealShapedSearchResult {
  url: string
  title?: string
  description?: string
  markdown?: string
}

// Builds an object matching the real SDK's `search()` return value exactly
// (see the source excerpt in the header comment above) — a plain object
// with `.web`/`.news`/`.images` arrays and a non-enumerable `.data` getter
// that throws when accessed.
function realShapedSearchResponse(web: RealShapedSearchResult[], news: RealShapedSearchResult[] = []) {
  const out: Record<string, unknown> = {}
  if (web.length) out.web = web
  if (news.length) out.news = news
  Object.defineProperty(out, 'data', {
    get() {
      const parts: string[] = []
      if (web.length) parts.push(`.web (${web.length} results)`)
      if (news.length) parts.push(`.news (${news.length} results)`)
      throw new Error(`SearchData has no '.data'. Results are grouped by source: ${parts.join(', ') || '.web, .news, or .images'}`)
    },
    enumerable: false,
    configurable: true,
  })
  return out
}

function fakeClient(searchImpl: (query: string, opts: Record<string, unknown>) => Promise<unknown>): Firecrawl {
  return { search: searchImpl } as unknown as Firecrawl
}

describe('searchFallbackScrape — real Firecrawl v2 search response shape', () => {
  it('extracts results from `.web` without ever touching the throwing `.data` getter', async () => {
    const client = fakeClient(async () =>
      realShapedSearchResponse([
        {
          url: 'https://example.com/about',
          title: 'Example Corp',
          markdown: 'A'.repeat(150), // above the 100-char MIN_USEFUL_CHARS-style floor this function applies
        },
      ])
    )

    const result = await searchFallbackScrape(client, 'https://example.com')

    expect(result).not.toBeNull()
    expect(result!.successfulUrls).toContain('https://example.com/about')
    expect(result!.debug.warnings.some(w => /Search query failed/.test(w))).toBe(false)
  })

  it('falls back to `.news` when `.web` is absent', async () => {
    const client = fakeClient(async () =>
      realShapedSearchResponse([], [
        { url: 'https://news.example.com/story', markdown: 'B'.repeat(150) },
      ])
    )

    const result = await searchFallbackScrape(client, 'https://example.com')

    expect(result).not.toBeNull()
    expect(result!.successfulUrls).toContain('https://news.example.com/story')
  })

  it('returns null (not a crash) when the search call throws for every query — the pre-fix symptom', async () => {
    // Simulates the OLD code's behavior for context: if this function still
    // evaluated `res?.data`, every call would throw here and every query
    // would land in the catch block, producing zero pages. The regression
    // this guards is that the NEW code does NOT do that for a real `.web`-
    // shaped response (covered by the first test) — this test just confirms
    // the existing graceful-degradation contract (null, not a thrown error)
    // still holds when the underlying search call genuinely fails outright.
    const client = fakeClient(async () => {
      throw new Error('network error')
    })

    const result = await searchFallbackScrape(client, 'https://example.com')

    expect(result).toBeNull()
  })

  it('skips hits with markdown/description under the usefulness floor rather than fabricating content', async () => {
    const client = fakeClient(async () =>
      realShapedSearchResponse([
        { url: 'https://example.com/thin', markdown: 'too short' },
        { url: 'https://example.com/real', markdown: 'C'.repeat(150) },
      ])
    )

    const result = await searchFallbackScrape(client, 'https://example.com')

    expect(result).not.toBeNull()
    expect(result!.successfulUrls).not.toContain('https://example.com/thin')
    expect(result!.successfulUrls).toContain('https://example.com/real')
  })
})
