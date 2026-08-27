// ============================================================
// Financial/investor-relations register — capacity_expansion coverage gap
// ============================================================
// Regression for a real reliability failure found via a live Bharat Forge
// benchmark run (2026-08-24): the scrape returned only a domain stub
// (successfulUrls=[]), but enrichment genuinely found and used 8 real
// external sources (investor presentations/transcripts) — data_quality_notes
// confirmed the LLM narrative layer read real content ("recent financial,
// CapEx, and operational signals were extracted via market transcripts and
// filings", real recent_activity: "INR 2,500 crore fundraising plan...
// CapEx... expanding investments..."). Yet extractSignals() re-extraction
// (confirmed to run correctly against the real enrichedContent — the wiring
// itself is intact, see route.ts's promptEnriched/Case A/B re-extraction)
// still produced ZERO signals.
//
// Traced to the root cause: none of it was a wiring/skip bug. It was a
// pattern-coverage gap — financial/investor-relations register phrases
// growth/capacity differently than typical website marketing copy
// ("expanding our capacity") that the existing patterns targeted. Verified
// directly: none of capacity_expansion's or revenue_milestone's pre-existing
// patterns matched real reconstructed investor-transcript phrasing.
//
// Fix: extend capacity_expansion's existing pattern list (not a new signal
// type, not a redesign) with financial-register variants. This test proves
// the specific gap is closed and stays closed.
// ============================================================

import { describe, it, expect } from 'vitest'
import { extractSignals } from '../lib/pipeline/evidence-extractor'

describe('capacity_expansion — financial/investor-relations register', () => {
  it('detects a real investor-transcript-style capacity/CapEx trigger from externally-sourced (enriched) content', () => {
    const websiteContent = `# Bharat Forge\n\nWebsite: https://www.bharatforge.com\n\n[Direct website scraping failed — content could not be extracted.]\n[Company intelligence will be sourced from external research.]`
    const enrichedContent =
      `[SOURCE: Investor Presentation (VERY HIGH confidence) | tier1 | https://example.com/transcript]\n` +
      `Bharat Forge announced an INR 2,500 crore fundraising plan dedicated to supporting growth CapEx alongside annual organic CapEx of around INR 1,800 crore.\n` +
      `[END SOURCE: Investor Presentation (VERY HIGH confidence)]\n`

    const result = extractSignals(websiteContent, enrichedContent, 'Bharat Forge')
    const signal = result.signals.find(s => s.type === 'capacity_expansion')

    expect(signal).toBeDefined()
    expect(signal!.is_company_subject).toBe(true)
    expect(signal!.evidence[0].origin).toBe('filing')
    expect(result.factorSourceMap.capacity_expansion).toContain('capacity_expansion')
    expect(result.detectedFactors.capacity_expansion).toBe(true)
  })

  it('detects "capital raise" phrasing', () => {
    const content = `--- PAGE: / (https://example.com) ---\n\nWe announced a capital raise this quarter to fund our next phase of growth.\n`
    const result = extractSignals(content, undefined, 'Acme Industries')
    expect(result.signals.find(s => s.type === 'capacity_expansion')).toBeDefined()
  })

  it('detects "expanding our investments" phrasing distinct from the pre-existing capacity/production wording', () => {
    const content = `--- PAGE: / (https://example.com) ---\n\nWe are expanding our investments across all manufacturing regions this year.\n`
    const result = extractSignals(content, undefined, 'Acme Industries')
    expect(result.signals.find(s => s.type === 'capacity_expansion')).toBeDefined()
  })

  it('non-regression: pre-existing capacity_expansion patterns still match exactly as before', () => {
    const content = `--- PAGE: / (https://example.com) ---\n\nWe are expanding our capacity at our main plant.\n`
    const result = extractSignals(content, undefined, 'Acme Industries')
    const signal = result.signals.find(s => s.type === 'capacity_expansion')
    expect(signal).toBeDefined()
    expect(signal!.evidence[0].pattern_matched).toBe('capacity_expansion')
  })

  it('non-regression: a bare, unrelated mention of "plan" or "growth" without capex/fundraising language does not false-positive', () => {
    const content = `--- PAGE: / (https://example.com) ---\n\nOur growth as a company is thanks to our people. We plan to keep hiring great talent.\n`
    const result = extractSignals(content, undefined, 'Acme Industries')
    expect(result.signals.find(s => s.type === 'capacity_expansion')).toBeUndefined()
  })
})
