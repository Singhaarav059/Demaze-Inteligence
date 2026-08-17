// ============================================================
// POST /api/admin/outbound/campaigns/[id]/send — concurrency + pause tests
// ============================================================
// Post-Hardening Pilot Readiness Plan, Phase A. Drives the REAL route
// handler (not a reimplementation) against a fake Supabase client and a
// mocked sendEmail, since ADMIN_SECRET is unset in tests so
// verifyAdminRequest() passes through with no auth mocking needed.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeSupabase } from './helpers/fake-supabase'

// vi.hoisted so this mutable box exists before the hoisted vi.mock factory
// below runs — a plain top-level const referenced inside vi.mock would hit
// vitest's "cannot access before initialization" hoisting error.
const state = vi.hoisted(() => ({ supabase: null as FakeSupabase | null }))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => state.supabase,
}))

vi.mock('@/lib/outbound/sending/provider-factory', () => ({
  sendEmail: vi.fn(),
}))

import { sendEmail } from '@/lib/outbound/sending/provider-factory'
import { POST } from '../app/api/admin/outbound/campaigns/[id]/send/route'

function makeReq(body: Record<string, unknown> = {}) {
  return new NextRequest('https://example.com/api/admin/outbound/campaigns/camp1/send', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function seed(campaignStatus: string = 'active') {
  const supa = new FakeSupabase()
  supa.seed('outbound_campaigns', [
    { id: 'camp1', status: campaignStatus, daily_send_limit: null, send_window_start: null, send_window_end: null, timezone: 'UTC' },
  ])
  supa.seed('outbound_campaign_contacts', [
    { id: 'cc1', campaign_id: 'camp1', contact_id: 'contact1', status: 'queued' },
  ])
  supa.seed('outbound_contacts', [{ id: 'contact1', email: 'jane@acme.com' }])
  supa.seed('outbound_generated_content', [
    { id: 'gen1', contact_id: 'contact1', selected_subject_line: 'Hi Jane', email_draft: { fullText: 'Body text' } },
  ])
  return supa
}

function useSupabase(fresh: FakeSupabase) {
  state.supabase = fresh
}

beforeEach(() => {
  vi.mocked(sendEmail).mockReset()
})

describe('POST campaigns/[id]/send — pause guard', () => {
  it('a paused campaign sends nothing at all', async () => {
    useSupabase(seed('paused'))
    const res = await POST(makeReq(), { params: Promise.resolve({ id: 'camp1' }) })
    const json = await res.json()
    expect(json.sent).toBe(0)
    expect(json.total).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('does not clobber a pause that happened mid-batch back to active', async () => {
    const supa = seed('active')
    useSupabase(supa)
    // Simulate another request pausing the campaign while this send is
    // still in flight (mid-loop side effect on the mocked sendEmail call).
    vi.mocked(sendEmail).mockImplementation(async () => {
      supa.table('outbound_campaigns')[0].status = 'paused'
      return { status: 'sent', providerMessageId: 'm1', providerUsed: 'gmail' }
    })

    await POST(makeReq(), { params: Promise.resolve({ id: 'camp1' }) })
    expect(supa.table('outbound_campaigns')[0].status).toBe('paused')
  })
})

describe('POST campaigns/[id]/send — concurrent double-send', () => {
  it('two overlapping POSTs for the same contact: exactly one real send', async () => {
    useSupabase(seed('active'))
    vi.mocked(sendEmail).mockResolvedValue({ status: 'sent', providerMessageId: 'm1', providerUsed: 'gmail' })

    const [r1, r2] = await Promise.all([
      POST(makeReq(), { params: Promise.resolve({ id: 'camp1' }) }),
      POST(makeReq(), { params: Promise.resolve({ id: 'camp1' }) }),
    ])
    const [j1, j2] = await Promise.all([r1.json(), r2.json()])

    expect(j1.sent + j2.sent).toBe(1)
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('POST campaigns/[id]/send — Phase B safety-policy hard blocks (server-side enforcement)', () => {
  it('B6 — a malformed email is blocked, sendEmail is never called', async () => {
    const supa = seed('active')
    supa.table('outbound_contacts')[0].email = 'not-an-email'
    useSupabase(supa)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: 'camp1' }) })
    const json = await res.json()

    expect(json.blocked).toBe(1)
    expect(json.sent).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
    // Never claimed either — still sitting 'queued', not consumed by a
    // blocked attempt.
    expect(supa.table('outbound_campaign_contacts')[0].status).toBe('queued')
  })

  it('B4 — a grounding conflict is blocked, sendEmail is never called', async () => {
    const supa = seed('active')
    supa.table('outbound_contacts')[0].discovery_grounding_status = 'conflict'
    useSupabase(supa)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: 'camp1' }) })
    const json = await res.json()

    expect(json.blocked).toBe(1)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('B4 — not_found grounding is NOT blocked at the route either (advisory only)', async () => {
    const supa = seed('active')
    supa.table('outbound_contacts')[0].discovery_grounding_status = 'not_found'
    useSupabase(supa)
    vi.mocked(sendEmail).mockResolvedValue({ status: 'sent', providerMessageId: 'm1', providerUsed: 'gmail' })

    const res = await POST(makeReq(), { params: Promise.resolve({ id: 'camp1' }) })
    const json = await res.json()

    expect(json.blocked).toBe(0)
    expect(json.sent).toBe(1)
  })

  it('B5 — a draft with an unsupported claim is blocked, sendEmail is never called', async () => {
    const supa = seed('active')
    supa.table('outbound_generated_content')[0].email_draft = {
      fullText: 'Body text',
      claimGroundingCheck: { hasUnsupportedClaim: true, reason: 'fabricated number' },
    }
    useSupabase(supa)

    const res = await POST(makeReq(), { params: Promise.resolve({ id: 'camp1' }) })
    const json = await res.json()

    expect(json.blocked).toBe(1)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('POST campaigns/[id]/send — ambiguous timeout does not roll back to queued', () => {
  it('leaves the contact claimed and reports it separately from a definite failure', async () => {
    const supa = seed('active')
    useSupabase(supa)
    vi.mocked(sendEmail).mockResolvedValue({ status: 'failed', ambiguous: true, error: 'Gmail send request timed out after 15000ms', providerUsed: 'gmail' })

    const res = await POST(makeReq(), { params: Promise.resolve({ id: 'camp1' }) })
    const json = await res.json()

    expect(json.ambiguous).toBe(1)
    expect(json.failed).toBe(0)
    expect(supa.table('outbound_campaign_contacts')[0].status).toBe('sent') // still claimed, not back to 'queued'
    expect(supa.table('outbound_campaign_events').some((e: any) => e.event_type === 'send_ambiguous')).toBe(true)
  })

  it('a definite failure IS rolled back to queued, retry-eligible', async () => {
    const supa = seed('active')
    useSupabase(supa)
    vi.mocked(sendEmail).mockResolvedValue({ status: 'failed', error: 'Gmail send failed: invalid recipient', providerUsed: 'gmail' })

    const res = await POST(makeReq(), { params: Promise.resolve({ id: 'camp1' }) })
    const json = await res.json()

    expect(json.failed).toBe(1)
    expect(supa.table('outbound_campaign_contacts')[0].status).toBe('queued')
  })
})
