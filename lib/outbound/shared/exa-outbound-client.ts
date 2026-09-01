// ============================================================
// Exa — outbound-capability credential resolution
// ============================================================
// Same DB-then-env pattern as getProspeoApiKey()/getExpleeApiKey() in this
// directory: a per-capability outbound_integrations row (entered via the
// Integrations UI, AES-256-GCM at rest) takes precedence over the flat
// EXA_API_KEY env var. lib/enrichment/sources/exa-client.ts's own
// getExaApiKey() only knows the flat env var — it has no outbound-capability
// or DB awareness (by design, see that file's header comment) — so the
// three Exa outbound providers (decision-maker discovery, email finder,
// enrichment) call this instead of getExaApiKey() directly.
// ============================================================

import type { OutboundCapability } from '@/lib/outbound/settings/types'
import { getActiveCredential } from '@/lib/outbound/settings/provider-selection'
import { getExaApiKey } from '@/lib/enrichment/sources/exa-client'

export async function getExaCredential(capability: OutboundCapability): Promise<string | null> {
  const stored = await getActiveCredential(capability)
  if (stored) return stored
  return getExaApiKey()
}
