// ============================================================
// Fetches a contact + its linked run's final_result, then assembles
// EmailGenerationInput. Shared by all three generation API routes so the
// "load contact -> load run -> assemble input" sequence isn't triplicated.
// ============================================================

import { createServerClient } from '@/lib/supabase/server'
import { buildEmailGenerationInput } from './assemble-input'
import { resolveActiveSalesIntelligence } from '@/lib/sales-knowledge/types'
import type { SalesIntelligenceRow, SalesKnowledgeCaseStudy } from '@/lib/sales-knowledge/types'
import type { EmailGenerationInput, EmailGenerationSalesIntelligence } from './types'

// Best-effort: loads the run's outbound_sales_intelligence row (if any) and
// resolves it into the shape assemble-input.ts consumes, including
// fetching the full matched case study (the row only stores its id).
// Returns null for any run with no generated Sales Strategy — the caller's
// degrade-gracefully contract (buildEmailGenerationInput's 3rd param being
// absent) handles that identically to a run from before this feature shipped.
async function loadSalesIntelligenceForRun(
  sourceRunId: string
): Promise<EmailGenerationSalesIntelligence | null> {
  const supabase = createServerClient()

  const { data: row, error } = await supabase
    .from('outbound_sales_intelligence')
    .select('*')
    .eq('source_run_id', sourceRunId)
    .maybeSingle()

  if (error || !row) return null

  const active = resolveActiveSalesIntelligence(row as SalesIntelligenceRow)
  if (!active.problemSlug) return null

  const { data: problemRow } = await supabase
    .from('sales_knowledge_problems')
    .select('label')
    .eq('slug', active.problemSlug)
    .maybeSingle()
  const problemLabel = (problemRow as { label?: string } | null)?.label

  let matchedCaseStudy: EmailGenerationSalesIntelligence['matchedCaseStudy']
  const firstCaseStudyId = active.caseStudyIds?.[0]
  if (firstCaseStudyId) {
    const { data: cs } = await supabase
      .from('sales_knowledge_case_studies')
      .select('*')
      .eq('id', firstCaseStudyId)
      .maybeSingle()
    if (cs) {
      const caseStudy = cs as SalesKnowledgeCaseStudy
      matchedCaseStudy = {
        title: caseStudy.title,
        client: caseStudy.client,
        provenance: caseStudy.provenance,
        challenge: caseStudy.challenge,
        outcomes: caseStudy.outcomes,
      }
    }
  }

  return {
    problemLabel,
    evidenceSentence: row.reasoning?.problem,
    positioning: active.positioningText ?? undefined,
    matchedCaseStudy,
    recommendedCta: active.cta ?? undefined,
  }
}

export interface GenerationContext {
  contactId: string
  contactName: string
  input: EmailGenerationInput
}

export async function loadGenerationContext(
  contactId: string
): Promise<{ context: GenerationContext } | { error: string; status: number }> {
  const supabase = createServerClient()

  const { data: contact, error: contactError } = await supabase
    .from('outbound_contacts')
    .select('id, person_name, title_hint, company_name, source_run_id')
    .eq('id', contactId)
    .single()

  if (contactError || !contact) {
    return { error: contactError?.message ?? 'Contact not found', status: 404 }
  }

  let finalResult: Record<string, unknown> | null = null
  let salesIntelligence: EmailGenerationSalesIntelligence | null = null
  if (contact.source_run_id) {
    const { data: run } = await supabase
      .from('pipeline_test_runs')
      .select('final_result')
      .eq('id', contact.source_run_id)
      .maybeSingle()
    finalResult = (run?.final_result as Record<string, unknown> | null) ?? null
    // Best-effort — a run with no Sales Strategy generated yet (or a
    // migration-021/022-less DB) just leaves this null, same as any other
    // "never happened" state buildEmailGenerationInput already tolerates.
    try {
      salesIntelligence = await loadSalesIntelligenceForRun(contact.source_run_id)
    } catch {
      salesIntelligence = null
    }
  }

  const input = buildEmailGenerationInput(contact, finalResult, salesIntelligence)

  return { context: { contactId: contact.id, contactName: contact.person_name, input } }
}
