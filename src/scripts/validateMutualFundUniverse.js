
import "dotenv/config";
import axios from "axios";

const BASE_URL = "https://api.mfapi.in/mf";
const REQUEST_DELAY_MS = 350;
const CANDIDATES_PER_CATEGORY = 5;

// Search terms are used to discover Indian mutual fund schemes.
// We'll shortlist a few Direct Growth schemes from each category.
const SEARCH_GROUPS = [
  { label: "Large Cap", query: "large cap" },
  { label: "Flexi Cap", query: "flexi cap" },
  { label: "Mid Cap", query: "mid cap" },
  { label: "Small Cap", query: "small cap" },
  { label: "Nifty 50 Index", query: "nifty 50 index" },
  { label: "Nifty Next 50 Index", query: "nifty next 50 index" },
  { label: "Short Duration Debt", query: "short duration" },
  { label: "Liquid Fund", query: "liquid fund" },
  { label: "Balanced Advantage", query: "balanced advantage" },
  { label: "Aggressive Hybrid", query: "aggressive hybrid" },
];

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function isDirectGrowthScheme(name = "") {
  const normalized = name.toLowerCase();

  // Exclude regular plans and IDCW/dividend options.
  return (
    normalized.includes("direct") &&
    normalized.includes("growth") &&
    !normalized.includes("bonus") &&
    !normalized.includes("idcw") &&
    !normalized.includes("dividend") &&
    !normalized.includes("payout") &&
    !normalized.includes("reinvestment")
  );
}

function parseNavDate(dateString) {
  // MFapi historical NAV dates use DD-MM-YYYY.
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(
    String(dateString ?? "")
  );

  if (!match) return null;

  const [, day, month, year] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day))
  );

  // Reject invalid dates such as 32-13-2025.
  if (
    date.getUTCDate() !== Number(day) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCFullYear() !== Number(year)
  ) {
    return null;
  }

  return date;
}

async function searchSchemes(query) {
  const response = await axios.get(`${BASE_URL}/search`, {
    params: { q: query },
    timeout: 20000,
  });

  if (!Array.isArray(response.data)) {
    throw new Error("Unexpected scheme-search response");
  }

  return response.data;
}

async function validateScheme(candidate) {
  const code = candidate.schemeCode;

  try {
    const response = await axios.get(`${BASE_URL}/${code}`, {
      timeout: 20000,
    });

    const payload = response.data;
    const meta = payload?.meta;
    const navRows = payload?.data;

    if (
      payload?.status !== "SUCCESS" ||
      !meta ||
      !Array.isArray(navRows) ||
      navRows.length === 0
    ) {
      return {
        ...candidate,
        valid: false,
        category: meta?.scheme_category ?? "Unknown",
        fundHouse: meta?.fund_house ?? "Unknown",
        recordCount: navRows?.length ?? 0,
        latestDate: "-",
        latestNAV: "-",
        reason: "No usable NAV history returned",
      };
    }

    const validRows = navRows
      .map((row) => {
        const date = parseNavDate(row.date);
        const nav = Number(row.nav);

        if (!date || !Number.isFinite(nav) || nav <= 0) {
          return null;
        }

        return { date, nav };
      })
      .filter(Boolean)
      .sort((a, b) => b.date - a.date);

    const latest = validRows[0];

    const actualName = meta.scheme_name ?? candidate.schemeName;

    return {
      ...candidate,
      schemeName: actualName,
      valid: validRows.length > 0,
      category: meta.scheme_category ?? "Unknown",
      fundHouse: meta.fund_house ?? "Unknown",
      recordCount: validRows.length,
      latestDate: latest
        ? latest.date.toISOString().slice(0, 10)
        : "-",
      latestNAV: latest ? latest.nav.toFixed(4) : "-",
      reason: validRows.length > 0
        ? "OK"
        : "No valid positive NAV records",
    };
  } catch (error) {
    return {
      ...candidate,
      valid: false,
      category: "Unknown",
      fundHouse: "Unknown",
      recordCount: 0,
      latestDate: "-",
      latestNAV: "-",
      reason:
        error.response?.status
          ? `HTTP ${error.response.status}`
          : error.message,
    };
  }
}

async function main() {
  const candidates = new Map();
  const searchErrors = [];

  console.log("\nSearching Indian mutual fund schemes...\n");

  // Discover candidates by category.
  for (const group of SEARCH_GROUPS) {
    try {
      const results = await searchSchemes(group.query);

      const matches = results
        .filter((item) => item.schemeCode && item.schemeName)
        .filter((item) => isDirectGrowthScheme(item.schemeName));

      let added = 0;

      for (const item of matches) {
        const code = Number(item.schemeCode);

        if (!Number.isInteger(code) || candidates.has(code)) {
          continue;
        }

        candidates.set(code, {
          schemeCode: code,
          schemeName: item.schemeName,
          searchGroup: group.label,
        });

        added++;

        if (added >= CANDIDATES_PER_CATEGORY) break;
      }

      console.log(
        `${group.label}: ${added} candidate(s) selected`
      );
    } catch (error) {
      searchErrors.push({
        category: group.label,
        error: error.message,
      });

      console.log(
        `${group.label}: SEARCH FAILED - ${error.message}`
      );
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const candidateList = [...candidates.values()];

  if (candidateList.length === 0) {
    console.error(
      "\nNo candidates found. Check the API response and search terms."
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nFound ${candidateList.length} unique candidates. Checking NAV history...\n`
  );

  const results = [];

  // Validate the actual history endpoint for each candidate.
  for (const candidate of candidateList) {
    const result = await validateScheme(candidate);
    results.push(result);

    console.log(
      `${result.valid ? "PASS" : "FAIL"} | ` +
      `${result.schemeCode} | ${result.schemeName}`
    );

    await sleep(REQUEST_DELAY_MS);
  }

  console.log("\n========== VALIDATION RESULTS ==========\n");

  console.table(
    results.map((item) => ({
      status: item.valid ? "PASS" : "FAIL",
      schemeCode: item.schemeCode,
      schemeName: item.schemeName,
      fundHouse: item.fundHouse,
      category: item.category,
      validNAVRecords: item.recordCount,
      latestNAVDate: item.latestDate,
      latestNAV: item.latestNAV,
      reason: item.reason,
    }))
  );

  const passed = results.filter((item) => item.valid);
  const failed = results.filter((item) => !item.valid);

  console.log(`Candidates checked: ${results.length}`);
  console.log(`Passed: ${passed.length}`);
  console.log(`Failed: ${failed.length}`);

  if (searchErrors.length > 0) {
    console.log("\nSearch errors:", searchErrors);
  }

  // Save a review file locally, not to MongoDB.
  const fs = await import("node:fs/promises");

  await fs.writeFile(
    "mutual-fund-validation-results.json",
    JSON.stringify(results, null, 2)
  );

  console.log(
    "\nDetailed results saved to mutual-fund-validation-results.json"
  );

  // Do not treat a partially failed validation as fully successful.
  if (failed.length > 0 || searchErrors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Validation script failed:", error.message);
  process.exitCode = 1;
});
