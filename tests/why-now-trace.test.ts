// ============================================================
// Evidence-traceable Why Now (D.3)
// ============================================================
// why_now.explanation / why_now_for_opportunity used to be raw LLM
// narrative with no mechanical connection to real evidence. Covers
// deriveWhyNowTrace() (opportunity-engine.ts) — built ONLY from
// factorSourceMap + signals (evidence-extractor.ts's own code-derived
// structures, no LLM involved) — and its propagation through
// normalizeAnalysisResult().
// ============================================================

import { describe, it, expect } from 'vitest'
import { extractSignals } from '../lib/pipeline/evidence-extractor'
import type { DetectedSignal, DetectedFactors } from '../lib/pipeline/evidence-extractor'
import { deriveWhyNowTrace } from '../lib/pipeline/opportunity-engine'
import { normalizeAnalysisResult } from '../lib/pipeline/normalize'

describe('deriveWhyNowTrace', () => {
  it('scenario 1: a recent verified (validated, 2+ evidence) trigger produces a traceable explanation that contains the real quote', () => {
    const content = `--- PAGE: / (https://example.com) ---\n\nWe are expanding our capacity at our main plant. This capacity expansion follows strong demand growth.\n`
    const result = extractSignals(content, undefined, 'Acme Industries')
    const trace = deriveWhyNowTrace(result.factorSourceMap, result.signals)

    expect(trace.status).toBe('traceable')
    expect(trace.fact).toContain('expanding our capacity')
    expect(trace.explanation).toContain('WHY NOW:')
    expect(trace.explanation).toContain('expanding our capacity')
  })

  it('scenario 2: multiple real triggers are all cited, each with its own evidence id', () => {
    const content =
      `--- PAGE: / (https://example.com) ---\n\n` +
      `We are expanding our capacity at our main plant. This capacity expansion follows strong demand growth.\n` +
      `We are also hiring an AI engineer for our new initiative.\n`
    const result = extractSignals(content, undefined, 'Acme Industries')
    const trace = deriveWhyNowTrace(result.factorSourceMap, result.signals)

    expect(trace.status).toBe('traceable')
    expect(trace.fact).toContain('expanding our capacity')
    expect(trace.fact).toContain('AI engineer')
    expect(trace.evidence_ids.length).toBeGreaterThanOrEqual(2)
    expect(new Set(trace.evidence_ids).size).toBe(trace.evidence_ids.length) // no duplicate ids
  })

  it('scenario 3: a single-mention (unvalidated) trigger is hedged and produces a weaker inference than a validated one', () => {
    const singleMention = `--- PAGE: / (https://example.com) ---\n\nWe are hiring an AI engineer for our new initiative.\n`
    const weakResult = extractSignals(singleMention, undefined, 'Acme Industries')
    const weakTrace = deriveWhyNowTrace(weakResult.factorSourceMap, weakResult.signals)

    // Two independent pages mentioning the same signal -> validated: true
    // (evidence-extractor.ts's `validated = evidence.length >= 2` rule).
    const validated =
      `--- PAGE: / (https://example.com) ---\n\nWe are expanding our capacity at our main plant.\n\n` +
      `--- PAGE: /news (https://example.com/news) ---\n\nOur recent capacity expansion follows strong demand growth across all regions.\n`
    const strongResult = extractSignals(validated, undefined, 'Acme Industries')
    const strongTrace = deriveWhyNowTrace(strongResult.factorSourceMap, strongResult.signals)

    expect(weakTrace.status).toBe('traceable')
    expect(weakTrace.fact).toContain('(single-mention, unconfirmed)')
    expect(weakTrace.inference).toContain('weaker timing cue')

    expect(strongTrace.status).toBe('traceable')
    expect(strongTrace.fact).not.toContain('(single-mention, unconfirmed)')
    expect(strongTrace.inference).toContain('concrete, evidence-backed timing trigger')
  })

  it('scenario 4: no timing-relevant signal anywhere -> explicit "no verified timing signal", not a generic urgency statement', () => {
    // multi_location_operations is real but not one of the timing-trigger
    // factors (it's structural, not an event/change) — confirms this isn't
    // just "any signal present passes."
    const content = `--- PAGE: / (https://example.com) ---\n\nAcme Industries operates six manufacturing facilities across the region.\n`
    const result = extractSignals(content, undefined, 'Acme Industries')
    const trace = deriveWhyNowTrace(result.factorSourceMap, result.signals)

    expect(trace.status).toBe('no_verified_signal')
    expect(trace.explanation).toBe('no verified timing signal')
    expect(trace.evidence_ids).toEqual([])
    expect(trace.source_urls).toEqual([])
  })

  it('scenario 4b: no signals/factorSourceMap at all -> the same explicit no-signal state', () => {
    expect(deriveWhyNowTrace(undefined, undefined)).toEqual(deriveWhyNowTrace({}, []))
    expect(deriveWhyNowTrace({}, []).status).toBe('no_verified_signal')
  })

  it('scenario 5: a factor with no factorSourceMap entry is never cited, even if it would otherwise sound like a growth trigger — never invents a trigger the extractor did not actually find', () => {
    // Simulates an LLM-only-derived factor (true in the broader
    // DetectedFactors set) that never traced to a real, code-matched
    // signal — deriveWhyNowTrace reads ONLY factorSourceMap, never the
    // broader detected_factors booleans, so this can't leak through.
    const trace = deriveWhyNowTrace({ growth_signal: undefined } as Partial<Record<keyof DetectedFactors, string[]>>, [])
    expect(trace.status).toBe('no_verified_signal')
  })

  it('scenario 5b: customer-facing text (not about the company itself) is never cited as a trigger', () => {
    const fakeSignal: DetectedSignal = {
      type: 'capacity_expansion',
      strength: 'strong',
      is_company_subject: false, // describes a customer/partner, not the researched company
      validated: true,
      best_quote: 'Our customers are expanding their capacity with our platform.',
      evidence: [{
        id: 'e1',
        quote: 'Our customers are expanding their capacity with our platform.',
        signal_type: 'capacity_expansion',
        subject: 'customer_use_case',
        source_url: 'https://example.com',
        page_type: 'products',
        source_tier: 'tier3',
        evidence_strength: 'low',
        pattern_matched: 'capacity_expansion',
        origin: 'own_site',
      }],
    }
    const trace = deriveWhyNowTrace({ capacity_expansion: ['capacity_expansion'] }, [fakeSignal])
    expect(trace.status).toBe('no_verified_signal')
  })

  it('scenario 6: fact and inference are separated, distinct fields', () => {
    const content = `--- PAGE: / (https://example.com) ---\n\nWe are expanding our capacity at our main plant. This capacity expansion follows strong demand growth.\n`
    const result = extractSignals(content, undefined, 'Acme Industries')
    const trace = deriveWhyNowTrace(result.factorSourceMap, result.signals)

    expect(trace.fact).toBeDefined()
    expect(trace.inference).toBeDefined()
    expect(trace.fact).not.toBe(trace.inference)
    // The fact is grounded in a real quote; the inference is clearly a
    // separate interpretive sentence, not a restatement of the quote.
    expect(trace.fact).toContain('"')
    expect(trace.inference).not.toContain('"')
  })

  it('scenario 7: evidence ids and source urls trace back to the real ExtractedEvidence, never manufactured', () => {
    const content = `--- PAGE: /investors (https://example.com/investors) ---\n\nWe are expanding our capacity at our main plant. This capacity expansion follows strong demand growth.\n`
    const result = extractSignals(content, undefined, 'Acme Industries')
    const capacitySignal = result.signals.find(s => s.type === 'capacity_expansion')
    expect(capacitySignal).toBeDefined()
    const realIds = capacitySignal!.evidence.map(e => e.id)
    const realUrls = capacitySignal!.evidence.map(e => e.source_url)

    const trace = deriveWhyNowTrace(result.factorSourceMap, result.signals)
    for (const id of trace.evidence_ids) expect(realIds).toContain(id)
    for (const url of trace.source_urls) expect(realUrls).toContain(url)
  })
})

