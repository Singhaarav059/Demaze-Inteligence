// ============================================================
// Email Warm-Up — Provider Factory
// ============================================================
// Same selection discipline as the other outbound factories: active
// provider via outbound_integrations -> OUTBOUND_WARMUP_PROVIDER -> 'mock'.
// ============================================================

import { getActiveProviderName } from '@/lib/outbound/settings/provider-selection'
import { MockWarmupProvider } from './providers/mock'
import type { WarmupProvider, WarmupStatusRequest, WarmupStatusResult } from './types'

const PROVIDERS: Record<string, WarmupProvider> = {
  mock: MockWarmupProvider,
}

async function resolveProvider(): Promise<WarmupProvider> {
  const providerName = await getActiveProviderName('warmup')
  return PROVIDERS[providerName] ?? MockWarmupProvider
}

// Used by the Integrations settings page's Test Connection action.
export async function checkAvailability(): Promise<{ available: boolean; providerUsed: string }> {
  const provider = await resolveProvider()
  return { available: await provider.isAvailable(), providerUsed: provider.name }
}

export async function startWarmup(mailboxAddress: string): Promise<{ started: boolean; providerUsed: string }> {
  const provider = await resolveProvider()
  try {
    const result = await provider.startWarmup(mailboxAddress)
    return { ...result, providerUsed: provider.name }
  } catch {
    return { started: false, providerUsed: provider.name }
  }
}

export async function getWarmupStatus(request: WarmupStatusRequest): Promise<WarmupStatusResult> {
  const provider = await resolveProvider()
  try {
    return await provider.getWarmupStatus(request)
  } catch {
    return {
      status: 'not_started',
      emailsSentTotal: 0,
      inboxRate: 0,
      spamRate: 0,
      domainHealthScore: 0,
      providerUsed: provider.name,
    }
  }
}
