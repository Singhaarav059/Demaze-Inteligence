# Evidence Ledger Audit (G2.1)

Date: 2026-08-18
Status: Read-only. No production behavior changed by this document.
Scope: `demaze_master_research_optimization_plan.md` §G2.1.

Builds on `docs/research-architecture-audit.md` (G0), specifically its §1.6
("evidence/provenance fields that already exist") and §1.5 (relevant DB
tables) — this document goes one level deeper: not just *what fields exist*
but *where each pipeline stage's evidence lives, whether it's persisted, and
what's broken about it*.

---

## Table

| Pipeline Stage | Current Evidence | Source URL | Snippet | Claim Type | Confidence | Persisted? | Problem |
|---|---|---|---|---|---|---|---|
| **Signals** (`evidence-extractor.ts` `extractSignals`) | `SignalMatch[]` — pattern name + matched text | No — only implicit via which content pool matched | Yes (regex match window) | None | None (boolean presence) | Yes, `pipeline_test_runs.final_result` (JSONB) | No source URL at all; a signal from page 3 of 15 scraped pages is indistinguishable from one on the homepage. |
| **Company Profile evidence** (`evidence-extractor.ts` `buildCompanyProfile`, `companyProfileEvidence`) | `{pattern, matched, snippet}[]` per profile flag | No | Yes | None | None | Yes (debug-only, `extractorResult.companyProfileEvidence`) | Same as signals — snippet with zero URL/date attribution. |
| **LLM-authored `evidence[]`** (`normalize.ts` `EvidenceItem`, `flat.evidence`) | `{id, subject, tier, category, quote, source_page}` | `source_page` is a **free-text string the LLM itself supplies** — never verified against real content | LLM-authored `quote`, **never quote-verified** (no `verifyQuoteInContent` call anywhere in its path) | None | None | Yes, feeds `detected_factors` derivation only | **The weakest evidence path in the whole pipeline** — this is the one place an LLM-invented quote and an LLM-invented "source page" can reach a persisted field with zero code-side verification. Confirmed by direct read of `deriveDetectedFactors()` (`normalize.ts:512-551`): only used to flip `detected_factors` booleans (growth_signal, hiring_signal, etc.), not opportunities/pain-points — real but narrow blast radius. |
| **Service Evidence** (`service-evidence.ts` `ServiceEvidenceMatch`) | `{pattern, matched, snippet}` per one of 8 confirmed services | No | Yes | None (implicit: `threshold` tier none/weak/medium/strong) | Threshold tier acts as a de facto confidence | Yes (`_service_evidence_debug`, debug-only) | Deterministic and reliable (regex against real shown content), but zero source URL or date — can't tell whether the matched text came from the homepage or a 2019-dated press release. |
| **Pain Points** (`normalize.ts` `StructuredPainPoint`) | `{title, confidence, evidence_id, evidence, reasoning, claim_type}` | No | Yes — `evidence` is the LLM's quote | `'observed'` (quote-verified via `isQuoteGrounded`) or `'inferred'` (no verification required) | `confidence: high/medium/low` (LLM-supplied, not code-derived) | Yes | `'observed'` claims ARE genuinely quote-verified against real content the LLM saw (`llmContentPool`) — the strongest-grounded claim path in the repo — but still carries no source URL, no publish date, no source-authority tier. `evidence_id` is code-derived (`stableEvidenceId`) only for observed claims; `confidence` is still LLM self-reported, never derived from source tier. |
| **Opportunities — Path A (deterministic)** (`normalize.ts` `opportunitiesFromDeterministic`) | `DeterministicOpportunity` from `opportunity-engine.ts`/`service-evidence.ts` regex catalog | No | Via `service-evidence.ts` snippet | Implicit `'deterministic'` (code-matched, not claimed by LLM) | `relevance: High/Medium/Low` (catalog-assigned) | Yes | Strongest-grounded opportunity path (regex against real content, code-owned title/entry_point) but still no URL/date. |
| **Opportunities — Path B1 (`llm_verified`)** (`normalize.ts:1044-1050`) | LLM-proposed opportunity, `claim_type: 'observed'`, quote-verified via `verifyQuoteInContent` against `llmContentPool` | No | Yes — `l.evidence`, genuinely verified | `'observed'` | `relevance: Medium` (exact match) or `Low` (fuzzy match) | Yes | Same gap as pain points — genuinely quote-verified, zero URL/date attribution. `evidenceId` is code-derived (`stableEvidenceId('opp', ...)`, `normalize.ts:1008-1010`) only here, not trusted from the LLM. |
| **Opportunities — Path B2 (`llm_inferred`)** (`normalize.ts:1068-1071`) | LLM-proposed opportunity, `claim_type: 'inferred'`, gated only on `inferred_from` being ≥15 real chars | No | No quote required by design | `'inferred'` | `relevance: Low` (fixed) | Yes | Weakest opportunity path by design (reasoning, not evidence) — correctly labeled `'llm_inferred'` and capped at `Low` relevance, but there's no third `'hypothesis'` tier below this for genuinely speculative content; everything that isn't `'observed'` collapses into `'inferred'`. |
| **Competitors** (`competitor-discovery.ts` `CompetitorProfile`) | `{name, source: 'search'\|'ai_knowledge'\|'search_synthesis', source_urls, confidence}` | **Yes** for `'search'`/`'search_synthesis'` (real URLs from Tavily/Serper or search-synthesis quote attribution); **no** for `'ai_knowledge'` (nothing to cite, by design) | Yes for `search_synthesis` (quote-verified via `verifyQuoteInContent`, same mechanism as opportunities) | Implicit via `source` field | `confidence: high/medium/low`, mapped from `well_known`(knowledge)/mention-count+framing(search) | Yes | **The best-provenance path in the entire pipeline** — real URLs, real quote verification for the synthesis path. Still missing: publish date, explicit source-authority tier (a Crunchbase mention and a company's own press release both just say `source: 'search'`), no content hash. |
| **ICP Segments** (`icp-generator.ts` `ICPSegment`) | Same shape as Competitors | Same as Competitors | Same as Competitors | Same as Competitors | Same as Competitors | Yes | Identical strengths/gaps to Competitors — same code, same discipline. |
| **Market Intelligence** (`market-intelligence.ts` `MarketIntelItem`) | `{statement, category, confidence, source_url?}` | Partial — has a `source_url` field, populated from the search result that produced it | Implicit (statement is the extracted text) | None (growth_indicator/challenge/trend/shift category, not fact/inference) | `confidence: high/medium/low` from mention count | Yes | Has the best raw ingredient (a real source URL) of any evidence type in the pipeline, but no publish date and no fact/inference distinction — a market statement is presented as flatly true regardless of source authority. |
| **Decision-maker grounding** (`lib/outbound/decision-maker-discovery/grounding.ts`) | `{status: confirmed\|conflict\|not_found, reason}` per candidate, computed against the company's own scraped `leadershipContacts` | N/A (identity-matching, not a content claim) | N/A | N/A | Implicit via `status` | **Two persistence paths, different fates**: (1) `outbound_decision_maker_searches` (migration 015) — UI-remount cache only, keyed by `source_run_id`, overwritten every search, nothing downstream reads it. (2) `outbound_contacts.discovery_grounding_status`/`discovery_grounding_reason` (migration 023) — the real one; read by `send-eligibility.ts`'s `checkCompanyIdentity()` and **blocks a send on `'conflict'`**. | This is the one place in the pipeline where "evidence" (leadership-page scrape content) actively gates a real action (blocking a send) — but the grounding status never reaches the LLM (`assemble-input.ts` never reads it) and is a boolean gate, not a scored EvidenceItem. |
| **Generated email claims** (`lib/outbound/generation/assemble-input.ts`, `prompts.ts`) | `claimType: 'observed'\|'inferred'` threaded from pain points/opportunities onto `EmailGenerationInput` | Not carried (only the pain point/opportunity text + claim type, no URL) | The pain-point/opportunity text itself, not the original quote | Survives as a literal `"(unconfirmed inference)"` tag in the rendered prompt (`prompts.ts:17-29`), with an explicit hedging-language rule in `COMMON_RULES` | Not explicitly scored; the hedging instruction is the confidence signal | The final email + its `claimGroundingCheck` result persist on the generated-content row | **Real, working propagation** — this is the one place SOURCE→EVIDENCE→SIGNAL→PAIN POINT→OPPORTUNITY→PERSONALIZATION→EMAIL (plan §G2.10) is genuinely intact end to end, confirmed by direct code read, not assumed. Gap: only the structured pain-point/opportunity path carries `claimType`; the flat-string fallback path (used whenever `pain_points_structured` is empty) carries no claim type and renders as unqualified prose. |
| **Unsupported numeric-claim check** (`lib/outbound/generation/claim-grounding.ts`, "Phase B, safety policy B5") | Deterministic post-hoc check: every number in a company-referencing sentence of the generated email must appear somewhere in the evidence text shown to the LLM | N/A (validates the email, not a claim object) | N/A | N/A | Binary `hasUnsupportedClaim` | Computed at generation time, stored as `claimGroundingCheck` on the draft; **blocks the send with no override** (`campaign-review.ts`, the actual send route) | Real, working, and already blocking — this is genuine "unsupported-claim check" the plan asks about. Known, documented limitation: substring (not word-boundary) number matching, a deliberate under-confidence tradeoff. |
| **Contradiction detection** | — | — | — | — | — | — | **Confirmed absent**, same finding as G0 — zero code anywhere compares two evidence items for factual disagreement. The only "conflict" concept in the codebase is name-collision dedup (competitors/ICP merge-by-name) and the decision-maker `'conflict'` status above, which is an identity mismatch, not a factual contradiction between two claims. |
| **Freshness / publish dates** | — | — | — | — | — | — | **Confirmed absent** for scraped/search-derived evidence. The only place a real publish date is ever available is EDGAR filings (`fetchEdgarFilings`, has real `filingDate`) and, weakly, `MarketIntelItem` when the underlying search snippet happened to include one — neither is currently extracted into a structured `publishedAt` field anywhere. |
| **Source authority (first-party vs. regulatory vs. third-party vs. weak)** | — | — | — | — | — | — | **Confirmed absent as an explicit axis** — `SourceType`/`EvidenceStrength`/`priority_score` (`discovery-engine.ts`, `source-prioritizer.ts`) conflate document-genre with authority (see G0 §1.6): `regulatory_filing` (externally filed, audited) and `annual_report` (self-published) both score `very_high`/tier1 with nothing distinguishing them. |

---

## Summary of the propagation chain (plan §G2.10)

```
SOURCE → EVIDENCE → SIGNAL → PAIN POINT → OPPORTUNITY → PERSONALIZATION → EMAIL
```

Traced end to end, with exact status per link:

1. **SOURCE → EVIDENCE**: real for competitors/ICP (`source_urls`), real for market intelligence (`source_url`), **absent** for pain points/opportunities (a quote is verified against content, but the URL the content came from is never captured — even though the content itself carries `--- PAGE: /path (url) ---` / `[SOURCE: type | tier | url]` headers that `evidence-extractor.ts`'s `parseContentSegments()` already knows how to parse; this parser is simply never consulted a second time downstream in `normalize.ts` to attribute a specific quote back to its URL).
2. **EVIDENCE → SIGNAL**: real (`SIGNAL_PATTERNS` regex matches carry a snippet, feed `detected_factors`).
3. **SIGNAL/EVIDENCE → PAIN POINT / OPPORTUNITY**: real and quote-verified for `'observed'` claims (the strongest link in the whole chain); real but unverified-by-design for `'inferred'` claims.
4. **PAIN POINT/OPPORTUNITY → PERSONALIZATION (email generation input)**: real — `claim_type` survives via `assemble-input.ts` into `EmailGenerationInput`.
5. **PERSONALIZATION → EMAIL**: real — `claimType` becomes a literal `"(unconfirmed inference)"` prompt tag with an explicit hedging-language rule (`prompts.ts`), and `claim-grounding.ts`'s numeric-claim check blocks a send with an unsupported number.

**Net finding**: link 3-5 (pain-point/opportunity → email) is the healthiest part of the chain — genuinely working, not something G2 needs to rebuild. **Link 1 (source → evidence) is the real gap** — every downstream claim can already answer "is this a fact or an inference" but almost none can answer "what URL, what date, how authoritative is that source" — exactly the plan's 12 questions in its opening section, items 3-8.

## What G2 should build on vs. leave alone

**Reuse as-is, do not touch**:
- `quote-verification.ts` (`verifyQuoteInContent`/`isQuoteGrounded`) — already does exactly what a "search-snippet alone is not proof" gate needs.
- `claim-grounding.ts` (B5 numeric-claim check) and `prompts.ts`'s hedging-language rule — already enforce plan §G2.11's core requirement; must not be weakened.
- `send-eligibility.ts`'s use of `discovery_grounding_status` — already blocks a send on identity conflict.
- `evidence-extractor.ts`'s `parseContentSegments()` — already parses exactly the URL/source-type metadata G2 needs to attribute a quote to a source; currently private to that file.

**Extend, don't replace**:
- `normalize.ts`'s existing `EvidenceItem` interface — the natural home for the new canonical fields (see `docs/evidence-ledger-design.md`), since it already has `id`/`subject`/`tier`/`category`/`quote`/`source_page`.
- `claim_type: 'observed' | 'inferred'` — already the semantic equivalent of confirmed_fact/reasonable_inference; extend rather than introduce a second, differently-named vocabulary.
- `SourceType` (`discovery-engine.ts`) — reuse as the input to a new, separate `sourceAuthority` classifier rather than redesigning the enum itself.

**Genuinely new, does not exist anywhere today**:
- Source-URL attribution for pain-point/opportunity quotes.
- An explicit `sourceAuthority` axis, separate from `SourceType`/`EvidenceStrength`.
- Freshness classification from a real (not invented) publish date.
- Contradiction detection between two evidence items.
- Company-identity confidence attached to an individual evidence item (as opposed to the company-level identity-resolution work already done in `website-discovery.ts`).
