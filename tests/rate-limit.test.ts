// ============================================================
// Rate limiting — tests
// ============================================================
// Verifies the in-memory fixed-window counter behind admin-route and
// Gmail-OAuth rate limiting: allows traffic under the limit, blocks over
// it with a sane Retry-After, and resets once the window elapses.
// ============================================================

import { describe, it, expect } from 'vitest'
import { checkRateLimit, getClientIp } from '../lib/rate-limit'

describe('checkRateLimit', () => {
  it('allows requests under the limit', () => {
    const key = `test:${Math.random()}`
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, { limit: 5, windowMs: 60_000 }).allowed).toBe(true)
    }
  })

  it('blocks requests once the limit is exceeded within the window', () => {
    const key = `test:${Math.random()}`
    for (let i = 0; i < 3; i++) {
      checkRateLimit(key, { limit: 3, windowMs: 60_000 })
    }
    const result = checkRateLimit(key, { limit: 3, windowMs: 60_000 })
    expect(result.allowed).toBe(false)
    expect(result.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('tracks separate keys independently', () => {
    const keyA = `test:a:${Math.random()}`
    const keyB = `test:b:${Math.random()}`
    checkRateLimit(keyA, { limit: 1, windowMs: 60_000 })
    expect(checkRateLimit(keyA, { limit: 1, windowMs: 60_000 }).allowed).toBe(false)
    expect(checkRateLimit(keyB, { limit: 1, windowMs: 60_000 }).allowed).toBe(true)
  })

  it('resets the count once the window has elapsed', async () => {
    const key = `test:${Math.random()}`
    expect(checkRateLimit(key, { limit: 1, windowMs: 20 }).allowed).toBe(true)
    expect(checkRateLimit(key, { limit: 1, windowMs: 20 }).allowed).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(checkRateLimit(key, { limit: 1, windowMs: 20 }).allowed).toBe(true)
  })
})

describe('getClientIp', () => {
  it('uses the first entry of x-forwarded-for', () => {
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    })
    expect(getClientIp(req)).toBe('203.0.113.5')
  })

  it('falls back to "unknown" when the header is absent', () => {
    const req = new Request('https://example.com')
    expect(getClientIp(req)).toBe('unknown')
  })
})
