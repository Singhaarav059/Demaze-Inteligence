// ============================================================
// ExtractedEvidence.published_at threading (Epitaxy vNext Phase 1 follow-up)
// ============================================================
// published_at was added to the ExtractedEvidence interface but never
// populated — this covers the one confirmed real upstream date source
// (SEC EDGAR's per-filing filingDate, threaded through edgar-client.ts's
// contextBlock as "- FORM filed YYYY-MM-DD ... — url" bullets) getting
// re-derived at match time via nearestFilingDate(), since the whole EDGAR
// block stays a single 'filing'-origin segment. Never invents a date for
// content that doesn't carry one.
// ============================================================

import { describe, it, expect } from 'vitest'
import { extractSignals } from '../lib/pipeline/evidence-extractor'

describe('extractSignals — ExtractedEvidence.published_at', () => {
  it('threads the real SEC filingDate for evidence matched inside an EDGAR filing bullet', () => {
    const websiteContent = `--- PAGE: / (https://example.com) ---\n\nWelcome to Acme Industries.\n`
    const enrichedContent =
      `[SOURCE: SEC EDGAR Filings (VERY HIGH confidence) | tier1 | https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000123456]\n` +
      `Acme Industries — CIK 123456 | Industry (SIC): Manufacturing\n` +
      `Recent SEC filings (most signal-relevant first):\n` +
      `- 8-K filed 2026-03-15 (often signals executive changes, M&A, or material agreements) — Acme Industries operates six manufacturing facilities across the region, serving customers worldwide. — https://sec.gov/x\n` +
      `[END SOURCE: SEC EDGAR Filings]\n`
    const result = extractSignals(websiteContent, enrichedContent, 'Acme Industries')
    const signal = result.signals.find(s => s.type === 'multi_location_operations')
    expect(signal).toBeDefined()
    const filingEvidence = signal!.evidence.find(e => e.origin === 'filing')
    expect(filingEvidence).toBeDefined()
    expect(filingEvidence!.published_at).toBe('2026-03-15')
  })

  it('picks the nearest filing date when a segment lists several filings with different dates', () => {
    const websiteContent = `--- PAGE: / (https://example.com) ---\n\nWelcome to Acme Industries.\n`
    const enrichedContent =
      `[SOURCE: SEC EDGAR Filings (VERY HIGH confidence) | tier1 | https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000123456]\n` +
      `- 10-Q filed 2025-11-01 — some unrelated filing text — https://sec.gov/a\n` +
      `- 8-K filed 2026-03-15 — Acme Industries operates six manufacturing facilities across the region, serving customers worldwide. — https://sec.gov/b\n` +
      `- DEF 14A filed 2024-01-10 — more unrelated filing text — https://sec.gov/c\n` +
      `[END SOURCE: SEC EDGAR Filings]\n`
    const result = extractSignals(websiteContent, enrichedContent, 'Acme Industries')
    const signal = result.signals.find(s => s.type === 'multi_location_operations')
    const filingEvidence = signal!.evidence.find(e => e.origin === 'filing')
    expect(filingEvidence!.published_at).toBe('2026-03-15')
  })

  it('leaves published_at undefined for a filing-origin segment with no "filed <date>" text (never invents one)', () => {
    const websiteContent = `--- PAGE: / (https://example.com) ---\n\nWelcome to Acme Industries.\n`
    // A search-fetched "annual_report" page — 'filing' origin, but not
    // literally an EDGAR block, so it never carries this exact phrase.
    const enrichedContent =
      `[SOURCE: annual_report | tier1 | https://acme.com/investors/annual-report.pdf]\nAcme Industries operates six manufacturing facilities across the region, serving customers worldwide.\n`
    const result = extractSignals(websiteContent, enrichedContent, 'Acme Industries')
    const signal = result.signals.find(s => s.type === 'multi_location_operations')
    const filingEvidence = signal!.evidence.find(e => e.origin === 'filing')
    expect(filingEvidence).toBeDefined()
    expect(filingEvidence!.published_at).toBeUndefined()
  })

  it('leaves published_at undefined for own_site and news evidence regardless of content', () => {
    const websiteContent = `--- PAGE: / (https://example.com) ---\n\nAcme Industries operates six manufacturing facilities across the region, serving customers worldwide.\n`
    const result = extractSignals(websiteContent, undefined, 'Acme Industries')
    const signal = result.signals.find(s => s.type === 'multi_location_operations')
    const ownSiteEvidence = signal!.evidence.find(e => e.origin === 'own_site')
    expect(ownSiteEvidence!.published_at).toBeUndefined()
  })

  it('retrieved_at is always set regardless of published_at', () => {
    const websiteContent = `--- PAGE: / (https://example.com) ---\n\nAcme Industries operates six manufacturing facilities across the region, serving customers worldwide.\n`
    const result = extractSignals(websiteContent, undefined, 'Acme Industries')
    const signal = result.signals.find(s => s.type === 'multi_location_operations')
    expect(signal!.evidence[0].retrieved_at).toBeTruthy()
    expect(() => new Date(signal!.evidence[0].retrieved_at).toISOString()).not.toThrow()
  })
})
