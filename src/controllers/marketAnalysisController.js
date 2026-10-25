import AssetHistory from "../models/AssetHistory.js";
import { ASSET_CATALOG, getCatalogInstrument } from "../config/assetCatalog.js";
import { targetFundCountPerProxyClass } from "../config/assetUniverse.js";
import {
  analyzeHistoricalSeries,
  summarizeSeriesQuality,
} from "../services/marketAnalysisService.js";
import { compareFundPeersOnCommonWindow } from "../services/fundPeerComparisonService.js";
import { getAnalysisStartDate } from "../services/analysisWindow.js";
import { HttpError } from "../middleware/errors.js";

const MAX_ANALYSIS_OBSERVATIONS = 5000;
const MAX_CLASS_ANALYSIS_OBSERVATIONS = 20000;
const MAX_UNIVERSE_ANALYSIS_OBSERVATIONS = 150000;
const ALLOWED_WINDOWS = new Set([1, 3, 5]);
const ANALYZABLE_TYPES = new Set(["stock", "mutualFund", "commodity"]);

const identityKey = (assetType, symbol) => `${assetType}:${symbol}`;

export const getMarketDataCatalog = (req, res) => {
  res.json({
    analysis_policy: "research_only_no_personalized_recommendations",
    portfolio_recommendations_enabled: false,
    instruments: ASSET_CATALOG,
    unsupported_portfolio_classes: [
      {
        asset_class: "physical_gold_or_gold_spot",
        reason: "The configured gold mutual-fund NAV is a proxy and is not a physical-gold or spot-price series.",
      },
      {
        asset_class: "cash_or_bank_deposit",
        reason: "A liquid-fund NAV is a cash-like investment proxy, not a bank deposit or risk-free cash return.",
      },
      {
        asset_class: "government_bond_total_return",
        reason: "The configured RBI dataset contains yields, not bond prices or total returns; the debt mutual fund is a separate investable proxy.",
      },
    ],
  });
};

export const getMarketDataQuality = async (req, res) => {
  const groups = await AssetHistory.aggregate([
    {
      $group: {
        _id: {
          assetType: "$assetType",
          symbol: "$symbol",
          currency: "$currency",
          source: "$source",
        },
        observationCount: { $sum: 1 },
        firstDate: { $min: "$date" },
        latestDate: { $max: "$date" },
      },
    },
  ]);

  const grouped = new Map();
  for (const group of groups) {
    const { assetType, symbol } = group._id;
    const key =
      assetType === "bond"
        ? "bond:RBI_DBIE_GOVT_SECURITY_YIELDS"
        : identityKey(assetType, symbol);
    const existing = grouped.get(key) ?? {
      observationCount: 0,
      firstDate: null,
      latestDate: null,
      currencies: new Set(),
      sources: new Set(),
    };

    existing.observationCount += group.observationCount;
    existing.firstDate =
      !existing.firstDate || group.firstDate < existing.firstDate
        ? group.firstDate
        : existing.firstDate;
    existing.latestDate =
      !existing.latestDate || group.latestDate > existing.latestDate
        ? group.latestDate
        : existing.latestDate;
    if (group._id.currency) existing.currencies.add(group._id.currency);
    if (group._id.source) existing.sources.add(group._id.source);
    grouped.set(key, existing);
  }

  const instruments = ASSET_CATALOG.map((instrument) => {
    const key =
      instrument.assetType === "bond"
        ? "bond:RBI_DBIE_GOVT_SECURITY_YIELDS"
        : identityKey(instrument.assetType, instrument.symbol);
    const series = grouped.get(key);
    const quality = summarizeSeriesQuality({
      assetType: instrument.assetType,
      observationCount: series?.observationCount ?? 0,
      firstDate: series?.firstDate,
      latestDate: series?.latestDate,
    });
    if (
      series?.observationCount > 0 &&
      instrument.assetType !== "bond" &&
      (series.currencies.size !== 1 ||
        !series.currencies.has(instrument.currency))
    ) {
      quality.status = "currency_mismatch";
    }
    if (
      series?.observationCount > 0 &&
      instrument.assetType !== "bond" &&
      (series.sources.size !== 1 || !series.sources.has(instrument.source))
    ) {
      quality.status = "source_mismatch";
    }

    return {
      asset_type: instrument.assetType,
      symbol: instrument.symbol,
      display_name: instrument.displayName,
      expected_currency: instrument.currency,
      observed_currencies: [...(series?.currencies ?? [])].sort(),
      sources: [...(series?.sources ?? [])].sort(),
      portfolio_analysis_eligible: false,
      ...quality,
    };
  });

  res.json({
    generated_at: new Date().toISOString(),
    instruments,
    stored_series_not_in_catalog: [...grouped.keys()].filter(
      (key) =>
        !ASSET_CATALOG.some((instrument) => {
          const catalogKey =
            instrument.assetType === "bond"
              ? "bond:RBI_DBIE_GOVT_SECURITY_YIELDS"
              : identityKey(instrument.assetType, instrument.symbol);
          return catalogKey === key;
        }),
    ),
  });
};

