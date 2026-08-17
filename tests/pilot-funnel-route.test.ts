// ============================================================
// GET /api/admin/outbound/pilot-funnel — end-to-end wiring test
// ============================================================
// The pure module (tests/pilot-funnel.test.ts) covers the aggregation
// logic; this covers the JOIN/shaping logic the route itself does (grouping
// contacts by source_run_id, mapping campaign_contact_id -> failure events,
// matching suppressed emails) against the real route handler.
// ============================================================

import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeSupabase } from './helpers/fake-supabase'

const state = { supabase: null as FakeSupabase | null }

import { vi } from 'vitest'
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => state.supabase,
}))

import { GET } from '../app/api/admin/outbound/pilot-funnel/route'

function makeReq(qs = '') {
  return new NextRequest(`https://example.com/api/admin/outbound/pilot-funnel${qs}`)
}

describe('GET /api/admin/outbound/pilot-funnel', () => {
  it('assembles funnel/failures/companies from real joined rows', async () => {
    const supa = new FakeSupabase()
    supa.seed('pipeline_test_runs', [
      {
        id: 'run1',
        domain: 'acme.com',
        company_url: 'https://acme.com',
        created_at: '2026-08-01T00:00:00Z',
        final_result: {
          company_name: 'Acme Corp',
          evidence_sufficiency: 'sufficient',
          validation_warnings: [],
          opportunities: [{ title: 'Predictive maintenance' }],
          icp_segments: [{ name: 'Manufacturing' }],
          icp_sufficiency: 'sufficient',
          executive_brief: { what_to_sell: 'Automation' },
          why_now: { explanation: 'Recent expansion' },
        },
      },
      {
        id: 'run2',
        domain: 'thin.com',
        company_url: 'https://thin.com',
        created_at: '2026-08-02T00:00:00Z',
        final_result: { evidence_sufficiency: 'insufficient', opportunities: [], icp_segments: [] },
      },
    ])
    supa.seed('outbound_contacts', [
      { id: 'contact1', source_run_id: 'run1', person_name: 'Jane', email: 'jane@acme.com', discovery_grounding_status: 'confirmed' },
    ])
    supa.seed('outbound_suppression_list', [{ email: 'someoneelse@x.com' }])
    supa.seed('outbound_generated_content', [
      { contact_id: 'contact1', email_draft: { fullText: 'body', claimGroundingCheck: { hasUnsupportedClaim: false } } },
    ])
    supa.seed('outbound_campaign_contacts', [
      { id: 'cc1', contact_id: 'contact1', status: 'sent', opened_at: null },
    ])
    supa.seed('outbound_campaign_events', [
      { campaign_contact_id: 'cc1', event_type: 'sent' },
    ])
    state.supabase = supa

    const res = await GET(makeReq())
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.funnel.companiesEntered).toBe(2)
    expect(json.funnel.decisionMakerFound).toBe(1)
    expect(json.funnel.emailQAPassed).toBe(1)
    expect(json.funnel.sent).toBe(1)
    expect(json.failures.relevanceOrEvidenceFailure).toBe(1) // run2
    expect(json.failures.peopleDataFailure).toBe(1) // run2 has no contacts
    expect(json.companies).toHaveLength(2)
    const acmeTrace = json.companies.find((c: { runId: string }) => c.runId === 'run1')
    expect(acmeTrace.companyName).toBe('Acme Corp')
    expect(acmeTrace.opportunity).toBe('Predictive maintenance')
    expect(acmeTrace.sendStatus).toBe('sent')
  })

  it('?domain= scopes to one company', async () => {
    const supa = new FakeSupabase()
    supa.seed('pipeline_test_runs', [
      { id: 'run1', domain: 'acme.com', company_url: null, created_at: '2026-08-01T00:00:00Z', final_result: {} },
      { id: 'run2', domain: 'other.com', company_url: null, created_at: '2026-08-01T00:00:00Z', final_result: {} },
    ])
    state.supabase = supa

    const res = await GET(makeReq('?domain=acme.com'))
    const json = await res.json()
    expect(json.companies).toHaveLength(1)
    expect(json.companies[0].domain).toBe('acme.com')
  })

  it('returns an empty, well-shaped response when there are no runs at all', async () => {
    state.supabase = new FakeSupabase()
    const res = await GET(makeReq())
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.funnel.companiesEntered).toBe(0)
    expect(json.companies).toEqual([])
  })
})
