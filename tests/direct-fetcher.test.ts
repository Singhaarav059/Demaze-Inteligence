// ============================================================
// In-house direct HTTP fetcher tests (plan §42 G3, §43 fetching tests).
// global.fetch mocked, same precedent as tests/edgar-client.test.ts /
// tests/prospeo-client.test.ts. robots.txt and duplicate-URL dedup are out
// of scope for this module (deferred to G5, see direct-fetcher.ts header).
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { directFetch } from '../lib/pipeline/direct-fetcher'

function htmlResponse(body: string, opts: Partial<{ status: number; url: string; contentType: string }> = {}) {
  return {
    ok: true,
    status: opts.status ?? 200,
    url: opts.url ?? 'https://example.com/',
    headers: new Headers({ 'content-type': opts.contentType ?? 'text/html; charset=utf-8' }),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response
}

describe('directFetch', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.useRealTimers()
  })

  it('returns text on a clean 200 HTML response', async () => {
    vi.mocked(global.fetch).mockResolvedValue(htmlResponse('<html>hi</html>'))
    const result = await directFetch('https://example.com')
    expect(result.ok).toBe(true)
    expect(result.isHtml).toBe(true)
    expect(result.text).toBe('<html>hi</html>')
  })

  it('follows a redirect (fetch reports the final url)', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      htmlResponse('<html>final</html>', { url: 'https://example.com/final' })
    )
    const result = await directFetch('https://example.com/old')
    expect(result.ok).toBe(true)
    expect(result.url).toBe('https://example.com/final')
  })

  it('flags a non-HTML content-type without failing', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      htmlResponse('{"a":1}', { contentType: 'application/json' })
    )
    const result = await directFetch('https://example.com/api')
    expect(result.ok).toBe(true)
    expect(result.isHtml).toBe(false)
  })

  it('does not retry a definitive 404', async () => {
    vi.mocked(global.fetch).mockResolvedValue(htmlResponse('not found', { status: 404 }))
    vi.mocked(global.fetch).mockImplementation(async () =>
      ({ ok: false, status: 404, url: 'https://example.com/missing', headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response)
    )
    const result = await directFetch('https://example.com/missing')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('HTTP 404')
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('retries once on a 5xx and succeeds on the second attempt', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: false, status: 503, url: 'https://example.com/', headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response)
      .mockResolvedValueOnce(htmlResponse('<html>ok</html>'))
    const result = await directFetch('https://example.com')
    expect(result.ok).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('retries once on a thrown network error and succeeds on the second attempt', async () => {
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(htmlResponse('<html>ok</html>'))
    const result = await directFetch('https://example.com')
    expect(result.ok).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('reports a timeout as an AbortError, not a generic failure', async () => {
    vi.mocked(global.fetch).mockImplementation((_url, init) => {
      const signal = (init as RequestInit)?.signal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    const result = await directFetch('https://example.com', 5)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('timed out')
  })

  it('rejects a response whose declared content-length exceeds the size cap', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.com/',
      headers: new Headers({ 'content-type': 'text/html', 'content-length': String(20_000_000) }),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response)
    const result = await directFetch('https://example.com')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('too large')
  })
})
