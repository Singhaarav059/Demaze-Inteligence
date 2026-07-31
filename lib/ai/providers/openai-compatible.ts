// ============================================================
// AI Provider — generic OpenAI-compatible
// ============================================================
// Replaces the old NVIDIA-only NvidiaProvider (2026-07-30) — Qwen/DashScope,
// ZenMux, and NVIDIA NIM all speak the exact same OpenAI-compatible
// chat.completions shape, differing only in base URL, API key, and model
// string, so one parameterized class serves all three instead of three
// near-identical copies. The API key is passed in explicitly (not read from
// a hardcoded env var inside the class) so the same class works for any
// vendor's key.
// ============================================================

import OpenAI from 'openai'
import type {
  AIProvider,
  AIProviderConfig,
  CompletionRequest,
  CompletionResponse,
} from '../types'

export class OpenAICompatibleProvider implements AIProvider {
  name: string
  displayName: string
  private config: AIProviderConfig
  private client: OpenAI
  private apiKey: string | undefined

  constructor(name: string, displayName: string, config: AIProviderConfig, apiKey: string | undefined) {
    this.name = name
    this.displayName = displayName
    this.config = config
    this.apiKey = apiKey

    this.client = new OpenAI({
      apiKey,
      baseURL: config.base_url,
    })
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const startTime = Date.now()

    const options: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.config.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      max_tokens: request.maxTokens ?? this.config.max_tokens,
      temperature: request.temperature ?? this.config.temperature,
      ...(request.jsonMode && {
        response_format: { type: 'json_object' },
      }),
    }

    const response = await this.client.chat.completions.create(options)

    const content = response.choices[0]?.message?.content ?? ''
    const latencyMs = Date.now() - startTime
    const tokensUsed = response.usage?.total_tokens ?? 0
    const finishReason = response.choices[0]?.finish_reason

    return {
      content,
      model: this.config.model,
      providerName: this.name,
      tokensUsed,
      latencyMs,
      finishReason,
    }
  }

  // Lightweight availability check — just verifies the API key is set.
  // A real network ping is too slow to run before every request; actual
  // failures are caught in the factory's try/catch fallback.
  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey)
  }
}
