// ============================================================
// AI Provider Factory
// ============================================================
// NVIDIA NIM (only provider — OpenRouter removed 2026-07-18):
// Full list replaced 2026-07-18 after live-testing every catalog model this
// account is actually entitled to invoke (most catalog entries 404 with
// "Not found for account" despite being listed — entitlement, not a typo)
// against a realistic ~2000-char scraped-content-shaped prompt at
// max_tokens=1200 (production's real budget, not a toy one-liner):
//   - meta/llama-3.1-70b-instruct, z-ai/glm-5.2: timed out (>80s) at this
//     input size, despite looking fine on a trivial prompt — dropped.
//   - minimaxai/minimax-m3: consistently hit the full 90s LLM_TIMEOUT_MS in
//     live production runs (not this test) — dropped.
//   - nvidia/nemotron-3-ultra-550b-a55b: documented CoT-token-burn/truncation
//     bug, see lib/pipeline/business-profile.ts ~154-198 — dropped.
//   - moonshotai/kimi-k2.6: listed in the catalog but 404s — not entitled on
//     this account.
//   - thinkingmachines/inkling: was the default (single-sample test showed
//     5.6s/clean JSON), but real production traffic on 2026-07-22 showed it
//     failing ~90% of calls — empty/malformed JSON from reasoning-channel
//     leakage (the exact failure mode looksLikeJson() below guards against),
//     429 rate-limiting, and 90s timeouts. gpt-oss-120b was silently
//     absorbing almost every one of those failures as the fallback. Dropped
//     entirely rather than kept as a fallback — removed the "single sample,
//     don't fully trust it" list.
// Confirmed working, ranked by real production reliability (2026-07-22),
// not just the original single-sample latency test:
//   1. openai/gpt-oss-120b           (default — 7.3s single-sample latency,
//                                     clean JSON, was already absorbing the
//                                     vast majority of production traffic as
//                                     the de facto fallback; needs a real
//                                     token budget or its reasoning preamble
//                                     alone exhausts a small max_tokens and
//                                     returns null content — fine at
//                                     production's 4096+ default)
//   2. deepseek-ai/deepseek-v4-pro   (fallback — 19.1s single-sample latency,
//                                     clean JSON, strongest-quality fallback,
//                                     100% success rate on live 2026-07-22
//                                     traffic when it was reached)
// ============================================================

import { NvidiaProvider } from './providers/nvidia-nim'
import type { AIProvider, CompletionRequest, CompletionResponse } from './types'

const NVIDIA_NIM_MODELS = [
  process.env.NVIDIA_NIM_MODEL ?? 'openai/gpt-oss-120b',
  'deepseek-ai/deepseek-v4-pro',
]

const NVIDIA_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1'

// Confirmed live (2026-07-19) against thinkingmachines/inkling on short
// generation prompts (subject lines/emails/followups): the model dumps its
// entire real answer into reasoning_content and abandons the visible
// content field after 1-2 chars (e.g. '{"') while still reporting
// finish_reason='stop' — not truncation, since it happens identically at
// max_tokens=8192. No exception is thrown by the provider in this case, so
// without this check a 200-OK-but-garbage response "wins" forever and the
// fallback loop below never advances to gpt-oss-120b/deepseek-v4-pro, both
// already confirmed reliable for this exact prompt shape.
function looksLikeJson(content: string): boolean {
  const trimmed = content.trim()
  return trimmed.length >= 10 && trimmed.includes('{') && trimmed.includes('}')
}

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

  if (request.jsonMode && !looksLikeJson(result.content)) {
    throw new Error(
      `${provider.displayName} returned an empty/malformed JSON response (content: ${JSON.stringify(result.content.slice(0, 40))}) — likely reasoning-channel leakage, not a real completion.`
    )
  }

  console.log(
    `[AI] Success: ${provider.displayName} | model: ${result.model} | tokens: ${result.tokensUsed} | latency: ${result.latencyMs}ms`
  )
  return result
}

export async function getCompletion(
  request: CompletionRequest
): Promise<CompletionResponse> {
  // Raised from 90s 2026-07-22: the full test-analysis pipeline's narrative
  // prompt runs at maxTokens=8192 (vs. 1200 in the original per-model latency
  // test and 4096 for outbound-generation calls) — both remaining models in
  // the chain hit the 90s ceiling on a real large-content run, not a fluke
  // (confirmed by 90000ms-exact timeouts on both, back to back). 150s gives
  // genuinely large/reasoning-heavy completions realistic room without
  // uncapping the request.
  const LLM_TIMEOUT_MS = 150_000
  const errors: string[] = []

  // NVIDIA NIM chain (only provider)
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

  throw new Error(
    `All AI providers failed.\n${errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n')}`
  )
}

export async function getDefaultProviderName(): Promise<string | null> {
  return 'nvidia_nim_gpt_oss_120b'
}
