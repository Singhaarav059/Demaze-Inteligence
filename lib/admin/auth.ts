// ============================================================
// Admin Auth Helper — Server-side token verification
// ============================================================
// Used by all admin API routes to verify the x-admin-token header.
// ============================================================

import { createHmac } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

export function getExpectedToken(): string | null {
  const secret = process.env.ADMIN_SECRET
  if (!secret) return null
  return createHmac('sha256', secret).update(secret).digest('hex')
}

export function verifyAdminRequest(req: NextRequest): NextResponse | null {
  const secret = process.env.ADMIN_SECRET

  // Auth is disabled when ADMIN_SECRET is not set.
  // Set it in .env.local to re-enable password protection.
  if (!secret) return null

  const token = req.headers.get('x-admin-token')
  const expected = getExpectedToken()

  if (!expected) return null // secret exists but HMAC failed to generate — pass through

  if (!token || token !== expected) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized — invalid or missing admin token' },
      { status: 401 }
    )
  }

  return null // null = authorized, proceed
}
