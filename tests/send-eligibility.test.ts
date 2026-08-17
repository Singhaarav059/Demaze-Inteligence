// ============================================================
// send-eligibility.ts — Phase B (B4/B6) blocking-check tests
// ============================================================

import { describe, it, expect } from 'vitest'
import { isValidEmailFormat, checkEmailFormat, checkCompanyIdentity } from '../lib/outbound/sending/send-eligibility'

describe('isValidEmailFormat / checkEmailFormat', () => {
  it('accepts a normal address', () => {
    expect(isValidEmailFormat('jane@acme.com')).toBe(true)
    expect(checkEmailFormat('jane@acme.com')).toEqual({ blocked: false })
  })

  it('rejects a missing email', () => {
    expect(checkEmailFormat(null).blocked).toBe(true)
    expect(checkEmailFormat(undefined).blocked).toBe(true)
    expect(checkEmailFormat('').blocked).toBe(true)
  })

  it('rejects an obviously malformed address', () => {
    for (const bad of ['not-an-email', 'jane@', '@acme.com', 'jane acme.com', 'jane@acme']) {
      expect(isValidEmailFormat(bad)).toBe(false)
      expect(checkEmailFormat(bad).blocked).toBe(true)
    }
  })

  it('accepts a plus-addressed / subdomain address', () => {
    expect(isValidEmailFormat('jane+sales@mail.acme.co.uk')).toBe(true)
  })

  it('trims surrounding whitespace before checking', () => {
    expect(isValidEmailFormat('  jane@acme.com  ')).toBe(true)
  })
})

describe('checkCompanyIdentity', () => {
  it('blocks on a grounding conflict', () => {
    const result = checkCompanyIdentity('conflict')
    expect(result.blocked).toBe(true)
    expect(result.reason).toBeDefined()
  })

  it('does NOT block on not_found — absence of evidence, not evidence of a mismatch', () => {
    expect(checkCompanyIdentity('not_found')).toEqual({ blocked: false })
  })

  it('does not block a confirmed match or a null/missing status', () => {
    expect(checkCompanyIdentity('confirmed')).toEqual({ blocked: false })
    expect(checkCompanyIdentity(null)).toEqual({ blocked: false })
    expect(checkCompanyIdentity(undefined)).toEqual({ blocked: false })
  })
})
