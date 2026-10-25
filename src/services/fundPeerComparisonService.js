const monthIndex = (date) => {
  const value = new Date(date);
  return value.getUTCFullYear() * 12 + value.getUTCMonth();
};

const monthLabel = (month) => {
  const year = Math.floor(month / 12);
  const calendarMonth = month % 12;
  return `${year}-${String(calendarMonth + 1).padStart(2, "0")}`;
};

const roundPercent = (value) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function monthEndValues(rows, asOf) {
  const valuesByMonth = new Map();
  const currentMonth = monthIndex(asOf);
  for (const row of rows) {
    const date = new Date(row.date);
    const value = row.value ?? row.close;
    if (!Number.isFinite(date.getTime()) || !Number.isFinite(value) || value <= 0) {
      continue;
    }
    const month = monthIndex(date);
    if (month >= currentMonth) continue;
    const existing = valuesByMonth.get(month);
    if (!existing || date > existing.date) {
      valuesByMonth.set(month, { date, value });
    }
  }
  return new Map(
    [...valuesByMonth].map(([month, observation]) => [month, observation.value]),
  );
}

export function compareFundPeersOnCommonWindow(
  series,
  {
    minimumPeers = 2,
    minimumMonthlyReturns = 12,
    requestedYears,
    asOf = new Date(),
  } = {},
) {
  const reasons = [];
  if (series.length < minimumPeers) {
    reasons.push("too_few_usable_peer_series");
  }

  const valuesBySymbol = series.map(({ symbol, rows }) => ({
    symbol,
    valuesByMonth: monthEndValues(rows, asOf),
  }));
  const commonMonths = valuesBySymbol.length === 0
    ? []
    : [...valuesBySymbol[0].valuesByMonth.keys()]
        .filter((month) =>
          valuesBySymbol.every(({ valuesByMonth }) => valuesByMonth.has(month)),
        )
        .sort((a, b) => a - b);

  let contiguousMonths = [];
  for (let index = commonMonths.length - 1; index >= 0; index--) {
    if (
      contiguousMonths.length > 0 &&
      commonMonths[index + 1] - commonMonths[index] !== 1
    ) {
      break;
    }
    contiguousMonths.unshift(commonMonths[index]);
  }

  const requiredMonthlyReturns = requestedYears
    ? requestedYears * 12
    : minimumMonthlyReturns;
  const requiredMonths = requiredMonthlyReturns + 1;
  if (contiguousMonths.length > requiredMonths) {
    contiguousMonths = contiguousMonths.slice(-requiredMonths);
  }
  const monthlyReturnCount = Math.max(0, contiguousMonths.length - 1);
  if (monthlyReturnCount < requiredMonthlyReturns) {
    reasons.push("insufficient_contiguous_common_months");
  }

  const returns = valuesBySymbol.map(({ symbol, valuesByMonth }) => {
    if (contiguousMonths.length < 2) return { symbol, annualizedReturn: null };
    const startValue = valuesByMonth.get(contiguousMonths[0]);
    const endValue = valuesByMonth.get(contiguousMonths.at(-1));
    return {
      symbol,
      annualizedReturn:
        (Math.pow(endValue / startValue, 12 / monthlyReturnCount) - 1) * 100,
    };
  });
  const annualizedReturns = returns
    .map(({ annualizedReturn }) => annualizedReturn)
    .filter(Number.isFinite);

  const available = reasons.length === 0;
  return {
    status: available ? "peer_range_available" : "peer_range_withheld",
    series_count: series.length,
    common_window: contiguousMonths.length > 0
      ? {
          start_month: monthLabel(contiguousMonths[0]),
          end_month: monthLabel(contiguousMonths.at(-1)),
          month_end_observation_count: contiguousMonths.length,
          monthly_return_count: monthlyReturnCount,
        }
      : null,
    annualized_nav_change_range_percent: available
      ? {
          minimum: roundPercent(Math.min(...annualizedReturns)),
          median: roundPercent(median(annualizedReturns)),
          maximum: roundPercent(Math.max(...annualizedReturns)),
        }
      : null,
    reasons,
    limitations: [
      "Peer range uses only configured same-class schemes with individually eligible series and their latest contiguous shared month-end window.",
      "The current calendar month is excluded because its monthly observation may be incomplete.",
      "The range describes historical NAV changes, not a representative asset-class return or a ranking.",
      "No external benchmark, taxes, exit loads, or FX adjustment is applied.",
    ],
  };
}
