const LEGACY_ALLOCATION_CLASSES = ["gold", "cash"];

export function migrateLegacyPortfolioDocument(portfolio) {
  const targetAllocation = migrateAllocation(portfolio.target_allocation);
  const actualAllocation = migrateAllocation(portfolio.actual_allocation);
  const investmentExamples = migrateInvestmentExamples(portfolio.investment_examples);
  const hasLegacyData = targetAllocation || actualAllocation || investmentExamples;

  if (!hasLegacyData) return null;

  const marketDataContext = migrateMarketDataContext(portfolio.market_data_context);
  return {
    ...(targetAllocation ? { target_allocation: targetAllocation } : {}),
    ...(actualAllocation ? { actual_allocation: actualAllocation } : {}),
    ...(investmentExamples ? { investment_examples: investmentExamples } : {}),
    ...(marketDataContext ? { market_data_context: marketDataContext } : {}),
    recommendation_version: "three-class-v2-migrated",
    recommendation_explanation:
      "This saved plan was migrated to Equity, Debt, and Commodity. Its former cash-like reserve is now included in Debt, and Gold is represented as Commodity. Refresh the recommendation to calculate a new three-class market-data tilt.",
  };
}

export async function migrateLegacyPortfolios() {
  const Portfolio = (await import("../models/Portfolio.js")).default;
  const legacyDocuments = Portfolio.collection.find({
    $or: [
      { "target_allocation.gold": { $exists: true } },
      { "target_allocation.cash": { $exists: true } },
      { "actual_allocation.gold": { $exists: true } },
      { "actual_allocation.cash": { $exists: true } },
      { "investment_examples.class_amounts.gold": { $exists: true } },
      { "investment_examples.class_amounts.cash": { $exists: true } },
    ],
  });

  let migratedCount = 0;
  for await (const portfolio of legacyDocuments) {
    const updates = migrateLegacyPortfolioDocument(portfolio);
    if (!updates) continue;
    await Portfolio.collection.updateOne(
      { _id: portfolio._id },
      { $set: updates, $currentDate: { updatedAt: true } },
    );
    migratedCount++;
  }

  return migratedCount;
}

function migrateAllocation(allocation) {
  if (!allocation || !LEGACY_ALLOCATION_CLASSES.some((key) => key in allocation)) {
    return null;
  }

  return {
    equity: Number(allocation.equity ?? 0),
    debt: Number(allocation.debt ?? 0) + Number(allocation.cash ?? 0),
    commodity: Number(allocation.commodity ?? allocation.gold ?? 0),
  };
}

function migrateInvestmentExamples(examples) {
  if (!examples?.class_amounts || !LEGACY_ALLOCATION_CLASSES.some((key) => key in examples.class_amounts)) {
    return null;
  }

  const amounts = examples.class_amounts;
  const debtAmount = (field) =>
    Number(amounts.debt?.[field] ?? 0) + Number(amounts.cash?.[field] ?? 0);
  const classAmounts = {
    equity: amounts.equity ?? zeroAmounts(),
    debt: {
      allocation_percent: Number(amounts.debt?.allocation_percent ?? 0) +
        Number(amounts.cash?.allocation_percent ?? 0),
      initial_investment_inr: debtAmount("initial_investment_inr"),
      monthly_contribution_inr: debtAmount("monthly_contribution_inr"),
    },
    commodity: amounts.commodity ?? amounts.gold ?? zeroAmounts(),
  };
  const oldExamples = examples.examples_by_class ?? {};
  const examplesByClass = {
    equity: oldExamples.equity ?? [],
    debt: [...(oldExamples.debt ?? []), ...(oldExamples.cash ?? [])],
    commodity: oldExamples.commodity ?? oldExamples.gold ?? [],
  };
  const {
    display_class_amounts: _displayClassAmounts,
    display_examples_by_class: _displayExamplesByClass,
    ...remainingExamples
  } = examples;

  return {
    ...remainingExamples,
    class_amounts: classAmounts,
    examples_by_class: examplesByClass,
  };
}

function migrateMarketDataContext(context) {
  if (!context?.class_returns) return null;

  const unavailableMetric = {
    annualized_observed_change_percent: null,
    usable_proxy_count: 0,
    scheme_codes: [],
  };
  const legacyReturns = context.class_returns;
  const classReturns = {
    equity: legacyReturns.equity ?? unavailableMetric,
    debt: unavailableMetric,
    commodity: legacyReturns.commodity ?? legacyReturns.gold ?? unavailableMetric,
  };
  const unavailableClasses = ["debt"];
  if (classReturns.equity.annualized_observed_change_percent === null) unavailableClasses.push("equity");
  if (classReturns.commodity.annualized_observed_change_percent === null) unavailableClasses.push("commodity");

  return {
    method: "legacy_four_class_migration",
    status: "baseline_used",
    requested_years: context.requested_years ?? 1,
    maximum_tilt_percentage_points: context.maximum_tilt_percentage_points ?? 10,
    baseline_risky_exposure_percent: null,
    class_returns: classReturns,
    unavailable_classes: unavailableClasses,
    applied_shift: null,
    reason: "legacy_market_tilt_not_recomputed_for_three_class_model",
    legacy_four_class_context: context,
  };
}

function zeroAmounts() {
  return {
    allocation_percent: 0,
    initial_investment_inr: 0,
    monthly_contribution_inr: 0,
  };
}
