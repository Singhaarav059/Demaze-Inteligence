// ============================================================
// Follow-up scheduling — pure logic tests
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  FOLLOWUP_INTERVALS_DAYS,
  nextFollowupSequence,
  isFollowupDue,
  buildFollowupSubject,
} from '../lib/outbound/sending/followup-schedule'

describe('nextFollowupSequence', () => {
  it('maps sent -> 1, followup_1 -> 2, followup_2 -> 3', () => {
    expect(nextFollowupSequence('sent')).toBe(1)
    expect(nextFollowupSequence('followup_1')).toBe(2)
    expect(nextFollowupSequence('followup_2')).toBe(3)
  })

  it('returns null once the sequence is exhausted (followup_3) or for non-outreach statuses', () => {
    expect(nextFollowupSequence('followup_3')).toBeNull()
    expect(nextFollowupSequence('queued')).toBeNull()
    expect(nextFollowupSequence('replied')).toBeNull()
    expect(nextFollowupSequence('bounced')).toBeNull()
    expect(nextFollowupSequence('stopped')).toBeNull()
    expect(nextFollowupSequence('unknown-status')).toBeNull()
  })
})

describe('isFollowupDue', () => {
  const NOW = new Date('2026-07-29T12:00:00Z')

  it('is false before the interval for that sequence has elapsed', () => {
    const twoDaysAgo = new Date('2026-07-27T12:00:00Z').toISOString()
    expect(isFollowupDue('sent', twoDaysAgo, NOW)).toBe(false) // followup_1 needs 3 days
  })

  it('is true once the interval has elapsed', () => {
    const threeDaysAgo = new Date('2026-07-26T12:00:00Z').toISOString()
    expect(isFollowupDue('sent', threeDaysAgo, NOW)).toBe(true)
  })

  it('is true exactly at the boundary', () => {
    const exactlyThreeDaysAgo = new Date(NOW.getTime() - FOLLOWUP_INTERVALS_DAYS[0] * 24 * 60 * 60 * 1000)
    expect(isFollowupDue('sent', exactlyThreeDaysAgo, NOW)).toBe(true)
  })

  it('uses the per-step interval, not cumulative from the original send', () => {
    // followup_1 -> followup_2 needs 4 days, not 7 (3+4) from the original send
    const fourDaysAgo = new Date('2026-07-25T12:00:00Z').toISOString()
    expect(isFollowupDue('followup_1', fourDaysAgo, NOW)).toBe(true)
    const threeDaysAgo = new Date('2026-07-26T12:00:00Z').toISOString()
    expect(isFollowupDue('followup_1', threeDaysAgo, NOW)).toBe(false)
  })

  it('is false for a status with no next sequence, regardless of how old', () => {
    const wayInThePast = new Date('2020-01-01T00:00:00Z').toISOString()
    expect(isFollowupDue('followup_3', wayInThePast, NOW)).toBe(false)
    expect(isFollowupDue('replied', wayInThePast, NOW)).toBe(false)
  })

  it('accepts a Date object as well as an ISO string for lastActionAt', () => {
    const threeDaysAgo = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000)
    expect(isFollowupDue('sent', threeDaysAgo, NOW)).toBe(true)
  })
})

describe('buildFollowupSubject', () => {
  it('prefixes "Re: " onto a subject that does not already have it', () => {
    expect(buildFollowupSubject('Quick question about your ops')).toBe('Re: Quick question about your ops')
  })

  it('does not double-prefix a subject that already starts with Re: (case-insensitive)', () => {
    expect(buildFollowupSubject('Re: Quick question')).toBe('Re: Quick question')
    expect(buildFollowupSubject('re: Quick question')).toBe('re: Quick question')
    expect(buildFollowupSubject('RE: Quick question')).toBe('RE: Quick question')
  })

  it('trims surrounding whitespace before checking/prefixing', () => {
    expect(buildFollowupSubject('  Quick question  ')).toBe('Re: Quick question')
  })
})
