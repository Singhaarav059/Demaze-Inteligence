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
import { ExpleeDecisionMakerDiscoveryProvider } from './providers/explee'
import { LinkedInSearchDecisionMakerDiscoveryProvider } from './providers/linkedin-search'
import { ExaDecisionMakerDiscoveryProvider } from './providers/exa'
import { groundCandidates } from './grounding'
import { rankCandidates } from './ranking'
import type {
  DecisionMakerDiscoveryProvider,
  DecisionMakerDiscoveryRequest,
  DecisionMakerDiscoveryResult,
} from './types'

const PROVIDERS: Record<string, DecisionMakerDiscoveryProvider> = {
  mock: MockDecisionMakerDiscoveryProvider,
  prospeo: ProspeoDecisionMakerDiscoveryProvider,
  explee: ExpleeDecisionMakerDiscoveryProvider,
  'linkedin-search': LinkedInSearchDecisionMakerDiscoveryProvider,
  exa: ExaDecisionMakerDiscoveryProvider,
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
    // real vendor get the same website-grounding cross-check and seniority
    // ranking for free — see grounding.ts / ranking.ts. No-ops (grounding)
    // when the caller didn't thread leadershipContacts through; ranking
    // always applies since it needs no external input.
    if (result.status === 'found' && result.candidates.length > 0) {
      const grounded = groundCandidates(result.candidates, request.leadershipContacts)
      return { ...result, candidates: rankCandidates(grounded) }
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
