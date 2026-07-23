// ============================================================
// Source Prioritizer — v1
// ============================================================
// Stage 2 of the Evidence Recovery Pipeline.
// Takes DiscoveredSource[] from the discovery engine and
// selects the top sources to actually fetch.
//
// Rules:
//   - Max 5 sources fetched (API budget constraint)
//   - At least 1 from investor category if available
//   - At least 1 from hiring category if available
//   - Deduplicate by domain (no two results from same host)
//   - PDFs ARE fetchable (Item 3): they route through pdf-parse in
//     web-enricher.ts, not Firecrawl — annual reports / investor decks are
//     disproportionately PDF-published and must not be dropped here.
// ============================================================

import { type DiscoveredSource, type SourceType } from './discovery-engine'

export interface PrioritizedSource extends DiscoveredSource {
  fetch_order: number    // 1 = fetch first
  should_fetch: boolean
}

// ── Domain extraction ─────────────────────────────────────────

function extractHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

// ── Check if URL is likely fetchable ─────────────────────────

function isFetchable(url: string): boolean {
  const u = url.toLowerCase()
  // NOTE (Item 3): .pdf URLs are intentionally NOT skipped anymore — web-enricher.ts
  // routes them through pdf-parse instead of Firecrawl. Dropping them here was
  // silently discarding annual reports / investor presentations (the top source types).
  // Skip LinkedIn (requires auth)
  if (u.includes('linkedin.com')) return false
  // Skip Glassdoor (requires auth)
  if (u.includes('glassdoor.com')) return false
  return true
}

// ── Category coverage tracker ─────────────────────────────────

type CategoryCoverage = {
  investor: number
  hiring: number
  expansion: number
  strategy: number
  leadership: number
}

// ── Main export ───────────────────────────────────────────────

/**
 * Selects and orders the top sources to fetch.
 * Returns up to maxFetch PrioritizedSource items with should_fetch=true.
 */
export function prioritizeSources(
  discovered: DiscoveredSource[],
  maxFetch = 5,
): PrioritizedSource[] {
  const selected: PrioritizedSource[] = []
  const seenHosts = new Set<string>()
  const coverage: CategoryCoverage = { investor: 0, hiring: 0, expansion: 0, strategy: 0, leadership: 0 }

  // Pass 1: Ensure at least 1 investor + 1 hiring source (highest value)
  // Item 4 (2026-07-23): earnings_call_transcript added — it's the same
  // "highest evidence tier" as the other 3 (direct management commentary,
  // not just headline numbers), so it should compete for a guaranteed slot
  // the same way.
  const mustHave: SourceType[] = ['annual_report', 'investor_presentation', 'earnings_release', 'earnings_call_transcript']
  for (const src of discovered) {
    if (selected.length >= maxFetch) break
    if (!mustHave.includes(src.source_type)) continue
    if (!isFetchable(src.url)) continue
    const host = extractHostname(src.url)
    if (seenHosts.has(host)) continue
    seenHosts.add(host)
    coverage[src.query_category]++
    selected.push({ ...src, fetch_order: selected.length + 1, should_fetch: true })
  }

  // Pass 2: Add careers page (strong hiring signal)
  for (const src of discovered) {
    if (selected.length >= maxFetch) break
    if (src.source_type !== 'careers_page') continue
    if (!isFetchable(src.url)) continue
    const host = extractHostname(src.url)
    if (seenHosts.has(host)) continue
    seenHosts.add(host)
    coverage[src.query_category]++
    selected.push({ ...src, fetch_order: selected.length + 1, should_fetch: true })
  }

  // Pass 3: Fill remaining slots with highest-priority remaining sources
  for (const src of discovered) {
    if (selected.length >= maxFetch) break
    if (!isFetchable(src.url)) continue
    const host = extractHostname(src.url)
    if (seenHosts.has(host)) continue
    seenHosts.add(host)
    coverage[src.query_category]++
    selected.push({ ...src, fetch_order: selected.length + 1, should_fetch: true })
  }

  // Mark remaining as not fetched (but return for transparency)
  const notSelected = discovered
    .filter(d => !selected.some(s => s.url === d.url))
    .map(d => ({ ...d, fetch_order: 99, should_fetch: false }))

  return [...selected, ...notSelected]
}

// ── Source type label for UI / prompt ────────────────────────

export function sourceTypeLabel(type: SourceType): string {
  const labels: Record<SourceType, string> = {
    annual_report:                  'Annual Report',
    investor_presentation:          'Investor Presentation',
    earnings_release:               'Earnings Release',
    earnings_call_transcript:       'Earnings Call Transcript',
    executive_change_announcement:  'Executive Change Announcement',
    press_release:                  'Press Release',
    careers_page:                   'Careers Page',
    ceo_interview:                  'CEO Interview',
    official_blog:                  'Official Blog',
    news_article:                   'News Article',
    sustainability_report:          'Sustainability Report',
    corporate_website:              'Corporate Website',
    other:                          'External Source',
  }
  return labels[type] ?? 'External Source'
}

// ── Evidence strength tier label ──────────────────────────────

export function evidenceStrengthTier(strength: string): string {
  switch (strength) {
    case 'very_high': return 'tier1'
    case 'high':      return 'tier2'
    case 'medium':    return 'tier3'
    default:          return 'tier3'
  }
}
