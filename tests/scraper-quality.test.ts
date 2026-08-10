// ============================================================
// Scraper — assessScrapeQuality() content-relevance penalty (2026-08-10)
// ============================================================
// Fixes the gap flagged in CLAUDE.md's 2026-07-24 audit: assessScrapeQuality()
// scored purely on page/char count with zero content-relevance signal, so
// "15 pages of the wrong content" scored identically to "15 pages of the
// right content." Reuses detectLocalizedUrlStructure()/isEnglishLocaleSegment()
// (already built for URL selection — see scraper-locale.test.ts) and
// classifyUrl()'s own category scoring to judge what was actually scraped.
// ============================================================

import { describe, it, expect } from 'vitest'
import { assessScrapeQuality, assessContentRelevance, type ScrapeResult } from '../lib/pipeline/scraper'

function makeResult(successfulUrls: string[], totalCharCount: number, overrides: Partial<ScrapeResult> = {}): ScrapeResult {
  return {
    pages: [],
    combinedContent: '',
    successfulUrls,
    failedUrls: [],
    totalCharCount,
    wasTruncated: false,
    discoveryMethod: 'link_extraction',
    scrapedAt: new Date().toISOString(),
    debug: {
      homepageLinksRaw: 0, homepageLinksSameDomain: 0, linkScores: [],
      urlsSelectedForScraping: [], sitemapChecked: false, sitemapUrlsFound: 0,
      discoveryMethod: 'link_extraction', isB2CSite: false, b2cPatternsHit: 0,
      corporateSeedPathsProbed: 0, warnings: [], errors: [],
    },
    ...overrides,
  }
}

describe('assessContentRelevance', () => {
  it('reports zero ratios for an empty successfulUrls list', () => {
    expect(assessContentRelevance([])).toEqual({ nonEnglishRatio: 0, lowValueRatio: 0 })
  })

  it('reports a high nonEnglishRatio when most scraped pages are a confirmed non-English locale', () => {
    const urls = [
      'https://example.com/de/about', 'https://example.com/de/products', 'https://example.com/de/contact',
      'https://example.com/en/about',
    ]
    const { nonEnglishRatio } = assessContentRelevance(urls)
    expect(nonEnglishRatio).toBe(0.75)
  })

  it('reports zero nonEnglishRatio when all scraped pages are English or unlabeled', () => {
    const urls = ['https://example.com/about', 'https://example.com/en/products', 'https://example.com/investors']
    const { nonEnglishRatio } = assessContentRelevance(urls)
    expect(nonEnglishRatio).toBe(0)
  })

  it('reports a high lowValueRatio when most scraped pages are unclassified/low-value', () => {
    const urls = [
      'https://example.com/random-slug-1', 'https://example.com/random-slug-2',
      'https://example.com/random-slug-3', 'https://example.com/investors',
    ]
    const { lowValueRatio } = assessContentRelevance(urls)
    expect(lowValueRatio).toBe(0.75)
  })

  it('reports zero lowValueRatio when scraped pages are all high-value categories', () => {
    const urls = ['https://example.com/investors', 'https://example.com/leadership', 'https://example.com/about-us']
    const { lowValueRatio } = assessContentRelevance(urls)
    expect(lowValueRatio).toBe(0)
  })
})

describe('assessScrapeQuality — content-relevance penalty', () => {
  it('scores a deep scrape of real, on-topic English pages highly (non-regression)', () => {
    const result = makeResult(
      [
        'https://example.com/investors', 'https://example.com/leadership', 'https://example.com/about-us',
        'https://example.com/products', 'https://example.com/careers', 'https://example.com/press',
        'https://example.com/manufacturing',
      ],
      16_000
    )
    const { score, note } = assessScrapeQuality(result)
    expect(score).toBeGreaterThanOrEqual(85)
    expect(note).not.toContain('non-English')
    expect(note).not.toContain('low-value')
  })

  it('penalizes a scrape that is mostly non-English locale pages, even with a good page/char count (the bug this fixes)', () => {
    const englishPages = makeResult(
      ['https://example.com/en/investors', 'https://example.com/en/leadership', 'https://example.com/en/about-us',
       'https://example.com/en/products', 'https://example.com/en/careers', 'https://example.com/en/press',
       'https://example.com/en/manufacturing'],
      16_000
    )
    const mostlyGermanPages = makeResult(
      ['https://example.com/de/investors', 'https://example.com/de/leadership', 'https://example.com/de/about-us',
       'https://example.com/de/products', 'https://example.com/de/careers', 'https://example.com/de/press',
       'https://example.com/en/manufacturing'],
      16_000
    )

    const englishResult = assessScrapeQuality(englishPages)
    const germanResult = assessScrapeQuality(mostlyGermanPages)

    // Same page count, same char count, same discovery method — the OLD
    // scorer would have given these an identical score. The fix must make
    // the mostly-non-English scrape score meaningfully lower.
    expect(germanResult.score).toBeLessThan(englishResult.score)
    expect(germanResult.note).toContain('mostly non-English content')
  })

  it('penalizes a scrape that is mostly low-value/unclassified pages despite a good page count', () => {
    const result = makeResult(
      [
        'https://example.com/random-1', 'https://example.com/random-2', 'https://example.com/random-3',
        'https://example.com/random-4', 'https://example.com/random-5', 'https://example.com/investors',
      ],
      16_000
    )
    const { score, note } = assessScrapeQuality(result)
    expect(score).toBeLessThan(90)
    expect(note).toContain('mostly low-value/unclassified pages')
  })

  it('does not apply a content-relevance penalty when pageCount is 0 (no divide-by-zero, no spurious note)', () => {
    const result = makeResult([], 0)
    const { score, note } = assessScrapeQuality(result)
    expect(score).toBe(0)
    expect(note).toBe('No usable content scraped')
  })

  it('never drops a real scrape below the content-relevance floor', () => {
    const result = makeResult(
      ['https://example.com/de/random-1', 'https://example.com/de/random-2', 'https://example.com/de/random-3'],
      500
    )
    const { score } = assessScrapeQuality(result)
    expect(score).toBeGreaterThanOrEqual(10)
  })
})
