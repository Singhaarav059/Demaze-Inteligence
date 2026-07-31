// ============================================================
// Cold Email Generation
// ============================================================
// Never throws — returns { status: 'error', draft: null } on any failure.
// ============================================================

import { getCompletion } from '@/lib/ai/provider-factory'
import { buildEmailPrompt } from './prompts'
import { extractJsonFromResponse } from './extract-json'
import type { EmailGenerationInput, EmailDraftResult } from './types'

function toStr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function generateEmail(input: EmailGenerationInput, subjectLine: string): Promise<EmailDraftResult> {
  const { systemPrompt, userPrompt } = buildEmailPrompt(input, subjectLine)

  // Single attempt, not a [1536, 3072]-then-retry ladder — same fix as
  // generate-subject-lines.ts's identical change (see that file's comment
  // for the full finding: stacking this outer retry on top of
  // getCompletion()'s own Gemini -> NVIDIA fallback produced a real 5+
  // minute hang, confirmed live). Resilience now comes entirely from
  // getCompletion()'s own multi-vendor fallback.
  // 45s timeout, same reasoning as generate-subject-lines.ts's identical
  // change — a cold email should never legitimately need getCompletion()'s
  // 150s default (calibrated for the long narrative/research call).
  try {
    const response = await getCompletion({ systemPrompt, userPrompt, maxTokens: 6144, temperature: 0.5, jsonMode: true, timeoutMs: 45_000 })
    const parsed = JSON.parse(extractJsonFromResponse(response.content)) as Record<string, unknown>

    const draft = {
      hook: toStr(parsed.hook),
      personalization: toStr(parsed.personalization),
      painPoint: toStr(parsed.painPoint),
      valueProp: toStr(parsed.valueProp),
      cta: toStr(parsed.cta),
      signature: toStr(parsed.signature),
      fullText: toStr(parsed.fullText),
    }

    if (!draft.fullText) throw new Error('Model returned no email body')

    return { status: 'ok', draft, providerUsed: response.providerName, modelUsed: response.model }
  } catch (e) {
    return {
      status: 'error',
      draft: null,
      error: e instanceof Error ? e.message : 'Failed to generate email',
    }
  }
}
