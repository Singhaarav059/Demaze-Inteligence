// ============================================================
// Automatic follow-up engine — pure tick logic tests
// ============================================================

import { describe, it, expect } from 'vitest'
import { isAutoFollowupEligible } from '../lib/outbound/sending/followup-engine/tick-logic'

describe('isAutoFollowupEligible', () => {
  const NOW = new Date('2026-08-05T12:00:00Z')
  const threeDaysAgo = new Date('2026-08-02T12:00:00Z').toISOString() // due for followup_1 (3-day interval)
  const twoDaysAgo = new Date('2026-08-03T12:00:00Z').toISOString() // not yet due

  it('is false when tracking is not configured, even if due and unopened', () => {
    expect(isAutoFollowupEligible('sent', threeDaysAgo, null, false, NOW)).toBe(false)
  })

  it('is false when the contact has opened, even if due and tracking is configured', () => {
    const openedAt = new Date('2026-08-03T00:00:00Z').toISOString()
    expect(isAutoFollowupEligible('sent', threeDaysAgo, openedAt, true, NOW)).toBe(false)
  })

  it('is false when not yet due, even if unopened and tracking is configured', () => {
    expect(isAutoFollowupEligible('sent', twoDaysAgo, null, true, NOW)).toBe(false)
  })

  it('is true when tracking is configured, unopened, and due', () => {
    expect(isAutoFollowupEligible('sent', threeDaysAgo, null, true, NOW)).toBe(true)
  })

  it('respects the same status-exhaustion rule as isFollowupDue (followup_3 has no next step)', () => {
    const wayInThePast = new Date('2020-01-01T00:00:00Z').toISOString()
    expect(isAutoFollowupEligible('followup_3', wayInThePast, null, true, NOW)).toBe(false)
  })

  it('respects a custom intervalsDays array the same way isFollowupDue does', () => {
    const oneDayAgo = new Date('2026-08-04T12:00:00Z').toISOString()
    expect(isAutoFollowupEligible('sent', oneDayAgo, null, true, NOW, [1, 4, 7])).toBe(true)
    expect(isAutoFollowupEligible('sent', oneDayAgo, null, true, NOW, [3, 4, 7])).toBe(false)
  })
})
