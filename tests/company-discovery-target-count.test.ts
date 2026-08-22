// ============================================================
// discoverCompaniesUntil — the target-count discovery loop
// ============================================================
// Mocks the search/domain-resolution layer (routedSearch, discoverCompanyWebsite)
// so this exercises real extraction/grouping/qualification logic against
// controlled, deterministic input, with zero live network/API calls.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeSupabase } from './helpers/fake-supabase'

vi.mock('../lib/enrichment/search-router', () => ({
  routedSearch: vi.fn(async () => ({
    results: [
      { title: 'Top companies', url: 'https://example.com/list', content: 'Leading companies include Alpha Manufacturing, Beta Component Works.' },
    ],
    triedTiers: ['tavily'],
    sufficientAt: 'tavily',
  })),
}))

vi.mock('../lib/enrichment/website-discovery', () => ({
  discoverCompanyWebsite: vi.fn(async () => ({ status: 'not_found', domain: null, confidence: 'none', candidates: [], reason: 'mocked' })),
}))

// company-qualification.ts's assessCompanySize() now has a 3rd, LLM-backed
// tier (added 2026-08-20) reached whenever snippet+homepage evidence both
// stay 'unknown' — exactly this test file's fixtures (no domain, no stated
// revenue). Mocked to always decline ("unknown"), matching this test
// file's own "zero live network/API calls" discipline and preserving the
// existing qualify-despite-unknown-size behavior these tests assert on.
vi.mock('../lib/ai/provider-factory', () => ({
  getCompletion: vi.fn(async () => ({ content: '{"scale":"unknown"}', model: 'test', providerName: 'test' })),
}))

import { discoverCompaniesUntil } from '../lib/enrichment/company-discovery'

beforeEach(() => {
  process.env.TAVILY_API_KEY = 'test-key'
})

describe('discoverCompaniesUntil — stops at target_reached', () => {
  it('stops as soon as enough genuinely new companies are qualified', async () => {
    const supa = new FakeSupabase()
    const result = await discoverCompaniesUntil(supa as any, 'manufacturing', 2)
    expect(result.stoppedReason).toBe('target_reached')
    expect(result.companies.length).toBeGreaterThanOrEqual(2)
    expect(result.companies).toHaveLength(2)
  })

  it('records the discovered/qualified funnel counts honestly', async () => {
    const supa = new FakeSupabase()
    const result = await discoverCompaniesUntil(supa as any, 'manufacturing', 2)
    expect(result.funnel.qualified).toBe(2)
    expect(result.funnel.discovered).toBeGreaterThanOrEqual(2)
  })
})

describe('discoverCompaniesUntil — never counts duplicates toward the target', () => {
  it('gives up honestly (max_iterations) rather than fabricating extra companies once the same 2 keep resurfacing as duplicates', async () => {
    const supa = new FakeSupabase()
    // Only 2 distinct companies are ever extractable from the mocked search
    // results — asking for 5 must not silently return fewer AND claim
    // "target_reached", it must honestly report it couldn't get there.
    const result = await discoverCompaniesUntil(supa as any, 'manufacturing', 5)
    expect(result.stoppedReason).not.toBe('target_reached')
    expect(result.companies.length).toBeLessThan(5)
    // The 2 real companies still only count once each — every later
    // iteration's re-discovery of the same 2 names is recorded as a
    // duplicate, not as new qualified companies.
    expect(result.funnel.duplicate).toBeGreaterThan(0)
  }, 20000)
})
