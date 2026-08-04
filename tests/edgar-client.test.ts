// ============================================================
// SEC EDGAR client tests
// ============================================================
// matchTicker() is pure (no network) — tested directly against synthetic
// ticker-map fixtures, same "prefer under-confidence, refuse to guess when
// ambiguous" cases this codebase already tests for website-discovery.ts's
// matching (single-word-name guard, genuine name-collision -> no match).
// fetchEdgarFilings() is tested with global.fetch mocked, same precedent as
// tests/prospeo-client.test.ts / tests/website-discovery.test.ts.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { matchTicker } from '../lib/enrichment/sources/edgar-client'

const TICKERS = [
  { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  { cik_str: 1018724, ticker: 'AMZN', title: 'AMAZON COM INC' },
  { cik_str: 200406, ticker: 'JNJ', title: 'JOHNSON & JOHNSON' },
  { cik_str: 5, ticker: 'AIR', title: 'AAR CORP' },
  { cik_str: 6, ticker: 'AIRX', title: 'AAR INDUSTRIES INC' },
]

describe('matchTicker', () => {
  it('matches an exact normalized name (legal suffix stripped)', () => {
    const m = matchTicker('Apple', TICKERS)
    expect(m?.ticker).toBe('AAPL')
  })

  it('matches with the legal suffix present on the query side too', () => {
    const m = matchTicker('Apple Inc.', TICKERS)
    expect(m?.ticker).toBe('AAPL')
  })

  it('refuses a single-word query name even if it would substring-match', () => {
    // "Amazon" alone must not loosely match "AMAZON COM INC" via the
    // multi-word containment tier — single-word names require a full exact
    // normalized-title match, same guard as website-discovery.ts's AITG case.
    const m = matchTicker('Amazon', TICKERS)
    expect(m).toBeNull()
  })

  it('matches a single-word query when it IS the full normalized title', () => {
    const single = [{ cik_str: 1, ticker: 'X', title: 'Testco' }]
    const m = matchTicker('Testco', single)
    expect(m?.ticker).toBe('X')
  })

  it('refuses an ambiguous match across two similarly-named entries', () => {
    // Neither entry exactly normalizes to the query, but both satisfy the
    // word-boundary containment tier for "Meridian Industries" — genuinely
    // two different real-world entities, must not guess between them.
    const ambiguous = [
      { cik_str: 100, ticker: 'MDA', title: 'Meridian Industries International' },
      { cik_str: 101, ticker: 'MDB', title: 'Meridian Industries Group' },
    ]
    const m = matchTicker('Meridian Industries', ambiguous)
    expect(m).toBeNull()
  })

  it('matches multi-word names via word-boundary containment', () => {
    const m = matchTicker('Johnson and Johnson', TICKERS)
    expect(m?.ticker).toBe('JNJ')
  })

  it('does not match when the candidate title is far longer than the query (containment guard)', () => {
    // A 2-word query specifically (not single-word) — exercises the Tier-3
    // length guard itself, not the separate single-word-query refusal.
    const tickers = [{ cik_str: 9, ticker: 'X', title: 'Apple Valley Regional Medical Center Holdings Trust Enterprises' }]
    const m = matchTicker('Apple Valley', tickers)
    expect(m).toBeNull()
  })

  it('returns null for an empty query', () => {
    expect(matchTicker('', TICKERS)).toBeNull()
  })
})

// edgar-client.ts memoizes the ticker map at module scope (cache-on-success
// only, see its own comment) — each test here needs a fresh module instance
// so one test's mocked fetch behavior can't leak into the next via that
// cache. vi.resetModules() + a dynamic import per test achieves that
// without adding any test-only reset hook to the production module.
describe('fetchEdgarFilings', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn()
    vi.resetModules()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns null when the ticker map fetch fails', async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false } as Response)
    const { fetchEdgarFilings } = await import('../lib/enrichment/sources/edgar-client')
    const result = await fetchEdgarFilings('Some Company')
    expect(result).toBeNull()
  })

  it('returns null for a company with no confident match', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ '0': TICKERS[0] }),
    } as Response)
    const { fetchEdgarFilings } = await import('../lib/enrichment/sources/edgar-client')
    const result = await fetchEdgarFilings('Totally Unrelated Widgets Ltd')
    expect(result).toBeNull()
  })

  it('builds a formatted context block for a confident match', async () => {
    const { fetchEdgarFilings } = await import('../lib/enrichment/sources/edgar-client')
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => Object.fromEntries(TICKERS.map((t, i) => [String(i), t])),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'Apple Inc.',
          sicDescription: 'Electronic Computers',
          addresses: { business: { city: 'Cupertino', stateOrCountry: 'CA' } },
          filings: {
            recent: {
              form: ['10-K', '8-K'],
              filingDate: ['2026-01-15', '2026-02-01'],
              primaryDocument: ['aapl-10k.htm', 'aapl-8k.htm'],
              accessionNumber: ['0000320193-26-000010', '0000320193-26-000012'],
            },
          },
        }),
      } as Response)

    const result = await fetchEdgarFilings('Apple')
    expect(result).not.toBeNull()
    expect(result?.cik).toBe(320193)
    expect(result?.contextBlock).toContain('SEC EDGAR Filings')
    expect(result?.contextBlock).toContain('CIK 320193')
    expect(result?.contextBlock).toContain('Electronic Computers')
    expect(result?.contextBlock).toContain('Cupertino, CA')
    // 8-K (a HIGH_SIGNAL_FORMS entry) should be listed before the 10-K
    // despite the 10-K having no later date to break the tie on its own —
    // proves the signal-relevance sort, not just a date sort.
    const eightKIndex = result!.contextBlock.indexOf('8-K filed')
    const tenKIndex = result!.contextBlock.indexOf('10-K filed')
    expect(eightKIndex).toBeGreaterThan(-1)
    expect(eightKIndex).toBeLessThan(tenKIndex)
    expect(result?.contextBlock).toContain('sec.gov/Archives/edgar/data/320193/000032019326000012/aapl-8k.htm')
  })

  it('returns null when the submissions fetch fails after a ticker match', async () => {
    const { fetchEdgarFilings } = await import('../lib/enrichment/sources/edgar-client')
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => Object.fromEntries(TICKERS.map((t, i) => [String(i), t])),
      } as Response)
      .mockResolvedValueOnce({ ok: false } as Response)

    const result = await fetchEdgarFilings('Apple')
    expect(result).toBeNull()
  })
})
