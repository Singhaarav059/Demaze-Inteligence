// ============================================================
// AI Provider — NVIDIA NIM
// ============================================================
// Uses the OpenAI-compatible SDK pointed at NVIDIA's endpoint.
// All three NIM models (llama-70b, mixtral-8x22b, nemotron-120b)
// are served through the same class — the model string differs.
// ============================================================

import OpenAI from 'openai'
import type {
  AIProvider,
  AIProviderConfig,
  CompletionRequest,
  CompletionResponse,
} from '../types'

export class NvidiaProvider implements AIProvider {
  name: string
  displayName: string
  private config: AIProviderConfig
  private client: OpenAI

  constructor(name: string, displayName: string, config: AIProviderConfig) {
    this.name = name
    this.displayName = displayName
    this.config = config

    this.client = new OpenAI({
      apiKey: process.env.NVIDIA_NIM_API_KEY,
      baseURL: config.base_url, // https://integrate.api.nvidia.com/v1
    })
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const startTime = Date.now()

    // Build the request options
    // NIM supports response_format: { type: 'json_object' } for structured output.
    // This forces the model to return valid JSON — no parsing guesswork.
    //
    // NOTE (2026-07-18): thinkingmachines/inkling reportedly exposes a
    // `reasoning_effort` param (0.2-0.99) to control chain-of-thought token
    // spend — relevant here since nemotron's undocumented CoT burn is a known
    // problem (see lib/pipeline/business-profile.ts ~154-198). NOT added
    // below: this options object only forwards a fixed, explicit field list
    // (no passthrough of arbitrary AIProviderConfig keys), and NVIDIA's
    // OpenAI-compatible endpoint's actual support for this field is
    // unverified. Wiring it in blind risks breaking the request for an
    // unconfirmed param name/shape — do this properly (verify against NVIDIA's
    // docs/a live call) in a follow-up rather than guessing here.
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
  // A real network ping is too slow to run before every request;
  // actual failures are caught in the factory's try/catch fallback.
  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.NVIDIA_NIM_API_KEY)
  }
}
