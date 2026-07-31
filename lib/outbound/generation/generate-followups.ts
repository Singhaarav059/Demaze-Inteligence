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

  // Single attempt, not a [1536, 3072]-then-retry ladder — same fix as
  // generate-subject-lines.ts's identical change (see that file's comment
  // for the full finding: stacking this outer retry on top of
  // getCompletion()'s own Gemini -> NVIDIA fallback produced a real 5+
  // minute hang for this exact call, confirmed live). 8192 (higher than the
  // other two generation calls' 6144) since this call's output is 3 separate
  // follow-up emails, not one — more real content needs more room on top of
  // Gemini's non-disableable thinking-token overhead. Resilience now comes
  // entirely from getCompletion()'s own multi-vendor fallback.
  // 60s timeout (a bit more than the other two generation calls' 45s, since
  // this asks for 3 separate emails' worth of output) — still nowhere near
  // getCompletion()'s 150s default, calibrated for the long narrative/
  // research call. Confirmed live (2026-07-30) this exact call hung 5+
  // minutes without a shorter override.
  try {
    const response = await getCompletion({ systemPrompt, userPrompt, maxTokens: 8192, temperature: 0.6, jsonMode: true, timeoutMs: 60_000 })
    const parsed = JSON.parse(extractJsonFromResponse(response.content)) as Record<string, unknown>
    const followups = toFollowups(parsed.followups)

    if (followups.length === 0) throw new Error('Model returned no follow-ups')

    return { status: 'ok', followups, providerUsed: response.providerName, modelUsed: response.model }
  } catch (e) {
    return {
      status: 'error',
      followups: [],
      error: e instanceof Error ? e.message : 'Failed to generate follow-ups',
    }
  }
}
