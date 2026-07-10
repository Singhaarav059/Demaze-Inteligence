// ============================================================
// Supabase — Browser Client
// ============================================================
// Use this in React components and client-side hooks.
// Uses the ANON_KEY — respects Row Level Security.
// ============================================================

import { createClient } from '@supabase/supabase-js'

// Singleton — one client instance for the entire browser session
let client: ReturnType<typeof createClient> | null = null

export function createBrowserClient() {
  if (client) return client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      'Missing Supabase browser credentials. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local'
    )
  }

  client = createClient(url, key)
  return client
}
