// ============================================================
// Follow-Up Sequence Generation
// ============================================================
// Never throws — returns { status: 'error', followups: [] } on any failure.
// ============================================================

import { getCompletion } from '@/lib/ai/provider-factory'
import { buildFollowupPrompt } from './prompts'
import { extractJsonFromResponse } from './extract-json'
import type { EmailGenerationInput, EmailDraft, FollowupResult, FollowupDraft, FollowupUrgency } from './types'

function toStr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toUrgency(value: unknown): FollowupUrgency {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'medium'
}

function toFollowups(value: unknown): FollowupDraft[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, i): FollowupDraft | null => {
      if (typeof item !== 'object' || item === null) return null
      const record = item as Record<string, unknown>
      const body = toStr(record.body)
      if (!body) return null
      return {
        sequence: ((i + 1) as 1 | 2 | 3),
        angle: toStr(record.angle) || `Follow-up ${i + 1}`,
        urgency: toUrgency(record.urgency),
        subject: toStr(record.subject),
        body,
      }
    })
    .filter((f): f is FollowupDraft => f !== null)
    .slice(0, 3)
}

export async function generateFollowups(
  input: EmailGenerationInput,
  originalEmail: EmailDraft
): Promise<FollowupResult> {
  const { systemPrompt, userPrompt } = buildFollowupPrompt(input, originalEmail)

  let lastError: unknown
  for (const maxTokens of [1536, 3072]) {
    try {
      const response = await getCompletion({ systemPrompt, userPrompt, maxTokens, temperature: 0.6, jsonMode: true })
      const parsed = JSON.parse(extractJsonFromResponse(response.content)) as Record<string, unknown>
      const followups = toFollowups(parsed.followups)

      if (followups.length === 0) throw new Error('Model returned no follow-ups')

      return { status: 'ok', followups, providerUsed: response.providerName, modelUsed: response.model }
    } catch (e) {
      lastError = e
    }
  }

  return {
    status: 'error',
    followups: [],
    error: lastError instanceof Error ? lastError.message : 'Failed to generate follow-ups',
  }
}
