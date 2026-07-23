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

describe('extractSignals — short-form self-reference fallback (2026-07-23)', () => {
  // Closes the precision gap flagged in CLAUDE.md's "RESOLVED 2026-07-19 —
  // detectPageType()..." section: real site prose using a short brand form
  // (e.g. "Ador") never matched a longer resolved legal name (e.g. "Ador
  // Welding Ltd"), even though the same logic worked correctly when tested
  // with the short form in isolation.

  it('non-regression: the full resolved name still matches directly when present verbatim', () => {
    const content = `
--- PAGE: / (https://example.com) ---

Ador Welding produces world-class products across six manufacturing facilities nationwide.
`
    const result = extractSignals(content, undefined, 'Ador Welding')
    const multiLocation = result.signals.find(s => s.type === 'multi_location_operations')
    expect(multiLocation).toBeDefined()
    expect(multiLocation!.is_company_subject).toBe(true)
  })

  it('short-form fallback: real homepage prose using "Ador" alone classifies as company_strategy when the resolved name is "Ador Welding"', () => {
    const content = `
--- PAGE: / (https://example.com) ---

Ador produces world-class products across six manufacturing facilities nationwide.
`
    const result = extractSignals(content, undefined, 'Ador Welding')
    const multiLocation = result.signals.find(s => s.type === 'multi_location_operations')
    expect(multiLocation).toBeDefined()
    expect(multiLocation!.is_company_subject).toBe(true)
  })

  it('short-form fallback: also works when the resolved name is the full legal form "Ador Welding Ltd"', () => {
    const content = `
--- PAGE: / (https://example.com) ---

Ador produces world-class products across six manufacturing facilities nationwide.
`
    const result = extractSignals(content, undefined, 'Ador Welding Ltd')
    const multiLocation = result.signals.find(s => s.type === 'multi_location_operations')
    expect(multiLocation).toBeDefined()
    expect(multiLocation!.is_company_subject).toBe(true)
  })

  it('non-regression: a single-word resolved name still works exactly as before (no shorter form exists to fall back to)', () => {
    const content = `
--- PAGE: / (https://example.com) ---

Ador operates six manufacturing facilities nationwide.
`
    const result = extractSignals(content, undefined, 'Ador')
    const multiLocation = result.signals.find(s => s.type === 'multi_location_operations')
    expect(multiLocation).toBeDefined()
    expect(multiLocation!.is_company_subject).toBe(true)
  })

  it('does NOT false-positive when an unrelated generic word happens to appear in the text — short-form fallback is skipped for names whose first word is on the generic-word guard list', () => {
    // Resolved name "Global Industries" — first word "Global" is on the
    // generic-leading-word guard list specifically because it's common
    // enough in unrelated marketing/industry prose to cause exactly this
    // kind of false collision if it were used as a short-form anchor.
    // Neither the full name nor a (correctly skipped) short-form match this
    // text, so it falls through to the unconditional homepage ->
    // generic_marketing return — which is excluded from the "subject floor"
    // fallback, so no signal is produced at all for this snippet.
    const content = `
--- PAGE: / (https://example.com) ---

Global manufacturing trends show six facilities is the new industry benchmark for competitors.
`
    const result = extractSignals(content, undefined, 'Global Industries')
    const multiLocation = result.signals.find(s => s.type === 'multi_location_operations')
    expect(multiLocation).toBeUndefined()
  })

  it('does NOT fall back to a short form under the 4-char minimum-length guard', () => {
    // Resolved name "AS Agri" — first word "AS" is only 2 chars, below the
    // minimum-length guard, so no short-form fallback should be attempted
    // even though "as" trivially appears inside ordinary text. Same
    // no-signal-at-all outcome as the generic-word-guard case above.
    const content = `
--- PAGE: / (https://example.com) ---

As six facilities came online this year, the sector overall saw growth.
`
    const result = extractSignals(content, undefined, 'AS Agri')
    const multiLocation = result.signals.find(s => s.type === 'multi_location_operations')
    expect(multiLocation).toBeUndefined()
  })
})
