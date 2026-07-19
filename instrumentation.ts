// ============================================================
// Next.js instrumentation — runs once when the server boots
// ============================================================
// register() is called by Next.js at server startup (next dev / next
// start), never during `next build`. Gated on the nodejs runtime so this
// doesn't double-run under an edge runtime instance.
// ============================================================

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnv } = await import('@/lib/env')
    validateEnv()
  }
}
