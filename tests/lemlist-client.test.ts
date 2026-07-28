// ============================================================
// Lemlist — low-level client tests (real client, mocked global.fetch)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callLemlist, createLeadInCampaign } from '@/lib/outbound/shared/lemlist-client'

function mockFetchResponse(opts: { ok: boolean; status: number; text: string; headers?: Record<string, string> }) {
  return {
    ok: opts.ok,
    status: opts.status,
    text: async () => opts.text,
    headers: { get: (key: string) => opts.headers?.[key] ?? null },
  }
}

describe('callLemlist', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('parses a JSON success body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockFetchResponse({ ok: true, status: 200, text: JSON.stringify({ _id: 'abc' }) }))
    )

    const result = await callLemlist<{ _id: string }>('/campaigns/c1/leads', { apiKey: 'key', method: 'POST' })
    expect(result.ok).toBe(true)
    expect(result.data?._id).toBe('abc')
  })

  it('handles a plain-text error body without throwing (Lemlist does not always return JSON on error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockFetchResponse({ ok: false, status: 404, text: 'Campaign not found' }))
    )

    const result = await callLemlist('/campaigns/bad-id/leads', { apiKey: 'key', method: 'POST' })
    expect(result.ok).toBe(false)
    expect(result.data).toBeNull()
    expect(result.error).toBe('Campaign not found')
    expect(result.status).toBe(404)
  })

  it('sends a Basic auth header built from an empty username and the API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse({ ok: true, status: 200, text: '{}' }))
    vi.stubGlobal('fetch', fetchMock)

    await callLemlist('/campaigns/c1', { apiKey: 'secret-key-123' })

    const [, options] = fetchMock.mock.calls[0]
    const expected = `Basic ${Buffer.from(':secret-key-123', 'utf8').toString('base64')}`
    expect(options.headers.Authorization).toBe(expected)
  })

  it('reads rate-limit headers when present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockFetchResponse({
          ok: false,
          status: 429,
          text: 'Too Many Requests',
          headers: { 'X-RateLimit-Remaining': '0', 'Retry-After': '2' },
        })
      )
    )

    const result = await callLemlist('/campaigns/c1', { apiKey: 'key' })
    expect(result.rateLimitRemaining).toBe(0)
    expect(result.retryAfterSeconds).toBe(2)
  })

  it('never throws — resolves ok:false on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))

    const result = await callLemlist('/campaigns/c1', { apiKey: 'key' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('ECONNRESET')
  })
})

describe('createLeadInCampaign', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('posts to /campaigns/{id}/leads with the lead + custom variables in the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockFetchResponse({
        ok: true,
        status: 200,
        text: JSON.stringify({ _id: 'lead-1', campaignId: 'c1', email: 'a@b.com' }),
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createLeadInCampaign('key', 'c1', {
      email: 'a@b.com',
      subjectLine: 'Hello',
      icebreaker: 'Body text',
    })

    expect(result.ok).toBe(true)
    expect(result.data?._id).toBe('lead-1')

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/campaigns/c1/leads')
    const body = JSON.parse(options.body)
    expect(body.email).toBe('a@b.com')
    expect(body.subjectLine).toBe('Hello')
    expect(body.icebreaker).toBe('Body text')
  })
})
