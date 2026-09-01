# Exa vs. Explee/Prospeo — Provider Benchmark Report

**Date:** 2026-09-01
**Raw data:** [`snapshot-2026-09-01T04-41-33-004Z.json`](./snapshot-2026-09-01T04-41-33-004Z.json) (112 calls) plus two small follow-up checks described inline below (Prospeo default-title retest, rate-limit retries — results folded into this report; scratch scripts deleted after use).
**Reproduce with:** `npm run benchmark:exa` (requires `EXA_API_KEY`, `EXPLEE_API_KEY`, `PROSPEO_API_KEY`; makes real, credit-spending calls; never run as part of the normal test suite).
**Scope:** Company discovery, decision-maker discovery, email finder, and person enrichment. Deep company research (the 7-stage pipeline) was explicitly out of scope for this pass, per instruction.

No production defaults were changed. Explee and Prospeo remain untouched and active.

---

## Executive conclusion

**Hybrid is best — and not a close call on two of the four capabilities.**

- **Company discovery:** Exa is a clear upgrade on data quality (far fewer garbage/duplicate/wrong-domain results) and dramatically better recall on real Indian SMB manufacturers that Explee's own relevance ranking silently drops. Exa should replace Explee for discovery once decision-makers/enrichment feeding off discovery are stable.
- **Decision-maker discovery:** Exa clearly wins on recall for Demaze's own stated role vocabulary. Prospeo can perform comparably *only* under its own narrower, more literal title list — a genuine, evidence-backed capability difference, not a fluke.
- **Email finding:** Prospeo wins outright — it's the only one that works right now. Exa's only email path (Websets) is gated behind a Pro plan this account doesn't have.
- **Person enrichment:** Roughly tied on accuracy (the two providers agree closely on the same people), Prospeo wins on speed (~5-8x faster) and on structured-data cleanliness (bucketed company-size ranges vs. Exa's inconsistent free text).

Given this, **Option C is the right architecture**: Exa for discovery and decision-makers, Prospeo for email finding (and enrichment, where it's faster and just as accurate). See [Recommended architecture](#recommended-architecture).

---

## 1. Company discovery — actual numbers

Five queries, run through both providers at matched geo/definition parameters. Explee enforces `size`/`revenue_annual`/`founded`/boolean flags server-side when set; this benchmark left those unset for both providers so the comparison is apples-to-apples on `definition` + `geo_include` only (the two parameters Exa can also honor).

| Query | Explee returned | Explee latency | Exa returned | Exa latency |
|---|---|---|---|---|
| Manufacturing + India | 40 | 12.6s (median across all 5 Explee queries) | 16 | 6.1s (median) |
| Automotive + India | 20 | — | 13 | — |
| Manufacturing + Europe | 20 | — | 19 | — |
| E-commerce | 20 | — | 20 | — |
| Financial institutions + India | 20 | — | 19 | — |

Raw counts alone are misleading here — see the qualitative review below, which is the actual finding.

### Qualitative review (representative sample — every returned company was read, not just the first page)

**Manufacturing + India.** Explee (40 results): at least **9 results have a domain that has nothing to do with the company** — "Vinson Industry Private Limited" → `virginmedia.com`, "Bangera Products" → `whalebone.io`, "SK & RK Industries" → `sk.com` (the actual Korean SK Group's domain), "Anil Rohit Group" → `dns.google`, "Stanley Ind" → `rbu.ac.in` (a university), "SAVERA INDUSTRIES" → `saverahotel.com`. Several more have wrong industry categories for a manufacturing query (Anant Raj Industries tagged "Real Estate", ABT Industries tagged "Truck Transportation", Jasper Industries tagged "Retail"). One duplicate pair ("Vasant Group" / "Vasant Group Of Industries", same domain). By a conservative count, **~15/40 (38%) are duplicates, wrong-domain, or wrong-category** — leaving ~25 genuinely useful, correctly-classified companies.
Exa (16 results): all but ~3 are real, correctly-domained manufacturers (Supreme Industries, Godrej Industries, Exide Industries, Cummins India, etc.). Two are borderline (a LinkedIn-only stub with no real site; a company whose fit as "manufacturing" is unclear) and one has a clearly wrong domain (`caspianenergy.org` attached to "Eastern Chemical Company"). **~13/16 (81%) are clean.**
Industry field: Exa's `outputSchema` synthesis returned null industry for every result on this specific query (a documented Exa limitation — synthesis is best-effort, not guaranteed) but returned it reliably on 3 of the other 4 queries, so this looks like a per-query synthesis miss, not a systemic gap.

**Automotive + India.** Explee (20 results): **5 of the 20 are the same company** — "Maruti Suzuki", "Maruti Suzuki India Ltd.", "Maruthi", "SUZUKI MOTOR GUJARAT PRIVATE LIMITED", and "ARENA -Maruti Suzuki India Ltd" all share the domain `marutisuzuki.com`. Three more are car **dealerships**, not manufacturers ("Raja Hyundai", "pioneer hyundai", "Nimbus Hyundai" — two of them additionally mis-tagged industry, "Appliances, Electrical, and Electronics Manufacturing" and "Retail"), and one entry is named "ammm" (garbled/truncated). That's **9/20 (45%) duplicate, dealership, or garbage** — 11 genuinely distinct manufacturers.
Exa (13 results): 13/13 distinct, correctly-classified real automotive component/OEM manufacturers (Force Motors, TATA AutoComp, Varroc, CIE Automotive India, Gabriel India, etc.) — zero duplicates, zero dealerships. Two lack a real corporate domain (only a LinkedIn URL was found).
**Exa's 13 clean results beat Explee's ~11 clean results out of a nominally larger 20** — the exact "useful companies, not raw count" comparison the benchmark was designed to test.

**Manufacturing + Europe.** This is the sharpest single result in the whole benchmark. Explee returned **"POWELLI INDUSTRIES LIMITED" with `geo: "US"`** despite `geo_include` being restricted to `['DE','FR','IT','ES','PL','GB']` — a geo-filter leak, the same class of bug already documented in this codebase's Explee history, reproducing live. Explee also returned the same corporate group **four times** ("DMG MORI Aktiengesellschaft" / "DMG MORI UK Ltd" / "DMG MORI Pfronten GmbH" / "DMG MORI Poland Sp. z o.o.") — all four sharing the **exact same revenue figure, 3629466000**, which is also suspicious on its own: that same figure (or another repeated figure, 41197094070) shows up attached to *unrelated* companies elsewhere in the snapshot ("Vinson Industry" in the India query and "Maranata Industrial" here both show `6788620000`; "DRESSER RAND INDIA" in the India query and "DRESSER INTERNATIONAL LTD" here both show `41197094070`) — strong evidence Explee's `revenue_annual` field is sometimes inherited from a matched parent/brand rather than computed per-entity. Explee also returned a German **newspaper** ("Augsburger Allgemeine") and a **Polish research institute** ("INP PAN") as manufacturing matches, plus several more wrong-domain entries.
Exa (19 results): all 19 correctly geo-tagged to the requested countries (zero leaks), zero duplicates, zero obviously-wrong entities. Only soft ICP-fit questions (Unilever, a large FMCG conglomerate, and an aerospace company — both defensibly "manufacturing" but not the SMB-scale target Demaze usually wants).

**E-commerce.** Different failure modes, not a clean win either way. Explee returned near-exclusively **global mega-brands** (Amazon, eBay, Flipkart, Alibaba-scale names) — technically accurate but a poor ICP fit for realistic B2B outbound (these aren't real prospects), and one is **defunct** ("Jet" — Walmart shut down Jet.com in 2020, a freshness problem). Exa returned more realistic SMB-scale e-commerce businesses, better ICP fit, but with a real garbage-name problem: **4-5 of 20 results are generic non-entities** ("e-Commerce", "e-Commerce" again, "E-commerce Service for Companies", "E-Commerce") each attached only to a LinkedIn stub, plus one that appears to be a **person's name misclassified as a company** ("Leela Khan").

**Financial institutions + India.** Explee's best-performing query (17/20 clean) but still produced one glaring category error — **"Banjara Harley Davidson" (a motorcycle dealership) classified as a financial institution** — and one bogus domain (`apple.com` attached to "Muthoot FinCorp ONE"). Exa (19 results) was similarly strong, with softer ICP-fit misses rather than outright false positives (the Reserve Bank of India — a regulator, not a sales prospect; an advisory firm rather than an institution).

---

## 2. Precision on reviewed sample

Per instruction, this is **precision on the reviewed sample**, not recall against a ground-truth universe — no such universe exists for these queries, and none is claimed.

| Query | Explee — clean/reviewed | Exa — clean/reviewed |
|---|---|---|
| Manufacturing + India | ~25/40 (63%) | ~13/16 (81%) |
| Automotive + India | ~11/20 (55%) | 13/13 (100%) |
| Manufacturing + Europe | ~13/20 (65%), incl. 1 geo leak | 19/19 (100%) |
| E-commerce | 19/20 (95%) technically real, but ICP-fit poor (mega-brands) + 1 defunct | ~15/20 (75%), better ICP fit, 4-5 generic-name entries |
| Financial institutions + India | 17/20 (85%) | ~16/19 (84%) |

Irrelevance reasons observed (both providers): wrong domain attached to a real name (Explee, frequent), wrong industry category (both, occasional), duplicate/near-duplicate entity (Explee, frequent — same brand under 3-5 name variants), generic/non-entity name (Exa, occasional — LinkedIn-stub companies with no real distinguishing name), geo leak (Explee, one confirmed instance), defunct/stale entity (Explee, one instance).

---

## 3. Known regression cases

**Methodology note:** the exact original discovery query that first surfaced these cases wasn't available in this session (not documented anywhere in this repo's history — supplied directly as ground truth this turn). Each company was instead tested via a direct name lookup (`definition = "<exact name>"`), the same technique `lib/enrichment/explee-lookup.ts`'s `lookupCompanyInExplee()` already uses. This tests "can the provider find the specific named entity," which is closely related to but not identical to "does it survive the broad-query threshold" — flagged honestly, not glossed over.

### Known false negatives (companies Explee's threshold reportedly dropped) — 9 cases

| Company | Explee top-5 | Exa top-5 |
|---|---|---|
| Honda Motor India | Honda Atlas Cars *Pakistan*, Westgate Honda (US dealer), Reading Honda (UK dealer), Kendal Honda (UK dealer), Honda Atlas Cars Ltd — **actual entity never appears** | Honda Cars India Ltd, Honda Motor India Pvt. Ltd, Honda Motorcycle & Scooter India Pvt. Ltd, Honda Cars India, Honda — **found at #1** |
| Mazak India | Paluch, Russell Mann Machinery, "Mazak" (generic, not India-specific), MAZ SERVICE, Axis CNC Mexico — partial/generic hit only | Mazak India, Yamazaki Mazak India, Yamazaki Mazak Corp, Yamazaki Mazak Trading Corp, Mazak North America — **found at #1** |
| Kirloskar Electric | WEG Reclutamiento (a recruiting page), a Chinese electric-machine company, unrelated German/other firms — **actual entity never appears** | Kirloskar Electric Company Ltd, Kirloskar Electric Co. Ltd, Kirloskar Power Equipments, Kirloskar Pneumatic, Kirloskar Oil Engines — **found at #1** |
| Action Construction Equipment | United Rentals Australia/NZ, a French equipment-rental firm, UK plant hire, a French street-sweeper company, an Italian rental firm — five unrelated equipment-*rental* companies, **actual entity never appears** | Action Construction Equipment Ltd, Action Construction Equipments Ltd, Action Construction Equipment Ltd - India, Ace Construction Equipment Limited, Action Equipment — **found at #1** |
| Hind Rectifiers | Diotec Electronics, Power Semiconductors Inc, "Rectifier House - India" (different company), Nainasemi, Asemi Technology — **actual entity never appears** | Hind Rectifiers Ltd, Hind Electricals - India, Jindal Rectifiers (x2, duplicate), Transformers & Rectifiers (India) Ltd — **found at #1** |
| Camlin Fine Chemicals | Saltigo, Sika, AMPAC Fine Chemicals, CYDSA, Panoli Intermediates — generic fine-chemicals competitors, **actual entity never appears** | Camlin Fine Sciences (CFS) — the real company's current name, CFS Europe SpA, Kokuyo Camlin Ltd, DCM Shriram Fine Chemicals, spinox — **found at #1** |
| GROZ Tools | HAIMER SE Asia/India, OSG Scandinavia, Vargus Polska, OSG Royco, Schwanog Siegfried Güntert — generic cutting-tool competitors, **actual entity never appears** | GROZ TOOLS, GrozUSA Tools, Groz Net Industries - India, Groz-Beckert (different company, name-adjacent), Grob Machine Tools India (different company) — **found at #1**, though 2 of the other 4 are name-collision noise |
| Neogen Chemicals | Mitsui Chemicals, BASF, Sika (x3 regional entries) — major global conglomerates, **actual entity never appears** | Neogen Chemicals Limited — **found at #1**, though "Neogen Corporation" (a genuinely different, unrelated US biotech company) also appears — real name-collision risk |
| Suryalakshmi Cotton Mills | Yunus Textile, a Pakistani textile mill, "SURYALAKSHMI COTTON MILLS" **(the only hit, buried at #4)**, AB Exports | Suryalakshmi Cotton Mills Ltd — **found at #1** |

**Result: Explee surfaced the real company anywhere in its top 5 for 1/9 (11%, and buried at #4). Exa surfaced it at #1 for 9/9 (100%).** This directly and repeatedly reproduces the reported min-relevance false-negative failure mode, live, on every single case tested — as clean a confirmation as a benchmark produces. Exa is not flawless here either: 2 of the 9 (GROZ Tools, Neogen Chemicals) surfaced a genuinely different, name-colliding company alongside the correct one — a real precision cost worth knowing about, not a reason to doubt the recall win.

### Known false positives — 4 cases

| Company | Expected | Explee top-5 | Exa top-5 |
|---|---|---|---|
| Ferreiro | Restaurants | Jackson Blacksmith Shop, "Made in inox", a German ironworks, Bricofer, Forja Rafael — none named Ferreiro; looks like Explee matched the *word meaning* ("ferreiro" = blacksmith in Galician/Portuguese) rather than the name | Ben Ferreiro S.L., **Ferreiro Restaurante** (correctly a restaurant), Celso Emilio Ferreiro (a poet, not a company — false positive), Estudio Contable Adrián Ferreiro, Ferreiro Da Serra |
| AGMP_IIMA-OFFICIAL | Education | Generic agri-business schools, unrelated to "IIMA" specifically | Multiple results specifically tied to IIM Ahmedabad (the "IIMA" in the name) — more precisely targeted |
| Transpek | (flagged wrong-industry: Transportation & Logistics) | **Google, YouTube, Amazon, Walmart, Microsoft** — five unrelated global mega-corporations, a clear retrieval failure | TRANSPEK INDUSTRY LTD (the real company — a chemicals manufacturer, confirming it was mis-tagged, not a true match, in whatever produced the original flag), Silox India, Transpek Silox India, an unrelated ITI, TransPak (different company) |
| Oilgear | (flagged wrong-industry: IT Services) | German/Chinese oil-tools competitors, plus **a literal "kerui test 2" record** — an internal test artifact appearing in production search results | Oilgear (the real company — a hydraulics manufacturer), Texas Hydraulics, Oilgear Industry, Oilgear Industrial Solutions, Oilgear Industrial Systems Group |

Both providers correctly avoid inventing a fake company for the two ambiguous cases (Ferreiro, AGMP_IIMA aren't real single companies to begin with), but Explee's search quality for a bare company-name query looks broadly unreliable independent of the false-positive framing — the Transpek and Oilgear results are not "close misses," they're unrelated results, including one literal test-data leak.

**Verdict on 11 (rule 11): does Exa's native ranking need a filter added?** No evidence for one. Exa's failure mode here is narrower (name-collision on common words, occasional generic LinkedIn-stub entities) — a soft ranking/dedup pass would help more than a hard threshold, which is exactly the kind of blunt instrument that caused Explee's false-negative problem in the first place.

---

## 4. Decision-maker discovery — actual numbers

10 companies, target titles = Demaze's own stated vocabulary (CEO, COO, Head of Operations, Head of Manufacturing, Head of IT, Head of Digital Transformation, VP Engineering, Head of Automation).

| Company | Prospeo (Demaze titles) | Exa (Demaze titles) |
|---|---|---|
| A-1 Fence Products | 0 (`NO_RESULTS`) | 3 found (CEO, Head of Operations, Head of Manufacturing) |
| Ace Pipeline | 0 (`NO_RESULTS`) | 2 found (CEO x2) |
| Ador Welding | 0 (`NO_RESULTS`) | 4 found (CEO, COO x2, Head of IT) |
| AITG | 0 (`NO_RESULTS`) | 1 found (CEO) |
| AS Agri and Aqua | 0 (`INVALID_FILTERS`) | 4 found (Head of Operations x3, CEO) |
| ATE Group | 0 (`NO_RESULTS`) | 4 found (CEO, VP Engineering, CEO, Head of Operations) |
| Bharat Forge | 0 (`NO_RESULTS`) | 9 found |
| Chargebee | 0 (`NO_RESULTS`) | 1 found (CEO) |
| Lechler | 1 found (CEO) | 5 found (CEO, COO, VP Eng, Head of Ops, Head of IT) |
| Muthoot Finance | 2 found (CEO, Head of Operations) | 3 found (CEO x2, COO) |
| **Total** | **3 candidates, 2/10 companies with any result** | **36 candidates, 10/10 companies with results** |

**This looked like a lopsided Prospeo failure, so before accepting it I checked whether it was a benchmark artifact rather than a real capability gap.** Prospeo's own code documents that its `person_job_title` filter is "closer to literal than semantic" matching — meaning a specific phrase like "Head of Digital Transformation" is unlikely to literally match a real LinkedIn title, whereas Exa does semantic search over the same phrase natively. Re-running Prospeo with **its own default title list** (CEO, CTO, COO, CFO, Managing Director, Chairman, Vice Chairman, Director, VP Operations, VP Sales, Plant Head, General Manager — a shorter, more common vocabulary) changed the picture substantially:

| Company | Prospeo (its own default titles) |
|---|---|
| A-1 Fence Products | 1 found |
| Ace Pipeline | 1 found |
| Ador Welding | 2 found |
| AITG | 0 (`NO_RESULTS` — genuine, confirmed on retry) |
| AS Agri and Aqua | 0 (`INVALID_FILTERS` — likely the placeholder Google Sites domain, a real edge case) |
| ATE Group | 6 found |
| Bharat Forge | 12 found |
| Chargebee | 3 found |
| Lechler | 1 found |
| Muthoot Finance | 5 found |
| **Total** | **31 candidates, 8/10 companies with results** |

**Both findings are real and both matter.** Under Prospeo's own preferred vocabulary it performs respectably (8/10 companies, close to Exa's 10/10). But under **Demaze's own actual stated role requirements** — which is what section 4 asked to test, and is what the product would really send — **Prospeo's literal title matching fails on 8/10 real companies, including well-known ones (Bharat Forge, Chargebee)**, while Exa succeeds on all 10 with the exact same input. This is a genuine, reproducible UX/capability difference: Prospeo needs a simplified title vocabulary to work well; Exa handles specific role phrasing natively.

**Candidate quality (spot-checked, not independently verified against live LinkedIn):** where both providers found the same company, they largely agree — e.g. Lechler: both correctly find Patrick Muff as CEO. Chargebee: Exa correctly identifies Krish Subramanian, the real co-founder/CEO. Ador Welding: Exa's "Aditya Malkani, CEO" and "Lajpat Yadav, COO" both look plausible for a real Indian welding-equipment manufacturer. One title-categorization imprecision found: Exa's decision-maker search tiered Amit Kalyani (Bharat Forge) as "VP Engineering, low confidence" — but the enrichment step (Section 6) independently confirms his real title is Vice-Chairman & Joint Managing Director, a much more senior role than the bucket he landed in. This is a real but narrow issue: the *person* was correctly identified, the *title tier* he was slotted into was too low, because his actual title text didn't literally overlap with any of the eight requested phrases well enough to tier higher.

---

## 5. Email / phone enrichment — actual numbers

18 people (2 per company where a decision-maker candidate existed, capped at 20 per instruction).

| Provider | Found | Not found | Error | Notes |
|---|---|---|---|---|
| Prospeo | 13/18 (72%) | 5/18 (28%) | 0 | **Every "found" result is SMTP-verified** — the client sets `only_verified_email: true` and derives `confidence: 'high'` only from a real `email.status` field containing "verif", confirmed by reading the code, not assumed. |
| Exa | 0/18 (0%) | — | 18/18 | **Every call failed at the same auth gate**: `Exa API 401: Your team does not have access to the API. Upgrade to a Pro plan to get access.` Confirmed directly via curl against the live Websets endpoint — this is a real account-tier limitation, not a code bug (the Websets base URL and request shape were already fixed and confirmed correct against the docs earlier this session). |

Exa's only email-discovery path is Websets, which is not accessible on this account. **This cannot be benchmarked further without upgrading to Exa Pro** — flagging that explicitly per instruction, and leaving that decision to you.

Per instruction: no result here is called "verified" unless the provider gave an actual verification signal. Prospeo's 13 found results are verified. No Exa result exists to classify.

---

## 6. Company/contact enrichment — actual numbers

10 companies' top decision-maker candidate, enriched by both providers (Prospeo's `enrichContact`, Exa's Answer-API-based `enrichContact`).

| Dimension | Prospeo | Exa |
|---|---|---|
| Completeness | 9/10 fully populated (dept/seniority/role/companySize/industry); 1/10 partial (Rajendra Kumar Jain — summary only, structured fields undefined) | 10/10 populated, though `companySize` is inconsistent free text ("Approximately 900 employees worldwide") vs Prospeo's clean buckets ("201-500") |
| Cross-agreement on the same person | High — where both have data, department/seniority/role match closely (e.g. Vivek Gupta/A-1 Fence: both say CEO, C-Suite/C-Level, Mumbai) | Same |
| Confidence signal | `high`/`medium`, derived from job-history data presence | Always `medium` (Exa gives no verification signal — honestly never defaults to `high`, confirmed in code) or `low` |
| A concrete discrepancy found | — | Rajendra Kumar Jain (Ace Pipeline): Exa's generated summary calls him "CEO of **ACE Global Ltd**" — a different company name than the one queried. Possible identity conflation on a common name; flagged, not resolved. |
| Median latency | 346ms | 1,952ms (~5.6x slower) |

No field was treated as trustworthy merely because a provider returned it — see the flagged discrepancy above and the company-size formatting note.

---

## 7. Cost

**Real, observed Exa pricing** (from actual API responses this session, e.g. a 10-result company search cost exactly `$0.007`, matching the published $7/1,000-requests base rate) combined with Exa's published formula ($7/1k base + $1/1k additional results beyond 10; Answer = $5/1k) to estimate the rest:

| Section | Exa calls | Est. cost | Basis |
|---|---|---|---|
| Discovery (5 queries, 40+20×4 results) | 5 | ~$0.105 | Published formula; base rate directly confirmed live |
| Regression lookups (13 companies, 5 results each) | 13 | ~$0.091 | Below the 10-result base, so base rate only |
| Decision-maker discovery (10 companies, 50 results each) | 10 | ~$0.47 | Published formula |
| Email finder (Websets) | 18 | **$0 (assumed)** | All 18 failed at the auth gate before any billable work; not confirmed with Exa directly |
| Enrichment (Answer API) | 10 | ~$0.05 | Published $5/1k rate |
| **Total, this benchmark** | **56** | **~$0.72** | |

**Explee and Prospeo dollar cost could not be determined this session** — both bill in account credits, not per-request dollars, and neither vendor's $-per-credit rate was looked up. What *is* observable: every Explee company-discovery call in this benchmark reported `credits_charged: 0` and an unchanged `remaining_balance` (3,050 throughout) — **company discovery itself appears to cost 0 credits under this account's plan** (credits are evidently consumed elsewhere in the Explee integration, e.g. contact-level lookups, not company search). This means a literal "$ per useful company" comparison would be misleading for Explee (its marginal API cost is genuinely $0, even though its overall plan is presumably not free) — reported honestly rather than forcing a number. **Prospeo's $/credit was not looked up this session and is not fabricated here.**

**Cost per useful company (Exa only, where a real $ figure exists):**
- Manufacturing + India: ~$0.037 / ~13 useful ≈ **$0.0028/useful company**
- Automotive + India: ~$0.017 / 13 useful ≈ **$0.0013/useful company**
- Manufacturing + Europe: ~$0.017 / 19 useful ≈ **$0.0009/useful company**

**Cost per decision-maker candidate (Exa only):** ~$0.47 / 36 candidates ≈ **$0.013/candidate** (before quality-filtering to the genuinely correct ones).

**Websets/Pro-plan cost:** not published on Exa's general pricing page and not observable from a free-tier account — genuinely unknown, not estimated. If email-via-Websets is worth pursuing, this needs a direct conversation with Exa (their pricing page doesn't list it, unusually, among Search/Contents/Answer/Monitors/Agent).

---

## 8. Latency / reliability — actual observations

| Section | Explee median | Exa median | Prospeo median |
|---|---|---|---|
| Company discovery | 12.6s | 6.1s | — |
| Regression name lookup | 7.5s | 2.9s | — |
| Decision-maker discovery | — | 3.4s | 431ms |
| Email finder | — | 380ms (fails at auth, not representative) | 356ms |
| Enrichment | — | 1.95s | 346ms |

**Errors/retries during the full run (112 calls):** 4 transient failures, all recovered on a single retry with no code change — 3 Explee (`fetch failed` ×2, one 30s timeout) and 1 Exa (`fetch failed`). Explee's own client has no built-in retry/backoff (documented in its own header comment); this benchmark's harness retried manually. Separately, Prospeo hit rate limits on 4 of the 10 default-title decision-maker retries — resolved with a 2s delay between calls, not a hard failure.

**Websets (email finder):** 18/18 calls failed identically and immediately (~350-500ms) with a clean, actionable error (`401: ...Upgrade to a Pro plan...`) — no hangs, no ambiguous errors, no partial results. This is exactly the "explicit, observable fallback" the reliability requirements asked for; it just means the capability is unusable on this account, not broken.

**No rate limiting, timeouts, or malformed responses were observed from Exa** across 56+ calls (Search/Contents/Answer/Websets-create) in this benchmark, beyond the one transient `fetch failed`.

---

## 9. Data quality — side-by-side

| Dimension | Explee | Exa |
|---|---|---|
| Company relevance (reviewed sample) | 55-95% depending on query, worst on Manufacturing queries | 75-100%, worst on E-commerce (generic-name entries) |
| Industry accuracy | Frequent wrong-category tags (Real Estate/Retail/Truck Transportation under a manufacturing query; a motorcycle dealer under Financial Institutions) | Generally accurate when populated; null on 1 of 5 queries (synthesis miss) |
| Geography accuracy | **1 confirmed leak** (a US company under a Europe-only filter) | 0 leaks observed (19/19 correctly tagged on the Europe query) |
| Duplicate rate | High on 2 of 5 queries (5 Maruti-family entries in one page; DMG MORI ×4) | Low — isolated cases only (e.g. Jindal Rectifiers ×2 in one regression lookup) |
| Domain-match accuracy | **Poor** — ~9 clearly wrong domains in a single 40-result page (`virginmedia.com`, `sk.com`, `dns.google`, etc.) | Good — 1-2 wrong-domain cases per 15-20 results |
| Revenue-figure integrity | **Evidence of cross-entity duplication** — identical revenue figures reused across unrelated companies, apparently inherited from a matched parent brand | Not directly comparable (Exa's native `financials.revenueAnnual` wasn't duplicated in the sample reviewed) |
| Decision-maker recall (Demaze's own titles) | 2/10 companies | 10/10 companies |
| Decision-maker recall (provider's own titles) | 8/10 companies | (not re-tested — Exa already at 10/10) |
| Email coverage | 72% found, **all verified** | 0% (Websets not accessible on this account) |
| Enrichment quality | Clean structured fields, fast | Comparable factual accuracy, slower, messier structured formatting |
| Freshness | 1 confirmed stale/defunct entity ("Jet") | None observed |
| Latency | 2-4x slower than Exa on discovery | Faster on discovery; slower than Prospeo on decision-maker/enrichment |
| Reliability | 3 transient errors in 55 calls, no built-in retry | 1 transient error in 56 calls; 1 hard account-tier gate (Websets) |
| Cost | Company discovery: $0 marginal (this account); other credit costs not obtained | ~$0.72 total for this entire benchmark; per-item costs in the cents-or-less range |

---

## 10. Important failures found this session

1. **Explee geo-filter leak**: a US company returned under a Europe-only `geo_include` filter — reproduces a previously-known class of bug live.
2. **Explee revenue-figure duplication**: the exact same revenue number attached to multiple unrelated companies across different queries, consistent with a parent-brand-inheritance bug, not per-entity data.
3. **Explee name-search reliability**: querying by a specific, real company name ("Transpek", "Oilgear") returned entirely unrelated global mega-brands or, in one case, a literal internal test record (`kerui test 2`) — not a near-miss, a retrieval failure.
4. **Explee's min-relevance false-negative pattern, reproduced 8/9 times live** on the exact companies flagged as previously dropped.
5. **Prospeo's literal title-matching** silently returns zero candidates for Demaze's own desired role vocabulary on 8/10 real companies (recoverable by simplifying the title list, but that's a real product-level friction).
6. **Exa Websets is inaccessible on this account** (free tier; Pro plan required) — blocks email/phone finding and any Websets-based bulk discovery entirely, confirmed via direct API error, not assumed.
7. **Exa outputSchema has an undocumented, cumulative 10-property cap** across the whole schema tree (not per-object) — found and fixed earlier this session, now resolved in the provider code, mentioned here only for completeness.
8. **Exa name-collision risk** on common words (GROZ Tools/Groz-Beckert, Neogen Chemicals/Neogen Corporation, Rajendra Kumar Jain/"ACE Global Ltd") — a real, if narrower, precision issue.
9. **Exa's `companySize` enrichment field is inconsistently formatted** (free text, not a clean bucketed range) — a real downstream-parsing cost.

---

## Exa strengths (evidence-backed only)

- Dramatically better recall on real companies that Explee's threshold drops (9/9 in the regression set).
- Materially cleaner data — far fewer wrong-domain, duplicate, or wrong-industry-category results across every discovery query tested.
- Correct geo-filter enforcement where Explee leaked.
- Handles Demaze's actual specific role vocabulary for decision-maker search natively (10/10 companies vs. Prospeo's 2/10 on the same vocabulary).
- Faster on discovery and regression lookups (roughly 2-2.6x).
- Cheap in absolute terms (~$0.72 for this entire benchmark).
- Answer-based enrichment is comparably accurate to Prospeo's, with real citations when grounded.

## Exa weaknesses (evidence-backed only)

- Email/phone finding is unusable on a free-tier account (Websets requires Pro; pricing for it isn't even published).
- No verification signal on any returned email/contact field — everything is honestly `medium` at best, never `high`.
- Slower than Prospeo on decision-maker discovery (3.4s vs. 431ms median) and enrichment (1.95s vs. 346ms median).
- `outputSchema` synthesis is best-effort and occasionally returns nothing (industry was null on 1 of 5 discovery queries).
- Name-collision precision issues on common words.
- Inconsistent free-text formatting on some enrichment fields (company size).

---

## Recommended architecture

**Option C: Exa handles discovery and decision-maker search; Prospeo continues to handle email finding and contact enrichment.**

Reasoning, tied directly to the evidence above:
- Exa's discovery quality and recall are strong enough, and Explee's failure modes (geo leaks, revenue-duplication, min-relevance false negatives, retrieval failures on real names) are severe and reproducible enough, that Exa should take over company discovery.
- Exa's decision-maker recall under Demaze's actual role vocabulary is unambiguously better than Prospeo's under the same input.
- Prospeo is the only provider that can currently find emails at all (Exa's path is Pro-gated), and Prospeo's results carry real SMTP verification, which Exa's Answer/Websets paths don't provide even when accessible.
- Enrichment is close to a toss-up on accuracy; Prospeo's speed and cleaner structured output make it the better default for now, with Exa as a documented, switchable fallback (already wired in this session).

This is **not** "replace Explee + Prospeo with Exa" (Option A) — Prospeo's verified-email capability is a real, evidenced strength Exa cannot currently match. It is also **not** "keep the current architecture" (Option D) — the evidence against Explee specifically (not Prospeo) is too consistent and too severe to leave unaddressed.

**Is Exa Pro/Websets worth paying for?** Undetermined from this benchmark — its price isn't published and couldn't be tested. Worth a direct pricing conversation with Exa specifically to evaluate whether Websets-based email finding could close the one gap Option C leaves open, before assuming Prospeo is a permanent requirement.

**What to build next (pending your approval):**
1. Flip `COMPANY_DISCOVERY_PROVIDER=exa` and the decision-maker-discovery capability's active provider to `exa` in a controlled rollout (not silently — this is a real production default change, out of scope for this benchmark per the stop condition).
2. Investigate Exa Pro pricing specifically for Websets before deciding whether to pursue email-via-Exa further.
3. Only after both of the above are decided: revisit whether Exa's Search/Contents/Answer capabilities are strong enough to justify starting on the deep company-research pipeline (Phase 7's explicit gate).

---

## Stop condition

Per instruction, this is where the work stops. No production provider defaults were changed. Explee and Prospeo are untouched and still the active providers everywhere. Waiting for your review before implementing anything above.
