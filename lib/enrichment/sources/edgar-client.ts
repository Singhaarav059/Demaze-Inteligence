// ============================================================
// SEC EDGAR client — regulatory filings as an enrichment source
// ============================================================
// Government-filings source category (see CLAUDE.md's implementation
// sequence, item 4's scope note) — genuinely free, public, no API key or
// CAPTCHA: the SEC ticker map (company_tickers.json) and Submissions API
// (data.sec.gov) require nothing but a descriptive User-Agent header and
// respecting a soft ~10 req/sec rate limit. Confirmed against SEC's own
// EDGAR API documentation before building this.
//
// India's MCA registry was considered too (same "government filings" scope
// note) and deliberately NOT built here — it has no public API at all; the
// only access path is the web portal, which is CAPTCHA-gated. Building
// automation to solve/bypass that CAPTCHA is out of scope regardless of
// how useful the data would be. If India company-filing data is wanted
// later, that's a paid third-party aggregator decision (Probe42, Tofler,
// Zauba Corp, etc.) — a new vendor choice, same category as Prospeo/Gmail,
// not something to build against silently.
//
// Coverage is inherently partial: only SEC-reporting entities (US-listed
// public companies, plus some foreign private issuers) appear here at all.
// The large majority of researched companies (private, non-US, SMB) will
// legitimately have no match — that's expected, not an error, and this
// degrades to contributing nothing rather than forcing a guess, same
// "prefer honest no-match over wrong-match" discipline as
// website-discovery.ts's ambiguous-match handling.
// ============================================================

import { recordMetric } from '@/lib/pipeline/research-metrics'

const TICKER_MAP_URL = 'https://www.sec.gov/files/company_tickers.json'
const SUBMISSIONS_URL = (cik10: string) => `https://data.sec.gov/submissions/CIK${cik10}.json`
const FETCH_TIMEOUT_MS = 8_000
const MAX_FILINGS_LISTED = 8

// SEC's fair-access policy asks for a descriptive User-Agent identifying
// the requester (name + contact), not a generic browser string like the
// PDF/scraper fetches elsewhere in this codebase use — this is a distinct
// convention for this one vendor. Overridable via env for a real deployment
// with a real contact address; the default is still a genuine identifying
// string, not blank.
function userAgent(): string {
  return process.env.SEC_EDGAR_USER_AGENT || 'Demaze Outbound Intelligence Platform (research tool; no contact configured)'
}

interface TickerEntry {
  cik_str: number
  ticker: string
  title: string
}

// Module-level memoized fetch — company_tickers.json is ~1MB and changes
// infrequently; refetching it once per researched company (a batch run
// researches many) would be wasteful. Cached only on SUCCESS: a transient
// SEC outage on the first call must not permanently disable EDGAR lookups
// for the rest of the server process — cachedTickers stays null and the
// next call retries a fresh fetch. inFlight only dedupes genuinely
// concurrent calls (e.g. a parallel batch run) while one fetch is pending.
let cachedTickers: TickerEntry[] | null = null
let inFlight: Promise<TickerEntry[] | null> | null = null

