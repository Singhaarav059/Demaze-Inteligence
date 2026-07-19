// ============================================================
// Evidence Extractor — Page Type Detection & Homepage Subject Classification
// ============================================================
// Covers the 2026-07-19 fix documented in CLAUDE.md's "Known, deliberately
// deferred bug" section: parseContentSegments() previously passed the full
// URL (e.g. "https://example.com") to detectPageType() instead of the bare
// path already present in the "--- PAGE: /path (https://url) ---" header, so
// the homepage regex never matched and homepages were mislabeled 'other'.
// That mislabeling was *accidentally helpful* — 'other' pages already got a
// third-person self-reference check in classifySubject() that 'homepage'
// pages did not, so real homepage evidence happened to classify correctly
// anyway. Fixing only the URL-vs-path half in isolation would have been a
// regression (real 'homepage' pages hit an unconditional generic_marketing
// return with no fallback) — both halves were fixed together, verified here.
// ============================================================

import { describe, it, expect } from 'vitest'
import { extractSignals } from '../lib/pipeline/evidence-extractor'

describe('extractSignals — homepage page-type detection', () => {
  it('labels the root-path page "homepage" (not "other") and still classifies third-person self-reference as company_strategy', () => {
    const content = `
--- PAGE: / (https://example.com) ---

Acme Industries operates six manufacturing facilities across the region, serving customers worldwide.
`
    const result = extractSignals(content, undefined, 'Acme Industries')
    const multiLocation = result.signals.find(s => s.type === 'multi_location_operations')
    expect(multiLocation).toBeDefined()
    expect(multiLocation!.is_company_subject).toBe(true)

    const evidence = multiLocation!.evidence.find(e => e.source_url === 'https://example.com')
    expect(evidence).toBeDefined()
    expect(evidence!.page_type).toBe('homepage')
    expect(evidence!.subject).toBe('company_strategy')
  })

  it('labels a nested path page-type correctly (unaffected by the fix — sanity check)', () => {
    const content = `
--- PAGE: /about (https://example.com/about) ---

Acme Industries operates six manufacturing facilities across the region, serving customers worldwide.
`
    const result = extractSignals(content, undefined, 'Acme Industries')
    const multiLocation = result.signals.find(s => s.type === 'multi_location_operations')
    expect(multiLocation).toBeDefined()
    const evidence = multiLocation!.evidence.find(e => e.source_url === 'https://example.com/about')
    expect(evidence).toBeDefined()
    expect(evidence!.page_type).toBe('about')
  })

  it('does not force every homepage snippet to company_strategy — plain marketing tagline with no self-reference still falls to generic_marketing and produces no signal', () => {
    const content = `
--- PAGE: / (https://example.com) ---

Leading provider of world-class solutions for a better tomorrow.
`
    const result = extractSignals(content, undefined, 'Acme Industries')
    expect(result.signals).toHaveLength(0)
  })
})
