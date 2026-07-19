// ============================================================
// Email Warm-Up — mock provider tests
// ============================================================

import { describe, it, expect } from 'vitest'
import { MockWarmupProvider } from '../lib/outbound/warmup/providers/mock'

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
}

describe('MockWarmupProvider', () => {
  it('startWarmup always succeeds', async () => {
    expect(await MockWarmupProvider.startWarmup('sales@acme.com')).toEqual({ started: true })
  })

  it('is a deterministic function of elapsed time (same startedAt -> same metrics)', async () => {
    const startedAt = daysAgo(10)
    const a = await MockWarmupProvider.getWarmupStatus({ mailboxAddress: 'a@acme.com', startedAt })
    const b = await MockWarmupProvider.getWarmupStatus({ mailboxAddress: 'a@acme.com', startedAt })
    expect(a).toEqual(b)
  })

  it('reports "warming" before the 30-day ramp completes and "warmed" after', async () => {
    const early = await MockWarmupProvider.getWarmupStatus({ mailboxAddress: 'a@acme.com', startedAt: daysAgo(5) })
    const late = await MockWarmupProvider.getWarmupStatus({ mailboxAddress: 'a@acme.com', startedAt: daysAgo(40) })
    expect(early.status).toBe('warming')
    expect(late.status).toBe('warmed')
  })

  it('inbox rate rises and spam rate falls as elapsed time increases', async () => {
    const early = await MockWarmupProvider.getWarmupStatus({ mailboxAddress: 'a@acme.com', startedAt: daysAgo(1) })
    const late = await MockWarmupProvider.getWarmupStatus({ mailboxAddress: 'a@acme.com', startedAt: daysAgo(29) })
    expect(late.inboxRate).toBeGreaterThan(early.inboxRate)
    expect(late.spamRate).toBeLessThan(early.spamRate)
    expect(late.domainHealthScore).toBeGreaterThan(early.domainHealthScore)
  })

  it('caps emailsSentTotal at 200', async () => {
    const result = await MockWarmupProvider.getWarmupStatus({ mailboxAddress: 'a@acme.com', startedAt: daysAgo(90) })
    expect(result.emailsSentTotal).toBe(200)
  })

  it('reports status "paused" when isPaused is true, regardless of elapsed time', async () => {
    const result = await MockWarmupProvider.getWarmupStatus({
      mailboxAddress: 'a@acme.com',
      startedAt: daysAgo(5),
      isPaused: true,
    })
    expect(result.status).toBe('paused')
  })

  it('isAvailable always resolves true', async () => {
    expect(await MockWarmupProvider.isAvailable()).toBe(true)
  })
})
