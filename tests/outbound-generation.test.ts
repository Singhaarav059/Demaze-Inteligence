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
      outreach_intelligence: { conversation_angle: 'Congrats on the new Ohio facility', why_now: 'Growth phase' },
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

  // Phase B, safety policy B3 — claim_type must survive into the input the
  // prompt actually renders, so the model can hedge an inference instead of
  // stating it as fact.
  it('carries claim_type through into painPointsDetailed and opportunities.claimType', () => {
    const finalResult = {
      pain_points_structured: [
        { title: 'Confirmed pain point', claim_type: 'observed' },
        { title: 'Guessed pain point', claim_type: 'inferred' },
      ],
      opportunities: [
        { title: 'Confirmed opportunity', claim_type: 'observed' },
        { title: 'Guessed opportunity', claim_type: 'inferred' },
      ],
    }
    const input = buildEmailGenerationInput(contact, finalResult)
    expect(input.painPointsDetailed).toEqual([
      { text: 'Confirmed pain point', claimType: 'observed' },
      { text: 'Guessed pain point', claimType: 'inferred' },
    ])
    expect(input.opportunities).toEqual([
      { title: 'Confirmed opportunity', description: undefined, claimType: 'observed' },
      { title: 'Guessed opportunity', description: undefined, claimType: 'inferred' },
    ])
  })

  it('leaves painPointsDetailed undefined when only the flat fallback path produced pain points', () => {
    const finalResult = { pain_points: ['flat fallback'], pain_points_structured: [] }
    const input = buildEmailGenerationInput(contact, finalResult)
    expect(input.painPointsDetailed).toBeUndefined()
  })

  it('degrades gracefully to empty arrays / undefined fields when final_result is null', () => {
    const input = buildEmailGenerationInput(contact, null)
    expect(input.painPoints).toEqual([])
    expect(input.opportunities).toEqual([])
    expect(input.recentActivity).toEqual([])
    expect(input.openingAngle).toBeUndefined()
  })

  it('produces byte-identical output whether salesIntelligence is omitted or explicitly null (degrade-gracefully contract)', () => {
    const finalResult = { outreach_intelligence: { conversation_angle: 'angle', why_now: 'now' }, executive_brief: { what_to_sell: 'X' } }
    const withoutArg = buildEmailGenerationInput(contact, finalResult)
    const withNull = buildEmailGenerationInput(contact, finalResult, null)
    const withUndefined = buildEmailGenerationInput(contact, finalResult, undefined)
    expect(withoutArg).toEqual(withNull)
    expect(withoutArg).toEqual(withUndefined)
  })

  it('prefers Sales Intelligence positioning/problemLabel over the raw narrative fields when both exist', () => {
    const finalResult = { outreach_intelligence: { conversation_angle: 'raw angle', why_now: 'now' }, executive_brief: { what_to_sell: 'raw sell' } }
    const salesIntelligence = { positioning: 'curated positioning', problemLabel: 'curated problem' }
    const input = buildEmailGenerationInput(contact, finalResult, salesIntelligence)
    expect(input.openingAngle).toBe('curated positioning')
    expect(input.whatToSell).toBe('curated problem')
    expect(input.salesIntelligence).toEqual(salesIntelligence)
  })

  it('falls back to the raw narrative fields when Sales Intelligence has no positioning/problemLabel', () => {
    const finalResult = { outreach_intelligence: { conversation_angle: 'raw angle' }, executive_brief: { what_to_sell: 'raw sell' } }
    const input = buildEmailGenerationInput(contact, finalResult, { evidenceSentence: 'just evidence' })
    expect(input.openingAngle).toBe('raw angle')
    expect(input.whatToSell).toBe('raw sell')
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

  it('renders no Sales Intelligence block when the field is absent (backward compatible)', () => {
    const { userPrompt } = buildEmailPrompt(input, 'subject')
    // The rules text itself references these phrases in quotes as
    // instructions ("If a 'Recommended positioning'... is given below") —
    // check for the colon-suffixed rendered-line form specifically, not the
    // rule's own mention of the phrase.
    expect(userPrompt).not.toContain('Recommended positioning:')
    expect(userPrompt).not.toContain('Relevant proof point (')
  })

  it('renders the Sales Intelligence block, including the case study naming instruction, when present', () => {
    const inputWithSI = {
      ...input,
      salesIntelligence: {
        evidenceSentence: 'Acme shows this directly.',
        positioning: 'Lead with operational visibility.',
        recommendedCta: 'Happy to share examples?',
        matchedCaseStudy: {
          title: 'Factory AI Command Center',
          client: 'Composite: a manufacturer',
          provenance: 'composite_illustrative' as const,
          challenge: 'No cross-plant visibility.',
          outcomes: [{ metric: 'OEE', value: '+9%' }],
        },
      },
    }
    const { userPrompt } = buildEmailPrompt(inputWithSI, 'subject')
    expect(userPrompt).toContain('Recommended positioning: Lead with operational visibility.')
    expect(userPrompt).toContain('Why this may matter: Acme shows this directly.')
    expect(userPrompt).toContain('Recommended call to action: Happy to share examples?')
    expect(userPrompt).toContain('do NOT name a real client')
    expect(userPrompt).toContain('Factory AI Command Center')
    expect(userPrompt).toContain('do not mention any client, case study, or result')
  })

  // Phase B, safety policy B3.
  it('annotates an inferred pain point as "(unconfirmed inference)", not a confirmed one, and includes the hedging rule', () => {
    const inputWithDetail = {
      ...input,
      painPointsDetailed: [
        { text: 'Confirmed pain point', claimType: 'observed' as const },
        { text: 'Guessed pain point', claimType: 'inferred' as const },
      ],
    }
    const { userPrompt } = buildEmailPrompt(inputWithDetail, 'subject')
    expect(userPrompt).toContain('- Confirmed pain point\n')
    expect(userPrompt).toContain('- Guessed pain point (unconfirmed inference)')
    expect(userPrompt).toContain('unconfirmed inference)" is a reasoned guess')
  })

  it('does not annotate observed opportunities, only inferred ones', () => {
    const inputWithDetail = {
      ...input,
      opportunities: [
        { title: 'Confirmed opportunity', claimType: 'observed' as const },
        { title: 'Guessed opportunity', claimType: 'inferred' as const },
      ],
    }
    const { userPrompt } = buildEmailPrompt(inputWithDetail, 'subject')
    expect(userPrompt).toContain('- Confirmed opportunity\n')
    expect(userPrompt).toContain('- Guessed opportunity (unconfirmed inference)')
    expect(userPrompt).toContain('unconfirmed inference)" is a reasoned guess')
  })

  it('falls back to the flat painPoints list (no annotation) when painPointsDetailed is absent', () => {
    const { userPrompt } = buildEmailPrompt(input, 'subject')
    // Exact line match — the RULES text itself mentions the literal phrase
    // "(unconfirmed inference)" as an instruction, so a whole-prompt
    // `not.toContain` would be a false failure; check the rendered pain
    // point line specifically has no annotation appended.
    expect(userPrompt).toContain('- Manual reporting across 6 plants\n')
    expect(userPrompt).not.toContain('- Manual reporting across 6 plants (unconfirmed inference)')
  })

  it('names the client directly for a named_client case study', () => {
    const inputWithSI = {
      ...input,
      salesIntelligence: {
        matchedCaseStudy: {
          title: 'Executive Intelligence Platform',
          client: 'Volvo Cars India',
          provenance: 'named_client' as const,
          challenge: 'Manual MIS reports.',
          outcomes: [],
        },
      },
    }
    const { userPrompt } = buildEmailPrompt(inputWithSI, 'subject')
    expect(userPrompt).toContain('you may name the client directly ("Volvo Cars India")')
  })
})
