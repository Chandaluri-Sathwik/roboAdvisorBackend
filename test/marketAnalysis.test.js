import assert from "node:assert/strict";
import { test } from "node:test";
import { ASSET_CATALOG, getCatalogInstrument } from "../src/config/assetCatalog.js";
import {
  mutualFundUniverse,
  targetFundCountPerProxyClass,
} from "../src/config/assetUniverse.js";
import AssetHistory from "../src/models/AssetHistory.js";
import { parseMFapiDate } from "../src/services/assetDataService.js";
import { analyzeHistoricalSeries, summarizeSeriesQuality } from "../src/services/marketAnalysisService.js";
import { validateConfiguredFundMetadata } from "../src/services/fundDataValidation.js";
import { compareFundPeersOnCommonWindow } from "../src/services/fundPeerComparisonService.js";
import { getAnalysisStartDate } from "../src/services/analysisWindow.js";
import { retryTransient } from "../src/services/transientRetry.js";
import { createApp } from "../src/server.js";

const TODAY = new Date("2026-10-24T12:00:00.000Z");

function dailySeries({ start, count, valueAt = (index) => 100 + index }) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index * 13);
    return {
      date,
      value: valueAt(index),
      currency: "INR",
      source: "test",
    };
  });
}

test("catalog keeps asset semantics explicit and excludes everything from recommendation eligibility", () => {
  assert.ok(ASSET_CATALOG.some((item) => item.assetType === "stock" && item.assetClass === "equity"));
  assert.equal(mutualFundUniverse.length, 11);
  assert.equal(targetFundCountPerProxyClass, 3);
  assert.deepEqual(
    Object.fromEntries(
      ["equity", "debt", "gold", "commodity", "cash_proxy"].map((assetClass) => [
        assetClass,
        mutualFundUniverse.filter((fund) => fund.assetClass === assetClass).length,
      ]),
    ),
    { equity: 3, debt: 1, gold: 3, commodity: 3, cash_proxy: 1 },
  );
  assert.ok(ASSET_CATALOG.some((item) => item.assetType === "mutualFund" && item.assetClass === "debt"));
  assert.ok(ASSET_CATALOG.some((item) => item.assetType === "commodity" && item.currency === "USD"));
  assert.ok(ASSET_CATALOG.some((item) => item.assetType === "bond" && item.dataKind === "yield_observation"));
  assert.ok(ASSET_CATALOG.filter((item) => item.assetType === "bond")
    .every((item) => !item.priceAnalysisSupported));
  assert.equal(getCatalogInstrument("stock", "RELIANCE").currency, "INR");
  assert.equal(getCatalogInstrument("bond", "RBI_DBIE_GOVT_SECURITY_YIELDS").priceAnalysisSupported, false);
});

test("configured mutual-fund proxies require matching Direct Growth provider metadata", () => {
  const fund = mutualFundUniverse[0];
  const records = [{
    source: "MFapi.in",
    currency: "INR",
    value: 100,
    rawData: {
      schemeCode: fund.schemeCode,
      schemeName: fund.schemeName,
      schemeCategory: "Other Scheme - Index Funds",
      fundHouse: "UTI Mutual Fund",
      isinGrowth: "IN0000000000",
    },
  }];

  assert.equal(validateConfiguredFundMetadata(fund, records).schemeCode, "120716");
  assert.throws(
    () => validateConfiguredFundMetadata(fund, [{
      ...records[0],
      rawData: { ...records[0].rawData, schemeCategory: "Debt Scheme - Liquid Fund" },
    }]),
    /category/,
  );
  assert.throws(
    () => validateConfiguredFundMetadata(fund, [{
      ...records[0],
      rawData: { ...records[0].rawData, schemeName: "UTI Nifty 50 Index Fund - Regular Plan - IDCW" },
    }]),
    /Direct Growth|distribution/,
  );
});

