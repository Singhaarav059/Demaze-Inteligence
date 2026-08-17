// ============================================================
// POST /api/admin/outbound/campaigns/[id]/process-followups — pause guard
// ============================================================
// Pilot Readiness Plan, Phase C1: campaign pause must stop queued messages
// from processing — send/route.ts already had route-level test coverage
// for this (tests/send-route-concurrency.test.ts); this route's own
// identical pause check had none. Drives the real route handler, same
// pattern as that file.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeSupabase } from './helpers/fake-supabase'

const state = vi.hoisted(() => ({ supabase: null as FakeSupabase | null }))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => state.supabase,
}))

vi.mock('@/lib/outbound/sending/process-followup', () => ({
  processFollowupForContact: vi.fn(),
  resolveGmailContext: vi.fn(),
  FOLLOWUP_ELIGIBLE_STATUSES: ['sent', 'followup_1', 'followup_2'],
}))

import { processFollowupForContact } from '@/lib/outbound/sending/process-followup'
import { POST } from '../app/api/admin/outbound/campaigns/[id]/process-followups/route'

function makeReq(body: Record<string, unknown> = {}) {
  return new NextRequest('https://example.com/api/admin/outbound/campaigns/camp1/process-followups', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.mocked(processFollowupForContact).mockReset()
})

describe('POST campaigns/[id]/process-followups — pause guard', () => {
  it('a paused campaign processes no follow-ups at all', async () => {
    const supa = new FakeSupabase()
    supa.seed('outbound_campaigns', [
      { id: 'camp1', status: 'paused', daily_send_limit: null, send_window_start: null, send_window_end: null, timezone: 'UTC' },
    ])
    supa.seed('outbound_campaign_contacts', [
      { id: 'cc1', campaign_id: 'camp1', contact_id: 'contact1', status: 'sent' },
    ])
    state.supabase = supa

    const res = await POST(makeReq(), { params: Promise.resolve({ id: 'camp1' }) })
    const json = await res.json()

    expect(json.processed).toBe(0)
    expect(processFollowupForContact).not.toHaveBeenCalled()
  })
})
