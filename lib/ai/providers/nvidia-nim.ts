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

    return {
      content,
      model: this.config.model,
      providerName: this.name,
      tokensUsed,
      latencyMs,
    }
  }

  // Lightweight availability check — just verifies the API key is set.
  // A real network ping is too slow to run before every request;
  // actual failures are caught in the factory's try/catch fallback.
  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.NVIDIA_NIM_API_KEY)
  }
}
