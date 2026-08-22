// ============================================================
// Coresignal live smoke test
// ============================================================
// Proves Coresignal can supply genuine companies matching Demaze's real
// ICP — a representative query (Manufacturing companies, India, SME/
// mid-market employee range), run against the real API with the
// configured CORESIGNAL_API_KEY. Never fabricates a result: if the key is
// missing or the API call fails, this prints the real error and exits
// non-zero rather than pretending success.
//
// Run with: npx tsx scripts/coresignal-smoke-test.ts
// ============================================================
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getCoresignalApiKey } from "../lib/enrichment/sources/coresignal-client";
import { discoverCompaniesFromCoresignal } from "../lib/enrichment/coresignal-discovery";

async function run() {
  if (!getCoresignalApiKey()) {
    console.error(
      "CORESIGNAL_API_KEY is not set in .env.local — nothing to test. " +
      "Add a real key (see .env.example) and re-run."
    );
    process.exit(1);
  }

  // Representative of Demaze's actual ICP (CLAUDE.md's confirmed target
  // industries + geography): manufacturing companies in India, roughly
  // SME/mid-market scale (50-1000 employees) rather than global mega-caps.
  const filters = {
    industry: "Manufacturing",
    country: "India",
    employeesCountGte: 50,
    employeesCountLte: 1000,
  };

  console.log("Querying Coresignal:", JSON.stringify(filters, null, 2));
  const started = Date.now();

  const result = await discoverCompaniesFromCoresignal(filters, undefined, { maxResults: 25 });

  console.log(`\nDone in ${Date.now() - started}ms`);
  console.log(`Sufficiency: ${result.sufficiency}`);
  console.log(`Reason: ${result.reason}`);
  console.log(`Candidates considered: ${result.candidates_considered}`);
  console.log(`Companies returned: ${result.companies.length}`);

  if (result.companies.length > 0) {
    console.log("\nSample companies:");
    for (const c of result.companies.slice(0, 10)) {
      console.log(`- ${c.name} | domain=${c.domain ?? "(none)"} | confidence=${c.confidence} | ${c.reason}`);
    }
  }

  if (result.rejected_candidates && result.rejected_candidates.length > 0) {
    console.log(`\nRejected during filtering (${result.rejected_candidates.length}):`);
    for (const r of result.rejected_candidates.slice(0, 10)) {
      console.log(`- ${r.name}: ${r.reason}`);
    }
  }

  if (result.sufficiency === "insufficient") {
    console.error("\nNo usable companies returned — see reason above.");
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("Coresignal smoke test failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