test("all configured additional proxies match their verified MFapi names and categories", () => {
  const verifiedMetadata = {
    120716: ["UTI Nifty 50 Index Fund - Direct Plan - Growth", "Other Scheme - Index Funds"],
    118482: ["BANDHAN Nifty 50 Index Fund - Direct Plan - Growth", "Other Scheme - Index Funds"],
    118741: ["Nippon India Index Fund - Nifty 50 Plan - Direct Plan - Growth Option", "Other Scheme - Index Funds"],
    120754: ["ICICI Prudential Short Term Fund - Direct Plan - Growth", "Debt Scheme - Short Duration Fund"],
    119781: ["Kotak Gold Fund - Direct Plan - Growth", "Other Scheme - FoF Domestic"],
    154295: ["HSBC Gold ETF Fund of Fund - Direct Plan - Growth", "Fund of Funds Scheme (Domestic) - Fund of Funds Scheme (Domestic)"],
    119132: ["HDFC Gold ETF Fund of Fund - Direct Plan - Growth Option", "Other Scheme - FoF Domestic"],
    149760: ["Nippon India Silver ETF FOF - Direct Plan - Growth Option", "Other Scheme - FoF Domestic"],
    149775: ["ICICI Prudential Silver ETF FOF - Direct Plan - Growth", "Other Scheme - FoF Domestic"],
    149780: ["Aditya Birla Sun Life Silver ETF FOF - Direct Plan - GROWTH", "Fund of Funds Scheme (Domestic) - Fund of Funds Scheme (Domestic)"],
    149664: ["Sundaram Liquid Fund - Direct Plan - GROWTH", "Debt Scheme - Liquid Fund"],
  };

  for (const fund of mutualFundUniverse) {
    const [schemeName, schemeCategory] = verifiedMetadata[fund.schemeCode];
    const metadata = validateConfiguredFundMetadata(fund, [{
      source: "MFapi.in",
      currency: "INR",
      value: 100,
      rawData: {
        schemeCode: fund.schemeCode,
        schemeName,
        schemeCategory,
      },
    }]);
    assert.equal(metadata.schemeCode, String(fund.schemeCode));
  }
});

test("mutual-fund date parsing rejects impossible calendar dates", () => {
  assert.equal(parseMFapiDate("29-02-2024").toISOString(), "2024-02-29T00:00:00.000Z");
  assert.equal(parseMFapiDate("29-02-2025"), null);
  assert.equal(parseMFapiDate("32-01-2025"), null);
});

test("requested one-year analysis includes a buffer month for 12 monthly returns", () => {
  const start = getAnalysisStartDate(
    new Date("2026-10-24T12:00:00.000Z"),
    1,
  );
  assert.equal(start.toISOString(), "2025-09-01T12:00:00.000Z");
});

test("provider retry repeats transient failures but not permanent errors", async () => {
  let attempts = 0;
  const result = await retryTransient(
    async () => {
      attempts++;
      if (attempts === 1) {
        const error = new Error("provider timed out");
        error.code = "ECONNABORTED";
        throw error;
      }
      return "success";
    },
    { waitFn: async () => {} },
  );
  assert.equal(result, "success");
  assert.equal(attempts, 2);

  attempts = 0;
  await assert.rejects(
    retryTransient(
      async () => {
        attempts++;
        const error = new Error("invalid scheme");
        error.response = { status: 400 };
        throw error;
      },
      { waitFn: async () => {} },
    ),
    /invalid scheme/,
  );
  assert.equal(attempts, 1);

  attempts = 0;
  await assert.rejects(
    retryTransient(
      async () => {
        attempts++;
        const error = new Error("provider unavailable");
        error.response = { status: 503 };
        throw error;
      },
      { attempts: 2, waitFn: async () => {} },
    ),
    /provider unavailable/,
  );
  assert.equal(attempts, 2);
});

