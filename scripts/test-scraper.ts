import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import {
  scrapeCompanyWebsite,
  assessScrapeQuality,
} from "../lib/pipeline/scraper";

async function run() {
  const result = await scrapeCompanyWebsite(
    "mahindra.com"
  );

  const quality = assessScrapeQuality(result);

  console.log("Successful URLs:", result.successfulUrls.length);
  console.log("Failed URLs:", result.failedUrls.length);
  console.log("Quality Score:", quality.score);
  console.log("Characters:", result.totalCharCount);

  console.log(
    result.combinedContent.slice(0, 2000)
  );
}

run().catch(console.error);