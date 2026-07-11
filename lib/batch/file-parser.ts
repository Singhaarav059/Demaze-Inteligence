// ============================================================
// Batch Lead-List File Parser — v1
// ============================================================
// Parses an uploaded lead-list file (xlsx/csv/docx/pdf) into a common
// LeadRow[] shape. Runs server-side only (exceljs/mammoth/pdf-parse are
// Node libraries) — the uploaded file is parsed in-memory and never
// written to disk or persisted anywhere; only the extracted rows are
// returned to the caller.
//
// Three layers of graceful degradation, per the approved Phase 1 plan:
//   1. File-level:      corrupt/unreadable file -> {success:false, error}
//   2. Structure-level: parsed fine, but no recognizable lead-list columns
//                        found -> {success:false, error, detectedHeaders}
//                        so the user can see what WAS found, not just "empty"
//   3. Row-level:        an individual malformed row (no company name) is
//                        skipped with a warning, doesn't fail the whole file
//
// xlsx is the priority format (real Sales Navigator exports). csv is the
// second most reliable. docx/pdf are explicitly best-effort — a Word doc
// has no inherent table semantics unless using Word's table feature, and
// PDF text extraction can interleave columns. Both surface a warning
// rather than silently guessing wrong.
// ============================================================

import ExcelJS from 'exceljs'
import Papa from 'papaparse'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'

export interface LeadRow {
  personName?: string
  companyName: string
  jobTitle?: string
  personLinkedIn?: string
  companyLinkedIn?: string
  industry?: string
  country?: string
  companyWebsite?: string
}

export interface ParseResult {
  success: boolean
  rows: LeadRow[]
  warnings: string[]
  error?: string
  /** Headers actually found — populated on structure-level failure so the
   * user can see why nothing parsed, instead of just getting an empty list. */
  detectedHeaders?: string[]
}

// ── Header aliasing ─────────────────────────────────────────────
// Real exports vary column names. Matched case-insensitively, substring
// based. Order matters within each list — more specific patterns first.

const HEADER_ALIASES: Record<keyof LeadRow, string[]> = {
  companyName:     ['company name', 'organization name', 'account name', 'company', 'organization'],
  personName:      ['person name', 'contact name', 'full name', 'name'],
  jobTitle:        ['job title', 'title', 'position', 'role'],
  companyLinkedIn: ['company linkedin', 'organization linkedin'],
  personLinkedIn:  ['person linkedin', 'contact linkedin', 'linkedin url', 'linkedin'],
  industry:        ['industry'],
  country:         ['country/region', 'country', 'location'],
  // NOTE: bare 'url' deliberately excluded — it greedily matched "Person
  // LinkedIn URL"/"Company LinkedIn URL" columns (confirmed via a real
  // fixture: every row's companyWebsite got populated with a person's
  // LinkedIn URL instead, which then made every row's domain resolve to
  // "linkedin.com" and spuriously merge all companies together in dedup).
  // Same false-positive class as the historical 'ir'/'sec' URL-classifier
  // substring bug. A bare "URL"-named column meaning "company website"
  // with no other qualifier is a real but rarer case we accept missing —
  // better than silently populating it with the wrong URL.
  companyWebsite:  ['company website', 'website', 'domain'],
}

/** Maps a raw header row to { fieldName -> columnIndex }. Each field claims
 * the first unclaimed column that matches one of ITS OWN aliases, processed
 * in priorityOrder — this is what keeps a bare "company"/"organization"
 * alias (needed for real exports that just have a "Company" column) from
 * greedily matching "Company Website"/"Company LinkedIn URL" columns: those
 * two fields run earlier in priorityOrder and claim their columns first, so
 * by the time companyName's generic fallback aliases are checked, those
 * columns are already claimed and skipped. Same false-positive class as the
 * URL-classifier's short-keyword substring bug — a single shared
 * "best-matching field for this header" function (the earlier, buggier
 * design) doesn't respect this ordering; per-field-first-match does. */
