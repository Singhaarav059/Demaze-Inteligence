// ============================================================
// Global sending kill switch (Production Hardening Master Plan, Step 7.5)
// ============================================================
// isOutboundSendingEnabled() is a pure env-var read with an intentional
// "default to enabled" shape — the opposite of WARMUP_ENGINE_ENABLED/
// FOLLOWUP_ENGINE_ENABLED, which default OFF. Only the literal string
// 'false' disables sending; everything else (unset, empty, any other
// value) preserves current behavior.

import { describe, it, expect, afterEach } from 'vitest'
import { isOutboundSendingEnabled } from '../lib/outbound/sending/provider-factory'

const ORIGINAL = process.env.OUTBOUND_SEND_ENABLED

describe('isOutboundSendingEnabled', () => {
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.OUTBOUND_SEND_ENABLED
    else process.env.OUTBOUND_SEND_ENABLED = ORIGINAL
  })

  it('is enabled when the env var is unset', () => {
    delete process.env.OUTBOUND_SEND_ENABLED
    expect(isOutboundSendingEnabled()).toBe(true)
  })

  it('is disabled only for the exact literal string "false"', () => {
    process.env.OUTBOUND_SEND_ENABLED = 'false'
    expect(isOutboundSendingEnabled()).toBe(false)
  })

  it('stays enabled for any other value, including falsy-looking strings', () => {
    for (const v of ['true', 'False', 'FALSE', '0', '', 'no']) {
      process.env.OUTBOUND_SEND_ENABLED = v
      expect(isOutboundSendingEnabled()).toBe(true)
    }
  })
})
