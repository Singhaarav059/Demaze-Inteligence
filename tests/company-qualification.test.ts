// ============================================================
// Company qualification — the gate between discovery and full research
// ============================================================
// assessCompanySize()'s homepage fallback (lib/pipeline/html-extractor's
// fetchAndExtract) is mocked to fail cleanly — it's real, in-house,
// network-hitting I/O, and this suite must never make a live network call
// (same "no live API spend" discipline as the rest of this repo's test
// suite). A candidate with a domain but no size evidence in its snippets
// would otherwise trigger a real fetch attempt.

import { describe, it, expect, vi } from 'vitest'
import { FakeSupabase } from './helpers/fake-supabase'

vi.mock('../lib/pipeline/html-extractor', () => ({
  fetchAndExtract: vi.fn(async () => ({ url: '', success: false, markdown: '', charCount: 0, error: 'mocked: no network in tests' })),
}))

import { qualifyCandidate, qualifyAndAnnotate, matchesSectorSignals } from '../lib/enrichment/company-qualification'
import { upsertDiscovered, markResearched, markOutreached } from '../lib/companies/identity'

describe('matchesSectorSignals', () => {
  it('matches manufacturing signal words', () => {
    expect(matchesSectorSignals('A leading industrial manufacturer with 4 plants.', 'manufacturing')).toBe(true)
  })
  it('does not match unrelated text', () => {
    expect(matchesSectorSignals('A boutique hotel chain in the Maldives.', 'manufacturing')).toBe(false)
  })

  // Real bug found live 2026-08-19: a "top manufacturers in Europe"
  // listicle naming Volkswagen/Bosch was rejected as wrong_sector because
  // \bmanufacturer\b (singular) doesn't match inside "manufacturers" — the
  // trailing "s" is a word character, so there's no boundary there.
  it('matches the regular plural of a signal word (manufacturer -> manufacturers, the live Volkswagen/Bosch bug)', () => {
    expect(matchesSectorSignals('The top manufacturers in Europe include Volkswagen, Bosch, and others.', 'manufacturing')).toBe(true)
  })

  it('matches a consonant+y -> ies plural (factory -> factories)', () => {
    expect(matchesSectorSignals('The company operates several factories across three continents.', 'manufacturing')).toBe(true)
  })

  it('matches a regular plural for a multi-word signal, pluralizing only the last word (equipment manufacturer -> equipment manufacturers)', () => {
    expect(matchesSectorSignals('A group of leading equipment manufacturers based in Germany.', 'manufacturing')).toBe(true)
  })

  it('still matches the exact singular form (no regression)', () => {
    expect(matchesSectorSignals('A component manufacturer serving the automotive industry.', 'manufacturing')).toBe(true)
  })

  it('does not match a coincidental substring that is not actually the plural (e.g. "manufacturersonian" is not a real word, but a differently-suffixed word should not match)', () => {
    expect(matchesSectorSignals('The Manufacturersburg neighborhood is a historic district.', 'manufacturing')).toBe(false)
  })
})

describe('qualifyCandidate — genuinely new candidate', () => {
  it('qualifies a brand-new candidate with on-sector, in-band evidence', async () => {
    const supa = new FakeSupabase()
    const outcome = await qualifyCandidate(
      supa as any,
      { name: 'New Manufacturer Co', domain: 'newmfg.com', snippets: ['A component manufacturer with revenue of ₹100 crore.'] },
      'manufacturing',
    )
    expect(outcome.status).toBe('qualified')
    expect(outcome.reason).toBeNull()
  })
})