test("peer comparison uses a continuous common month window and withholds short history", () => {
  const makeSeries = (symbol, growthRate = 1) => ({
    symbol,
    rows: Array.from({ length: 14 }, (_, index) => ({
      date: new Date(Date.UTC(2025, 0 + index, 20)),
      value: 100 + index * growthRate,
      currency: "INR",
      source: "MFapi.in",
    })),
  });
  const comparison = compareFundPeersOnCommonWindow([
    makeSeries("A"),
    makeSeries("B", 1.2),
  ], { asOf: TODAY });
  assert.equal(comparison.status, "peer_range_available");
  assert.deepEqual(comparison.common_window, {
    start_month: "2025-02",
    end_month: "2026-02",
    month_end_observation_count: 13,
    monthly_return_count: 12,
  });
  assert.ok(comparison.annualized_nav_change_range_percent.minimum > 0);
  assert.ok(
    comparison.annualized_nav_change_range_percent.maximum >
      comparison.annualized_nav_change_range_percent.minimum,
  );

  const withheld = compareFundPeersOnCommonWindow([
    makeSeries("A"),
  ]);
  assert.equal(withheld.status, "peer_range_withheld");
  assert.equal(withheld.annualized_nav_change_range_percent, null);
  assert.ok(withheld.reasons.includes("too_few_usable_peer_series"));
});

test("analysis calculates month-end NAV return, annualized volatility, and drawdown", () => {
  const rows = Array.from({ length: 14 }, (_, index) => {
    const year = 2025 + Math.floor((8 + index) / 12);
    const month = (8 + index) % 12;
    const dates = [
      new Date(Date.UTC(year, month, 10)),
      new Date(Date.UTC(year, month, 20)),
    ];
    if (index !== 13) dates.push(new Date(Date.UTC(year, month + 1, 0)));
    return dates.map((date) => ({
      date,
      value: index === 5 && date.getUTCDate() > 20
        ? 80
        : index === 13 && date.getUTCDate() >= 20
          ? 110
          : 100,
      currency: "INR",
      source: "MFapi.in",
    }));
  }).flat();

  const result = analyzeHistoricalSeries({
    assetType: "mutualFund",
    rows,
    expectedCurrency: "INR",
    expectedSource: "MFapi.in",
    asOf: TODAY,
  });

  assert.equal(result.status, "exploratory_metrics_available");
  assert.equal(result.metrics.start_value, 100);
  assert.equal(result.metrics.end_value, 100);
  assert.equal(result.metrics.month_end_observation_count, 13);
  assert.equal(result.metrics.monthly_return_observation_count, 12);
  assert.equal(result.metrics.end_date, "2026-09-30");
  assert.equal(result.metrics.observed_nav_change_percent, 0);
  assert.equal(result.metrics.annualized_nav_change_percent, 0);
  assert.ok(result.metrics.annualized_volatility_percent > 0);
  assert.equal(result.metrics.maximum_drawdown_percent, -20);
});

test("one-year analysis selects exactly 12 monthly returns from buffered observations", () => {
  const rows = Array.from({ length: 14 }, (_, index) => {
    const dates = [
      new Date(Date.UTC(2025, 8 + index, 10)),
      new Date(Date.UTC(2025, 8 + index, 20)),
      new Date(Date.UTC(2025, 8 + index, 23)),
    ];
    if (index === 13) dates[2] = new Date("2026-10-23T00:00:00.000Z");
    return dates.map((date) => ({
      date,
      value: 100 + index,
      currency: "INR",
      source: "MFapi.in",
    }));
  }).flat();
  const result = analyzeHistoricalSeries({
    assetType: "mutualFund",
    rows,
    expectedCurrency: "INR",
    expectedSource: "MFapi.in",
    requestedYears: 1,
    asOf: TODAY,
  });

  assert.equal(result.status, "exploratory_metrics_available");
  assert.equal(result.metrics.month_end_observation_count, 13);
  assert.equal(result.metrics.monthly_return_observation_count, 12);
  assert.equal(result.metrics.start_date, "2025-09-23");
  assert.equal(result.metrics.end_date, "2026-09-23");
});

test("individual analysis and peer comparison exclude the incomplete current month", () => {
  const rows = Array.from({ length: 15 }, (_, index) => {
    return [10, 20, 23].map((day) => ({
      date: new Date(Date.UTC(2025, 7 + index, day)),
      value: 100 + index,
      currency: "INR",
      source: "MFapi.in",
    }));
  }).flat();
  const analysis = analyzeHistoricalSeries({
    assetType: "mutualFund",
    rows,
    expectedCurrency: "INR",
    expectedSource: "MFapi.in",
    asOf: TODAY,
  });
  const peerComparison = compareFundPeersOnCommonWindow(
    [{ symbol: "A", rows }, { symbol: "B", rows }],
    { asOf: TODAY },
  );

  assert.equal(analysis.metrics.end_date, "2026-09-23");
  assert.equal(analysis.data_quality.latest_date, "2026-10-23");
  assert.equal(peerComparison.common_window.end_month, "2026-09");
  assert.equal(peerComparison.common_window.monthly_return_count, 12);
});

