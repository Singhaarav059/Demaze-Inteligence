// ============================================================
// Shim: re-export the REAL classifySourceType() + a verbatim copy of the
// private SOURCE_STRENGTH map from lib/enrichment/discovery-engine.ts
// ============================================================
// classifySourceType() is already exported in production — re-exported
// here unchanged, not reimplemented. SOURCE_STRENGTH is a private const in
// that file; rather than adding `export` to production code (a pipeline
// change this benchmark phase is explicitly not allowed to make), this is a
// literal, uncommented-field-for-field copy for analysis-only use. Re-diff
// against discovery-engine.ts's SOURCE_STRENGTH after any future change to
// SourceType before trusting this file.
// ============================================================

export { classifySourceType } from '../../../lib/enrichment/discovery-engine'
import type { SourceType, EvidenceStrength } from '../../../lib/enrichment/discovery-engine'

export const SOURCE_STRENGTH_EXPORT_SHIM: Record<SourceType, EvidenceStrength> = {
  annual_report: 'very_high',
  investor_presentation: 'very_high',
  earnings_release: 'very_high',
  earnings_call_transcript: 'very_high',
  executive_change_announcement: 'high',
  press_release: 'high',
  careers_page: 'high',
  ceo_interview: 'high',
  official_blog: 'medium',
  news_article: 'medium',
  sustainability_report: 'medium',
  corporate_website: 'low',
  regulatory_filing: 'very_high',
  layoff_announcement: 'high',
  funding_announcement: 'high',
  other: 'low',
}
