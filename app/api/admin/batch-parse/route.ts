// ============================================================
// Admin: Batch Lead-List Parse — POST /api/admin/batch-parse
// ============================================================
// Accepts an uploaded lead-list file (xlsx/csv/docx/pdf), parses it
// in-memory, dedupes companies, and returns the structured list.
// The uploaded file is NEVER written to disk or persisted anywhere —
// it exists only as an in-memory Buffer for the duration of this request.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { parseLeadListFile } from '@/lib/batch/file-parser'
import { dedupeCompanies } from '@/lib/batch/company-dedup'

export async function POST(req: NextRequest) {
  const authError = verifyAdminRequest(req)
  if (authError) return authError

  const formData = await req.formData()
  const file = formData.get('file')

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 })
  }

  const MAX_SIZE = 20 * 1024 * 1024 // 20MB — generous for a lead-list export
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ success: false, error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB), max 20MB` }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const parseResult = await parseLeadListFile(buffer, file.name)

  if (!parseResult.success) {
    return NextResponse.json({
      success: false,
      error: parseResult.error,
      detectedHeaders: parseResult.detectedHeaders,
    }, { status: 422 })
  }

  const companies = dedupeCompanies(parseResult.rows)

  return NextResponse.json({
    success: true,
    companies,
    warnings: parseResult.warnings,
    totalRows: parseResult.rows.length,
    totalCompanies: companies.length,
  })
}
