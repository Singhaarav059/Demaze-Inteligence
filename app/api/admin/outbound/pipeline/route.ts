// ============================================================
// Admin: Company Pipeline — GET /api/admin/outbound/pipeline
// ============================================================
// One row per company that has reached the send stage — surfaced on Auto
// Flow's Research step so a company already sent to (researched singly OR
// via batch upload) can be resumed into or checked on later, instead of
// only ever starting fresh research.
//
// Grouped by contact-derived company identity (outbound_contacts.
// source_run_id), NOT by outbound_campaigns.source_run_id — this is what
// makes single-company AND batch-researched companies both work through
// one unified query. A single-company campaign has source_run_id set
// directly; a batch campaign is one SHARED row across many companies with
// source_run_id: null, so grouping by the campaign itself would silently
// drop every batch company. outbound_contacts.source_run_id is reliably set
// per-company for both cases (confirmed in this feature's own planning
// research) — see useAutoGtmFlow.ts's resumeFromRun() for the matching fix
// on the resume side of this same problem.
//
// Aggregation happens in JS, not raw SQL/RPC — same convention this
// codebase already uses throughout (e.g. the warmup engine's counter Maps).
//
// Optional ?domain= filter (added 2026-08-10) — lets a caller ask "does
// this domain already have a tracked pipeline entry" before deciding
// whether to create a new pipeline_test_runs row or update an existing
// one. See useAutoGtmFlow.ts's runResearch() for the actual consumer:
// re-researching a company already in this list now updates that same
// run in place instead of inserting a duplicate row.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { getFollowupIntervals } from '@/lib/outbound/sending/followup-settings'
import { nextFollowupDueAt } from '@/lib/outbound/sending/followup-schedule'

const FOLLOWUP_PENDING_STATUSES = ['sent', 'followup_1', 'followup_2']

interface CampaignContactJoinRow {
  id: string
  contact_id: string
  status: string
  updated_at: string
  opened_at: string | null
  outbound_contacts: { source_run_id: string | null; company_name: string } | null
}

interface RunRow {
  id: string
  domain: string
  company_url: string
  created_at: string
}

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const limitParam = Number(req.nextUrl.searchParams.get('limit'))
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? limitParam : 50
  const domainFilter = req.nextUrl.searchParams.get('domain')?.trim().toLowerCase() || null

  const supabase = createServerClient()
  const intervalsDays = await getFollowupIntervals()

  const { data: ccRows, error: ccError } = await supabase
    .from('outbound_campaign_contacts')
    .select('id, contact_id, status, updated_at, opened_at, outbound_contacts(source_run_id, company_name)')

  if (ccError) {
    return NextResponse.json({ success: false, error: ccError.message }, { status: 500 })
  }

  const byRunId = new Map<string, CampaignContactJoinRow[]>()
  for (const row of (ccRows ?? []) as unknown as CampaignContactJoinRow[]) {
    const runId = row.outbound_contacts?.source_run_id
    if (!runId) continue // contact predates source_run_id tracking, or was added with no run — nothing to group it under
    const arr = byRunId.get(runId) ?? []
    arr.push(row)
    byRunId.set(runId, arr)
  }

  if (byRunId.size === 0) {
    return NextResponse.json({ success: true, companies: [] })
  }

  const runIds = Array.from(byRunId.keys())
  const { data: runs, error: runsError } = await supabase
    .from('pipeline_test_runs')
    .select('id, domain, company_url, created_at')
    .in('id', runIds)

  if (runsError) {
    return NextResponse.json({ success: false, error: runsError.message }, { status: 500 })
  }

  const runById = new Map((runs ?? []).map((r: RunRow) => [r.id, r]))
  const now = new Date()

  let companies = runIds
    .map(runId => {
      const rows = byRunId.get(runId)!
      const run = runById.get(runId)
      const companyName = rows.find(r => r.outbound_contacts?.company_name)?.outbound_contacts?.company_name ?? run?.domain ?? runId

      const contactsTotal = rows.length
      const sentCount = rows.filter(r => r.status !== 'queued').length
      const openedCount = rows.filter(r => r.opened_at !== null).length
      const repliedCount = rows.filter(r => r.status === 'replied').length
      const bouncedCount = rows.filter(r => r.status === 'bounced').length

      let nextDue: Date | null = null
      for (const r of rows) {
        if (!FOLLOWUP_PENDING_STATUSES.includes(r.status)) continue
        const due = nextFollowupDueAt(r.status, r.updated_at, intervalsDays)
        if (due && (!nextDue || due < nextDue)) nextDue = due
      }

      const lastActivityAt = rows.reduce((latest, r) => (r.updated_at > latest ? r.updated_at : latest), rows[0].updated_at)

      return {
        runId,
        companyName,
        domain: run?.domain ?? null,
        companyUrl: run?.company_url ?? null,
        contactsTotal,
        sentCount,
        openedCount,
        repliedCount,
        bouncedCount,
        nextFollowupDueAt: nextDue ? nextDue.toISOString() : null,
        lastActivityAt,
      }
    })
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))

  if (domainFilter) {
    companies = companies.filter(c => c.domain?.toLowerCase() === domainFilter)
  }
  companies = companies.slice(0, limit)

  return NextResponse.json({ success: true, companies, now: now.toISOString() })
}
