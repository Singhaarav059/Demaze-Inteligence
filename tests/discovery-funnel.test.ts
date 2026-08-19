// ============================================================
// Discovery funnel counters — every rejection lands in exactly one bucket,
// no hardcoded conversion-rate math anywhere.
// ============================================================

import { describe, it, expect } from 'vitest'
import { emptyFunnel, recordRejection, recordDiscovered, recordQualified, mergeFunnels } from '../lib/enrichment/discovery-funnel'
import type { RejectionReason } from '../lib/companies/identity'

describe('recordRejection — every reason increments exactly one counter', () => {
  const cases: Array<[RejectionReason, string]> = [
    ['duplicate', 'duplicate'],
    ['already_researched', 'alreadyResearched'],
    ['already_outreached', 'alreadyOutreached'],
    ['wrong_sector', 'wrongSector'],
    ['outside_size_range', 'outsideSize'],
    ['insufficient_evidence', 'otherRejected'],
    ['poor_icp_fit', 'otherRejected'],
    ['inactive_company', 'otherRejected'],
    ['other', 'otherRejected'],
  ]

  for (const [reason, field] of cases) {
    it(`"${reason}" increments only "${field}"`, () => {
      const funnel = emptyFunnel()
      recordRejection(funnel, reason)
      const total = Object.values(funnel).reduce((a, b) => a + b, 0)
      expect(total).toBe(1)
      expect((funnel as unknown as Record<string, number>)[field]).toBe(1)
    })
  }
})

describe('recordDiscovered / recordQualified', () => {
  it('accumulates across multiple calls', () => {
    const funnel = emptyFunnel()
    recordDiscovered(funnel, 5)
    recordDiscovered(funnel, 3)
    recordQualified(funnel)
    recordQualified(funnel)
    expect(funnel.discovered).toBe(8)
    expect(funnel.qualified).toBe(2)
  })
})

describe('mergeFunnels', () => {
  it('sums every field independently, no cross-field bleed', () => {
    const a = emptyFunnel()
    recordDiscovered(a, 10)
    recordRejection(a, 'wrong_sector')
    const b = emptyFunnel()
    recordDiscovered(b, 5)
    recordRejection(b, 'wrong_sector')
    recordQualified(b)

    const merged = mergeFunnels(a, b)
    expect(merged.discovered).toBe(15)
    expect(merged.wrongSector).toBe(2)
    expect(merged.qualified).toBe(1)
  })
})

describe('no hardcoded conversion assumption', () => {
  it('an all-discovered, zero-qualified funnel reports 0, not a guessed percentage', () => {
    const funnel = emptyFunnel()
    recordDiscovered(funnel, 100)
    expect(funnel.qualified).toBe(0)
    // The only "rate" is derivable from real counters, never asserted here.
  })
})
