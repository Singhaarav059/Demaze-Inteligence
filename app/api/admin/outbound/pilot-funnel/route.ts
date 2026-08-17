// ============================================================
// Admin: Pilot Funnel — GET /api/admin/outbound/pilot-funnel
// ============================================================
// Post-Hardening Pilot Readiness Plan, Phase D. Assembles the company
// funnel (D1), failure funnel (D2), and a per-company trace (D3) from
// already-persisted tables — no new storage, no new taxonomy (see
// lib/outbound/pilot/funnel.ts's own header for exactly which existing
// fields/checks each stage reuses).
//
// Optional ?domain= scopes to one company (same filter shape as the
// existing /pipeline route) — used by a future per-company trace view;
// omitted returns every run, which is the funnel/dashboard's normal case.
// A real pilot per Phase F is 20-30 companies, so this fetches everything
// in a handful of queries and aggregates in JS, same convention as
// /overview and /pipeline.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import {
  computeFunnel,
  computeFailures,
  buildCompanyTrace,
  type PilotCompanyRunInput,
  type PilotContactInput,
} from '@/lib/outbound/pilot/funnel'

const SEND_FAILURE_EVENT_TYPES = ['send_failed']
const SEND_AMBIGUOUS_EVENT_TYPES = ['send_ambiguous']

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const domainFilter = req.nextUrl.searchParams.get('domain')?.trim().toLowerCase() || null
  const supabase = createServerClient()

  let runsQuery = supabase
    .from('pipeline_test_runs')
    .select('id, domain, company_url, created_at, final_result')
    .order('created_at', { ascending: false })

  if (domainFilter) runsQuery = runsQuery.eq('domain', domainFilter)

  const { data: runRows, error: runsError } = await runsQuery
  if (runsError) {
    return NextResponse.json({ success: false, error: runsError.message }, { status: 500 })
  }
  if (!runRows || runRows.length === 0) {
    return NextResponse.json({
      success: true,
      funnel: computeFunnel([]),
      failures: computeFailures([]),
      companies: [],
    })
  }

  const runIds = runRows.map(r => r.id)

  const [{ data: contactRows }, { data: suppressionRows }] = await Promise.all([
    supabase
      .from('outbound_contacts')
      .select('id, source_run_id, person_name, email, discovery_grounding_status')
      .in('source_run_id', runIds),
    supabase.from('outbound_suppression_list').select('email'),
  ])

  const suppressedEmails = new Set((suppressionRows ?? []).map(s => (s.email as string).toLowerCase()))
  const contactIds = (contactRows ?? []).map(c => c.id)

  const [{ data: generatedRows }, { data: ccRows }] = await Promise.all([
    contactIds.length
      ? supabase.from('outbound_generated_content').select('contact_id, email_draft').in('contact_id', contactIds)
      : Promise.resolve({ data: [] as Array<{ contact_id: string; email_draft: unknown }> }),
    contactIds.length
      ? supabase.from('outbound_campaign_contacts').select('id, contact_id, status, opened_at').in('contact_id', contactIds)
      : Promise.resolve({ data: [] as Array<{ id: string; contact_id: string; status: string; opened_at: string | null }> }),
  ])

  const generatedByContact = new Map((generatedRows ?? []).map(g => [g.contact_id, g]))
  const ccByContact = new Map((ccRows ?? []).map(cc => [cc.contact_id, cc]))
  const campaignContactIds = (ccRows ?? []).map(cc => cc.id)

  const { data: eventRows } = campaignContactIds.length
    ? await supabase
        .from('outbound_campaign_events')
        .select('campaign_contact_id, event_type')
        .in('campaign_contact_id', campaignContactIds)
        .in('event_type', [...SEND_FAILURE_EVENT_TYPES, ...SEND_AMBIGUOUS_EVENT_TYPES])
    : { data: [] as Array<{ campaign_contact_id: string; event_type: string }> }

  const failureEventsByCc = new Map<string, Set<string>>()
  for (const e of eventRows ?? []) {
    const set = failureEventsByCc.get(e.campaign_contact_id) ?? new Set<string>()
    set.add(e.event_type)
    failureEventsByCc.set(e.campaign_contact_id, set)
  }

  const contactsByRun = new Map<string, PilotContactInput[]>()
  for (const c of contactRows ?? []) {
    const runId = c.source_run_id as string | null
    if (!runId) continue
    const cc = ccByContact.get(c.id)
    const generated = generatedByContact.get(c.id)
    const emailDraft = generated?.email_draft as { fullText?: string; claimGroundingCheck?: { hasUnsupportedClaim?: boolean } } | null
    const events = cc ? failureEventsByCc.get(cc.id) : undefined

    const input: PilotContactInput = {
      contactId: c.id,
      personName: c.person_name,
      email: c.email,
      discoveryGroundingStatus: c.discovery_grounding_status,
      hasGeneratedDraft: Boolean(emailDraft?.fullText),
      hasUnsupportedClaim: Boolean(emailDraft?.claimGroundingCheck?.hasUnsupportedClaim),
      campaignContactStatus: cc?.status ?? null,
      openedAt: cc?.opened_at ?? null,
      suppressed: c.email ? suppressedEmails.has(c.email.toLowerCase()) : false,
      suppressionReason: null,
      hadSendFailure: events?.has('send_failed') ?? false,
      hadSendAmbiguous: events?.has('send_ambiguous') ?? false,
    }
    const arr = contactsByRun.get(runId) ?? []
    arr.push(input)
    contactsByRun.set(runId, arr)
  }

  const runs: PilotCompanyRunInput[] = runRows.map(r => {
    const fr = (r.final_result ?? {}) as Record<string, unknown>
    const opportunities = Array.isArray(fr.opportunities) ? fr.opportunities : []
    const icpSegments = Array.isArray(fr.icp_segments) ? fr.icp_segments : []
    const executiveBrief = fr.executive_brief as { what_to_sell?: string } | null | undefined
    const whyNow = fr.why_now as { explanation?: string } | null | undefined
    const topOpportunity = opportunities[0] as { title?: string; opportunity?: string } | undefined

    return {
      runId: r.id,
      domain: r.domain,
      companyUrl: r.company_url,
      createdAt: r.created_at,
      companyName: (fr.company_name as string | undefined) ?? null,
      whyNow: whyNow?.explanation ?? null,
      whatToSell: executiveBrief?.what_to_sell ?? null,
      evidenceSufficiency: (fr.evidence_sufficiency as string | undefined) ?? null,
      validationWarningsCount: Array.isArray(fr.validation_warnings) ? fr.validation_warnings.length : 0,
      opportunitiesCount: opportunities.length,
      topOpportunityTitle: topOpportunity?.title ?? topOpportunity?.opportunity ?? null,
      icpSegmentsCount: icpSegments.length,
      icpSufficiency: (fr.icp_sufficiency as string | undefined) ?? null,
      contacts: contactsByRun.get(r.id) ?? [],
    }
  })

  return NextResponse.json({
    success: true,
    funnel: computeFunnel(runs),
    failures: computeFailures(runs),
    companies: runs.map(buildCompanyTrace),
  })
}
