// ============================================================
// service-evidence.ts — Ecommerce ecosystems commerce-context requirement
// ============================================================
// 2026-08-27 fix: the medium tier used to match a bare marketplace-brand
// name ("amazon"/"flipkart"/"myntra"/"nykaa") anywhere in the blended
// content pool, with no requirement that the surrounding text actually
// describes the company selling through it. Reproduced live on Bharat
// Forge — a heavy forgings/defense manufacturer, not a retailer — which
// surfaced "Ecommerce ecosystems" as its top, "Strong"-confidence
// opportunity off a single stray "Amazon" mention (plausibly AWS/cloud-
// hosting, or unrelated syndicated content). Now requires the brand mention
// to sit near real commerce-context vocabulary in the same clause.
// ============================================================

import { describe, it, expect } from 'vitest'
import { detectServiceEvidence } from '../lib/pipeline/service-evidence'
import { buildCompanyProfile } from '../lib/pipeline/evidence-extractor'

function detectEcommerce(content: string) {
  const { profile } = buildCompanyProfile(content)
  return detectServiceEvidence(content, profile, false).find(r => r.service === 'Ecommerce ecosystems')!
}

describe('detectServiceEvidence — Ecommerce ecosystems', () => {
  it('does not surface on a bare "Amazon" mention with no commerce context (the Bharat Forge false positive)', () => {
    const content = 'Our infrastructure is hosted on Amazon Web Services for reliability and global scale.'
    const result = detectEcommerce(content)
    expect(result.threshold).toBe('none')
  })

  it('still surfaces when a marketplace brand is genuinely described as a sales channel', () => {
    const content = 'We sell our products both on our own website and through Amazon, reaching customers across multiple channels.'
    const result = detectEcommerce(content)
    expect(result.threshold).toBe('medium')
  })

  it('still surfaces when the sales-channel phrasing precedes the brand name', () => {
    const content = 'Customers can shop our full catalogue on Flipkart in addition to our direct storefront.'
    const result = detectEcommerce(content)
    expect(result.threshold).toBe('medium')
  })

  it('still surfaces omnichannel language unrelated to the brand-name fix', () => {
    const content = 'Our omnichannel retail strategy connects in-store and online experiences seamlessly.'
    const result = detectEcommerce(content)
    expect(result.threshold).toBe('medium')
  })
})
