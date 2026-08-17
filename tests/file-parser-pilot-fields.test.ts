// ============================================================
// Batch lead-list parser — icpSegment/sourceListId (Pilot Readiness Plan,
// Phase E)
// ============================================================
// Exercised via the CSV path (parseLeadListFile), the easiest of the four
// supported formats to construct a real buffer for — same header-aliasing
// code (rowsFromTable/buildColumnMap) is shared by xlsx/docx/pdf too, so
// this covers the actual new logic without needing a binary fixture.
// ============================================================

import { describe, it, expect } from 'vitest'
import { parseLeadListFile } from '../lib/batch/file-parser'

function csvBuffer(text: string): Buffer {
  return Buffer.from(text, 'utf-8')
}

describe('parseLeadListFile — icpSegment/sourceListId columns', () => {
  it('parses both optional columns when present', async () => {
    const csv = 'Company Name,ICP Segment,Source List\nAcme Corp,Manufacturing,Q3 Pilot List\n'
    const result = await parseLeadListFile(csvBuffer(csv), 'leads.csv')
    expect(result.success).toBe(true)
    expect(result.rows[0].icpSegment).toBe('Manufacturing')
    expect(result.rows[0].sourceListId).toBe('Q3 Pilot List')
  })

  it('rows with neither column still parse fine — both stay undefined, not required', async () => {
    const csv = 'Company Name,Website\nAcme Corp,acme.com\n'
    const result = await parseLeadListFile(csvBuffer(csv), 'leads.csv')
    expect(result.success).toBe(true)
    expect(result.rows[0].icpSegment).toBeUndefined()
    expect(result.rows[0].sourceListId).toBeUndefined()
    expect(result.rows[0].companyWebsite).toBe('acme.com')
  })

  it('a bare "Segment" header is recognized as icpSegment', async () => {
    const csv = 'Company,Segment\nAcme Corp,Automotive\n'
    const result = await parseLeadListFile(csvBuffer(csv), 'leads.csv')
    expect(result.rows[0].icpSegment).toBe('Automotive')
  })

  it('a "List Name" header is recognized as sourceListId, not swallowed by personName\'s bare "name" fallback', async () => {
    const csv = 'Company,List Name\nAcme Corp,August Batch\n'
    const result = await parseLeadListFile(csvBuffer(csv), 'leads.csv')
    expect(result.rows[0].sourceListId).toBe('August Batch')
    expect(result.rows[0].personName).toBeUndefined()
  })

  it('non-regression: a genuine "Full Name" person column still maps to personName, not swallowed by the new fields', async () => {
    const csv = 'Company,Full Name\nAcme Corp,Jane Doe\n'
    const result = await parseLeadListFile(csvBuffer(csv), 'leads.csv')
    expect(result.rows[0].personName).toBe('Jane Doe')
    expect(result.rows[0].sourceListId).toBeUndefined()
    expect(result.rows[0].icpSegment).toBeUndefined()
  })
})
