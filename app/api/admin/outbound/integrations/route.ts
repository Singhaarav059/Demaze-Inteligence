// ============================================================
// Admin: Outbound Integrations — GET /api/admin/outbound/integrations
// ============================================================
// Lists all provider rows across every outbound capability. Never
// returns credential_encrypted — only the masked credential_last_four.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('outbound_integrations')
    .select(
      'id, capability, provider_name, display_name, is_enabled, is_active, credential_last_four, config, last_tested_at, last_test_status, last_test_message, created_at, updated_at'
    )
    .order('capability', { ascending: true })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, integrations: data ?? [] })
}
