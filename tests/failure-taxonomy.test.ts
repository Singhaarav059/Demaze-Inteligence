// ============================================================
// Failure Taxonomy (Production Hardening Master Plan, Step 6.5)
// ============================================================
// First unit-test coverage for anything under benchmarks/ — that directory
// had zero tests before this file. Pure function, no network/fs — feeds
// synthetic gate/check arrays and asserts the categorized output.

import { describe, it, expect } from 'vitest'
import { categorizeFailures, type GateLike, type CheckLike } from '../benchmarks/failure-taxonomy'

describe('categorizeFailures', () => {
  it('returns an empty list when every gate and check passes', () => {
    const gates: GateLike[] = [
      { stage: 'SCRAPE', status: 'PASS' },
      { stage: 'PROFILE', status: 'PASS' },
    ]
    const checks: CheckLike[] = [
      { check: 'pipeline_success', status: 'PASS' },
      { check: 'min_signals', status: 'PASS' },
    ]
    expect(categorizeFailures(gates, checks)).toEqual([])
  })

  it('maps SCRAPE + SOURCE_FAILURE to RETRIEVAL_FAILURE', () => {
    const gates: GateLike[] = [
      { stage: 'SCRAPE', status: 'WARN', reasonCode: 'SOURCE_FAILURE', reason: 'no usable content' },
    ]
    expect(categorizeFailures(gates, [])).toEqual(['RETRIEVAL_FAILURE'])
  })

  it('maps SCRAPE_RELEVANCE + NO_RELEVANT_CONTENT to RELEVANCE_FAILURE', () => {
    const gates: GateLike[] = [
      { stage: 'SCRAPE_RELEVANCE', status: 'WARN', reasonCode: 'NO_RELEVANT_CONTENT' },
    ]
    expect(categorizeFailures(gates, [])).toEqual(['RELEVANCE_FAILURE'])
  })

  it('maps SCRAPE_RELEVANCE + IDENTITY_MISMATCH to IDENTITY_FAILURE (not the stage-relevance default)', () => {
    const gates: GateLike[] = [
      { stage: 'SCRAPE_RELEVANCE', status: 'WARN', reasonCode: 'IDENTITY_MISMATCH' },
    ]
    expect(categorizeFailures(gates, [])).toEqual(['IDENTITY_FAILURE'])
  })

  it('maps PROFILE/SIGNAL + NO_EVIDENCE to EVIDENCE_FAILURE', () => {
    const gates: GateLike[] = [
      { stage: 'PROFILE', status: 'PARTIAL', reasonCode: 'NO_EVIDENCE' },
      { stage: 'SIGNAL', status: 'WARN', reasonCode: 'NO_EVIDENCE' },
    ]
    expect(categorizeFailures(gates, [])).toEqual(['EVIDENCE_FAILURE'])
  })

  it('maps PROFILE + LOW_CONFIDENCE to CLASSIFICATION_FAILURE, not the stage default', () => {
    const gates: GateLike[] = [
      { stage: 'PROFILE', status: 'WARN', reasonCode: 'LOW_CONFIDENCE' },
    ]
    expect(categorizeFailures(gates, [])).toEqual(['CLASSIFICATION_FAILURE'])
  })

  it('maps NORMALIZATION + PARSER_FAILURE to EXTRACTION_FAILURE', () => {
    const gates: GateLike[] = [
      { stage: 'NORMALIZATION', status: 'WARN', reasonCode: 'PARSER_FAILURE' },
    ]
    expect(categorizeFailures(gates, [])).toEqual(['EXTRACTION_FAILURE'])
  })

  it('maps LLM_PARSE with no reasonCode (generic "no output" WARN) to EXTRACTION_FAILURE via stage fallback', () => {
    const gates: GateLike[] = [
      { stage: 'LLM_PARSE', status: 'WARN', reason: 'LLM produced no pain_points or ai_opportunities' },
    ]
    expect(categorizeFailures(gates, [])).toEqual(['EXTRACTION_FAILURE'])
  })

  it('maps BUSINESS_PROFILE + PROVIDER_FAILURE (timeout) to EXTERNAL_PROVIDER_FAILURE', () => {
    const gates: GateLike[] = [
      { stage: 'BUSINESS_PROFILE', status: 'WARN', reasonCode: 'PROVIDER_FAILURE' },
    ]
    expect(categorizeFailures(gates, [])).toEqual(['EXTERNAL_PROVIDER_FAILURE'])
  })

  it('overrides COMPETITOR to MATCH_FAILURE regardless of the NO_EVIDENCE reasonCode actually attached', () => {
    const gates: GateLike[] = [
      { stage: 'COMPETITOR', status: 'WARN', reasonCode: 'NO_EVIDENCE' },
    ]
    expect(categorizeFailures(gates, [])).toEqual(['MATCH_FAILURE'])
  })

  it('overrides ICP to ICP_FAILURE regardless of the NO_EVIDENCE reasonCode actually attached', () => {
    const gates: GateLike[] = [
      { stage: 'ICP', status: 'WARN', reasonCode: 'NO_EVIDENCE' },
    ]
    expect(categorizeFailures(gates, [])).toEqual(['ICP_FAILURE'])
  })

  it('maps MARKET_INTEL + NO_EVIDENCE to EVIDENCE_FAILURE (no stage override, unlike COMPETITOR/ICP)', () => {
    const gates: GateLike[] = [
      { stage: 'MARKET_INTEL', status: 'WARN', reasonCode: 'NO_EVIDENCE' },
    ]
    expect(categorizeFailures(gates, [])).toEqual(['EVIDENCE_FAILURE'])
  })

  it('maps a failed profile_flag: check to CLASSIFICATION_FAILURE', () => {
    const checks: CheckLike[] = [{ check: 'profile_flag:manufacturer', status: 'FAIL' }]
    expect(categorizeFailures([], checks)).toEqual(['CLASSIFICATION_FAILURE'])
  })

  it('maps a failed primary_type check to CLASSIFICATION_FAILURE', () => {
    const checks: CheckLike[] = [{ check: 'primary_type', status: 'FAIL' }]
    expect(categorizeFailures([], checks)).toEqual(['CLASSIFICATION_FAILURE'])
  })

  it('maps a failed no_forbidden: check to QA_FAILURE', () => {
    const checks: CheckLike[] = [{ check: 'no_forbidden:"saas"', status: 'FAIL' }]
    expect(categorizeFailures([], checks)).toEqual(['QA_FAILURE'])
  })

  it('maps min_signals/min_opportunities/min_challenges WARNs to EVIDENCE_FAILURE', () => {
    const checks: CheckLike[] = [
      { check: 'min_signals', status: 'WARN' },
      { check: 'min_opportunities', status: 'WARN' },
      { check: 'min_challenges', status: 'WARN' },
    ]
    expect(categorizeFailures([], checks)).toEqual(['EVIDENCE_FAILURE'])
  })

  it('categorizes a top-level network exception (no gates available at all) as RETRIEVAL_FAILURE', () => {
    expect(categorizeFailures([], [], 'fetch failed')).toEqual(['RETRIEVAL_FAILURE'])
    expect(categorizeFailures([], [], 'request to http://localhost:3000 failed, reason: ECONNREFUSED')).toEqual(['RETRIEVAL_FAILURE'])
  })

  it('categorizes a top-level AI-provider-shaped error as EXTERNAL_PROVIDER_FAILURE', () => {
    expect(categorizeFailures([], [], 'All AI providers failed: nvidia timeout')).toEqual(['EXTERNAL_PROVIDER_FAILURE'])
  })

  it('deduplicates and sorts when multiple gates/checks map to the same or different categories', () => {
    const gates: GateLike[] = [
      { stage: 'SIGNAL', status: 'WARN', reasonCode: 'NO_EVIDENCE' },
      { stage: 'PROFILE', status: 'WARN', reasonCode: 'NO_EVIDENCE' }, // same category, should dedupe
    ]
    const checks: CheckLike[] = [{ check: 'primary_type', status: 'FAIL' }]
    expect(categorizeFailures(gates, checks)).toEqual(['CLASSIFICATION_FAILURE', 'EVIDENCE_FAILURE'])
  })

  it('a WARN gate with no matching stage and no reasonCode falls back to EXTRACTION_FAILURE', () => {
    const gates: GateLike[] = [{ stage: 'SOME_FUTURE_STAGE', status: 'WARN' }]
    expect(categorizeFailures(gates, [])).toEqual(['EXTRACTION_FAILURE'])
  })

  it('ignores a PASS check even when other checks fail', () => {
    const checks: CheckLike[] = [
      { check: 'pipeline_success', status: 'PASS' },
      { check: 'primary_type', status: 'FAIL' },
    ]
    expect(categorizeFailures([], checks)).toEqual(['CLASSIFICATION_FAILURE'])
  })

  it('reproduces a real multi-failure shape: bad scrape + thin evidence + wrong classification', () => {
    const gates: GateLike[] = [
      { stage: 'SCRAPE', status: 'WARN', reasonCode: 'SOURCE_FAILURE' },
      { stage: 'SIGNAL', status: 'WARN', reasonCode: 'NO_EVIDENCE' },
    ]
    const checks: CheckLike[] = [
      { check: 'min_signals', status: 'WARN' },
      { check: 'profile_flag:manufacturer', status: 'FAIL' },
    ]
    expect(categorizeFailures(gates, checks)).toEqual(['CLASSIFICATION_FAILURE', 'EVIDENCE_FAILURE', 'RETRIEVAL_FAILURE'])
  })
})