export const getHistoricalSeriesAnalysis = async (req, res) => {
  const { assetType, symbol } = req.params;

  if (!ANALYZABLE_TYPES.has(assetType)) {
    throw new HttpError(400, "Analysis is only available for stock, mutualFund, or commodity price series.");
  }

  const instrument = getCatalogInstrument(assetType, symbol);
  if (!instrument) {
    throw new HttpError(404, "The requested series is not in the configured instrument catalog.");
  }

  if (
    (assetType === "mutualFund" && !/^\d+$/.test(symbol)) ||
    (assetType !== "mutualFund" && !/^[a-zA-Z0-9&._-]{1,40}$/.test(symbol))
  ) {
    throw new HttpError(400, "The requested series identifier is invalid.");
  }

  const rawYears = req.query.years ?? "5";
  const years = Number(rawYears);
  if (!Number.isInteger(years) || !ALLOWED_WINDOWS.has(years)) {
    throw new HttpError(400, "years must be one of 1, 3, or 5.");
  }

  const now = new Date();
  const from = getAnalysisStartDate(now, years);

  const rows = await AssetHistory.find({
    assetType,
    symbol: instrument.symbol,
    date: { $gte: from, $lte: now },
  })
    .select("date value close currency source")
    .sort({ date: 1 })
    .limit(MAX_ANALYSIS_OBSERVATIONS + 1)
    .lean();

  if (rows.length > MAX_ANALYSIS_OBSERVATIONS) {
    throw new HttpError(
      422,
      "This series exceeds the safe analysis size. Request a shorter window or reduce the stored observations.",
    );
  }

  const analysis = analyzeHistoricalSeries({
    assetType,
    rows,
    expectedCurrency: instrument.currency,
    expectedSource: instrument.source,
    requestedYears: years,
    asOf: now,
  });

  res.json({
    asset_type: instrument.assetType,
    symbol: instrument.symbol,
    display_name: instrument.displayName,
    data_kind: instrument.dataKind,
    currency: instrument.currency,
    requested_years: years,
    portfolio_analysis_eligible: false,
    ...analysis,
    limitations: [...instrument.limitations, ...analysis.limitations],
  });
};

