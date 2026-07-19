// ============================================================
// Admin: Decision-Maker Discovery — POST /api/admin/outbound/decision-makers/discover
// ============================================================
// Given a company + optional target titles, runs the active Decision-Maker
// Discovery provider and returns candidates. Candidates are NOT persisted
// here — same "ephemeral until selected" discipline as Company Discovery
// Engine's search endpoint. The caller reviews the list and adds selected
// candidates as real contacts via POST /api/admin/outbound/contacts.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { discoverDecisionMakers } from '@/lib/outbound/decision-maker-discovery/provider-factory'

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const body = await req.json()
  const { companyName, domain, targetTitles, leadershipContacts } = body

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

  return NextResponse.json({ success: true, result })
}
