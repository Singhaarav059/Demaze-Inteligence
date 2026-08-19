// ============================================================
// Page cache tests (plan §42 G6; plan §43 "Cache tests: hit, miss, TTL,
// content hash, stale refresh").
// getCachedPage/savePageCache are pure Map operations (now injectable),
// tested directly. fetchAndExtractCached wraps html-extractor.ts's
// fetchAndExtract(), which wraps direct-fetcher.ts's directFetch() — same
// global.fetch-mocking precedent as tests/html-extractor.test.ts/
// tests/direct-fetcher.test.ts.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getCachedPage,
  savePageCache,
  clearPageCache,
  fetchAndExtractCached,
  PAGE_CACHE_TTL_HOURS,
} from '../lib/cache/page-cache'
import type { FetchAndExtractResult } from '../lib/pipeline/html-extractor'

const HOUR_MS = 60 * 60 * 1000

function fakePage(markdown: string, url = 'https://example.com/about'): FetchAndExtractResult {
  return { url, success: true, markdown, charCount: markdown.length, title: 'About' }
}

describe('getCachedPage / savePageCache (pure)', () => {
  beforeEach(() => clearPageCache())

  it('miss: returns null for a URL never cached', () => {
    expect(getCachedPage('https://never-cached.example.com')).toBeNull()
  })

  it('hit: returns the cached entry within TTL', () => {
    const now = 1_000_000
    savePageCache('https://example.com/about', fakePage('Real content.'), now)
    const hit = getCachedPage('https://example.com/about', now + HOUR_MS)
    expect(hit).not.toBeNull()
    expect(hit!.page.markdown).toBe('Real content.')
  })

  it('TTL: a fresh-but-old entry expires past PAGE_CACHE_TTL_HOURS', () => {
    const now = 1_000_000
    savePageCache('https://example.com/about', fakePage('Real content.'), now)
    const justInside = getCachedPage('https://example.com/about', now + PAGE_CACHE_TTL_HOURS * HOUR_MS)
    const justOutside = getCachedPage('https://example.com/about', now + PAGE_CACHE_TTL_HOURS * HOUR_MS + 1)
    expect(justInside).not.toBeNull()
    expect(justOutside).toBeNull()
  })

  it('content hash: differs when markdown differs, matches when identical', () => {
    const now = 1_000_000
    const a = savePageCache('https://example.com/a', fakePage('Content A'), now)
    const b = savePageCache('https://example.com/b', fakePage('Content A'), now)
    const c = savePageCache('https://example.com/c', fakePage('Content C'), now)
    expect(a.contentHash).toBe(b.contentHash)
    expect(a.contentHash).not.toBe(c.contentHash)
  })
})

describe('fetchAndExtractCached', () => {
  const originalFetch = global.fetch
  beforeEach(() => { clearPageCache(); global.fetch = vi.fn() })
  afterEach(() => { global.fetch = originalFetch })

  function htmlResponse(body: string, url = 'https://example.com/page') {
    return {
      ok: true, status: 200, url,
      headers: new Headers({ 'content-type': 'text/html' }),
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    } as unknown as Response
  }

  it('miss then hit: first call fetches, second call is served from cache with zero fetch calls', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      htmlResponse('<html><title>T</title><body><p>Hello world.</p></body></html>')
    )
    const first = await fetchAndExtractCached('https://example.com/page')
    expect(first.fromCache).toBe(false)
    expect(first.success).toBe(true)
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1)

    const second = await fetchAndExtractCached('https://example.com/page')
    expect(second.fromCache).toBe(true)
    expect(second.markdown).toBe(first.markdown)
    // still exactly 1 — the cache hit made no network call
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1)
  })

  it('failures are never cached — a failed fetch is retried fresh next call', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('ECONNRESET'))
    const first = await fetchAndExtractCached('https://example.com/flaky', 5)
    expect(first.success).toBe(false)
    expect(first.fromCache).toBe(false)

    vi.mocked(global.fetch).mockResolvedValueOnce(
      htmlResponse('<html><title>T</title><body><p>Recovered.</p></body></html>')
    )
    const second = await fetchAndExtractCached('https://example.com/flaky')
    expect(second.success).toBe(true)
    expect(second.fromCache).toBe(false) // real fetch, not a stale failure being replayed
  })

  it('stale refresh: an expired entry with unchanged content reports contentChanged:false', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      htmlResponse('<html><title>T</title><body><p>Stable content.</p></body></html>')
    )
    savePageCache(
      'https://example.com/stable',
      fakePage('Stable content.', 'https://example.com/stable'),
      Date.now() - (PAGE_CACHE_TTL_HOURS + 1) * HOUR_MS // force-expired
    )
    const refreshed = await fetchAndExtractCached('https://example.com/stable')
    expect(refreshed.fromCache).toBe(false)
    expect(refreshed.contentChanged).toBe(false)
  })

  it('stale refresh: an expired entry with changed content reports contentChanged:true', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      htmlResponse('<html><title>T</title><body><p>New content now.</p></body></html>')
    )
    savePageCache(
      'https://example.com/changed',
      fakePage('Old content.', 'https://example.com/changed'),
      Date.now() - (PAGE_CACHE_TTL_HOURS + 1) * HOUR_MS
    )
    const refreshed = await fetchAndExtractCached('https://example.com/changed')
    expect(refreshed.fromCache).toBe(false)
    expect(refreshed.contentChanged).toBe(true)
  })

  it('a genuinely first-ever fetch has contentChanged left undefined (nothing to compare)', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      htmlResponse('<html><title>T</title><body><p>Brand new page.</p></body></html>')
    )
    const result = await fetchAndExtractCached('https://example.com/brand-new')
    expect(result.contentChanged).toBeUndefined()
  })
})
