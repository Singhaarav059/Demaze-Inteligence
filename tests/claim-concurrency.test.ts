// ============================================================
// Atomic contact claim — concurrency regression tests
// ============================================================
// Post-Hardening Pilot Readiness Plan, Phase A, Step A2/A3/A6: proves the
// shared claimCampaignContact() (used by both campaign-send and follow-up
// sending) never lets two overlapping callers both claim the same row.
// ============================================================

import { describe, it, expect } from 'vitest'
import { claimCampaignContact } from '../lib/outbound/sending/claim'
import { FakeSupabase } from './helpers/fake-supabase'

describe('claimCampaignContact', () => {
  it('only one of two concurrent claims on the same queued row succeeds', async () => {
    const supabase = new FakeSupabase().seed('outbound_campaign_contacts', [
      { id: 'cc1', status: 'queued' },
    ])

    const [a, b] = await Promise.all([
      claimCampaignContact(supabase as any, 'cc1', 'queued', 'sent'),
      claimCampaignContact(supabase as any, 'cc1', 'queued', 'sent'),
    ])

    // Exactly one winner — never both, never neither.
    expect([a, b].filter(Boolean).length).toBe(1)
    expect(supabase.table('outbound_campaign_contacts')[0].status).toBe('sent')
  })

  it('a follow-up claim racing a manual "Send Now" claim on the same row: only one wins', async () => {
    // Simulates Step A6 — the automatic engine and a manual click both
    // trying to advance the same contact's follow-up sequence at once.
    const supabase = new FakeSupabase().seed('outbound_campaign_contacts', [
      { id: 'cc1', status: 'sent' },
    ])

    const [engine, manual] = await Promise.all([
      claimCampaignContact(supabase as any, 'cc1', 'sent', 'followup_1'),
      claimCampaignContact(supabase as any, 'cc1', 'sent', 'followup_1'),
    ])

    expect([engine, manual].filter(Boolean).length).toBe(1)
  })

  it('fails to claim a row that is no longer in the expected status', async () => {
    const supabase = new FakeSupabase().seed('outbound_campaign_contacts', [
      { id: 'cc1', status: 'sent' },
    ])
    const claimed = await claimCampaignContact(supabase as any, 'cc1', 'queued', 'sent')
    expect(claimed).toBe(false)
  })

  it('a retry after a genuine rollback (status restored to queued) can claim again — not a duplicate', async () => {
    const supabase = new FakeSupabase().seed('outbound_campaign_contacts', [
      { id: 'cc1', status: 'queued' },
    ])
    expect(await claimCampaignContact(supabase as any, 'cc1', 'queued', 'sent')).toBe(true)
    // Simulate the caller's rollback-on-genuine-failure path.
    supabase.table('outbound_campaign_contacts')[0].status = 'queued'
    expect(await claimCampaignContact(supabase as any, 'cc1', 'queued', 'sent')).toBe(true)
  })
})
