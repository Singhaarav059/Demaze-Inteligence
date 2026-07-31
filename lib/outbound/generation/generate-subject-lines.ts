// ============================================================
// Subject Line Generation
// ============================================================
// Never throws — returns { status: 'error' } on any failure (no API key,
// network error, unparseable response), same non-fatal discipline as
// extractBusinessProfile() in lib/pipeline/business-profile.ts.
// ============================================================

import { getCompletion } from '@/lib/ai/provider-factory'
import { buildSubjectLinePrompt } from './prompts'
import { extractJsonFromResponse } from './extract-json'
import type { EmailGenerationInput, SubjectLineResult } from './types'

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.trim())
}

export async function generateSubjectLines(input: EmailGenerationInput): Promise<SubjectLineResult> {
  const { systemPrompt, userPrompt } = buildSubjectLinePrompt(input)

  // Single attempt, not a [1024, 2048]-then-retry ladder (removed 2026-07-30,
  // same day it was added) — that ladder pre-dates getCompletion() having its
  // own Gemini -> NVIDIA fallback, and stacking a 2-attempt OUTER retry on
  // top of a 2-vendor INNER fallback (each with a 150s per-provider timeout)
  // produced a real worst case of up to 10 minutes for this one call alone,
  // confirmed live (a fresh contact's follow-up generation hung 5+ minutes
  // before this fix). 6144 is comfortably above the 4096 threshold Gemini
  // (the current default provider, see lib/ai/provider-factory.ts) needs to
  // complete a response before its internal "thinking" tokens — which can't
  // be disabled for Gemini 3 models and always count against max_tokens —
  // exhaust the budget. Resilience now comes entirely from getCompletion()'s
  // own multi-vendor fallback, not a second, redundant retry layer here.
  // 45s timeout (not getCompletion()'s 150s default, calibrated for the long
  // narrative/research call) — a 5-line subject list should never
  // legitimately need 150s per provider; confirmed live (2026-07-30) that
  // without this, a stuck/slow provider could eat 150s x 2 NVIDIA fallback
  // models before failing.
  try {
    const response = await getCompletion({ systemPrompt, userPrompt, maxTokens: 6144, temperature: 0.6, jsonMode: true, timeoutMs: 45_000 })
    const parsed = JSON.parse(extractJsonFromResponse(response.content)) as Record<string, unknown>
    const subjects = toStringArray(parsed.subjects)

    if (subjects.length === 0) throw new Error('Model returned no subject lines')

    return {
      status: 'ok',
      subjectLines: subjects.slice(0, 5),
      providerUsed: response.providerName,
      modelUsed: response.model,
    }
  } catch (e) {
    return {
      status: 'error',
      subjectLines: [],
      error: e instanceof Error ? e.message : 'Failed to generate subject lines',
    }
  }
}