describe('qualifyCandidate — duplicate / already-researched / already-outreached', () => {
  it('rejects a plain duplicate (already discovered/qualified previously)', async () => {
    const supa = new FakeSupabase()
    await upsertDiscovered(supa as any, { name: 'Dup Co', domain: 'dupco.com' })
    const outcome = await qualifyCandidate(supa as any, { name: 'Dup Co', domain: 'dupco.com' }, 'manufacturing')
    expect(outcome.status).toBe('disqualified')
    expect(outcome.reason).toBe('duplicate')
  })

  it('rejects a company already marked researched', async () => {
    const supa = new FakeSupabase()
    const row = await upsertDiscovered(supa as any, { name: 'Researched Co', domain: 'researchedco.com' })
    await markResearched(supa as any, row.id, 'run-1')
    const outcome = await qualifyCandidate(supa as any, { name: 'Researched Co', domain: 'researchedco.com' }, 'manufacturing')
    expect(outcome.status).toBe('disqualified')
    expect(outcome.reason).toBe('already_researched')
  })

  it('rejects a company already marked outreached', async () => {
    const supa = new FakeSupabase()
    const row = await upsertDiscovered(supa as any, { name: 'Outreached Co', domain: 'outreachedco.com' })
    await markOutreached(supa as any, row.id, 'camp-1')
    const outcome = await qualifyCandidate(supa as any, { name: 'Outreached Co', domain: 'outreachedco.com' }, 'manufacturing')
    expect(outcome.status).toBe('disqualified')
    expect(outcome.reason).toBe('already_outreached')
  })

  it('catches a duplicate across a name spelling variation, not just exact domain match', async () => {
    const supa = new FakeSupabase()
    await upsertDiscovered(supa as any, { name: 'Variant Industries Ltd' })
    const outcome = await qualifyCandidate(supa as any, { name: 'Variant Industries' }, 'manufacturing')
    expect(outcome.status).toBe('disqualified')
    expect(outcome.reason).toBe('duplicate')
  })

  it('re-evaluates a previously disqualified company fresh, rather than permanently locking it out', async () => {
    const supa = new FakeSupabase()
    const row = await upsertDiscovered(supa as any, { name: 'Retry Co', domain: 'retryco.com' })
    supa.table('company_registry').find(r => r.id === row.id)!.status = 'disqualified'
    const outcome = await qualifyCandidate(
      supa as any,
      { name: 'Retry Co', domain: 'retryco.com', snippets: ['A manufacturer with revenue of ₹100 crore.'] },
      'manufacturing',
    )
    expect(outcome.status).toBe('qualified')
  })
})

describe('qualifyCandidate — wrong sector', () => {
  it('rejects a candidate whose snippets have zero signal-word overlap with the requested sector', async () => {
    const supa = new FakeSupabase()
    const outcome = await qualifyCandidate(
      supa as any,
      { name: 'Hotel Co', domain: 'hotelco.com', snippets: ['A boutique hotel chain with resorts across the coast.'] },
      'manufacturing',
    )
    expect(outcome.status).toBe('disqualified')
    expect(outcome.reason).toBe('wrong_sector')
  })

  it('does not reject for wrong sector when no snippet evidence is available at all', async () => {
    const supa = new FakeSupabase()
    const outcome = await qualifyCandidate(supa as any, { name: 'No Evidence Co', domain: 'noevidence.com' }, 'manufacturing')
    // No snippets -> sector check skipped -> falls through to size check
    // (also 'unknown', not a rejection) -> qualifies.
    expect(outcome.status).toBe('qualified')
  })
})

describe('qualifyCandidate — outside size range', () => {
  it('rejects a candidate with confidently mega-scale evidence', async () => {
    const supa = new FakeSupabase()
    const outcome = await qualifyCandidate(
      supa as any,
      { name: 'Giant Co', domain: 'giantco.com', snippets: ['A Fortune 500 industrial manufacturer.'] },
      'manufacturing',
    )
    expect(outcome.status).toBe('disqualified')
    expect(outcome.reason).toBe('outside_size_range')
  })

  it('does not reject when size evidence is merely unknown', async () => {
    const supa = new FakeSupabase()
    const outcome = await qualifyCandidate(
      supa as any,
      { name: 'Unknown Size Co', domain: 'unknownsize.com', snippets: ['A component manufacturer serving the automotive industry.'] },
      'manufacturing',
    )
    expect(outcome.status).toBe('qualified')
  })
})

describe('qualifyAndAnnotate — batch qualification with funnel recording', () => {
  it('annotates every item (including locked ones) and records the funnel correctly', async () => {
    const supa = new FakeSupabase()
    await upsertDiscovered(supa as any, { name: 'Already Known Co', domain: 'known.com' })

    const funnel = { discovered: 0, duplicate: 0, alreadyResearched: 0, alreadyOutreached: 0, wrongSector: 0, outsideSize: 0, otherRejected: 0, qualified: 0 }
    const items = [
      { name: 'Already Known Co', domain: 'known.com', reason: 'seen before' },
      { name: 'Brand New Co', domain: 'brandnew.com', reason: 'a manufacturer with revenue of ₹100 crore' },
    ]
    const annotated = await qualifyAndAnnotate(supa as any, items, 'manufacturing', funnel)

    expect(annotated).toHaveLength(2)
    expect(annotated[0].existingStatus).toBe('disqualified')
    expect(annotated[0].rejectionReason).toBe('duplicate')
    expect(annotated[1].existingStatus).toBe('qualified')
    expect(funnel.duplicate).toBe(1)
    expect(funnel.qualified).toBe(1)
  })
})
