// ============================================================
// AI Provider Factory
// ============================================================
// Changed 2026-08-03 — Gemini tier moved from AI Studio (simple API key
// against the OpenAI-compatible generativelanguage.googleapis.com endpoint)
// to Vertex AI Express Mode (GEMINI_VERTEX_API_KEY, native generateContent
// API via the new VertexGeminiProvider in ./providers/vertex-gemini.ts —
// Express Mode doesn't expose an OpenAI-compatible endpoint, confirmed
// against Google's own Express Mode API reference, so this vendor can't go
// through tryVendorChain/OpenAICompatibleProvider the way NVIDIA does; it
// gets its own tryVertexGeminiChain below). Same position in the fallback
// order (tried first, NVIDIA NIM still the fallback), same model default
// (gemini-3.6-flash). See vertex-gemini.ts's header for the thinkingLevel
// fix this move also enabled. Not yet live-verified against a real Vertex
// Express Mode key — same "verify via tsc, defer live run" precedent this
// file's own history uses for every other vendor swap; whoever adds the
// real key should smoke-test one real call before trusting this in
// production.
//
// Prior history — Chain changed 2026-07-30 (second pass, same day): Gemini
// (AI Studio) became the default, Qwen and ZenMux (tried briefly earlier the
// same day) removed entirely, not just deprioritized:
//   - Gemini (gemini-3.6-flash via Google's OpenAI-compatible endpoint,
//     https://generativelanguage.googleapis.com/v1beta/openai/): 6.4s
//     single-sample latency, clean valid JSON, evidence-grounded extraction
//     on par with or better than every other candidate tried today —
//     dramatically faster than everything else tested (Qwen ~37-44s,
//     ZenMux ~55s, and even the prior NVIDIA default gpt-oss-120b ~7.3s).
//     Made the new default on this result.
//   - Qwen (qwen3.7-plus via DashScope) and ZenMux (z-ai/glm-4.7-flash-free)
//     were both live-tested first (clean JSON, but 37-55s latency each) and
//     briefly wired in ahead of NVIDIA NIM — removed outright once Gemini's
//     result came back, since Gemini beats both on every axis tested
//     (latency, quality) and there's no reason to keep two clearly-inferior
//     options in the fallback chain just because they were tried first.
//   - Still only a single sample for Gemini, same caveat as every other
//     candidate here — NVIDIA NIM (gpt-oss-120b -> deepseek-v4-pro, proven
//     under real 2026-07-22 production traffic, see history below) is kept
//     as the fallback specifically so a bad run on Gemini still falls
//     through to a previously-proven chain rather than hard-failing.
//
// CONFIRMED same day, real production traffic — Gemini systematically fails
// on SHORT-output calls (subject-line generation's maxTokens=1024/2048 loop,
// lib/outbound/generation/generate-subject-lines.ts) with the exact same
// empty/truncated-JSON failure class as the historical nemotron/inkling
// drops above. Root cause, confirmed against Google's own docs
// (ai.google.dev/gemini-api/docs/openai): "reasoning cannot be turned off
// for Gemini 2.5 Pro or 3 models" — gemini-3.6-flash's internal thinking
// tokens always count against max_tokens with no way to disable them, so a
// small budget lets thinking consume the whole request before any visible
// JSON is emitted. The single-sample eval above only exercised the
// long-content research-extraction call shape (maxTokens=4096), which is
// why this wasn't caught before wiring Gemini in as the default.
// Deliberately NOT fixed by branching providers per max_tokens or reverting
// Gemini at the time — the existing looksLikeJson() guard + fallback-to-
// NVIDIA handled it safely (confirmed live: Gemini fails fast, NVIDIA picks
// up the slack, no crash, no malformed output reaches a caller), accepted as
// a non-fatal latency cost, not something worth branching complexity to
// solve right then.
//
// ADDRESSED 2026-08-03 as a side effect of the AI-Studio -> Vertex Express
// Mode move above: the OpenAI-compatible shim was the actual root cause,
// not something inherent to Gemini 3 — it maps thinking + visible output
// into ONE combined max_tokens budget. The native generateContent API
// (VertexGeminiProvider) tracks them separately (usageMetadata.
// thoughtsTokenCount vs candidatesTokenCount; maxOutputTokens only bounds
// the latter), and thinkingConfig.thinkingLevel: MINIMAL keeps reasoning as
// low as Gemini 3 models allow (they still can't fully disable it, per
// Google's docs). Not yet live-verified against the exact short-output call
// shape that originally surfaced this (generate-subject-lines.ts's
// maxTokens=1024/2048 loop) — worth confirming on the first real
// short-output run against the new Vertex key.
//
// Prior history — NVIDIA NIM (was the only provider, OpenRouter removed
// 2026-07-18): full list replaced 2026-07-18 after live-testing every
// catalog model this account is actually entitled to invoke (most catalog
// entries 404 with "Not found for account" despite being listed —
// entitlement, not a typo) against a realistic ~2000-char scraped-content-
// shaped prompt at max_tokens=1200 (production's real budget at the time):
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
// Confirmed working, ranked by real production reliability (2026-07-22):
//   1. openai/gpt-oss-120b           (7.3s single-sample latency, clean
//                                     JSON, was already absorbing the vast
//                                     majority of production traffic as the
//                                     de facto fallback; needs a real token
//                                     budget or its reasoning preamble alone
//                                     exhausts a small max_tokens and
//                                     returns null content — fine at
//                                     production's 4096+ default)
//   2. deepseek-ai/deepseek-v4-pro   (19.1s single-sample latency, clean
//                                     JSON, strongest-quality fallback,
//                                     100% success rate on live 2026-07-22
//                                     traffic when it was reached)
// ============================================================

