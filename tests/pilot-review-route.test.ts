// ============================================================
// GET/PATCH /api/admin/outbound/pilot-review — Phase F2 review routes
// ============================================================

import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeSupabase } from './helpers/fake-supabase'

const state = { supabase: null as FakeSupabase | null }

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => state.supabase,
}))

import { GET } from '../app/api/admin/outbound/pilot-review/route'
import { PATCH } from '../app/api/admin/outbound/pilot-review/[runId]/route'

describe('GET /api/admin/outbound/pilot-review', () => {
  it('shapes and sorts companies (pending first), only including pilot-tagged runs', async () => {
    const supa = new FakeSupabase()
    supa.seed('pipeline_test_runs', [
      {
        id: 'run-approved', domain: 'a.com', company_url: 'https://a.com', created_at: '2026-08-17T09:00:00Z',
        pilot_icp_segment: 'Manufacturing', pilot_source_list: 'Stage 1', pilot_review_status: 'approved', pilot_review_note: null, pilot_reviewed_at: null,
        final_result: { company_name: 'A Corp', opportunities: [{ title: 'Opp A', evidence: 'quote', relevance: 'high' }], evidence_sufficiency: 'sufficient' },
      },
      {
        id: 'run-pending', domain: 'b.com', company_url: 'https://b.com', created_at: '2026-08-17T10:00:00Z',
        pilot_icp_segment: 'SaaS', pilot_source_list: 'Stage 1', pilot_review_status: 'pending', pilot_review_note: null, pilot_reviewed_at: null,
        final_result: { company_name: 'B Corp', opportunities: [], evidence_sufficiency: 'insufficient' },
      },
      {
        id: 'run-not-pilot', domain: 'c.com', company_url: 'https://c.com', created_at: '2026-08-17T11:00:00Z',
        pilot_icp_segment: null, pilot_source_list: null, pilot_review_status: null, pilot_review_note: null, pilot_reviewed_at: null,
        final_result: { company_name: 'C Corp' },
      },
    ])
    supa.seed('outbound_contacts', [
      { id: 'c1', source_run_id: 'run-approved', person_name: 'Jane', title_hint: 'CEO', discovery_confidence: 'high', discovery_grounding_status: 'confirmed' },
    ])
    state.supabase = supa

    const res = await GET(new NextRequest('https://example.com/api/admin/outbound/pilot-review'))
    const json = await res.json()

    expect(json.success).toBe(true)
    // 'C Corp' excluded — not tagged as a pilot run.
    expect(json.companies).toHaveLength(2)
    // Pending sorts before approved.
    expect(json.companies[0].runId).toBe('run-pending')
    expect(json.companies[1].runId).toBe('run-approved')
    expect(json.companies[1].topOpportunity.title).toBe('Opp A')
    expect(json.companies[1].contacts[0].personName).toBe('Jane')
    expect(json.companies[0].topOpportunity).toBeNull()
  })

  it('returns an empty, well-shaped response when no pilot runs exist', async () => {
    state.supabase = new FakeSupabase()
    const res = await GET(new NextRequest('https://example.com/api/admin/outbound/pilot-review'))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.companies).toEqual([])
  })
})

describe('PATCH /api/admin/outbound/pilot-review/[runId]', () => {
  function makeReq(body: Record<string, unknown>) {
    return new NextRequest('https://example.com/api/admin/outbound/pilot-review/run1', {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  }

  it('rejects an invalid status', async () => {
    state.supabase = new FakeSupabase()
    const res = await PATCH(makeReq({ status: 'maybe' }), { params: Promise.resolve({ runId: 'run1' }) })
    expect(res.status).toBe(400)
  })

  it('404s for a run that is not tagged as a pilot run', async () => {
    const supa = new FakeSupabase()
    supa.seed('pipeline_test_runs', [{ id: 'run1', pilot_review_status: null }])
    state.supabase = supa
    const res = await PATCH(makeReq({ status: 'approved' }), { params: Promise.resolve({ runId: 'run1' }) })
    expect(res.status).toBe(404)
  })

  it('updates status/note/reviewedAt for a real pilot run', async () => {
    const supa = new FakeSupabase()
    supa.seed('pipeline_test_runs', [{ id: 'run1', pilot_review_status: 'pending', pilot_review_note: null, pilot_reviewed_at: null }])
    state.supabase = supa
    const res = await PATCH(makeReq({ status: 'approved', note: 'looks solid' }), { params: Promise.resolve({ runId: 'run1' }) })
    const json = await res.json()
    expect(json.success).toBe(true)
    const row = supa.table('pipeline_test_runs')[0]
    expect(row.pilot_review_status).toBe('approved')
    expect(row.pilot_review_note).toBe('looks solid')
    expect(row.pilot_reviewed_at).toBeTruthy()
  })
})
