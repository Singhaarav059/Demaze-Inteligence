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

  let lastError: unknown
  for (const maxTokens of [1024, 2048]) {
    try {
      const response = await getCompletion({ systemPrompt, userPrompt, maxTokens, temperature: 0.6, jsonMode: true })
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
      lastError = e
    }
  }

  return {
    status: 'error',
    subjectLines: [],
    error: lastError instanceof Error ? lastError.message : 'Failed to generate subject lines',
  }
}
