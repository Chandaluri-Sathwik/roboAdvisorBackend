
import axios from "axios";
import { parse } from "csv-parse/sync";
import { fetchBondYields } from "../services/assetDataService.js";

const RBI_BOND_CSV_URL =
  "https://data-api.dbie.rbihub.in/api/tables/financial_markets/yield_gov_sec_rn/csv";

function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    return undefined;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseCsv(csv) {
  return parse(csv, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true,
  });
}

function countUnique(values) {
  return new Set(values.map((value) => String(value ?? ""))).size;
}

function getDuplicateCount(rows) {
  const keys = rows.map((row) => JSON.stringify(row));
  return keys.length - new Set(keys).size;
}

async function main() {
  console.log("\nValidating RBI government-security yields...\n");

  // 1. Fetch the original CSV directly from RBI.
  const rawResponse = await axios.get(RBI_BOND_CSV_URL, {
    responseType: "text",
    timeout: 30000,
  });

  const rawRows = parseCsv(rawResponse.data);

  if (rawRows.length === 0) {
    throw new Error("RBI returned no CSV records.");
  }

  // 2. Fetch the same data through the project's actual service.
  const records = await fetchBondYields();

  // 3. Inspect all source columns and their unique values.
  console.log("\n========== SOURCE DIMENSIONS ==========\n");

  const columns = Object.keys(rawRows[0] ?? {});

  console.log("CSV columns:", columns);

  for (const column of columns) {
    const values = [
      ...new Set(
        rawRows.map((row) => String(row[column] ?? ""))
      ),
    ];

    console.log(
      `\n${column}: ${values.length} unique value(s)`
    );

    console.log("Sample values:", values.slice(0, 15));
  }

  // 4. Check source data quality.
  const missingDate = rawRows.filter(
    (row) => !String(row.time_period ?? "").trim()
  );

  const invalidYield = rawRows.filter(
    (row) => toNumber(row.obs_value) === undefined
  );

  const missingMaturity = rawRows.filter(
    (row) => !String(row.mat_per_rn ?? "").trim()
  );

  // 5. Check the records returned by the service.
  const invalidRecords = records.filter(
    (record) =>
      !record.date ||
      toNumber(record.value) === undefined ||
      !record.symbol ||
      !record.rawData
  );

  // 6. Summarize the number of observations per maturity.
  const maturities = new Map();

  for (const record of records) {
    const maturity =
      record.rawData?.mat_per_rn ?? "UNSPECIFIED";

    const key = String(maturity);

    if (!maturities.has(key)) {
      maturities.set(key, {
        records: 0,
        dates: new Set(),
        yields: [],
      });
    }

    const group = maturities.get(key);

    group.records++;
    group.dates.add(String(record.date));
    group.yields.push(Number(record.value));
  }

  console.log("\n========== MATURITY COVERAGE ==========\n");

  console.table(
    [...maturities.entries()].map(([maturity, group]) => ({
      maturity,
      records: group.records,
      distinctDates: group.dates.size,
      minimumYield: Math.min(...group.yields).toFixed(4),
      maximumYield: Math.max(...group.yields).toFixed(4),
    }))
  );

  // 7. Investigate repeated dates without assuming they are errors.
  const recordsPerDate = new Map();

  for (const record of records) {
    const date = String(record.date);

    recordsPerDate.set(
      date,
      (recordsPerDate.get(date) ?? 0) + 1
    );
  }

  const datesWithMultipleRows = [...recordsPerDate.entries()]
    .filter(([, count]) => count > 1)
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB));

  // Exact duplicate rows are different from repeated dates.
  const exactDuplicateCount = getDuplicateCount(rawRows);

  console.log("\n========== DATE / DUPLICATE ANALYSIS ==========\n");

  console.log(`Unique dates in service: ${recordsPerDate.size}`);
  console.log(
    `Dates with multiple observations: ${datesWithMultipleRows.length}`
  );
  console.log(`Exact duplicate source rows: ${exactDuplicateCount}`);

  console.log("\nSample dates with multiple observations:");

  console.table(
    datesWithMultipleRows.slice(0, 15).map(([date, count]) => ({
      date,
      observations: count,
    }))
  );

  // 8. Show complete sample source rows.
  console.log("\n========== SAMPLE RAW SOURCE ROWS ==========\n");

  console.dir(rawRows.slice(0, 10), { depth: null });

  // 9. Show transformed service records.
  console.log("\n========== SAMPLE SERVICE RECORDS ==========\n");

  console.dir(records.slice(0, 5), { depth: 3 });

  // 10. Overall validation results.
  const countMatches = rawRows.length === records.length;

  const dates = records
    .map((record) => String(record.date))
    .filter(Boolean)
    .sort();

  console.log("\n========== OVERALL RESULTS ==========\n");

  console.log(`Raw CSV rows:             ${rawRows.length}`);
  console.log(`Service records returned: ${records.length}`);
  console.log(
    `Rows dropped by service:  ${rawRows.length - records.length}`
  );
  console.log(`Missing dates in source:  ${missingDate.length}`);
  console.log(`Invalid yields in source: ${invalidYield.length}`);
  console.log(`Missing maturities:       ${missingMaturity.length}`);
  console.log(`Invalid mapped records:   ${invalidRecords.length}`);
  console.log(`Exact duplicate rows:     ${exactDuplicateCount}`);

  if (dates.length > 0) {
    console.log(`First date returned:      ${dates[0]}`);
    console.log(`Last date returned:       ${dates[dates.length - 1]}`);
  }

  // Repeated dates alone do not fail validation.
  // This check verifies transfer and basic field quality, not
  // that every observation is uniquely identified in MongoDB.
  const passed =
    countMatches &&
    missingDate.length === 0 &&
    invalidYield.length === 0 &&
    missingMaturity.length === 0 &&
    invalidRecords.length === 0 &&
    maturities.size > 0;

  console.log("\n========== FINAL STATUS ==========\n");

  console.log(
    passed
      ? "BASIC VALIDATION PASSED: All source rows were mapped and required fields are present."
      : "REVIEW REQUIRED: One or more data-quality checks failed."
  );

  if (exactDuplicateCount > 0) {
    console.log(
      "WARNING: Exact duplicate source rows exist. Investigate them before seeding."
    );
  }

  if (datesWithMultipleRows.length > 0) {
    console.log(
      "NOTE: Repeated dates may be legitimate. Inspect the source dimensions and sample rows."
    );
  }

  console.log(
    "\nIMPORTANT: Basic validation does not guarantee that the MongoDB upsert key preserves every observation."
  );

  if (!passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("\nBond validation failed:", error.message);
  process.exitCode = 1;
});

