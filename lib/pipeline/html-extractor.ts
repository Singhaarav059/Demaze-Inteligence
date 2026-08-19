// In-house HTML → clean text extraction (plan §42 G4: "Implement clean HTML
// extraction. Compare output with Firecrawl.").
//
// Two mature, browser-engine-free libraries do the work (plan §21: "use
// mature open-source parsing libraries, do not build an unnecessary browser
// engine"): cheerio strips script/style/nav/footer noise, turndown converts
// the remaining structured HTML (headings/paragraphs/lists/tables) into
// markdown — the same shape scraper.ts's Firecrawl/Jina paths already
// produce, so this is a drop-in-compatible source for a future session
// (G5 smart crawler / G8 Firecrawl fallback), not a parallel incompatible
// type. Not wired into the live scrape chain yet — see
// docs/html-extractor-comparison.md.
import * as cheerio from 'cheerio'
import TurndownService from 'turndown'
import { directFetch } from './direct-fetcher'

// Plan §21 step 1-2: "remove script/style/tracking noise" + "remove
// navigation/footer noise where safe".
const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'svg', 'nav', 'footer', 'header',
  'form', 'button', '[aria-hidden="true"]', '[hidden]',
]

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })

export interface ExtractedPage {
  title: string
  markdown: string
  charCount: number
}

// Same final-cleanup discipline scraper.ts's cleanMarkdown() already applies
// to Firecrawl/Jina output (image refs, in-page skip-links, and excess blank
// lines carry no evidence value) — found by comparing this module's raw
// output against real cached Firecrawl markdown for adorwelding.com, where
// a "[Skip to content](#content)" link led every single page.
function finalCleanup(markdown: string): string {
  return markdown
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/^\[.*?\]\(#.*?\)\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Pure, no I/O — safe to unit-test against static HTML fixtures.
export function extractCleanText(html: string): ExtractedPage {
  const $ = cheerio.load(html)
  NOISE_SELECTORS.forEach((sel) => $(sel).remove())
  const title = $('title').first().text().trim()
  const bodyHtml = $('body').html() ?? ''
  const markdown = finalCleanup(turndown.turndown(bodyHtml))
  return { title, markdown, charCount: markdown.length }
}

// Same field shape as scraper.ts's ScrapePageResult ({url, success,
// markdown, charCount, error?}) plus an optional title — comparable
// directly against a Firecrawl-scraped page with no re-mapping.
export interface FetchAndExtractResult {
  url: string
  success: boolean
  markdown: string
  charCount: number
  title?: string
  error?: string
}

export async function fetchAndExtract(url: string, timeoutMs?: number): Promise<FetchAndExtractResult> {
  const fetched = await directFetch(url, timeoutMs)
  if (!fetched.ok || !fetched.text) {
    return { url: fetched.url, success: false, markdown: '', charCount: 0, error: fetched.error ?? 'fetch failed' }
  }
  if (!fetched.isHtml) {
    return { url: fetched.url, success: false, markdown: '', charCount: 0, error: `non-HTML content-type: ${fetched.contentType ?? 'unknown'}` }
  }
  const { title, markdown, charCount } = extractCleanText(fetched.text)
  if (!markdown) {
    return { url: fetched.url, success: false, markdown: '', charCount: 0, title, error: 'extraction produced no content' }
  }
  return { url: fetched.url, success: true, markdown, charCount, title }
}
