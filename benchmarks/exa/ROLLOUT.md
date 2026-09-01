# Capability-Based Provider Rollout — Exa / Prospeo / Explee

**Date:** 2026-09-01
**Source evidence:** [`benchmarks/exa/REPORT.md`](./REPORT.md) (the full benchmark). This document is the architecture decision built on top of that evidence, plus the implementation and live validation that followed it.

This is **not** "Exa for two things, Prospeo for two things." Each capability was routed to whichever provider the benchmark evidence actually supports, and several capabilities got new Demaze-owned logic (role classification, ranking, verification tiering, selective enrichment) that neither vendor provides on its own.

---

## 1. Capability matrix

| Capability | Primary | Fallback | Why |
|---|---|---|---|
| Company discovery | **Exa** | Explee (manual, via `COMPANY_DISCOVERY_PROVIDER=explee`) | Explee has reproducible geo leaks, cross-entity revenue duplication, ~9 wrong-domain results per 40, heavy internal duplication, and missed 8/9 known-real companies under its own relevance ranking. Exa found all 9 at #1. No automatic fallback — see §5. |
| Person discovery (decision-maker) | **Exa** | Prospeo (manual, via Integrations UI or `OUTBOUND_DECISION_MAKER_DISCOVERY_PROVIDER=prospeo`) | Exa found candidates for 10/10 companies under Demaze's own role vocabulary; Prospeo found candidates for 2/10 under the same input (its title filter is documented as literal, not semantic — confirmed real by retesting with Prospeo's own shorter default vocabulary, which recovered it to 8/10). |
| Role classification | **Demaze** (`classifyRoleCategory()`) | — | Not a provider capability at all — a deterministic, pure Demaze function, now applied as a presentation/ranking layer independent of discovery, so a correctly-found person is never dropped or mis-tiered just because their real title doesn't literally match a requested phrase. |
| Email finding | **Prospeo** | none (Exa not usable) | 13/18 found in the benchmark, 100% SMTP-verified. Exa's only path (Websets) is Pro-gated on this account — confirmed via direct API error, not assumed. |
| Email verification | **Demaze** (`email_confidence = 'verified'`, sourced only from Prospeo's real signal) | — | Verification is its own concept now, not folded into a generic confidence score. Only Prospeo's actual SMTP-verification match can produce `'verified'`; no other provider or heuristic can. |
| Contact enrichment | **Prospeo** (primary) + **Exa** (selective supplement) | — | Comparable factual accuracy, but Prospeo is 5-8x faster with cleaner structured output. Exa is called only when Prospeo's result is genuinely thin (all 3 core fields empty) — never both, every time. |
| Web search / evidence gathering | **Current pipeline** (Firecrawl + Tavily/Serper + LLM) | — | Not benchmarked this round (explicitly out of scope). Exa's Search/Contents/Answer look promising but unproven against the real 7-stage pipeline. |
| Deep research | **Current pipeline** | — | Not benchmarked. Do not implement an Exa replacement until Search+Contents+Answer are benchmarked against the current stack specifically (see §5, Remaining gaps). |
| Monitoring | **None** (doesn't exist) | — | Confirmed in the original Phase 0 audit — no monitoring/change-detection capability exists anywhere in Demaze today. Not built this round; Exa Monitors exists as an option for later, unevaluated. |

---

## 2. Architecture changes

### Company discovery
- `lib/enrichment/company-discovery-provider-factory.ts`: default (when `COMPANY_DISCOVERY_PROVIDER` is unset) flipped from `'explee'` to `'exa'`. `explee` remains fully functional and selectable.
- `lib/enrichment/sources/exa-company-discovery.ts`: added `applyDataQualityChecks()` — conservative, deterministic, **annotate-don't-drop** post-processing:
  - Exact-domain dedup and exact-normalized-name dedup (true duplicates, safe to drop) — reuses this codebase's existing `normalizeName()`/`normalizeDomain()` convention, no new normalization logic.
  - `generic_name` flag (e.g. a result literally named "e-Commerce" for an e-commerce query) — annotated via a new `dataQualityFlags?: string[]` field on `CompanyDiscoveryCompany`, never excluded from results.
  - `no_own_domain` flag (only URL is a platform host like `linkedin.com`) — same annotate-only treatment.
  - No relevance threshold, no scoring, no blacklist — exactly what the benchmark's own findings argued against repeating.

### Decision-maker discovery
- `lib/outbound/decision-maker-discovery/providers/exa.ts`: no longer drops a candidate whose title doesn't literally overlap a requested phrase — keeps them with their real title and an honest lower confidence instead.
- `lib/outbound/decision-maker-discovery/ranking.ts` (new): `rankCandidates()` — sorts by seniority tier (via the pre-existing, untouched `classifyRoleCategory()`), then LinkedIn-URL presence, then confidence. No numeric score invented.
- `lib/outbound/decision-maker-discovery/provider-factory.ts`: `rankCandidates()` applied uniformly to every provider's output (mock/Prospeo/Explee/Exa alike) at the same call site as the pre-existing `groundCandidates()` — same "shared post-processing, not per-provider" architectural pattern already established in this codebase.
- **Production DB flip**: `outbound_integrations` — `decision_maker_discovery` capability's active row switched from `prospeo` to `exa` (Prospeo's row deactivated, not deleted — its stored credential is untouched, one click/one query away from reactivating). `.env.example`'s `OUTBOUND_DECISION_MAKER_DISCOVERY_PROVIDER` fallback also updated to `exa` for consistency (only takes effect if Supabase is unreachable).

### Email verification
- `supabase/migrations/029_email_confidence_verified_tier.sql`: extended `outbound_contacts.email_confidence`'s CHECK constraint to add `'verified'` as a 5th, highest tier (`'verified' | 'high' | 'medium' | 'low' | 'none'`). Applied to the live DB.
- `lib/outbound/email-finder/types.ts`: `EmailFinderConfidence` widened to match.
- `lib/outbound/email-finder/providers/prospeo.ts`: a real SMTP-verification match now returns `'verified'` instead of `'high'`. This is the **only** code path in the entire codebase that can produce `'verified'`.
- `lib/outbound/shared/contact-update-guard.ts`: `shouldOverwriteEmail()`'s ranking extended so `'verified'` outranks everything — a verified email can never be silently downgraded by any provider's weaker result.
- A handful of UI/type call sites widened to handle the new tier using existing badge/color conventions — no new UI surface area added.

### Contact enrichment
- `app/api/admin/outbound/contacts/[id]/enrich/route.ts`: after the primary provider's result, checks if `department`/`seniority`/`location` are all empty ("thin"). Only then calls `ExaEnrichmentProvider.enrichContact()` directly as a one-time supplement (skipped entirely if Exa is already the active primary), merges with primary-fields-always-win semantics, and returns a new `enrichmentSources: string[]` field so the caller can see exactly which provider(s) contributed. Wrapped in try/catch — a failed supplement never breaks the primary result.

---

## 3. Provider flow (production, as of this rollout)

```
Company Discovery (Exa, primary)
  → dedup + data-quality flags (Demaze, deterministic)
  → [companies]
       ↓ user selects a company
Decision-Maker Discovery (Exa, primary)
  → role classification (Demaze: classifyRoleCategory)
  → seniority/LinkedIn/confidence ranking (Demaze: rankCandidates)
  → website grounding, if leadership was already scraped (Demaze: groundCandidates, pre-existing)
  → [ranked candidates]
       ↓ user selects a person
Email Finder (Prospeo, primary — only path that works)
  → SMTP verification signal → email_confidence = 'verified' (Demaze-owned tier, Prospeo-sourced only)
  → contact-update-guard: never downgrades an existing 'verified' email
       ↓
Contact Enrichment (Prospeo, primary)
  → thin? → Exa supplement (Demaze orchestration, one-time, merged, sources tracked)
  → contact-update-guard: never downgrades existing enrichment
       ↓
Demaze qualification / sector-playbook (unchanged, out of scope this round)
       ↓
Demaze personalization / outreach generation (unchanged, out of scope this round)
       ↓
Outreach (Gmail sending, unchanged)
```

Nothing about this flow is visible to the end user as "Exa" or "Prospeo" — the UI already only ever showed "Company details," "People," "Find decision makers," etc.; no new provider terminology was introduced anywhere in the product surface.

---

## 4. Cost implications

**Where this saves money:**
- Enrichment no longer risks becoming a double-call habit — the selective-supplement logic means Exa is only paid for when Prospeo's result is genuinely thin, not on every contact.
- Company discovery's per-query cost is small in absolute terms (~$0.007-0.04/query per the benchmark's real observed pricing) and buys materially cleaner data, which reduces downstream waste (fewer duplicate/garbage companies reaching decision-maker discovery and enrichment, which do cost real money per contact).
- Decision-maker discovery moving to Exa avoids Prospeo's biggest observed failure mode in this evidence set — a `NO_RESULTS` response under Demaze's real title vocabulary is a wasted call with zero return; Exa succeeding where Prospeo returns nothing is a direct cost-avoidance, not just a quality win.

