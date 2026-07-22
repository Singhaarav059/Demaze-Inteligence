// ============================================================
// Research Quality Framework (Roadmap Phase 2, item 4) — 2026-07-15
// ============================================================
// A per-item confidence AUDIT, not a new scoring engine. Purely
// informational — never gates, suppresses, or downgrades an item, same
// discipline as `evidence_sufficiency`. See docs/DECISIONS.md, "Research
// Quality Framework (Phase 2, item 4)" for the full design.
//
// Pure, sync, rule-based: no new LLM calls, no new vendor calls, no new
// pipeline-timing concerns. Checks reuse confidence signals each module
// already computes rather than recomputing confidence from scratch:
//   1. evidence_subject_mismatch — an opportunity/pain point marked "high"
//      confidence whose linked evidence is tagged `product_capability` (the
//      documented customer-facing-evidence-misread-as-internal-pain false
//      positive from classifySubject(), see CLAUDE.md "Cross-cutting rules"
//      #1).
//   2. single_mention_high_confidence — a competitor/ICP segment marked
//      "high" confidence with fewer than 2 source URLs, even though both
//      modules' own tierConfidence() requires mention_count >= 2 for "high"
//      (competitor-discovery.ts, icp-generator.ts). source_urls.length is a
//      close proxy for mention_count on the final, already-tiered shape
//      (NormalizedAnalysis no longer carries mention_count directly).
//   3. self_name_collision — a competitor/ICP segment name that still
//      matches the researched company's own name via isSelfName(), a
//      second-opinion re-check in case one slipped past a module's own
//      self-name filter (both modules already filter this at discovery
//      time; this is a safety net over the final merged output, not a
//      duplicate of that filtering).
//
// Item 4 vs item 5 boundary: item 4 (this file) runs LIVE inside every real
// pipeline call, for a human reviewer. Item 5 (Research Evaluation
// Framework) is a separate, OFFLINE, benchmark-harness-only aggregator that
// may consume this file's items_flagged/items_audited ratio as one input
// signal, but lives in benchmark/, not here. Do not conflate the two.
// ============================================================

import type { NormalizedAnalysis } from '@/lib/pipeline/normalize'
import { isSelfName } from '@/lib/enrichment/competitor-discovery'

export type QualityFlagType =
  | 'evidence_subject_mismatch'
  | 'single_mention_high_confidence'
  | 'self_name_collision'

export type QualityFlagSeverity = 'info' | 'warn'

export type QualityFlagItemType = 'opportunity' | 'pain_point' | 'competitor' | 'icp_segment'

export interface QualityFlag {
  item_type: QualityFlagItemType
  item_ref: string   // title/name identifying the flagged item, for a human reviewer
  flag: QualityFlagType
  reason: string
  severity: QualityFlagSeverity
}

export interface ResearchQualityAudit {
  flags: QualityFlag[]
  items_audited: number
  items_flagged: number
}

const HIGH_CONFIDENCE_VALUES = new Set(['high', 'High'])

function isHighConfidence(v: string | undefined): boolean {
  return v != null && HIGH_CONFIDENCE_VALUES.has(v)
}

export function auditResearchQuality(normalized: NormalizedAnalysis): ResearchQualityAudit {
  const flags: QualityFlag[] = []
  const flaggedItemKeys = new Set<string>()
  let items_audited = 0

  const evidenceById = new Map(normalized.evidence.map(e => [e.id, e]))

  const flag = (
    item_type: QualityFlagItemType,
    item_ref: string,
    type: QualityFlagType,
    reason: string,
    severity: QualityFlagSeverity,
  ) => {
    flags.push({ item_type, item_ref, flag: type, reason, severity })
    flaggedItemKeys.add(`${item_type}:${item_ref}`)
  }

  // ── Check 1: evidence-subject mismatch (opportunities) ─────────
  for (const o of normalized.opportunities) {
    if (!o.evidence_id) continue
    items_audited++
    const confidence = o.opportunity_confidence ?? o.confidence
    if (!isHighConfidence(confidence) && o.relevance !== 'High') continue
    const ev = evidenceById.get(o.evidence_id)
    if (ev?.subject === 'product_capability') {
      flag(
        'opportunity',
        o.title,
        'evidence_subject_mismatch',
        `Marked high confidence but linked evidence (${o.evidence_id}) is tagged product_capability, likely customer-facing copy, not internal pain`,
        'warn',
      )
    }
  }

  // ── Check 1: evidence-subject mismatch (pain points) ────────────
  for (const p of normalized.pain_points_structured) {
    if (!p.evidence_id) continue
    items_audited++
    if (!isHighConfidence(p.confidence)) continue
    const ev = evidenceById.get(p.evidence_id)
    if (ev?.subject === 'product_capability') {
      flag(
        'pain_point',
        p.title,
        'evidence_subject_mismatch',
        `Marked high confidence but linked evidence (${p.evidence_id}) is tagged product_capability, likely customer-facing copy, not internal pain`,
        'warn',
      )
    }
  }

  // ── Checks 2 + 3: competitors ────────────────────────────────────
  for (const c of normalized.competitors) {
    items_audited++
    if (c.confidence === 'high' && (c.source_urls?.length ?? 0) < 2) {
      flag(
        'competitor',
        c.name,
        'single_mention_high_confidence',
        `Marked high confidence with only ${c.source_urls?.length ?? 0} source URL(s), this module's own tiering requires 2+ mentions for high confidence`,
        'warn',
      )
    }
    if (normalized.company_name && isSelfName(c.name, normalized.company_name)) {
      flag(
        'competitor',
        c.name,
        'self_name_collision',
        `Name matches the researched company ("${normalized.company_name}") via self-name check, should have been filtered at discovery time`,
        'warn',
      )
    }
  }

  // ── Checks 2 + 3: ICP segments ────────────────────────────────────
  for (const s of normalized.icp_segments) {
    items_audited++
    if (s.confidence === 'high' && (s.source_urls?.length ?? 0) < 2) {
      flag(
        'icp_segment',
        s.name,
        'single_mention_high_confidence',
        `Marked high confidence with only ${s.source_urls?.length ?? 0} source URL(s), this module's own tiering requires 2+ mentions for high confidence`,
        'warn',
      )
    }
    if (normalized.company_name && isSelfName(s.name, normalized.company_name)) {
      flag(
        'icp_segment',
        s.name,
        'self_name_collision',
        `Name matches the researched company ("${normalized.company_name}") via self-name check, should have been filtered at discovery time`,
        'warn',
      )
    }
  }

  return {
    flags,
    items_audited,
    items_flagged: flaggedItemKeys.size,
  }
}
