const DAY_MS = 24 * 60 * 60 * 1000;
const MINIMUM_MONTHLY_RETURNS = 12;

const SERIES_RULES = {
  stock: { minimumObservations: 30, freshnessDays: 14 },
  mutualFund: { minimumObservations: 30, freshnessDays: 14 },
  commodity: { minimumObservations: 12, freshnessDays: 62 },
};

const utcDay = (value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

const daysBetween = (from, to) => Math.floor((to - from) / DAY_MS);

function getSeriesValue(row) {
  const value = row.value ?? row.close;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function normalizeObservations(rows, asOf) {
  const today = utcDay(asOf);
  const byDate = new Map();
  let invalidObservationCount = 0;
  let futureObservationCount = 0;

  for (const row of rows) {
    const date = utcDay(row.date);
    const value = getSeriesValue(row);

    if (date !== null && date > today) {
      futureObservationCount++;
      invalidObservationCount++;
      continue;
    }
    if (date === null || value === null) {
      invalidObservationCount++;
      continue;
    }

    const existing = byDate.get(date) ?? [];
    existing.push(value);
    byDate.set(date, existing);
  }

  const observations = [];
  let duplicateObservationCount = 0;
  let conflictingDateCount = 0;

  for (const [date, values] of byDate) {
    if (values.length > 1) {
      duplicateObservationCount += values.length - 1;
    }

    if (new Set(values).size > 1) {
      conflictingDateCount++;
      continue;
    }

    observations.push({ date, value: values[0] });
  }

  observations.sort((a, b) => a.date - b.date);

  return {
    observations,
    invalidObservationCount,
    futureObservationCount,
    duplicateObservationCount,
    conflictingDateCount,
  };
}

function monthIndex(date) {
  const value = new Date(date);
  return value.getUTCFullYear() * 12 + value.getUTCMonth();
}

function monthlySeries(observations, asOf) {
  const byMonth = new Map();
  const currentMonth = monthIndex(asOf);

  for (const observation of observations) {
    const month = monthIndex(observation.date);
    if (month < currentMonth) byMonth.set(month, observation);
  }

  const points = [...byMonth.entries()]
    .sort(([monthA], [monthB]) => monthA - monthB)
    .map(([month, observation]) => ({ month, ...observation }));
  let missingMonthCount = 0;
  const returns = [];

  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    const monthDifference = current.month - previous.month;

    if (monthDifference > 1) {
      missingMonthCount += monthDifference - 1;
    } else if (monthDifference === 1) {
      returns.push(current.value / previous.value - 1);
    }
  }

  return { points, returns, missingMonthCount };
}

function calculateMetrics(monthlyPoints, monthlyReturns) {
  const first = monthlyPoints[0];
  const last = monthlyPoints.at(-1);
  const coverageDays = daysBetween(first.date, last.date);
  let peak = first.value;
  let maximumDrawdown = 0;

  for (const observation of monthlyPoints) {
    peak = Math.max(peak, observation.value);
    maximumDrawdown = Math.min(
      maximumDrawdown,
      observation.value / peak - 1,
    );
  }

  const navChange = last.value / first.value - 1;
  const meanMonthlyReturn =
    monthlyReturns.reduce((total, value) => total + value, 0) /
    monthlyReturns.length;
  const sampleVariance =
    monthlyReturns.reduce(
      (total, value) => total + (value - meanMonthlyReturn) ** 2,
      0,
    ) /
    (monthlyReturns.length - 1);

  return {
    start_date: new Date(first.date).toISOString().slice(0, 10),
    end_date: new Date(last.date).toISOString().slice(0, 10),
    start_value: first.value,
    end_value: last.value,
    month_end_observation_count: monthlyPoints.length,
    monthly_return_observation_count: monthlyReturns.length,
    observed_nav_change_percent: roundPercent(navChange * 100),
    annualized_nav_change_percent: roundPercent(
      (Math.pow(last.value / first.value, 12 / monthlyReturns.length) - 1) * 100,
    ),
    annualized_volatility_percent: roundPercent(
      Math.sqrt(sampleVariance * 12) * 100,
    ),
    maximum_drawdown_percent: roundPercent(maximumDrawdown * 100),
    coverage_days: coverageDays,
  };
}

export function summarizeSeriesQuality({
  assetType,
  observationCount,
  firstDate,
  latestDate,
  now = new Date(),
}) {
  if (assetType === "bond") {
    return {
      status: observationCount > 0 ? "yield_observations_only" : "not_seeded",
      observation_count: observationCount,
      coverage_days: null,
      latest_age_days: latestDate
        ? daysBetween(utcDay(latestDate), utcDay(now))
        : null,
      freshness_limit_days: null,
    };
  }

  const rules = SERIES_RULES[assetType];
  if (!rules) {
    throw new Error(`Unsupported asset type: ${assetType}`);
  }

  if (observationCount === 0 || !firstDate || !latestDate) {
    return {
      status: "not_seeded",
      observation_count: observationCount,
      coverage_days: 0,
      latest_age_days: null,
      freshness_limit_days: rules.freshnessDays,
    };
  }

  const today = utcDay(now);
  const first = utcDay(firstDate);
  const latest = utcDay(latestDate);
  const coverageDays = daysBetween(first, latest);
  const coverageMonths = monthIndex(latest) - monthIndex(first);
  const latestAgeDays = daysBetween(latest, today);

  let status = "ready_for_exploratory_analysis";
  if (latest > today) {
    status = "future_dated";
  } else if (latestAgeDays > rules.freshnessDays) {
    status = "stale";
  } else if (
    observationCount < rules.minimumObservations ||
    coverageMonths < MINIMUM_MONTHLY_RETURNS
  ) {
    status = "insufficient_coverage";
  }

  return {
    status,
    observation_count: observationCount,
    coverage_days: coverageDays,
    latest_age_days: latestAgeDays,
    freshness_limit_days: rules.freshnessDays,
  };
}

export function analyzeHistoricalSeries({
  assetType,
  rows,
  expectedCurrency,
  expectedSource,
  requestedYears,
  asOf = new Date(),
}) {
  const rules = SERIES_RULES[assetType];
  if (!rules) {
    throw new Error(`Historical price analysis is unsupported for ${assetType}.`);
  }

  const normalized = normalizeObservations(rows, asOf);
  const currencies = [
    ...new Set(rows.map((row) => row.currency).filter(Boolean)),
  ].sort();
  const sources = [...new Set(rows.map((row) => row.source).filter(Boolean))].sort();
  const latest = normalized.observations.at(-1);
  const first = normalized.observations[0];
  const quality = summarizeSeriesQuality({
    assetType,
    observationCount: normalized.observations.length,
    firstDate: first ? new Date(first.date) : null,
    latestDate: latest ? new Date(latest.date) : null,
    now: asOf,
  });
  let monthly = monthlySeries(normalized.observations, asOf);
  const requestedMonthlyReturns = requestedYears
    ? requestedYears * 12
    : MINIMUM_MONTHLY_RETURNS;
  const shortenedCommodityWindow =
    assetType === "commodity" &&
    requestedYears === 1 &&
    monthly.returns.length === 11 &&
    monthly.points.length === 12 &&
    monthly.missingMonthCount === 0;
  const requiredMonthlyReturns = shortenedCommodityWindow
    ? 11
    : requestedMonthlyReturns;
  if (requestedYears) {
    const requiredPoints = requiredMonthlyReturns + 1;
    if (monthly.points.length > requiredPoints) {
      monthly = monthlySeries(monthly.points.slice(-requiredPoints), asOf);
    }
  }
  const reasons = [];

  if (currencies.length !== 1 || currencies[0] !== expectedCurrency) {
    reasons.push("currency_mismatch");
  }
  if (
    expectedSource &&
    (sources.length !== 1 || sources[0] !== expectedSource)
  ) {
    reasons.push("source_mismatch");
  }
  if (quality.status === "stale") reasons.push("data_is_stale");
  if (normalized.futureObservationCount > 0) reasons.push("future_dated_observations");
  if (normalized.observations.length < rules.minimumObservations) {
    reasons.push("too_few_valid_observations");
  }
  if (monthly.returns.length < requiredMonthlyReturns) {
    reasons.push("insufficient_monthly_return_history");
  }
  if (shortenedCommodityWindow) {
    reasons.push("one_month_short_of_requested_window");
  }
  if (monthly.missingMonthCount > 0) {
    reasons.push("missing_calendar_months");
  }

  const hasSufficientHistory =
    normalized.observations.length >= rules.minimumObservations &&
    monthly.returns.length >= requiredMonthlyReturns &&
    monthly.missingMonthCount === 0 &&
    normalized.futureObservationCount === 0 &&
    quality.status !== "stale" &&
    quality.status !== "future_dated" &&
    !reasons.includes("currency_mismatch") &&
    !reasons.includes("source_mismatch");

  return {
    status: hasSufficientHistory ? "exploratory_metrics_available" : "metrics_withheld",
    analysis_window_status: shortenedCommodityWindow
      ? "shortened_by_one_month"
      : monthly.returns.length >= requestedMonthlyReturns
        ? "complete"
        : "insufficient",
    metrics: hasSufficientHistory
      ? calculateMetrics(monthly.points, monthly.returns)
      : null,
    data_quality: {
      fetched_observation_count: rows.length,
      valid_observation_count: normalized.observations.length,
      invalid_observation_count: normalized.invalidObservationCount,
      future_observation_count: normalized.futureObservationCount,
      duplicate_observation_count: normalized.duplicateObservationCount,
      conflicting_date_count: normalized.conflictingDateCount,
      month_end_observation_count: monthly.points.length,
      monthly_return_observation_count: monthly.returns.length,
      requested_monthly_return_count: requestedMonthlyReturns,
      analysis_window_status: shortenedCommodityWindow
        ? "shortened_by_one_month"
        : monthly.returns.length >= requestedMonthlyReturns
          ? "complete"
          : "insufficient",
      missing_calendar_month_count: monthly.missingMonthCount,
      currencies,
      expected_currency: expectedCurrency,
      sources,
      ...quality,
      first_date: first
        ? new Date(first.date).toISOString().slice(0, 10)
        : null,
      latest_date: latest
        ? new Date(latest.date).toISOString().slice(0, 10)
        : null,
      reasons,
    },
    limitations: [
      "Historical price/NAV movement is not a forecast and does not establish suitability.",
      "The current calendar month is excluded because its monthly observation may be incomplete.",
      "Annualized NAV change compounds the first and last month-end NAV over the count of consecutive monthly returns in the selected window.",
      "Annualized volatility is the sample standard deviation of consecutive month-end NAV returns multiplied by the square root of 12.",
      "Maximum drawdown uses month-end NAVs and may miss intramonth losses.",
      "NAV changes include fund expenses and exclude investor tax and exit load; no benchmark-relative, inflation-adjusted, or currency-converted analysis is provided.",
    ],
  };
}

function roundPercent(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
