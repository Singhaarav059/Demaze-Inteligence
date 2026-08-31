// ============================================================
// GET /api/admin/outbound/campaigns?contact_ids=... — shared-campaign lookup
// ============================================================
// This is the actual mechanism behind the "batch-originated shared-campaign
// resume path" flagged in docs/PROJECT_STATE.md/CURRENT_TASK.md as never
// exercised against a real batch — both useAutoGtmFlow's
// restoreContactsAndCampaign() (single-company resume, fixed 2026-08-05)
// and ensureCampaignId()'s batch-mode existing-campaign check (added in
// this hardening pass) depend on this route finding the right shared
// campaign by contact_id, since a batch campaign has source_run_id: null
// and no other shared identifier. Had zero test coverage before this file.
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeSupabase } from './helpers/fake-supabase'

const state = vi.hoisted(() => ({ supabase: null as FakeSupabase | null }))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => state.supabase,
}))

import { GET } from '../app/api/admin/outbound/campaigns/route'

function makeReq(query: string) {
  return new NextRequest(`https://example.com/api/admin/outbound/campaigns${query}`)
}

describe('GET campaigns?contact_ids=... ', () => {
  it('finds the shared batch campaign via any one of its enqueued contacts', async () => {
    const supa = new FakeSupabase()
    supa.seed('outbound_campaigns', [
      { id: 'batch-camp', name: 'Batch (2 companies) - Auto Flow', source_run_id: null, created_at: '2026-08-20' },
    ])
    supa.seed('outbound_campaign_contacts', [
      { id: 'cc1', campaign_id: 'batch-camp', contact_id: 'contactA' },
      { id: 'cc2', campaign_id: 'batch-camp', contact_id: 'contactB' },
    ])
    state.supabase = supa

    // Resuming into just contactB (one company's contacts) still finds the
    // whole shared batch campaign.
    const res = await GET(makeReq('?contact_ids=contactB'))
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.campaigns).toHaveLength(1)
    expect(json.campaigns[0].id).toBe('batch-camp')
  })

  it('returns no campaigns when none of the given contacts are enqueued anywhere', async () => {
    const supa = new FakeSupabase()
    supa.seed('outbound_campaigns', [{ id: 'other-camp', name: 'X', source_run_id: null, created_at: '2026-08-20' }])
    supa.seed('outbound_campaign_contacts', [])
    state.supabase = supa

    const res = await GET(makeReq('?contact_ids=contactZ'))
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.campaigns).toEqual([])
  })

  it('does not return a duplicate campaign twice when multiple of its contacts are passed', async () => {
    const supa = new FakeSupabase()
    supa.seed('outbound_campaigns', [
      { id: 'batch-camp', name: 'Batch - Auto Flow', source_run_id: null, created_at: '2026-08-20' },
    ])
    supa.seed('outbound_campaign_contacts', [
      { id: 'cc1', campaign_id: 'batch-camp', contact_id: 'contactA' },
      { id: 'cc2', campaign_id: 'batch-camp', contact_id: 'contactB' },
    ])
    state.supabase = supa

    const res = await GET(makeReq('?contact_ids=contactA,contactB'))
    const json = await res.json()

    expect(json.campaigns).toHaveLength(1)
  })
})
