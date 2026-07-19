// ============================================================
// Email Finder — mock provider tests
// ============================================================
// Confirms the deterministic-mock discipline: same (personName, domain)
// always produces the same result, never throws, and degrades gracefully
// on missing input.
// ============================================================

import { describe, it, expect } from 'vitest'
import { MockEmailFinderProvider } from '../lib/outbound/email-finder/providers/mock'
import { seededRatio, seededPick } from '../lib/outbound/shared/mock-utils'

describe('seededRatio / seededPick', () => {
  it('is deterministic for the same seed', () => {
    expect(seededRatio('jane doe::acme.com')).toBe(seededRatio('jane doe::acme.com'))
  })

  it('differs for different seeds (not a constant)', () => {
    expect(seededRatio('a')).not.toBe(seededRatio('b'))
  })

  it('returns a value in [0, 1)', () => {
    const r = seededRatio('anything')
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThan(1)
  })

  it('seededPick always returns one of the provided options', () => {
    const options = ['a', 'b', 'c'] as const
    expect(options).toContain(seededPick('seed-1', options))
    expect(options).toContain(seededPick('seed-2', options))
  })
})

describe('MockEmailFinderProvider', () => {
  it('is deterministic — same input always produces the same result', async () => {
    const request = { personName: 'Jane Doe', companyName: 'Acme Corp', domain: 'acme.com' }
    const a = await MockEmailFinderProvider.findEmail(request)
    const b = await MockEmailFinderProvider.findEmail(request)
    expect(a).toEqual(b)
  })

  it('derives a firstname.lastname@domain address when found', async () => {
    // Probe a handful of names/domains for at least one 'found' result and
    // verify its shape, since which seeds land on 'found' vs 'not_found' is
    // itself part of what's being tested deterministically elsewhere.
    const candidates = Array.from({ length: 20 }, (_, i) => ({
      personName: `Test Person ${i}`,
      companyName: 'Acme Corp',
      domain: 'acme.com',
    }))
    const results = await Promise.all(candidates.map(c => MockEmailFinderProvider.findEmail(c)))
    const found = results.find(r => r.status === 'found')
    expect(found).toBeDefined()
    expect(found!.email).toMatch(/^[a-z]+(\.[a-z]+)?@acme\.com$/)
    expect(['high', 'medium', 'low']).toContain(found!.confidence)
  })

  it('never throws and returns status="error" with no domain', async () => {
    const result = await MockEmailFinderProvider.findEmail({
      personName: 'Jane Doe',
      companyName: 'Acme Corp',
      domain: '',
    })
    expect(result.status).toBe('error')
    expect(result.email).toBeNull()
  })

  it('never throws and returns status="error" with an unparseable name', async () => {
    const result = await MockEmailFinderProvider.findEmail({
      personName: '   ',
      companyName: 'Acme Corp',
      domain: 'acme.com',
    })
    expect(result.status).toBe('error')
    expect(result.email).toBeNull()
  })

  it('isAvailable always resolves true', async () => {
    expect(await MockEmailFinderProvider.isAvailable()).toBe(true)
  })
})