test("one-year commodity analysis reports an explicitly shortened 11-return window", () => {
  const rows = Array.from({ length: 12 }, (_, index) => {
    const monthOffset = 9 + index;
    const year = 2025 + Math.floor(monthOffset / 12);
    const month = monthOffset % 12;
    return {
      date: new Date(Date.UTC(year, month, 1)),
      value: 100 + index,
      currency: "USD",
      source: "Alpha Vantage",
    };
  });
  const result = analyzeHistoricalSeries({
    assetType: "commodity",
    rows,
    expectedCurrency: "USD",
    expectedSource: "Alpha Vantage",
    requestedYears: 1,
    asOf: TODAY,
  });

  assert.equal(result.status, "exploratory_metrics_available");
  assert.equal(result.analysis_window_status, "shortened_by_one_month");
  assert.equal(result.metrics.monthly_return_observation_count, 11);
  assert.equal(result.data_quality.requested_monthly_return_count, 12);
  assert.ok(
    result.data_quality.reasons.includes("one_month_short_of_requested_window"),
  );
  assert.ok(result.metrics.annualized_nav_change_percent > 0);
});

test("commodity analysis withholds a shortened window for horizons longer than one year", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 9 + index, 1)),
    value: 100 + index,
    currency: "USD",
    source: "Alpha Vantage",
  }));
  const result = analyzeHistoricalSeries({
    assetType: "commodity",
    rows,
    expectedCurrency: "USD",
    expectedSource: "Alpha Vantage",
    requestedYears: 3,
    asOf: TODAY,
  });

  assert.equal(result.status, "metrics_withheld");
  assert.equal(result.metrics, null);
  assert.equal(result.analysis_window_status, "insufficient");
});

test("analysis withholds volatility metrics when a calendar month is missing", () => {
  const rows = Array.from({ length: 13 }, (_, index) => {
    const year = 2025 + Math.floor((8 + index) / 12);
    const month = (8 + index) % 12;
    return [10, 20, 0].map((day) => ({
      date: day === 0
        ? new Date(Date.UTC(year, month + 1, 0))
        : new Date(Date.UTC(year, month, day)),
      value: 100 + index,
      currency: "INR",
      source: "MFapi.in",
    }));
  }).flat().filter((row) => row.date.getUTCMonth() !== 1 || row.date.getUTCFullYear() !== 2026);

  const result = analyzeHistoricalSeries({
    assetType: "mutualFund",
    rows,
    expectedCurrency: "INR",
    expectedSource: "MFapi.in",
    asOf: TODAY,
  });

  assert.equal(result.metrics, null);
  assert.equal(result.data_quality.missing_calendar_month_count, 1);
  assert.ok(result.data_quality.reasons.includes("missing_calendar_months"));
});

test("analysis withholds metrics for sparse, stale, future-dated, or incompatible-currency series", () => {
  const shortHistory = analyzeHistoricalSeries({
    assetType: "stock",
    rows: dailySeries({ start: "2026-01-01T00:00:00.000Z", count: 3 }),
    expectedCurrency: "INR",
    asOf: TODAY,
  });
  assert.equal(shortHistory.metrics, null);
  assert.ok(shortHistory.data_quality.reasons.includes("too_few_valid_observations"));

  const staleRows = dailySeries({ start: "2023-01-01T00:00:00.000Z", count: 31 });
  const stale = analyzeHistoricalSeries({
    assetType: "stock",
    rows: staleRows,
    expectedCurrency: "INR",
    asOf: TODAY,
  });
  assert.equal(stale.metrics, null);
  assert.ok(stale.data_quality.reasons.includes("data_is_stale"));

  const incompatible = analyzeHistoricalSeries({
    assetType: "stock",
    rows: dailySeries({ start: "2024-01-01T00:00:00.000Z", count: 31 }).map((row) => ({
      ...row,
      currency: "USD",
    })),
    expectedCurrency: "INR",
    asOf: TODAY,
  });
  assert.equal(incompatible.metrics, null);
  assert.ok(incompatible.data_quality.reasons.includes("currency_mismatch"));

  const future = analyzeHistoricalSeries({
    assetType: "stock",
    rows: [{ date: "2026-10-25T00:00:00.000Z", value: 100, currency: "INR" }],
    expectedCurrency: "INR",
    asOf: TODAY,
  });
  assert.equal(future.metrics, null);
  assert.equal(future.data_quality.invalid_observation_count, 1);
  assert.ok(future.data_quality.reasons.includes("future_dated_observations"));
});

