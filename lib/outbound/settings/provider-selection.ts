// ============================================================
// Provider Selection — reads outbound_integrations, falls back to env
// ============================================================
// Every outbound module's provider-factory calls getActiveProviderName()
// instead of hardcoding a vendor. Selection order:
//   1. outbound_integrations row where capability=X AND is_active=true
//   2. env var OUTBOUND_<CAPABILITY>_PROVIDER (dev-time / no-DB fallback)
//   3. 'mock'
// This keeps the settings UI's "flip is_active" action meaningful without
// requiring Supabase to be configured for local development.
// ============================================================

import { createServerClient } from '@/lib/supabase/server'
import { decryptCredential } from './credential-crypto'
import type { OutboundCapability } from './types'

const ENV_FALLBACK_VAR: Record<OutboundCapability, string> = {
  decision_maker_discovery: 'OUTBOUND_DECISION_MAKER_DISCOVERY_PROVIDER',
  email_finder: 'OUTBOUND_EMAIL_FINDER_PROVIDER',
  enrichment: 'OUTBOUND_ENRICHMENT_PROVIDER',
  sending: 'OUTBOUND_SENDING_PROVIDER',
  warmup: 'OUTBOUND_WARMUP_PROVIDER',
}

export async function getActiveProviderName(capability: OutboundCapability): Promise<string> {
  try {
    const supabase = createServerClient()
    const { data } = await supabase
      .from('outbound_integrations')
      .select('provider_name')
      .eq('capability', capability)
      .eq('is_active', true)
      .maybeSingle()

    if (data?.provider_name) return data.provider_name
  } catch {
    // Supabase not configured (e.g. local dev without env vars) — fall through.
  }

  return process.env[ENV_FALLBACK_VAR[capability]] || 'mock'
}

// Returns null if no credential is stored, the active provider is 'mock',
// or Supabase isn't configured — callers should treat null as "no credential,
// use the provider's no-credential/mock behavior" rather than an error.
export async function getActiveCredential(capability: OutboundCapability): Promise<string | null> {
  try {
    const supabase = createServerClient()
    const { data } = await supabase
      .from('outbound_integrations')
      .select('credential_encrypted')
      .eq('capability', capability)
      .eq('is_active', true)
      .maybeSingle()

    if (!data?.credential_encrypted) return null
    return decryptCredential(data.credential_encrypted)
  } catch {
    return null
  }
}
