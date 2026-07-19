// DELETE /api/admin/scrape-cache?url=<encoded-url>
// Removes a specific URL's cache entry so the next scrape is guaranteed fresh.

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { deleteScrapeCache } from '@/lib/cache/scrape-cache'

export async function DELETE(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const url = req.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ success: false, error: 'url query param required' }, { status: 400 })
  }

  const deleted = await deleteScrapeCache(url)
  if (!deleted) {
    return NextResponse.json({ success: false, error: 'Failed to delete cache entry' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
