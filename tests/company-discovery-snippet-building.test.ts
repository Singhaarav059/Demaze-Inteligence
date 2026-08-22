// ============================================================
// discoverCompaniesForSector — snippet building combines title + content
// ============================================================
// Real bug found live 2026-08-19: a real, non-mega-cap manufacturer was
// rejected as wrong_sector because the candidate's stored "snippet" was
// built as (content || title) — for a numbered-list-style search result,
// content is often a bare enumeration with zero descriptive words, while
// the actual sector context ("Canada's Top 10 Manufacturers") sits in the
// title, which got silently discarded whenever content was non-empty.
//
// Fixture originally used "Magna International" (the real company that
// surfaced this bug live) — swapped to "Uno Minda" 2026-08-19 after Magna
// International was separately added to company-discovery.ts's
// KNOWN_MEGA_CAP_NAMES list (a real, unrelated global mega-cap auto
// supplier, correctly rejected by that filter now) — this test is about
// title-vs-content snippet building, not size filtering, so the fixture
// needs a real, non-mega-cap manufacturer name to isolate the behavior
// this test actually checks.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/enrichment/search-router', () => ({
  routedSearch: vi.fn(async () => ({
    results: [
      {
        title: "Canada's Top 10 Manufacturers - Who they are & what they do",
        url: 'https://example.com/canada-manufacturers',
        content: '1. George Weston · 2. NOVAGOLD Resources · 3. Uno Minda · 4. Imperial Oil · 5. Suncor Energy',
      },
    ],
    triedTiers: ['tavily'],
    sufficientAt: 'tavily',
  })),
}))

vi.mock('../lib/enrichment/website-discovery', () => ({
  discoverCompanyWebsite: vi.fn(async () => ({ status: 'not_found', domain: null, confidence: 'none', candidates: [], reason: 'mocked' })),
}))

import { discoverCompaniesForSector } from '../lib/enrichment/company-discovery'

beforeEach(() => {
  process.env.TAVILY_API_KEY = 'test-key'
})

describe('discoverCompaniesForSector — snippet building', () => {
  it('does not reject a candidate as wrong_sector when the sector signal is only in the result title, not the content (the live Uno Minda / Magna International bug)', async () => {
    const result = await discoverCompaniesForSector('manufacturing', { batchSize: 1 })

    const names = result.companies.map(c => c.name)
    expect(names).toContain('Uno Minda')

    const rejectedNames = (result.rejected_candidates ?? []).map(r => r.name)
    expect(rejectedNames).not.toContain('Uno Minda')
  })
})
