// ============================================================
// Env-var validation at boot
// ============================================================
// Called once from instrumentation.ts when the server actually starts
// (next dev / next start) — never during `next build`, since Next.js only
// invokes instrumentation's register() at server boot, not build time.
//
// Required vars throw (fail fast, aggregated into one error) — nothing in
// this app works without Supabase persistence. Everything else is
// optional-with-a-warning: this repo's own philosophy is graceful
// degradation (a missing vendor key should disable one feature, never
// crash the app) — see CLAUDE.md's "the actual goal" section.
// ============================================================

import { getKeyOrThrow } from '@/lib/outbound/settings/credential-crypto'
import { logger } from '@/lib/logger'

const REQUIRED_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const

const OPTIONAL_VARS = [
  'ADMIN_SECRET',
  'FIRECRAWL_API_KEY',
  'TAVILY_API_KEY',
  'SERPER_API_KEY',
  'NVIDIA_NIM_API_KEY',
  'CREDENTIALS_ENCRYPTION_KEY',
  'PROSPEO_API_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
] as const

export function validateEnv(): void {
  const missingRequired = REQUIRED_VARS.filter((name) => !process.env[name])
  if (missingRequired.length > 0) {
    throw new Error(
      `Missing required env var(s): ${missingRequired.join(', ')}. ` +
        'See .env.example for setup steps.'
    )
  }

  const missingOptional = OPTIONAL_VARS.filter((name) => !process.env[name])
  if (missingOptional.length > 0) {
    logger.warn(
      'env',
      `Optional env var(s) not set — the matching feature(s) will be degraded/disabled: ${missingOptional.join(', ')}`
    )
  }

  if (process.env.CREDENTIALS_ENCRYPTION_KEY) {
    try {
      getKeyOrThrow()
    } catch (err) {
      logger.warn(
        'env',
        `CREDENTIALS_ENCRYPTION_KEY is set but malformed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  logger.info('env', 'Env validation complete')
}
