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
//
// Also surfaces "in progress" companies (added for the Auto Flow landing
// page's "Continue Where You Left Off" section) — a run that has committed
// decision-maker contacts but hasn't reached a campaign/send yet. Same
// contact-derived grouping as the sent-stage rows above, just sourced from
// outbound_contacts directly instead of outbound_campaign_contacts, and
// excluded from that set once it's reached (a run only ever appears in one
// of the two stages). stage: 'in_progress' entries are intentionally
// lighter-weight (no follow-up cadence, no sent/opened counts — none of
// that exists yet) — just contactsTotal and how many already have a
// drafted email, which is enough for the UI to show an honest one-line
// status without pretending to know per-step completion it can't cheaply
// verify.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { getFollowupIntervals } from '@/lib/outbound/sending/followup-settings'
import { nextFollowupDueAt, FOLLOWUP_INTERVALS_DAYS } from '@/lib/outbound/sending/followup-schedule'

const FOLLOWUP_PENDING_STATUSES = ['sent', 'followup_1', 'followup_2']

interface CampaignContactJoinRow {
  id: string
  contact_id: string
  campaign_id: string
  status: string
  updated_at: string
  opened_at: string | null
  outbound_contacts: { source_run_id: string | null; company_name: string } | null
}

interface ContactRow {
  id: string
  source_run_id: string | null
  company_name: string
  created_at: string
}

interface RunRow {
  id: string
  domain: string
  company_url: string
  created_at: string
}

interface SentCompany {
  stage: 'sent'
  runId: string
  companyName: string
  domain: string | null
  companyUrl: string | null
  contactsTotal: number
  sentCount: number
  openedCount: number
  repliedCount: number
  bouncedCount: number
  nextFollowupDueAt: string | null
  lastActivityAt: string
}

interface InProgressCompany {
  stage: 'in_progress'
  runId: string
  companyName: string
  domain: string | null
  companyUrl: string | null
  contactsTotal: number
  draftsReadyCount: number
  lastActivityAt: string
}

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const limitParam = Number(req.nextUrl.searchParams.get('limit'))
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? limitParam : 50
  const domainFilter = req.nextUrl.searchParams.get('domain')?.trim().toLowerCase() || null

  const supabase = createServerClient()

  const { data: ccRows, error: ccError } = await supabase
    .from('outbound_campaign_contacts')
    .select('id, contact_id, campaign_id, status, updated_at, opened_at, outbound_contacts(source_run_id, company_name)')

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

  // In-progress companies: has committed contacts, but this run hasn't
  // reached byRunId (the campaign/send stage) above.
  const { data: contactRows, error: contactsError } = await supabase
    .from('outbound_contacts')
    .select('id, source_run_id, company_name, created_at')

  if (contactsError) {
    return NextResponse.json({ success: false, error: contactsError.message }, { status: 500 })
  }

  const inProgressByRunId = new Map<string, ContactRow[]>()
  for (const row of (contactRows ?? []) as ContactRow[]) {
    if (!row.source_run_id || byRunId.has(row.source_run_id)) continue
    const arr = inProgressByRunId.get(row.source_run_id) ?? []
    arr.push(row)
    inProgressByRunId.set(row.source_run_id, arr)
  }

  if (byRunId.size === 0 && inProgressByRunId.size === 0) {
    return NextResponse.json({ success: true, companies: [] })
  }

  const inProgressRunIds = Array.from(inProgressByRunId.keys())
  const { data: draftRows } = inProgressRunIds.length > 0
    ? await supabase
        .from('outbound_generated_content')
        .select('source_run_id, email_draft')
        .in('source_run_id', inProgressRunIds)
    : { data: [] as Array<{ source_run_id: string | null; email_draft: unknown }> }

  const draftsReadyByRunId = new Map<string, number>()
  for (const row of draftRows ?? []) {
    if (!row.source_run_id || row.email_draft == null) continue
    draftsReadyByRunId.set(row.source_run_id, (draftsReadyByRunId.get(row.source_run_id) ?? 0) + 1)
  }

  const runIds = Array.from(new Set([...byRunId.keys(), ...inProgressByRunId.keys()]))
  const { data: runs, error: runsError } = await supabase
    .from('pipeline_test_runs')
    .select('id, domain, company_url, created_at')
    .in('id', runIds)

  if (runsError) {
    return NextResponse.json({ success: false, error: runsError.message }, { status: 500 })
  }

  const runById = new Map((runs ?? []).map((r: RunRow) => [r.id, r]))
  const now = new Date()

  // Per-campaign cadence override (migration 020) — resolved once per
  // distinct campaign id present in this response, not per row, same
  // batch-lookup discipline as runById above. Falls back to the global
  // default per campaign when that campaign has no override (see
  // getFollowupIntervals's own header comment).
  const distinctCampaignIds = Array.from(new Set((ccRows ?? []).map(r => (r as unknown as CampaignContactJoinRow).campaign_id)))
  const intervalsByCampaignId = new Map<string, readonly [number, number, number]>(
    await Promise.all(
      distinctCampaignIds.map(async (campaignId): Promise<[string, readonly [number, number, number]]> => [
        campaignId,
        await getFollowupIntervals(campaignId),
      ])
    )
  )

  const sentCompanies: SentCompany[] = Array.from(byRunId.keys()).map(runId => {
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
      const intervalsDays = intervalsByCampaignId.get(r.campaign_id) ?? FOLLOWUP_INTERVALS_DAYS
      const due = nextFollowupDueAt(r.status, r.updated_at, intervalsDays)
      if (due && (!nextDue || due < nextDue)) nextDue = due
    }

    const lastActivityAt = rows.reduce((latest, r) => (r.updated_at > latest ? r.updated_at : latest), rows[0].updated_at)

    return {
      stage: 'sent',
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

  const inProgressCompanies: InProgressCompany[] = inProgressRunIds.map(runId => {
    const rows = inProgressByRunId.get(runId)!
    const run = runById.get(runId)
    const companyName = rows.find(r => r.company_name)?.company_name ?? run?.domain ?? runId
    const lastActivityAt = rows.reduce((latest, r) => (r.created_at > latest ? r.created_at : latest), rows[0].created_at)

    return {
      stage: 'in_progress',
      runId,
      companyName,
      domain: run?.domain ?? null,
      companyUrl: run?.company_url ?? null,
      contactsTotal: rows.length,
      draftsReadyCount: draftsReadyByRunId.get(runId) ?? 0,
      lastActivityAt,
    }
  })

  let companies: Array<SentCompany | InProgressCompany> = [...sentCompanies, ...inProgressCompanies]
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))

  if (domainFilter) {
    companies = companies.filter(c => c.domain?.toLowerCase() === domainFilter)
  }
  companies = companies.slice(0, limit)

  return NextResponse.json({ success: true, companies, now: now.toISOString() })
}
