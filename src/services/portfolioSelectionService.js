import AssetHistory from "../models/AssetHistory.js";
import InvestableInstrument from "../models/InvestableInstrument.js";

const ASSET_CLASSES = ["equity", "debt", "commodity"];
const MAX_CANDIDATES_PER_CLASS = 10;
const MAX_AGE_DAYS = 45;
const ONE_YEAR_DAYS = 365;
const HISTORY_LOOKBACK_DAYS = 2 * 366;

function validValue(record) {
  const value = record.close ?? record.value;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isFresh(record, now) {
  const age = (now.getTime() - new Date(record.date).getTime()) / 86400000;
  return age >= 0 && age <= MAX_AGE_DAYS;
}

export function calculateObservedReturn(records, now) {
  const latest = records[records.length - 1];
  if (!latest) return null;
  const latestValue = validValue(latest);
  const oneYearAgo = now.getTime() - ONE_YEAR_DAYS * 86400000;
  const start = [...records].reverse().find((record) => new Date(record.date).getTime() <= oneYearAgo);
  const startValue = start && validValue(start);
  if (!latestValue || !startValue) return null;
  const elapsedYears = (new Date(latest.date).getTime() - new Date(start.date).getTime()) / (365.2425 * 86400000);
  if (elapsedYears < 0.95) return null;
  const result = (Math.pow(latestValue / startValue, 1 / elapsedYears) - 1) * 100;
  return Number.isFinite(result) ? Math.round(result * 100) / 100 : null;
}

export function calculateHistoricalRiskMetrics(monthlyObservations) {
  if (monthlyObservations.length < 13) return null;
  const observations = monthlyObservations.slice(-13);
  if (observations.slice(1).some((current, index) => {
    const previousDate = new Date(observations[index].date);
    const currentDate = new Date(current.date);
    const previousMonth = previousDate.getUTCFullYear() * 12 + previousDate.getUTCMonth();
    const currentMonth = currentDate.getUTCFullYear() * 12 + currentDate.getUTCMonth();
    return currentMonth - previousMonth !== 1;
  })) return null;
  const returns = observations.slice(1).map((current, index) =>
    validValue(current) / validValue(observations[index]) - 1);
  if (returns.some((value) => !Number.isFinite(value))) return null;
  const mean = returns.reduce((total, value) => total + value, 0) / returns.length;
  const sampleVariance = returns.reduce((total, value) => total + (value - mean) ** 2, 0)
    / (returns.length - 1);
  let peak = validValue(observations[0]);
  let maximumDrawdown = 0;
  for (const observation of observations) {
    const value = validValue(observation);
    if (!value) return null;
    peak = Math.max(peak, value);
    maximumDrawdown = Math.min(maximumDrawdown, value / peak - 1);
  }
  const annualizedReturn = (Math.pow(validValue(observations.at(-1)) / validValue(observations[0]), 12 / returns.length) - 1) * 100;
  return {
    annualized_return_percent: Math.round(annualizedReturn * 100) / 100,
    annualized_volatility_percent: Math.round(Math.sqrt(sampleVariance * 12) * 10000) / 100,
    maximum_drawdown_percent: Math.round(maximumDrawdown * 10000) / 100,
    monthly_return_observation_count: returns.length,
    start_date: observations[0].date,
    end_date: observations.at(-1).date,
  };
}

export function rankCandidatesForExpectedReturn(candidates, expectedReturnPercent) {
  return candidates.map((candidate) => {
    const historicalReturn = candidate.historical_return_1y_percent;
    if (!Number.isFinite(historicalReturn)) {
      return { ...candidate, historical_return_comparison: null };
    }
    const gap = Math.round((historicalReturn - expectedReturnPercent) * 100) / 100;
    return {
      ...candidate,
      historical_return_comparison: {
        expected_return_percent: expectedReturnPercent,
        gap_percent_points: gap,
        relation: Math.abs(gap) <= 2
          ? "near_assumption_historically"
          : gap < 0
            ? "below_assumption_historically"
            : "above_assumption_historically",
      },
    };
  }).sort((a, b) => {
    const aGap = a.historical_return_comparison?.gap_percent_points;
    const bGap = b.historical_return_comparison?.gap_percent_points;
    if (aGap === undefined && bGap !== undefined) return 1;
    if (aGap !== undefined && bGap === undefined) return -1;
    if (aGap !== undefined && bGap !== undefined && Math.abs(aGap) !== Math.abs(bGap)) {
      return Math.abs(aGap) - Math.abs(bGap);
    }
    const freshness = Number(b.market_data_status === "fresh_observation_available")
      - Number(a.market_data_status === "fresh_observation_available");
    return freshness || a.name.localeCompare(b.name);
  });
}

export function optimizeAllocationForExpectedReturn({
  baselineAllocation,
  historicalClassEstimates,
  expectedReturnPercent,
  maxVolatileExposurePercent,
}) {
  const historicalReturns = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [
    assetClass,
    historicalClassEstimates[assetClass]?.annualized_observed_change_percent,
  ]));
  const missingClasses = ASSET_CLASSES.filter((assetClass) => !Number.isFinite(historicalReturns[assetClass]));
  if (missingClasses.length) {
    return {
      allocation: { ...baselineAllocation },
      status: "optimization_withheld_insufficient_class_history",
      estimated_return_percent: null,
      target_gap_percent_points: null,
      missing_classes: missingClasses,
    };
  }

  let closestFeasible = null;
  let highestAvailable = null;
  for (let equity = 0; equity <= 100; equity++) {
    for (let commodity = 0; commodity <= 100 - equity; commodity++) {
      const volatileExposure = equity + commodity;
      if (volatileExposure > maxVolatileExposurePercent) continue;
      const candidateAllocation = { equity, debt: 100 - volatileExposure, commodity };
      const estimatedReturn = ASSET_CLASSES.reduce(
        (total, assetClass) => total
          + candidateAllocation[assetClass] / 100 * historicalReturns[assetClass],
        0,
      );
      const distanceFromBaseline = ASSET_CLASSES.reduce(
        (total, assetClass) => total
          + Math.abs(candidateAllocation[assetClass] - baselineAllocation[assetClass]),
        0,
      );
      const candidate = { allocation: candidateAllocation, estimatedReturn, distanceFromBaseline, volatileExposure };

      if (!highestAvailable
        || candidate.estimatedReturn > highestAvailable.estimatedReturn
        || (candidate.estimatedReturn === highestAvailable.estimatedReturn
          && candidate.distanceFromBaseline < highestAvailable.distanceFromBaseline)) {
        highestAvailable = candidate;
      }
      if (estimatedReturn >= expectedReturnPercent
        && (!closestFeasible
          || candidate.distanceFromBaseline < closestFeasible.distanceFromBaseline
          || (candidate.distanceFromBaseline === closestFeasible.distanceFromBaseline
            && candidate.volatileExposure < closestFeasible.volatileExposure))) {
        closestFeasible = candidate;
      }
    }
  }

  const selected = closestFeasible ?? highestAvailable;
  if (!selected) {
    return {
      allocation: { ...baselineAllocation },
      status: "optimization_unavailable",
      estimated_return_percent: null,
      target_gap_percent_points: null,
      missing_classes: [],
    };
  }
  return {
    allocation: selected.allocation,
    status: closestFeasible ? "historical_target_met_within_risk_cap" : "historical_target_not_met_within_risk_cap",
    estimated_return_percent: Math.round(selected.estimatedReturn * 100) / 100,
    target_gap_percent_points: Math.round((expectedReturnPercent - selected.estimatedReturn) * 100) / 100,
    missing_classes: [],
  };
}

