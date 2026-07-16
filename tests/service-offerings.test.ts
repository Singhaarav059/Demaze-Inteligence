// ============================================================
// Service Offerings Extractor — lib/pipeline/service-offerings.ts
// ============================================================
// Covers the pure, network-free extractor: what the researched company
// says it sells, from its own self-referential website language only.
// Same "no real HTTP in unit tests" discipline as competitor-discovery.test.ts
// and icp-generator.test.ts.

import { describe, it, expect } from 'vitest'
import { extractOfferingsFromText, extractCompanyOfferings } from '../lib/pipeline/service-offerings'

describe('extractOfferingsFromText — trigger-based extraction', () => {
  it('extracts an offering after "we offer"', () => {
    const found = extractOfferingsFromText('We offer robotic welding automation for heavy industry.')
    expect(found).toContain('robotic welding automation for heavy industry')
  })

  it('extracts an offering after "we specialize in"', () => {
    const found = extractOfferingsFromText('We specialize in weld quality inspection systems.')
    expect(found).toContain('weld quality inspection systems')
  })

  it('extracts an offering after "our services include"', () => {
    const found = extractOfferingsFromText('Our services include: web design, SEO, and hosting.')
    expect(found).toContain('web design, SEO, and hosting')
  })

  it('extracts an offering after "we are a provider of"', () => {
    const found = extractOfferingsFromText('We are a leading provider of industrial automation solutions.')
    expect(found).toContain('industrial automation solutions')
  })

  it('finds nothing when there is no self-referential offering language', () => {
    expect(extractOfferingsFromText('Founded in 1990, the company has grown steadily.')).toEqual([])
  })

  it('rejects a captured span that looks like a sentence fragment', () => {
    // "we offer" immediately followed by a fragment-shaped continuation
    // (starts with a preposition) should be discarded by looksLikeSentenceFragment.
    const found = extractOfferingsFromText('We offer at competitive prices to our valued customers.')
    expect(found).toEqual([])
  })
})

describe('extractCompanyOfferings — dedupe + cap', () => {
  it('dedupes near-identical offerings (case/punctuation-insensitive)', () => {
    const content = 'We offer robotic welding automation. Elsewhere: We offer Robotic Welding Automation!'
    const offerings = extractCompanyOfferings(content)
    expect(offerings).toHaveLength(1)
  })

  it('caps the returned list at 8', () => {
    const content = Array.from({ length: 12 }, (_, i) => `We offer service number ${i}.`).join(' ')
    const offerings = extractCompanyOfferings(content)
    expect(offerings.length).toBeLessThanOrEqual(8)
  })

  it('returns [] for content with no self-referential offering language', () => {
    expect(extractCompanyOfferings('This is a generic about-us page with no first-person offer language.')).toEqual([])
  })
})
