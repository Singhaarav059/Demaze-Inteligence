// ============================================================
// Lemlist webhook receiver — pure mapping-logic tests
// ============================================================
// The route handler itself (app/api/webhooks/lemlist/route.ts) isn't
// unit-tested end-to-end — this repo's established precedent is to verify
// route.ts files via tsc + dev-server rather than mocking Supabase (see
// CLAUDE.md's BUSINESS_PROFILE gate note: "route.ts has zero existing
// unit-test coverage of any kind... adding test scaffolding for just this
// one gate would be new infrastructure, not a regression per this file's
// established convention"). firstString/EVENT_TYPE_MAP are exported
// specifically so the one part of this route with real branching logic
// (field-name fallback, event-type mapping) is still covered.
// ============================================================

import { describe, it, expect } from 'vitest'
import { firstString, EVENT_TYPE_MAP } from '@/app/api/webhooks/lemlist/route'

describe('firstString', () => {
  it('returns the first non-empty string among candidates', () => {
    expect(firstString(undefined, '', 'second', 'third')).toBe('second')
  })

  it('returns null when nothing is a non-empty string', () => {
    expect(firstString(undefined, null, '', 42, {})).toBeNull()
  })

  it('picks the first value even if a later one would also match', () => {
    expect(firstString('first', 'second')).toBe('first')
  })
})

describe('EVENT_TYPE_MAP', () => {
  it('maps known email event types onto outbound_campaign_events.event_type values', () => {
    expect(EVENT_TYPE_MAP.emailsSent).toBe('sent')
    expect(EVENT_TYPE_MAP.emailsOpened).toBe('opened')
    expect(EVENT_TYPE_MAP.emailsClicked).toBe('clicked')
    expect(EVENT_TYPE_MAP.emailsReplied).toBe('replied')
    expect(EVENT_TYPE_MAP.emailsBounced).toBe('bounced')
  })

  it('does not map non-email Lemlist event types (they must be ignored, not guessed)', () => {
    expect(EVENT_TYPE_MAP['linkedinInterested']).toBeUndefined()
    expect(EVENT_TYPE_MAP['whatsappReplied']).toBeUndefined()
    expect(EVENT_TYPE_MAP['signalRegistered']).toBeUndefined()
  })
})