async function loadTickerMap(): Promise<TickerEntry[] | null> {
  if (cachedTickers) return cachedTickers
  if (!inFlight) {
    inFlight = (async () => {
      try {
        recordMetric('directFetchCalls')
        const res = await fetch(TICKER_MAP_URL, {
          headers: { 'User-Agent': userAgent() },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (!res.ok) return null
        const data = await res.json() as Record<string, TickerEntry>
        const list = Object.values(data)
        cachedTickers = list
        return list
      } catch {
        return null
      } finally {
        inFlight = null
      }
    })()
  }
  return inFlight
}

// ── Name matching — same word-boundary, prefer-under-confidence discipline
// as website-discovery.ts's normalizeCompanyName/significantWords, deliberately
// duplicated rather than imported (established precedent across this
// codebase's discovery modules: competitor-discovery.ts, icp-generator.ts,
// company-discovery.ts each keep their own copy rather than share one).

// Deliberately does NOT include "holdings"/"group" — unlike the pure legal-
// entity-type words here, those are frequently part of a SEC-registered
// name's actual distinguishing identity (e.g. "Blackstone Group", "Icahn
// Enterprises Holdings") rather than a stripped-off suffix. Stripping them
// risks collapsing two genuinely different entities onto the same
// normalized form.
const LEGAL_SUFFIXES = /\b(?:pvt\.?|private|ltd\.?|limited|inc\.?|incorporated|llc|corp\.?|corporation|co\.?|plc)\b/gi

// Common name-connector words that should never gate a match on their own
// presence/absence — "Johnson & Johnson" and "Johnson and Johnson" must
// normalize identically, and neither the "&" nor "and" is a meaningful
// distinguishing word for the containment-tier match below.
const STOPWORDS = new Set(['and', 'the', 'of', 'a', 'an'])

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function significantWords(normalized: string): string[] {
  return normalized.split(' ').filter(w => w.length > 0 && !STOPWORDS.has(w))
}

/**
 * Finds a single confident CIK match for a company name, or null if no
 * match / the match is ambiguous. Exported for unit testing without
 * network (pass a pre-built ticker list).
 */
export function matchTicker(companyName: string, tickers: TickerEntry[]): TickerEntry | null {
  const queryNorm = normalizeName(companyName)
  if (!queryNorm) return null
  const queryWords = significantWords(queryNorm)
  if (queryWords.length === 0) return null

  // Tier 1: exact normalized-name match. If more than one entry normalizes
  // to the same name (rare, e.g. share classes of the same company under
  // slightly different EDGAR titles), take the first — they're the same
  // real-world company, not an ambiguity worth refusing over.
  const exact = tickers.filter(t => normalizeName(t.title) === queryNorm)
  if (exact.length > 0) return exact[0]

  // Tier 2: single-word names need a full-title match, not substring
  // containment — same guard as website-discovery.ts's single-word-name
  // rule (a single common word trivially "contains" in many entries).
  if (queryWords.length === 1) return null

  // Tier 3: the query's words all appear (word-boundary) in exactly one
  // entry's title, AND that entry's own significant-word count isn't wildly
  // larger than the query's (guards against a short query matching a long,
  // unrelated title that happens to contain all its words incidentally).
  const candidates = tickers.filter(t => {
    const titleNorm = normalizeName(t.title)
    const titleWords = significantWords(titleNorm)
    if (titleWords.length === 0) return false
    const allQueryWordsPresent = queryWords.every(w =>
      titleWords.some(tw => tw === w)
    )
    if (!allQueryWordsPresent) return false
    return titleWords.length <= queryWords.length + 2
  })

  if (candidates.length === 1) return candidates[0]
  return null // zero or ambiguous — refuse to guess
}

interface EdgarFiling {
  form: string
  filingDate: string
  primaryDocument: string
  accessionNumber: string
}

interface SubmissionsResponse {
  name?: string
  sicDescription?: string
  addresses?: { business?: { city?: string; stateOrCountry?: string } }
  filings?: {
    recent?: {
      form?: string[]
      filingDate?: string[]
      primaryDocument?: string[]
      accessionNumber?: string[]
    }
  }
}

function buildFilingUrl(cik: number, filing: EdgarFiling): string {
  const accessionNoDashes = filing.accessionNumber.replace(/-/g, '')
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDashes}/${filing.primaryDocument}`
}

// Form types most likely to carry an actual trigger-event signal (executive
// changes, M&A, material agreements) rather than routine periodic
// reporting — surfaced first in the formatted block, not filtered out
// entirely, since 10-K/10-Q are still real evidence (financial scale,
// disclosed risk factors) just less likely to be a "why now" hook.
const HIGH_SIGNAL_FORMS = new Set(['8-K', '8-K/A', 'DEF 14A', 'S-1', '424B'])

export interface EdgarResult {
  cik: number
  companyName: string
  contextBlock: string
}

/**
 * Looks up a company in SEC EDGAR and, if a confident match is found,
 * fetches its recent filing history. Returns null on no match or any
 * fetch/parse failure — never throws, same graceful-degradation contract
 * as every other enrichment source in this pipeline.
 */
export async function fetchEdgarFilings(companyName: string): Promise<EdgarResult | null> {
  if (!companyName.trim()) return null

  const tickers = await loadTickerMap()
  if (!tickers) return null

  const match = matchTicker(companyName, tickers)
  if (!match) return null

  const cik10 = String(match.cik_str).padStart(10, '0')

  let data: SubmissionsResponse
  try {
    recordMetric('directFetchCalls')
    const res = await fetch(SUBMISSIONS_URL(cik10), {
      headers: { 'User-Agent': userAgent() },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    data = await res.json() as SubmissionsResponse
  } catch {
    return null
  }

  const recent = data.filings?.recent
  if (!recent?.form?.length) return null

  const count = Math.min(recent.form.length, MAX_FILINGS_LISTED, recent.filingDate?.length ?? 0, recent.accessionNumber?.length ?? 0, recent.primaryDocument?.length ?? 0)
  const filings: EdgarFiling[] = []
  for (let i = 0; i < count; i++) {
    filings.push({
      form: recent.form[i],
      filingDate: recent.filingDate![i],
      primaryDocument: recent.primaryDocument![i],
      accessionNumber: recent.accessionNumber![i],
    })
  }
  if (filings.length === 0) return null

  filings.sort((a, b) => {
    const aHigh = HIGH_SIGNAL_FORMS.has(a.form) ? 0 : 1
    const bHigh = HIGH_SIGNAL_FORMS.has(b.form) ? 0 : 1
    if (aHigh !== bHigh) return aHigh - bHigh
    return b.filingDate.localeCompare(a.filingDate)
  })

  const resolvedName = data.name || match.title
  const location = data.addresses?.business
    ? [data.addresses.business.city, data.addresses.business.stateOrCountry].filter(Boolean).join(', ')
    : undefined

  const lines: string[] = [
    `[SOURCE: SEC EDGAR Filings (VERY HIGH confidence) | tier1 | https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik10}]`,
    `${resolvedName} — CIK ${match.cik_str}${data.sicDescription ? ` | Industry (SIC): ${data.sicDescription}` : ''}${location ? ` | HQ: ${location}` : ''}`,
    'Recent SEC filings (most signal-relevant first):',
    ...filings.map(f => `- ${f.form} filed ${f.filingDate}${HIGH_SIGNAL_FORMS.has(f.form) ? ' (often signals executive changes, M&A, or material agreements)' : ''} — ${buildFilingUrl(match.cik_str, f)}`),
    '[END SOURCE: SEC EDGAR Filings]',
  ]

  return {
    cik: match.cik_str,
    companyName: resolvedName,
    contextBlock: lines.join('\n'),
  }
}
