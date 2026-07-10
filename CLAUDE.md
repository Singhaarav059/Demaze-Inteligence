# Demaze AI Outbound Intelligence Platform — Project Context

## What this is
B2B lead intelligence tool. Input: company URL. Output: company profile, business
classification, challenges, opportunities, signals, recommended outreach angle.
Target industries: Manufacturing, Automotive, Industrial, SaaS, Financial Institutions, SMBs.

This is NOT a chatbot. Output feeds real Demaze sales outreach.

## Why this exists — read this before touching signals/opportunities code
This is not a generic industry classifier. The report is only useful if a Demaze
salesperson reads it and immediately knows: why talk to this company, what pain they
likely have, which Demaze capability fits, who to contact, and what the first message
should say. Everything else (industry label, company size, generic "digital
transformation" tags) is supporting data, not the output.

**Anti-pattern to avoid**: `opportunities: ["Digital transformation"]` for every
manufacturer. That's a schema passing, not a sales-useful signal.

**Target pattern**: evidence -> specific operational problem -> named Demaze
capability -> stakeholder -> outreach angle. Example (Ador Welding — 6 manufacturing
facilities found in evidence):
```yaml
Signal: 6 manufacturing facilities, no unified reporting mentioned
Likely Problem: cross-location production visibility, delayed plant-to-HQ reporting
Demaze Fit: operational dashboards, plant reporting automation, workflow coordination tools
Stakeholder: Plant Ops Head / VP Manufacturing / CTO (not generic "Marketing")
Outreach Angle: "Coordinating reporting across 6 facilities usually means someone is
  still stitching Excel sheets together weekly — worth 15 min to see how that gets automated?"
Confidence: medium (facility count confirmed, reporting gap inferred not confirmed)
```

## Demaze Capability Map — see DEMAZE_CAPABILITY_MAP.md and SERVICE_TO_OUTREACH_MAPPING.md
The 8 official Demaze service lines are CONFIRMED ground truth (given directly, not
inferred) — see `DEMAZE_CAPABILITY_MAP.md` at repo root. "Virtual CTO / Dedicated Team
Model" is explicitly NOT a service line — it's a positioning device used on some
proposals only, not a capability bucket. Do not reintroduce it as one.

`SERVICE_TO_OUTREACH_MAPPING.md` is the per-service blueprint (evidence patterns,
disqualifiers, threshold gating, buyer titles, outreach angles) that
`generateDeterministicOpportunities()`, the challenge engine, and stakeholder mapping
should eventually target. It is still draft and under review — see the sequencing
note below before touching that code.

## Ideal Customer Problems (think problems, not just industries)
```yaml
Manufacturing / Industrial:
  - Multi-plant/multi-facility coordination and visibility gaps
  - Manual, delayed plant-to-HQ reporting
  - Vendor/dealer network management without unified data
  - Legacy systems with no AI-driven decision support

D2C / E-commerce:
  - Analytics fragmentation (no unified revenue/traffic view)
  - India-specific payment gaps (Stripe invite-only -> Razorpay integration need)
  - Attribution and funnel visibility gaps

Dealer/Distribution Networks (see Volvo model):
  - Sales intelligence not surfaced to individual dealers
  - Used-inventory/service data siloed from sales opportunity
  - No systematic "why now" urgency signal for sales teams

Financial/Regulated-adjacent platforms:
  - Need jurisdiction-agnostic architecture, phased delivery, compliance-aware scoping
  - Manual approval/onboarding workflows

SMBs with informal ops:
  - No CRM, tracking via spreadsheets or WhatsApp
  - Founder-dependent decision-making with no dashboard/reporting layer
```

## Outreach Intelligence Schema (this is what generateDeterministicOpportunities()
## and the executive brief should target — not a generic industry/challenge list)
```yaml
Company:
Signals:            # Tier 1/2 evidence only, see Research Standards below
Likely Problems:     # specific operational pain, not "digital transformation"
Demaze Fit:          # named capability from the map above, not a generic category
Recommended Stakeholder:  # actual title, not "Marketing" by default
Outreach Angle:      # one sentence, usable as a first-line DM/email opener
Confidence:          # tied to evidence tier, not vibes
```

## Research Standards — evidence tiers for signal extraction
Weight evidence by tier when scoring signals/confidence. Marketing language should
contribute close to nothing — it's currently possible for a page full of "innovative,
leading, world-class" to inflate a score, and that's a bug in disguise, not a feature.

```yaml
Tier 1 (strong signal):
  - Facilities, locations, employee counts, named products, named partners/distributors
  - ERP/CRM mentions, hiring signals, expansion announcements

Tier 2 (moderate signal):
  - Supply chain, manufacturing process mentions, dealer network, field teams,
    service centers, compliance mentions

Tier 3 (near-zero weight):
  - Pure marketing adjectives: "innovative", "leading", "world-class", "trusted",
    "excellence" — do not let these move confidence or opportunity scoring
```

## Sequencing note re: business-context work vs. current engineering work
The scraper fallback chain (Session 1) and classifier activation (Session 2) do NOT
need to wait on this section being finalized — getting content and correct page
selection is prerequisite regardless of what schema the eventual report uses.
Signal extraction and opportunity generation (Sessions 3-4) SHOULD wait until the
capability map and outreach schema above are confirmed by Krupal — building
generateDeterministicOpportunities() against a generic taxonomy now means rebuilding
it once the real schema is locked.

## Pipeline (in order)
```
Company URL
  -> Scraper (multi-tier fallback)
  -> Company identification
  -> CompanyProfile classification
  -> Signal extraction
  -> Challenge generation
  -> Opportunity generation
  -> Validation gate (PASS / WARN / PARTIAL — never hard FAIL)
  -> Final report
```

## Current architecture facts (do not re-derive, just build on these)
- Business model classification runs through `CompanyProfile`, NOT the old `BusinessModel` type. That migration is done.
- `clusterSignals()` and `generateDeterministicOpportunities()` are active in the pipeline, not dead code.
- Validation stage returns PASS / WARN / FAIL today. Task in flight: add PARTIAL so we never hard-fail when any fallback source returned content.
- `ENRICHMENT_TIMEOUT_MS` is 70000 (raised from 45000 — enrichment reliably completes ~50s).
- LLM JSON responses are fence-stripped (```json ... ``` stripped, first `{` to last `}` extracted) before `JSON.parse()`. Considered fixed — don't re-solve this.

## Known environment gotcha — READ THIS BEFORE DEBUGGING "WHY ISN'T MY FIX WORKING"
The Next.js dev server on Windows does NOT pick up file changes made from a Linux shell
(cross-OS file watcher issue). After any edit to scraper/classifier files, the dev server
must be restarted (`npm run dev`) before the fix is live. If a benchmark run doesn't
reflect a change you just made, restart the server FIRST before assuming the fix is wrong.

## The scraper (root cause of most historical failures)
How it's supposed to work:
1. Firecrawl `mapUrl` -> all URLs on site
2. Score each URL by category (investor=100, corporate=90, manufacturing=85, b2b_services=75, etc.)
3. Select top 15 highest-scoring pages
4. Scrape those 15
5. If insufficient/low-diversity results, probe known B2B paths (`/about/`, `/industries/`, etc.)

Multi-tier fallback chain (target architecture, being implemented):
```
Firecrawl -> fail -> Jina Reader (https://r.jina.ai/<url>, free, no key, renders JS,
             handles Google Sites/Wix/Cloudflare) -> fail -> Tavily Search -> fail -> Direct Fetch
```

## URL classifier — critical bug class
Short keywords (<=3 chars: 'ir', 'sec', 'ai', 'bse', 'nse') were matching as plain
substrings, causing false positives:
- `/barbed-wire.php` contains "ir" (in "w**ir**e") -> was scored investor/100
- `/blog/anti-climb-fence-for-high-security-fencing` contains "sec" (in "**sec**urity") -> was scored investor/100

Fix: short keywords require word-separator boundaries (`/ - _ .`) instead of substring match.
`matchesKeyword()` is the function. See tests/url-classifier.test.ts for the adversarial matrix —
extend that file, don't rewrite the matching logic without re-running it.

New category added: `b2b_services` (score 75) for: solutions, services, industries,
industry, application, capabilities, warranty, partner — these previously scored 0.

Probe trigger fires when EITHER:
- Fewer than 4 high-value pages selected (blog-heavy sites), OR
- Fewer than 3 distinct categories in selection (single-category sites, e.g. all-leadership pages)

## Known unfixable-by-keyword-classification cases (need a different approach, not more keywords)
- `.php` URL structures (probe guesses `/products/`, site is `/products.php`)
- Google Sites (nav is plain text, not `<a href>` links — no links to discover at all)
- Sites where key pages have no recognizable URL keyword (`/p1.php`, numeric IDs, custom CMS slugs)
- Planned fix, NOT yet built: anchor-text scoring — score using the link's visible text
  (e.g. `<a href="/p1.php">Warranty</a>` -> "Warranty" signal) in addition to the URL path.
  This reuses data already returned by Firecrawl/Jina mapUrl and should be built into
  `anchor-text-scorer.ts` before inventing more URL-keyword heuristics.

## Benchmark set (current)
Ace Pipeline, Ador Welding, AS Agri & Aqua, AITG, A-1 Fence Products, ATE Group
(earlier/reference set: Bharat Forge, Muthoot Finance, Chargebee — all currently PASS,
do not regress these)

## Company-specific known issues (context for whoever debugs these next)
- **AITG**: evidence extraction works (production lines, auto parts, chemical industry,
  group companies all found) but signals=0, opportunities=0. This is NOT a scraping
  problem — content acquisition already succeeds here. Points at subject-classifier
  floor (companySubjectCount=0 cascade), not scraper work.
- **A-1 Fence**: `fetch failed` — determine if Cloudflare/SSL/slow site/regional block
  before assuming it's fixed by the fallback chain alone.
- **AS Agri & Aqua**: Google Sites URL. URL normalization bug (losing company identity
  by stripping to bare `sites.google.com`) is fixed. Tavily search fallback parser bug
  (`SearchData has no '.data'`, results actually under `.web`) needs verification —
  check this before assuming Google Sites support is done.
- **ATE Group**: classified as `primary=conglomerate, manufacturer=false` despite
  strong manufacturing evidence (industrial technologies, engineering, manufacturing
  technology, industrial automation). Likely classifier gap — verify after keyword
  boundary fix is live (see environment gotcha above).
- **Ace Pipeline**: classified as conglomerate, likely under-classified. Needs review,
  not yet root-caused.

## The second-biggest architectural weakness (after scraping): companySubjectCount=0
When this fires: 0 subjects -> 0 signals -> 0 opportunities -> WARN/FAIL, even when
the underlying content clearly supports classification (see AITG above). Fix is a
"floor" in the subject classifier — fallback behavior when strict extraction comes
back empty, not a full rewrite.

## Signal library — categories to add (currently too narrow)
Existing: automation, digital transformation, capacity expansion
Add: multi-location operations, distribution complexity, vendor ecosystem,
product diversification, industrial partnerships

## Model quality verdict — DO NOT relitigate this
Evaluated whether model quality is the bottleneck. Conclusion: no.
Estimated impact: architecture fixes ~+30%, model upgrade ~+5-10%.
Current open/free models (DeepSeek, GLM, Qwen, Llama) are sufficient.
Failures are scraping, classification, signals, timeouts, parsing — not reasoning quality.

## DO NOT WORK ON RIGHT NOW
- More model changes
- More classifier tweaking beyond the specific fixes listed above
- More enrichment work (L4-A "prove enrichment helps" is open but not urgent)
- More regexes as a first resort — prefer anchor-text/structural signals over new keyword lists

## Implementation sequence (do in this order, benchmark after each stage)
1. Multi-tier scraper fallback (Firecrawl -> Jina -> Tavily -> Direct Fetch) + fix Tavily
   parser shape bug. Never-hard-fail: return `{status: "PARTIAL", confidence: 30}` instead
   of FAIL when any fallback source returns content.
   STOP. Run benchmark. Review A-1 Fence and AS Agri specifically before continuing.
2. Restart dev server to activate matchesKeyword() boundary fix, b2b_services category,
   smarter probe trigger. Add anchor-text scoring. Re-run benchmark, check ATE Group,
   A-1 Fence page selection quality (not just "did it get content" but "did it get the
   RIGHT pages").
3. Subject-classifier floor (prevent companySubjectCount=0 cascade). Expand signal
   library with the 5 new categories above. Re-run benchmark, check AITG specifically.
4. Provider health tracking — stop retrying known-unhealthy LLM providers.

## The actual goal
NOT "6/6 benchmark PASS." The goal is: any company URL -> pipeline always returns
usable intelligence -> no hard crashes -> no hard FAILs -> graceful degradation on
ugly real-world sites.

## Benchmark workflow
Run `benchmark/run-benchmark.ts` after every change to this pipeline. Write output to
`benchmark/results-history/<date>.json`. Compare against the previous snapshot before
claiming a fix worked — a fix for one company should not silently regress Bharat Forge,
Muthoot, or Chargebee (all currently PASS).
