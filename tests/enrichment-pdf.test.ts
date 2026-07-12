// ============================================================
// Item 3 — PDF fetch route in the enrichment pipeline
// ============================================================
// Covers the two pure, network-free pieces of the PDF route:
//   - isPdfUrl()        — routing decision (which fetch path a source takes)
//   - extractPdfText()  — text extraction contract against real PDF bytes
// The network fetch (fetchPdfText) is deliberately NOT unit-tested here — it's a
// thin download wrapper around these two pure functions; exercising it means a
// real HTTP call, which belongs in the live verification run, not a unit test.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { isPdfUrl, extractPdfText } from '../lib/enrichment/web-enricher'

describe('isPdfUrl — fetch-route selection', () => {
  it('matches plain .pdf URLs', () => {
    expect(isPdfUrl('https://example.com/investors/annual-report-2026.pdf')).toBe(true)
  })

  it('matches .pdf with a query string or fragment', () => {
    expect(isPdfUrl('https://example.com/ar.pdf?download=1')).toBe(true)
    expect(isPdfUrl('https://example.com/ar.pdf#page=4')).toBe(true)
  })

  it('is case-insensitive on the extension', () => {
    expect(isPdfUrl('https://example.com/Report.PDF')).toBe(true)
  })

  it('matches the investor "ir.pdf" convention', () => {
    expect(isPdfUrl('https://example.com/ir.pdf')).toBe(true)
  })

  it('does NOT match HTML pages, including "pdf" appearing mid-path', () => {
    expect(isPdfUrl('https://example.com/investors')).toBe(false)
    expect(isPdfUrl('https://example.com/pdf-viewer/report')).toBe(false)
    expect(isPdfUrl('https://example.com/annual.pdf.html')).toBe(false)
  })

  it('falls back gracefully on a malformed URL', () => {
    expect(isPdfUrl('not a url at all.pdf')).toBe(true)
    expect(isPdfUrl('not a url at all')).toBe(false)
  })
})

describe('extractPdfText — extraction contract', () => {
  const fixture = readFileSync(join(__dirname, 'fixtures', 'sample.pdf'))

  it('extracts real text from valid PDF bytes', async () => {
    const text = await extractPdfText(fixture)
    expect(text).not.toBeNull()
    expect(text).toContain('Demaze Annual Report 2026')
    expect(text).toContain('manufacturing facilities')
  })

  it('caps output at 6000 chars', async () => {
    const text = await extractPdfText(fixture)
    expect((text ?? '').length).toBeLessThanOrEqual(6_000)
  })

  it('returns null on a non-PDF / garbage buffer instead of throwing', async () => {
    const garbage = Buffer.from('this is definitely not a pdf file', 'utf8')
    await expect(extractPdfText(garbage)).resolves.toBeNull()
  })

  it('returns null on an empty buffer', async () => {
    await expect(extractPdfText(Buffer.alloc(0))).resolves.toBeNull()
  })
})
