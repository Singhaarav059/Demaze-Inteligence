import { describe, it, expect } from 'vitest'
import { computeDailyCounts, hasSufficientTrendData, MIN_TREND_TOTAL, MIN_TREND_ACTIVE_DAYS } from '@/lib/analytics/daily-counts'

const NOW = new Date('2026-08-22T12:00:00Z')

describe('computeDailyCounts', () => {
  it('returns exactly `days` zero-filled buckets when given no timestamps', () => {
    const buckets = computeDailyCounts([], 7, NOW)
    expect(buckets).toHaveLength(7)
    expect(buckets.every(b => b.count === 0)).toBe(true)
    expect(buckets[6].date).toBe('2026-08-22')
    expect(buckets[0].date).toBe('2026-08-16')
  })

  it('counts a timestamp into its own UTC day', () => {
    const buckets = computeDailyCounts(['2026-08-22T03:00:00Z', '2026-08-22T23:00:00Z', '2026-08-21T00:00:00Z'], 7, NOW)
    const byDate = Object.fromEntries(buckets.map(b => [b.date, b.count]))
    expect(byDate['2026-08-22']).toBe(2)
    expect(byDate['2026-08-21']).toBe(1)
  })

  it('drops timestamps outside the trailing window instead of throwing', () => {
    const buckets = computeDailyCounts(['2026-01-01T00:00:00Z'], 7, NOW)
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(0)
  })

  it('silently skips null/undefined/invalid timestamps', () => {
    const buckets = computeDailyCounts([null, undefined, 'not-a-date', '2026-08-22T00:00:00Z'], 7, NOW)
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(1)
  })
})

describe('hasSufficientTrendData', () => {
  it('rejects a series with too little total activity', () => {
    const buckets = computeDailyCounts(Array(MIN_TREND_TOTAL - 1).fill('2026-08-20T00:00:00Z'), 14, NOW)
    expect(hasSufficientTrendData(buckets)).toBe(false)
  })

  it('rejects a series where all activity is crammed into one day', () => {
    const buckets = computeDailyCounts(Array(MIN_TREND_TOTAL + 3).fill('2026-08-20T00:00:00Z'), 14, NOW)
    expect(hasSufficientTrendData(buckets)).toBe(false)
  })

  it('accepts a series meeting both the total and spread thresholds', () => {
    const timestamps = [
      '2026-08-20T00:00:00Z',
      '2026-08-20T01:00:00Z',
      '2026-08-21T00:00:00Z',
      '2026-08-21T01:00:00Z',
      '2026-08-22T00:00:00Z',
    ]
    expect(timestamps.length).toBeGreaterThanOrEqual(MIN_TREND_TOTAL)
    const buckets = computeDailyCounts(timestamps, 14, NOW)
    expect(buckets.filter(b => b.count > 0).length).toBeGreaterThanOrEqual(MIN_TREND_ACTIVE_DAYS)
    expect(hasSufficientTrendData(buckets)).toBe(true)
  })
})
