// ============================================================
// Company re-audit — re-evaluating already-qualified rows against the
// current ruleset, dry-run safety, no duplicate identity creation
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FakeSupabase } from './helpers/fake-supabase'

vi.mock('../lib/pipeline/html-extractor', () => ({
  fetchAndExtract: vi.fn(async () => ({ url: '', success: false, markdown: '', charCount: 0, error: 'mocked: no network in tests' })),
}))

const getCompletionMock = vi.fn()
vi.mock('../lib/ai/provider-factory', () => ({
  getCompletion: (...args: unknown[]) => getCompletionMock(...args),
}))

beforeEach(() => {
  getCompletionMock.mockReset()
  getCompletionMock.mockResolvedValue({ content: '{"scale":"unknown"}', model: 'test', providerName: 'test' })
})

import { reAuditCompanies } from '../lib/enrichment/company-reaudit'
import { upsertDiscovered } from '../lib/companies/identity'
import { qualifyCandidate } from '../lib/enrichment/company-qualification'

// Seeds a row shaped like a real pre-migration/stale-ruleset 'qualified'
// company_registry row — no qualification_version, real size_evidence
// (or none), matching production's actual 326-row state before migration
// 028.
async function seedStaleQualified(supa: FakeSupabase, name: string, opts: { sizeEvidence?: unknown[]; sector?: string } = {}) {
  const row = await upsertDiscovered(supa as any, { name, sector: opts.sector as any })
  const dbRow = supa.table('company_registry').find((r: any) => r.id === row.id)!
  dbRow.status = 'qualified'
  dbRow.size_evidence = opts.sizeEvidence ?? []
  dbRow.qualified_at = '2026-08-01T00:00:00.000Z'
  return row.id
}

describe('reAuditCompanies — dry run does not mutate production state', () => {
  it('a dry run reports what would change but leaves status/version untouched', async () => {
    const supa = new FakeSupabase()
    getCompletionMock.mockResolvedValue({ content: '{"scale":"large","reasoning":"a known conglomerate"}', model: 'test', providerName: 'test' })
    const id = await seedStaleQualified(supa, 'BMW', { sector: 'automotive' })

    const summary = await reAuditCompanies(supa as any, {}, { dryRun: true })
    expect(summary.dryRun).toBe(true)
    expect(summary.nowDisqualified).toBe(1)

    const row = supa.table('company_registry').find((r: any) => r.id === id)!
    expect(row.status).toBe('qualified') // unchanged — dry run must not mutate
    expect(row.qualification_version).toBeUndefined() // never written
  })

  it('dry run is the default when options are omitted', async () => {
    const supa = new FakeSupabase()
    const id = await seedStaleQualified(supa, 'CLEPA')
    const summary = await reAuditCompanies(supa as any, {})
    expect(summary.dryRun).toBe(true)
    const row = supa.table('company_registry').find((r: any) => r.id === id)!
    expect(row.status).toBe('qualified')
  })
})

describe('reAuditCompanies — a previously qualified mega-cap gets disqualified', () => {
  it('BMW (stale-qualified, no size evidence) is disqualified when the LLM confidently recognizes it', async () => {
    const supa = new FakeSupabase()
    getCompletionMock.mockResolvedValue({ content: '{"scale":"large","reasoning":"BMW is a major global automaker"}', model: 'test', providerName: 'test' })
    const id = await seedStaleQualified(supa, 'BMW', { sector: 'automotive' })

    const summary = await reAuditCompanies(supa as any, {}, { dryRun: false })
    expect(summary.nowDisqualified).toBe(1)

    const row = supa.table('company_registry').find((r: any) => r.id === id)!
    expect(row.status).toBe('disqualified')
    expect(row.qualification_version).toBe('v2')
    expect(row.size_classification).toBe('too_large')
  })

  it('an industrial-park entity (stale-qualified) is disqualified via entity type, no LLM call needed', async () => {
    const supa = new FakeSupabase()
    const id = await seedStaleQualified(supa, 'Jurong Industrial Estate')

    const summary = await reAuditCompanies(supa as any, {}, { dryRun: false })
    expect(summary.nowDisqualified).toBe(1)
    expect(getCompletionMock).not.toHaveBeenCalled()

    const row = supa.table('company_registry').find((r: any) => r.id === id)!
    expect(row.status).toBe('disqualified')
    expect(row.entity_type).toBe('GOVERNMENT')
  })

  it('a mega-cap with already-stored evidence is re-caught from stored evidence alone, no LLM call needed', async () => {
    const supa = new FakeSupabase()
    const id = await seedStaleQualified(supa, 'Some Giant Co', {
      sizeEvidence: [{ metric: 'revenue', raw: '$10 billion', valueUsdApprox: 10_000_000_000, sourceSnippet: 'x' }],
    })

    const summary = await reAuditCompanies(supa as any, {}, { dryRun: false })
    expect(summary.nowDisqualified).toBe(1)
    expect(getCompletionMock).not.toHaveBeenCalled()

    const row = supa.table('company_registry').find((r: any) => r.id === id)!
    expect(row.status).toBe('disqualified')
    expect(row.size_evidence_source).toBe('snippets')
  })
})

