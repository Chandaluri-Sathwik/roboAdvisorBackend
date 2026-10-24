
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";

import {
  fetchStockHistory,
  fetchCommodityHistory,
  fetchBondYields,
  fetchMutualFundHistory,
} from "../services/assetDataService.js";

import { saveHistory } from "../controllers/assetController.js";

import {
  stockUniverse,
  mutualFundUniverse,
  commodityUniverse,
  bondUniverse,
  seedOptions,
} from "../config/assetUniverse.js";

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const runTask = async (label, fetcher) => {
  try {
    const records = await fetcher();
    const savedCount = await saveHistory(records);

    console.log(
      `✓ ${label}: fetched ${records.length}, processed ${savedCount}`
    );

    return {
      label,
      fetched: records.length,
      saved: savedCount,
      error: null,
    };
  } catch (error) {
    console.error(`✗ ${label}: ${error.message}`);

    return {
      label,
      fetched: 0,
      saved: 0,
      error: error.message,
    };
  }
};

const main = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from .env.");
  }

  await connectDB();

  try {
    const results = [];

    // STOCKS
    const uniqueStocks = [...new Set(stockUniverse)];

    for (const symbol of uniqueStocks) {
      results.push(
        await runTask(`stock ${symbol}`, () =>
          fetchStockHistory({
            symbol,
            exchange: seedOptions.exchange,
            from: seedOptions.from,
            to: seedOptions.to,
          })
        )
      );

      await sleep(seedOptions.delayMs);
    }

    // MUTUAL FUNDS
    if (mutualFundUniverse.length === 0) {
      console.warn(
        "! No mutual-fund scheme codes configured; skipping mutual funds."
      );
    }

    for (const fund of mutualFundUniverse) {
      const schemeCode =
        typeof fund === "object" && fund !== null
          ? fund.schemeCode
          : fund;

      const schemeName =
        typeof fund === "object" && fund !== null
          ? fund.schemeName
          : undefined;

      if (
        schemeCode === undefined ||
        schemeCode === null ||
        String(schemeCode).trim() === ""
      ) {
        results.push({
          label: "mutual fund (invalid scheme entry)",
          fetched: 0,
          saved: 0,
          error:
            "Expected a numeric scheme code or an object containing schemeCode.",
        });

        continue;
      }

      results.push(
        await runTask(
          `mutual fund ${schemeCode}${
            schemeName ? ` (${schemeName})` : ""
          }`,
          () => fetchMutualFundHistory({ schemeCode })
        )
      );

      await sleep(seedOptions.delayMs);
    }

    // COMMODITIES
    for (const commodity of commodityUniverse) {
      results.push(
        await runTask(`commodity ${commodity}`, () =>
          fetchCommodityHistory({
            commodity,
            interval: seedOptions.commodityInterval,
          })
        )
      );

      await sleep(seedOptions.delayMs);
    }

    // BONDS / GOVERNMENT-SECURITY YIELDS
    if (bondUniverse.length === 0) {
      console.warn("! No bond datasets configured; skipping bond yields.");
    } else {
      // Your current configuration has one RBI dataset entry.
      // It represents a yield dataset, not individual tradable bonds.
      for (const bondDataset of bondUniverse) {
        if (bondDataset !== "RBI_DBIE_GOVT_SECURITY_YIELDS") {
          results.push({
            label: `bond dataset ${bondDataset}`,
            fetched: 0,
            saved: 0,
            error: "Unsupported bond dataset identifier.",
          });

          continue;
        }

        results.push(
          await runTask(
            "RBI government-security yields",
            () => fetchBondYields()
          )
        );
      }
    }

    // SUMMARY
    const succeeded = results.filter((item) => !item.error).length;
    const failed = results.filter((item) => item.error).length;
    const fetched = results.reduce(
      (sum, item) => sum + item.fetched,
      0
    );
    const saved = results.reduce(
      (sum, item) => sum + item.saved,
      0
    );

    console.log("\n========== SEED SUMMARY ==========");
    console.log(
      `Tasks: ${results.length} | succeeded: ${succeeded} | failed: ${failed}`
    );
    console.log(
      `Fetched records: ${fetched} | processed records: ${saved}`
    );

    if (failed > 0) {
      console.log("\nFailed tasks:");

      for (const item of results.filter((row) => row.error)) {
        console.log(`- ${item.label}: ${item.error}`);
      }
    }

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await mongoose.disconnect();
  }
};

main().catch(async (error) => {
  console.error("Asset history seed failed:", error.message);
  process.exitCode = 1;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