test("analysis excludes conflicting dates and reports invalid and duplicate rows", () => {
  const rows = dailySeries({
    start: "2024-01-01T00:00:00.000Z",
    count: 32,
  });
  rows.push({ ...rows[0] });
  rows.push({ ...rows[1], value: 999 });
  rows.push({ date: "invalid", value: 100, currency: "INR" });
  rows.push({ date: "2025-10-24T00:00:00.000Z", value: -1, currency: "INR" });

  const result = analyzeHistoricalSeries({
    assetType: "stock",
    rows,
    expectedCurrency: "INR",
    asOf: TODAY,
  });

  assert.equal(result.data_quality.duplicate_observation_count, 2);
  assert.equal(result.data_quality.conflicting_date_count, 1);
  assert.equal(result.data_quality.invalid_observation_count, 2);
});

test("quality summary distinguishes absent, stale, insufficient, and ready series", () => {
  const empty = summarizeSeriesQuality({ assetType: "stock", observationCount: 0, now: TODAY });
  assert.equal(empty.status, "not_seeded");

  const stale = summarizeSeriesQuality({
    assetType: "stock",
    observationCount: 50,
    firstDate: "2023-01-01T00:00:00.000Z",
    latestDate: "2024-01-01T00:00:00.000Z",
    now: TODAY,
  });
  assert.equal(stale.status, "stale");

  const yieldOnly = summarizeSeriesQuality({
    assetType: "bond",
    observationCount: 100,
    firstDate: "2024-01-01T00:00:00.000Z",
    latestDate: "2026-10-23T00:00:00.000Z",
    now: TODAY,
  });
  assert.equal(yieldOnly.status, "yield_observations_only");
});

