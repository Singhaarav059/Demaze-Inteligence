// ============================================================
// D.5 — Layoffs/restructuring & private-funding-round signals
// ============================================================
// Discovery (discovery-engine.ts) + extraction (evidence-extractor.ts) +
// participation in the existing confirmed service detectors
// (service-evidence.ts) — that is the whole scope. Neither signal is its
// own evidence tier or its own service: every detector change below is an
// `&&` alongside evidence that already independently qualifies for a tier
// (weak-tier operational language, multi-location structure, a real
// medium-tier pattern, a named tool in active use). A layoff/restructuring
// or funding mention with NO other service-specific evidence must never
// produce a deterministic opportunity.
//
// Deliberately does NOT touch, and these tests deliberately do NOT
// exercise: deriveTimingStrength(), deriveWhyNowTrace(), TIMING_TRIGGER_
// FACTORS, or normalizeAnalysisResult() — D.3's Why Now stays completely
// unaffected, verified explicitly below (scenario 8).
// ============================================================

import { describe, it, expect } from 'vitest'
import { extractSignals, buildCompanyProfile } from '../lib/pipeline/evidence-extractor'
import { classifySourceType } from '../lib/enrichment/discovery-engine'
import { detectServiceEvidence } from '../lib/pipeline/service-evidence'
import { generateDeterministicOpportunities, deriveWhyNowTrace } from '../lib/pipeline/opportunity-engine'
import { verifyQuoteInContent, isQuoteGrounded } from '../lib/pipeline/quote-verification'

const CONFIRMED_SERVICES = [
  'AI-powered business applications', 'Custom SaaS platforms', 'Ecommerce ecosystems',
  'Marketplace platforms', 'Workflow automation systems', 'Internal operational software',
  'Analytics and reporting systems', 'AI integrations and intelligent automation',
]

// ── 1. Extraction (evidence-extractor.ts) ─────────────────────────

describe('extraction — layoffs_restructuring', () => {
  it('extracts the signal and marks it company-subject', () => {
    const content = `--- PAGE: /news (https://example.com/news) ---\n\nAcme Manufacturing announced layoffs affecting 150 employees as part of a broader workforce reduction this quarter.\n`
    const result = extractSignals(content, undefined, 'Acme Manufacturing')
    const signal = result.signals.find(s => s.type === 'layoffs_restructuring')
    expect(signal).toBeDefined()
    expect(signal!.is_company_subject).toBe(true)
  })

  it('also matches "job cuts" and "corporate restructuring" phrasing', () => {
    const content = `--- PAGE: /press (https://example.com/press) ---\n\nAcme Corp confirmed job cuts as part of a corporate restructuring affecting its workforce.\n`
    const result = extractSignals(content, undefined, 'Acme Corp')
    expect(result.signals.find(s => s.type === 'layoffs_restructuring')).toBeDefined()
  })
})

describe('extraction — funding_round', () => {
  it('extracts the signal and marks it company-subject', () => {
    const content = `--- PAGE: /news (https://example.com/news) ---\n\nAcme Robotics raises $15 million in a Series B funding round led by leading venture capital investors this month.\n`
    const result = extractSignals(content, undefined, 'Acme Robotics')
    const signal = result.signals.find(s => s.type === 'funding_round')
    expect(signal).toBeDefined()
    expect(signal!.is_company_subject).toBe(true)
  })

  it('also matches "secures $X million in funding" phrasing', () => {
    const content = `--- PAGE: /news (https://example.com/news) ---\n\nAcme Robotics secures $8 million in funding to accelerate product development.\n`
    const result = extractSignals(content, undefined, 'Acme Robotics')
    expect(result.signals.find(s => s.type === 'funding_round')).toBeDefined()
  })
})

// ── 2. Source classification (discovery-engine.ts) ───────────────

