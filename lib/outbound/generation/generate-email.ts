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

  let lastError: unknown
  for (const maxTokens of [1536, 3072]) {
    try {
      const response = await getCompletion({ systemPrompt, userPrompt, maxTokens, temperature: 0.5, jsonMode: true })
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
      lastError = e
    }
  }

  return {
    status: 'error',
    draft: null,
    error: lastError instanceof Error ? lastError.message : 'Failed to generate email',
  }
}
