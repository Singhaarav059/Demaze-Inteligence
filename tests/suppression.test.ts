// ============================================================
// Suppression list — the hard-block mechanism behind C3 (bounce) and
// C4 (unsubscribe) in the Pilot Readiness Plan's Phase C. Had zero direct
// unit coverage before this — every other outbound module has one, this
// hard-block gate didn't.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeSupabase } from './helpers/fake-supabase'

const state = vi.hoisted(() => ({ supabase: null as FakeSupabase | null, throwOnCreate: false }))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => {
    if (state.throwOnCreate) throw new Error('Supabase unreachable')
    return state.supabase
  },
}))

import { isSuppressed, addToSuppressionList, removeFromSuppressionList } from '../lib/outbound/sending/suppression'

beforeEach(() => {
  state.supabase = new FakeSupabase()
  state.throwOnCreate = false
})

describe('isSuppressed', () => {
  it('reports suppressed with reason for a bounced address', async () => {
    state.supabase!.seed('outbound_suppression_list', [
      { id: 's1', email: 'bounced@acme.com', reason: 'bounced', detail: 'Gmail bounce' },
    ])
    const result = await isSuppressed('bounced@acme.com')
    expect(result).toEqual({ suppressed: true, reason: 'bounced', detail: 'Gmail bounce' })
  })

  it('reports suppressed for an unsubscribed address (case/whitespace-insensitive)', async () => {
    state.supabase!.seed('outbound_suppression_list', [
      { id: 's2', email: 'unsub@acme.com', reason: 'unsubscribed', detail: null },
    ])
    const result = await isSuppressed('  Unsub@Acme.com  ')
    expect(result.suppressed).toBe(true)
    expect(result.reason).toBe('unsubscribed')
  })

  it('is not suppressed when no matching row exists', async () => {
    const result = await isSuppressed('clean@acme.com')
    expect(result).toEqual({ suppressed: false })
  })

  it('fails CLOSED (treated as suppressed) when the DB is unreachable — Pilot Readiness Plan Rule 6', async () => {
    state.throwOnCreate = true
    const result = await isSuppressed('anyone@acme.com')
    expect(result.suppressed).toBe(true)
    expect(result.checkFailed).toBe(true)
    expect(result.reason).toBeUndefined()
    expect(result.detail).toMatch(/could not be verified/i)
  })
})

describe('addToSuppressionList', () => {
  it('rejects an invalid email before touching the DB', async () => {
    const result = await addToSuppressionList({ email: 'not-an-email', reason: 'manual' })
    expect(result.ok).toBe(false)
  })

  it('adds a valid bounce/unsubscribe entry, normalized to lowercase', async () => {
    const result = await addToSuppressionList({ email: '  Bounced@Acme.com  ', reason: 'bounced', detail: 'test' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.entry.email).toBe('bounced@acme.com')

    // The entry a later sendEmail() call would actually find.
    const check = await isSuppressed('bounced@acme.com')
    expect(check.suppressed).toBe(true)
  })
})

describe('removeFromSuppressionList', () => {
  it('removes an entry by id', async () => {
    state.supabase!.seed('outbound_suppression_list', [{ id: 's3', email: 'x@acme.com', reason: 'manual' }])
    const result = await removeFromSuppressionList('s3')
    expect(result.ok).toBe(true)
    expect(state.supabase!.table('outbound_suppression_list').find(r => r.id === 's3')).toBeUndefined()
  })
})
