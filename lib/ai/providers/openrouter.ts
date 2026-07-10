// ============================================================
// AI Provider -- OpenRouter
// ============================================================
// Wraps any OpenRouter model. Pass modelId in constructor to
// create multiple instances for different models.
// Default chain: deepseek/deepseek-v4-flash -> deepseek/deepseek-v4
//                -> thudm/glm-z1-flash
// ============================================================

import OpenAI from 'openai'
import type { AIProvider, CompletionRequest, CompletionResponse } from '../types'

export class OpenRouterProvider implements AIProvider {
  name: string
  displayName: string
  private modelId: string

  constructor(modelId?: string) {
    this.modelId = modelId ?? process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4-flash'
    const label = this.modelId.split('/').pop() ?? this.modelId
    this.name = `openrouter_${label.replace(/[^a-z0-9]/gi, '_')}`
    this.displayName = `OpenRouter (${label})`
  }

  private get client(): OpenAI {
    return new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://demaze.ai',
        'X-Title': 'Demaze Outbound Intelligence',
      },
    })
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.OPENROUTER_API_KEY)
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const startTime = Date.now()

    const response = await this.client.chat.completions.create({
      model: this.modelId,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      ...(request.jsonMode && {
        response_format: { type: 'json_object' },
      }),
    })

    const content = response.choices[0]?.message?.content ?? ''
    return {
      content,
      model: this.modelId,
      providerName: this.name,
      tokensUsed: response.usage?.total_tokens ?? 0,
      latencyMs: Date.now() - startTime,
    }
  }
}
