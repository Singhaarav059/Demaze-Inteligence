// ============================================================
// Sales Knowledge — read layer
// ============================================================
// One Supabase call per table, active-only. Never throws — if migration
// 021 hasn't been applied yet, or the tables are simply empty, this
// degrades to an empty bundle rather than breaking Auto Flow (see
// CLAUDE.md's "Migration / existing data" rule: empty Sales Knowledge
// must never make the app unusable).
// ============================================================

import { createServerClient } from '@/lib/supabase/server'
import { emptySalesKnowledgeBundle, type SalesKnowledgeBundle } from './types'

export async function getSalesKnowledge(): Promise<SalesKnowledgeBundle> {
  try {
    const supabase = createServerClient()

    const [industries, problems, capabilities, caseStudies] = await Promise.all([
      supabase.from('sales_knowledge_industries').select('*').eq('is_active', true),
      supabase.from('sales_knowledge_problems').select('*').eq('is_active', true),
      supabase.from('sales_knowledge_capabilities').select('*').eq('is_active', true),
      supabase.from('sales_knowledge_case_studies').select('*').eq('is_active', true),
    ])

    return {
      industries: industries.error ? [] : (industries.data ?? []),
      problems: problems.error ? [] : (problems.data ?? []),
      capabilities: capabilities.error ? [] : (capabilities.data ?? []),
      caseStudies: caseStudies.error ? [] : (caseStudies.data ?? []),
    }
  } catch {
    return emptySalesKnowledgeBundle()
  }
}

export function isSalesKnowledgeEmpty(bundle: SalesKnowledgeBundle): boolean {
  return (
    bundle.industries.length === 0 &&
    bundle.problems.length === 0 &&
    bundle.capabilities.length === 0 &&
    bundle.caseStudies.length === 0
  )
}
