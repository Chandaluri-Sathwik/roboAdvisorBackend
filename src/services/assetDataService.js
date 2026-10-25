
import axios from "axios";
import { parse } from "csv-parse/sync";

const ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query";
const TEJHQ_URL = "https://api.tejhq.dev";
const MFAPI_URL = "https://api.mfapi.in/mf";

const RBI_BOND_CSV_URL =
  "https://data-api.dbie.rbihub.in/api/tables/financial_markets/yield_gov_sec_rn/csv";

const numberOrUndefined = (value) => {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    return undefined;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

// MFapi dates use DD-MM-YYYY.
export const parseMFapiDate = (value) => {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(
    String(value ?? "")
  );

  if (!match) return null;

  const [, dd, mm, yyyy] = match;

  const date = new Date(
    Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd))
  );

  if (
    date.getUTCDate() !== Number(dd) ||
    date.getUTCMonth() !== Number(mm) - 1 ||
    date.getUTCFullYear() !== Number(yyyy)
  ) {
    return null;
  }

  return date;
};

// ---------------- STOCKS ----------------

export const fetchStockHistory = async ({
  symbol,
  exchange = "nse",
  from,
  to,
}) => {
  const response = await axios.get(
    `${TEJHQ_URL}/v1/ohlcv/${exchange}/${encodeURIComponent(symbol)}`,
    {
      params: { from, to },
      timeout: 30000,
    }
  );

  if (!Array.isArray(response.data?.data)) {
    throw new Error("Unexpected stock API response from TejHQ.");
  }

  return response.data.data.map((row) => ({
    assetType: "stock",
    symbol: String(symbol).toUpperCase(),
    observationKey: "default",
    date: row.date,
    open: numberOrUndefined(row.open),
    high: numberOrUndefined(row.high),
    low: numberOrUndefined(row.low),
    close: numberOrUndefined(row.close),
    volume: numberOrUndefined(row.volume),
    value: numberOrUndefined(row.close),
    currency: "INR",
    source: "TejHQ",
    rawData: row,
  }));
};

// ---------------- COMMODITIES ----------------

const COMMODITY_FUNCTIONS = {
  WTI: "WTI",
  BRENT: "BRENT",
  NATURAL_GAS: "NATURAL_GAS",
  COPPER: "COPPER",
  ALUMINUM: "ALUMINUM",
  WHEAT: "WHEAT",
  CORN: "CORN",
  COTTON: "COTTON",
  SUGAR: "SUGAR",
  COFFEE: "COFFEE",
};

export const fetchCommodityHistory = async ({
  commodity,
  interval = "monthly",
}) => {
  const symbol = String(commodity ?? "").toUpperCase();
  const fn = COMMODITY_FUNCTIONS[symbol];

  if (!fn) {
    throw new Error(
      `Unsupported commodity. Choose: ${Object.keys(
        COMMODITY_FUNCTIONS
      ).join(", ")}`
    );
  }

  if (!["daily", "weekly", "monthly"].includes(interval)) {
    throw new Error("Interval must be daily, weekly or monthly.");
  }

  if (!process.env.ALPHA_VANTAGE_API_KEY) {
    throw new Error("ALPHA_VANTAGE_API_KEY is missing from .env.");
  }

  const response = await axios.get(ALPHA_VANTAGE_URL, {
    params: {
      function: fn,
      interval,
      apikey: process.env.ALPHA_VANTAGE_API_KEY,
    },
    timeout: 30000,
  });

  const payload = response.data;

  if (
    payload?.["Error Message"] ||
    payload?.Note ||
    payload?.Information
  ) {
    throw new Error(
      payload["Error Message"] ||
        payload.Note ||
        payload.Information
    );
  }

  const rows = Object.values(payload ?? {}).find(Array.isArray);

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      "No commodity history returned by Alpha Vantage."
    );
  }

  return rows
    .map((row) => {
      const date =
        row.date ?? row.Date ?? row.timestamp ?? row.time;

      const rawValue =
        row.value ?? row.Value ?? row.close ?? row.Close;

      const value = numberOrUndefined(rawValue);

      if (!date || value === undefined) return null;

      return {
        assetType: "commodity",
        symbol,
        observationKey: "default",
        date,
        value,
        close: value,
        currency: "USD",
        source: "Alpha Vantage",
        rawData: row,
      };
    })
    .filter(Boolean);
};