**Where this may increase cost:**
- Exa decision-maker discovery costs more per call than Prospeo (~$0.047/call estimated vs. Prospeo's credit-based pricing, not obtained this session) — but it succeeds far more often under Demaze's actual vocabulary, so cost-per-successful-company-covered is the fairer comparison, and Exa wins there by a wide margin (Prospeo: 2/10 successes; Exa: 10/10).
- The selective enrichment supplement adds a small number of extra Answer-API calls (~$0.005 each) only for genuinely thin Prospeo results — bounded by design, not proportional to total contact volume.

**Still not knowable:** Prospeo's and Explee's dollar cost per credit were not obtained this session — every real $ figure in this document comes from Exa's own published pricing plus values actually observed in API responses. Not fabricated for the other two vendors.

---

## 5. Remaining gaps

- **Websets / Exa Pro**: still unverified. The only confirmed fact remains "Websets is Pro-gated on this account." No claim about whether Exa can or can't do email/bulk-list work at scale — that requires a separate Pro-tier evaluation, not assumed here.
- **Deep research / web evidence**: the 7-stage pipeline was explicitly out of scope this round and remains untouched. Before any replacement work starts, benchmark Current Demaze research vs. Exa Search+Contents vs. Exa Answer vs. Exa Agent (only where justified) on factual accuracy, source quality, freshness, hallucination rate, and cost — per the user's own Phase 7 gate.
- **Exa enrichment formatting**: `companySize` and similar fields still come back as inconsistent free text from Exa's Answer API (vs. Prospeo's clean bucketed ranges) — not fixed this round since Exa enrichment is now only a secondary/rare supplement, but would need attention if Exa's enrichment role ever expanded.
- **Exa name collisions**: the benchmark found real cases (GROZ Tools/Groz-Beckert, Neogen Chemicals/Neogen Corporation) where a genuinely different, name-adjacent company shows up alongside the correct one. The new `generic_name`/`no_own_domain` flags don't catch this specific failure mode (it's not a generic name, it's a different real company) — flagged as a known, unaddressed limitation, not silently ignored.
- **Prospeo enrichment error/no-data conflation**: found during live validation (not part of the benchmark) — `interpretProspeoEnrichmentResult()` collapses "the API call itself failed" and "Prospeo genuinely has no data for this person" into the same `not_found` status, with no distinguishing reason surfaced. Confirmed by retrying an apparently-`not_found` result a few seconds later with success (it was a transient rate-limit collision, not missing data). Pre-existing Prospeo provider behavior, not introduced by this rollout — worth a small follow-up fix (surface the actual failure reason) but out of scope here.

