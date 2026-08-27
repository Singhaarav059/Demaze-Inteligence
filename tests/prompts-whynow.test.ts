// ============================================================
// prompts.ts — Phase 4 (Epitaxy vNext audit) whyNowFact rendering
// ============================================================
// Covers renderInputBlock()'s per-opportunity "(Why now: ...)" suffix,
// additive to the pre-existing top-level "Why now:" line (a separate,
// free-narrative field) — see assemble-input.ts/types.ts for the
// why_now_status-gated wiring that populates this.
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildEmailPrompt } from '../lib/outbound/generation/prompts'
import type { EmailGenerationInput } from '../lib/outbound/generation/types'

function baseInput(overrides: Partial<EmailGenerationInput> = {}): EmailGenerationInput {
  return {
    personName: 'Jane Doe',
    companyName: 'Acme Corp',
    painPoints: [],
    opportunities: [],
    recentActivity: [],
    ...overrides,
  }
}

describe('buildEmailPrompt — opportunity whyNowFact rendering', () => {
  it('appends a "(Why now: ...)" suffix to an opportunity that has one', () => {
    const input = baseInput({
      opportunities: [{ title: 'Workflow Automation', whyNowFact: 'Acme Corp posted 8 automation-engineer roles in the last 90 days.' }],
    })
    const { userPrompt } = buildEmailPrompt(input, 'Subject')
    expect(userPrompt).toContain('- Workflow Automation (Why now: Acme Corp posted 8 automation-engineer roles in the last 90 days.)')
  })

  it('renders an opportunity with no whyNowFact exactly as before (no suffix)', () => {
    const input = baseInput({ opportunities: [{ title: 'Workflow Automation', description: 'ERP integration gap' }] })
    const { userPrompt } = buildEmailPrompt(input, 'Subject')
    expect(userPrompt).toContain('- Workflow Automation: ERP integration gap')
    expect(userPrompt).not.toContain('Why now:')
  })
})