export function buildPortfolioOptions({ allocation, classAmounts, byAssetClass }) {
  const allocatedClasses = ASSET_CLASSES.filter((assetClass) => allocation[assetClass] > 0);
  if (!allocatedClasses.length || allocatedClasses.some((assetClass) => !byAssetClass[assetClass]?.length)) {
    return [];
  }

  const optionCount = Math.min(
    3,
    ...allocatedClasses.map((assetClass) => byAssetClass[assetClass].length),
  );
  return Array.from({ length: optionCount }, (_, optionIndex) => ({
    id: `illustrative-${optionIndex + 1}`,
    name: `Illustrative portfolio ${optionIndex + 1}`,
    selection_method: "Uses candidates ordered by historical-return proximity to your assumption; this is not a prediction or suitability ranking.",
    holdings: allocatedClasses.flatMap((assetClass) => {
      const candidates = byAssetClass[assetClass];
      const holdingCount = Math.min(2, candidates.length);
      const classAmount = classAmounts[assetClass];
      const oneTimePaise = Math.round(classAmount.one_time_investment_inr * 100);
      const monthlyPaise = Math.round(classAmount.monthly_contribution_inr * 100);
      return Array.from({ length: holdingCount }, (_, holdingIndex) => {
        const candidate = candidates[(optionIndex + holdingIndex) % candidates.length];
        return {
          ...candidate,
          allocation_percent: Math.round(allocation[assetClass] / holdingCount * 100) / 100,
          one_time_investment_inr: (holdingIndex === holdingCount - 1
            ? oneTimePaise - Math.floor(oneTimePaise / holdingCount) * (holdingCount - 1)
            : Math.floor(oneTimePaise / holdingCount)) / 100,
          monthly_contribution_inr: (holdingIndex === holdingCount - 1
            ? monthlyPaise - Math.floor(monthlyPaise / holdingCount) * (holdingCount - 1)
            : Math.floor(monthlyPaise / holdingCount)) / 100,
        };
      });
    }),
  }));
}

