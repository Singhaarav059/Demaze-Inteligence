// ============================================================
// assemble-input.ts — Phase 4 (Epitaxy vNext audit) whyNowFact wiring
// ============================================================
// Covers the gate added to buildEmailGenerationInput()'s opportunities
// mapping: opportunity-engine.ts's deriveWhyNowTrace() only threads through
// as whyNowFact when why_now_status is 'traceable' (a real, code-matched
// signal) — a 'no_verified_signal' opportunity must never fabricate an
// urgency statement in the outreach prompt.
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildEmailGenerationInput } from '../lib/outbound/generation/assemble-input'

const contact = { person_name: 'Jane Doe', title_hint: null, company_name: 'Acme Corp' }

describe('buildEmailGenerationInput — whyNowFact', () => {
  it('carries whyNowFact through when why_now_status is traceable', () => {
    const result = buildEmailGenerationInput(contact, {
      opportunities: [{
        title: 'Workflow Automation',
        relevance: 'high',
        why_now_status: 'traceable',
        why_now_fact: 'Acme Corp posted 8 automation-engineer roles in the last 90 days.',
      }],
    })
    expect(result.opportunities[0].whyNowFact).toBe('Acme Corp posted 8 automation-engineer roles in the last 90 days.')
  })

  it('drops whyNowFact when why_now_status is no_verified_signal, even if why_now_fact text is present', () => {
    const result = buildEmailGenerationInput(contact, {
      opportunities: [{
        title: 'Workflow Automation',
        relevance: 'high',
        why_now_status: 'no_verified_signal',
        why_now_fact: 'some stale or speculative text',
      }],
    })
    expect(result.opportunities[0].whyNowFact).toBeUndefined()
  })

  it('leaves whyNowFact undefined when the field is absent entirely', () => {
    const result = buildEmailGenerationInput(contact, {
      opportunities: [{ title: 'Workflow Automation', relevance: 'high' }],
    })
    expect(result.opportunities[0].whyNowFact).toBeUndefined()
  })
})
