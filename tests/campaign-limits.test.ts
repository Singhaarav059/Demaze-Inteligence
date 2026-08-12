import { describe, it, expect } from 'vitest'
import { isWithinSendWindow } from '@/lib/outbound/sending/campaign-limits'

function utcHour(hour: number): Date {
  return new Date(Date.UTC(2026, 0, 15, hour, 0, 0))
}

describe('isWithinSendWindow', () => {
  it('is unrestricted when either bound is null', () => {
    expect(isWithinSendWindow({ daily_send_limit: null, send_window_start: null, send_window_end: 18, timezone: 'UTC' }, utcHour(3))).toBe(true)
    expect(isWithinSendWindow({ daily_send_limit: null, send_window_start: 9, send_window_end: null, timezone: 'UTC' }, utcHour(3))).toBe(true)
  })

  it('is unrestricted when start equals end (treated as no restriction, not "never")', () => {
    expect(isWithinSendWindow({ daily_send_limit: null, send_window_start: 9, send_window_end: 9, timezone: 'UTC' }, utcHour(3))).toBe(true)
  })

  it('respects a normal same-day window', () => {
    const campaign = { daily_send_limit: null, send_window_start: 9, send_window_end: 18, timezone: 'UTC' }
    expect(isWithinSendWindow(campaign, utcHour(8))).toBe(false)
    expect(isWithinSendWindow(campaign, utcHour(9))).toBe(true)
    expect(isWithinSendWindow(campaign, utcHour(17))).toBe(true)
    expect(isWithinSendWindow(campaign, utcHour(18))).toBe(false)
  })

  it('handles a window that wraps past midnight', () => {
    const campaign = { daily_send_limit: null, send_window_start: 22, send_window_end: 6, timezone: 'UTC' }
    expect(isWithinSendWindow(campaign, utcHour(23))).toBe(true)
    expect(isWithinSendWindow(campaign, utcHour(2))).toBe(true)
    expect(isWithinSendWindow(campaign, utcHour(6))).toBe(false)
    expect(isWithinSendWindow(campaign, utcHour(12))).toBe(false)
  })

  it('resolves the hour in the campaign timezone, not UTC', () => {
    // 09:00 UTC is 14:30 in Asia/Kolkata (UTC+5:30) — a 9-18 IST window should NOT be open yet at 09:00 UTC.
    const campaign = { daily_send_limit: null, send_window_start: 9, send_window_end: 18, timezone: 'Asia/Kolkata' }
    expect(isWithinSendWindow(campaign, utcHour(9))).toBe(true) // 14:30 IST, inside 9-18
    expect(isWithinSendWindow(campaign, utcHour(20))).toBe(false) // 01:30 IST next day, outside 9-18
  })

  it('falls back to UTC rather than throwing on an invalid timezone string', () => {
    const campaign = { daily_send_limit: null, send_window_start: 9, send_window_end: 18, timezone: 'Not/AZone' }
    expect(() => isWithinSendWindow(campaign, utcHour(12))).not.toThrow()
  })
})
