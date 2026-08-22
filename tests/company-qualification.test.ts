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

// company-size.ts's 3rd, LLM-backed size tier (added 2026-08-20) is reached
// whenever snippet+homepage evidence both stay 'unknown' — several fixtures
// in this file hit exactly that path. Mocked to always decline ("unknown"),
// same "no live network call" discipline as the html-extractor mock above;
// individual tests below override this per-case where the knowledge tier's
// own behavior is what's being tested.
const getCompletionMock = vi.fn()
getCompletionMock.mockResolvedValue({ content: '{"scale":"unknown"}', model: 'test', providerName: 'test' })
vi.mock('../lib/ai/provider-factory', () => ({
  getCompletion: (...args: unknown[]) => getCompletionMock(...args),
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
  // Real fixed behavior (2026-08-20): a bare upsertDiscovered() row (status
  // 'discovered', no qualification_version — it was never actually run
  // through qualifyCandidate) is now correctly treated as STALE and
  // re-evaluated, not blindly short-circuited to 'duplicate'. A genuine
  // "current-version duplicate reuse" test needs a row that was actually
  // qualified via qualifyCandidate() first, so it carries the current
  // qualification_version — see the describe block below this one for that.
  it('re-evaluates (does not blindly duplicate-reject) a bare discovered row that was never actually qualified', async () => {
    const supa = new FakeSupabase()
    await upsertDiscovered(supa as any, { name: 'Never Qualified Co', domain: 'neverqualified.com' })
    const outcome = await qualifyCandidate(supa as any, { name: 'Never Qualified Co', domain: 'neverqualified.com', snippets: ['A component manufacturer with revenue of ₹100 crore.'] }, 'manufacturing')
    expect(outcome.wasStaleReevaluation).toBe(true)
    expect(outcome.status).toBe('qualified')
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

  it('catches a duplicate across a name spelling variation once genuinely qualified under the current version', async () => {
    const supa = new FakeSupabase()
    const first = await qualifyCandidate(supa as any, { name: 'Variant Industries Ltd', snippets: ['A component manufacturer with revenue of ₹100 crore.'] }, 'manufacturing')
    expect(first.status).toBe('qualified')
    const outcome = await qualifyCandidate(supa as any, { name: 'Variant Industries' }, 'manufacturing')
    expect(outcome.status).toBe('disqualified')
    expect(outcome.reason).toBe('duplicate')
    expect(outcome.wasStaleReevaluation).toBe(false)
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

describe('qualifyCandidate — qualification versioning and provenance', () => {
  it('a company qualified under the current version is reused as a clean duplicate on a second lookup', async () => {
    const supa = new FakeSupabase()
    const first = await qualifyCandidate(supa as any, { name: 'Steady State Co', domain: 'steadystate.example', snippets: ['A manufacturer with revenue of ₹100 crore.'] }, 'manufacturing')
    expect(first.status).toBe('qualified')
    expect(first.wasStaleReevaluation).toBe(false)

    const row = supa.table('company_registry').find((r: any) => r.id === first.companyId)!
    expect(row.qualification_version).toBe('v2')

    const second = await qualifyCandidate(supa as any, { name: 'Steady State Co', domain: 'steadystate.example' }, 'manufacturing')
    expect(second.status).toBe('disqualified')
    expect(second.reason).toBe('duplicate')
    expect(second.wasStaleReevaluation).toBe(false)
  })

  it('a company qualified under a STALE (older/absent) version is re-evaluated, not blindly reused', async () => {
    const supa = new FakeSupabase()
    // Simulate a row qualified under a pre-versioning ruleset: status
    // 'qualified' but qualification_version left unset (exactly the real
    // shape of the 326 pre-migration rows in production).
    const row = await upsertDiscovered(supa as any, { name: 'Stale Qualified Co', domain: 'stalequalified.example' })
    supa.table('company_registry').find((r: any) => r.id === row.id)!.status = 'qualified'

    const outcome = await qualifyCandidate(supa as any, { name: 'Stale Qualified Co', domain: 'stalequalified.example', snippets: ['A component manufacturer with revenue of ₹100 crore.'] }, 'manufacturing')
    expect(outcome.wasStaleReevaluation).toBe(true)
    expect(outcome.status).toBe('qualified')
    expect(outcome.verdict).toBe('QUALIFIED')

    const updated = supa.table('company_registry').find((r: any) => r.id === row.id)!
    expect(updated.qualification_version).toBe('v2')
  })

  it('a mega-cap that was stale-qualified gets correctly disqualified on re-evaluation', async () => {
    const supa = new FakeSupabase()
    const row = await upsertDiscovered(supa as any, { name: 'Global Giant Co', domain: 'globalgiant.example' })
    supa.table('company_registry').find((r: any) => r.id === row.id)!.status = 'qualified'

    // Simulate the mega-cap knowledge tier confirming this one is large.
    getCompletionMock.mockResolvedValueOnce({ content: '{"scale":"large","reasoning":"a globally known conglomerate"}', model: 'test', providerName: 'test' })

    const outcome = await qualifyCandidate(supa as any, { name: 'Global Giant Co', domain: 'globalgiant.example', snippets: ['A manufacturer.'] }, 'manufacturing')
    expect(outcome.wasStaleReevaluation).toBe(true)
    expect(outcome.status).toBe('disqualified')
    expect(outcome.reason).toBe('outside_size_range')

    const updated = supa.table('company_registry').find((r: any) => r.id === row.id)!
    expect(updated.status).toBe('disqualified')
    expect(updated.qualification_version).toBe('v2')
  })

  it('persists qualification provenance fields on a qualified row', async () => {
    const supa = new FakeSupabase()
    const outcome = await qualifyCandidate(supa as any, { name: 'Provenance Co', domain: 'provenance.example', snippets: ['A component manufacturer with revenue of ₹100 crore.'] }, 'manufacturing')
    expect(outcome.status).toBe('qualified')
    const row = supa.table('company_registry').find((r: any) => r.id === outcome.companyId)!
    expect(row.qualification_version).toBe('v2')
    expect(row.entity_type).toBe('COMPANY')
    expect(row.size_classification).toBe('within_range')
    expect(row.icp_fit).toBe('match')
    expect(typeof row.qualification_reason).toBe('string')
    expect(typeof row.qualification_score).toBe('number')
  })

  it('persists qualification provenance fields on a disqualified row', async () => {
    const supa = new FakeSupabase()
    const outcome = await qualifyCandidate(supa as any, { name: 'CLEPA', domain: 'clepa.example', snippets: ['A trade association.'] }, 'manufacturing')
    expect(outcome.status).toBe('disqualified')
    const row = supa.table('company_registry').find((r: any) => r.id === outcome.companyId)!
    expect(row.qualification_version).toBe('v2')
    expect(row.entity_type).toBe('ASSOCIATION')
    expect(row.qualification_confidence).toBe('REJECTED')
    expect(row.qualification_score).toBe(0)
  })
})

describe('qualifyCandidate — entity-type hard gate (defense in depth)', () => {
  it('rejects a trade association reaching this function directly, even with on-sector/in-band snippets', async () => {
    const supa = new FakeSupabase()
    const outcome = await qualifyCandidate(
      supa as any,
      { name: 'CLEPA', domain: 'clepa.example', snippets: ['A manufacturer with revenue of ₹100 crore.'] },
      'manufacturing',
    )
    expect(outcome.status).toBe('disqualified')
    expect(outcome.verdict).toBe('REJECTED')
    expect(outcome.score).toBe(0)
  })

  it('rejects a government program reaching this function directly', async () => {
    const supa = new FakeSupabase()
    const outcome = await qualifyCandidate(supa as any, { name: 'Manufacturing USA' }, 'manufacturing')
    expect(outcome.status).toBe('disqualified')
    expect(outcome.verdict).toBe('REJECTED')
  })
})

describe('qualifyCandidate — verdict/score are consistent with status, not just diagnostic noise', () => {
  it('a fully-confirmed candidate is both status=qualified and verdict=QUALIFIED', async () => {
    const supa = new FakeSupabase()
    const outcome = await qualifyCandidate(
      supa as any,
      { name: 'Strong Signal Manufacturing', domain: 'strongsignal.example', snippets: ['A component manufacturer with revenue of ₹100 crore and 3 plants.'] },
      'manufacturing',
    )
    expect(outcome.status).toBe('qualified')
    expect(outcome.verdict).toBe('QUALIFIED')
    expect(outcome.score).toBeGreaterThan(0)
  })

  it('a thin-evidence candidate (no domain, no sector snippet) can still be status=qualified but verdict=REVIEW', async () => {
    const supa = new FakeSupabase()
    const outcome = await qualifyCandidate(supa as any, { name: 'Thin Evidence Co' }, 'manufacturing')
    expect(outcome.status).toBe('qualified')
    expect(outcome.verdict).toBe('REVIEW')
  })

  it('every disqualified outcome is verdict=REJECTED/score=0', async () => {
    const supa = new FakeSupabase()
    const outcome = await qualifyCandidate(
      supa as any,
      { name: 'Wrong Sector Hotel', domain: 'hotel.example', snippets: ['A boutique hotel chain with resorts.'] },
      'manufacturing',
    )
    expect(outcome.verdict).toBe('REJECTED')
    expect(outcome.score).toBe(0)
  })
})

// Representative mid-market examples — one per active target sector — must
// NOT be rejected by any of the entity-type/mega-cap/sector/size gates.
// Guards against the qualification gate becoming so aggressive it starts
// rejecting genuinely-in-ICP companies, not just the known leakage cases.
describe('qualifyCandidate — representative valid mid-market companies qualify', () => {
  it('a mid-market manufacturing company qualifies', async () => {
    const supa = new FakeSupabase()
    const outcome = await qualifyCandidate(
      supa as any,
      { name: 'Meridian Precision Components', domain: 'meridianprecision.example', snippets: ['A precision component manufacturer operating 3 plants with revenue of ₹180 crore.'] },
      'manufacturing',
    )
    expect(outcome.status).toBe('qualified')
  })

  it('a mid-market automotive-parts supplier qualifies', async () => {
    const supa = new FakeSupabase()
    const outcome = await qualifyCandidate(
      supa as any,
      { name: 'Alden Auto Components', domain: 'aldenauto.example', snippets: ['An automotive component manufacturer supplying Tier-1 OEMs, revenue of ₹220 crore.'] },
      'automotive',
    )
    expect(outcome.status).toBe('qualified')
  })

  it('a mid-market e-commerce company qualifies', async () => {
    const supa = new FakeSupabase()
    const outcome = await qualifyCandidate(
      supa as any,
      { name: 'Northgate Marketplace', domain: 'northgatemarket.example', snippets: ['An online marketplace and e-commerce retailer with revenue of ₹150 crore.'] },
      'ecommerce',
    )
    expect(outcome.status).toBe('qualified')
  })
})

describe('qualifyCandidate — evidence persistence (migration 029)', () => {
  it('stores sector_evidence and domain_evidence on a qualified row, sufficient to reconstruct the decision', async () => {
    const supa = new FakeSupabase()
    const outcome = await qualifyCandidate(
      supa as any,
      {
        name: 'Evidenced Manufacturing Co', domain: 'evidenced.example', domainConfidence: 'high',
        sourceUrls: ['https://example.com/directory-listing'],
        snippets: ['A component manufacturer with revenue of ₹100 crore and 3 plants.'],
        discoveryQuery: 'manufacturing companies in South Asia',
      },
      'manufacturing',
    )
    expect(outcome.status).toBe('qualified')
    const row = supa.table('company_registry').find((r: any) => r.id === outcome.companyId)!

    expect(row.sector_evidence.sector).toBe('manufacturing')
    expect(row.sector_evidence.matched).toBe(true)
    expect(row.sector_evidence.matchedSignals.length).toBeGreaterThan(0)
    expect(row.sector_evidence.query).toBe('manufacturing companies in South Asia')
    expect(row.sector_evidence.snippet).toContain('component manufacturer')

    expect(row.domain_evidence.domain).toBe('evidenced.example')
    expect(row.domain_evidence.confidence).toBe('high')
    expect(row.domain_evidence.sourceUrls).toEqual(['https://example.com/directory-listing'])
  })

  it('stores sector_evidence with matched=false and a null domain_evidence on a wrong-sector rejection', async () => {
    const supa = new FakeSupabase()
    const outcome = await qualifyCandidate(
      supa as any,
      { name: 'Evidenced Hotel Co', snippets: ['A boutique hotel chain with resorts across the coast.'] },
      'manufacturing',
    )
    expect(outcome.status).toBe('disqualified')
    const row = supa.table('company_registry').find((r: any) => r.id === outcome.companyId)!
    expect(row.sector_evidence.matched).toBe(false)
    expect(row.sector_evidence.matchedSignals).toEqual([])
    expect(row.domain_evidence).toBeNull()
  })

  it('stores null sector/domain evidence for an entity-type rejection (the check never ran)', async () => {
    const supa = new FakeSupabase()
    const outcome = await qualifyCandidate(supa as any, { name: 'CLEPA', snippets: ['A manufacturer with revenue of ₹100 crore.'] }, 'manufacturing')
    expect(outcome.status).toBe('disqualified')
    const row = supa.table('company_registry').find((r: any) => r.id === outcome.companyId)!
    expect(row.sector_evidence).toBeNull()
    expect(row.domain_evidence).toBeNull()
  })
})

describe('qualifyAndAnnotate — batch qualification with funnel recording', () => {
  it('annotates every item (including locked ones) and records the funnel correctly', async () => {
    const supa = new FakeSupabase()
    // Actually qualify it first (not just upsertDiscovered) so it carries
    // the current qualification_version and the later duplicate check
    // short-circuits instead of re-evaluating (see the describe block
    // above for why a bare upsertDiscovered() row wouldn't do this).
    const firstPass = await qualifyCandidate(supa as any, { name: 'Already Known Co', domain: 'known.com', snippets: ['A manufacturer with revenue of ₹100 crore.'] }, 'manufacturing')
    expect(firstPass.status).toBe('qualified')

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
