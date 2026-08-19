// ============================================================
// Smart crawler tests (plan §42 G5). global.fetch mocked, same precedent as
// tests/direct-fetcher.test.ts / tests/html-extractor.test.ts — requests are
// routed by URL substring since crawlWebsite() fires several fetches
// (robots.txt, sitemap.xml, homepage, N candidate pages) per call.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseRobotsTxt,
  isPathAllowed,
  fetchRobotsTxt,
  discoverSitemapUrls,
  extractSameDomainLinks,
  dedupeUrls,
  crawlWebsite,
} from '../lib/pipeline/smart-crawler'

function xmlResponse(body: string) {
  return {
    ok: true, status: 200, url: 'https://example.com/sitemap.xml',
    headers: new Headers({ 'content-type': 'application/xml' }),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response
}

function htmlResponse(body: string, url = 'https://example.com/') {
  return {
    ok: true, status: 200, url,
    headers: new Headers({ 'content-type': 'text/html' }),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response
}

function notFound(url: string) {
  return {
    ok: false, status: 404, url,
    headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response
}

// ── parseRobotsTxt / isPathAllowed (pure) ──────────────────────────────

describe('parseRobotsTxt', () => {
  it('parses Disallow/Allow rules under the "*" user-agent group', () => {
    const rules = parseRobotsTxt(`
User-agent: *
Disallow: /login
Disallow: /cart
Allow: /cart/faq

User-agent: SomeOtherBot
Disallow: /
`)
    expect(rules.fetched).toBe(true)
    expect(rules.disallow).toEqual(['/login', '/cart'])
    expect(rules.allow).toEqual(['/cart/faq'])
  })

  it('ignores rules under an unrelated user-agent group', () => {
    const rules = parseRobotsTxt(`User-agent: GPTBot\nDisallow: /everything`)
    expect(rules.disallow).toEqual([])
  })
})

describe('isPathAllowed', () => {
  it('blocks a path under a Disallow prefix', () => {
    const rules = { disallow: ['/login'], allow: [], fetched: true }
    expect(isPathAllowed('/login/reset', rules)).toBe(false)
    expect(isPathAllowed('/about', rules)).toBe(true)
  })

  it('lets a more specific Allow override a shorter Disallow', () => {
    const rules = { disallow: ['/cart'], allow: ['/cart/faq'], fetched: true }
    expect(isPathAllowed('/cart/faq/shipping', rules)).toBe(true)
    expect(isPathAllowed('/cart/checkout', rules)).toBe(false)
  })

  it('allows everything when robots.txt was never fetched (fail open)', () => {
    expect(isPathAllowed('/anything', { disallow: ['/anything'], allow: [], fetched: false })).toBe(true)
  })
})

describe('fetchRobotsTxt', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('fails open (fetched:false) when robots.txt 404s', async () => {
    global.fetch = vi.fn().mockResolvedValue(notFound('https://example.com/robots.txt'))
    const rules = await fetchRobotsTxt('https://example.com')
    expect(rules.fetched).toBe(false)
    expect(isPathAllowed('/anything', rules)).toBe(true)
  })

  it('fails open when the fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ENOTFOUND'))
    const rules = await fetchRobotsTxt('https://example.com')
    expect(rules.fetched).toBe(false)
  })

  it('parses a real robots.txt response', async () => {
    global.fetch = vi.fn().mockResolvedValue(xmlResponse('User-agent: *\nDisallow: /admin\n'))
    const rules = await fetchRobotsTxt('https://example.com')
    expect(rules.fetched).toBe(true)
    expect(rules.disallow).toEqual(['/admin'])
  })
})

// ── sitemap discovery ───────────────────────────────────────────────

describe('discoverSitemapUrls', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it('returns URLs from a plain (non-index) sitemap', async () => {
    global.fetch = vi.fn().mockResolvedValue(xmlResponse(`<urlset>
      <url><loc>https://example.com/about</loc></url>
      <url><loc>https://example.com/investors</loc></url>
    </urlset>`))
    const urls = await discoverSitemapUrls('https://example.com')
    expect(urls).toEqual(['https://example.com/about', 'https://example.com/investors'])
  })

  it('follows only corporate-shaped sub-sitemaps from a sitemap index', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/sitemap.xml')) {
        return Promise.resolve(xmlResponse(`<sitemapindex>
          <sitemap><loc>https://example.com/sitemap-corporate.xml</loc></sitemap>
          <sitemap><loc>https://example.com/sitemap-products.xml</loc></sitemap>
        </sitemapindex>`))
      }
      if (url.includes('sitemap-corporate')) {
        // padded past the 100-char "not a stub error page" floor fetchXml() applies
        return Promise.resolve(xmlResponse(`<urlset><url><loc>https://example.com/about</loc></url><!-- padding to exceed the 100-char minimum floor --></urlset>`))
      }
      // sitemap-products.xml should never be fetched — not corporate-shaped
      throw new Error(`unexpected fetch: ${url}`)
    })
    const urls = await discoverSitemapUrls('https://example.com')
    expect(urls).toEqual(['https://example.com/about'])
  })

  it('returns [] when sitemap.xml 404s', async () => {
    global.fetch = vi.fn().mockResolvedValue(notFound('https://example.com/sitemap.xml'))
    const urls = await discoverSitemapUrls('https://example.com')
    expect(urls).toEqual([])
  })

  it('filters non-HTML file extensions (e.g. PDFs) out of sitemap URLs — real bharatforge.com regression', async () => {
    // G4's extractCleanText() only handles HTML; before this filter, a
    // sitemap dominated by investor-report PDFs (real, live-observed on
    // bharatforge.com) wasted the entire fetch budget on candidates
    // fetchAndExtract() can never succeed on.
    global.fetch = vi.fn().mockResolvedValue(xmlResponse(`<urlset>
      <url><loc>https://example.com/about</loc></url>
      <url><loc>https://example.com/reports/annual-report.pdf</loc></url>
    </urlset>`))
    const urls = await discoverSitemapUrls('https://example.com')
    expect(urls).toEqual(['https://example.com/about'])
  })
})