export const getUniverseAnalysis = async (req, res) => {
  const rawYears = req.query.years ?? "5";
  const years = Number(rawYears);
  if (!Number.isInteger(years) || !ALLOWED_WINDOWS.has(years)) {
    throw new HttpError(400, "years must be one of 1, 3, or 5.");
  }

  const instruments = ASSET_CATALOG.filter(
    (instrument) => instrument.assetType !== "bond" && instrument.priceAnalysisSupported,
  );
  const now = new Date();
  const from = getAnalysisStartDate(now, years);
  const rows = await AssetHistory.find({
    $or: instruments.map(({ assetType, symbol }) => ({ assetType, symbol })),
    date: { $gte: from, $lte: now },
  })
    .select("assetType symbol date value close currency source")
    .sort({ assetType: 1, symbol: 1, date: 1 })
    .limit(MAX_UNIVERSE_ANALYSIS_OBSERVATIONS + 1)
    .lean();

  if (rows.length > MAX_UNIVERSE_ANALYSIS_OBSERVATIONS) {
    throw new HttpError(
      422,
      "The configured market-data universe exceeds the safe analysis size. Request a shorter window or reduce the configured series.",
    );
  }

  const rowsByIdentity = new Map();
  for (const row of rows) {
    const key = identityKey(row.assetType, row.symbol);
    const matchingRows = rowsByIdentity.get(key) ?? [];
    matchingRows.push(row);
    rowsByIdentity.set(key, matchingRows);
  }

  const series = instruments.map((instrument) => {
    const analysis = analyzeHistoricalSeries({
      assetType: instrument.assetType,
      rows: rowsByIdentity.get(identityKey(instrument.assetType, instrument.symbol)) ?? [],
      expectedCurrency: instrument.currency,
      expectedSource: instrument.source,
      requestedYears: years,
      asOf: now,
    });
    const group = instrument.assetType === "mutualFund"
      ? `mutual_fund_${instrument.portfolioProxyClass}`
      : instrument.assetType === "stock"
        ? "stock_price_references"
        : "commodity_price_references";
    const metrics = analysis.metrics
      ? {
          ...analysis.metrics,
          annualized_observed_change_percent: analysis.metrics.annualized_nav_change_percent,
        }
      : null;
    if (metrics) delete metrics.annualized_nav_change_percent;

    return {
      group,
      asset_class: instrument.assetType === "mutualFund"
        ? instrument.portfolioProxyClass
        : instrument.assetClass,
      asset_type: instrument.assetType,
      symbol: instrument.symbol,
      display_name: instrument.displayName,
      data_kind: instrument.dataKind,
      currency: instrument.currency,
      status: analysis.status,
      analysis_window_status: analysis.analysis_window_status,
      metrics,
      data_quality: analysis.data_quality,
      limitations: [...instrument.limitations, ...analysis.limitations],
    };
  });

  const groupedSeries = new Map();
  for (const item of series) {
    const group = groupedSeries.get(item.group) ?? [];
    group.push(item);
    groupedSeries.set(item.group, group);
  }

  const groups = Object.fromEntries(
    [...groupedSeries].map(([groupName, groupSeries]) => {
      const usableReturns = groupSeries
        .filter((item) => item.metrics)
        .map((item) => item.metrics.annualized_observed_change_percent);
      const shortenedWindowSeriesCount = groupSeries.filter(
        (item) => item.analysis_window_status === "shortened_by_one_month",
      ).length;
      return [
        groupName,
        {
          configured_series_count: groupSeries.length,
          usable_series_count: usableReturns.length,
          complete_window_series_count: usableReturns.length - shortenedWindowSeriesCount,
          shortened_window_series_count: shortenedWindowSeriesCount,
          status: usableReturns.length === 0
            ? "metrics_withheld"
            : shortenedWindowSeriesCount > 0
              ? "partial_window_summary_available"
              : "exploratory_summary_available",
          annualized_observed_change_range_percent: usableReturns.length > 0
            ? {
                minimum: roundPercent(Math.min(...usableReturns)),
                median: roundPercent(median(usableReturns)),
                maximum: roundPercent(Math.max(...usableReturns)),
              }
            : null,
          currency: [...new Set(groupSeries.map((item) => item.currency))].sort(),
          series: groupSeries,
          limitations: [
            "This group summarizes only the configured data series that pass individual quality checks; it is not a representative asset-class return or a forecast.",
            groupName === "commodity_price_references"
              ? "Commodity observations are USD reference prices and are not INR investment returns or returns from investable Indian products. A one-year summary with only 11 monthly returns is explicitly marked as one month short and annualized over the observed window."
              : groupName === "stock_price_references"
                ? "Stock price changes exclude dividends and may not adjust for corporate actions."
                : "Mutual-fund NAV changes are scheme-level research examples, not broad asset-class benchmarks.",
          ],
        },
      ];
    }),
  );

  res.json({
    generated_at: now.toISOString(),
    requested_years: years,
    status: "research_only",
    portfolio_recommendations_enabled: false,
    groups,
    excluded_series: ASSET_CATALOG
      .filter((instrument) => instrument.assetType === "bond")
      .map((instrument) => ({
        asset_class: instrument.assetClass,
        symbol: instrument.symbol,
        display_name: instrument.displayName,
        status: "yield_observations_only",
        reason: "Yield observations are not bond price or total-return data and are excluded from return calculations.",
      })),
    methodology: {
      return: "Each supported series uses its latest contiguous complete month-end window, excluding the current incomplete calendar month.",
      grouping: "Stocks, commodities, and mutual-fund proxy classes are reported separately; unlike currencies and data kinds are not combined.",
      recommendation_policy: "Market-data summaries are research-only and do not change the existing goal/risk-based allocation.",
    },
  });
};

