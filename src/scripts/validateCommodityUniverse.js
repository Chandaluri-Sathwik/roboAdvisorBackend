
import "dotenv/config";
import axios from "axios";
import { commodityUniverse, seedOptions } from "../config/assetUniverse.js";

const API_URL = "https://www.alphavantage.co/query";

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function isValidDate(value) {
  return value && !Number.isNaN(Date.parse(value));
}

async function main() {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) {
    throw new Error("ALPHA_VANTAGE_API_KEY is missing from .env");
  }

  const commodities = [...new Set(commodityUniverse)];
  const interval = seedOptions.commodityInterval || "monthly";
  const results = [];

  console.log(`Checking ${commodities.length} commodities`);
  console.log(`Interval: ${interval}\n`);

  for (const commodity of commodities) {
    try {
      const response = await axios.get(API_URL, {
        params: {
          function: commodity,
          interval,
          apikey: apiKey
        },
        timeout: 30000
      });

      const payload = response.data;

      // Alpha Vantage can return an error or rate-limit message
      // inside an otherwise successful HTTP response.
      const apiMessage =
        payload?.["Error Message"] ||
        payload?.Note ||
        payload?.Information;

      if (apiMessage) {
        console.log(`✗ ${commodity}: ${apiMessage}`);
        results.push({
          commodity,
          status: "API ERROR",
          records: 0,
          latestDate: "",
          latestValue: "",
          message: apiMessage
        });
        await sleep(1500);
        continue;
      }

      // Find the array containing observations.
      const rows = Object.values(payload ?? {}).find(Array.isArray);

      if (!rows || rows.length === 0) {
        console.log(`✗ ${commodity}: no observation array found`);
        results.push({
          commodity,
          status: "NO DATA",
          records: 0,
          latestDate: "",
          latestValue: "",
          message: "No observation array in response"
        });
        await sleep(1500);
        continue;
      }

      const validRows = rows.filter((row) => {
        const date = row.date ?? row.Date;
        const rawValue = row.value ?? row.Value;

        return (
          isValidDate(date) &&
          rawValue !== undefined &&
          rawValue !== null &&
          rawValue !== "" &&
          Number.isFinite(Number(rawValue))
        );
      });

      if (validRows.length === 0) {
        console.log(`✗ ${commodity}: observations have invalid dates or values`);
        results.push({
          commodity,
          status: "INVALID DATA",
          records: rows.length,
          latestDate: "",
          latestValue: "",
          message: "No valid date/value pairs found"
        });
        await sleep(1500);
        continue;
      }

      // Select the newest observation by date.
      validRows.sort((a, b) => {
        const dateA = Date.parse(a.date ?? a.Date);
        const dateB = Date.parse(b.date ?? b.Date);
        return dateB - dateA;
      });

      const latest = validRows[0];
      const latestDate = latest.date ?? latest.Date;
      const latestValue = Number(latest.value ?? latest.Value);

      console.log(
        `✓ ${commodity}: ${validRows.length} valid records | ` +
        `latest: ${latestDate} | value: ${latestValue}`
      );

      results.push({
        commodity,
        status: "OK",
        records: validRows.length,
        latestDate,
        latestValue,
        message: ""
      });
    } catch (error) {
      const message =
        error.response?.data?.["Error Message"] ||
        error.message;

      console.log(`✗ ${commodity}: ${message}`);

      results.push({
        commodity,
        status: "REQUEST FAILED",
        records: 0,
        latestDate: "",
        latestValue: "",
        message
      });
    }

    // Pause between requests to reduce the risk of hitting rate limits.
    await sleep(1500);
  }

  console.log("\n========== COMMODITY VALIDATION SUMMARY ==========");
  console.table(results);

  const passed = results.filter((r) => r.status === "OK").length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Needs investigation: ${results.length - passed}`);

  // Save the results to a JSON file if desired in a later step.
  if (passed !== results.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Commodity validation failed:", error.message);
  process.exitCode = 1;
});
