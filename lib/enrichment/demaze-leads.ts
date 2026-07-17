// ============================================================
// Demaze Leads — cached-Demaze-research -> multi-segment lead aggregation
// ============================================================
// Real product clarification (2026-07-15): this whole tool exists to find
// leads FOR Demaze (demazetech.com), not to run Company Discovery generically
// for whatever URL a user happens to paste in. The prior fix in
// company-discovery.ts (rejecting URL-shaped input) is still correct — the
// "ICP segment" field genuinely never accepts a URL — but the real ask
// underneath the reported bug was: research demazetech.com ONCE, cache it,
// and auto-run Company Discovery across ALL of its ICP segments (Demaze
// serves several: Manufacturing, Automotive, Industrial, SaaS, Financial
// Institutions, SMBs per CLAUDE.md) rather than making the user copy one
// segment at a time. This module is the pure aggregation logic for that;
// the cache lookup + per-segment discoverCompanies() calls happen in the API
// route (app/api/admin/demaze-leads/route.ts) since they need Supabase/
// network I/O, same "pure lib, I/O at the route layer" split as every other
// module here.
// ============================================================

import type { CompanyMatch, CompanyMatchConfidence } from './company-discovery'
import { normalizeDomain, normalizeName } from './company-discovery'
import { normalizeSegmentName, type ICPSegment } from './icp-generator'

export const DEMAZE_URL = 'https://www.demazetech.com/'
export const DEMAZE_DOMAIN = 'demazetech.com'
// Passed as excludeCompanyNames to discoverCompanies() for every segment, so
// Demaze never lists itself as its own lead — same isSelfName() word-overlap
// check every other discovery module already uses for this.
export const DEMAZE_EXCLUDE_NAMES = ['Demaze', 'Demaze Technologies', 'Demaze Tech', 'Demazetech']

// Demaze's confirmed target industries, given directly (not inferred) — see
// CLAUDE.md's opening "Target industries" line and DEMAZE_CAPABILITY_MAP.md's
// "Draft — Ideal Customer Problems" section. Found live 2026-07-17: the
// Discover page's Target Sectors step was showing ONLY whatever
// discoverICPSegments() happened to extract from demazetech.com's own
// homepage copy — a single, thin "Industries We Serve: Healthcare,
// Telemedicine Platforms, Electronic Health" blurb — which badly
// under-represents Demaze's actual scope (Demaze is a services company
// that sells INTO these industries broadly; its 8 confirmed service lines
// aren't industry-specific). The research-derived pass is still real and
// kept (a company's own site CAN legitimately state served industries, and
// might surface a genuinely new one over time) — this list is merged
// alongside it, not a replacement, so neither source silently overrides
// the other.
export const DEMAZE_CONFIRMED_SECTORS = [
  'Manufacturing', 'Automotive', 'Industrial', 'SaaS', 'Financial Institutions', 'SMBs',
] as const

function confirmedSectorAsICPSegment(name: string): ICPSegment {
  return {
    name,
    reason: 'Confirmed Demaze target industry (see CLAUDE.md "Target industries" / DEMAZE_CAPABILITY_MAP.md) — not derived from a live search, given directly.',
    signals: [],
    confidence: 'high',
    source_urls: [],
  }
}

// Merges the confirmed ground-truth sector list into whatever
// discoverICPSegments() surfaced from the company's own site, deduping by
// normalized name so a sector the research already found for real isn't
// shown twice with two different `reason` strings. Confirmed sectors are
// appended after the research-derived ones (real search evidence first),
// same "research first, ground truth fills the gaps" ordering as everywhere
// else this repo merges a code-derived list with a supplementary one.
export function withConfirmedSectors(researched: ICPSegment[]): ICPSegment[] {
  const existing = new Set(researched.map(s => normalizeSegmentName(s.name)))
  const additions = DEMAZE_CONFIRMED_SECTORS
    .filter(name => !existing.has(normalizeSegmentName(name)))
    .map(confirmedSectorAsICPSegment)
  return [...researched, ...additions]
}

// One lead, aggregated across however many ICP segments surfaced it. Extends
// CompanyMatch (rather than duplicating its fields) so this still satisfies
// filterAlreadyResearched()'s CompanyMatch[] param and the existing
// CompanyDiscovery UI's rendering, which only needs the extra `segments`
// field to be optional.
export interface AggregatedLead extends CompanyMatch {
  segments: string[]  // ICP segment name(s) this lead surfaced under, e.g. ["automotive manufacturers", "industrial"]
}

const CONFIDENCE_RANK: Record<CompanyMatchConfidence, number> = { high: 2, medium: 1, low: 0 }

function identityKey(c: CompanyMatch): string {
  return c.domain ? `domain:${normalizeDomain(c.domain)}` : `name:${normalizeName(c.name)}`
}

// Merges CompanyMatch[] results from multiple discoverCompanies() calls (one
// per ICP segment) into one deduped list. A company surfaced under more than
// one segment keeps every segment name (order of first appearance) rather
// than being listed once per segment — same "no forced empty state, no
// silent duplication" discipline as the rest of this codebase. When the same
// identity appears under two different confidence tiers (e.g. medium under
// one segment, high under another), the higher-confidence variant's
// domain/reason wins, since that's the more-verified read on the same
// underlying candidate.
export function aggregateLeadsAcrossSegments(
  perSegment: Array<{ segmentName: string; companies: CompanyMatch[] }>,
): AggregatedLead[] {
  const map = new Map<string, AggregatedLead>()

  for (const { segmentName, companies } of perSegment) {
    for (const c of companies) {
      const key = identityKey(c)
      const existing = map.get(key)
      if (!existing) {
        map.set(key, { ...c, segments: [segmentName] })
        continue
      }
      if (!existing.segments.includes(segmentName)) existing.segments.push(segmentName)
      if (CONFIDENCE_RANK[c.confidence] > CONFIDENCE_RANK[existing.confidence]) {
        existing.confidence = c.confidence
        existing.domain = c.domain
        existing.domain_confidence = c.domain_confidence
        existing.reason = c.reason
        existing.source_urls = c.source_urls
      }
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || b.segments.length - a.segments.length
  )
}
