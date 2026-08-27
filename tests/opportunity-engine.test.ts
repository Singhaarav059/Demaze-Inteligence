// ============================================================
// Per-opportunity evidence/fit model (opportunity-engine.ts, v4)
// ============================================================
// Pure-function unit tests for deriveEvidenceStrength / deriveCapabilityFit /
// deriveTimingStrength / computeOpportunityConfidence. Scenario numbers below
// refer to the 12-scenario test plan the model was built against.

import { describe, it, expect } from 'vitest'
import {
  deriveEvidenceStrength,
  deriveCapabilityFit,
  deriveTimingStrength,
  computeOpportunityConfidence,
  generateDeterministicOpportunities,
} from '../lib/pipeline/opportunity-engine'
import { detectServiceEvidence } from '../lib/pipeline/service-evidence'
import type { DetectedFactors } from '../lib/pipeline/evidence-extractor'
import { buildCompanyProfile } from '../lib/pipeline/evidence-extractor'

const NO_TRIGGERS: Partial<DetectedFactors> = {
  recent_news_or_event: false, hiring_signal: false, capacity_expansion: false,
  growth_signal: false, digital_transformation: false, industry_40_initiative: false,
}
const TWO_TRIGGERS: Partial<DetectedFactors> = { ...NO_TRIGGERS, hiring_signal: true, capacity_expansion: true }
const ONE_TRIGGER: Partial<DetectedFactors> = { ...NO_TRIGGERS, hiring_signal: true }

describe('deriveEvidenceStrength', () => {
  it('scenario 1/6: deterministic strong threshold with 2+ matches -> CONFIRMED', () => {
    expect(deriveEvidenceStrength('deterministic', 'strong', 2)).toBe('CONFIRMED')
    expect(deriveEvidenceStrength('deterministic', 'strong', 3)).toBe('CONFIRMED')
  })

  it('deterministic strong with a single match, or medium with 2+, -> STRONG', () => {
    expect(deriveEvidenceStrength('deterministic', 'strong', 1)).toBe('STRONG')
    expect(deriveEvidenceStrength('deterministic', 'medium', 2)).toBe('STRONG')
  })

  it('deterministic medium with a single match -> MODERATE', () => {
    expect(deriveEvidenceStrength('deterministic', 'medium', 1)).toBe('MODERATE')
  })

  it('scenario 3: llm_verified never reaches CONFIRMED/STRONG — exact quote match is MODERATE, close is WEAK', () => {
    expect(deriveEvidenceStrength('llm_verified', undefined, 0, 'exact')).toBe('MODERATE')
    expect(deriveEvidenceStrength('llm_verified', undefined, 0, 'close')).toBe('WEAK')
  })

  it('scenario 3: llm_inferred (no quote to verify) is always WEAK, never silently upgraded', () => {
    expect(deriveEvidenceStrength('llm_inferred', undefined, 0)).toBe('WEAK')
  })

  it('scenario 9/7: no source / nothing matched -> NONE', () => {
    expect(deriveEvidenceStrength(undefined, undefined, 0)).toBe('NONE')
    expect(deriveEvidenceStrength('deterministic', 'none', 0)).toBe('NONE')
  })
})

describe('deriveCapabilityFit', () => {
  it('scenario 1: deterministic (code-matched to this exact service) is high', () => {
    expect(deriveCapabilityFit('deterministic')).toBe('high')
  })

  it('scenario 2: llm_verified/llm_inferred (LLM chose the service_line itself) is medium, never high', () => {
    expect(deriveCapabilityFit('llm_verified')).toBe('medium')
    expect(deriveCapabilityFit('llm_inferred')).toBe('medium')
  })
})

describe('deriveTimingStrength', () => {
  it('scenario 8: all-false DetectedFactors -> none, regardless of stale/generic narrative elsewhere', () => {
    expect(deriveTimingStrength(NO_TRIGGERS as DetectedFactors)).toBe('none')
  })

  it('undefined factors -> none (never guessed)', () => {
    expect(deriveTimingStrength(undefined)).toBe('none')
  })

  it('exactly one trigger factor -> moderate', () => {
    expect(deriveTimingStrength(ONE_TRIGGER as DetectedFactors)).toBe('moderate')
  })

  it('two or more trigger factors -> strong', () => {
    expect(deriveTimingStrength(TWO_TRIGGERS as DetectedFactors)).toBe('strong')
  })
})

describe('computeOpportunityConfidence', () => {
  it('scenario 1: CONFIRMED + high fit + strong timing -> Strong overall, high score', () => {
    const { score, label } = computeOpportunityConfidence('CONFIRMED', 'high', 'strong')
    expect(label).toBe('Strong')
    expect(score).toBeGreaterThanOrEqual(75)
  })

  it('scenario 2: strong-sounding narrative but only medium capability fit / weak timing does not inflate to Strong', () => {
    const { score, label } = computeOpportunityConfidence('MODERATE', 'medium', 'none')
    expect(label).not.toBe('Strong')
    expect(score).toBeLessThan(75)
  })

  it('scenario 3: WEAK evidence never produces a Strong/Confirmed-looking overall score', () => {
    const { score } = computeOpportunityConfidence('WEAK', 'medium', 'weak')
    expect(score).toBeLessThan(50)
  })

  it('has no company-size/revenue/industry term — same three inputs always produce the same output', () => {
    const a = computeOpportunityConfidence('STRONG', 'high', 'moderate')
    const b = computeOpportunityConfidence('STRONG', 'high', 'moderate')
    expect(a).toEqual(b)
  })
})

describe('scenario 7: conflicting sources — disqualifier wins over supporting evidence elsewhere (existing policy, documented)', () => {
  it('a disqualifier match suppresses the service entirely even when other content would otherwise clear the bar', () => {
    const content = `
      Our team manually reviews and scores every lead before it reaches sales.
      We have regional offices and field teams across the country.
      Our in-house AI team continuously improves this process.
    `
    const { profile } = buildCompanyProfile(content)
    const results = detectServiceEvidence(content, profile, false)
    const aiApps = results.find(r => r.service === 'AI-powered business applications')
    expect(aiApps?.disqualified).toBe(true)
    expect(aiApps?.threshold).toBe('none')
  })
})

describe('scenario 9: opportunity candidates outside the 8 confirmed services never reach the deterministic catalog', () => {
  it('generateDeterministicOpportunities only ever returns titles from the confirmed 8', () => {
    const content = 'We manage a growing network of vendors and partners onboarding onto our marketplace, with dealer networks and regional offices across multiple locations.'
    const { profile } = buildCompanyProfile(content)
    const opps = generateDeterministicOpportunities(content, profile, true)
    const CONFIRMED = [
      'AI-powered business applications', 'Custom SaaS platforms', 'Ecommerce ecosystems',
      'Marketplace platforms', 'Workflow automation systems', 'Internal operational software',
      'Analytics and reporting systems', 'AI integrations and intelligent automation',
    ]
    for (const o of opps) expect(CONFIRMED).toContain(o.title)
  })
})
