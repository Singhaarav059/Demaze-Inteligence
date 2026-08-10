// ============================================================
// Warmup engine — pure tick logic tests
// ============================================================
// Every randomized function takes an injectable rng, same "pure,
// deterministic via a seeded/fixed function" precedent as this repo's
// other pure-logic test files (e.g. followup-schedule.test.ts).
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  computeDailySendCap,
  computeProcessDelayMs,
  rollShouldReply,
  shouldSkipThisTick,
  pickRecipient,
  generateWarmupContent,
  generateWarmupReplyContent,
  buildRefToken,
} from '../lib/outbound/warmup/engine/tick-logic'

describe('computeDailySendCap', () => {
  it('ramps in steps over 30 days, capping at 6', () => {
    expect(computeDailySendCap(0)).toBe(1)
    expect(computeDailySendCap(2.9)).toBe(1)
    expect(computeDailySendCap(3)).toBe(2)
    expect(computeDailySendCap(6.9)).toBe(2)
    expect(computeDailySendCap(7)).toBe(3)
    expect(computeDailySendCap(13.9)).toBe(3)
    expect(computeDailySendCap(14)).toBe(4)
    expect(computeDailySendCap(20.9)).toBe(4)
    expect(computeDailySendCap(21)).toBe(5)
    expect(computeDailySendCap(29.9)).toBe(5)
    expect(computeDailySendCap(30)).toBe(6)
    expect(computeDailySendCap(365)).toBe(6) // hard ceiling, never grows past 6
  })
})

describe('computeProcessDelayMs', () => {
  it('stays within the 2-30 hour range across the full rng domain', () => {
    const minMs = 2 * 60 * 60 * 1000
    const maxMs = 30 * 60 * 60 * 1000
    expect(computeProcessDelayMs(() => 0)).toBe(minMs)
    expect(computeProcessDelayMs(() => 0.999999)).toBeLessThan(maxMs)
    expect(computeProcessDelayMs(() => 0.999999)).toBeGreaterThan(minMs)
    const mid = computeProcessDelayMs(() => 0.5)
    expect(mid).toBeGreaterThan(minMs)
    expect(mid).toBeLessThan(maxMs)
  })
})

describe('rollShouldReply', () => {
  it('is a 35% threshold on the injected rng', () => {
    expect(rollShouldReply(() => 0.3)).toBe(true)
    expect(rollShouldReply(() => 0.34)).toBe(true)
    expect(rollShouldReply(() => 0.35)).toBe(false)
    expect(rollShouldReply(() => 0.9)).toBe(false)
  })
})

describe('shouldSkipThisTick', () => {
  it('is a 20% threshold on the injected rng', () => {
    expect(shouldSkipThisTick(() => 0.1)).toBe(true)
    expect(shouldSkipThisTick(() => 0.19)).toBe(true)
    expect(shouldSkipThisTick(() => 0.2)).toBe(false)
    expect(shouldSkipThisTick(() => 0.9)).toBe(false)
  })
})

describe('pickRecipient', () => {
  it('excludes self from the candidate pool', () => {
    const result = pickRecipient(['a'], 'a', [], () => 0)
    expect(result).toBeNull()
  })

  it('returns null when there are fewer than 2 mailboxes total', () => {
    expect(pickRecipient([], 'a', [], () => 0)).toBeNull()
  })

  it('picks from candidates other than self', () => {
    const result = pickRecipient(['a', 'b'], 'a', [], () => 0)
    expect(result).toBe('b')
  })

  it('prefers a mailbox not already mailed today when the pool allows it', () => {
    const result = pickRecipient(['a', 'b', 'c'], 'a', ['b'], () => 0)
    expect(result).toBe('c') // 'b' was recent, 'c' wasn't — 'c' should win
  })

  it('falls back to the full pool (including recently-mailed) when everyone has already been mailed today', () => {
    // Only 'b' is available at all (pool of 2), and it's also "recent" —
    // must still return it rather than null, since a 2-mailbox pool has no
    // other option.
    const result = pickRecipient(['a', 'b'], 'a', ['b'], () => 0)
    expect(result).toBe('b')
  })
})

describe('generateWarmupContent / generateWarmupReplyContent', () => {
  it('produce non-empty subject/body pairs', () => {
    const content = generateWarmupContent(() => 0)
    expect(content.subject.length).toBeGreaterThan(0)
    expect(content.body.length).toBeGreaterThan(0)

    const reply = generateWarmupReplyContent(() => 0)
    expect(reply.body.length).toBeGreaterThan(0)
  })

  it('never includes the literal words test/warmup/automated', () => {
    // Sample across the whole rng domain rather than trusting one draw.
    for (const r of [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 0.999]) {
      const content = generateWarmupContent(() => r)
      const text = `${content.subject} ${content.body}`.toLowerCase()
      expect(text).not.toMatch(/\b(test|warmup|automated)\b/)
    }
  })
})

describe('buildRefToken', () => {
  it('derives a short, consistent token from an exchange id', () => {
    const token = buildRefToken('12345678-abcd-ef01-2345-6789abcdef01')
    expect(token).toBe('Ref: 12345678')
  })

  it('is stable for the same id', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    expect(buildRefToken(id)).toBe(buildRefToken(id))
  })
})
