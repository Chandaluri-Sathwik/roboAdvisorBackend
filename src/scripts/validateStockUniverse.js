
import "dotenv/config";
import axios from "axios";
import { stockUniverse, seedOptions } from "../config/assetUniverse.js";

const BASE_URL = "https://api.tejhq.dev";

async function main() {
  const symbols = [...new Set(stockUniverse)];

  console.log(`Checking ${symbols.length} unique stock symbols...\n`);

  const results = [];

  for (const symbol of symbols) {
    try {
      const response = await axios.get(
        `${BASE_URL}/v1/ohlcv/${seedOptions.exchange}/${encodeURIComponent(symbol)}`,
        {
          params: {
            from: "2025-01-01",
            to: "2025-01-10"
          },
          timeout: 20000
        }
      );

      const data = response.data?.data;
      const meta = response.data?.meta;

      if (
        Array.isArray(data) &&
        data.length > 0 &&
        String(meta?.symbol).toUpperCase() === symbol.toUpperCase() &&
        String(meta?.exchange).toUpperCase() === seedOptions.exchange.toUpperCase()
      ) {
        console.log(`✓ ${symbol}: ${data.length} records`);
        results.push({ symbol, status: "OK", records: data.length });
      } else {
        console.log(`⚠ ${symbol}: response empty or identity not confirmed`);
        results.push({ symbol, status: "CHECK RESPONSE", records: data?.length ?? 0 });
      }
    } catch (error) {
      const status = error.response?.status ?? "Network error";
      console.log(`✗ ${symbol}: request failed (${status})`);
      results.push({ symbol, status: `FAILED: ${status}`, records: 0 });
    }

    // Small pause between requests
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const passed = results.filter((item) => item.status === "OK").length;
  const failed = results.length - passed;

  console.log("\n========== VALIDATION SUMMARY ==========");
  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Needs checking: ${failed}`);

  console.table(results);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
