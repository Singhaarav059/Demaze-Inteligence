// ============================================================
// Discovery query rotation — sector x region x directory
// ============================================================
// Replaces the old fixed 8-query set (4 generic + 4 site:-restricted,
// India-skewed via site:indiamart.com) with a much larger, rotating combo
// pool per sector, so repeated calls (the target-count discovery loop in
// company-discovery.ts) naturally explore new territory instead of
// re-searching the same handful of queries.
//
// No region is hardcoded as the default target market — the empty-string
// "global" qualifier is simply first in rotation priority, followed by a
// deliberately diverse region list. India is one of several options, not
// the assumed market (see CLAUDE.md's 2026-08-18 correction: Demaze
// targets the global market).
// ============================================================

import type { TargetSector } from '../sector-playbook/types'

// Hand-picked per-sector search terms, informed by each sector playbook's
// own vocabulary (lib/sector-playbook/playbooks.ts's `signals`) but
// phrased as standalone search queries rather than content-matching
// keywords — a signal word like "plant" is meant to match already-scraped
// page text, not stand alone as a useful search query.
// Exported for reuse by benchmarks/brightdata-global-comparison.ts, which
// needs the same per-sector vocabulary but composed against its own
// controlled, explicit region set (not this file's own broader
// REGION_QUALIFIERS rotation pool) — reusing the term list, not
// duplicating it, per this codebase's "check what already exists first"
// discipline.
export const SECTOR_SEARCH_TERMS: Record<TargetSector, string[]> = {
  manufacturing: [
    'manufacturing company', 'industrial manufacturer', 'component manufacturer',
    'contract manufacturer', 'process manufacturer', 'equipment manufacturer',
    'precision manufacturing company', 'engineering and manufacturing company',
  ],
  automotive: [
    'automotive component manufacturer', 'auto parts supplier', 'Tier 1 automotive supplier',
    'Tier 2 automotive supplier', 'automotive OEM', 'automotive engineering company',
    'auto dealership group', 'vehicle component manufacturer',
  ],
  ecommerce: [
    'ecommerce company', 'D2C brand', 'online marketplace', 'omnichannel retailer',
    'direct to consumer brand', 'online retailer', 'multi-brand ecommerce company',
    'digital commerce company',
  ],
}

// '' (no qualifier) is the global default, listed first. Every other
// region is one of several rotation options — not a fallback chain, not a
// hardcoded assumption about where Demaze's target market is.
const REGION_QUALIFIERS = [
  '', 'in the United States', 'in Europe', 'in the United Kingdom', 'in India',
  'in Southeast Asia', 'in Australia', 'in Canada', 'in the Middle East', 'in Latin America',
]

// Global-leaning B2B/company directories. indiamart.com is kept as ONE
// regional option among several — the old query set's default/only
// directory was indiamart.com, which is what skewed discovery toward
// India; this list is deliberately broader.
const DIRECTORY_SITES = ['crunchbase.com', 'thomasnet.com', 'kompass.com', 'europages.co.uk', 'indiamart.com']

interface QueryCombo {
  key: string
  query: string
}

function termRegionCombo(term: string, region: string): QueryCombo {
  return { key: `term:${term}|${region}`, query: region ? `${term} ${region}` : term }
}

function directoryCombo(term: string, site: string): QueryCombo {
  return { key: `dir:${term}|${site}`, query: `${term} site:${site}` }
}

// Deterministic order: broad term+region combos first (higher volume),
// then directory-restricted combos (higher precision, lower volume) —
// this ordering IS the rotation priority.
function allCombosForSector(sector: TargetSector): QueryCombo[] {
  const terms = SECTOR_SEARCH_TERMS[sector]
  const combos: QueryCombo[] = []
  for (const term of terms) {
    for (const region of REGION_QUALIFIERS) combos.push(termRegionCombo(term, region))
  }
  for (const term of terms) {
    for (const site of DIRECTORY_SITES) combos.push(directoryCombo(term, site))
  }
  return combos
}

// Returns up to `batchSize` query strings not already present in
// `usedCombos`, mutating `usedCombos` to include the ones returned — a
// caller looping this call (the target-count discovery loop) naturally
// explores new sector/region/directory territory each iteration instead
// of repeating itself. Returns fewer than batchSize (down to zero) once
// the sector's combo pool is exhausted — callers must treat an empty (or
// short) result as "sources exhausted for this sector", not retry forever.
export function generateQueryBatch(sector: TargetSector, usedCombos: Set<string>, batchSize: number): string[] {
  const batch: string[] = []
  for (const combo of allCombosForSector(sector)) {
    if (batch.length >= batchSize) break
    if (usedCombos.has(combo.key)) continue
    usedCombos.add(combo.key)
    batch.push(combo.query)
  }
  return batch
}

export function totalComboCount(sector: TargetSector): number {
  return allCombosForSector(sector).length
}
