// ============================================================
// Outbound Generation — assembly + prompt-building tests
// ============================================================
// These don't call a real LLM (no network) — they cover the deterministic
// parts: input assembly from a NormalizedAnalysis-shaped blob, JSON
// fence-stripping, and that prompts embed the anti-hallucination rules and
// only the facts present in the input.
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildEmailGenerationInput } from '../lib/outbound/generation/assemble-input'
import { buildSubjectLinePrompt, buildEmailPrompt, buildFollowupPrompt } from '../lib/outbound/generation/prompts'
import { extractJsonFromResponse } from '../lib/outbound/generation/extract-json'

describe('buildEmailGenerationInput', () => {
  const contact = { person_name: 'Jane Doe', title_hint: 'VP Manufacturing', company_name: 'Acme Corp' }

  it('assembles pain points, opportunities, and recent activity from a NormalizedAnalysis-shaped blob', () => {
    const finalResult = {
      company_summary: 'A mid-size industrial manufacturer.',
      pain_points: ['Manual reporting across 6 plants'],
      pain_points_structured: [],
      opportunities: [{ title: 'Plant reporting automation', description: 'Automate cross-plant reports' }],
      recent_activity: ['Opened a new facility in Ohio'],
      executive_brief: { what_to_sell: 'Operational dashboards', why_now: 'New facility just opened' },
      outreach_intelligence: { opening_angle: 'Congrats on the new Ohio facility', why_now: 'Growth phase' },
    }

    const input = buildEmailGenerationInput(contact, finalResult)

    expect(input.personName).toBe('Jane Doe')
    expect(input.titleHint).toBe('VP Manufacturing')
    expect(input.companyName).toBe('Acme Corp')
    expect(input.painPoints).toEqual(['Manual reporting across 6 plants'])
    expect(input.opportunities).toEqual([{ title: 'Plant reporting automation', description: 'Automate cross-plant reports' }])
    expect(input.recentActivity).toEqual(['Opened a new facility in Ohio'])
    expect(input.openingAngle).toBe('Congrats on the new Ohio facility')
    expect(input.whatToSell).toBe('Operational dashboards')
  })

  it('prefers pain_points_structured over the flat pain_points fallback when present', () => {
    const finalResult = {
      pain_points: ['flat fallback'],
      pain_points_structured: [{ point: 'structured pain point' }],
    }
    const input = buildEmailGenerationInput(contact, finalResult)
    expect(input.painPoints).toEqual(['structured pain point'])
  })

  it('degrades gracefully to empty arrays / undefined fields when final_result is null', () => {
    const input = buildEmailGenerationInput(contact, null)
    expect(input.painPoints).toEqual([])
    expect(input.opportunities).toEqual([])
    expect(input.recentActivity).toEqual([])
    expect(input.openingAngle).toBeUndefined()
  })
})

describe('extractJsonFromResponse', () => {
  it('strips ```json fences', () => {
    expect(extractJsonFromResponse('```json\n{"a": 1}\n```')).toBe('{"a": 1}')
  })

  it('extracts the outermost braces from surrounding prose', () => {
    expect(extractJsonFromResponse('Sure, here you go: {"a": 1} — hope that helps!')).toBe('{"a": 1}')
  })

  it('passes through already-clean JSON unchanged', () => {
    expect(extractJsonFromResponse('{"a": 1}')).toBe('{"a": 1}')
  })
})

describe('prompt builders', () => {
  const input = {
    personName: 'Jane Doe',
    titleHint: 'VP Manufacturing',
    companyName: 'Acme Corp',
    painPoints: ['Manual reporting across 6 plants'],
    opportunities: [{ title: 'Plant reporting automation' }],
    recentActivity: ['Opened a new facility in Ohio'],
  }

  it('subject line prompt includes the anti-hallucination rule and the research facts', () => {
    const { userPrompt } = buildSubjectLinePrompt(input)
    expect(userPrompt).toContain('Never invent a fact')
    expect(userPrompt).toContain('Manual reporting across 6 plants')
    expect(userPrompt).toContain('Plant reporting automation')
  })

  it('email prompt embeds the chosen subject line', () => {
    const { userPrompt } = buildEmailPrompt(input, 'Coordinating across 6 plants?')
    expect(userPrompt).toContain('Coordinating across 6 plants?')
  })

  it('follow-up prompt embeds the original email and asks for increasing urgency', () => {
    const originalEmail = {
      hook: 'h', personalization: 'p', painPoint: 'pp', valueProp: 'v', cta: 'c', signature: 's',
      fullText: 'Hi Jane, ...',
    }
    const { userPrompt } = buildFollowupPrompt(input, originalEmail)
    expect(userPrompt).toContain('Hi Jane, ...')
    expect(userPrompt).toContain('low -> medium -> high')
  })
})
