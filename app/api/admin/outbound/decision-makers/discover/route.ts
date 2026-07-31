// ============================================================
// Admin: Decision-Maker Discovery — GET / POST /api/admin/outbound/decision-makers/discover
// ============================================================
// POST — given a company + optional target titles, runs the active
// Decision-Maker Discovery provider and returns candidates. Candidates
// themselves are still never auto-persisted as contacts — the caller
// reviews the list and adds selected ones via POST
// /api/admin/outbound/contacts, unchanged. What's new (migration 015): when
// the caller passes sourceRunId, the raw result is also cached (best-effort,
// upserted, one row per run) so DecisionMakerFinder.tsx can restore it on
// remount instead of firing another paid search. sourceRunId is optional —
// useAutoGtmFlow.ts's batch-mode caller doesn't pass one (it commits
// candidates immediately, nothing to cache for later review).
//
// GET — reads back the cached result for a source_run_id, or null if none
// exists yet (never searched, or migration 015 hasn't been applied to this
// DB). This is a read-only cache lookup, not a search — it never spends
// provider quota.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { discoverDecisionMakers } from '@/lib/outbound/decision-maker-discovery/provider-factory'

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { searchParams } = new URL(req.url)
  const sourceRunId = searchParams.get('source_run_id')
  if (!sourceRunId) {
    return NextResponse.json({ success: false, error: 'source_run_id is required' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('outbound_decision_maker_searches')
    .select('candidates, provider_used, status, reason, target_titles')
    .eq('source_run_id', sourceRunId)
    .maybeSingle()

  // Degrade to "no cache" rather than a hard error — this table may not
  // exist yet on a DB that hasn't run migration 015, and a missing cache
  // must never block the caller's fallback (a fresh search), same
  // "graceful degradation" discipline this repo uses for every other
  // optional/secondary data source.
  if (error || !data) {
    return NextResponse.json({ success: true, cached: null })
  }

  return NextResponse.json({
    success: true,
    cached: {
      candidates: data.candidates,
      providerUsed: data.provider_used,
      status: data.status,
      reason: data.reason,
      targetTitles: data.target_titles,
    },
  })
}

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json()
  const { companyName, domain, targetTitles, leadershipContacts, sourceRunId } = body

  if (typeof companyName !== 'string' || !companyName.trim() || typeof domain !== 'string' || !domain.trim()) {
    return NextResponse.json(
      { success: false, error: 'companyName and domain are required strings' },
      { status: 400 }
    )
  }

  // Filter out any non-string entries rather than passing them through —
  // the provider only knows how to match string titles, and a stray
  // non-string element (a malformed request body) would otherwise throw
  // deep inside the provider and discard every other title's candidates too.
  const cleanTargetTitles = Array.isArray(targetTitles)
    ? targetTitles.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : undefined

  // Optional grounding input — the company's own already-extracted
  // leadership evidence (lib/pipeline/evidence-extractor.ts's
  // LeadershipContact[], mapped down to {name, title} at this boundary).
  // Same defensive filtering as targetTitles above: a malformed entry is
  // dropped rather than allowed to throw deep inside grounding.ts.
  const cleanLeadershipContacts = Array.isArray(leadershipContacts)
    ? leadershipContacts.filter(
        (lc): lc is { name: string; title: string } =>
          lc && typeof lc === 'object' &&
          typeof (lc as Record<string, unknown>).name === 'string' && (lc as Record<string, unknown>).name &&
          typeof (lc as Record<string, unknown>).title === 'string' && (lc as Record<string, unknown>).title
      )
    : undefined

  const result = await discoverDecisionMakers({
    companyName,
    domain,
    targetTitles: cleanTargetTitles?.length ? cleanTargetTitles : undefined,
    leadershipContacts: cleanLeadershipContacts?.length ? cleanLeadershipContacts : undefined,
  })

  // Best-effort cache write — deliberately never fails the response. The
  // caller already has real, spent-quota results in `result`; a cache-write
  // failure (migration 015 not yet applied, transient DB error) must not
  // turn that into an error response. Silently no-ops when the caller
  // didn't send a sourceRunId (batch mode, see useAutoGtmFlow.ts).
  if (typeof sourceRunId === 'string' && sourceRunId.trim()) {
    try {
      const supabase = createServerClient()
      await supabase.from('outbound_decision_maker_searches').upsert(
        {
          source_run_id: sourceRunId,
          company_domain: domain,
          company_name: companyName,
          target_titles: cleanTargetTitles ?? [],
          candidates: result.candidates,
          provider_used: result.providerUsed,
          status: result.status,
          reason: result.reason ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'source_run_id' }
      )
    } catch {
      // Non-fatal, see comment above.
    }
  }

  return NextResponse.json({ success: true, result })
}
