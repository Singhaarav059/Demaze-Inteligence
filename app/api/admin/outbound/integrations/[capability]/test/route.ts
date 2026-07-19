// ============================================================
// Admin: Test Integration — POST /api/admin/outbound/integrations/[capability]/test
// ============================================================
// Dispatches to that capability's own provider-factory.checkAvailability(),
// which resolves the actually-active provider and calls its isAvailable()
// — a cheap credential-presence check for real vendors (see e.g.
// lib/outbound/email-finder/providers/prospeo.ts), always true for mock.
// This is a config/credential check, not a live network ping — a stored
// key that's real but revoked/expired would still report available here;
// the first real findEmail()/enrichContact()/etc call is what actually
// exercises the vendor's API.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { isOutboundCapability, type OutboundCapability } from '@/lib/outbound/settings/types'
import { checkAvailability as checkDecisionMakerDiscovery } from '@/lib/outbound/decision-maker-discovery/provider-factory'
import { checkAvailability as checkEmailFinder } from '@/lib/outbound/email-finder/provider-factory'
import { checkAvailability as checkEnrichment } from '@/lib/outbound/enrichment/provider-factory'
import { checkAvailability as checkSending } from '@/lib/outbound/sending/provider-factory'
import { checkAvailability as checkWarmup } from '@/lib/outbound/warmup/provider-factory'

type AvailabilityChecker = () => Promise<{ available: boolean; providerUsed: string }>

const CHECKERS: Record<OutboundCapability, AvailabilityChecker> = {
  decision_maker_discovery: checkDecisionMakerDiscovery,
  email_finder: checkEmailFinder,
  enrichment: checkEnrichment,
  sending: checkSending,
  warmup: checkWarmup,
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ capability: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { capability } = await params
  if (!isOutboundCapability(capability)) {
    return NextResponse.json({ success: false, error: `Unknown capability: ${capability}` }, { status: 400 })
  }

  const { available, providerUsed } = await CHECKERS[capability]()
  const status = available ? 'success' : 'failure'
  const message =
    providerUsed === 'mock'
      ? 'Mock provider — always available, no real credential required.'
      : available
        ? `${providerUsed} — credential configured.`
        : `${providerUsed} — no API key configured. Set it above or via its env var.`

  const supabase = createServerClient()
  const { error: updateError } = await supabase
    .from('outbound_integrations')
    .update({
      last_tested_at: new Date().toISOString(),
      last_test_status: status,
      last_test_message: message,
    })
    .eq('capability', capability)
    .eq('provider_name', providerUsed)

  if (updateError) {
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, provider_name: providerUsed, status, message })
}
