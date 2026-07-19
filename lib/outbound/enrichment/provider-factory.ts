// ============================================================
// Contact Enrichment — Provider Factory
// ============================================================
// Same selection discipline as the other outbound factories: active
// provider via outbound_integrations -> OUTBOUND_ENRICHMENT_PROVIDER ->
// 'mock'.
// ============================================================

import { getActiveProviderName } from '@/lib/outbound/settings/provider-selection'
import { MockEnrichmentProvider } from './providers/mock'
import { ProspeoEnrichmentProvider } from './providers/prospeo'
import type { EnrichmentProvider, EnrichmentRequest, EnrichmentResult } from './types'

const PROVIDERS: Record<string, EnrichmentProvider> = {
  mock: MockEnrichmentProvider,
  prospeo: ProspeoEnrichmentProvider,
}

async function resolveProvider(): Promise<EnrichmentProvider> {
  const providerName = await getActiveProviderName('enrichment')
  return PROVIDERS[providerName] ?? MockEnrichmentProvider
}

// Used by the Integrations settings page's Test Connection action.
export async function checkAvailability(): Promise<{ available: boolean; providerUsed: string }> {
  const provider = await resolveProvider()
  return { available: await provider.isAvailable(), providerUsed: provider.name }
}

export async function enrichContact(request: EnrichmentRequest): Promise<EnrichmentResult> {
  const provider = await resolveProvider()

  if (!(await provider.isAvailable())) {
    return { confidence: 'low', providerUsed: provider.name, status: 'not_found' }
  }

  try {
    return await provider.enrichContact(request)
  } catch {
    return { confidence: 'low', providerUsed: provider.name, status: 'not_found' }
  }
}
