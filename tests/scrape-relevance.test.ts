// ============================================================
// Scrape Relevance Engine (Production Hardening Master Plan — Phase 3)
// ============================================================
// Covers lib/pipeline/scrape-relevance.ts's selectResearchCorpus(): a
// deterministic, post-scrape, per-page relevance score + research-corpus
// selection step. No network, no LLM — pure functions over synthetic
// ScrapePageResult fixtures, same pattern as tests/scraper-locale.test.ts.
// ============================================================

import { describe, it, expect } from 'vitest'
import { selectResearchCorpus } from '../lib/pipeline/scrape-relevance'
import type { ScrapePageResult } from '../lib/pipeline/scraper'

const COMPANY = 'Northwind Manufacturing'
const BASE = 'https://www.northwindmfg.com'

function page(url: string, markdown: string, opts: Partial<ScrapePageResult> = {}): ScrapePageResult {
  return {
    url,
    success: true,
    markdown,
    charCount: markdown.length,
    ...opts,
  }
}

// Pad content past MIN_USEFUL_CHARS (150) without changing its meaning.
function pad(text: string): string {
  return text + '\n\n' + 'Additional descriptive detail supporting this page content. '.repeat(4)
}

describe('selectResearchCorpus — correct company content', () => {
  it('keeps a high-value page that clearly mentions the company', () => {
    const investorPage = page(
      `${BASE}/investor-relations`,
      pad('# Northwind Manufacturing Annual Report\n\nNorthwind Manufacturing reported strong growth this year across all six production facilities. Northwind Manufacturing continues to invest in automation.'),
    )
    const result = selectResearchCorpus([investorPage], COMPANY)
    expect(result.selectedPages.map(p => p.url)).toContain(investorPage.url)
    expect(result.rejectedPages.length).toBe(0)
    expect(result.relevanceScores[investorPage.url]).toBeGreaterThan(80)
  })

  it('keeps a manufacturing/product-shaped page that mentions the company', () => {
    const mfgPage = page(
      `${BASE}/manufacturing/facility-overview`,
      pad('Northwind Manufacturing operates a state-of-the-art facility spanning fifty acres. Northwind Manufacturing employs advanced robotics throughout production.'),
    )
    const productPage = page(
      `${BASE}/solutions/precision-components`,
      pad('Northwind Manufacturing precision components serve aerospace and automotive customers worldwide. Northwind Manufacturing quality standards exceed industry norms.'),
    )
    const result = selectResearchCorpus([mfgPage, productPage], COMPANY)
    expect(result.selectedPages.map(p => p.url)).toEqual(
      expect.arrayContaining([mfgPage.url, productPage.url]),
    )
  })

  it('does not exclude a legitimate manufacturing page just because it never repeats the company name', () => {
    // Real pages routinely describe operations in third person without
    // repeating the brand name — nav/footer (where a copyright-line mention
    // would live) is stripped upstream by the scraper itself.
    const mfgPage = page(
      `${BASE}/manufacturing/production-capacity`,
      pad('Our state-of-the-art facility spans fifty acres and produces over ten thousand units per day. The plant employs advanced robotics and quality control systems throughout the production line.'),
    )
    const result = selectResearchCorpus([mfgPage], COMPANY)
    expect(result.selectedPages.map(p => p.url)).toContain(mfgPage.url)
    expect(result.rejectionReasons[mfgPage.url]).toBeUndefined()
  })
})

