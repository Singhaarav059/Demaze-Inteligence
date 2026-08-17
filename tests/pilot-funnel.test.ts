// ============================================================
// Pilot Observability funnel/trace — pure aggregation tests
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  buildCompanyTrace,
  computeFunnel,
  computeFailures,
  type PilotCompanyRunInput,
  type PilotContactInput,
} from '../lib/outbound/pilot/funnel'

function contact(overrides: Partial<PilotContactInput> = {}): PilotContactInput {
  return {
    contactId: 'c1',
    personName: 'Jane Doe',
    email: 'jane@acme.com',
    discoveryGroundingStatus: 'confirmed',
    hasGeneratedDraft: true,
    hasUnsupportedClaim: false,
    campaignContactStatus: null,
    openedAt: null,
    suppressed: false,
    suppressionReason: null,
    hadSendFailure: false,
    hadSendAmbiguous: false,
    ...overrides,
  }
}

function run(overrides: Partial<PilotCompanyRunInput> = {}): PilotCompanyRunInput {
  return {
    runId: 'r1',
    domain: 'acme.com',
    companyUrl: 'https://acme.com',
    createdAt: '2026-08-01T00:00:00Z',
    companyName: 'Acme',
    whyNow: 'Recently expanded',
    whatToSell: 'Automation',
    evidenceSufficiency: 'sufficient',
    validationWarningsCount: 0,
    opportunitiesCount: 1,
    topOpportunityTitle: 'Predictive maintenance',
    icpSegmentsCount: 1,
    icpSufficiency: 'sufficient',
    contacts: [contact()],
    ...overrides,
  }
}

describe('buildCompanyTrace', () => {
  it('a fully clean company traces through to sent/no_reply_yet', () => {
    const t = buildCompanyTrace(run({ contacts: [contact({ campaignContactStatus: 'sent' })] }))
    expect(t.qaStatus).toBe('passed')
    expect(t.sendStatus).toBe('sent')
    expect(t.outcome).toBe('no_reply_yet')
    expect(t.decisionMakerFound).toBe(true)
  })

  it('no contacts at all -> not_approved, n/a outcome', () => {
    const t = buildCompanyTrace(run({ contacts: [] }))
    expect(t.decisionMakerFound).toBe(false)
    expect(t.qaStatus).toBe('not_attempted')
    expect(t.sendStatus).toBe('not_approved')
    expect(t.outcome).toBe('n/a')
  })

  it('a blocked draft (invalid email) is qaStatus failed, not passed', () => {
    const t = buildCompanyTrace(run({ contacts: [contact({ email: 'not-an-email' })] }))
    expect(t.qaStatus).toBe('failed')
  })

  it('an unsupported-claim draft is qaStatus failed', () => {
    const t = buildCompanyTrace(run({ contacts: [contact({ hasUnsupportedClaim: true })] }))
    expect(t.qaStatus).toBe('failed')
  })

  it('enqueued but not yet sent -> queued_not_sent', () => {
    const t = buildCompanyTrace(run({ contacts: [contact({ campaignContactStatus: 'queued' })] }))
    expect(t.sendStatus).toBe('queued_not_sent')
  })

  it('a reply outweighs a bounce/open in outcome priority', () => {
    const t = buildCompanyTrace(
      run({
        contacts: [
          contact({ contactId: 'c1', campaignContactStatus: 'bounced' }),
          contact({ contactId: 'c2', campaignContactStatus: 'replied' }),
        ],
      })
    )
    expect(t.outcome).toBe('replied')
  })
})

describe('computeFunnel', () => {
  it('counts each stage independently across a mixed set of companies', () => {
    const runs = [
      run({ runId: 'r1', contacts: [contact({ campaignContactStatus: 'sent' })] }), // full funnel
      run({ runId: 'r2', opportunitiesCount: 0, contacts: [] }), // no opportunity, no contact
      run({ runId: 'r3', validationWarningsCount: 2, contacts: [contact({ email: null })] }), // warning + no email
    ]
    const f = computeFunnel(runs)
    expect(f.companiesEntered).toBe(3)
    expect(f.researchCompleted).toBe(3)
    expect(f.researchWarnings).toBe(1)
    expect(f.validOpportunities).toBe(2)
    expect(f.decisionMakerFound).toBe(2)
    expect(f.emailFound).toBe(1)
    expect(f.emailQAPassed).toBe(1)
    expect(f.sent).toBe(1)
    expect(f.replied).toBe(0)
  })
})

describe('computeFailures', () => {
  it('classifies distinct failure reasons per company', () => {
    const runs = [
      run({ runId: 'insufficient', evidenceSufficiency: 'insufficient' }),
      run({ runId: 'identity', contacts: [contact({ discoveryGroundingStatus: 'conflict' })] }),
      run({ runId: 'icp', icpSufficiency: 'insufficient' }),
      run({ runId: 'no-people', contacts: [] }),
      run({ runId: 'no-email', contacts: [contact({ email: null })] }),
      run({ runId: 'qa-fail', contacts: [contact({ hasUnsupportedClaim: true })] }),
      run({ runId: 'send-fail', contacts: [contact({ hadSendFailure: true })] }),
      run({ runId: 'suppressed', contacts: [contact({ suppressed: true, suppressionReason: 'bounced' })] }),
      run({ runId: 'clean' }),
    ]
    const f = computeFailures(runs)
    expect(f.relevanceOrEvidenceFailure).toBe(1)
    expect(f.identityFailure).toBe(1)
    expect(f.icpFailure).toBe(1)
    expect(f.peopleDataFailure).toBe(1)
    expect(f.emailFailure).toBe(1)
    // qaFailure deliberately overlaps identity/email failures — QA reuses
    // the exact same checkEmailFormat/checkCompanyIdentity checks (Rule 2:
    // one deterministic implementation, not a duplicate), so "identity" and
    // "no-email" also count here alongside the dedicated "qa-fail" company.
    expect(f.qaFailure).toBe(3)
    expect(f.sendFailure).toBe(1)
    expect(f.suppression).toBe(1)
  })

  it('a company with no drafts attempted at all is not counted as a QA failure', () => {
    const runs = [run({ contacts: [contact({ hasGeneratedDraft: false })] })]
    expect(computeFailures(runs).qaFailure).toBe(0)
  })
})