export async function selectPortfolioAssets({
  allocation,
  maxVolatileExposurePercent,
  investmentType,
  initialInvestment,
  monthlyContribution,
  expectedReturnPercent,
  now = new Date(),
}) {
  for (const assetClass of ASSET_CLASSES) {
    const weight = allocation?.[assetClass];
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
      throw new Error(`Invalid allocation for ${assetClass}.`);
    }
  }
  if (Math.abs(ASSET_CLASSES.reduce((total, assetClass) => total + allocation[assetClass], 0) - 100) > 0.01) {
    throw new Error("Asset allocation must total 100%.");
  }
  if (!Number.isFinite(maxVolatileExposurePercent)
    || maxVolatileExposurePercent < 0
    || maxVolatileExposurePercent > 100
    || allocation.equity + allocation.commodity > maxVolatileExposurePercent + 0.01) {
    throw new Error("A valid volatile-exposure risk cap is required.");
  }
  if (!["one_time", "monthly"].includes(investmentType)) {
    throw new Error("investmentType must be one_time or monthly.");
  }
  if (!Number.isFinite(expectedReturnPercent) || expectedReturnPercent < 0 || expectedReturnPercent > 100) {
    throw new Error("expectedReturnPercent must be between 0 and 100.");
  }
  if (![initialInvestment, monthlyContribution].every((amount) =>
    Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000_000_000)) {
    throw new Error("Investment amounts must be between 0 and 1000000000000.");
  }
  if (investmentType === "one_time" && (initialInvestment <= 0 || monthlyContribution !== 0)) {
    throw new Error("One-time investment requires a positive initial amount and no monthly contribution.");
  }
  if (investmentType === "monthly" && (monthlyContribution <= 0 || initialInvestment !== 0)) {
    throw new Error("Monthly investment requires a positive monthly contribution and no initial amount.");
  }

  const instruments = await InvestableInstrument.find({
    isVerified: true,
    isInvestable: true,
    assetClass: { $in: ASSET_CLASSES },
  }).sort({ assetClass: 1, name: 1 }).lean();
  const symbols = [...new Set(instruments.map((item) => item.schemeCode || item.symbol))];
  const historyBySymbol = new Map();
  const historicalRiskBySymbol = new Map();
  if (symbols.length) {
    const dateCutoff = new Date(now.getTime() - ONE_YEAR_DAYS * 86400000);
    const lookbackStart = new Date(now.getTime() - HISTORY_LOOKBACK_DAYS * 86400000);
    const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const match = {
      symbol: { $in: symbols },
      assetType: { $in: ["stock", "mutualFund"] },
      date: { $gte: lookbackStart, $lte: now },
    };
    const latestMatch = {
      symbol: { $in: symbols },
      assetType: { $in: ["stock", "mutualFund"] },
      date: { $lte: now },
    };
    const project = {
      _id: 0,
      symbol: 1,
      assetType: 1,
      date: 1,
      close: 1,
      value: 1,
      currency: 1,
      source: 1,
    };
    const [latestRows, startRows, monthlyRows] = await Promise.all([
      AssetHistory.aggregate([
        { $match: latestMatch },
        { $sort: { symbol: 1, date: -1 } },
        { $group: { _id: "$symbol", record: { $first: "$$ROOT" } } },
        { $replaceRoot: { newRoot: "$record" } },
        { $project: project },
      ]),
      AssetHistory.aggregate([
        { $match: { ...match, date: { $gte: lookbackStart, $lte: dateCutoff } } },
        { $sort: { symbol: 1, date: -1 } },
        { $group: { _id: "$symbol", record: { $first: "$$ROOT" } } },
        { $replaceRoot: { newRoot: "$record" } },
        { $project: project },
      ]),
      AssetHistory.aggregate([
        {
          $match: {
            ...match,
            date: { $gte: lookbackStart, $lt: currentMonthStart },
          },
        },
        {
          $project: {
            symbol: 1,
            date: 1,
            close: 1,
            value: 1,
            currency: 1,
            source: 1,
          },
        },
        { $sort: { symbol: 1, date: 1 } },
        {
          $group: {
            _id: {
              symbol: "$symbol",
              month: { $dateToString: { format: "%Y-%m", date: "$date", timezone: "UTC" } },
            },
            record: { $last: "$$ROOT" },
          },
        },
        { $sort: { "_id.symbol": 1, "_id.month": 1 } },
        {
          $group: {
            _id: "$_id.symbol",
            observations: { $push: "$record" },
            currencies: { $addToSet: "$record.currency" },
            sources: { $addToSet: "$record.source" },
          },
        },
        { $project: { _id: 0, symbol: "$_id", observations: 1, currencies: 1, sources: 1 } },
      ]),
    ]);

    const instrumentsBySymbol = new Map(
      instruments.map((instrument) => [String(instrument.schemeCode || instrument.symbol), instrument]),
    );
    for (const { symbol, observations, currencies, sources } of monthlyRows) {
      const instrument = instrumentsBySymbol.get(String(symbol));
      const expectedSource = instrument?.instrumentType === "stock" ? "TejHQ" : "MFapi.in";
      const metrics = instrument
        && currencies.length === 1
        && currencies[0] === instrument.currency
        && sources.length === 1
        && sources[0] === expectedSource
        ? calculateHistoricalRiskMetrics(observations)
        : null;
      historicalRiskBySymbol.set(String(symbol), metrics);
    }
    for (const record of startRows) historyBySymbol.set(String(record.symbol), [record]);
    for (const record of latestRows) {
      const rows = historyBySymbol.get(String(record.symbol)) ?? [];
      if (!rows.some((row) => row.date.getTime() === record.date.getTime())) rows.push(record);
      rows.sort((a, b) => a.date - b.date);
      historyBySymbol.set(String(record.symbol), rows);
    }
  }

  const byAssetClass = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, []]));
  for (const instrument of instruments) {
    const rows = historyBySymbol.get(String(instrument.schemeCode || instrument.symbol)) ?? [];
    const latest = rows[rows.length - 1] ?? null;
    const fresh = latest ? isFresh(latest, now) : false;
    byAssetClass[instrument.assetClass].push({
      id: String(instrument._id),
      symbol: instrument.symbol,
      name: instrument.name,
      asset_class: instrument.assetClass,
      instrument_type: instrument.instrumentType,
      currency: instrument.currency,
      exchange: instrument.exchange,
      scheme_code: instrument.schemeCode,
      verification_source: instrument.verificationSource,
      verified_at: instrument.verifiedAt,
      latest_observation: latest && fresh && validValue(latest) !== null
        ? {
          value: validValue(latest),
          date: latest.date,
          source: latest.source,
          currency: latest.currency,
        }
        : null,
      market_data_status: !latest ? "no_stored_observation" : fresh ? "fresh_observation_available" : "stale_observation",
      historical_return_1y_percent: fresh ? calculateObservedReturn(rows, now) : null,
      historical_risk_metrics: fresh ? historicalRiskBySymbol.get(String(instrument.schemeCode || instrument.symbol)) ?? null : null,
      return_metric_note: instrument.instrumentType === "stock"
        ? "Observed price change; excludes dividends and may exclude corporate actions."
        : "Observed NAV change; backward-looking and not a forecast.",
    });
  }

  const historicalCandidatesByClass = Object.fromEntries(
    ASSET_CLASSES.map((assetClass) => [assetClass, [...byAssetClass[assetClass]]]),
  );
  for (const assetClass of ASSET_CLASSES) {
    byAssetClass[assetClass] = rankCandidatesForExpectedReturn(byAssetClass[assetClass], expectedReturnPercent)
      .slice(0, MAX_CANDIDATES_PER_CLASS);
  }

  const historicalClassEstimates = Object.fromEntries(ASSET_CLASSES.map((assetClass) => {
    const returns = historicalCandidatesByClass[assetClass]
      .map((candidate) => candidate.historical_return_1y_percent)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const middle = Math.floor(returns.length / 2);
    const median = returns.length === 0
      ? null
      : returns.length % 2
        ? returns[middle]
        : (returns[middle - 1] + returns[middle]) / 2;
    return [assetClass, { annualized_observed_change_percent: median, usable_candidate_count: returns.length }];
  }));

  const baselineAllocation = { ...allocation };
  const allocationOptimization = optimizeAllocationForExpectedReturn({
    baselineAllocation,
    historicalClassEstimates,
    expectedReturnPercent,
    maxVolatileExposurePercent,
  });
  const recommendedAllocation = allocationOptimization.allocation;
  const missingReturnClasses = ASSET_CLASSES.filter(
    (assetClass) => recommendedAllocation[assetClass] > 0
      && historicalClassEstimates[assetClass].annualized_observed_change_percent === null,
  );
  const historicalPortfolioReturn = missingReturnClasses.length
    ? null
    : ASSET_CLASSES.reduce(
      (total, assetClass) => total + recommendedAllocation[assetClass] / 100
        * (historicalClassEstimates[assetClass].annualized_observed_change_percent ?? 0),
      0,
    );

  const yieldRows = await AssetHistory.find({ assetType: "bond" })
    .select("symbol date value currency source rawData")
    .sort({ date: -1 })
    .limit(100)
    .lean();
  const latestYieldBySeries = new Map();
  for (const row of yieldRows) {
    if (!latestYieldBySeries.has(row.symbol)) latestYieldBySeries.set(row.symbol, row);
  }
  const governmentYieldReferences = [...latestYieldBySeries.values()].slice(0, MAX_CANDIDATES_PER_CLASS).map((row) => ({
    symbol: row.symbol,
    maturity: row.rawData?.mat_per_rn ?? null,
    yield_percent: row.value,
    date: row.date,
    source: row.source,
    currency: row.currency,
    status: isFresh(row, now) ? "indicative_yield_reference" : "stale_yield_reference",
    warning: "A government-security yield observation is not a specific available security, guaranteed return, or bond total-return series.",
  }));

  const amounts = {
    one_time: investmentType === "one_time" ? initialInvestment : 0,
    monthly: investmentType === "monthly" ? monthlyContribution : 0,
  };
  const classAmounts = Object.fromEntries(ASSET_CLASSES.map((assetClass) => [assetClass, {
    allocation_percent: recommendedAllocation[assetClass],
    one_time_investment_inr: 0,
    monthly_contribution_inr: 0,
  }]));
  for (const [field, amount] of [
    ["one_time_investment_inr", amounts.one_time],
    ["monthly_contribution_inr", amounts.monthly],
  ]) {
    let allocatedPaise = 0;
    ASSET_CLASSES.forEach((assetClass, index) => {
      const paise = index === ASSET_CLASSES.length - 1
        ? Math.round(amount * 100) - allocatedPaise
        : Math.round(amount * 100 * recommendedAllocation[assetClass] / 100);
      classAmounts[assetClass][field] = paise / 100;
      allocatedPaise += paise;
    });
  }
  const classesWithoutCandidates = ASSET_CLASSES.filter(
    (assetClass) => recommendedAllocation[assetClass] > 0 && byAssetClass[assetClass].length === 0,
  );
  const portfolioOptions = buildPortfolioOptions({
    allocation: recommendedAllocation,
    classAmounts,
    byAssetClass,
  });

  return {
    status: classesWithoutCandidates.length ? "incomplete_verified_instrument_coverage" : "verified_candidates_available_review_required",
    allocation: recommendedAllocation,
    baseline_allocation: baselineAllocation,
    class_amounts: classAmounts,
    by_asset_class: byAssetClass,
    illustrative_portfolios: portfolioOptions,
    return_analysis: {
      expected_annual_return_percent: expectedReturnPercent,
      allocation_optimization: {
        ...allocationOptimization,
        max_volatile_exposure_percent: maxVolatileExposurePercent,
      },
      historical_class_estimates: historicalClassEstimates,
      historical_portfolio_return_proxy_percent: historicalPortfolioReturn === null
        ? null
        : Math.round(historicalPortfolioReturn * 100) / 100,
      gap_from_historical_proxy_percent_points: historicalPortfolioReturn === null
        ? null
        : Math.round((expectedReturnPercent - historicalPortfolioReturn) * 100) / 100,
      status: historicalPortfolioReturn === null
        ? "insufficient_data_for_complete_portfolio_proxy"
        : "historical_proxy_comparison_available",
      missing_allocated_classes: missingReturnClasses,
      note: "Backward-looking annualized price/NAV changes are not forecasts. Stock price changes exclude dividends; RBI yields are not bond total returns.",
    },
    government_security_yield_references: governmentYieldReferences,
    classes_without_verified_candidates: classesWithoutCandidates,
    generated_at: now.toISOString(),
    limitations: [
      "Only catalog records explicitly marked verified and investable are shown as candidates.",
      "Candidates are educational comparisons, not buy orders or a guarantee of suitability.",
      "Stock-price and mutual-fund NAV changes are historical observations, not forecasts.",
      "Government-security yield observations are references only; they do not identify a purchasable security.",
    ],
  };
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
