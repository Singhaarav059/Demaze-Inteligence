// ============================================================
// AI Layer — Public Exports
// ============================================================
// The rest of the codebase imports only from here.
// Never import from provider files directly.
// ============================================================

export { getCompletion, getDefaultProviderName } from './provider-factory'
export type {
  AIProvider,
  AIProviderConfig,
  CompletionRequest,
  CompletionResponse,
} from './types'
