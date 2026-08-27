// ============================================================
// Evidence origin tagging (D.2)
// ============================================================
// Company-owned marketing content is not the same evidentiary weight as
// independently sourced evidence. This covers deriveEvidenceOrigin()
// (evidence-extractor.ts) and its propagation through extractSignals(),
// detectServiceEvidence(), generateDeterministicOpportunities(), and
// normalizeAnalysisResult() — the existing marker vocabulary (--- PAGE: ---
// for the company's own scraped pages, [SOURCE: type | tier | url] for
// web-enricher.ts's externally-fetched content), never a second/parallel
// evidence system.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  extractSignals,
  buildCompanyProfile,
  deriveEvidenceOrigin,
} from '../lib/pipeline/evidence-extractor'
import { detectServiceEvidence } from '../lib/pipeline/service-evidence'
import { generateDeterministicOpportunities } from '../lib/pipeline/opportunity-engine'
import { normalizeAnalysisResult } from '../lib/pipeline/normalize'

describe('deriveEvidenceOrigin', () => {
  const ownSiteContent = `--- PAGE: / (https://example.com) ---\n\nWe operate six manufacturing facilities.\n`

  it('own_site: an index inside a --- PAGE: --- segment', () => {
    const idx = ownSiteContent.indexOf('six manufacturing')
    expect(deriveEvidenceOrigin(ownSiteContent, idx)).toBe('own_site')
  })

  it('own_site: content with no markers at all (same fallback parseContentSegments() uses)', () => {
    const content = 'Plain unmarked prose about the company.'
    expect(deriveEvidenceOrigin(content, 5)).toBe('own_site')
  })

  it('filing: annual_report / investor_presentation / regulatory_filing marker types', () => {
    for (const type of ['annual_report', 'investor_presentation', 'earnings_call_transcript', 'regulatory_filing']) {
      const content = `[SOURCE: ${type} | tier1 | https://sec.gov/filing]\nRevenue grew 12% year over year.\n`
      const idx = content.indexOf('Revenue grew')
      expect(deriveEvidenceOrigin(content, idx)).toBe('filing')
    }
  })

  it('job_posting: careers_page marker type', () => {
    const content = `[SOURCE: careers_page | tier2 | https://boards.greenhouse.io/acme/jobs/1]\nKey Responsibilities: manage vendor onboarding.\n`
    const idx = content.indexOf('Key Responsibilities')
    expect(deriveEvidenceOrigin(content, idx)).toBe('job_posting')
  })

  it('news: press_release / news_article / ceo_interview / executive_change_announcement marker types', () => {
    for (const type of ['press_release', 'news_article', 'ceo_interview', 'executive_change_announcement']) {
      const content = `[SOURCE: ${type} | tier2 | https://reuters.com/article]\nThe company announced a new facility.\n`
      const idx = content.indexOf('The company announced')
      expect(deriveEvidenceOrigin(content, idx)).toBe('news')
    }
  })

  it('other_external: sustainability_report / corporate_website / other marker types', () => {
    for (const type of ['sustainability_report', 'corporate_website', 'other']) {
      const content = `[SOURCE: ${type} | tier3 | https://external.example.com/page]\nSome external context.\n`
      const idx = content.indexOf('Some external')
      expect(deriveEvidenceOrigin(content, idx)).toBe('other_external')
    }
  })

  it('official_blog groups with news, matching the pre-existing pageType collapse this file\'s own parseContentSegments() already used for enriched sources', () => {
    const content = `[SOURCE: official_blog | tier3 | https://external.example.com/blog]\nSome external context.\n`
    const idx = content.indexOf('Some external')
    expect(deriveEvidenceOrigin(content, idx)).toBe('news')
  })

  it('attributes each index to the segment it actually falls in when multiple segments are present', () => {
    const content =
      `--- PAGE: / (https://example.com) ---\nOwn site prose here.\n` +
      `[SOURCE: press_release | tier2 | https://reuters.com/x]\nExternal news prose here.\n` +
      `[SOURCE: careers_page | tier2 | https://example.com/careers]\nExternal job prose here.\n`
    expect(deriveEvidenceOrigin(content, content.indexOf('Own site prose'))).toBe('own_site')
    expect(deriveEvidenceOrigin(content, content.indexOf('External news prose'))).toBe('news')
    expect(deriveEvidenceOrigin(content, content.indexOf('External job prose'))).toBe('job_posting')
  })

  it('unknown: a genuinely invalid (out-of-range) index — never a guessed origin', () => {
    expect(deriveEvidenceOrigin('some content', -1)).toBe('unknown')
    expect(deriveEvidenceOrigin('some content', 9999)).toBe('unknown')
  })
})