describe('normalizeAnalysisResult — Why Now propagation (scenario 8: no regression)', () => {
  const content = `--- PAGE: / (https://example.com) ---\n\nOur team manually reviews and prioritizes every lead before it reaches sales. We are expanding our capacity at our main plant. This capacity expansion follows strong demand growth.\n`

  function baseRaw() {
    return {
      company_name: 'Test Co',
      _service_evidence_content: content,
      _extractor: {
        companySubjectCount: 1,
        signals: extractSignals(content, undefined, 'Test Co').signals,
        factorSourceMap: extractSignals(content, undefined, 'Test Co').factorSourceMap,
        leadershipContacts: [],
        websitePreview: content,
      },
      ai_opportunities: [],
    }
  }

  it('the top-level why_now.explanation is now the evidence-traced text, not a raw LLM narrative fallback', () => {
    const result = normalizeAnalysisResult({
      ...baseRaw(),
      why_now: { explanation: 'Because the company is growing, this is a good time to contact them.', score: 8 },
    })
    // The raw LLM narrative must NOT survive into the final explanation —
    // it's replaced by the code-composed, evidence-traced version.
    expect(result.why_now.explanation).not.toContain('Because the company is growing')
    expect(result.why_now.explanation).toContain('expanding our capacity')
  })

  it('each opportunity carries the same traceable why_now fields, and existing opportunity fields are unaffected', () => {
    const result = normalizeAnalysisResult(baseRaw())
    const opp = result.opportunities.find(o => o.title === 'AI-powered business applications')
    expect(opp).toBeDefined()
    expect(opp?.why_now_status).toBe('traceable')
    expect(opp?.why_now_fact).toContain('expanding our capacity')
    expect(opp?.why_now_inference).toBeTruthy()
    expect(opp?.why_now_evidence_ids?.length).toBeGreaterThan(0)
    // Non-regression: threshold/evidence_strength/capability_fit computed
    // in earlier sessions are unaffected by this change.
    expect(opp?.source).toBe('deterministic')
    expect(opp?.evidence_strength).toBeTruthy()
    expect(opp?.capability_fit).toBe('high')
  })

  it('reports "no verified timing signal" end to end when there is no real timing trigger', () => {
    const plainContent = `--- PAGE: / (https://example.com) ---\n\nOur team manually reviews and prioritizes every lead before it reaches sales.\n`
    const extracted = extractSignals(plainContent, undefined, 'Test Co')
    const result = normalizeAnalysisResult({
      company_name: 'Test Co',
      _service_evidence_content: plainContent,
      _extractor: {
        companySubjectCount: 1,
        signals: extracted.signals,
        factorSourceMap: extracted.factorSourceMap,
        leadershipContacts: [],
        websitePreview: plainContent,
      },
      ai_opportunities: [],
      why_now: { explanation: 'This company seems promising and growing fast.', score: 7 },
    })
    expect(result.why_now.explanation).toBe('no verified timing signal')
    const opp = result.opportunities.find(o => o.title === 'AI-powered business applications')
    expect(opp?.why_now_status).toBe('no_verified_signal')
    expect(opp?.why_now_for_opportunity).toBe('no verified timing signal')
  })
})
