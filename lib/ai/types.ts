// ============================================================
// AI Provider Layer — Shared Types
// ============================================================
// Every provider implementation must satisfy these interfaces.
// The pipeline only ever imports from this file — never from
// a specific provider file directly.
// ============================================================

export interface CompletionRequest {
  systemPrompt: string
  userPrompt: string
  maxTokens: number
  temperature: number
  // When true, the provider uses guided JSON mode (NIM-native).
  // The pipeline always sets this to true for structured analysis.
  jsonMode: boolean
  // Per-provider timeout override (ms), see provider-factory.ts's
  // getCompletion(). Defaults to 150_000 (calibrated for the long
  // narrative/research-extraction call) when omitted — short-output calls
  // (subject lines, email, follow-ups) should pass a much shorter value so a
  // hanging/slow provider fails fast instead of eating minutes per attempt.
  timeoutMs?: number
}

export interface CompletionResponse {
  content: string       // Raw text / JSON string returned by the model
  model: string         // Exact model string used (e.g. "meta/llama-3.1-70b-instruct")
  providerName: string  // e.g. "nvidia_nim_llama_70b"
  tokensUsed: number
  latencyMs: number
  // 'length' means the model hit max_tokens and got cut off mid-output — the
  // likely cause of "Unterminated string in JSON" parse failures. 'stop' means
  // the model finished normally but still produced malformed JSON. Undefined
  // if the provider/SDK didn't report one.
  finishReason?: string
}

// Every provider must implement this interface.
// The factory calls isAvailable() before complete() to decide whether
// to use this provider or skip to the next in priority order.
export interface AIProvider {
  name: string
  displayName: string
  complete(request: CompletionRequest): Promise<CompletionResponse>
  isAvailable(): Promise<boolean>
}

// Matches the config JSONB column in the ai_providers table
export interface AIProviderConfig {
  base_url: string
  model: string
  max_tokens: number
  temperature: number
}
