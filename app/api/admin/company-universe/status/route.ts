// ============================================================
// Admin: Company Universe — GET /api/admin/company-universe/status
// ============================================================
// Demaze_Multi_Source_Company_Universe_Claude_Prompt.md, Section 25/31:
// "Demaze should know India MCA = healthy, Companies House = healthy,
// GLEIF = stale, OpenCorporates = quota exhausted, SEC = healthy... rather
// than silently returning incomplete discovery." A small admin/status
// endpoint, per Section 31's "no large UI yet, a small admin/status
// endpoint is acceptable" — no page built for this in this session, this
// is the API surface a future session's UI (or a curl/Postman check) reads.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { ALL_PROVIDERS } from '@/lib/company-universe/providers'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const health = await Promise.all(
    ALL_PROVIDERS.map(async (provider) => ({
      displayName: provider.displayName,
      capabilities: provider.capabilities,
      ...(await provider.healthCheck()),
    }))
  )

  const lastSuccessfulSync: Record<string, string | null> = {}
  try {
    const supabase = createServerClient()
    const { data } = await supabase
      .from('company_universe_ingestion_runs')
      .select('provider, completed_at')
      .eq('status', 'succeeded')
      .order('completed_at', { ascending: false })
      .limit(200)
    for (const row of data ?? []) {
      if (!lastSuccessfulSync[row.provider]) lastSuccessfulSync[row.provider] = row.completed_at
    }
  } catch {
    // company_universe tables not migrated yet, or DB unreachable — status
    // is still useful with provider healthChecks alone, degrade gracefully
    // rather than 500ing the whole endpoint.
  }

  return NextResponse.json({ success: true, providers: health, lastSuccessfulSync })
}