function buildColumnMap(headers: string[]): Partial<Record<keyof LeadRow, number>> {
  const map: Partial<Record<keyof LeadRow, number>> = {}
  const usedColumns = new Set<number>()

  const priorityOrder: Array<keyof LeadRow> = [
    'companyLinkedIn', 'companyWebsite', 'companyName',
    'personLinkedIn', 'personName', 'jobTitle', 'industry', 'country',
  ]

  for (const field of priorityOrder) {
    const aliases = HEADER_ALIASES[field]
    for (let i = 0; i < headers.length; i++) {
      if (usedColumns.has(i)) continue
      const h = headers[i].toLowerCase().trim()
      if (aliases.some(a => h.includes(a))) {
        map[field] = i
        usedColumns.add(i)
        break
      }
    }
  }

  return map
}

function rowsFromTable(headerRow: string[], dataRows: string[][]): { rows: LeadRow[]; warnings: string[]; detectedHeaders: string[] } {
  const columnMap = buildColumnMap(headerRow)
  const warnings: string[] = []
  const rows: LeadRow[] = []

  if (columnMap.companyName === undefined) {
    // Structure-level failure is signaled by the caller checking this —
    // return empty rows, detectedHeaders lets the caller explain why.
    return { rows: [], warnings, detectedHeaders: headerRow }
  }

  dataRows.forEach((cells, i) => {
    const get = (field: keyof LeadRow) => {
      const idx = columnMap[field]
      if (idx === undefined) return undefined
      const v = cells[idx]?.trim()
      return v ? v : undefined
    }

    const companyName = get('companyName')
    if (!companyName) {
      warnings.push(`Row ${i + 2}: skipped — no company name`)
      return
    }

    rows.push({
      companyName,
      personName: get('personName'),
      jobTitle: get('jobTitle'),
      personLinkedIn: get('personLinkedIn'),
      companyLinkedIn: get('companyLinkedIn'),
      industry: get('industry'),
      country: get('country'),
      companyWebsite: get('companyWebsite'),
    })
  })

  return { rows, warnings, detectedHeaders: headerRow }
}

// ── xlsx ──────────────────────────────────────────────────────