export const getFundClassAnalysis = async (req, res) => {
  const rawYears = req.query.years ?? "5";
  const years = Number(rawYears);
  if (!Number.isInteger(years) || !ALLOWED_WINDOWS.has(years)) {
    throw new HttpError(400, "years must be one of 1, 3, or 5.");
  }

  const funds = ASSET_CATALOG.filter(
    (instrument) => instrument.assetType === "mutualFund",
  );
  const symbols = funds.map((instrument) => instrument.symbol);
  const now = new Date();
  const from = getAnalysisStartDate(now, years);

  const rows = await AssetHistory.find({
    assetType: "mutualFund",
    symbol: { $in: symbols },
    date: { $gte: from, $lte: now },
  })
    .select("date value close currency source symbol")
    .sort({ symbol: 1, date: 1 })
    .limit(MAX_CLASS_ANALYSIS_OBSERVATIONS + 1)
    .lean();

  if (rows.length > MAX_CLASS_ANALYSIS_OBSERVATIONS) {
    throw new HttpError(
      422,
      "The configured fund series exceed the safe comparison size. Reduce the history window or configured series.",
    );
  }

  const rowsBySymbol = new Map();
  for (const row of rows) {
    const matchingRows = rowsBySymbol.get(row.symbol) ?? [];
    matchingRows.push(row);
    rowsBySymbol.set(row.symbol, matchingRows);
  }

  const analyzedFunds = funds.map((instrument) => ({
    instrument,
    analysis: analyzeHistoricalSeries({
      assetType: "mutualFund",
      rows: rowsBySymbol.get(instrument.symbol) ?? [],
      expectedCurrency: instrument.currency,
      expectedSource: instrument.source,
      requestedYears: years,
      asOf: now,
    }),
  }));
  const classCoverage = new Map();
  for (const { instrument, analysis } of analyzedFunds) {
    const assetClass = instrument.portfolioProxyClass;
    const coverage = classCoverage.get(assetClass) ?? {
      configured_fund_count: 0,
      usable_series_count: 0,
      target_fund_count: targetFundCountPerProxyClass,
    };
    coverage.configured_fund_count++;
    if (analysis.status === "exploratory_metrics_available") {
      coverage.usable_series_count++;
    }
    classCoverage.set(assetClass, coverage);
  }
  const peerComparisons = {};
  for (const [assetClass] of classCoverage) {
    const eligibleFunds = analyzedFunds
      .filter(({ instrument, analysis }) =>
        instrument.portfolioProxyClass === assetClass &&
        analysis.status === "exploratory_metrics_available",
      )
      .map(({ instrument }) => ({
        symbol: instrument.symbol,
        rows: rowsBySymbol.get(instrument.symbol) ?? [],
      }));
    peerComparisons[assetClass] = compareFundPeersOnCommonWindow(
      eligibleFunds,
      { requestedYears: years, asOf: now },
    );
  }

  res.json({
    generated_at: now.toISOString(),
    requested_years: years,
    status: "research_only",
    portfolio_recommendations_enabled: false,
    fund_coverage: Object.fromEntries(
      [...classCoverage.entries()].map(([assetClass, coverage]) => [
        assetClass,
        {
          ...coverage,
          configured_status: coverage.configured_fund_count >= coverage.target_fund_count
            ? "target_met"
            : "incomplete",
          data_status: coverage.usable_series_count >= coverage.target_fund_count
            ? "target_met"
            : "incomplete",
        },
      ]),
    ),
    peer_comparisons: peerComparisons,
    methodology: {
      fund_proxy_policy: "Configured Direct-Growth schemes are individual research examples, not a representative peer-group estimate; class coverage and peer comparisons are reported separately.",
      shared_window: "Peer NAV ranges use the latest contiguous month-end window shared by all individually eligible configured funds in that class; the comparison is withheld unless at least two series share at least 12 consecutive monthly returns.",
      volatility: "Sample standard deviation of consecutive month-end NAV returns multiplied by square root of 12.",
      return: "Annualized NAV change between first and last month-end observations; not a forecast.",
      comparison: "Benchmark series are not yet enabled because provider coverage, return definitions, and data-use terms have not been verified. No risk-free rate, inflation adjustment, tax, exit-load, or FX conversion is applied.",
    },
    proxies: analyzedFunds.map(({ instrument, analysis }) => {
      return {
        asset_class_proxy: instrument.portfolioProxyClass,
        scheme_code: instrument.symbol,
        scheme_name: instrument.displayName,
        representative_proxy_only: true,
        portfolio_recommendation_eligible: false,
        ...analysis,
        limitations: [...instrument.limitations, ...analysis.limitations],
      };
    }),
  });
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function roundPercent(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
