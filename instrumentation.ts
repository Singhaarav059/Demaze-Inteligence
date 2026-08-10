// ============================================================
// Next.js instrumentation — runs once when the server boots
// ============================================================
// register() is called by Next.js at server startup (next dev / next
// start), never during `next build`. Gated on the nodejs runtime so this
// doesn't double-run under an edge runtime instance.
// ============================================================

// Warmup engine scheduler (2026-08-04) — this app's first-ever background
// scheduler. Gated behind WARMUP_ENGINE_ENABLED, unset/anything-but-'true'
// by default EVERYWHERE (including local dev) — this is the equivalent of
// this app's standing "explicit confirmation before real sends" rule,
// applied to an autonomous process instead of a per-click UI action:
// nothing sends a single real email until this is deliberately set,
// separately from writing/deploying this code. The manual tick route
// (app/api/admin/outbound/warmup/engine/tick/route.ts) is unaffected by
// this flag — an admin's explicit click there is itself the confirmation.
//
// Only valid because this app runs as a single, persistent `next start`
// process (confirmed: lib/rate-limit.ts's own in-memory store already
// depends on and documents this same fact) — a setInterval here would
// silently do nothing useful on a serverless platform (e.g. Vercel), where
// function instances don't stay alive between requests. If this app is
// ever moved off a persistent-process host, this scheduler needs to move
// to that platform's own cron/scheduled-function mechanism instead.
async function startWarmupEngineScheduler() {
  if (process.env.WARMUP_ENGINE_ENABLED !== 'true') return

  // globalThis (not module-scope state) survives Next.js dev hot-reload
  // re-invoking register() — module state resets on reload, globalThis
  // doesn't, so this guard actually prevents a second interval stacking up.
  const g = globalThis as typeof globalThis & { __warmupEngineStarted?: boolean }
  if (g.__warmupEngineStarted) return
  g.__warmupEngineStarted = true

  const { logger } = await import('@/lib/logger')
  const intervalMs = Number(process.env.WARMUP_ENGINE_INTERVAL_MS) || 30 * 60 * 1000
  logger.info('warmup-engine', `Scheduler enabled — running every ${intervalMs}ms`)

  setInterval(() => {
    void import('@/lib/outbound/warmup/engine/run-tick').then(({ runAndLogWarmupEngineTick }) => runAndLogWarmupEngineTick())
  }, intervalMs)
}

// Follow-up engine scheduler (2026-08-05) — same shape and same safety
// rationale as startWarmupEngineScheduler() above, a SEPARATE scheduler
// (own flag, own guard, own interval) because this touches real prospects,
// not the user's own warmup mailbox pool. Gated behind
// FOLLOWUP_ENGINE_ENABLED, unset/anything-but-'true' by default everywhere.
// The manual tick route (app/api/admin/outbound/followups/engine/tick/
// route.ts) is unaffected by this flag.
async function startFollowupEngineScheduler() {
  if (process.env.FOLLOWUP_ENGINE_ENABLED !== 'true') return

  const g = globalThis as typeof globalThis & { __followupEngineStarted?: boolean }
  if (g.__followupEngineStarted) return
  g.__followupEngineStarted = true

  const { logger } = await import('@/lib/logger')
  const intervalMs = Number(process.env.FOLLOWUP_ENGINE_INTERVAL_MS) || 60 * 60 * 1000
  logger.info('followup-engine', `Scheduler enabled — running every ${intervalMs}ms`)

  setInterval(() => {
    void import('@/lib/outbound/sending/followup-engine/run-tick').then(({ runAndLogFollowupEngineTick }) => runAndLogFollowupEngineTick())
  }, intervalMs)
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnv } = await import('@/lib/env')
    validateEnv()
    await startWarmupEngineScheduler()
    await startFollowupEngineScheduler()
  }
}
