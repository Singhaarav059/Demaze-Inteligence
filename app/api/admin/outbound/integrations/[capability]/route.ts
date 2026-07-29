// ============================================================
// Admin: Outbound Integration — PUT / DELETE /api/admin/outbound/integrations/[capability]
// ============================================================
// PUT — Upserts the provider row for one capability. If api_key is present
// it's encrypted before storage — the plaintext value is never persisted or
// echoed back. Setting is_active=true deactivates every other provider row
// for the same capability first, so exactly one stays active (also
// enforced at the DB level by idx_outbound_integrations_capability_active).
//
// DELETE — Removes a decommissioned provider's row entirely (e.g. Lemlist,
// removed 2026-07-29 in favor of free Gmail sending — see docs/DECISIONS.md).
// Deactivating already stops a provider from being used; this is for when
// its stored config/credential shouldn't linger at all. Refuses to delete
// the currently-active row for a capability — switch to a different
// provider first, so a capability is never left with zero rows.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { createServerClient } from '@/lib/supabase/server'
import { encryptCredential, lastFourOf } from '@/lib/outbound/settings/credential-crypto'
import { isOutboundCapability } from '@/lib/outbound/settings/types'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ capability: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { capability } = await params
  if (!isOutboundCapability(capability)) {
    return NextResponse.json({ success: false, error: `Unknown capability: ${capability}` }, { status: 400 })
  }

  const body = await req.json()
  const { provider_name, display_name, api_key, is_enabled, is_active, config, clear_credential } = body

  if (!provider_name) {
    return NextResponse.json({ success: false, error: 'provider_name is required' }, { status: 400 })
  }

  const supabase = createServerClient()

  const update: Record<string, unknown> = {
    display_name: display_name ?? provider_name,
    is_enabled: is_enabled ?? false,
    is_active: is_active ?? false,
    config: config ?? {},
    updated_at: new Date().toISOString(),
  }

  if (typeof api_key === 'string' && api_key.length > 0) {
    let encrypted: string
    try {
      encrypted = encryptCredential(api_key)
    } catch (e) {
      return NextResponse.json(
        { success: false, error: e instanceof Error ? e.message : 'Failed to encrypt credential' },
        { status: 500 }
      )
    }
    update.credential_encrypted = encrypted
    update.credential_last_four = lastFourOf(api_key)
  } else if (clear_credential === true) {
    // Resets to "no stored credential" so provider-selection.ts's env-var
    // fallback (e.g. PROSPEO_API_KEY) takes effect again — there was
    // previously no way to undo a stored credential once saved.
    update.credential_encrypted = null
    update.credential_last_four = null
  }

  if (update.is_active) {
    const { error: deactivateError } = await supabase
      .from('outbound_integrations')
      .update({ is_active: false })
      .eq('capability', capability)
      .neq('provider_name', provider_name)

    if (deactivateError) {
      return NextResponse.json({ success: false, error: deactivateError.message }, { status: 500 })
    }
  }

  const { data, error } = await supabase
    .from('outbound_integrations')
    .upsert({ capability, provider_name, ...update }, { onConflict: 'capability,provider_name' })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, id: data.id })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ capability: string }> }
) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const { capability } = await params
  if (!isOutboundCapability(capability)) {
    return NextResponse.json({ success: false, error: `Unknown capability: ${capability}` }, { status: 400 })
  }

  const providerName = req.nextUrl.searchParams.get('provider_name')
  if (!providerName) {
    return NextResponse.json({ success: false, error: 'provider_name query param is required' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data: existing } = await supabase
    .from('outbound_integrations')
    .select('is_active')
    .eq('capability', capability)
    .eq('provider_name', providerName)
    .maybeSingle()

  if (existing?.is_active) {
    return NextResponse.json(
      { success: false, error: `"${providerName}" is the active provider for ${capability} — switch to a different one before deleting it.` },
      { status: 409 }
    )
  }

  const { error } = await supabase
    .from('outbound_integrations')
    .delete()
    .eq('capability', capability)
    .eq('provider_name', providerName)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