import { OpenAICompatibleProvider } from './providers/openai-compatible'
import { VertexGeminiProvider } from './providers/vertex-gemini'
import type { AIProvider, CompletionRequest, CompletionResponse } from './types'

const VERTEX_GEMINI_MODELS = [process.env.GEMINI_MODEL ?? 'gemini-3.6-flash']

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
// fallback loop below never advances to the next provider. Same guard now
// protects Gemini too — not yet proven immune to this failure mode under
// real traffic (see header comment).
function looksLikeJson(content: string): boolean {
  const trimmed = content.trim()
  return trimmed.length >= 10 && trimmed.includes('{') && trimmed.includes('}')
}

// Rate-limit circuit breaker (2026-07-30) — confirmed live via real,
// repeated back-to-back log lines: once Gemini starts returning 429s, EVERY
// subsequent request within the same rate-limit window tries it again
// anyway, wastes a round-trip finding out it's still 429ing, then falls
// through to NVIDIA. In-memory only (per server process, resets on
// restart) — this is a short-lived operational cooldown, not a persisted
// setting, so that's an acceptable scope. Keyed per-vendor (namePrefix),
// not per-model — a 429 on a vendor's key almost always applies account-
// wide, not to one specific model.
const RATE_LIMIT_COOLDOWN_MS = 60_000
const rateLimitedUntil: Record<string, number> = {}

function isRateLimited(vendorKey: string): boolean {
  const until = rateLimitedUntil[vendorKey]
  return typeof until === 'number' && Date.now() < until
}

function looksLikeRateLimit(message: string): boolean {
  return /\b429\b/.test(message) || /rate.?limit/i.test(message)
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
      `${provider.displayName} returned an empty/malformed JSON response (content: ${JSON.stringify(result.content.slice(0, 40))}), likely reasoning-channel leakage, not a real completion.`
    )
  }

  console.log(
    `[AI] Success: ${provider.displayName} | model: ${result.model} | tokens: ${result.tokensUsed} | latency: ${result.latencyMs}ms`
  )
  return result
}