describe('extractSignals — ExtractedEvidence.origin propagation', () => {
  it('tags evidence found on the company\'s own scraped page as own_site', () => {
    const content = `--- PAGE: / (https://example.com) ---\n\nAcme Industries operates six manufacturing facilities across the region, serving customers worldwide.\n`
    const result = extractSignals(content, undefined, 'Acme Industries')
    const signal = result.signals.find(s => s.type === 'multi_location_operations')
    expect(signal).toBeDefined()
    expect(signal!.evidence[0].origin).toBe('own_site')
  })

  it('tags evidence found in externally-fetched enriched content (press_release) as news', () => {
    const websiteContent = `--- PAGE: / (https://example.com) ---\n\nWelcome to Acme Industries.\n`
    const enrichedContent = `[SOURCE: press_release | tier2 | https://reuters.com/acme-expansion]\nAcme Industries operates six manufacturing facilities across the region, serving customers worldwide.\n`
    const result = extractSignals(websiteContent, enrichedContent, 'Acme Industries')
    const signal = result.signals.find(s => s.type === 'multi_location_operations')
    expect(signal).toBeDefined()
    const externalEvidence = signal!.evidence.find(e => e.source_url === 'https://reuters.com/acme-expansion')
    expect(externalEvidence).toBeDefined()
    expect(externalEvidence!.origin).toBe('news')
  })

  it('tags evidence found in an enriched annual_report block as filing', () => {
    const websiteContent = `--- PAGE: / (https://example.com) ---\n\nWelcome to Acme Industries.\n`
    const enrichedContent = `[SOURCE: annual_report | tier1 | https://acme.com/investors/annual-report.pdf]\nAcme Industries operates six manufacturing facilities across the region, serving customers worldwide.\n`
    const result = extractSignals(websiteContent, enrichedContent, 'Acme Industries')
    const signal = result.signals.find(s => s.type === 'multi_location_operations')
    const externalEvidence = signal!.evidence.find(e => e.source_url.includes('annual-report.pdf'))
    expect(externalEvidence).toBeDefined()
    expect(externalEvidence!.origin).toBe('filing')
  })

  it('tags job-posting workflow evidence found on the company\'s OWN careers page as own_site, not job_posting', () => {
    // Design note: `origin` encodes WHICH PIPELINE produced the content
    // (own scraped site vs. web-enricher's externally-fetched content) —
    // not a topical re-classification of page type. The company's own
    // careers page is still company-owned content, same as its homepage;
    // `job_posting` is reserved for job-posting content independently
    // discovered/fetched externally (web-enricher's careers_page source
    // type). See the next test for that case.
    const websiteContent =
      `--- PAGE: /careers (https://example.com/careers) ---\n\n` +
      `Key Responsibilities: manage vendor onboarding, reconcile inventory across six manufacturing facilities, and coordinate with regional teams.\n`
    const result = extractSignals(websiteContent, undefined, 'Acme Industries')
    const jobEvidence = result.signals
      .flatMap(s => s.evidence)
      .find(e => e.signal_type === 'internal_workflow_description')
    expect(jobEvidence).toBeDefined()
    expect(jobEvidence!.origin).toBe('own_site')
  })

  it('tags job-posting content independently discovered/fetched externally as job_posting', () => {
    const websiteContent = `--- PAGE: / (https://example.com) ---\n\nWelcome to Acme Industries.\n`
    const enrichedContent =
      `[SOURCE: careers_page | tier2 | https://boards.greenhouse.io/acme/jobs/1]\n\n` +
      `Key Responsibilities: manage vendor onboarding, reconcile inventory across six manufacturing facilities, and coordinate with regional teams.\n`
    const result = extractSignals(websiteContent, enrichedContent, 'Acme Industries')
    const jobEvidence = result.signals
      .flatMap(s => s.evidence)
      .find(e => e.signal_type === 'internal_workflow_description')
    expect(jobEvidence).toBeDefined()
    expect(jobEvidence!.origin).toBe('job_posting')
  })
})

describe('detectServiceEvidence — ServiceEvidenceMatch.origin propagation', () => {
  const { profile } = buildCompanyProfile('')

  it('tags a regex match found on the company\'s own site as own_site', () => {
    const content = `--- PAGE: / (https://example.com) ---\n\nOur team manually reviews and prioritizes every lead before it reaches sales.\n`
    const results = detectServiceEvidence(content, profile, false)
    const aiApps = results.find(r => r.service === 'AI-powered business applications')
    expect(aiApps?.threshold).toBe('strong')
    expect(aiApps?.evidence[0]?.origin).toBe('own_site')
  })

  it('tags a regex match found in externally-fetched content as its source type', () => {
    const content = `[SOURCE: news_article | tier2 | https://economictimes.com/acme]\nOur team manually reviews and prioritizes every lead before it reaches sales.\n`
    const results = detectServiceEvidence(content, profile, false)
    const aiApps = results.find(r => r.service === 'AI-powered business applications')
    expect(aiApps?.threshold).toBe('strong')
    expect(aiApps?.evidence[0]?.origin).toBe('news')
  })

  it('honestly tags CompanyProfile.operations-derived evidence (no content position to trace) as unknown', () => {
    const richProfile = buildCompanyProfile('We operate six manufacturing facilities across three countries.').profile
    const content = 'monthly reports are compiled by hand across all sites.'
    const results = detectServiceEvidence(content, richProfile, false)
    const internalOps = results.find(r => r.service === 'Internal operational software')
    const facilityEvidence = internalOps?.evidence.find(e => e.pattern === 'manufacturing_plants_count')
    expect(facilityEvidence).toBeDefined()
    expect(facilityEvidence!.origin).toBe('unknown')
  })
})

