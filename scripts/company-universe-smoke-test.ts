import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

// ============================================================
// Company Universe — live provider smoke test
// ============================================================
// One real search() + one real getCompany() call per provider, against the
// actual live APIs (no mocking). This is the missing half of
// docs/company-universe-final-report.md's Section L risk #1: every provider
// in lib/company-universe/providers/ was built and unit-tested against
// documented API contracts only, with zero live verification, because the
// session that built them had its network egress blocked to all 5 provider
// domains (see that report for the full history).
//
// Run this ONLY once you've confirmed (a) this environment's egress policy
// allows outbound HTTPS to api.gleif.org / data.sec.gov / www.sec.gov /
// api.opencorporates.com / api.company-information.service.gov.uk /
// api.data.gov.in, and (b) you're comfortable spending whatever real quota
// each configured provider charges for a handful of calls (GLEIF and SEC
// EDGAR are free/unmetered; OpenCorporates/Companies House/India MCA may
// count against a real quota once keys are set).
//
//   npx tsx scripts/company-universe-smoke-test.ts
//
// Per this project's own standing "IMPLEMENTED vs LIVE VERIFIED vs LIVE
// VERIFICATION BLOCKED" discipline (see the task that produced this
// script): do not read a clean run of this script as "production ready" —
// it proves the adapter can complete one real round trip, not real-world
// data quality, coverage, rate-limit behavior, or cost at scale. Those need
// the fuller validation task this script is step 1 of.
//
// A provider with no API key configured is expected to report
// configured:false and get skipped — that's a correct, honest result, not
// a script bug. Re-run after adding a key to actually test that provider.
// ============================================================

import { ALL_PROVIDERS } from "../lib/company-universe/providers";
import type {
  CompanyDataProvider,
  ProviderHealthCheckResult,
} from "../lib/company-universe/types";

const DIVIDER = "─".repeat(70);

// One real, findable company per provider's actual coverage (per
// docs/company-universe-final-report.md's own coverage table) — not
// synthetic names, so a "not found" result is informative rather than
// expected-by-construction.
const SEARCH_QUERY: Record<CompanyDataProvider["name"], { name: string; countryCode?: string }> = {
  gleif: { name: "Apple" },
  sec_edgar: { name: "Apple" },
  opencorporates: { name: "Apple", countryCode: "US" },
  companies_house: { name: "Tesco", countryCode: "GB" },
  india_mca: { name: "Tata", countryCode: "IN" },
};

// A second, direct-lookup identifier per provider (bypasses search's
// fuzzy/name-matching path — exercises getCompany()'s own request shape
// independently). Values are real, well-known identifiers.
const LOOKUP_IDENTIFIER: Record<CompanyDataProvider["name"], Record<string, string>> = {
  gleif: { lei: "HWUPKR0MPOU8FGXBT394" }, // Apple Inc.'s real LEI
  sec_edgar: { cik: "0000320193" }, // Apple Inc.'s real CIK
  opencorporates: { name: "Apple Inc", registrationAuthority: "us_de" },
  companies_house: { companyNumber: "00445790" }, // Tesco PLC's real company number
  india_mca: { name: "Tata Consultancy Services" }, // no CIN on hand; exercises the name-lookup path
};

interface ProviderResult {
  provider: string
  displayName: string
  health: ProviderHealthCheckResult
  searchOutcome?: string
  searchSampleName?: string
  searchError?: string
  lookupOutcome?: string
  lookupError?: string
}

async function testProvider(provider: CompanyDataProvider): Promise<ProviderResult> {
  const result: ProviderResult = {
    provider: provider.name,
    displayName: provider.displayName,
    health: await provider.healthCheck(),
  };

  if (!result.health.configured) {
    // Correct, expected outcome for a provider with no key set — not an
    // error, just nothing further to test until credentials exist.
    return result;
  }

  if (provider.capabilities.search) {
    try {
      const query = SEARCH_QUERY[provider.name];
      const searchResult = await provider.search({ ...query, limit: 3 });
      if (searchResult.error) {
        result.searchOutcome = "error";
        result.searchError = searchResult.error;
      } else {
        result.searchOutcome = `${searchResult.records.length} record(s)`;
        result.searchSampleName = searchResult.records[0]?.fields.canonicalName;
      }
    } catch (err) {
      result.searchOutcome = "threw";
      result.searchError = err instanceof Error ? err.message : String(err);
    }
  }

  if (provider.capabilities.getCompany) {
    try {
      const record = await provider.getCompany(LOOKUP_IDENTIFIER[provider.name]);
      result.lookupOutcome = record ? `found: ${record.fields.canonicalName}` : "not found";
    } catch (err) {
      result.lookupOutcome = "threw";
      result.lookupError = err instanceof Error ? err.message : String(err);
    }
  }

  return result;
}

async function run() {
  console.log(DIVIDER);
  console.log("Company Universe — live provider smoke test");
  console.log(DIVIDER);
  console.log(
    `Testing ${ALL_PROVIDERS.length} providers: ${ALL_PROVIDERS.map((p) => p.name).join(", ")}\n`
  );

  const results: ProviderResult[] = [];
  for (const provider of ALL_PROVIDERS) {
    console.log(`--- ${provider.displayName} (${provider.name}) ---`);
    const result = await testProvider(provider);
    results.push(result);

    console.log(
      `  healthCheck: configured=${result.health.configured} healthy=${result.health.healthy}` +
        (result.health.reason ? ` reason="${result.health.reason}"` : "") +
        (result.health.latencyMs !== undefined ? ` (${result.health.latencyMs}ms)` : "")
    );

    if (!result.health.configured) {
      console.log("  SKIPPED search/getCompany — provider not configured (see reason above)\n");
      continue;
    }

    if (result.searchOutcome) {
      console.log(
        `  search():      ${result.searchOutcome}` +
          (result.searchSampleName ? ` — e.g. "${result.searchSampleName}"` : "") +
          (result.searchError ? ` — ${result.searchError}` : "")
      );
    }
    if (result.lookupOutcome) {
      console.log(
        `  getCompany():  ${result.lookupOutcome}` +
          (result.lookupError ? ` — ${result.lookupError}` : "")
      );
    }
    console.log("");
  }

  console.log(DIVIDER);
  console.log("SUMMARY (per this project's IMPLEMENTED vs LIVE VERIFIED discipline)");
  console.log(DIVIDER);
  for (const r of results) {
    let status: string;
    if (!r.health.configured) {
      status = "IMPLEMENTED — LIVE VERIFICATION BLOCKED (no API key/config set)";
    } else if (!r.health.healthy) {
      status = `IMPLEMENTED — LIVE VERIFICATION BLOCKED (healthCheck failed: ${r.health.reason ?? "unknown"})`;
    } else if (r.searchError || r.lookupError) {
      status = "IMPLEMENTED — LIVE VERIFICATION PARTIAL (healthCheck passed, but search/lookup errored — see detail above)";
    } else {
      status = "IMPLEMENTED — LIVE VERIFIED (real search + real lookup both completed)";
    }
    console.log(`  ${r.displayName.padEnd(20)} ${status}`);
  }
  console.log(DIVIDER);
  console.log(
    "\nNote: a 'LIVE VERIFIED' line here means one real round trip completed for one\n" +
      "well-known company. It does NOT mean data quality, coverage, rate limits, or\n" +
      "cost at scale have been measured — that's the fuller validation task, not this script."
  );
}

run().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
