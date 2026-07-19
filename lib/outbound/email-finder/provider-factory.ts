// ============================================================
// Email Finder — Provider Factory
// ============================================================
// Resolves the active provider via outbound_integrations (falling back to
// OUTBOUND_EMAIL_FINDER_PROVIDER, then 'mock') and calls it. Adding a real
// vendor later is: implement a new EmailFinderProvider, register it below,
// and select it in /admin/outbound/integrations — no caller changes needed.
// ============================================================

import { getActiveProviderName } from '@/lib/outbound/settings/provider-selection'
import { MockEmailFinderProvider } from './providers/mock'
import { ProspeoEmailFinderProvider } from './providers/prospeo'
import type { EmailFinderProvider, EmailFinderRequest, EmailFinderResult } from './types'

const PROVIDERS: Record<string, EmailFinderProvider> = {
  mock: MockEmailFinderProvider,
  prospeo: ProspeoEmailFinderProvider,
}

async function resolveProvider(): Promise<EmailFinderProvider> {
  const providerName = await getActiveProviderName('email_finder')
  return PROVIDERS[providerName] ?? MockEmailFinderProvider
}

// Used by the Integrations settings page's Test Connection action.
export async function checkAvailability(): Promise<{ available: boolean; providerUsed: string }> {
  const provider = await resolveProvider()
  return { available: await provider.isAvailable(), providerUsed: provider.name }
}

export async function findEmail(request: EmailFinderRequest): Promise<EmailFinderResult> {
  const provider = await resolveProvider()

  if (!(await provider.isAvailable())) {
    return {
      email: null,
      confidence: 'none',
      providerUsed: provider.name,
      status: 'error',
      reason: `Provider "${provider.name}" is not available.`,
    }
  }

  try {
    return await provider.findEmail(request)
  } catch (e) {
    return {
      email: null,
      confidence: 'none',
      providerUsed: provider.name,
      status: 'error',
      reason: e instanceof Error ? e.message : 'Unknown error calling email finder provider.',
    }
  }
}
