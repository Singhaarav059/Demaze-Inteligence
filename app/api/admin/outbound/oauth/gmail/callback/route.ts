// ============================================================
// Admin: Shared Gmail OAuth callback — GET /api/admin/outbound/oauth/gmail/callback
// ============================================================
// One shared callback for every Google-connected flow in this app (Email
// Sending + Warm-Up today, and any future one). Previously each flow had
// its own callback path, which meant each needed its own separate entry in
// Google Cloud Console's Authorized redirect URIs list — and that list is
// per public domain, so N flows x 2 domains (custom + *.up.railway.app)
// meant up to 2N manual Console entries, growing every time a new
// Google-connected feature was added, and each one a fresh chance to hit
// Error 400: redirect_uri_mismatch. Google enforces exact-match redirect
// URI allowlisting server-side (no wildcards, no API-side workaround) — the
// only thing actually in this app's control is how many distinct URLs it
// ever asks Google to allow, so collapsing every flow onto one path means
// exactly one Console entry per domain, permanently, regardless of how many
// Google-connected flows this app grows to have.
//
// Dispatch: both flows already used separate, distinctly-named state
// cookies (to avoid a same-name collision if a sending connect and a
// warmup connect were both started in different tabs — see the two /start
// routes for why). Whichever cookie is actually present on this request is
// what tells this shared callback which flow to run to completion. If
// neither is present (or the value doesn't match Google's returned state),
// that's a plain CSRF/expired-state failure — same as before, no new
// failure mode introduced by merging the two callbacks.
//
// Google requires the redirect_uri sent during token exchange to exactly
// match the one used to obtain the code — since both /start routes now
// build their auth URL from the same resolveGmailOAuthRedirectUri(), this
// still holds for both flows even though there's only one callback file
// producing it now.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens, fetchGmailAddress, encodeGmailCredential } from '@/lib/outbound/shared/gmail-client'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { resolveGmailOAuthRedirectUri } from '@/lib/outbound/shared/gmail-oauth'
import { resolvePublicOrigin } from '@/lib/outbound/shared/oauth-origin'
import { STATE_COOKIE as SENDING_STATE_COOKIE } from '../../../integrations/gmail/oauth/start/route'
import { STATE_COOKIE as WARMUP_STATE_COOKIE } from '../../../warmup/oauth/start/route'

const OAUTH_RATE_LIMIT = { limit: 10, windowMs: 60_000 }

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

// Reading cookies has no side effects, so this is safe to call before rate
// limiting / anywhere else that needs to know which flow this is, including
// the top-level error handler below (which must dispatch correctly even if
// the crash happened before handleCallback() computed this itself).
function isWarmupFlow(req: NextRequest): boolean {
  const sendingState = req.cookies.get(SENDING_STATE_COOKIE)?.value
  const warmupState = req.cookies.get(WARMUP_STATE_COOKIE)?.value
  return !!warmupState && !sendingState
}

function back(req: NextRequest, warmup: boolean, status: 'success' | 'error', message?: string) {
  const path = warmup ? '/admin/outbound/warmup' : '/admin/outbound/integrations'
  const paramPrefix = warmup ? 'warmup' : 'gmail'
  const cookieToClear = warmup ? WARMUP_STATE_COOKIE : SENDING_STATE_COOKIE
  const url = new URL(path, resolvePublicOrigin(req))
  url.searchParams.set(`${paramPrefix}_oauth`, status)
  if (message) url.searchParams.set(`${paramPrefix}_oauth_message`, message)
  const res = NextResponse.redirect(url)
  res.cookies.delete(cookieToClear)
  return res
}

export async function GET(req: NextRequest) {
  try {
    return await handleCallback(req)
  } catch (e) {
    // Turns an otherwise-silent crash (raw HTTP 500, no diagnostic info)
    // into a visible message on the flow's own page — same "make failures
    // loud" discipline both original callback routes already had.
    const message = e instanceof Error ? e.message : 'Unknown server error during OAuth callback.'
    return back(req, isWarmupFlow(req), 'error', message)
  }
}

