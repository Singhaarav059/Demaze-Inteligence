// ============================================================
// Company-name identity resolution (reliability pass item 4)
// ============================================================
// Regression for a real failure found via a live benchmark run: AS Agri and
// Aqua (hosted at https://sites.google.com/view/asagriaqua/home) resolved
// to company_name "Google" — guessCompanyNameFromDomain() only ever looked
// at the domain (sites.google.com, Google's own hosting domain), never the
// path, which is where the real identity lives for a path-based free-
// hosting platform.
// ============================================================

import { describe, it, expect } from 'vitest'
import { guessCompanyNameFromDomain } from '../lib/pipeline/company-name-guess'

describe('guessCompanyNameFromDomain', () => {
  it('extracts the real company slug from a Google Sites URL path instead of guessing "Google" from the domain', () => {
    const guess = guessCompanyNameFromDomain('sites.google.com', 'https://sites.google.com/view/asagriaqua/home')
    expect(guess.toLowerCase()).not.toBe('google')
    expect(guess.toLowerCase()).toContain('asagriaqua')
  })

  it('handles the /site/ path variant the same way as /view/', () => {
    const guess = guessCompanyNameFromDomain('sites.google.com', 'https://sites.google.com/site/examplecompany/home')
    expect(guess.toLowerCase()).toContain('examplecompany')
  })

  it('falls back to the domain-based guess when no fullUrl is supplied (backward compatible)', () => {
    expect(guessCompanyNameFromDomain('acme-industries.com')).toBe('Acme industries')
  })

  it('falls back to the domain-based guess when fullUrl is a normal (non-hosting-platform) site', () => {
    const guess = guessCompanyNameFromDomain('acme-industries.com', 'https://acme-industries.com/about')
    expect(guess).toBe('Acme industries')
  })

  it('falls back gracefully when the hosting-platform URL has no recognizable path pattern', () => {
    const guess = guessCompanyNameFromDomain('sites.google.com', 'https://sites.google.com/')
    // No /view/ or /site/ slug present — falls back to the domain guess
    // rather than throwing or returning an empty string.
    expect(guess).toBeTruthy()
  })

  it('non-regression: camelCase/hyphen/underscore splitting still works exactly as before', () => {
    expect(guessCompanyNameFromDomain('AcmeIndustries.com')).toBe('Acme Industries')
    expect(guessCompanyNameFromDomain('acme_industries.co.in')).toBe('Acme industries')
  })
})
