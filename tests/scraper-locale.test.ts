// ============================================================
// Scraper — locale-aware URL scoring (2026-07-24)
// ============================================================
// Multi-market TYPO3/Drupal-style sites (e.g. lechler.com) publish the
// same content under per-country/language path prefixes (/de/, /fr/,
// /es/, /de-en/...). classifyUrl() scores purely on keyword content, so
// non-English duplicates of a page can crowd out English content in the
// top-15 selection — and evidence-extractor.ts's English-only regexes
// then extract zero usable signal from whatever non-English pages get
// scraped, even when the scrape itself succeeds cleanly. Covers the pure,
// network-free scoring logic added to fix this: detectLocalizedUrlStructure()
// (real live-run root-caused: lechler.com selected 11 of 15 pages in
// German/French/Spanish/Finnish/Dutch, companySubjectCount came back 0)
// and the selectUrlsToScrape() penalty that uses it.

import { describe, it, expect } from 'vitest'
import {
  detectLocalizedUrlStructure,
  isEnglishLocaleSegment,
  selectUrlsToScrape,
} from '../lib/pipeline/scraper'

const BASE = 'https://www.lechler.com'

describe('detectLocalizedUrlStructure', () => {
  it('confirms locale segments that repeat 3+ times', () => {
    const urls = [
      `${BASE}/de/a`, `${BASE}/de/b`, `${BASE}/de/c`,
      `${BASE}/fr/a`, `${BASE}/fr/b`, `${BASE}/fr/c`,
      `${BASE}/de-en/company/events`,
    ]
    const segments = detectLocalizedUrlStructure(urls)
    expect(segments.has('de')).toBe(true)
    expect(segments.has('fr')).toBe(true)
  })

  it('does not confirm a locale-shaped segment that appears fewer than 3 times', () => {
    const urls = [`${BASE}/nl/a`, `${BASE}/nl/b`, `${BASE}/about-us`]
    const segments = detectLocalizedUrlStructure(urls)
    expect(segments.has('nl')).toBe(false)
  })

  it('never treats a genuine investor-relations "/ir/" path as a locale prefix, even if repeated', () => {
    const urls = [`${BASE}/ir/a`, `${BASE}/ir/b`, `${BASE}/ir/c`, `${BASE}/ir/d`]
    const segments = detectLocalizedUrlStructure(urls)
    expect(segments.has('ir')).toBe(false)
  })

  it('never treats the "/ai/" technology keyword as a locale prefix, even if repeated', () => {
    const urls = [`${BASE}/ai/a`, `${BASE}/ai/b`, `${BASE}/ai/c`, `${BASE}/ai/d`]
    const segments = detectLocalizedUrlStructure(urls)
    expect(segments.has('ai')).toBe(false)
  })

  it('ignores non-locale-shaped first segments (real content paths)', () => {
    const urls = [
      `${BASE}/products/a`, `${BASE}/products/b`, `${BASE}/products/c`,
    ]
    const segments = detectLocalizedUrlStructure(urls)
    expect(segments.size).toBe(0)
  })
})

describe('isEnglishLocaleSegment', () => {
  it('treats "en" and "-en"-suffixed codes as English', () => {
    expect(isEnglishLocaleSegment('en')).toBe(true)
    expect(isEnglishLocaleSegment('de-en')).toBe(true)
    expect(isEnglishLocaleSegment('in-en')).toBe(true)
    expect(isEnglishLocaleSegment('my-en')).toBe(true)
  })

  it('treats bare non-English country/language codes as non-English', () => {
    expect(isEnglishLocaleSegment('de')).toBe(false)
    expect(isEnglishLocaleSegment('fr')).toBe(false)
    expect(isEnglishLocaleSegment('be-nl')).toBe(false)
  })
})

describe('selectUrlsToScrape — locale penalty', () => {
  it('ranks an English corporate page above a same-category non-English duplicate', () => {
    const localeSegments = new Set(['de'])
    const candidates = [
      `${BASE}/de/unternehmen`,      // German "corporate" (about/company-shaped)
      `${BASE}/de-en/company`,       // English "corporate"
    ]
    const { scored } = selectUrlsToScrape(candidates, false, 15, localeSegments)
    const de = scored.find((s) => s.url.includes('/de/unternehmen'))!
    const deEn = scored.find((s) => s.url.includes('/de-en/company'))!
    expect(deEn.score).toBeGreaterThan(de.score)
  })

  it('still selects non-English pages when nothing else is available (no hard exclusion)', () => {
    const localeSegments = new Set(['fr'])
    const candidates = [`${BASE}/fr/solutions/secteur`]
    const { selected } = selectUrlsToScrape(candidates, false, 15, localeSegments)
    expect(selected).toContain(`${BASE}/fr/solutions/secteur`)
  })

  it('does not penalize URLs with no locale prefix at all', () => {
    const localeSegments = new Set(['de'])
    const candidates = [`${BASE}/about-us`]
    const { scored } = selectUrlsToScrape(candidates, false, 15, localeSegments)
    expect(scored[0].score).toBe(90) // 'corporate' category, unpenalized
  })

  it('reproduces the live lechler.com regression: English/unlabeled pages beat German duplicates in the same category', () => {
    const localeSegments = detectLocalizedUrlStructure([
      `${BASE}/de/unternehmen/news/pressemeldungen`,
      `${BASE}/de/unternehmen/lechler-weltweit`,
      `${BASE}/de/mediahub/kataloge`,
      `${BASE}/de/mediahub/mediathek`,
      `${BASE}/de/kontakt`,
      `${BASE}/de-en/company/events`,
      `${BASE}/in-en/products/process-technology`,
    ])
    expect(localeSegments.has('de')).toBe(true)

    const { scored } = selectUrlsToScrape(
      [
        `${BASE}/de/unternehmen/news/pressemeldungen`, // German "media"
        `${BASE}/de-en/company/events`,                // English "corporate"
      ],
      false,
      15,
      localeSegments,
    )
    const german = scored.find((s) => s.url.includes('/de/unternehmen'))!
    const english = scored.find((s) => s.url.includes('/de-en/company'))!
    expect(english.score).toBeGreaterThan(german.score)
  })
})
