// ============================================================
// classifyCampaignContacts — Phase B blocking-status tests
// ============================================================
// isSuppressed() (called internally) is mocked to {suppressed: false} for
// every test below except the dedicated fail-closed case at the bottom —
// isSuppressed() itself now fails CLOSED on a DB error (see suppression.ts
// / tests/suppression.test.ts), and this test environment has no Supabase
// env vars configured, so leaving it unmocked would make every contact here
// resolve as "suppressed" regardless of what each test is actually
// exercising (B4/B5/B6). Mocking it keeps these tests isolated to the
// specific check each one targets.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

const suppressionState = vi.hoisted(() => ({ result: { suppressed: false } as { suppressed: boolean; reason?: string; detail?: string | null; checkFailed?: boolean } }))

vi.mock('../lib/outbound/sending/suppression', () => ({
  isSuppressed: vi.fn(() => Promise.resolve(suppressionState.result)),
}))

import { classifyCampaignContacts } from '../lib/outbound/sending/campaign-review'
import { FakeSupabase } from './helpers/fake-supabase'

function seedContact(supabase: FakeSupabase, overrides: Record<string, unknown> = {}) {
  supabase.seed('outbound_contacts', [
    { id: 'c1', person_name: 'Jane Doe', email: 'jane@acme.com', email_confidence: 'high', discovery_grounding_status: 'confirmed', discovery_grounding_reason: null, ...overrides },
  ])
  supabase.seed('outbound_generated_content', [
    { contact_id: 'c1', selected_subject_line: 'Hi Jane', email_draft: { fullText: 'Body text', claimGroundingCheck: { hasUnsupportedClaim: false } } },
  ])
  supabase.seed('outbound_campaign_contacts', [])
}

describe('classifyCampaignContacts — Phase B blocking checks', () => {
  beforeEach(() => {
    suppressionState.result = { suppressed: false }
  })

  it('a normal, clean contact is ready', async () => {
    const supabase = new FakeSupabase()
    seedContact(supabase)
    const summary = await classifyCampaignContacts(supabase as any, 'camp1', ['c1'])
    expect(summary.rows[0].status).toBe('ready')
    expect(summary.ready).toBe(1)
    expect(summary.blocked).toBe(0)
  })

  it('B6 — a malformed email blocks, distinct from missing_email', async () => {
    const supabase = new FakeSupabase()
    seedContact(supabase, { email: 'not-an-email' })
    const summary = await classifyCampaignContacts(supabase as any, 'camp1', ['c1'])
    expect(summary.rows[0].status).toBe('blocked')
    expect(summary.rows[0].blockReason).toBe('invalid_email_format')
    expect(summary.blocked).toBe(1)
  })

  it('B4 — a grounding conflict blocks', async () => {
    const supabase = new FakeSupabase()
    seedContact(supabase, { discovery_grounding_status: 'conflict' })
    const summary = await classifyCampaignContacts(supabase as any, 'camp1', ['c1'])
    expect(summary.rows[0].status).toBe('blocked')
    expect(summary.rows[0].blockReason).toBe('company_identity_mismatch')
  })

  it('B4 — not_found grounding does NOT block, stays ready (advisory only)', async () => {
    const supabase = new FakeSupabase()
    seedContact(supabase, { discovery_grounding_status: 'not_found' })
    const summary = await classifyCampaignContacts(supabase as any, 'camp1', ['c1'])
    expect(summary.rows[0].status).toBe('ready')
    expect(summary.rows[0].discoveryGroundingStatus).toBe('not_found')
  })

  it('B5 — an unsupported-claim draft blocks', async () => {
    const supabase = new FakeSupabase()
    seedContact(supabase)
    supabase.seed('outbound_generated_content', [
      { contact_id: 'c1', selected_subject_line: 'Hi Jane', email_draft: { fullText: 'Body text', claimGroundingCheck: { hasUnsupportedClaim: true, reason: 'fabricated number' } } },
    ])
    const summary = await classifyCampaignContacts(supabase as any, 'camp1', ['c1'])
    expect(summary.rows[0].status).toBe('blocked')
    expect(summary.rows[0].blockReason).toBe('unsupported_claim')
    expect(summary.rows[0].reason).toBe('fabricated number')
  })

  it('a draft generated before claimGroundingCheck existed (undefined) is treated as passing', async () => {
    const supabase = new FakeSupabase()
    seedContact(supabase)
    supabase.seed('outbound_generated_content', [
      { contact_id: 'c1', selected_subject_line: 'Hi Jane', email_draft: { fullText: 'Body text' } },
    ])
    const summary = await classifyCampaignContacts(supabase as any, 'camp1', ['c1'])
    expect(summary.rows[0].status).toBe('ready')
  })

  it('missing_email is still checked before any blocking check runs', async () => {
    const supabase = new FakeSupabase()
    seedContact(supabase, { email: null })
    const summary = await classifyCampaignContacts(supabase as any, 'camp1', ['c1'])
    expect(summary.rows[0].status).toBe('missing_email')
  })

  it('an unresolved suppression check (fail-closed) surfaces as suppressed, not ready', async () => {
    suppressionState.result = {
      suppressed: true,
      checkFailed: true,
      detail: 'Suppression status could not be verified (the suppression list was unreachable) — treated as suppressed pending manual review.',
    }
    const supabase = new FakeSupabase()
    seedContact(supabase)
    const summary = await classifyCampaignContacts(supabase as any, 'camp1', ['c1'])
    expect(summary.rows[0].status).toBe('suppressed')
    expect(summary.rows[0].reason).toMatch(/could not be verified/i)
  })
})
