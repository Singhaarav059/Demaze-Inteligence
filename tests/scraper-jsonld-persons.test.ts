// ============================================================
// Scraper — JSON-LD Person extraction (B.5, Epitaxy vNext audit)
// ============================================================
// Pure, network-free parsing of extractJsonLdPersons() — the raw-HTML side
// of the leadership-extraction precision upgrade. Firecrawl's 'rawHtml'
// format (added alongside 'markdown' in scrapeSinglePage) is the only place
// <script type="application/ld+json"> markup survives; by the time content
// reaches evidence-extractor.ts it's markdown and scripts are long gone.
// ============================================================

import { describe, it, expect } from 'vitest'
import { extractJsonLdPersons } from '../lib/pipeline/scraper'

describe('extractJsonLdPersons', () => {
  it('extracts a single Person node', () => {
    const html = `
      <html><head>
      <script type="application/ld+json">
        { "@context": "https://schema.org", "@type": "Person", "name": "Jane Doe", "jobTitle": "Chief Executive Officer" }
      </script>
      </head></html>
    `
    expect(extractJsonLdPersons(html)).toEqual([{ name: 'Jane Doe', title: 'Chief Executive Officer' }])
  })

  it('extracts Person nodes from an array', () => {
    const html = `
      <script type="application/ld+json">
        [
          { "@type": "Person", "name": "Amit Kumar", "jobTitle": "CTO" },
          { "@type": "Person", "name": "Priya Sharma", "jobTitle": "CMO" }
        ]
      </script>
    `
    expect(extractJsonLdPersons(html)).toEqual([
      { name: 'Amit Kumar', title: 'CTO' },
      { name: 'Priya Sharma', title: 'CMO' },
    ])
  })

  it('extracts Person nodes nested inside an @graph', () => {
    const html = `
      <script type="application/ld+json">
        { "@context": "https://schema.org", "@graph": [
          { "@type": "Organization", "name": "Acme Corp" },
          { "@type": "Person", "name": "Sam Lee", "jobTitle": "VP Operations" }
        ]}
      </script>
    `
    expect(extractJsonLdPersons(html)).toEqual([{ name: 'Sam Lee', title: 'VP Operations' }])
  })

  it('extracts a Person nested under an Organization\'s employee/founder field', () => {
    const html = `
      <script type="application/ld+json">
        { "@type": "Organization", "name": "Acme Corp",
          "founder": { "@type": "Person", "name": "Robin Chen", "jobTitle": "Founder & CEO" } }
      </script>
    `
    expect(extractJsonLdPersons(html)).toEqual([{ name: 'Robin Chen', title: 'Founder & CEO' }])
  })

  it('drops a Person node missing a name or jobTitle', () => {
    const html = `
      <script type="application/ld+json">
        [
          { "@type": "Person", "jobTitle": "CTO" },
          { "@type": "Person", "name": "No Title Person" }
        ]
      </script>
    `
    expect(extractJsonLdPersons(html)).toEqual([])
  })

  it('skips a malformed JSON-LD block instead of throwing', () => {
    const html = `<script type="application/ld+json">{ this is not valid JSON }</script>`
    expect(() => extractJsonLdPersons(html)).not.toThrow()
    expect(extractJsonLdPersons(html)).toEqual([])
  })

  it('dedupes identical name+title hits across multiple script blocks', () => {
    const html = `
      <script type="application/ld+json">{ "@type": "Person", "name": "Jane Doe", "jobTitle": "CEO" }</script>
      <script type="application/ld+json">{ "@type": "Person", "name": "Jane Doe", "jobTitle": "CEO" }</script>
    `
    expect(extractJsonLdPersons(html)).toHaveLength(1)
  })

  it('ignores non-Person JSON-LD types', () => {
    const html = `
      <script type="application/ld+json">{ "@type": "Organization", "name": "Acme Corp" }</script>
    `
    expect(extractJsonLdPersons(html)).toEqual([])
  })

  it('returns [] for empty or missing rawHtml', () => {
    expect(extractJsonLdPersons('')).toEqual([])
  })
})