describe('source classification', () => {
  it('classifies a layoff-shaped URL/title as layoff_announcement', () => {
    expect(classifySourceType('https://news.example.com/acme-layoffs-2026', 'Acme Corp Announces Layoffs')).toBe('layoff_announcement')
    expect(classifySourceType('https://news.example.com/story', 'Acme Corp confirms job cuts amid workforce reduction')).toBe('layoff_announcement')
  })

  it('classifies a funding-shaped URL/title as funding_announcement', () => {
    expect(classifySourceType('https://news.example.com/acme-series-b', 'Acme Corp Raises $15 Million in Series B Funding')).toBe('funding_announcement')
    expect(classifySourceType('https://news.example.com/story', 'Acme Corp secures new funding round from investors')).toBe('funding_announcement')
  })

  it('non-regression: unrelated URLs/titles still classify as before', () => {
    expect(classifySourceType('https://example.com/careers', 'Careers at Acme Corp')).toBe('careers_page')
    expect(classifySourceType('https://example.com/investor/annual-report-2026.pdf', 'Annual Report 2026')).toBe('annual_report')
  })
})

// ── 3. Quote verification ────────────────────────────────────────

describe('quote verification', () => {
  it('an extracted layoffs_restructuring quote is exactly grounded in the content it was extracted from', () => {
    const content = `--- PAGE: /news (https://example.com/news) ---\n\nAcme Manufacturing announced layoffs affecting 150 employees as part of a broader workforce reduction this quarter.\n`
    const result = extractSignals(content, undefined, 'Acme Manufacturing')
    const signal = result.signals.find(s => s.type === 'layoffs_restructuring')!
    const { tier } = verifyQuoteInContent(signal.best_quote, content)
    expect(tier).toBe('exact')
    expect(isQuoteGrounded(signal.best_quote, content, 'exact')).toBe(true)
  })

  it('an extracted funding_round quote is exactly grounded in the content it was extracted from', () => {
    const content = `--- PAGE: /news (https://example.com/news) ---\n\nAcme Robotics raises $15 million in a Series B funding round led by leading venture capital investors this month.\n`
    const result = extractSignals(content, undefined, 'Acme Robotics')
    const signal = result.signals.find(s => s.type === 'funding_round')!
    const { tier } = verifyQuoteInContent(signal.best_quote, content)
    expect(tier).toBe('exact')
    expect(isQuoteGrounded(signal.best_quote, content, 'exact')).toBe(true)
  })
})

// ── 4. Company-subject gating ─────────────────────────────────────

describe('company-subject gating', () => {
  it('a customer-facing funding mention is never treated as the company\'s own funding signal', () => {
    const content = `--- PAGE: / (https://example.com) ---\n\nWe help our clients secure $2 million in funding for their growth initiatives.\n`
    const result = extractSignals(content, undefined, 'Acme Advisory')
    expect(result.signals.find(s => s.type === 'funding_round')).toBeUndefined()
  })

  it('a customer-facing layoffs/restructuring mention is never treated as the company\'s own signal', () => {
    const content = `--- PAGE: / (https://example.com) ---\n\nWe help our clients manage workforce reduction and job cuts during difficult transitions.\n`
    const result = extractSignals(content, undefined, 'Acme Advisory')
    expect(result.signals.find(s => s.type === 'layoffs_restructuring')).toBeUndefined()
  })
})

// ── 5. Neither signal alone ever produces an opportunity ─────────

