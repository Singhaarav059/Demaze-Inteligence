// ============================================================
// Sales Intelligence — generation orchestrator
// ============================================================
// generateSalesIntelligence(sourceRunId) loads the run's final_result,
// matches it against the Sales Knowledge bundle, builds the reasoning
// sentence, and upserts the result. Triggered lazily by
// POST /api/admin/sales-intelligence/generate — NOT part of the always-
// running research pipeline (app/api/admin/test-analysis/route.ts), since
// a user who never reaches Auto Flow's Sales Strategy step should never
// pay for this computation. A full regenerate resets active_*/is_overridden
// — a deliberate "start over," distinct from a PATCH override.
// ============================================================

import { createServerClient } from '@/lib/supabase/server'
import { getSalesKnowledge, isSalesKnowledgeEmpty } from './repository'
import { matchSalesIntelligence } from './matcher'
import { buildReasoningText } from './reasoning'
import type { SalesIntelligenceReasoning, SalesIntelligenceRow } from './types'

export interface GenerateSalesIntelligenceResult {
  row: SalesIntelligenceRow
  // Distinguishes "Sales Knowledge hasn't been configured yet" (spec's
  // required empty-state message) from "configured, but nothing matched
  // this specific company" — both leave recommended_problem_slug null, but
  // only the first should show the "not configured" message.
  knowledgeConfigured: boolean
}

export async function generateSalesIntelligence(sourceRunId: string): Promise<GenerateSalesIntelligenceResult> {
  const supabase = createServerClient()

  const { data: run, error: runError } = await supabase
    .from('pipeline_test_runs')
    .select('final_result')
    .eq('id', sourceRunId)
    .single()

  if (runError || !run) {
    throw new Error(runError?.message ?? 'Research run not found')
  }

  const finalResult = (run.final_result as Record<string, unknown> | null) ?? {}
  const companyName =
    typeof finalResult.company_name === 'string' && finalResult.company_name.trim()
      ? finalResult.company_name.trim()
      : 'this company'

  const knowledge = await getSalesKnowledge()
  const match = matchSalesIntelligence(finalResult, knowledge)
  const reasoningResult = await buildReasoningText(match, companyName)

  const reasoning: SalesIntelligenceReasoning = {
    ...match.reasoning,
    problem: reasoningResult.text || match.reasoning.problem,
  }

  const positioningText = match.capability?.positioning_template
    ? match.capability.positioning_template.replace(/\{\{company\}\}/g, companyName)
    : null

  const row = {
    source_run_id: sourceRunId,
    recommended_industry_slug: match.industry?.slug ?? null,
    recommended_problem_slug: match.problem?.slug ?? null,
    recommended_capability_slug: match.capability?.slug ?? null,
    recommended_case_study_ids: match.caseStudies.map(cs => cs.id),
    recommended_roles: match.roles,
    recommended_cta: match.cta,
    confidence_tier: match.problem ? match.confidenceTier : null,
    reasoning,
    positioning_text: positioningText,
    // A full regenerate discards any prior override — distinct from a PATCH,
    // which only ever touches active_* and never runs through this function.
    active_industry_slug: null,
    active_problem_slug: null,
    active_capability_slug: null,
    active_case_study_ids: null,
    active_roles: null,
    active_cta: null,
    active_positioning_text: null,
    is_overridden: false,
    status: 'generated' as const,
    ai_provider_used: reasoningResult.source === 'llm' ? 'sales-knowledge-reasoning' : null,
    ai_model_used: null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('outbound_sales_intelligence')
    .upsert(row, { onConflict: 'source_run_id' })
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return { row: data as SalesIntelligenceRow, knowledgeConfigured: !isSalesKnowledgeEmpty(knowledge) }
}
