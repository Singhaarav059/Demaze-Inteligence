// ============================================================
// Supabase — Server Client
// ============================================================
// Use this in API route handlers and the pipeline (server-side only).
// Uses the SERVICE_ROLE_KEY — can read and write everything.
// Never expose this client to the browser.
// ============================================================

import { createClient } from '@supabase/supabase-js'

export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Missing Supabase server credentials. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local'
    )
  }

  return createClient(url, key, {
    auth: {
      // Disable session persistence — this is a server client
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
