// ============================================================
// Fetches a contact + its linked run's final_result, then assembles
// EmailGenerationInput. Shared by all three generation API routes so the
// "load contact -> load run -> assemble input" sequence isn't triplicated.
// ============================================================

import { createServerClient } from '@/lib/supabase/server'
import { buildEmailGenerationInput } from './assemble-input'
import type { EmailGenerationInput } from './types'

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
  if (contact.source_run_id) {
    const { data: run } = await supabase
      .from('pipeline_test_runs')
      .select('final_result')
      .eq('id', contact.source_run_id)
      .maybeSingle()
    finalResult = (run?.final_result as Record<string, unknown> | null) ?? null
  }

  const input = buildEmailGenerationInput(contact, finalResult)

  return { context: { contactId: contact.id, contactName: contact.person_name, input } }
}