describe('selectResearchCorpus — wrong-company / identity mismatch', () => {
  it('rejects a page whose content is clearly about a different company', () => {
    const wrongCompanyPage = page(
      `${BASE}/misc/xyz123`,
      pad('Rival Corp is a leading supplier of industrial fasteners across North America. Rival Corp was founded in 1998 and has grown steadily since.'),
    )
    // A companion legit page — without it, this would be the entire
    // candidate set and the "never zero the corpus" safety net would
    // restore the wrong-company page anyway, masking the per-page check.
    const goodPage = page(
      `${BASE}/investor-relations`,
      pad('Northwind Manufacturing reported record revenue this quarter across all facilities.'),
    )
    const result = selectResearchCorpus([wrongCompanyPage, goodPage], COMPANY)
    expect(result.selectedPages.map(p => p.url)).not.toContain(wrongCompanyPage.url)
    expect(result.selectedPages.map(p => p.url)).toContain(goodPage.url)
    expect(result.rejectionReasons[wrongCompanyPage.url]).toBe('identity_mismatch')
  })

  it('does not false-positive on a similarly-named but unrelated company (shared generic word only)', () => {
    const acePipeline = 'Ace Pipeline'
    const wrongAcePage = page(
      `${BASE}/misc/xyz123`,
      pad('Ace Hardware is a leading DIY retailer with thousands of independently owned stores. Ace Hardware was founded decades ago.'),
    )
    const goodAcePage = page(
      `${BASE}/investor-relations`,
      pad('Ace Pipeline reported strong cross-country pipeline execution activity this quarter.'),
    )
    const result = selectResearchCorpus([wrongAcePage, goodAcePage], acePipeline)
    expect(result.selectedPages.map(p => p.url)).not.toContain(wrongAcePage.url)
    expect(result.selectedPages.map(p => p.url)).toContain(goodAcePage.url)
    expect(result.rejectionReasons[wrongAcePage.url]).toBe('identity_mismatch')
  })

  it('a relevant, identity-confirmed page scores above a wrong-company page', () => {
    const goodPage = page(
      `${BASE}/investor-relations`,
      pad('Northwind Manufacturing reported record revenue this quarter. Northwind Manufacturing continues to expand its facilities.'),
    )
    const wrongPage = page(
      `${BASE}/misc/xyz123`,
      pad('Rival Corp is a leading supplier of industrial fasteners. Rival Corp reported strong results.'),
    )
    const result = selectResearchCorpus([goodPage, wrongPage], COMPANY)
    expect(result.relevanceScores[goodPage.url]).toBeGreaterThan(result.relevanceScores[wrongPage.url])
  })

  it('does not penalize a careers page or a blog article that never repeats the company name', () => {
    const careersPage = page(
      `${BASE}/careers`,
      pad('We are hiring engineers, technicians, and operations staff across multiple locations. Great benefits and a collaborative culture.'),
    )
    const blogArticle = page(
      `${BASE}/blog/industry-trends-2026`,
      pad('Manufacturing automation continues to reshape how factories operate worldwide. Robotics adoption is accelerating across every sector.'),
    )
    const result = selectResearchCorpus([careersPage, blogArticle], COMPANY)
    expect(result.selectedPages.map(p => p.url)).toEqual(
      expect.arrayContaining([careersPage.url, blogArticle.url]),
    )
    expect(result.rejectionReasons[careersPage.url]).toBeUndefined()
    expect(result.rejectionReasons[blogArticle.url]).toBeUndefined()
  })
})

describe('selectResearchCorpus — boilerplate pages score low', () => {
  it('rejects cookie and login pages as boilerplate, even when they mention the company', () => {
    const cookiePage = page(
      `${BASE}/cookie-policy`,
      pad('Northwind Manufacturing uses cookies to improve your browsing experience on this site.'),
    )
    const loginPage = page(
      `${BASE}/login`,
      pad('Sign in to your Northwind Manufacturing account to access your dashboard and orders.'),
    )
    // A real, legitimate page alongside the two boilerplate ones — without
    // this, both boilerplate pages would be the ENTIRE candidate set, and
    // the safety net (never zero the corpus) would restore them, masking
    // the per-page boilerplate rejection this test is actually checking.
    const investorPage = page(
      `${BASE}/investor-relations`,
      pad('Northwind Manufacturing reported record revenue this quarter across all facilities.'),
    )
    const result = selectResearchCorpus([cookiePage, loginPage, investorPage], COMPANY)
    expect(result.selectedPages.map(p => p.url)).not.toContain(cookiePage.url)
    expect(result.selectedPages.map(p => p.url)).not.toContain(loginPage.url)
    expect(result.selectedPages.map(p => p.url)).toContain(investorPage.url)
    expect(result.rejectionReasons[cookiePage.url]).toBe('boilerplate')
    expect(result.rejectionReasons[loginPage.url]).toBe('boilerplate')
  })

  it('relevant pages score above boilerplate pages', () => {
    const investorPage = page(
      `${BASE}/investor-relations`,
      pad('Northwind Manufacturing reported record revenue this quarter across all facilities.'),
    )
    const cookiePage = page(
      `${BASE}/cookie-policy`,
      pad('This site uses cookies for analytics and personalization purposes only.'),
    )
    const result = selectResearchCorpus([investorPage, cookiePage], COMPANY)
    expect(result.relevanceScores[investorPage.url]).toBeGreaterThan(result.relevanceScores[cookiePage.url])
  })
})

