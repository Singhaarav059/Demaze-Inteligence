// ============================================================
// processFollowupForContact — reply cancels follow-up, bounce suppresses
// ============================================================
// Pilot Readiness Plan Phase C2/C3: verifies the actual mechanism (not just
// the downstream status-set exclusion already covered elsewhere) — a
// detected reply must cancel the pending follow-up, and a detected bounce
// must both cancel it AND add the address to the real suppression list
// (which sendEmail() checks before every future send, including a later
// campaign or follow-up attempt).
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeSupabase } from './helpers/fake-supabase'

const state = vi.hoisted(() => ({ supabase: null as FakeSupabase | null }))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => state.supabase,
}))

vi.mock('../lib/outbound/sending/provider-factory', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('../lib/outbound/shared/gmail-client', () => ({
  getGmailThread: vi.fn(),
  findReplyInThread: vi.fn(),
  getLastMessageIdHeader: vi.fn(() => undefined),
  looksLikeBounce: vi.fn(),
}))

import { sendEmail } from '../lib/outbound/sending/provider-factory'
import { getGmailThread, findReplyInThread, looksLikeBounce } from '../lib/outbound/shared/gmail-client'
import { processFollowupForContact } from '../lib/outbound/sending/process-followup'
import { isSuppressed } from '../lib/outbound/sending/suppression'

const GMAIL_CTX = { accessToken: 'tok', connectedEmail: 'me@demaze.com' }
const INTERVALS: readonly [number, number, number] = [3, 5, 7]

function seedContact(supabase: FakeSupabase) {
  supabase.seed('outbound_campaign_contacts', [
    { id: 'cc1', campaign_id: 'camp1', contact_id: 'contact1', status: 'sent', provider_message_id: 'thread1', updated_at: new Date().toISOString() },
  ])
  supabase.seed('outbound_contacts', [{ id: 'contact1', email: 'jane@acme.com' }])
  supabase.seed('outbound_generated_content', [
    { contact_id: 'contact1', selected_subject_line: 'Hi Jane', followups: [{ sequence: 1, body: 'Following up' }] },
  ])
}

beforeEach(() => {
  vi.mocked(sendEmail).mockReset()
  vi.mocked(getGmailThread).mockReset()
  vi.mocked(findReplyInThread).mockReset()
  vi.mocked(looksLikeBounce).mockReset()
})

describe('processFollowupForContact — reply detected', () => {
  it('cancels the follow-up, never calls sendEmail, and marks the contact replied', async () => {
    const supabase = new FakeSupabase()
    seedContact(supabase)
    state.supabase = supabase

    vi.mocked(getGmailThread).mockResolvedValue({ ok: true, messages: [{ id: 'm1' } as any] })
    vi.mocked(findReplyInThread).mockReturnValue({ hasReply: true, replyMessageId: 'm1', fromHeader: 'jane@acme.com' } as any)
    vi.mocked(looksLikeBounce).mockReturnValue(false)

    const outcome = await processFollowupForContact(supabase as any, 'camp1', 'cc1', GMAIL_CTX, INTERVALS, true)

    expect(outcome.status).toBe('cancelled_reply')
    expect(sendEmail).not.toHaveBeenCalled()
    expect(supabase.table('outbound_campaign_contacts')[0].status).toBe('replied')
    expect(supabase.table('outbound_campaign_events').some((e: any) => e.event_type === 'replied')).toBe(true)
  })
})

describe('processFollowupForContact — bounce detected', () => {
  it('cancels the follow-up, never calls sendEmail, marks bounced, and adds the address to the real suppression list', async () => {
    const supabase = new FakeSupabase()
    seedContact(supabase)
    state.supabase = supabase

    vi.mocked(getGmailThread).mockResolvedValue({ ok: true, messages: [{ id: 'm1' } as any] })
    vi.mocked(findReplyInThread).mockReturnValue({ hasReply: true, replyMessageId: 'm1', fromHeader: 'mailer-daemon@acme.com' } as any)
    vi.mocked(looksLikeBounce).mockReturnValue(true)

    const outcome = await processFollowupForContact(supabase as any, 'camp1', 'cc1', GMAIL_CTX, INTERVALS, true)

    expect(outcome.status).toBe('cancelled_bounce')
    expect(sendEmail).not.toHaveBeenCalled()
    expect(supabase.table('outbound_campaign_contacts')[0].status).toBe('bounced')

    // The real hard-block gate: a later send attempt for this address must
    // now be refused.
    const suppressed = await isSuppressed('jane@acme.com')
    expect(suppressed.suppressed).toBe(true)
    expect(suppressed.reason).toBe('bounced')
  })
})