// ---------------- MUTUAL-FUND HISTORICAL NAV ----------------

export const fetchMutualFundHistory = async ({ schemeCode }) => {
  const code = String(schemeCode ?? "").trim();

  if (!/^\d+$/.test(code)) {
    throw new Error(
      "Mutual-fund schemeCode must be a numeric MFapi scheme code."
    );
  }

  const response = await axios.get(
    `${MFAPI_URL}/${encodeURIComponent(code)}`,
    { timeout: 30000 }
  );

  const payload = response.data;

  if (
    payload?.status !== "SUCCESS" ||
    !payload?.meta ||
    !Array.isArray(payload?.data)
  ) {
    throw new Error(
      `Unexpected MFapi response for scheme ${code}.`
    );
  }

  const schemeName =
    payload.meta?.scheme_name ?? `MF_SCHEME_${code}`;
  if (String(payload.meta.scheme_code) !== code) {
    throw new Error(
      `MFapi returned scheme ${payload.meta.scheme_code} while ${code} was requested.`
    );
  }

  return payload.data
    .map((row) => {
      const date = parseMFapiDate(row.date);
      const nav = numberOrUndefined(row.nav);

      if (!date || nav === undefined || nav <= 0) return null;

      return {
        assetType: "mutualFund",
        symbol: code,
        observationKey: "default",
        date,
        value: nav,
        close: nav,
        currency: "INR",
        source: "MFapi.in",
        rawData: {
          ...row,
          schemeCode: code,
          schemeName,
          schemeCategory: payload.meta.scheme_category ?? null,
          fundHouse: payload.meta.fund_house ?? null,
          isinGrowth: payload.meta.isin_growth ?? null,
        },
      };
    })
    .filter(Boolean);
};

// ---------------- GOVERNMENT BOND YIELDS ----------------

export const fetchBondYields = async ({ limit = 1000 } = {}) => {
  const response = await axios.get(RBI_BOND_CSV_URL, {
    responseType: "text",
    timeout: 30000,
  });

  const rows = parse(response.data, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true,
  });

  if (rows.length === 0) {
    throw new Error("No bond yield records found in RBI data.");
  }

  const records = rows
    .map((row) => {
      const date = row.time_period;
      const value = numberOrUndefined(row.obs_value);
      const maturity = row.mat_per_rn;
      const srcLine = String(row.src_line ?? "").trim();

      if (!date || value === undefined || !srcLine) {
        return null;
      }

      return {
        assetType: "bond",
        symbol: `INDIA_GOVT_BOND_${maturity || "UNSPECIFIED"}`,
        // Unique source-row identifier for this seed dataset.
        observationKey: `RBI_LINE_${srcLine}`,
        date,
        value,
        currency: "INR",
        source: "RBI DBIE",
        rawData: row,
      };
    })
    .filter(Boolean);

  if (records.length === 0) {
    throw new Error(
      "No valid bond yield observations were mapped."
    );
  }

  // Sort newest dates first. This limits stored rows, not the downloaded CSV.
  records.sort((a, b) => {
    const dateDifference =
      new Date(b.date).getTime() - new Date(a.date).getTime();

    if (dateDifference !== 0) {
      return dateDifference;
    }

    return String(a.observationKey).localeCompare(
      String(b.observationKey)
    );
  });

  const safeLimit =
    Number.isInteger(limit) && limit > 0 ? limit : 1000;

  const selectedRecords = records.slice(0, safeLimit);

  // Ensure the selected observations have unique database keys.
  const uniqueKeys = new Set();

  for (const record of selectedRecords) {
    const key = [
      record.assetType,
      record.symbol,
      new Date(record.date).toISOString(),
      record.observationKey,
    ].join("|");

    if (uniqueKeys.has(key)) {
      throw new Error(`Duplicate bond observation key: ${key}`);
    }

    uniqueKeys.add(key);
  }

  console.log(
    `RBI bond yields: selected ${selectedRecords.length} of ${records.length} valid observations (limit ${safeLimit}).`
  );

  return selectedRecords;
};
