// ============================================================
// processFollowupForContact — concurrency + ambiguous-outcome tests
// ============================================================
// Post-Hardening Pilot Readiness Plan, Phase A. This is the single shared
// choke point behind manual "Send Now", "Process Follow-ups", and the
// automatic follow-up engine (Step A3/A6), and the place a Gmail-timeout
// must not be silently treated as safe-to-retry (Step A4).
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeSupabase } from './helpers/fake-supabase'

vi.mock('../lib/outbound/sending/provider-factory', () => ({
  sendEmail: vi.fn(),
}))

import { sendEmail } from '../lib/outbound/sending/provider-factory'
import { processFollowupForContact } from '../lib/outbound/sending/process-followup'

const NO_GMAIL = { accessToken: null }
const INTERVALS: readonly [number, number, number] = [3, 5, 7]

function seedContact(supabase: FakeSupabase, overrides: Partial<Record<string, any>> = {}) {
  supabase.seed('outbound_campaign_contacts', [
    { id: 'cc1', campaign_id: 'camp1', contact_id: 'contact1', status: 'sent', provider_message_id: null, updated_at: new Date().toISOString(), ...overrides },
  ])
  supabase.seed('outbound_contacts', [{ id: 'contact1', email: 'jane@acme.com' }])
  supabase.seed('outbound_generated_content', [
    { contact_id: 'contact1', selected_subject_line: 'Hi Jane', followups: [{ sequence: 1, body: 'Following up' }] },
  ])
}

beforeEach(() => {
  vi.mocked(sendEmail).mockReset()
})

describe('processFollowupForContact — concurrency', () => {
  it('two concurrent calls for the same contact: only one actually sends', async () => {
    const supabase = new FakeSupabase()
    seedContact(supabase)
    vi.mocked(sendEmail).mockResolvedValue({ status: 'sent', providerMessageId: 'm1', providerUsed: 'gmail' })

    const [a, b] = await Promise.all([
      processFollowupForContact(supabase as any, 'camp1', 'cc1', NO_GMAIL, INTERVALS, true),
      processFollowupForContact(supabase as any, 'camp1', 'cc1', NO_GMAIL, INTERVALS, true),
    ])

    const outcomes = [a.status, b.status].sort()
    expect(outcomes).toEqual(['sent', 'skipped'])
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('processFollowupForContact — ambiguous send outcome', () => {
  it('does not roll back the claimed status, and logs a send_ambiguous event', async () => {
    const supabase = new FakeSupabase()
    seedContact(supabase)
    vi.mocked(sendEmail).mockResolvedValue({ status: 'failed', ambiguous: true, error: 'Gmail send request timed out after 15000ms', providerUsed: 'gmail' })

    const outcome = await processFollowupForContact(supabase as any, 'camp1', 'cc1', NO_GMAIL, INTERVALS, true)

    expect(outcome.status).toBe('ambiguous')
    // Still claimed as followup_1 — NOT rolled back to 'sent' (which would
    // make it retry-eligible and risk a real duplicate send).
    expect(supabase.table('outbound_campaign_contacts')[0].status).toBe('followup_1')
    const events = supabase.table('outbound_campaign_events')
    expect(events.some(e => e.event_type === 'send_ambiguous')).toBe(true)
    expect(events.some(e => e.event_type === 'send_failed')).toBe(false)
  })

  it('a genuine (non-ambiguous) failure IS rolled back to the prior status, retry-eligible', async () => {
    const supabase = new FakeSupabase()
    seedContact(supabase)
    vi.mocked(sendEmail).mockResolvedValue({ status: 'failed', error: 'Gmail send failed: invalid recipient', providerUsed: 'gmail' })

    const outcome = await processFollowupForContact(supabase as any, 'camp1', 'cc1', NO_GMAIL, INTERVALS, true)

    expect(outcome.status).toBe('failed')
    expect(supabase.table('outbound_campaign_contacts')[0].status).toBe('sent') // rolled back
    const events = supabase.table('outbound_campaign_events')
    expect(events.some(e => e.event_type === 'send_failed')).toBe(true)
  })

  it('a retry after a genuine rollback can still claim and send — not blocked forever', async () => {
    const supabase = new FakeSupabase()
    seedContact(supabase)
    vi.mocked(sendEmail).mockResolvedValueOnce({ status: 'failed', error: 'transient', providerUsed: 'gmail' })
    const first = await processFollowupForContact(supabase as any, 'camp1', 'cc1', NO_GMAIL, INTERVALS, true)
    expect(first.status).toBe('failed')

    vi.mocked(sendEmail).mockResolvedValueOnce({ status: 'sent', providerMessageId: 'm2', providerUsed: 'gmail' })
    const second = await processFollowupForContact(supabase as any, 'camp1', 'cc1', NO_GMAIL, INTERVALS, true)
    expect(second.status).toBe('sent')
    expect(sendEmail).toHaveBeenCalledTimes(2)
  })

  it('after an AMBIGUOUS outcome, a later invocation advances to the NEXT sequence — it never re-sends the same followup', async () => {
    const supabase = new FakeSupabase()
    seedContact(supabase)
    // Two drafts available, so the second call has somewhere to go.
    supabase.seed('outbound_generated_content', [
      { contact_id: 'contact1', selected_subject_line: 'Hi Jane', followups: [
        { sequence: 1, body: 'Following up' },
        { sequence: 2, body: 'Second follow-up' },
      ] },
    ])
    vi.mocked(sendEmail).mockResolvedValueOnce({ status: 'failed', ambiguous: true, error: 'timeout', providerUsed: 'gmail' })
    const first = await processFollowupForContact(supabase as any, 'camp1', 'cc1', NO_GMAIL, INTERVALS, true)
    expect(first.status).toBe('ambiguous')
    expect(first.sequence).toBe(1)

    // Since the row is left at followup_1 (treated as "handled", not
    // rolled back), a later invocation reads that as its new starting
    // point and moves on to followup_2 — it can never re-target sequence 1
    // again, so the original ambiguous send can't be silently duplicated.
    vi.mocked(sendEmail).mockResolvedValueOnce({ status: 'sent', providerMessageId: 'm2', providerUsed: 'gmail' })
    const second = await processFollowupForContact(supabase as any, 'camp1', 'cc1', NO_GMAIL, INTERVALS, true)
    expect(second.status).toBe('sent')
    expect(second.sequence).toBe(2)
    expect(sendEmail).toHaveBeenCalledTimes(2)
  })
})