describe('no opportunity from either signal alone', () => {
  it('funding language alone, with no service-specific evidence, produces zero deterministic opportunities across all 8 services', () => {
    const content = 'Acme Robotics raises $15 million in a Series B funding round led by leading venture capital investors this month.'
    const { profile } = buildCompanyProfile(content)
    expect(generateDeterministicOpportunities(content, profile, false)).toEqual([])
    for (const r of detectServiceEvidence(content, profile, false)) expect(r.threshold).toBe('none')
  })

  it('layoffs language alone, with no service-specific evidence, produces zero deterministic opportunities across all 8 services', () => {
    const content = 'Acme Manufacturing announced layoffs affecting 150 employees as part of a broader workforce reduction this quarter.'
    const { profile } = buildCompanyProfile(content)
    expect(generateDeterministicOpportunities(content, profile, false)).toEqual([])
    for (const r of detectServiceEvidence(content, profile, false)) expect(r.threshold).toBe('none')
  })

  it('both signals together, still with no service-specific evidence, produce zero deterministic opportunities', () => {
    const content = 'Acme Robotics raises $15 million in a Series B funding round. Acme Robotics announced layoffs and a corporate restructuring affecting its workforce.'
    const { profile } = buildCompanyProfile(content)
    expect(generateDeterministicOpportunities(content, profile, true)).toEqual([])
  })
})

// ── 6. Combined with real service evidence: strengthens, never invents ──

describe('layoffs strengthens Workflow automation systems only when weak process evidence already exists', () => {
  it('weak-only process language + layoffs upgrades weak -> medium', () => {
    const content = 'Our team processes and handles customer requests daily. Acme Corp announced layoffs affecting 150 employees as part of a broader workforce reduction this quarter.'
    const { profile } = buildCompanyProfile(content)
    const [result] = detectServiceEvidence(content, profile, false).filter(r => r.service === 'Workflow automation systems')
    expect(result.threshold).toBe('medium')
    expect(result.evidence.some(e => e.pattern === 'layoffs language')).toBe(true)
  })

  it('non-regression: the same weak-only process language WITHOUT layoffs still stays at weak (never surfaced)', () => {
    const content = 'Our team processes and handles customer requests daily.'
    const { profile } = buildCompanyProfile(content)
    const [result] = detectServiceEvidence(content, profile, false).filter(r => r.service === 'Workflow automation systems')
    expect(result.threshold).toBe('weak')
  })

  it('layoffs language with ZERO process evidence gets no boost at all — threshold stays none', () => {
    const content = 'Acme Corp announced layoffs affecting 150 employees as part of a broader workforce reduction this quarter.'
    const { profile } = buildCompanyProfile(content)
    const [result] = detectServiceEvidence(content, profile, false).filter(r => r.service === 'Workflow automation systems')
    expect(result.threshold).toBe('none')
  })

  it('a real medium-tier match is unaffected by layoffs — still medium, not force-escalated to strong', () => {
    const content = 'Our complaint lifecycle process involves multiple manual handoffs between teams. Acme Corp announced layoffs affecting 150 employees.'
    const { profile } = buildCompanyProfile(content)
    const [result] = detectServiceEvidence(content, profile, false).filter(r => r.service === 'Workflow automation systems')
    expect(result.threshold).toBe('medium')
  })
})

describe('layoffs strengthens Internal operational software only when multi-location evidence already exists', () => {
  it('multi-location (weak) + layoffs upgrades weak -> medium', () => {
    const content = 'We operate as a multi-location manufacturer with several plants across the region. Acme Corp announced layoffs affecting 150 employees as part of a broader workforce reduction.'
    const { profile } = buildCompanyProfile(content)
    const [result] = detectServiceEvidence(content, profile, false).filter(r => r.service === 'Internal operational software')
    expect(result.threshold).toBe('medium')
    expect(result.evidence.some(e => e.pattern === 'layoffs language')).toBe(true)
  })

  it('a single-location company mentioning layoffs gets no boost — threshold stays none', () => {
    const content = 'Acme Corp announced layoffs affecting 150 employees as part of a broader workforce reduction this quarter.'
    const { profile } = buildCompanyProfile(content)
    const [result] = detectServiceEvidence(content, profile, false).filter(r => r.service === 'Internal operational software')
    expect(result.threshold).toBe('none')
  })
})