describe('reAuditCompanies — safety: a legitimate SME with insufficient size evidence stays qualified, not falsely rejected', () => {
  it('an obscure/unrecognized company the LLM declines on remains qualified (unchanged or review), never disqualified', async () => {
    const supa = new FakeSupabase()
    getCompletionMock.mockResolvedValue({ content: '{"scale":"unknown","reasoning":"not a recognized company"}', model: 'test', providerName: 'test' })
    const id = await seedStaleQualified(supa, 'Obscure Regional Manufacturer LLC')

    const summary = await reAuditCompanies(supa as any, {}, { dryRun: false })
    expect(summary.nowDisqualified).toBe(0)
    expect(summary.unchanged + summary.nowReview).toBe(1)

    const row = supa.table('company_registry').find((r: any) => r.id === id)!
    expect(row.status).toBe('qualified')
    expect(row.size_classification).toBe('unknown')
  })
})

describe('reAuditCompanies — filters', () => {
  it('sector filter only evaluates matching rows', async () => {
    const supa = new FakeSupabase()
    await seedStaleQualified(supa, 'Auto Co', { sector: 'automotive' })
    await seedStaleQualified(supa, 'Mfg Co', { sector: 'manufacturing' })

    const summary = await reAuditCompanies(supa as any, { sector: 'automotive' as any }, { dryRun: true })
    expect(summary.evaluated).toBe(1)
    expect(summary.results[0].displayName).toBe('Auto Co')
  })

  it('qualificationVersion: "stale" excludes rows already on the current version', async () => {
    const supa = new FakeSupabase()
    const staleId = await seedStaleQualified(supa, 'Stale Co')
    const currentId = await seedStaleQualified(supa, 'Current Co')
    supa.table('company_registry').find((r: any) => r.id === currentId)!.qualification_version = 'v2'

    const summary = await reAuditCompanies(supa as any, { qualificationVersion: 'stale' }, { dryRun: true })
    expect(summary.evaluated).toBe(1)
    expect(summary.results[0].companyId).toBe(staleId)
  })

  it('date range filter (since/until) scopes to qualified_at', async () => {
    const supa = new FakeSupabase()
    const id = await seedStaleQualified(supa, 'In Range Co')
    supa.table('company_registry').find((r: any) => r.id === id)!.qualified_at = '2026-08-10T00:00:00.000Z'

    const outOfRange = await seedStaleQualified(supa, 'Out Of Range Co')
    supa.table('company_registry').find((r: any) => r.id === outOfRange)!.qualified_at = '2026-01-01T00:00:00.000Z'

    const summary = await reAuditCompanies(supa as any, { since: '2026-08-01T00:00:00.000Z' }, { dryRun: true })
    expect(summary.evaluated).toBe(1)
    expect(summary.results[0].companyId).toBe(id)
  })

  it('limit caps the batch size', async () => {
    const supa = new FakeSupabase()
    await seedStaleQualified(supa, 'Co A')
    await seedStaleQualified(supa, 'Co B')
    await seedStaleQualified(supa, 'Co C')

    const summary = await reAuditCompanies(supa as any, { limit: 2 }, { dryRun: true })
    expect(summary.evaluated).toBe(2)
  })
})

