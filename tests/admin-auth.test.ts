// ============================================================
// Admin auth — tests
// ============================================================
// Covers the two production-hardening additions to verifyAdminRequest():
// the in-memory rate limiter (shared with lib/rate-limit.ts, tested more
// thoroughly there) and the timing-safe token comparison (previously a
// plain !== string comparison). Uses real NextRequest instances — this
// repo has no prior precedent for that, so kept minimal and isolated.
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { verifyAdminRequest, getExpectedToken } from '../lib/admin/auth'

const ORIGINAL_SECRET = process.env.ADMIN_SECRET

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest('https://example.com/api/admin/test', { headers })
}

describe('verifyAdminRequest', () => {
  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.ADMIN_SECRET
    else process.env.ADMIN_SECRET = ORIGINAL_SECRET
  })

  it('passes through when ADMIN_SECRET is not set', () => {
    delete process.env.ADMIN_SECRET
    expect(verifyAdminRequest(makeRequest())).toBeNull()
  })

  it('rejects a missing token when a secret is configured', () => {
    process.env.ADMIN_SECRET = 'test-secret'
    const result = verifyAdminRequest(makeRequest())
    expect(result?.status).toBe(401)
  })

  it('rejects a same-length wrong token', () => {
    process.env.ADMIN_SECRET = 'test-secret'
    const expected = getExpectedToken()!
    const wrongSameLength = expected.slice(0, -1) + (expected.endsWith('a') ? 'b' : 'a')
    const result = verifyAdminRequest(makeRequest({ 'x-admin-token': wrongSameLength }))
    expect(result?.status).toBe(401)
  })

  it('rejects a different-length token', () => {
    process.env.ADMIN_SECRET = 'test-secret'
    const result = verifyAdminRequest(makeRequest({ 'x-admin-token': 'short' }))
    expect(result?.status).toBe(401)
  })

  it('accepts the correct token', () => {
    process.env.ADMIN_SECRET = 'test-secret'
    const expected = getExpectedToken()!
    const result = verifyAdminRequest(makeRequest({ 'x-admin-token': expected }))
    expect(result).toBeNull()
  })
})

describe('verifyAdminRequest rate limiting', () => {
  beforeEach(() => {
    process.env.ADMIN_SECRET = 'test-secret'
  })

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.ADMIN_SECRET
    else process.env.ADMIN_SECRET = ORIGINAL_SECRET
  })

  it('returns 429 once the per-IP admin budget is exceeded', () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 255)}`
    const expected = getExpectedToken()!
    let lastResult = null
    for (let i = 0; i < 121; i++) {
      lastResult = verifyAdminRequest(
        makeRequest({ 'x-admin-token': expected, 'x-forwarded-for': ip })
      )
    }
    expect(lastResult?.status).toBe(429)
    expect(lastResult?.headers.get('Retry-After')).toBeTruthy()
  })
})