async function parseXlsx(buffer: Buffer): Promise<ParseResult> {
  try {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
    const worksheet = workbook.worksheets[0]
    if (!worksheet) return { success: false, rows: [], warnings: [], error: 'Workbook has no worksheets' }

    const allRows: string[][] = []
    worksheet.eachRow({ includeEmpty: false }, row => {
      const cells: string[] = []
      // ExcelJS rows are 1-indexed; .values[0] is always empty
      const values = row.values as Array<string | number | { text?: string } | null | undefined>
      for (let i = 1; i < values.length; i++) {
        const v = values[i]
        cells[i - 1] = v == null ? '' : typeof v === 'object' ? String(v.text ?? '') : String(v)
      }
      allRows.push(cells)
    })

    if (allRows.length === 0) return { success: false, rows: [], warnings: [], error: 'Worksheet is empty' }

    const [headerRow, ...dataRows] = allRows
    const { rows, warnings, detectedHeaders } = rowsFromTable(headerRow, dataRows)

    if (rows.length === 0 && dataRows.length > 0) {
      return {
        success: false, rows: [], warnings,
        error: `Could not find a company-name column. Headers found: ${detectedHeaders.join(', ')}`,
        detectedHeaders,
      }
    }

    return { success: true, rows, warnings }
  } catch (e) {
    return { success: false, rows: [], warnings: [], error: `Could not read xlsx file: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ── csv ───────────────────────────────────────────────────────

function parseCsv(text: string): ParseResult {
  try {
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true })
    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      return { success: false, rows: [], warnings: [], error: `CSV parse error: ${parsed.errors[0].message}` }
    }

    const allRows = parsed.data
    if (allRows.length === 0) return { success: false, rows: [], warnings: [], error: 'CSV file is empty' }

    const [headerRow, ...dataRows] = allRows
    const { rows, warnings, detectedHeaders } = rowsFromTable(headerRow, dataRows)

    if (rows.length === 0 && dataRows.length > 0) {
      return {
        success: false, rows: [], warnings,
        error: `Could not find a company-name column. Headers found: ${detectedHeaders.join(', ')}`,
        detectedHeaders,
      }
    }

    return { success: true, rows, warnings }
  } catch (e) {
    return { success: false, rows: [], warnings: [], error: `Could not read CSV file: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ── docx ──────────────────────────────────────────────────────
// Best-effort: a Word doc has no inherent tabular structure unless it uses
// Word's table feature. mammoth's extractRawText() flattens table cells
// with blank lines and drops row boundaries entirely (confirmed against a
// real generated fixture — cells come out as "A\n\nB\n\nC\n\n..." with no
// way to tell where one row ends and the next begins). convertToHtml()
// preserves the real <table><tr><td> structure instead, which is what this
// parses. Always warns that this is lower-confidence than xlsx/csv.

function parseHtmlTable(html: string): { headerRow: string[]; dataRows: string[][] } | null {
  const rowMatches = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
  if (rowMatches.length < 2) return null

  const rows = rowMatches.map(rowMatch => {
    const cellMatches = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    return cellMatches.map(c => c[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
  })

  const [headerRow, ...dataRows] = rows
  return { headerRow, dataRows }
}

async function parseDocx(buffer: Buffer): Promise<ParseResult> {
  try {
    const result = await mammoth.convertToHtml({ buffer })
    const table = parseHtmlTable(result.value)

    if (!table) {
      return {
        success: false, rows: [], warnings: [],
        error: 'Could not detect a table structure in this Word document — docx support only works reliably when the lead list is a real Word table, not free-form text.',
      }
    }

    const { rows, warnings, detectedHeaders } = rowsFromTable(table.headerRow, table.dataRows)
    warnings.unshift('Parsed from a Word document — lower confidence than xlsx/csv, double-check the extracted rows.')

    if (rows.length === 0) {
      return {
        success: false, rows: [], warnings,
        error: `Could not find a company-name column in the detected table. Headers found: ${detectedHeaders.join(', ')}`,
        detectedHeaders,
      }
    }

    return { success: true, rows, warnings }
  } catch (e) {
    return { success: false, rows: [], warnings: [], error: `Could not read docx file: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ── pdf ───────────────────────────────────────────────────────
// Best-effort, least reliable of the four: linearizing a PDF to plain text
// can interleave columns from a real table. Uses pdf-parse's getText(); if
// the extracted text doesn't look tab-delimited into a clean table, fails
// structure-level rather than guessing. Not validated against a real
// tabular PDF (generating one requires a fixture library beyond this
// project's scope) — treat this path as unverified best-effort, consistent
// with PDF being explicitly the least-reliable supported format.

function parseTabDelimitedText(text: string): { headerRow: string[]; dataRows: string[][] } | null {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return null

  const delimiter = lines[0].includes('\t') ? '\t' : null
  if (!delimiter) return null

  const headerRow = lines[0].split(delimiter).map(s => s.trim())
  const dataRows = lines.slice(1).map(l => l.split(delimiter).map(s => s.trim()))
  return { headerRow, dataRows }
}

async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  try {
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    await parser.destroy()

    const table = parseTabDelimitedText(result.text)

    if (!table) {
      return {
        success: false, rows: [], warnings: [],
        error: 'Could not detect a reliable table structure in this PDF — PDF text extraction often interleaves columns from a real table, so this format is best-effort. xlsx or CSV is strongly preferred.',
      }
    }

    const { rows, warnings, detectedHeaders } = rowsFromTable(table.headerRow, table.dataRows)
    warnings.unshift('Parsed from a PDF — this is the least reliable of the supported formats (column data can interleave during text extraction). Verify the extracted rows carefully before researching.')

    if (rows.length === 0) {
      return {
        success: false, rows: [], warnings,
        error: `Could not find a company-name column. Headers found: ${detectedHeaders.join(', ')}`,
        detectedHeaders,
      }
    }

    return { success: true, rows, warnings }
  } catch (e) {
    return { success: false, rows: [], warnings: [], error: `Could not read PDF file: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ── Main entry point ─────────────────────────────────────────

export async function parseLeadListFile(
  buffer: Buffer,
  filename: string,
): Promise<ParseResult> {
  const ext = filename.toLowerCase().split('.').pop()

  switch (ext) {
    case 'xlsx':
    case 'xls':
      return parseXlsx(buffer)
    case 'csv':
      return parseCsv(buffer.toString('utf-8'))
    case 'docx':
      return parseDocx(buffer)
    case 'pdf':
      return parsePdf(buffer)
    default:
      return {
        success: false, rows: [], warnings: [],
        error: `Unsupported file type ".${ext}" — supported formats: .xlsx, .csv, .docx, .pdf`,
      }
  }
}
