// ============================================================
// Sales Knowledge — shared types
// ============================================================
// Mirrors supabase/migrations/021_sales_knowledge.sql (static, admin-
// editable playbook) and 022_outbound_sales_intelligence.sql (per-run
// generated/editable object). See CLAUDE.md's Sales Intelligence Layer
// entry for the full product spec this implements.
// ============================================================

export interface SalesKnowledgeIndustry {
  id: string
  slug: string
  label: string
  description: string | null
  keywords: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface SalesKnowledgeProblem {
  id: string
  slug: string
  label: string
  description: string | null
  industry_tags: string[]
  evidence_keywords: string[]
  capability_tags: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface SalesKnowledgeCapability {
  id: string
  slug: string
  label: string
  description: string | null
  positioning_template: string | null
  recommended_roles: string[]
  recommended_cta: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface SalesKnowledgeCaseStudyOutcome {
  metric: string
  value: string
  window?: string
}

export type CaseStudyProvenance = 'named_client' | 'composite_illustrative'

export interface SalesKnowledgeCaseStudy {
  id: string
  title: string
  client: string
  provenance: CaseStudyProvenance
  industry_tags: string[]
  capability_tags: string[]
  challenge: string
  outcomes: SalesKnowledgeCaseStudyOutcome[]
  source_doc: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface SalesKnowledgeBundle {
  industries: SalesKnowledgeIndustry[]
  problems: SalesKnowledgeProblem[]
  capabilities: SalesKnowledgeCapability[]
  caseStudies: SalesKnowledgeCaseStudy[]
}

export function emptySalesKnowledgeBundle(): SalesKnowledgeBundle {
  return { industries: [], problems: [], capabilities: [], caseStudies: [] }
}

// ── Sales Intelligence (per-run generated/editable object) ──────────────

export type ConfidenceTier =
  | 'confirmed_fact'
  | 'research_supported_signal'
  | 'industry_pattern'
  | 'hypothesis'

export interface SalesIntelligenceReasoning {
  industry?: string
  problem?: string
  capability?: string
  case_study?: string
  roles?: string
  cta?: string
}

export interface SalesIntelligenceRow {
  id: string
  source_run_id: string

  recommended_industry_slug: string | null
  recommended_problem_slug: string | null
  recommended_capability_slug: string | null
  recommended_case_study_ids: string[]
  recommended_roles: string[]
  recommended_cta: string | null
  confidence_tier: ConfidenceTier | null
  reasoning: SalesIntelligenceReasoning
  positioning_text: string | null

  active_industry_slug: string | null
  active_problem_slug: string | null
  active_capability_slug: string | null
  active_case_study_ids: string[] | null
  active_roles: string[] | null
  active_cta: string | null
  active_positioning_text: string | null

  is_overridden: boolean
  status: 'generated' | 'reviewed' | 'stale'
  ai_provider_used: string | null
  ai_model_used: string | null
  created_at: string
  updated_at: string
}

// Read-side fallback rule used everywhere this row is consumed:
// active_X ?? recommended_X. Centralized here so it's never duplicated.
export function resolveActiveSalesIntelligence(row: SalesIntelligenceRow) {
  return {
    industrySlug: row.active_industry_slug ?? row.recommended_industry_slug,
    problemSlug: row.active_problem_slug ?? row.recommended_problem_slug,
    capabilitySlug: row.active_capability_slug ?? row.recommended_capability_slug,
    caseStudyIds: row.active_case_study_ids ?? row.recommended_case_study_ids,
    roles: row.active_roles ?? row.recommended_roles,
    cta: row.active_cta ?? row.recommended_cta,
    positioningText: row.active_positioning_text ?? row.positioning_text,
  }
}

// The matcher's raw output, before it's written into an
// outbound_sales_intelligence row — see lib/sales-knowledge/matcher.ts.
export interface SalesIntelligenceMatch {
  industry: SalesKnowledgeIndustry | null
  problem: SalesKnowledgeProblem | null
  capability: SalesKnowledgeCapability | null
  caseStudies: SalesKnowledgeCaseStudy[]
  roles: string[]
  cta: string | null
  confidenceTier: ConfidenceTier
  reasoning: SalesIntelligenceReasoning
}