describe('selectResearchCorpus — deduplication', () => {
  it('does not let a near-identical regional-clone page inflate the corpus', () => {
    const original = page(
      `${BASE}/en/solutions/industrial-automation`,
      pad('Northwind Manufacturing delivers industrial automation solutions across aerospace, automotive, and defense sectors worldwide with a strong track record.'),
    )
    const nearDuplicate = page(
      `${BASE}/de/solutions/industrial-automation`,
      pad('Northwind Manufacturing delivers industrial automation solutions across aerospace, automotive, and defense sectors worldwide, backed by a strong track record.'),
    )
    const result = selectResearchCorpus([original, nearDuplicate], COMPANY)
    const selectedUrls = result.selectedPages.map(p => p.url)
    // Exactly one of the two near-identical pages survives — the source
    // count is not inflated by a content clone under a different URL.
    expect(selectedUrls.length).toBe(1)
    expect(
      result.rejectionReasons[original.url] === 'duplicate_content' ||
      result.rejectionReasons[nearDuplicate.url] === 'duplicate_content',
    ).toBe(true)
  })

  it('keeps two genuinely different pages (no false-positive dedup)', () => {
    const investorPage = page(
      `${BASE}/investor-relations`,
      pad('Northwind Manufacturing reported record quarterly revenue and expanded its investor communications program.'),
    )
    const careersPage = page(
      `${BASE}/careers`,
      pad('Northwind Manufacturing is hiring engineers and technicians across three new manufacturing sites this year.'),
    )
    const result = selectResearchCorpus([investorPage, careersPage], COMPANY)
    expect(result.selectedPages.length).toBe(2)
    expect(result.rejectionReasons[investorPage.url]).toBeUndefined()
    expect(result.rejectionReasons[careersPage.url]).toBeUndefined()
  })
})

describe('selectResearchCorpus — non-English content', () => {
  it('does not zero out the corpus when content is non-English but genuinely relevant', () => {
    const frenchPage = page(
      `${BASE}/fr/solutions`,
      pad('Northwind Manufacturing propose des solutions industrielles de pointe pour ses clients dans le monde entier.'),
    )
    const result = selectResearchCorpus([frenchPage], COMPANY)
    expect(result.selectedPages.length).toBe(1)
    expect(result.fallbackApplied).toBe(false)
  })
})

describe('selectResearchCorpus — safety net (never worse than not running)', () => {
  it('falls back to the unfiltered usable pages when every page would otherwise be rejected', () => {
    const onlyPages = [
      page(`${BASE}/login`, pad('Sign in to continue to your account dashboard.')),
      page(`${BASE}/cookie-policy`, pad('This site uses cookies for functional purposes.')),
    ]
    const result = selectResearchCorpus(onlyPages, COMPANY)
    expect(result.fallbackApplied).toBe(true)
    expect(result.selectedPages.length).toBe(2)
    expect(result.rejectedPages.length).toBe(0)
    expect(Object.keys(result.rejectionReasons).length).toBe(0)
  })
})