async function handleCallback(req: NextRequest): Promise<NextResponse> {
  const warmup = isWarmupFlow(req)

  const rateLimit = checkRateLimit(`gmail-oauth:${getClientIp(req)}`, OAUTH_RATE_LIMIT)
  if (!rateLimit.allowed) {
    return back(req, warmup, 'error', 'Too many attempts — please wait a minute and try again.')
  }

  const code = req.nextUrl.searchParams.get('code')
  const returnedState = req.nextUrl.searchParams.get('state')
  const googleError = req.nextUrl.searchParams.get('error')
  const expectedState = warmup
    ? req.cookies.get(WARMUP_STATE_COOKIE)?.value
    : req.cookies.get(SENDING_STATE_COOKIE)?.value

  if (googleError) {
    return back(req, warmup, 'error', `Google denied access: ${googleError}`)
  }
  if (!code) {
    return back(req, warmup, 'error', 'No authorization code returned by Google.')
  }
  if (!expectedState || !returnedState || !timingSafeEqualStr(returnedState, expectedState)) {
    return back(req, warmup, 'error', 'OAuth state mismatch — please try connecting again.')
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return back(req, warmup, 'error', 'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not configured.')
  }

  const tokenResult = await exchangeCodeForTokens({
    code,
    clientId,
    clientSecret,
    redirectUri: resolveGmailOAuthRedirectUri(req),
  })

  if (!tokenResult.ok) {
    return back(req, warmup, 'error', tokenResult.error)
  }
  if (!tokenResult.refreshToken) {
    return back(
      req,
      warmup,
      'error',
      'Google did not return a refresh token — try disconnecting this app\'s access at myaccount.google.com/permissions and reconnecting.'
    )
  }

  const email = await fetchGmailAddress(tokenResult.accessToken)
  const supabase = createServerClient()

  if (warmup) {
    if (!email) {
      return back(req, warmup, 'error', 'Connected, but could not read the account\'s email address from Google.')
    }

    const encrypted = encodeGmailCredential({
      clientId,
      clientSecret,
      refreshToken: tokenResult.refreshToken,
      email,
    })

    // Preserve started_at/status on a reconnect — an existing pool member
    // re-authorizing (e.g. after a revoked/expired refresh token) should not
    // have its warm-up ramp reset back to day zero.
    const { data: existing } = await supabase
      .from('outbound_warmup_mailboxes')
      .select('id, started_at, status')
      .eq('mailbox_address', email)
      .maybeSingle()

    const { error: upsertError } = await supabase
      .from('outbound_warmup_mailboxes')
      .upsert(
        {
          mailbox_address: email,
          provider_name: 'gmail',
          status: existing?.status ?? 'warming',
          started_at: existing?.started_at ?? new Date().toISOString(),
          credential_encrypted: encrypted,
          oauth_connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'mailbox_address' }
      )

    if (upsertError) {
      return back(req, warmup, 'error', upsertError.message)
    }

    return back(req, warmup, 'success', `Connected ${email} to the warm-up pool`)
  }

  // Sending flow — single-active-provider deactivate-then-upsert, unlike
  // warmup's pool upsert above (many warmup mailboxes are meant to be
  // active simultaneously; only one 'sending' provider ever is).
  const encrypted = encodeGmailCredential({
    clientId,
    clientSecret,
    refreshToken: tokenResult.refreshToken,
    email: email ?? undefined,
  })

  const { error: deactivateError } = await supabase
    .from('outbound_integrations')
    .update({ is_active: false })
    .eq('capability', 'sending')
    .neq('provider_name', 'gmail')

  if (deactivateError) {
    return back(req, warmup, 'error', `Saved tokens, but failed to deactivate other providers: ${deactivateError.message}`)
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
    return back(req, warmup, 'error', upsertError.message)
  }

  return back(req, warmup, 'success', email ? `Connected as ${email}` : 'Connected')
}
