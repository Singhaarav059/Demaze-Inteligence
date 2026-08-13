-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 021 — Sales Knowledge (Industries / Problems / Capabilities / Case Studies)
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- Admin-editable "sales playbook" — see CLAUDE.md's Sales Intelligence
-- Layer entry for the full product spec. Cross-entity relationships are
-- slug-based TEXT[] tag arrays, not UUID foreign keys or join tables —
-- matches the existing lib/knowledge/demaze-proof-points.ts convention
-- (industry_tags/capability_tags), and lets a non-technical admin type a
-- slug instead of managing a hidden FK picker. Referential integrity on
-- these tags is app-level only, same as every other tag-array column in
-- this schema.
--
-- Seed data below is derived from three existing, already-validated
-- sources — this is a re-platforming of real content into an editable
-- table, not invented data:
--   - The 8 capabilities + their positioning/CTA text come from the 8
--     confirmed Demaze service lines in DEMAZE_CAPABILITY_MAP.md and the
--     Evidence/Likely-Pain/Why-Demaze/Outreach-Angle entries in
--     SERVICE_TO_OUTREACH_MAPPING.md. The regex evidence-detection logic
--     itself (lib/pipeline/service-evidence.ts) is NOT duplicated here —
--     it stays code, this table only holds the admin-editable sales copy.
--   - The 8 problems are the "Likely Pain" half of the same 8 mapping
--     entries, one per capability.
--   - The 25 case studies are copied from lib/knowledge/demaze-proof-points.ts
--     (DEMAZE_PROOF_POINTS), with the 8 official capability slugs appended
--     to each row's original (more granular) capability_tags so exact-slug
--     capability matching works, while keeping the original tags for
--     richer display. provenance carries over unchanged and is still
--     load-bearing: 'named_client' rows may name a real client in
--     generated copy, 'composite_illustrative' rows must stay anonymized.
--
-- No RLS, matching every other table in this schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_knowledge_industries (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT        NOT NULL UNIQUE,
  label       TEXT        NOT NULL,
  description TEXT,
  keywords    TEXT[]      NOT NULL DEFAULT '{}',
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE sales_knowledge_industries IS 'Target industries for Demaze outreach. keywords are plain-language terms matched against research content, not regex.';

CREATE TABLE IF NOT EXISTS sales_knowledge_problems (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT        NOT NULL UNIQUE,
  label             TEXT        NOT NULL,
  description       TEXT,
  industry_tags     TEXT[]      NOT NULL DEFAULT '{}',
  evidence_keywords TEXT[]      NOT NULL DEFAULT '{}',
  capability_tags   TEXT[]      NOT NULL DEFAULT '{}',
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE sales_knowledge_problems IS 'Problems Demaze solves. industry_tags/capability_tags are slugs into sales_knowledge_industries/sales_knowledge_capabilities (app-level, unenforced FK). evidence_keywords are phrases that count as research-supported signal when found in a company''s scraped content.';

CREATE TABLE IF NOT EXISTS sales_knowledge_capabilities (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  TEXT        NOT NULL UNIQUE,
  label                 TEXT        NOT NULL,
  description           TEXT,
  positioning_template  TEXT,
  recommended_roles     TEXT[]      NOT NULL DEFAULT '{}',
  recommended_cta       TEXT,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE sales_knowledge_capabilities IS 'Demaze service lines. positioning_template supports a {{company}} placeholder, filled in at generation time.';

CREATE TABLE IF NOT EXISTS sales_knowledge_case_studies (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT        NOT NULL,
  client          TEXT        NOT NULL,
  provenance      TEXT        NOT NULL CHECK (provenance IN ('named_client', 'composite_illustrative')),
  industry_tags   TEXT[]      NOT NULL DEFAULT '{}',
  capability_tags TEXT[]      NOT NULL DEFAULT '{}',
  challenge       TEXT        NOT NULL,
  outcomes        JSONB       NOT NULL DEFAULT '[]',
  source_doc      TEXT,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE sales_knowledge_case_studies IS 'Demaze proof points. provenance is load-bearing: only named_client rows may ever name a real client in generated outreach copy; composite_illustrative rows must stay anonymized (see client column for the anonymized description to use instead). outcomes is [{metric,value,window?}].';
COMMENT ON COLUMN sales_knowledge_case_studies.provenance IS 'named_client = real, individually-attributed engagement, may be named in outreach. composite_illustrative = real delivered work, but must stay anonymized — never present as attributable to a named company.';

CREATE INDEX IF NOT EXISTS idx_sales_knowledge_problems_active ON sales_knowledge_problems(is_active);
CREATE INDEX IF NOT EXISTS idx_sales_knowledge_capabilities_active ON sales_knowledge_capabilities(is_active);
CREATE INDEX IF NOT EXISTS idx_sales_knowledge_case_studies_active ON sales_knowledge_case_studies(is_active);

-- ============================================================
-- SEED DATA — Industries (8)
-- ============================================================

INSERT INTO sales_knowledge_industries (slug, label, description, keywords) VALUES
('manufacturing', 'Manufacturing', 'Companies that make physical goods at scale, often across multiple plants.', ARRAY['manufacturer','manufacturing','factory','plant','production line','fabrication']),
('automotive', 'Automotive & Dealership', 'Automotive OEMs, dealership groups, and after-sales/service networks.', ARRAY['automotive','dealership','vehicle','car dealer','oem','showroom']),
('industrial', 'Industrial & Engineering', 'Industrial equipment, engineering, and heavy-operations companies.', ARRAY['industrial','engineering','fabrication','machinery','heavy equipment']),
('saas', 'SaaS & Software', 'Software-as-a-service and technology product companies.', ARRAY['software as a service','saas','subscription platform','cloud software']),
('financial-institutions', 'Financial Institutions', 'Banks, NBFCs, lenders, insurers, and other regulated financial companies.', ARRAY['bank','nbfc','financial institution','lending','insurance','credit']),
('smb', 'SMBs', 'Small and medium businesses, often with informal or founder-dependent operations.', ARRAY['small business','family business','local business','founder-led']),
('ecommerce', 'Ecommerce & D2C', 'Direct-to-consumer brands and ecommerce retailers selling online.', ARRAY['ecommerce','online store','d2c','direct to consumer','online marketplace']),
('distribution', 'Dealer & Distribution Networks', 'Companies operating through a network of dealers, distributors, or franchisees.', ARRAY['distributor','distribution network','dealer network','franchise network','logistics'])
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- SEED DATA — Capabilities (8, mirrors the confirmed service lines in
-- DEMAZE_CAPABILITY_MAP.md / SERVICE_TO_OUTREACH_MAPPING.md)
-- ============================================================

INSERT INTO sales_knowledge_capabilities (slug, label, description, positioning_template, recommended_roles, recommended_cta) VALUES
('ai-business-applications', 'AI-powered business applications',
 'Custom AI application built around a decision the team already makes manually, not a generic AI strategy pitch.',
 'Practical AI applications built around the specific decision {{company}}''s team already makes manually — not a generic AI strategy pitch.',
 ARRAY['CEO','COO','VP Sales','VP Operations'],
 'Open to a quick discussion on how this is currently handled?'),

('custom-saas-platforms', 'Custom SaaS platforms',
 'A vertical-specific platform built from scratch, informed by direct delivered experience building similar products.',
 'A vertical-specific platform built from scratch for {{company}}''s exact workflow, informed by direct experience building similar products.',
 ARRAY['CTO','COO','Founder'],
 'Happy to share what we''ve built for similar-stage companies if useful.'),

('ecommerce-ecosystems', 'Ecommerce ecosystems',
 'Full ecommerce ecosystem build or extension — checkout, payments, and multi-channel data unification.',
 'A full ecommerce ecosystem build or extension for {{company}} — checkout, payments, and multi-channel data unification.',
 ARRAY['VP Ecommerce','Head of D2C','Founder','CMO'],
 'Worth 15 minutes to see how this could work across your channels?'),

('marketplace-platforms', 'Marketplace platforms',
 'Marketplace-specific architecture — two-sided matching, vendor onboarding, and trust systems.',
 'Marketplace-specific architecture for {{company}} — two-sided matching, vendor onboarding, and trust systems.',
 ARRAY['CTO','VP Product','Founder'],
 'Happy to share how we approached this for a similar network.'),

('workflow-automation-systems', 'Workflow automation systems',
 'Purpose-built workflow and lifecycle management system for a specific internal process.',
 'A purpose-built workflow and lifecycle management system for {{company}}''s specific process.',
 ARRAY['COO','VP Operations','Head of Customer Service'],
 'Open to seeing what this looks like automated?'),

('internal-operational-software', 'Internal operational software',
 'Custom internal operations platform giving HQ real-time visibility across distributed locations.',
 'A custom internal operations platform giving {{company}} real-time visibility across every location.',
 ARRAY['COO','VP Operations','Plant Head','CTO'],
 'Worth a quick look at what unified visibility could look like here?'),

('analytics-reporting-systems', 'Analytics and reporting systems',
 'Custom reporting layer and operational dashboards consolidating data that today exists but isn''t unified.',
 'A custom reporting layer and operational dashboards consolidating {{company}}''s data into one place.',
 ARRAY['CFO','COO','VP Operations','CEO'],
 'Happy to share what a unified dashboard could look like.'),

('ai-integrations-automation', 'AI integrations and intelligent automation',
 'Targeted AI integration into an existing stack, not a rip-and-replace.',
 'Targeted AI integration into {{company}}''s existing stack, not a rip-and-replace.',
 ARRAY['CTO','VP Engineering','Head of IT'],
 'Open to a quick chat on what''s possible here?')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- SEED DATA — Problems (8, one per capability, from each service's
-- "Likely Pain" in SERVICE_TO_OUTREACH_MAPPING.md)
-- ============================================================

INSERT INTO sales_knowledge_problems (slug, label, description, industry_tags, evidence_keywords, capability_tags) VALUES
('manual-decision-making', 'Manual, gut-feel decision-making instead of systematic intelligence',
 'Decisions like sales prioritization, lead scoring, or resource allocation are made on gut feel or spreadsheets instead of a system; distributed teams don''t get consistent guidance from HQ.',
 ARRAY['automotive','manufacturing','industrial'],
 ARRAY['dealer network','distributor network','regional offices','field teams','manually reviews','manual scoring','manual triage'],
 ARRAY['ai-business-applications']),

('no-fit-off-the-shelf-software', 'No off-the-shelf software fits their specific operational model',
 'The company is patching a specific, recurring business process with spreadsheets or disconnected tools because no existing software fits their exact model.',
 ARRAY['manufacturing','industrial','smb'],
 ARRAY['we use spreadsheets','internal tool','proprietary process','custom-built system','our own tool'],
 ARRAY['custom-saas-platforms']),

('fragmented-ecommerce-channels', 'Fragmented view across ecommerce sales channels',
 'Sales happen across an own site, marketplaces, and social commerce with no unified attribution or analytics across the funnel.',
 ARRAY['ecommerce','smb'],
 ARRAY['marketplaces','omnichannel','own site and','shop now','add to cart'],
 ARRAY['ecommerce-ecosystems']),

('manual-marketplace-vendor-coordination', 'Manual coordination of a growing two-sided vendor or partner network',
 'Onboarding, matching, and payments for a growing network of vendors, sellers, or partners is still handled manually and doesn''t scale.',
 ARRAY['ecommerce','distribution'],
 ARRAY['vendor network','seller onboarding','buyers and sellers','partners','merchant onboarding'],
 ARRAY['marketplace-platforms']),

('manual-handoffs-process-delay', 'Manual handoffs between teams causing delay or errors',
 'A multi-step process (complaints, orders, approvals) passes manually between teams with no visibility into where a request currently sits, risking missed deadlines or compliance issues.',
 ARRAY['manufacturing','industrial','financial-institutions'],
 ARRAY['complaint lifecycle','approval process','order lifecycle','multiple departments handle','sla breach'],
 ARRAY['workflow-automation-systems']),

('no-hq-visibility-multi-location', 'HQ lacks real-time visibility into distributed, multi-location operations',
 'Reporting from individual plants, offices, or locations back to HQ is manual, delayed, and inconsistent, with no single source of truth.',
 ARRAY['manufacturing','industrial','automotive'],
 ARRAY['multiple facilities','monthly reports','weekly updates','hq visibility','plant reporting'],
 ARRAY['internal-operational-software']),

('siloed-operational-data', 'Operational data siloed per-location or per-channel with no unified reporting view',
 'Data exists per-location, per-channel, or per-department but decisions are made without timely access to a consolidated view.',
 ARRAY['manufacturing','automotive','distribution'],
 ARRAY['dealer network','distributor network','franchise network','regional offices'],
 ARRAY['analytics-reporting-systems']),

('isolated-existing-tools-no-ai-layer', 'Existing CRM/ERP tools operate in isolation with no AI layer connecting them',
 'The company already has digital infrastructure (CRM, ERP, ecommerce platform) but no AI layer enhancing or connecting it, and repetitive content/analysis work is still done manually.',
 ARRAY['saas','manufacturing','financial-institutions'],
 ARRAY['sap','salesforce','netsuite','oracle erp','zoho crm','microsoft dynamics'],
 ARRAY['ai-integrations-automation'])
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- SEED DATA — Case Studies (25, copied from
-- lib/knowledge/demaze-proof-points.ts's DEMAZE_PROOF_POINTS)
-- ============================================================

INSERT INTO sales_knowledge_case_studies (title, client, provenance, industry_tags, capability_tags, challenge, outcomes, source_doc) VALUES

('Executive Intelligence Platform', 'Volvo Cars India', 'named_client',
 ARRAY['automotive','dealership'], ARRAY['cxo-dashboard','executive-reporting','analytics-reporting-systems','internal-operational-software'],
 'Dealership principals managing operations through daily WhatsApp updates, manual Excel MIS reports, and disconnected dashboards, with no unified view of business health.',
 '[{"metric":"Daily manual MIS reports retired","value":"4 to 0"},{"metric":"Leadership intervention time","value":"reduced from days to under 1 hour"},{"metric":"Multi-branch health comparison","value":"real-time (e.g. Mumbai 78/100 vs Pune 61/100)"}]'::jsonb,
 'Demaze_Technologies_AI_Case_Studies.pdf p.2'),

('Sales Intelligence AI', 'Volvo Cars India', 'named_client',
 ARRAY['automotive','dealership'], ARRAY['lead-scoring','sales-funnel','sales-coaching','ai-business-applications'],
 'Leads from digital campaigns, walk-ins, OEM portals, and telephony managed in silos; high-value leads not prioritised, inconsistent follow-up, no funnel visibility.',
 '[{"metric":"High-priority leads surfaced automatically","value":"from 40+ weekly enquiries"},{"metric":"Funnel drop-off addressed","value":"within 48 hours"}]'::jsonb,
 'Demaze_Technologies_AI_Case_Studies.pdf p.3'),

('Used Car Intelligence AI', 'Mercedes Benz India', 'named_client',
 ARRAY['automotive','dealership'], ARRAY['used-car-valuation','procurement','profitability-ai','ai-business-applications'],
 'Used car operations relied on gut-feel valuations, paper-based inspection, and no standardised view of inventory aging or margins; procurement was slow and inconsistent.',
 '[{"metric":"Projected margin per unit (XC60 MY2021, highest-demand variant)","value":"INR 65,000-80,000"},{"metric":"Valuation disputes","value":"eliminated via fully digital, auditable inspection trail"}]'::jsonb,
 'Demaze_Technologies_AI_Case_Studies.pdf p.4'),

('AI-Based Dealer Management Software', 'Mercedes Benz India (one of India''s largest luxury car dealerships)', 'named_client',
 ARRAY['automotive','dealership'], ARRAY['dealer-management-software','used-car-valuation','emi-calculation','custom-saas-platforms'],
 'Needed a single platform for used car valuations, new car EMI calculations, refurbishment tracking, and sales workflows instead of stitching together disconnected tools.',
 '[{"metric":"Operational efficiency","value":"significantly improved across dealership verticals"},{"metric":"Disconnected tools","value":"eliminated reliance on multiple"}]'::jsonb,
 'Demaze_Technologies_AI_Case_Studies.pdf p.5'),

('AI Risk Intelligence System', 'Active Trading Ecosystem Platform', 'named_client',
 ARRAY['fintech','trading'], ARRAY['risk-scoring','anomaly-detection','market-intelligence-alerts','ai-business-applications'],
 'Could not answer in real time which traders were becoming over-leveraged, which accounts showed abnormal behaviour, or which market signals could trigger risk spikes.',
 '[{"metric":"Risk monitoring","value":"real-time across all active traders and accounts"},{"metric":"Alerts","value":"predictive, issued before risk events occur"}]'::jsonb,
 'Demaze_Technologies_AI_Case_Studies.pdf p.6'),

('AI-Powered Luxury Ecommerce Platform', 'Sustainable Luxury Fashion Marketplace (pre-owned designer children''s clothing)', 'named_client',
 ARRAY['ecommerce','fashion','circular-economy'], ARRAY['marketplace-platform','personalization','blockchain-authentication','marketplace-platforms'],
 'Wanted a first-of-its-kind sustainable luxury marketplace combining AI personalisation, product authentication, live commerce, and circular fashion mechanics.',
 '[{"metric":"Category","value":"first AI-powered circular fashion marketplace for luxury children''s wear"},{"metric":"Authenticity","value":"guaranteed via blockchain Digital Product Passports"}]'::jsonb,
 'Demaze_Technologies_AI_Case_Studies.pdf p.7'),

('AI Storyboard Creation Platform', 'Film, Advertising & Content Production Industry', 'named_client',
 ARRAY['media','creative-technology'], ARRAY['generative-ai','content-automation','ai-integrations-automation'],
 'Traditional storyboard creation is slow, expensive, and requires skilled illustrators, slowing down pre-production visualisation.',
 '[{"metric":"Script-to-storyboard generation","value":"reduced from days to minutes"}]'::jsonb,
 'Demaze_Technologies_AI_Case_Studies.pdf p.8'),

('Factory AI Command Center', 'Composite: mid-market manufacturer running 4 plants and ~40 distributors', 'composite_illustrative',
 ARRAY['manufacturing','industrial'], ARRAY['cxo-dashboard','executive-reporting','analytics-reporting-systems','internal-operational-software'],
 'Leadership relied on a Monday MIS pack instead of live, cross-plant visibility into yield, downtime, and working capital.',
 '[{"metric":"OEE lift across 4 plants","value":"+9.4%","window":"6 months"},{"metric":"Time-to-insight for plant reviews","value":"-71%"},{"metric":"Daily manual MIS reports retired","value":"4 to 0"}]'::jsonb,
 'Demaze - Manufacturing AI OS Case Studies.pdf, Case Study 01'),

('AI Production Planning Engine', 'Composite: 3-line FMCG plant', 'composite_illustrative',
 ARRAY['manufacturing'], ARRAY['production-planning','workflow-automation-systems'],
 'Weekly production scheduling was manual and slow to re-plan when an order, breakdown, or raw-material delay hit.',
 '[{"metric":"Production lead time on top-50 SKUs","value":"-28%"},{"metric":"On-time delivery to customer commit","value":"+14%"},{"metric":"Re-planning speed vs. Excel-based PPC","value":"3.5x faster"}]'::jsonb,
 'Demaze - Manufacturing AI OS Case Studies.pdf, Case Study 02'),

('Predictive Maintenance AI', 'Composite: metal-fabrication plant running 60+ critical assets', 'composite_illustrative',
 ARRAY['manufacturing','industrial'], ARRAY['predictive-maintenance','iot','ai-integrations-automation'],
 'No way to predict asset failure ahead of time; maintenance was reactive, driving unplanned downtime.',
 '[{"metric":"Unplanned downtime on critical assets","value":"-47%"},{"metric":"OEE uplift from availability","value":"+11%"},{"metric":"Average early-warning window before failure","value":"14 days"}]'::jsonb,
 'Demaze - Manufacturing AI OS Case Studies.pdf, Case Study 03'),

('AI Quality Control on Line', 'Composite: discrete-parts assembly line', 'composite_illustrative',
 ARRAY['manufacturing'], ARRAY['quality-control','computer-vision','ai-business-applications'],
 'Manual QC missed real-time defect detection, driving rework cost and customer complaints.',
 '[{"metric":"Defect detection accuracy on golden set","value":"99.2%"},{"metric":"Defect rework cost per 1,000 units","value":"-54%"},{"metric":"Inspection throughput vs. manual QC","value":"4x"}]'::jsonb,
 'Demaze - Manufacturing AI OS Case Studies.pdf, Case Study 04'),

('DMS & Distributor Intelligence', 'Composite: consumer-durables brand with 140+ distributors across 12 states', 'composite_illustrative',
 ARRAY['manufacturing','distribution'], ARRAY['dms-intelligence','distributor-scoring','analytics-reporting-systems'],
 'No way to score distributor health or spot territory gaps where retailer demand existed but coverage was thin.',
 '[{"metric":"Secondary-sales visibility coverage","value":"+18%"},{"metric":"Scheme attainment","value":"87% vs. 51% baseline"},{"metric":"Credit-overdue ratio across the network","value":"-34%"}]'::jsonb,
 'Demaze - Manufacturing AI OS Case Studies.pdf, Case Study 09'),

('Distributor Credit & Cashflow AI', 'Composite: 142-dealer distribution network', 'composite_illustrative',
 ARRAY['manufacturing','distribution','fintech'], ARRAY['credit-risk-scoring','dunning-automation','workflow-automation-systems'],
 'No systematic way to predict overdue/bad-debt risk or chase collections without souring dealer relationships.',
 '[{"metric":"Days-sales-outstanding (DSO)","value":"-16 days"},{"metric":"Overdue receivables >30 days","value":"-41%"},{"metric":"Cash freed","value":"Rs 4.1 Cr","window":"first 6 months"}]'::jsonb,
 'Demaze - Manufacturing AI OS Case Studies.pdf, Case Study 10'),

('Multi-Warehouse Supply Chain AI', 'Composite: 6 distribution centers in India + 2 in East Africa', 'composite_illustrative',
 ARRAY['manufacturing','distribution','supply-chain'], ARRAY['supply-chain-optimization','inventory-balancing','internal-operational-software'],
 'No proactive way to rebalance SKUs across warehouses or spot cross-border logistics delay risk without growing inventory.',
 '[{"metric":"Fill-rate improvement","value":"+14 pts","window":"6 months"},{"metric":"Logistics cost per unit shipped","value":"-19%"},{"metric":"Working capital released across DCs","value":"Rs 3.4 Cr"}]'::jsonb,
 'Demaze - Manufacturing AI OS Case Studies.pdf, Case Study 17'),

('HR & Workforce Intelligence', 'Composite: 4 plants, 1,400+ operators', 'composite_illustrative',
 ARRAY['manufacturing','industrial'], ARRAY['workforce-optimization','attrition-prediction','analytics-reporting-systems'],
 'HR was spreadsheet-driven, with no way to predict attrition or match technicians to work orders by skill.',
 '[{"metric":"Overtime hours across the network","value":"-21%"},{"metric":"Voluntary attrition","value":"-14 pts","window":"12 months"},{"metric":"Optimal tech-to-WO match rate","value":"94%"}]'::jsonb,
 'Demaze - Manufacturing AI OS Case Studies.pdf, Case Study 06'),

('Manufacturing AI OS — Aggregate Impact', 'Composite: aggregate median across 19 real Demaze manufacturing engagements', 'composite_illustrative',
 ARRAY['manufacturing','industrial','distribution'], ARRAY['aggregate-impact','internal-operational-software','analytics-reporting-systems'],
 'Cross-engagement summary, not a single company''s challenge — use only when no single-workflow proof point is a closer match.',
 '[{"metric":"OEE / output uplift","value":"+14%","window":"median, first 6 months post go-live"},{"metric":"Faster decisioning","value":"3.2x"},{"metric":"Working capital released","value":"Rs 3.4 Cr","window":"median"},{"metric":"From kickoff to KPI move","value":"90 days"}]'::jsonb,
 'Demaze - Manufacturing AI OS Case Studies.pdf, Aggregate Impact p.22'),

('CXO AI Command Center', 'Composite: multi-brand dealership group operating 30+ outlets', 'composite_illustrative',
 ARRAY['automotive','dealership'], ARRAY['cxo-dashboard','executive-reporting','analytics-reporting-systems'],
 'Leadership relied on a weekly analyst pack instead of a live, conversational view of margin, retail, and service KPIs.',
 '[{"metric":"Time-to-insight for leadership reviews","value":"-72%"},{"metric":"FTE analyst dependency for recurring MIS","value":"5 to 0"},{"metric":"Margin lift on flagged anomalies actioned within 48h","value":"+14%"}]'::jsonb,
 'Demaze - AI for Automotive Case Studies.pdf, Case Study 01'),

('Predictive Service & Workshop AI', 'Composite: authorised service network running 9 workshops', 'composite_illustrative',
 ARRAY['automotive','dealership','after-sales'], ARRAY['predictive-maintenance','bay-scheduling','workflow-automation-systems'],
 'No predictive view of upcoming service needs or bay utilisation, leading to longer turnaround and lower revenue per customer.',
 '[{"metric":"Bay utilisation across the network","value":"+27%"},{"metric":"Vehicle turnaround time per RO","value":"-34%"},{"metric":"Next-service prediction accuracy (+/-500km)","value":"94%"}]'::jsonb,
 'Demaze - AI for Automotive Case Studies.pdf, Case Study 04'),

('AI Voice Agents for Sales & Service', 'Composite: multi-language workshop cluster', 'composite_illustrative',
 ARRAY['automotive','dealership','after-sales'], ARRAY['voice-agents','multilingual-support','ai-integrations-automation'],
 'Service reminders, missed-lead callbacks, and feedback calls were manual and expensive to staff at scale.',
 '[{"metric":"Calls handled per month per workshop cluster","value":"38,000"},{"metric":"Cost per outbound contact vs. tele-callers","value":"-68%"},{"metric":"Service booking conversion on due reminders","value":"+24%"}]'::jsonb,
 'Demaze - AI for Automotive Case Studies.pdf, Case Study 05'),

('AI Sales Co-Pilot & Lead Intelligence', 'Composite: 14-showroom passenger-car retailer', 'composite_illustrative',
 ARRAY['automotive','dealership'], ARRAY['lead-scoring','sales-copilot','ai-business-applications'],
 'Consultants had no scoring or next-best-action guidance on walk-in and digital leads, leaving conversion to instinct.',
 '[{"metric":"Lead-to-booking conversion in pilot quarter","value":"+31%"},{"metric":"Manual lead admin time per consultant","value":"-47%"},{"metric":"Test-drives per active consultant per week","value":"2.4x"}]'::jsonb,
 'Demaze - AI for Automotive Case Studies.pdf, Case Study 06'),

('AI for Automotive — Aggregate Impact', 'Composite: aggregate median across 10 real Demaze automotive engagements', 'composite_illustrative',
 ARRAY['automotive','dealership'], ARRAY['aggregate-impact','analytics-reporting-systems'],
 'Cross-engagement summary, not a single company''s challenge — use only when no single-workflow proof point is a closer match.',
 '[{"metric":"Revenue per outlet","value":"+18%","window":"median, 6-month window post-go-live"},{"metric":"Operating cost-to-serve","value":"-42%"},{"metric":"Faster decisioning","value":"3.4x"},{"metric":"From kickoff to KPI move","value":"90 days"}]'::jsonb,
 'Demaze - AI for Automotive Case Studies.pdf, Aggregate Impact p.13'),

('Multi-Vendor Ecommerce Marketplace', 'Composite: Australia and New Zealand''s leading online marketplace', 'composite_illustrative',
 ARRAY['ecommerce','retail'], ARRAY['marketplace-platform','marketplace-platforms'],
 'Needed a multi-vendor marketplace covering category browsing, live auction, wishlist, and multiple payment options at scale.',
 '[{"metric":"Lighthouse score","value":"99%"},{"metric":"Reach for retailers","value":"increased"}]'::jsonb,
 'Demaze Technologies - Profile & Portfolio.pdf, Case study 3'),

('Investigative Case Management Software', 'Composite: private investigator case-management platform', 'composite_illustrative',
 ARRAY['legal-tech','services'], ARRAY['case-management','document-automation','custom-saas-platforms'],
 'Private investigators needed secure, organised case/media management with automated workflow instead of ad-hoc tools.',
 '[{"metric":"Workflow","value":"automated case management, document automation, secure data storage"}]'::jsonb,
 'Demaze Technologies - Profile & Portfolio.pdf, Case study 5'),

('Global Payment Transfer Platform', 'Composite: blockchain-based global money transfer platform', 'composite_illustrative',
 ARRAY['fintech','payments'], ARRAY['blockchain','cross-border-payments','custom-saas-platforms'],
 'Needed fast, low-cost, secure cross-border transactions without traditional banking intermediaries.',
 '[{"metric":"Transaction cost and processing time","value":"reduced via stablecoin integration, no intermediaries"}]'::jsonb,
 'Demaze Technologies - Profile & Portfolio.pdf, Case study 8'),

('CMA Report Generation Software', 'Composite: Credit Monitoring Arrangement (CMA) report platform (India)', 'composite_illustrative',
 ARRAY['financial-institutions','fintech'], ARRAY['report-automation','document-automation','workflow-automation-systems'],
 'CMA report preparation was manual and slow, with no standard cloud-based way to build, edit, and export reports.',
 '[{"metric":"Report preparation","value":"automated with PDF/Excel export"}]'::jsonb,
 'Demaze Technologies - Profile & Portfolio.pdf, Case study 9')

ON CONFLICT DO NOTHING;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('sales_knowledge_industries', 'sales_knowledge_problems', 'sales_knowledge_capabilities', 'sales_knowledge_case_studies')
ORDER BY table_name;

SELECT 'industries' AS entity, count(*) FROM sales_knowledge_industries
UNION ALL SELECT 'problems', count(*) FROM sales_knowledge_problems
UNION ALL SELECT 'capabilities', count(*) FROM sales_knowledge_capabilities
UNION ALL SELECT 'case_studies', count(*) FROM sales_knowledge_case_studies;
