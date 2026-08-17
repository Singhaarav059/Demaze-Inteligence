// ============================================================
// Regex Utilities
// ============================================================
// Was independently reimplemented, byte-identical, in 7 files
// (enrichment/company-discovery.ts, competitor-discovery.ts,
// extraction-guards.ts, website-discovery.ts, pipeline/evidence-extractor.ts,
// quote-verification.ts, sector-playbook/classify.ts) — a pure, static
// function with no per-caller variance, unlike this codebase's other
// duplicated small helpers (normalizeName, significantWords) which
// genuinely differ per file. Single source of truth here instead.
// ============================================================

/** Escapes regex special characters so a raw string can be used literally inside a `new RegExp(...)`. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
