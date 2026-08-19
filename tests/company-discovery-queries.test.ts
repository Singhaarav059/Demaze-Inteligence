// ============================================================
// Discovery query rotation — global-by-default, sector coverage, pool exhaustion
// ============================================================

import { describe, it, expect } from 'vitest'
import { generateQueryBatch, totalComboCount } from '../lib/enrichment/company-discovery-queries'
import type { TargetSector } from '../lib/sector-playbook/types'

const SECTORS: TargetSector[] = ['manufacturing', 'automotive', 'ecommerce']

describe('generateQueryBatch — global by default, not India-only', () => {
  it('the first batch is not exclusively India-scoped queries', () => {
    const used = new Set<string>()
    const batch = generateQueryBatch('manufacturing', used, 20)
    const indiaOnly = batch.every(q => /india/i.test(q))
    expect(indiaOnly).toBe(false)
    // At least one global (no-region) query should appear early.
    const hasGlobalQuery = batch.some(q => !/\bin\s+(the\s+)?(united states|europe|united kingdom|india|southeast asia|australia|canada|middle east|latin america)\b/i.test(q))
    expect(hasGlobalQuery).toBe(true)
  })

  it('India is only one of several region options, never the sole directory default', () => {
    const used = new Set<string>()
    const batch = generateQueryBatch('automotive', used, totalComboCount('automotive'))
    const indiaMentions = batch.filter(q => /india/i.test(q)).length
    expect(indiaMentions).toBeGreaterThan(0)
    expect(indiaMentions).toBeLessThan(batch.length)
  })
})

describe('generateQueryBatch — rotation and pool exhaustion', () => {
  it('never returns a query already present in usedCombos', () => {
    const used = new Set<string>()
    const first = generateQueryBatch('ecommerce', used, 8)
    const second = generateQueryBatch('ecommerce', used, 8)
    const overlap = first.filter(q => second.includes(q))
    expect(overlap).toHaveLength(0)
  })

  it('mutates usedCombos so a caller looping this naturally explores new territory', () => {
    const used = new Set<string>()
    expect(used.size).toBe(0)
    generateQueryBatch('manufacturing', used, 5)
    expect(used.size).toBe(5)
  })

  it('returns fewer than batchSize (down to zero) once the combo pool is exhausted', () => {
    const used = new Set<string>()
    const total = totalComboCount('ecommerce')
    generateQueryBatch('ecommerce', used, total) // drain the whole pool
    const next = generateQueryBatch('ecommerce', used, 8)
    expect(next).toHaveLength(0)
  })
})

describe('sector-term coverage — every active sector has real queries', () => {
  for (const sector of SECTORS) {
    it(`${sector} has a non-trivial combo pool`, () => {
      expect(totalComboCount(sector)).toBeGreaterThan(20)
    })

    it(`${sector}'s first batch queries are non-empty, distinct strings`, () => {
      const used = new Set<string>()
      const batch = generateQueryBatch(sector, used, 8)
      expect(batch.length).toBe(8)
      expect(new Set(batch).size).toBe(8)
      for (const q of batch) expect(q.trim().length).toBeGreaterThan(0)
    })
  }
})
