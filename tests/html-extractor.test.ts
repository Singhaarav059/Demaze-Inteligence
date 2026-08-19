// ============================================================
// In-house HTML extraction tests (plan §42 G4).
// extractCleanText is pure (no I/O), tested directly against static HTML.
// fetchAndExtract wraps directFetch, tested with global.fetch mocked, same
// precedent as tests/direct-fetcher.test.ts.
// ============================================================

import { describe, it, expect, vi, afterEach } from 'vitest'
import { extractCleanText, fetchAndExtract } from '../lib/pipeline/html-extractor'

describe('extractCleanText', () => {
  it('extracts title, headings, paragraphs, and lists as markdown', () => {
    const html = `<html><head><title>Ador Welding</title></head><body>
      <h1>Ador Welding Ltd</h1>
      <p>We manufacture welding equipment across six facilities.</p>
      <ul><li>Consumables</li><li>Automation</li></ul>
    </body></html>`
    const result = extractCleanText(html)
    expect(result.title).toBe('Ador Welding')
    expect(result.markdown).toContain('# Ador Welding Ltd')
    expect(result.markdown).toContain('We manufacture welding equipment across six facilities.')
    expect(result.markdown).toMatch(/^-\s+Consumables$/m)
    expect(result.markdown).toMatch(/^-\s+Automation$/m)
    expect(result.charCount).toBe(result.markdown.length)
  })

  it('strips script, style, nav, and footer noise', () => {
    const html = `<html><body>
      <nav>Home | About | Contact</nav>
      <script>trackPageView();</script>
      <style>.hidden { display: none; }</style>
      <p>Real content.</p>
      <footer>© 2026 Example Corp</footer>
    </body></html>`
    const result = extractCleanText(html)
    expect(result.markdown).toContain('Real content.')
    expect(result.markdown).not.toContain('trackPageView')
    expect(result.markdown).not.toContain('display: none')
    expect(result.markdown).not.toContain('Home | About | Contact')
    expect(result.markdown).not.toContain('© 2026 Example Corp')
  })

  it('strips image refs and in-page skip-links, same as scraper.ts cleanMarkdown', () => {
    const html = `<html><body>
      <a href="#content">Skip to content</a>
      <img src="/banner.png" alt="banner">
      <p>Real content.</p>
    </body></html>`
    const result = extractCleanText(html)
    expect(result.markdown).toBe('Real content.')
  })

  it('returns empty markdown for a content-free page without throwing', () => {
    const result = extractCleanText('<html><head><title>Empty</title></head><body></body></html>')
    expect(result.markdown).toBe('')
    expect(result.title).toBe('Empty')
  })
})

describe('fetchAndExtract', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns success:true with extracted markdown on a real HTML page', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.com/',
      headers: new Headers({ 'content-type': 'text/html' }),
      arrayBuffer: async () => new TextEncoder().encode('<html><head><title>T</title></head><body><p>Hello</p></body></html>').buffer,
    } as unknown as Response)
    const result = await fetchAndExtract('https://example.com')
    expect(result.success).toBe(true)
    expect(result.markdown).toContain('Hello')
    expect(result.title).toBe('T')
  })

  it('returns success:false when the underlying fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const result = await fetchAndExtract('https://example.com', 5)
    expect(result.success).toBe(false)
    expect(result.markdown).toBe('')
    expect(result.error).toBeTruthy()
  })

  it('returns success:false on a non-HTML response without extracting', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.com/data.json',
      headers: new Headers({ 'content-type': 'application/json' }),
      arrayBuffer: async () => new TextEncoder().encode('{"a":1}').buffer,
    } as unknown as Response)
    const result = await fetchAndExtract('https://example.com/data.json')
    expect(result.success).toBe(false)
    expect(result.error).toContain('non-HTML')
  })
})