test("market-data endpoints expose catalog, quality, and analysis safeguards", async (t) => {
  const originalAggregate = AssetHistory.aggregate;
  const originalFind = AssetHistory.find;
  const now = new Date();
  const latest = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - 1,
  ));
  const originalFundRows = Array.from({ length: 66 }, (_, index) => {
    const year = latest.getUTCFullYear() + Math.floor((latest.getUTCMonth() - 65 + index) / 12);
    const month = (latest.getUTCMonth() - 65 + index + 1200) % 12;
    const monthEnd = index === 65
      ? latest
      : new Date(Date.UTC(year, month + 1, 0));
    return [
      new Date(Date.UTC(year, month, 10)),
      new Date(Date.UTC(year, month, 20)),
      monthEnd,
    ].map((date, dayIndex) => ({
      date,
      value: 100 + index + dayIndex,
      currency: "INR",
      source: "MFapi.in",
    }));
  }).flat();
  const first = new Date(latest);
  first.setUTCFullYear(first.getUTCFullYear() - 2);
  const analysisRows = Array.from({ length: 66 }, (_, index) => {
    const monthOffset = latest.getUTCMonth() - 65 + index;
    const year = latest.getUTCFullYear() + Math.floor(monthOffset / 12);
    const month = (monthOffset + 1200) % 12;
    const monthEnd = index === 65
      ? latest
      : new Date(Date.UTC(year, month + 1, 0));
    return [
      new Date(Date.UTC(year, month, 10)),
      new Date(Date.UTC(year, month, 20)),
      monthEnd,
    ].map((date, dayIndex) => ({
      date,
      value: 100 + index + dayIndex,
      currency: "INR",
      source: "TejHQ",
    }));
  }).flat();
  AssetHistory.find = (query) => ({
    select() {
      return this;
    },
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    lean: async () => query.$or
      ? query.$or.flatMap(({ assetType, symbol }) => {
          const instrument = getCatalogInstrument(assetType, symbol);
          if (assetType === "commodity") {
            return Array.from({ length: 12 }, (_, index) => {
              const monthOffset = latest.getUTCMonth() - 12 + index;
              const year = latest.getUTCFullYear() + Math.floor(monthOffset / 12);
              const month = (monthOffset + 1200) % 12;
              return {
                assetType,
                symbol,
                date: new Date(Date.UTC(year, month, 1)),
                value: 100 + index,
                currency: instrument.currency,
                source: instrument.source,
              };
            });
          }
          return Array.from({ length: 66 }, (_, index) => {
            const monthOffset = latest.getUTCMonth() - 65 + index;
            const year = latest.getUTCFullYear() + Math.floor(monthOffset / 12);
            const month = (monthOffset + 1200) % 12;
            const monthEnd = index === 65
              ? latest
              : new Date(Date.UTC(year, month + 1, 0));
            return [
              new Date(Date.UTC(year, month, 10)),
              new Date(Date.UTC(year, month, 20)),
              monthEnd,
            ].map((date, dayIndex) => ({
              assetType,
              symbol,
              date,
              value: 100 + index + dayIndex,
              currency: instrument.currency,
              source: instrument.source,
            }));
          }).flat();
        })
      : query.assetType === "mutualFund"
        ? mutualFundUniverse.flatMap((fund) => originalFundRows.map((row) => ({
          ...row,
          symbol: String(fund.schemeCode),
        })))
        : analysisRows,
  });
  AssetHistory.aggregate = async () => [
    {
      _id: {
        assetType: "stock",
        symbol: "RELIANCE",
        currency: "INR",
        source: "TejHQ",
      },
      observationCount: 40,
      firstDate: first,
      latestDate: latest,
    },
    {
      _id: {
        assetType: "bond",
        symbol: "INDIA_GOVT_BOND_10Y",
        currency: "INR",
        source: "RBI DBIE",
      },
      observationCount: 150,
      firstDate: first,
      latestDate: latest,
    },
  ];
  t.after(() => {
    AssetHistory.aggregate = originalAggregate;
    AssetHistory.find = originalFind;
  });

  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  ));
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const catalogResponse = await fetch(`${baseUrl}/api/v1/market-data/catalog`);
  const catalog = await catalogResponse.json();
  assert.equal(catalogResponse.status, 200);
  assert.equal(catalog.portfolio_recommendations_enabled, false);
  assert.ok(catalog.unsupported_portfolio_classes.some((item) => item.asset_class === "physical_gold_or_gold_spot"));

  const qualityResponse = await fetch(`${baseUrl}/api/v1/market-data/quality`);
  const quality = await qualityResponse.json();
  assert.equal(qualityResponse.status, 200);
  const fundQuality = quality.instruments.filter(
    (item) => item.asset_type === "mutualFund",
  );
  assert.equal(fundQuality.length, mutualFundUniverse.length);
  assert.ok(fundQuality.every((item) => item.status === "not_seeded"));
  assert.ok(fundQuality.every((item) => item.observation_count === 0));
  assert.equal(
    quality.instruments.find((item) => item.symbol === "RELIANCE").status,
    "ready_for_exploratory_analysis",
  );
  assert.equal(
    quality.instruments.find((item) => item.asset_type === "bond").status,
    "yield_observations_only",
  );

  const analysisResponse = await fetch(
    `${baseUrl}/api/v1/market-data/series/stock/RELIANCE/analysis?years=3`,
  );
  const analysis = await analysisResponse.json();
  assert.equal(analysisResponse.status, 200);
  assert.equal(analysis.status, "exploratory_metrics_available");
  assert.equal(analysis.portfolio_analysis_eligible, false);
  assert.ok(analysis.metrics.maximum_drawdown_percent <= 0);

  const universeResponse = await fetch(
    `${baseUrl}/api/v1/market-data/universe-analysis?years=1`,
  );
  const universe = await universeResponse.json();
  assert.equal(universeResponse.status, 200);
  assert.equal(universe.portfolio_recommendations_enabled, false);
  assert.ok(universe.groups.stock_price_references);
  assert.ok(universe.groups.commodity_price_references);
  assert.ok(universe.groups.mutual_fund_equity);
  assert.ok(universe.groups.mutual_fund_debt);
  assert.ok(universe.groups.mutual_fund_gold);
  assert.ok(universe.groups.mutual_fund_cash_proxy);
  assert.equal(
    universe.groups.stock_price_references.series[0].metrics.annualized_observed_change_percent !== undefined,
    true,
  );
  assert.equal(
    universe.groups.commodity_price_references.currency[0],
    "USD",
  );
  assert.equal(
    universe.groups.commodity_price_references.status,
    "partial_window_summary_available",
  );
  assert.equal(
    universe.groups.commodity_price_references.shortened_window_series_count,
    10,
  );
  assert.equal(
    universe.groups.commodity_price_references.complete_window_series_count,
    0,
  );
  assert.equal(
    universe.groups.commodity_price_references.series[0].metrics.monthly_return_observation_count,
    11,
  );
  assert.equal(universe.excluded_series[0].status, "yield_observations_only");
  assert.equal(
    universe.methodology.recommendation_policy.includes("do not change"),
    true,
  );

  const unsupported = await fetch(
    `${baseUrl}/api/v1/market-data/series/bond/RBI_DBIE_GOVT_SECURITY_YIELDS/analysis`,
  );
  const body = await unsupported.json();
  assert.equal(unsupported.status, 400);
  assert.match(body.detail, /stock, mutualFund, or commodity/);

  const invalidWindow = await fetch(
    `${baseUrl}/api/v1/market-data/series/stock/RELIANCE/analysis?years=2`,
  );
  assert.equal(invalidWindow.status, 400);

  const classAnalysisResponse = await fetch(
    `${baseUrl}/api/v1/market-data/fund-class-analysis?years=5`,
  );
  const classAnalysis = await classAnalysisResponse.json();
  assert.equal(classAnalysisResponse.status, 200);
  assert.equal(classAnalysis.status, "research_only");
  assert.equal(classAnalysis.portfolio_recommendations_enabled, false);
  assert.equal(classAnalysis.proxies.length, 11);
  assert.deepEqual(classAnalysis.fund_coverage, {
    equity: {
      configured_fund_count: 3,
      usable_series_count: 3,
      target_fund_count: 3,
      configured_status: "target_met",
      data_status: "target_met",
    },
    debt: {
      configured_fund_count: 1,
      usable_series_count: 1,
      target_fund_count: 3,
      configured_status: "incomplete",
      data_status: "incomplete",
    },
    gold: {
      configured_fund_count: 3,
      usable_series_count: 3,
      target_fund_count: 3,
      configured_status: "target_met",
      data_status: "target_met",
    },
    commodity: {
      configured_fund_count: 3,
      usable_series_count: 3,
      target_fund_count: 3,
      configured_status: "target_met",
      data_status: "target_met",
    },
    cash_proxy: {
      configured_fund_count: 1,
      usable_series_count: 1,
      target_fund_count: 3,
      configured_status: "incomplete",
      data_status: "incomplete",
    },
  });
  assert.match(classAnalysis.methodology.comparison, /not yet enabled/);
  assert.equal(classAnalysis.peer_comparisons.equity.status, "peer_range_available");
  assert.equal(classAnalysis.peer_comparisons.gold.status, "peer_range_available");
  assert.equal(classAnalysis.peer_comparisons.commodity.status, "peer_range_available");
  assert.equal(classAnalysis.peer_comparisons.debt.status, "peer_range_withheld");
  assert.equal(classAnalysis.peer_comparisons.cash_proxy.status, "peer_range_withheld");
  assert.ok(classAnalysis.proxies.every((proxy) => proxy.representative_proxy_only));
  assert.ok(classAnalysis.proxies.every((proxy) => !proxy.portfolio_recommendation_eligible));
});
