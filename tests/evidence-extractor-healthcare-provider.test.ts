// ============================================================
// Evidence Extractor — buildCompanyProfile() healthcare_provider detection
// + the third-person individual-narrative guard (AITG audit fix)
// ============================================================
// Root cause: captureFlag() (backs every company_type detector) had no
// protection against a founder/executive's personal biography being
// mistaken for the company's own self-description. Real false positive on
// aitg.co/about.html: "...Nanasaheb chanced upon many imported hospital
// equipment lying unused due to failure. He offered to repair the
// equipment..." — the founder's 1957-era personal origin story, not AITG's
// current business (AITG today is an auto-components conglomerate).
//
// isReaderOrCustomerDescribed() (evidence-extractor.ts) gained one more
// clause: a third-person singular pronoun (he/his/him/she/her) with no
// company-collective self-reference (we/our/the company/the group/the
// firm) anywhere in the same sentence rejects the match. This generalizes
// to every company_type category, not just healthcare_provider, and not
// just AITG — these tests cover the real AITG snippets, the guard clause
// in isolation on a neutral category, and non-regression for genuine
// healthcare_provider self-description.
// ============================================================

import { describe, it, expect } from 'vitest'
import { buildCompanyProfile } from '../lib/pipeline/evidence-extractor'

describe('buildCompanyProfile — healthcare_provider false positives (AITG audit fix)', () => {
  it('does NOT set healthcare_provider from the real AITG founder-anecdote snippet (aitg.co/about.html, verbatim)', () => {
    const content = `The journey began in 1957. Neelkanth Gopal alias Nanasaheb Bhogale started a trading firm in partnership with his elder brother in Mumbai. They dealt in audio equipment and chemicals needed in educational institutes and hospitals. While visiting hospitals in Mumbai in course of his trading business, Nanasaheb chanced upon many imported hospital equipment lying unused due to failure. He offered to repair the equipment for a small fee.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.healthcare_provider).toBe(false)
  })

  it('does NOT set healthcare_provider from the real AITG scrape, verbatim including its actual hard line-wrapping', () => {
    // The real pipeline's scraped content (pulled directly from the running
    // API, not the browser-rendered page) hard-wraps this sentence across
    // multiple lines at an arbitrary column width — this is what actually
    // defeated the fix on the first attempt: sentenceWindow() originally
    // treated every bare '\n' as a sentence boundary, which cut "his" out
    // of the guard's window even though it's the same sentence as the
    // match. This test locks in the SENTENCE_BOUNDARY fix (paragraph break
    // or '.'/'!'/'?', not a bare line-wrap).
    const content = `Nanasaheb Bhogale started a trading firm in partnership\nwith his elder brother Vishnu Gopal alias Bhausaheb\nBhogale in Mumbai. They dealt in audio equipment and\nchemicals needed in educational institutes and\nhospitals. While visiting hospitals in Mumbai in course\nof his trading business, Nanasaheb chanced upon many\nimported hospital equipment lying unused due to failure.\nHe offered to repair the equipment for a small fee.\nSince imports of new equipment were difficult, the\nhospitals were happy to avail of this offer.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.healthcare_provider).toBe(false)
  })

  it('does NOT set healthcare_provider from the real AITG chairman-bio snippet (second instance on the same real page)', () => {
    const content = `Ramchandra Neelkanth Bhogale is a Mechanical Engineer with the business experience of 38 years. He has worked extensively in the field of Engineering, Finance and Banking, Hospital and Health care industry management. Ram has also chaired the trust of a banking institute and also a hospital.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.healthcare_provider).toBe(false)
  })

  it('still correctly classifies AITG as a manufacturer despite both founder/chairman bio mentions', () => {
    const content = `AITG is a conglomerate of 7 companies operating six manufacturing facilities that produce critical auto components. While visiting hospitals in Mumbai in course of his trading business, Nanasaheb chanced upon many imported hospital equipment lying unused due to failure. He offered to repair the equipment for a small fee.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.manufacturer).toBe(true)
    expect(profile.company_type.healthcare_provider).toBe(false)
    expect(profile.primary_type).toBe('manufacturer')
  })

  // ── Non-regression: genuine first-party healthcare_provider evidence ──
  it('still matches a genuine first-person healthcare_provider description', () => {
    const content = `We operate a network of diagnostic centers and hospitals across the region, providing quality healthcare services to over 50,000 patients annually.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.healthcare_provider).toBe(true)
  })

  it('still matches a genuine third-person self-description anchored by "our"', () => {
    const content = `Our hospital equipment manufacturing division has served leading medical institutions for over three decades.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.healthcare_provider).toBe(true)
  })

  it('still rejects a customer/partner-style healthcare mention (continuity with the existing guard)', () => {
    const content = `Our customers include hospital equipment manufacturers and diagnostic labs across South Asia.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.healthcare_provider).toBe(false)
  })
})

describe('isReaderOrCustomerDescribed — third-person individual-narrative guard, tested in isolation on a neutral category', () => {
  it('rejects a match inside a third-person individual narrative with no company anchor (generalizes beyond healthcare_provider)', () => {
    const content = `He started the workshop that later became a welding equipment supplier for the regional automotive industry.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.industrial_vendor).toBe(false)
  })

  it('still matches when a company anchor ("the company") is present in the same sentence as the pronoun', () => {
    const content = `He started the workshop that later became the company's welding equipment supplier business.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.industrial_vendor).toBe(true)
  })

  it('still matches genuine collective self-description with no pronoun at all', () => {
    const content = `The company manufactures welding equipment and automation solutions for industrial clients worldwide.`
    const { profile } = buildCompanyProfile(content)
    expect(profile.company_type.industrial_vendor).toBe(true)
  })
})
