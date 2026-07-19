// ============================================================
// Mock Warm-Up Provider
// ============================================================
// Metrics are a deterministic function of elapsed time since startedAt —
// no random noise, so the UI shows a plausible warm-up curve that's stable
// across reloads: emailsSentTotal ramps linearly (capped at 200 over 30
// days), inboxRate rises 0.6 -> 0.97, spamRate falls 0.15 -> 0.02,
// domainHealthScore rises 50 -> 95, all over the same 30-day ramp.
// ============================================================

import type { WarmupProvider, WarmupStatusRequest, WarmupStatusResult } from '../types'

const RAMP_DAYS = 30

function daysElapsed(startedAt: string): number {
  const started = new Date(startedAt).getTime()
  if (Number.isNaN(started)) return 0
  const ms = Date.now() - started
  return Math.max(0, ms / (1000 * 60 * 60 * 24))
}

export const MockWarmupProvider: WarmupProvider = {
  name: 'mock',
  displayName: 'Mock Warm-Up',

  async startWarmup(_mailboxAddress: string): Promise<{ started: boolean }> {
    return { started: true }
  },

  async getWarmupStatus(request: WarmupStatusRequest): Promise<WarmupStatusResult> {
    const days = daysElapsed(request.startedAt)
    const progress = Math.min(days / RAMP_DAYS, 1)

    const emailsSentTotal = Math.min(Math.round(days * 8), 200)
    const inboxRate = Math.round((0.6 + progress * 0.37) * 100) / 100
    const spamRate = Math.round((0.15 - progress * 0.13) * 100) / 100
    const domainHealthScore = Math.round(50 + progress * 45)

    const status: WarmupStatusResult['status'] = request.isPaused
      ? 'paused'
      : progress >= 1
        ? 'warmed'
        : 'warming'

    return {
      status,
      emailsSentTotal,
      inboxRate,
      spamRate,
      domainHealthScore,
      providerUsed: 'mock',
    }
  },

  async isAvailable(): Promise<boolean> {
    return true
  },
}
