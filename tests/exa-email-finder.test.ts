// ============================================================
// Exa Email Finder Provider — tests
// ============================================================
// lib/enrichment/sources/exa-client.ts and the credential helper are both
// mocked entirely — no live network call, no dependency on EXA_API_KEY
// being set, no real setTimeout delays (exaWaitForWebsetIdle itself is
// mocked, so its internal polling loop never actually runs here).
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/enrichment/sources/exa-client', () => ({
  exaCreateWebset: vi.fn(),
  exaWaitForWebsetIdle: vi.fn(),
  exaListWebsetItems: vi.fn(),
}))

vi.mock('@/lib/outbound/shared/exa-outbound-client', () => ({
  getExaCredential: vi.fn(),
}))

import { exaCreateWebset, exaWaitForWebsetIdle, exaListWebsetItems } from '@/lib/enrichment/sources/exa-client'
import { getExaCredential } from '@/lib/outbound/shared/exa-outbound-client'
import { ExaEmailFinderProvider } from '@/lib/outbound/email-finder/providers/exa'

function idleWebset(overrides: Partial<{ status: string }> = {}) {
  return {
    id: 'webset_1',
    status: 'idle',
    searches: [],
    enrichments: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('ExaEmailFinderProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(exaCreateWebset).mockResolvedValue(idleWebset({ status: 'running' }) as any)
  })

  it('errors without a personName', async () => {
    const result = await ExaEmailFinderProvider.findEmail({ personName: '', companyName: 'Acme', domain: 'acme.com' })
    expect(result.status).toBe('error')
  })

  it('errors with no API key configured', async () => {
    vi.mocked(getExaCredential).mockResolvedValue(null)
    const result = await ExaEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme', domain: 'acme.com' })
    expect(result.status).toBe('error')
    expect(result.reason).toContain('API key')
  })

  it('creates a person Webset with an email enrichment naming the person + company', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    vi.mocked(exaWaitForWebsetIdle).mockResolvedValue(idleWebset() as any)
    vi.mocked(exaListWebsetItems).mockResolvedValue({ data: [], hasMore: false })

    await ExaEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme Corp', domain: 'acme.com' })

    const [body, key] = vi.mocked(exaCreateWebset).mock.calls[0]
    expect(body.search.entity).toEqual({ type: 'person' })
    expect(body.search.query).toContain('Jane Doe')
    expect(body.search.query).toContain('Acme Corp')
    expect(body.enrichments?.[0].format).toBe('email')
    expect(key).toBe('key')
  })

  it('extracts an email from the item enrichments, whatever shape they arrive in', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    vi.mocked(exaWaitForWebsetIdle).mockResolvedValue(idleWebset() as any)
    vi.mocked(exaListWebsetItems).mockResolvedValue({
      data: [
        {
          id: 'item1',
          websetId: 'webset_1',
          properties: {},
          enrichments: { email: [{ result: ['jane.doe@acme.com'] }] },
        },
      ],
      hasMore: false,
    })

    const result = await ExaEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme Corp', domain: 'acme.com' })

    expect(result.status).toBe('found')
    expect(result.email).toBe('jane.doe@acme.com')
    expect(result.confidence).toBe('medium')
  })

  it('never fabricates an email when no item is returned', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    vi.mocked(exaWaitForWebsetIdle).mockResolvedValue(idleWebset() as any)
    vi.mocked(exaListWebsetItems).mockResolvedValue({ data: [], hasMore: false })

    const result = await ExaEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme Corp', domain: 'acme.com' })

    expect(result.status).toBe('not_found')
    expect(result.email).toBeNull()
  })

  it('never fabricates an email when the item has no email-shaped enrichment', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    vi.mocked(exaWaitForWebsetIdle).mockResolvedValue(idleWebset() as any)
    vi.mocked(exaListWebsetItems).mockResolvedValue({
      data: [{ id: 'item1', websetId: 'webset_1', properties: {}, enrichments: { email: [{ result: [] }] } }],
      hasMore: false,
    })

    const result = await ExaEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme Corp', domain: 'acme.com' })

    expect(result.status).toBe('not_found')
    expect(result.email).toBeNull()
  })

  it('reports a timeout as not_found (not error) and never hangs', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    // Simulates exaWaitForWebsetIdle giving up at its own timeoutMs boundary
    // and returning the Webset in whatever non-idle status it last saw —
    // this test asserts on that return contract, not on real wall-clock
    // time (exaWaitForWebsetIdle's internal polling loop is mocked away
    // entirely, so this resolves synchronously).
    vi.mocked(exaWaitForWebsetIdle).mockResolvedValue(idleWebset({ status: 'running' }) as any)

    const result = await ExaEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme Corp', domain: 'acme.com' })

    expect(result.status).toBe('not_found')
    expect(result.reason).toContain('did not finish within')
    expect(exaListWebsetItems).not.toHaveBeenCalled()
  })

  it('never throws when Webset creation itself fails', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    vi.mocked(exaCreateWebset).mockRejectedValue(new Error('exa down'))

    const result = await ExaEmailFinderProvider.findEmail({ personName: 'Jane Doe', companyName: 'Acme Corp', domain: 'acme.com' })

    expect(result.status).toBe('error')
    expect(result.reason).toBe('exa down')
  })

  it('isAvailable reflects whether a credential is configured', async () => {
    vi.mocked(getExaCredential).mockResolvedValue('key')
    expect(await ExaEmailFinderProvider.isAvailable()).toBe(true)

    vi.mocked(getExaCredential).mockResolvedValue(null)
    expect(await ExaEmailFinderProvider.isAvailable()).toBe(false)
  })
})
