// ============================================================
// Admin: Pilot Review — GET /api/admin/outbound/pilot-review
// ============================================================
// Post-Hardening Pilot Readiness Plan, Phase F2 (human quality review).
// Returns every pipeline_test_runs row tagged as part of a pilot batch
// (pilot_review_status IS NOT NULL — set by the backfill/intake step, see
// migration 025) with exactly the fields a reviewer needs to confirm
// "right company, right problem, right evidence, right stakeholder" before
// outreach generation: no new analysis, purely reading already-computed
// final_result fields + the real decision-maker contacts already found.
//
// Pending reviews sort first so the reviewer's queue empties top-down.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

interface Opportunity {
  title?: string
  description?: string
  evidence?: string
  reasoning?: string
  relevance?: string
  confidence?: string
}

interface RunRow {
  id: string
  domain: string | null
  company_url: string | null
  created_at: string
  pilot_icp_segment: string | null
  pilot_source_list: string | null
  pilot_review_status: string | null
  pilot_review_note: string | null
  pilot_reviewed_at: string | null
  final_result: Record<string, unknown> | null
}

interface ContactRow {
  id: string
  source_run_id: string | null
  person_name: string | null
  title_hint: string | null
  discovery_confidence: string | null
  discovery_grounding_status: string | null
}

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const supabase = createServerClient()

  const { data: runs, error: runsError } = await supabase
    .from('pipeline_test_runs')
    .select('id, domain, company_url, created_at, pilot_icp_segment, pilot_source_list, pilot_review_status, pilot_review_note, pilot_reviewed_at, final_result')
    .not('pilot_review_status', 'is', null)
    .order('created_at', { ascending: false })

  if (runsError) {
    return NextResponse.json({ success: false, error: runsError.message }, { status: 500 })
  }
  if (!runs || runs.length === 0) {
    return NextResponse.json({ success: true, companies: [] })
  }

  const runIds = runs.map(r => (r as RunRow).id)
  const { data: contacts } = await supabase
    .from('outbound_contacts')
    .select('id, source_run_id, person_name, title_hint, discovery_confidence, discovery_grounding_status')
    .in('source_run_id', runIds)

  const contactsByRun = new Map<string, ContactRow[]>()
  for (const c of (contacts ?? []) as ContactRow[]) {
    if (!c.source_run_id) continue
    const arr = contactsByRun.get(c.source_run_id) ?? []
    arr.push(c)
    contactsByRun.set(c.source_run_id, arr)
  }

  const companies = (runs as RunRow[]).map(r => {
    const fr = r.final_result ?? {}
    const opportunities = Array.isArray(fr.opportunities) ? (fr.opportunities as Opportunity[]) : []
    const topOpportunity = opportunities[0] ?? null
    const executiveBrief = fr.executive_brief as { what_to_sell?: string; overall_confidence?: string } | undefined
    const whyNow = fr.why_now as { explanation?: string } | undefined
    const runContacts = (contactsByRun.get(r.id) ?? [])
      .sort((a, b) => (b.discovery_confidence ?? '').localeCompare(a.discovery_confidence ?? ''))
      .slice(0, 5)

    return {
      runId: r.id,
      companyName: (fr.company_name as string | undefined) ?? r.domain ?? r.id,
      domain: r.domain,
      companyUrl: r.company_url,
      createdAt: r.created_at,
      industry: (fr.industry as string | undefined) ?? null,
      headquartersLocation: (fr.headquarters_location as string | undefined) ?? null,
      icpSegment: r.pilot_icp_segment,
      sourceList: r.pilot_source_list,
      whyThisCompany: executiveBrief?.what_to_sell ?? null,
      whyNow: whyNow?.explanation ?? null,
      overallConfidence: executiveBrief?.overall_confidence ?? null,
      evidenceSufficiency: (fr.evidence_sufficiency as string | undefined) ?? null,
      opportunityCount: opportunities.length,
      topOpportunity: topOpportunity
        ? {
            title: topOpportunity.title ?? null,
            // description: the catalog/LLM-written human-readable rationale.
            // Deliberately not exposing the opportunity's `reasoning` field
            // here — for a deterministic (catalog) opportunity that's an
            // internal, unanswered LLM prompt string, never meant to be
            // read by a person (2026-08-27 fix — it used to be rendered
            // directly on this page as a fallback).
            description: topOpportunity.description ?? null,
            evidence: topOpportunity.evidence ?? null,
            relevance: topOpportunity.relevance ?? null,
          }
        : null,
      contacts: runContacts.map(c => ({
        personName: c.person_name,
        titleHint: c.title_hint,
        confidence: c.discovery_confidence,
        groundingStatus: c.discovery_grounding_status,
      })),
      reviewStatus: r.pilot_review_status,
      reviewNote: r.pilot_review_note,
      reviewedAt: r.pilot_reviewed_at,
    }
  })

  // Pending first, then by review status, then most-recently-researched first.
  const statusRank: Record<string, number> = { pending: 0, needs_work: 1, approved: 2, rejected: 3 }
  companies.sort((a, b) => {
    const rankDiff = (statusRank[a.reviewStatus ?? 'pending'] ?? 0) - (statusRank[b.reviewStatus ?? 'pending'] ?? 0)
    if (rankDiff !== 0) return rankDiff
    return b.createdAt.localeCompare(a.createdAt)
  })

  return NextResponse.json({ success: true, companies })
}
