// ============================================================
// Rate limiting — in-memory fixed-window counter
// ============================================================
// No external store (Redis/etc.) — this app runs as a single `next start`
// process with no other shared-state dependency anywhere in the stack, so
// an in-memory map is the right first pass. Known limitation, same
// "documented, not fixed" discipline as other gaps in this repo: counters
// reset on server restart and are not shared across multiple instances/
// replicas. Revisit with a shared store only if this app is ever deployed
// as more than one instance.
// ============================================================

interface Window {
  count: number
  windowStart: number
}

const windows = new Map<string, Window>()

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds?: number
}

export function checkRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): RateLimitResult {
  const now = Date.now()
  const existing = windows.get(key)

  if (!existing || now - existing.windowStart >= windowMs) {
    windows.set(key, { count: 1, windowStart: now })
    return { allowed: true }
  }

  if (existing.count >= limit) {
    const retryAfterSeconds = Math.ceil((existing.windowStart + windowMs - now) / 1000)
    return { allowed: false, retryAfterSeconds }
  }

  existing.count += 1
  return { allowed: true }
}

// Best-effort client IP for rate-limit keying — not used for anything
// security-sensitive beyond throttling, so a spoofable header is an
// acceptable trade-off (same threat model as every other proxy-header-
// trusting rate limiter without a fixed reverse-proxy in front of it).
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return 'unknown'
}
