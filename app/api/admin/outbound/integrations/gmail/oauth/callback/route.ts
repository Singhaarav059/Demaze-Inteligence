// ============================================================
// Admin: Gmail OAuth — GET /api/admin/outbound/integrations/gmail/oauth/callback
// ============================================================
// Google redirects the account owner's own browser back here after they
// click "Allow" on Google's consent screen — see ../start/route.ts's header
// for why this can't use verifyAdminRequest and how the state cookie
// substitutes for it. On success: exchanges the code for tokens, fetches
// the connected address (display only), encrypts {clientId, clientSecret,
// refreshToken, email} as one blob (see gmail-client.ts), deactivates any
// other 'sending' provider row, and activates 'gmail' — same
// deactivate-then-upsert shape as the generic PUT
// /api/admin/outbound/integrations/[capability] route, just triggered by an
// OAuth redirect instead of a form submit. Always redirects back to the
// Integrations page (with a query param the page reads to toast success/
// failure) rather than rendering JSON — this is a browser navigation
// endpoint, not a fetch() target.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens, fetchGmailAddress, encodeGmailCredential } from '@/lib/outbound/shared/gmail-client'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { STATE_COOKIE, resolveRedirectUri } from '../start/route'

const OAUTH_RATE_LIMIT = { limit: 10, windowMs: 60_000 }

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function backToIntegrations(req: NextRequest, status: 'success' | 'error', message?: string) {
  const url = new URL('/admin/outbound/integrations', req.nextUrl.origin)
  url.searchParams.set('gmail_oauth', status)
  if (message) url.searchParams.set('gmail_oauth_message', message)
  const res = NextResponse.redirect(url)
  res.cookies.delete(STATE_COOKIE)
  return res
}

export async function GET(req: NextRequest) {
  const rateLimit = checkRateLimit(`gmail-oauth:${getClientIp(req)}`, OAUTH_RATE_LIMIT)
  if (!rateLimit.allowed) {
    return backToIntegrations(req, 'error', 'Too many attempts — please wait a minute and try again.')
  }

  const code = req.nextUrl.searchParams.get('code')
  const returnedState = req.nextUrl.searchParams.get('state')
  const googleError = req.nextUrl.searchParams.get('error')
  const expectedState = req.cookies.get(STATE_COOKIE)?.value

  if (googleError) {
    return backToIntegrations(req, 'error', `Google denied access: ${googleError}`)
  }
  if (!code) {
    return backToIntegrations(req, 'error', 'No authorization code returned by Google.')
  }
  if (!expectedState || !returnedState || !timingSafeEqualStr(returnedState, expectedState)) {
    return backToIntegrations(req, 'error', 'OAuth state mismatch — please try connecting again.')
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return backToIntegrations(req, 'error', 'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not configured.')
  }

  const tokenResult = await exchangeCodeForTokens({
    code,
    clientId,
    clientSecret,
    redirectUri: resolveRedirectUri(req),
  })

  if (!tokenResult.ok) {
    return backToIntegrations(req, 'error', tokenResult.error)
  }
  if (!tokenResult.refreshToken) {
    return backToIntegrations(
      req,
      'error',
      'Google did not return a refresh token — try disconnecting this app\'s access at myaccount.google.com/permissions and reconnecting.'
    )
  }

  const email = await fetchGmailAddress(tokenResult.accessToken)
  const encrypted = encodeGmailCredential({
    clientId,
    clientSecret,
    refreshToken: tokenResult.refreshToken,
    email: email ?? undefined,
  })

  const supabase = createServerClient()

  const { error: deactivateError } = await supabase
    .from('outbound_integrations')
    .update({ is_active: false })
    .eq('capability', 'sending')
    .neq('provider_name', 'gmail')

  if (deactivateError) {
    return backToIntegrations(req, 'error', `Saved tokens, but failed to deactivate other providers: ${deactivateError.message}`)
  }

  const { error: upsertError } = await supabase
    .from('outbound_integrations')
    .upsert(
      {
        capability: 'sending',
        provider_name: 'gmail',
        display_name: 'Gmail',
        is_enabled: true,
        is_active: true,
        credential_encrypted: encrypted,
        credential_last_four: null,
        config: { email: email ?? null },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'capability,provider_name' }
    )

  if (upsertError) {
    return backToIntegrations(req, 'error', upsertError.message)
  }

  return backToIntegrations(req, 'success', email ? `Connected as ${email}` : 'Connected')
}
