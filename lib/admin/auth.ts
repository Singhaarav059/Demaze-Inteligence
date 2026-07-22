// ============================================================
// Admin Auth Helper — Server-side token verification
// ============================================================
// Used by all admin API routes to verify the x-admin-token header.
// ============================================================

import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

const ADMIN_RATE_LIMIT = { limit: 120, windowMs: 60_000 }

export function getExpectedToken(): string | null {
  const secret = process.env.ADMIN_SECRET
  if (!secret) return null
  return createHmac('sha256', secret).update(secret).digest('hex')
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export function verifyAdminRequest(req: NextRequest): NextResponse | null {
  const rateLimit = checkRateLimit(`admin:${getClientIp(req)}`, ADMIN_RATE_LIMIT)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many requests, please slow down.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds ?? 60) } }
    )
  }

  const secret = process.env.ADMIN_SECRET

  // Auth is disabled when ADMIN_SECRET is not set.
  // Set it in .env.local to re-enable password protection.
  if (!secret) return null

  const token = req.headers.get('x-admin-token')
  const expected = getExpectedToken()

  if (!expected) return null // secret exists but HMAC failed to generate — pass through

  if (!token || !timingSafeEqualStr(token, expected)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized: invalid or missing admin token' },
      { status: 401 }
    )
  }

  return null // null = authorized, proceed
}
