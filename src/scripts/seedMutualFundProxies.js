import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import { mutualFundUniverse } from "../config/assetUniverse.js";
import { saveHistory } from "../controllers/assetController.js";
import { fetchMutualFundHistory } from "../services/assetDataService.js";
import { analyzeHistoricalSeries } from "../services/marketAnalysisService.js";
import { validateConfiguredFundMetadata } from "../services/fundDataValidation.js";
import { retryTransient } from "../services/transientRetry.js";

async function seedFund(fund) {
  const records = await retryTransient(
    () => fetchMutualFundHistory({ schemeCode: fund.schemeCode }),
    {
      onRetry: (error, attempt, attempts) => {
        console.warn(
          `MFapi temporary failure for scheme ${fund.schemeCode} ` +
          `(${error.message}); retrying ${attempt}/${attempts}.`,
        );
      },
    },
  );
  const metadata = validateConfiguredFundMetadata(fund, records);
  const analysis = analyzeHistoricalSeries({
    assetType: "mutualFund",
    rows: records,
    expectedCurrency: "INR",
    expectedSource: "MFapi.in",
  });

  const futureRecords = analysis.data_quality.future_observation_count;
  if (futureRecords > 0) {
    throw new Error(
      `${metadata.schemeName}: provider returned ${futureRecords} future-dated NAV observation(s); refusing to seed this series.`,
    );
  }

  const savedCount = await saveHistory(records);
  console.log(
    `${analysis.status === "exploratory_metrics_available" ? "✓" : "!"} ` +
    `${fund.assetClass} proxy ${metadata.schemeName}: ` +
    `${records.length} fetched, ${savedCount} saved, ` +
    `latest ${analysis.data_quality.latest_date ?? "unavailable"}, ` +
    `analysis ${analysis.status}` +
    (analysis.data_quality.reasons.length
      ? ` (${analysis.data_quality.reasons.join(", ")})`
      : ""),
  );
  return { schemeCode: fund.schemeCode, savedCount };
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from .env.");
  }

  await connectDB();
  let failures = 0;

  try {
    for (const fund of mutualFundUniverse) {
      try {
        await seedFund(fund);
      } catch (error) {
        failures++;
        console.error(
          `✗ ${fund.assetClass} proxy ${fund.schemeCode}: ${error.message}`,
        );
      }
    }

    console.log(
      `Mutual-fund proxy seed completed: ${mutualFundUniverse.length - failures} succeeded, ${failures} failed.`,
    );
    if (failures > 0) process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error("Mutual-fund proxy seed failed:", error.message);
  process.exitCode = 1;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});