// Tries every model in `models` (in order) against one OpenAI-compatible
// vendor endpoint, returning the first success or null if the vendor has no
// API key configured at all (not an error — just "this vendor isn't set
// up", same as the old per-vendor `if (process.env.X_API_KEY)` guards). Any
// per-model failure is pushed onto the shared `errors` list so the final
// "all providers failed" error (if every vendor is exhausted) still shows
// the full picture across both vendors, not just the last one tried.
// NVIDIA NIM-only since 2026-08-03 — Vertex AI Express Mode doesn't speak
// this shape, see tryVertexGeminiChain below.
async function tryVendorChain(
  models: string[],
  baseUrl: string,
  apiKey: string | undefined,
  namePrefix: string,
  displayPrefix: string,
  request: CompletionRequest,
  timeoutMs: number,
  errors: string[],
): Promise<CompletionResponse | null> {
  if (!apiKey) return null
  if (isRateLimited(namePrefix)) {
    console.warn(`[AI] Skipping ${displayPrefix} — rate-limited within the last ${RATE_LIMIT_COOLDOWN_MS}ms, not retrying yet`)
    errors.push(`${displayPrefix}: skipped, recently rate-limited`)
    return null
  }
  for (const model of models) {
    const label = model.split('/').pop() ?? model
    const provider = new OpenAICompatibleProvider(
      `${namePrefix}_${label.replace(/[^a-z0-9]/gi, '_')}`,
      `${displayPrefix} (${label})`,
      { base_url: baseUrl, model, max_tokens: 4096, temperature: 0.3 },
      apiKey,
    )
    try {
      return await tryProvider(provider, request, timeoutMs)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[AI] Provider failed: ${provider.displayName} -- ${message}`)
      errors.push(`${provider.displayName}: ${message}`)
      if (looksLikeRateLimit(message)) {
        rateLimitedUntil[namePrefix] = Date.now() + RATE_LIMIT_COOLDOWN_MS
        console.warn(`[AI] ${displayPrefix} rate-limited — skipping it for the next ${RATE_LIMIT_COOLDOWN_MS}ms`)
        break // no point trying this vendor's other models either, same account/key
      }
    }
  }
  return null
}

// Vertex AI Express Mode counterpart to tryVendorChain above — same
// shape (try each model in order, skip cleanly if unconfigured, respect the
// shared rate-limit cooldown, collect errors), but builds VertexGeminiProvider
// instances instead of OpenAICompatibleProvider ones, since Express Mode has
// no OpenAI-compatible endpoint to point the generic class at.
async function tryVertexGeminiChain(
  models: string[],
  apiKey: string | undefined,
  request: CompletionRequest,
  timeoutMs: number,
  errors: string[],
): Promise<CompletionResponse | null> {
  if (!apiKey) return null
  const vendorKey = 'gemini_vertex'
  const displayPrefix = 'Gemini (Vertex)'
  if (isRateLimited(vendorKey)) {
    console.warn(`[AI] Skipping ${displayPrefix} — rate-limited within the last ${RATE_LIMIT_COOLDOWN_MS}ms, not retrying yet`)
    errors.push(`${displayPrefix}: skipped, recently rate-limited`)
    return null
  }
  for (const model of models) {
    const provider = new VertexGeminiProvider(
      `${vendorKey}_${model.replace(/[^a-z0-9]/gi, '_')}`,
      `${displayPrefix} (${model})`,
      model,
      apiKey,
    )
    try {
      return await tryProvider(provider, request, timeoutMs)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[AI] Provider failed: ${provider.displayName} -- ${message}`)
      errors.push(`${provider.displayName}: ${message}`)
      if (looksLikeRateLimit(message)) {
        rateLimitedUntil[vendorKey] = Date.now() + RATE_LIMIT_COOLDOWN_MS
        console.warn(`[AI] ${displayPrefix} rate-limited — skipping it for the next ${RATE_LIMIT_COOLDOWN_MS}ms`)
        break // no point trying this vendor's other models either, same account/key
      }
    }
  }
  return null
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
  // uncapping the request. This is the DEFAULT, used when the caller doesn't
  // specify request.timeoutMs — confirmed live (2026-07-30) that a short-
  // output generation call (subject lines/email/follow-ups) can otherwise
  // hang for the full 150s TWICE (both NVIDIA fallback models) before
  // failing, a ~5 minute wait for what should be a quick call. Callers doing
  // short-output generation should pass a much shorter override.
  const LLM_TIMEOUT_MS = request.timeoutMs ?? 150_000
  const errors: string[] = []

  const geminiResult = await tryVertexGeminiChain(
    VERTEX_GEMINI_MODELS, process.env.GEMINI_VERTEX_API_KEY, request, LLM_TIMEOUT_MS, errors
  )
  if (geminiResult) return geminiResult

  const nvidiaResult = await tryVendorChain(
    NVIDIA_NIM_MODELS, NVIDIA_NIM_BASE_URL, process.env.NVIDIA_NIM_API_KEY, 'nvidia_nim', 'NVIDIA NIM', request, LLM_TIMEOUT_MS, errors
  )
  if (nvidiaResult) return nvidiaResult

  throw new Error(
    `All AI providers failed.\n${errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n')}`
  )
}

export async function getDefaultProviderName(): Promise<string | null> {
  return 'gemini_vertex_gemini_3_6_flash'
}

// Web-search-grounded completion — Gemini/Vertex only, no NVIDIA fallback,
// since NVIDIA has no equivalent live-search capability and a fallback
// answer built from parametric knowledge alone would defeat the whole point
// of a grounded call (see lib/research/company-signals.ts, the one caller).
export async function getGroundedCompletion(request: CompletionRequest): Promise<CompletionResponse> {
  const errors: string[] = []
  const result = await tryVertexGeminiChain(
    VERTEX_GEMINI_MODELS, process.env.GEMINI_VERTEX_API_KEY, request, request.timeoutMs ?? 60_000, errors
  )
  if (result) return result
  throw new Error(`Grounded search unavailable.\n${errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n')}`)
}
