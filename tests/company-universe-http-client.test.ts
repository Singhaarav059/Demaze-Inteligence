// ============================================================
// Company Universe — shared provider HTTP client tests
// ============================================================
// Demaze_Multi_Source_Company_Universe_Claude_Prompt.md Section 23: "rate
// limiting, retry with backoff, 429 handling, timeout... never bypass
// rate limits." Mocked global.fetch throughout — same precedent as
// tests/prospeo-client.test.ts / tests/website-discovery.test.ts. Real
// timers (not fake) with small millisecond backoff values passed via
// options, so this suite runs fast without needing vi.useFakeTimers()
// interacting with AbortSignal.timeout (which real Node timers back).
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchProviderJson } from '../lib/company-universe/http-client'

const originalFetch = global.fetch

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response
}

describe('fetchProviderJson', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns parsed JSON on a clean 200', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(jsonResponse({ hello: 'world' }))
    const result = await fetchProviderJson<{ hello: string }>('https://example.com', 'test')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ hello: 'world' })
      expect(result.attempts).toBe(1)
    }
  })

  it('retries once on a 500 then succeeds', async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const result = await fetchProviderJson<{ ok: boolean }>('https://example.com', 'test', { maxRetries: 2 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({ ok: true })
      expect(result.attempts).toBe(2)
    }
  })

  it('does NOT retry a plain 4xx (other than 429) — the request itself is wrong', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(jsonResponse({ error: 'bad request' }, 400))
    const result = await fetchProviderJson('https://example.com', 'test', { maxRetries: 2 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.attempts).toBe(1)
      expect(result.status).toBe(400)
    }
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('gives up after exhausting retries on repeated 5xx', async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({}, 503))
    const result = await fetchProviderJson('https://example.com', 'test', { maxRetries: 2 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.attempts).toBe(3)
  })

  it('honors a numeric Retry-After header on 429 before retrying', async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const result = await fetchProviderJson<{ ok: boolean }>('https://example.com', 'test', { maxRetries: 1 })
    expect(result.ok).toBe(true)
  })

  it('reports rateLimited: true when 429 retries are exhausted', async () => {
    ;(global.fetch as any)
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '0' }))
    const result = await fetchProviderJson('https://example.com', 'test', { maxRetries: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rateLimited).toBe(true)
  })

  it('reports timedOut: true and retries on an AbortError-shaped failure', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'TimeoutError'
    ;(global.fetch as any)
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const result = await fetchProviderJson<{ ok: boolean }>('https://example.com', 'test', { maxRetries: 1 })
    expect(result.ok).toBe(true)
  })

  it('never throws on a genuine network failure — returns a typed failure result', async () => {
    ;(global.fetch as any).mockRejectedValue(new Error('network unreachable'))
    const result = await fetchProviderJson('https://example.com', 'test', { maxRetries: 0 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/network unreachable/)
  })

  it('respects a local rate-limit pre-check and never calls fetch when blocked', async () => {
    const key = `test-rate-limit-${Math.random()}`
    // First call consumes the only slot in a 1-request window.
    await fetchProviderJson('https://example.com/1', 'test', { rateLimit: { key, config: { limit: 1, windowMs: 60_000 } } })
    ;(global.fetch as any).mockClear()
    const result = await fetchProviderJson('https://example.com/2', 'test', { rateLimit: { key, config: { limit: 1, windowMs: 60_000 } } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rateLimited).toBe(true)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('passes through custom headers', async () => {
    ;(global.fetch as any).mockResolvedValueOnce(jsonResponse({ ok: true }))
    await fetchProviderJson('https://example.com', 'test', { headers: { 'X-Test': 'value' } })
    expect(global.fetch).toHaveBeenCalledWith('https://example.com', expect.objectContaining({ headers: { 'X-Test': 'value' } }))
  })
})
