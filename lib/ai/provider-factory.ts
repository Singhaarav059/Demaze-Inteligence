// ============================================================
// AI Provider Factory
// ============================================================
// NVIDIA NIM (primary):
//   1. nvidia/nemotron-3-ultra-550b-a55b
//   2. minimaxai/minimax-m3
// OpenRouter (fallback):
//   1. deepseek/deepseek-v4-flash
//   2. deepseek/deepseek-v4-pro
//   3. z-ai/glm-5.2
// ============================================================

import { NvidiaProvider } from './providers/nvidia-nim'
import { OpenRouterProvider } from './providers/openrouter'
import type { AIProvider, CompletionRequest, CompletionResponse } from './types'

const NVIDIA_NIM_MODELS = [
  process.env.NVIDIA_NIM_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b',
  'minimaxai/minimax-m3',
]

const OPENROUTER_MODELS = [
  process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v4-pro',
  'z-ai/glm-5.2',
]

const NVIDIA_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1'

async function tryProvider(
  provider: AIProvider,
  request: CompletionRequest,
  timeoutMs: number,
): Promise<CompletionResponse> {
  console.log(`[AI] Trying provider: ${provider.displayName}`)
  const result = await Promise.race([
    provider.complete(request),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`LLM timeout after ${timeoutMs}ms`)), timeoutMs)
    ),
  ])
  console.log(
    `[AI] Success: ${provider.displayName} | model: ${result.model} | tokens: ${result.tokensUsed} | latency: ${result.latencyMs}ms`
  )
  return result
}

export async function getCompletion(
  request: CompletionRequest
): Promise<CompletionResponse> {
  const LLM_TIMEOUT_MS = 90_000
  const errors: string[] = []

  // 1. NVIDIA NIM chain (primary)
  if (process.env.NVIDIA_NIM_API_KEY) {
    for (const model of NVIDIA_NIM_MODELS) {
      const label = model.split('/').pop() ?? model
      const provider = new NvidiaProvider(
        `nvidia_nim_${label.replace(/[^a-z0-9]/gi, '_')}`,
        `NVIDIA NIM (${label})`,
        { base_url: NVIDIA_NIM_BASE_URL, model, max_tokens: 4096, temperature: 0.3 },
      )
      try {
        return await tryProvider(provider, request, LLM_TIMEOUT_MS)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn(`[AI] Provider failed: ${provider.displayName} -- ${message}`)
        errors.push(`${provider.displayName}: ${message}`)
      }
    }
  }

  // 2. OpenRouter fallback
  if (process.env.OPENROUTER_API_KEY) {
    for (const modelId of OPENROUTER_MODELS) {
      const provider = new OpenRouterProvider(modelId)
      try {
        return await tryProvider(provider, request, LLM_TIMEOUT_MS)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn(`[AI] Provider failed: ${provider.displayName} -- ${message}`)
        errors.push(`${provider.displayName}: ${message}`)
      }
    }
  }

  throw new Error(
    `All AI providers failed.\n${errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n')}`
  )
}

export async function getDefaultProviderName(): Promise<string | null> {
  return 'nvidia_nim_nemotron_3_ultra_550b_a55b'
}