describe('funding strengthens Custom SaaS platforms only when real proprietary-tool evidence already exists', () => {
  it('proprietary-tool evidence + funding (no growth/hiring signal) still reaches medium', () => {
    const content = 'We rely on our own internal tool to track customer onboarding. Acme Robotics raises $15 million in a Series B funding round this month.'
    const { profile } = buildCompanyProfile(content)
    const [result] = detectServiceEvidence(content, profile, false).filter(r => r.service === 'Custom SaaS platforms')
    expect(result.threshold).toBe('medium')
    expect(result.evidence.some(e => e.pattern === 'funding raise language')).toBe(true)
  })

  it('non-regression: the same proprietary-tool evidence WITHOUT funding or growth/hiring stays at none, exactly as before this change', () => {
    const content = 'We rely on our own internal tool to track customer onboarding.'
    const { profile } = buildCompanyProfile(content)
    const [result] = detectServiceEvidence(content, profile, false).filter(r => r.service === 'Custom SaaS platforms')
    expect(result.threshold).toBe('none')
  })

  it('funding language with ZERO proprietary-tool evidence gets no boost — threshold stays none', () => {
    const content = 'Acme Robotics raises $15 million in a Series B funding round this month.'
    const { profile } = buildCompanyProfile(content)
    const [result] = detectServiceEvidence(content, profile, false).filter(r => r.service === 'Custom SaaS platforms')
    expect(result.threshold).toBe('none')
  })

  it('growthOrHiringSignal alone (pre-existing behavior) still works exactly as before, with no funding language present', () => {
    const content = 'We rely on our own internal tool to track customer onboarding.'
    const { profile } = buildCompanyProfile(content)
    const [result] = detectServiceEvidence(content, profile, true).filter(r => r.service === 'Custom SaaS platforms')
    expect(result.threshold).toBe('medium')
  })
})

describe('funding strengthens AI integrations and intelligent automation only when a named tool is already in active use', () => {
  it('named tool in active use + funding upgrades medium -> strong', () => {
    const content = 'Acme Robotics runs Salesforce as its core CRM platform today. Acme Robotics raises $15 million in a Series B funding round led by leading venture capital investors.'
    const { profile } = buildCompanyProfile(content)
    const [result] = detectServiceEvidence(content, profile, false).filter(r => r.service === 'AI integrations and intelligent automation')
    expect(result.threshold).toBe('strong')
    expect(result.evidence.some(e => e.pattern === 'funding raise language')).toBe(true)
  })

  it('non-regression: the same named-tool evidence WITHOUT funding or repetitive-task language stays at medium', () => {
    const content = 'Acme Robotics runs Salesforce as its core CRM platform today.'
    const { profile } = buildCompanyProfile(content)
    const [result] = detectServiceEvidence(content, profile, false).filter(r => r.service === 'AI integrations and intelligent automation')
    expect(result.threshold).toBe('medium')
  })

  it('funding language with NO named tool in active use gets no boost — threshold unaffected', () => {
    const content = 'Acme Robotics raises $15 million in a Series B funding round this month.'
    const { profile } = buildCompanyProfile(content)
    const [result] = detectServiceEvidence(content, profile, false).filter(r => r.service === 'AI integrations and intelligent automation')
    expect(result.threshold).toBe('none')
  })
})

// ── 7. Existing disqualifiers still win ───────────────────────────