describe('selectResearchCorpus — syndicated news-ticker widget content', () => {
  // 2026-08-27 fix: found live on a real Lechler press page — a third-party
  // financial-news-ticker widget scraped verbatim alongside genuine page
  // content drove a completely unrelated "Why Now" trigger about a zoo
  // executive's career. Recognizable by "N hours ago" co-occurring with
  // earnings/stock vocabulary, a shape that never occurs in organic
  // company-authored prose.
  it('rejects a page containing a syndicated financial-news-ticker widget', () => {
    const contaminatedPage = page(
      `${BASE}/news/industry-roundup`,
      pad('Northwind Manufacturing announced a new facility. [Sanmina jumps 5.1% amid sector-wide rally 2 hours ago] [Abercrombie & Fitch Delivers 5% Revenue Growth in Q2 2026 12 hours ago] [Salesforce (CRM) Q2 2027 Earnings: Key financials and quarterly highlights 9 hours ago]'),
    )
    const goodPage = page(
      `${BASE}/investor-relations`,
      pad('Northwind Manufacturing reported record revenue this quarter across all facilities.'),
    )
    const result = selectResearchCorpus([contaminatedPage, goodPage], COMPANY)
    expect(result.selectedPages.map(p => p.url)).not.toContain(contaminatedPage.url)
    expect(result.selectedPages.map(p => p.url)).toContain(goodPage.url)
    expect(result.rejectionReasons[contaminatedPage.url]).toBe('syndicated_content')
  })

  it('does not reject a page that only mentions earnings/revenue in a legitimate own-company context (no "hours ago" timestamp)', () => {
    const legitPage = page(
      `${BASE}/investor-relations/q2-results`,
      pad('Northwind Manufacturing reported strong quarterly results with revenue growth of 12% year over year, driven by expanded production capacity.'),
    )
    const result = selectResearchCorpus([legitPage], COMPANY)
    expect(result.selectedPages.map(p => p.url)).toContain(legitPage.url)
    expect(result.rejectionReasons[legitPage.url]).toBeUndefined()
  })

  it('does not reject a page with a relative-time phrase alone (no stock/earnings vocabulary nearby)', () => {
    const legitPage = page(
      `${BASE}/blog/plant-tour`,
      pad('Our team completed the new plant tour 3 hours ago and everyone was impressed by the automated production line.'),
    )
    const result = selectResearchCorpus([legitPage], COMPANY)
    expect(result.selectedPages.map(p => p.url)).toContain(legitPage.url)
    expect(result.rejectionReasons[legitPage.url]).toBeUndefined()
  })
})

describe('selectResearchCorpus — scrape failures and thin content', () => {
  it('excludes failed and too-thin pages from the corpus without crashing', () => {
    const goodPage = page(
      `${BASE}/investor-relations`,
      pad('Northwind Manufacturing reported record revenue this quarter.'),
    )
    const failedPage: ScrapePageResult = {
      url: `${BASE}/broken`, success: false, markdown: '', charCount: 0, error: 'timeout',
    }
    const thinPage = page(`${BASE}/thin`, 'Too short.')
    const result = selectResearchCorpus([goodPage, failedPage, thinPage], COMPANY)
    expect(result.selectedPages.map(p => p.url)).toEqual([goodPage.url])
    expect(result.rejectionReasons[failedPage.url]).toBe('scrape_failed')
    expect(result.rejectionReasons[thinPage.url]).toBe('thin_content')
  })
})

describe('selectResearchCorpus — corpus content formatting', () => {
  it('formats the selected corpus using the standard PAGE-block shape', () => {
    const goodPage = page(
      `${BASE}/investor-relations`,
      pad('Northwind Manufacturing reported record revenue this quarter.'),
    )
    const result = selectResearchCorpus([goodPage], COMPANY)
    expect(result.corpusContent).toContain('--- PAGE:')
    expect(result.corpusContent).toContain(goodPage.url)
  })

  it('returns a safe placeholder when nothing survives and there is nothing to fall back to', () => {
    const failedPage: ScrapePageResult = {
      url: `${BASE}/broken`, success: false, markdown: '', charCount: 0, error: 'timeout',
    }
    const result = selectResearchCorpus([failedPage], COMPANY)
    expect(result.selectedPages.length).toBe(0)
    expect(result.fallbackApplied).toBe(false)
    expect(result.corpusContent).toContain('[No content could be extracted')
  })
})