// ── link extraction / dedup (pure) ──────────────────────────────────

describe('extractSameDomainLinks', () => {
  it('keeps only same-domain, non-file, non-self links', () => {
    const html = `<html><body>
      <a href="/about">About</a>
      <a href="https://example.com/investors">Investors</a>
      <a href="https://other.com/page">Other domain</a>
      <a href="/report.pdf">PDF</a>
      <a href="/">Self</a>
    </body></html>`
    const links = extractSameDomainLinks(html, 'https://example.com')
    expect(links).toEqual(['https://example.com/about', 'https://example.com/investors'])
  })

  it('deduplicates repeated same-page links', () => {
    const html = `<a href="/about">A</a><a href="/about">B</a>`
    expect(extractSameDomainLinks(html, 'https://example.com')).toEqual(['https://example.com/about'])
  })
})

describe('dedupeUrls', () => {
  it('removes exact duplicates, preserves first-seen order', () => {
    expect(dedupeUrls(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c'])
  })
})

// ── crawlWebsite orchestration ───────────────────────────────────────

describe('crawlWebsite', () => {
  const originalFetch = global.fetch
  beforeEach(() => { global.fetch = vi.fn() })
  afterEach(() => { global.fetch = originalFetch })

  it('discovers via sitemap, fetches homepage + candidates, respects maxPages', async () => {
    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/robots.txt')) return Promise.resolve(notFound(url))
      if (url.endsWith('/sitemap.xml')) {
        return Promise.resolve(xmlResponse(`<urlset>
          <url><loc>https://example.com/about</loc></url>
          <url><loc>https://example.com/investors</loc></url>
          <url><loc>https://example.com/careers</loc></url>
        </urlset>`))
      }
      if (url === 'https://example.com' || url === 'https://example.com/') {
        return Promise.resolve(htmlResponse('<html><title>Home</title><body><p>Homepage content here.</p></body></html>', 'https://example.com/'))
      }
      // any candidate page
      return Promise.resolve(htmlResponse(`<html><title>Page</title><body><p>Real content for ${url}.</p></body></html>`, url))
    })

    const result = await crawlWebsite('https://example.com', { maxPages: 2 })
    // homepage + up to 2 candidates
    expect(result.pages.length).toBeLessThanOrEqual(3)
    expect(result.pages[0].url).toBe('https://example.com/')
    expect(result.debug.sitemapUrlsFound).toBe(3)
    expect(result.debug.discoveryMethod).toBe('sitemap')
    expect(result.debug.pagesAttemptedBeyondHomepage).toBeLessThanOrEqual(2)
    expect(result.debug.robotsFetched).toBe(false) // 404'd, failed open
  })

  it('skips a robots.txt-disallowed candidate', async () => {
    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/robots.txt')) return Promise.resolve(xmlResponse('User-agent: *\nDisallow: /investors\n'))
      if (url.endsWith('/sitemap.xml')) {
        return Promise.resolve(xmlResponse(`<urlset>
          <url><loc>https://example.com/about</loc></url>
          <url><loc>https://example.com/investors</loc></url>
        </urlset>`))
      }
      if (url === 'https://example.com' || url === 'https://example.com/') {
        return Promise.resolve(htmlResponse('<html><title>Home</title><body><p>Homepage.</p></body></html>', 'https://example.com/'))
      }
      return Promise.resolve(htmlResponse(`<html><title>Page</title><body><p>Content for ${url}.</p></body></html>`, url))
    })

    const result = await crawlWebsite('https://example.com', { maxPages: 5 })
    expect(result.debug.robotsFetched).toBe(true)
    expect(result.debug.robotsDisallowedSkipped).toBe(1)
    expect(result.pages.every((p) => !p.url.includes('/investors'))).toBe(true)
  })

  it('early-stops once the high-value/category-diversity floor is met, before maxPages', async () => {
    // 4 distinct high-value categories (investor/leadership/corporate/manufacturing)
    // should trigger early stop at maxPages=15 (default), well short of 15.
    const candidates = [
      'https://example.com/investors',
      'https://example.com/leadership',
      'https://example.com/about',
      'https://example.com/manufacturing',
      'https://example.com/careers', // should never be reached
    ]
    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/robots.txt')) return Promise.resolve(notFound(url))
      if (url.endsWith('/sitemap.xml')) {
        return Promise.resolve(xmlResponse(
          `<urlset>${candidates.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`
        ))
      }
      if (url === 'https://example.com' || url === 'https://example.com/') {
        return Promise.resolve(htmlResponse('<html><title>Home</title><body><p>Homepage.</p></body></html>', 'https://example.com/'))
      }
      return Promise.resolve(htmlResponse(`<html><title>Page</title><body><p>Content for ${url}.</p></body></html>`, url))
    })

    const result = await crawlWebsite('https://example.com')
    expect(result.debug.earlyStopped).toBe(true)
    // Stopped after 4 candidate fetches, never reached /careers.
    expect(result.pages.some((p) => p.url.includes('/careers'))).toBe(false)
    expect(result.debug.pagesAttemptedBeyondHomepage).toBeLessThan(candidates.length)
  })
})