describe('generateDeterministicOpportunities — DeterministicOpportunity.evidence_origin', () => {
  const { profile } = buildCompanyProfile('')

  it('reflects own_site when the strongest matched evidence is on the company\'s own page', () => {
    const content = `--- PAGE: / (https://example.com) ---\n\nOur team manually reviews and prioritizes every lead before it reaches sales.\n`
    const opps = generateDeterministicOpportunities(content, profile, false)
    const aiApps = opps.find(o => o.title === 'AI-powered business applications')
    expect(aiApps).toBeDefined()
    expect(aiApps!.evidence_origin).toBe('own_site')
  })

  it('reflects the external source type when the strongest matched evidence is externally sourced', () => {
    const content = `[SOURCE: press_release | tier2 | https://reuters.com/acme]\nOur team manually reviews and prioritizes every lead before it reaches sales.\n`
    const opps = generateDeterministicOpportunities(content, profile, false)
    const aiApps = opps.find(o => o.title === 'AI-powered business applications')
    expect(aiApps).toBeDefined()
    expect(aiApps!.evidence_origin).toBe('news')
  })

  it('non-regression: opportunity gating (threshold/relevance/priority) is unaffected by origin tagging', () => {
    const content = `--- PAGE: / (https://example.com) ---\n\nOur team manually reviews and prioritizes every lead before it reaches sales.\n`
    const opps = generateDeterministicOpportunities(content, profile, false)
    const aiApps = opps.find(o => o.title === 'AI-powered business applications')
    expect(aiApps?.threshold).toBe('strong')
    expect(aiApps?.relevance).toBe('High')
    expect(aiApps?.priority).toBe(90)
  })
})

describe('normalizeAnalysisResult — evidence_origin on the final opportunities[] (end to end)', () => {
  it('a deterministic opportunity carries evidence_origin own_site through the full merge', () => {
    const content = `--- PAGE: / (https://example.com) ---\n\nOur team manually reviews and prioritizes every lead before it reaches sales.\n`
    const result = normalizeAnalysisResult({
      company_name: 'Test Co',
      _service_evidence_content: content,
      _extractor: {
        companySubjectCount: 1,
        signals: [{ signal: 'x' }],
        leadershipContacts: [],
        websitePreview: 'Our team manually reviews and prioritizes every lead before it reaches sales.',
      },
      ai_opportunities: [],
    })
    const opp = result.opportunities.find(o => o.title === 'AI-powered business applications')
    expect(opp).toBeDefined()
    expect(opp?.source).toBe('deterministic')
    expect(opp?.evidence_origin).toBe('own_site')
  })

  it('a deterministic opportunity carries a non-own_site evidence_origin when its evidence is externally sourced', () => {
    const content = `[SOURCE: press_release | tier2 | https://reuters.com/acme]\nOur team manually reviews and prioritizes every lead before it reaches sales.\n`
    const result = normalizeAnalysisResult({
      company_name: 'Test Co',
      _service_evidence_content: content,
      _extractor: {
        companySubjectCount: 1,
        signals: [{ signal: 'x' }],
        leadershipContacts: [],
        websitePreview: 'Our team manually reviews and prioritizes every lead before it reaches sales.',
      },
      ai_opportunities: [],
    })
    const opp = result.opportunities.find(o => o.title === 'AI-powered business applications')
    expect(opp).toBeDefined()
    expect(opp?.evidence_origin).toBe('news')
  })

  it('an llm_inferred opportunity (no verbatim quote to trace) is honestly tagged unknown, never guessed', () => {
    const result = normalizeAnalysisResult({
      company_name: 'Test Co',
      _extractor: {
        companySubjectCount: 3,
        signals: [{ signal: 'growth' }],
        leadershipContacts: [],
        websitePreview: 'Some real website content about the company.',
      },
      ai_opportunities: [{
        title: 'Integrating new systems',
        service_line: 'Workflow automation systems',
        claim_type: 'inferred',
        evidence: '',
        inferred_from: 'a genuinely substantive stated reasoning basis here',
        confidence: 'medium',
        description: 'x',
      }],
    })
    const opp = result.opportunities.find(o => o.service_line === 'Workflow automation systems')
    expect(opp?.source).toBe('llm_inferred')
    expect(opp?.evidence_origin).toBe('unknown')
  })
})