describe('existing disqualifiers still win over the new signals', () => {
  it('an AI-powered business applications disqualifier is untouched by this change (that detector never consults these signals)', () => {
    const content = `
      Our team manually reviews and scores every lead before it reaches sales.
      We have regional offices and field teams across the country.
      Our in-house AI team continuously improves this process.
      The company raises $15 million in a Series B funding round.
      The company announced layoffs as part of a workforce reduction.
    `
    const { profile } = buildCompanyProfile(content)
    const results = detectServiceEvidence(content, profile, false)
    const aiApps = results.find(r => r.service === 'AI-powered business applications')
    expect(aiApps?.disqualified).toBe(true)
    expect(aiApps?.threshold).toBe('none')
  })

  it('a Custom SaaS platforms disqualifier (company IS a SaaS company) suppresses the service even with funding + proprietary-tool language present', () => {
    const content = `
      We are a leading SaaS company providing cloud-based subscription software platforms to businesses worldwide.
      We rely on our own internal tool to track customer onboarding.
      Our company raises $15 million in a Series B funding round.
    `
    const { profile } = buildCompanyProfile(content)
    const results = detectServiceEvidence(content, profile, true)
    const saas = results.find(r => r.service === 'Custom SaaS platforms')
    expect(saas?.disqualified).toBe(true)
    expect(saas?.threshold).toBe('none')
  })

  it('a Workflow automation systems disqualifier (process already automated) suppresses the service even with weak process language + layoffs present', () => {
    const content = `
      Our process is fully automated and system-driven end to end.
      Our team processes and handles customer requests daily.
      The company announced layoffs affecting 150 employees as part of a workforce reduction.
    `
    const { profile } = buildCompanyProfile(content)
    const results = detectServiceEvidence(content, profile, false)
    const workflow = results.find(r => r.service === 'Workflow automation systems')
    expect(workflow?.disqualified).toBe(true)
    expect(workflow?.threshold).toBe('none')
  })
})

// ── 8. D.3 Why Now is completely unaffected ───────────────────────

describe('D.3 Why Now is unaffected by this change', () => {
  it('a company with ONLY layoffs/funding evidence and no other timing-trigger factor produces "no verified timing signal"', () => {
    const content = `--- PAGE: /news (https://example.com/news) ---\n\nAcme Corp raises $15 million in a Series B funding round. Acme Corp announced layoffs affecting 150 employees as part of a broader workforce reduction.\n`
    const result = extractSignals(content, undefined, 'Acme Corp')
    const trace = deriveWhyNowTrace(result.factorSourceMap, result.signals)
    expect(trace.status).toBe('no_verified_signal')
    expect(trace.explanation).toBe('no verified timing signal')
  })

  it('a pre-existing timing trigger (capacity_expansion) still traces exactly as before, unaffected by the layoffs/funding signals also being present', () => {
    const content = `--- PAGE: / (https://example.com) ---\n\nWe are expanding our capacity at our main plant. This capacity expansion follows strong demand growth. Acme Corp raises $15 million in a Series B funding round.\n`
    const result = extractSignals(content, undefined, 'Acme Corp')
    const trace = deriveWhyNowTrace(result.factorSourceMap, result.signals)
    expect(trace.status).toBe('traceable')
    expect(trace.fact).toContain('expanding our capacity')
    // The funding quote must never leak into the Why Now trace — it's not
    // one of TIMING_TRIGGER_FACTORS anymore (reverted in this change).
    expect(trace.fact).not.toContain('Series B')
  })
})

// ── 9. Existing opportunities/behavior are not affected ──────────

describe('non-regression: existing signals, factors, and opportunity gating are unaffected', () => {
  it('capacity_expansion still extracts identically alongside the new pattern list', () => {
    const content = `--- PAGE: / (https://example.com) ---\n\nWe are expanding our capacity at our main plant.\n`
    const result = extractSignals(content, undefined, 'Acme Industries')
    const signal = result.signals.find(s => s.type === 'capacity_expansion')
    expect(signal).toBeDefined()
    expect(signal!.evidence[0].pattern_matched).toBe('capacity_expansion')
  })

  it('a disqualifier match suppresses the service entirely even when other content would otherwise clear the bar (pre-existing scenario, still holds)', () => {
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

  it('generateDeterministicOpportunities only ever returns titles from the confirmed 8, even with funding/layoffs content mixed in', () => {
    const content = 'We manage a growing network of vendors and partners onboarding onto our marketplace, with dealer networks and regional offices across multiple locations. The company raises $15 million in funding. The company announced layoffs.'
    const { profile } = buildCompanyProfile(content)
    const opps = generateDeterministicOpportunities(content, profile, true)
    for (const o of opps) expect(CONFIRMED_SERVICES).toContain(o.title)
  })
})
