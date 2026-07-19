// ============================================================
// Decision-Maker Discovery — Provider Factory
// ============================================================
// Resolves the active provider via outbound_integrations (falling back to
// OUTBOUND_DECISION_MAKER_DISCOVERY_PROVIDER, then 'mock') and calls it.
// Adding a real vendor later (e.g. Prospeo Search Person) is: implement a
// new DecisionMakerDiscoveryProvider, register it below, and select it in
// /admin/outbound/integrations — no caller changes needed.
// ============================================================

import { getActiveProviderName } from '@/lib/outbound/settings/provider-selection'
import { MockDecisionMakerDiscoveryProvider } from './providers/mock'
import { ProspeoDecisionMakerDiscoveryProvider } from './providers/prospeo'
import { groundCandidates } from './grounding'
import type {
  DecisionMakerDiscoveryProvider,
  DecisionMakerDiscoveryRequest,
  DecisionMakerDiscoveryResult,
} from './types'

const PROVIDERS: Record<string, DecisionMakerDiscoveryProvider> = {
  mock: MockDecisionMakerDiscoveryProvider,
  prospeo: ProspeoDecisionMakerDiscoveryProvider,
}

async function resolveProvider(): Promise<DecisionMakerDiscoveryProvider> {
  const providerName = await getActiveProviderName('decision_maker_discovery')
  return PROVIDERS[providerName] ?? MockDecisionMakerDiscoveryProvider
}

// Used by the Integrations settings page's Test Connection action.
export async function checkAvailability(): Promise<{ available: boolean; providerUsed: string }> {
  const provider = await resolveProvider()
  return { available: await provider.isAvailable(), providerUsed: provider.name }
}

export async function discoverDecisionMakers(
  request: DecisionMakerDiscoveryRequest
): Promise<DecisionMakerDiscoveryResult> {
  const provider = await resolveProvider()

  if (!(await provider.isAvailable())) {
    return {
      candidates: [],
      providerUsed: provider.name,
      status: 'error',
      reason: `Provider "${provider.name}" is not available.`,
    }
  }

  try {
    const result = await provider.discoverDecisionMakers(request)
    // Applied uniformly here (not inside each provider) so mock and every
    // real vendor get the same website-grounding cross-check for free —
    // see grounding.ts. No-ops when the caller didn't thread
    // leadershipContacts through.
    if (result.status === 'found' && result.candidates.length > 0) {
      return { ...result, candidates: groundCandidates(result.candidates, request.leadershipContacts) }
    }
    return result
  } catch (e) {
    return {
      candidates: [],
      providerUsed: provider.name,
      status: 'error',
      reason: e instanceof Error ? e.message : 'Unknown error calling decision-maker discovery provider.',
    }
  }
}