describe('reAuditCompanies — genuine STILL_QUALIFIED reconfirmation (evidence persistence, migration 029)', () => {
  it('a row qualified with real stored sector/domain evidence is re-confirmed STILL_QUALIFIED, not capped at REVIEW', async () => {
    const supa = new FakeSupabase()
    const first = await qualifyCandidate(
      supa as any,
      {
        name: 'Reconfirmable Manufacturing Co', domain: 'reconfirmable.example', domainConfidence: 'high',
        snippets: ['A component manufacturer with revenue of ₹100 crore and 3 plants.'],
      },
      'manufacturing',
    )
    expect(first.status).toBe('qualified')

    const summary = await reAuditCompanies(supa as any, {}, { dryRun: true })
    expect(summary.evaluated).toBe(1)
    expect(summary.results[0].outcome).toBe('still_qualified')
    expect(summary.stillQualified).toBe(1)
    expect(summary.nowReview).toBe(0)
    expect(summary.nowDisqualified).toBe(0)
  })

  it('a row whose stored sector evidence no longer matches the current signal list becomes NOW_DISQUALIFIED with reasonCategory SECTOR', async () => {
    const supa = new FakeSupabase()
    const first = await qualifyCandidate(
      supa as any,
      { name: 'Drifted Sector Co', domain: 'drifted.example', snippets: ['A component manufacturer with revenue of ₹100 crore.'] },
      'manufacturing',
    )
    expect(first.status).toBe('qualified')
    // Simulate stored evidence whose snippet no longer supports the sector
    // (e.g. a ruleset/signal-list change) — same shape a real re-audit
    // would see, without needing to actually edit the sector playbook.
    const row = supa.table('company_registry').find((r: any) => r.id === first.companyId)!
    row.sector_evidence = { ...row.sector_evidence, snippet: 'A boutique hotel chain with resorts across the coast.' }

    const summary = await reAuditCompanies(supa as any, {}, { dryRun: false })
    expect(summary.nowDisqualified).toBe(1)
    expect(summary.results[0].reasonCategory).toBe('SECTOR')
    const updated = supa.table('company_registry').find((r: any) => r.id === first.companyId)!
    expect(updated.status).toBe('disqualified')
    expect(updated.rejection_reason).toBe('wrong_sector')
  })

  it('a legacy row with no stored sector_evidence stays REVIEW (insufficient evidence), never falsely STILL_QUALIFIED', async () => {
    const supa = new FakeSupabase()
    const id = await seedStaleQualified(supa, 'Legacy No-Evidence Co', {
      sizeEvidence: [{ metric: 'revenue', raw: '₹100 crore', valueUsdApprox: 12_000_000, sourceSnippet: 'x' }],
      sector: 'manufacturing',
    })
    const summary = await reAuditCompanies(supa as any, {}, { dryRun: true })
    expect(summary.evaluated).toBe(1)
    expect(summary.results[0].outcome).toBe('now_review')
    expect(summary.stillQualified).toBe(0)
    const row = supa.table('company_registry').find((r: any) => r.id === id)!
    expect(row.status).toBe('qualified') // dry run — unchanged
  })

  it('reasonCategory ENTITY_TYPE/SIZE are reported on their respective disqualifications', async () => {
    const supa = new FakeSupabase()
    const govId = await seedStaleQualified(supa, 'Jurong Industrial Estate')
    getCompletionMock.mockResolvedValue({ content: '{"scale":"large","reasoning":"a known conglomerate"}', model: 'test', providerName: 'test' })
    const megaId = await seedStaleQualified(supa, 'BMW', { sector: 'automotive' })

    const summary = await reAuditCompanies(supa as any, {}, { dryRun: true })
    const govResult = summary.results.find(r => r.companyId === govId)!
    const megaResult = summary.results.find(r => r.companyId === megaId)!
    expect(govResult.reasonCategory).toBe('ENTITY_TYPE')
    expect(megaResult.reasonCategory).toBe('SIZE')
    expect(megaResult.sizeEvidenceSource).toBe('knowledge')
  })
})

describe('reAuditCompanies — no duplicate identity created', () => {
  it('re-auditing never inserts a second company_registry row for the same company', async () => {
    const supa = new FakeSupabase()
    await seedStaleQualified(supa, 'No Dupe Co')
    const before = supa.table('company_registry').length

    await reAuditCompanies(supa as any, {}, { dryRun: false })

    const after = supa.table('company_registry').length
    expect(after).toBe(before)
  })
})
