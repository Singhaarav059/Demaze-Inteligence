// ============================================================
// Admin Auth — POST /api/admin/auth
// ============================================================
// Validates the admin password against ADMIN_SECRET env var.
// Returns a session token stored client-side in sessionStorage.
// The token is a simple HMAC-SHA256 of the secret — good enough
// for an internal dev tool with no public exposure.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'

export async function POST(req: NextRequest) {
  const { password } = await req.json()

  const secret = process.env.ADMIN_SECRET
  if (!secret) {
    return NextResponse.json(
      { success: false, error: 'ADMIN_SECRET not set in environment' },
      { status: 500 }
    )
  }

  if (!password || password !== secret) {
    return NextResponse.json(
      { success: false, error: 'Invalid password' },
      { status: 401 }
    )
  }

  // Produce a session token: HMAC-SHA256 of the secret with itself as key.
  // This is deterministic — no DB needed, token can be re-verified anywhere.
  const token = createHmac('sha256', secret).update(secret).digest('hex')

  return NextResponse.json({ success: true, token })
}