---

## 6. Tests

- `npx tsc --noEmit`: clean.
- `npx vitest run`: **108 test files, 1216 tests, all passing** (full suite, not just touched files).
- **Live validation** (`benchmarks/exa/rollout-validation.ts`, 3 company searches + 3 full company→person→email→enrichment chains, run against the real production defaults just flipped):
  - Company discovery: Exa confirmed as `providerUsed` with no env override.
  - Amit Kalyani (Bharat Forge) is now KEPT in decision-maker results with his real title "VP Engineering" and an honest `low` confidence — no longer silently dropped, confirming the exact fix the benchmark called for.
  - Prospeo returned `email_confidence: 'verified'` for all 3 real email lookups — confirms the verification tier works end-to-end in production, not just in unit tests.
  - Identity consistency held at every hop (person name → company → email → enrichment) for all 3 chains. One flagged case (Aditya Malkani's email domain `adorians.com` differing from `adorwelding.com`) was investigated and is very likely a legitimate internal group-email domain (the same pattern appeared for a second Ador Welding employee, `lajpat@adorians.com`, in the earlier full benchmark) — not an identity error, but exactly the kind of thing worth a human glance, which the validation script surfaced rather than silently accepted.
  - A transient Prospeo enrichment `not_found` was investigated, confirmed to be rate-limiting (succeeded on retry with real, correct data), not a real defect.

---

## 7. Rollback

Every capability can be reverted independently, with no code redeploy required for the two DB-governed ones:

- **Company discovery → Explee**: set `COMPANY_DISCOVERY_PROVIDER=explee` (env var, immediate effect, no DB involved). Explee's provider code is completely untouched.
- **Decision-maker discovery → Prospeo**: in `/admin/outbound/integrations`, select "Prospeo" as the active provider for Decision-Maker Discovery (its credential row was deactivated, not deleted — reactivating is instant). Equivalently: `UPDATE outbound_integrations SET is_active = false WHERE capability = 'decision_maker_discovery' AND provider_name = 'exa'; UPDATE outbound_integrations SET is_active = true WHERE capability = 'decision_maker_discovery' AND provider_name = 'prospeo';`
- **Email verification tier**: no rollback needed — `'verified'` is additive (a 5th value on an existing field); removing it would require reverting migration `029` and the corresponding code, but nothing depends on `'verified'` existing for correctness (a system that's never seen the value behaves exactly as before).
- **Selective enrichment supplement**: to disable, remove the `isThinEnrichment(...)` branch in `app/api/admin/outbound/contacts/[id]/enrich/route.ts` — Prospeo-only behavior resumes immediately, no config flag needed since this was never gated behind one (it's a small, easily-revertible code diff, not a data change).
- **Ranking/role-classification**: to disable, stop calling `rankCandidates()` at its one call site in `lib/outbound/decision-maker-discovery/provider-factory.ts` — candidates return in provider-native order, same as before this rollout.

Nothing here is a one-way door. Every change is either a single env var, a single DB row flip, or a small, isolated code diff.
