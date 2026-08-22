// ============================================================
// AI Provider — Gemini via Vertex AI (Express Mode API key)
// ============================================================
// Replaces the AI-Studio-backed Gemini tier (2026-08-03) — Vertex AI Express
// Mode does NOT expose an OpenAI-compatible chat/completions endpoint (only
// the native generateContent/streamGenerateContent REST methods, confirmed
// against Google's own Express Mode API reference), so this can't reuse
// OpenAICompatibleProvider the way the AI Studio tier did. Uses Google's
// official unified SDK (@google/genai) instead, which speaks the native
// generateContent shape directly and handles Express Mode auth (vertexai:
// true + apiKey, no project/location needed) internally.
//
// Bonus fix enabled by moving off the OpenAI-compat shim: the native API
// tracks thinking tokens (usageMetadata.thoughtsTokenCount) SEPARATELY from
// visible output tokens (candidatesTokenCount) — maxOutputTokens only bounds
// the latter. This resolves the documented short-output empty-response bug
// (see provider-factory.ts's header history) where Gemini's hidden reasoning
// used to consume the entire OpenAI-style max_tokens budget before any
// visible JSON was emitted. thinkingLevel: MINIMAL (not thinkingBudget: 0 —
// Gemini 3 models cannot fully disable thinking, confirmed via Google's docs
// on migrating from thinking_budget to thinking_level) keeps reasoning as
// low as the API allows without adding per-call branching complexity.
// ============================================================

import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import type { AIProvider, CompletionRequest, CompletionResponse } from '../types'

export class VertexGeminiProvider implements AIProvider {
  name: string
  displayName: string
  private model: string
  private client: GoogleGenAI
  private apiKey: string | undefined

  constructor(name: string, displayName: string, model: string, apiKey: string | undefined) {
    this.name = name
    this.displayName = displayName
    this.model = model
    this.apiKey = apiKey
    this.client = new GoogleGenAI({ vertexai: true, apiKey })
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const startTime = Date.now()

    // Gemini's API rejects tools + responseMimeType together, so jsonMode is
    // dropped whenever grounding is on (see enableSearchGrounding's doc
    // comment in lib/ai/types.ts) — callers requesting grounding must ask
    // for JSON in the prompt text instead.
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: request.userPrompt,
      config: {
        systemInstruction: request.systemPrompt,
        maxOutputTokens: request.maxTokens,
        temperature: request.temperature,
        ...(request.jsonMode && !request.enableSearchGrounding && { responseMimeType: 'application/json' }),
        ...(request.enableSearchGrounding && { tools: [{ googleSearch: {} }] }),
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
    })

    const content = response.text ?? ''
    const latencyMs = Date.now() - startTime
    const tokensUsed = response.usageMetadata?.totalTokenCount ?? 0
    const finishReason = response.candidates?.[0]?.finishReason
    const groundingSources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map(c => ({ uri: c.web?.uri, title: c.web?.title }))
      .filter(s => s.uri)

    return {
      content,
      model: this.model,
      providerName: this.name,
      tokensUsed,
      latencyMs,
      finishReason,
      groundingSources,
    }
  }

  // Lightweight availability check — just verifies the API key is set, same
  // discipline as OpenAICompatibleProvider.isAvailable(). A real network
  // ping is too slow to run before every request; actual failures are
  // caught in the factory's try/catch fallback.
  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey)
  }
}
