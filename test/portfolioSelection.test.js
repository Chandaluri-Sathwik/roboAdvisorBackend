import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPortfolioOptions,
  calculateHistoricalRiskMetrics,
  calculateObservedReturn,
  filterInstrumentsForInvestmentType,
  optimizeAllocationForExpectedReturn,
  rankCandidatesForExpectedReturn,
} from "../src/services/portfolioSelectionService.js";

test("monthly options include mutual funds while one-time options retain every candidate type", () => {
  const instruments = [
    { symbol: "ABC", instrumentType: "stock" },
    { symbol: "12345", instrumentType: "mutualFund" },
    { symbol: "GOVT", instrumentType: "governmentBond" },
  ];

  assert.deepEqual(
    filterInstrumentsForInvestmentType(instruments, "monthly").map(({ instrumentType }) => instrumentType),
    ["mutualFund"],
  );
  assert.deepEqual(filterInstrumentsForInvestmentType(instruments, "one_time"), instruments);
  assert.throws(() => filterInstrumentsForInvestmentType(instruments, "weekly"), /investmentType/);
});

test("one-year observed return uses the closest observation before the one-year cutoff", () => {
  const now = new Date("2025-01-02T00:00:00.000Z");
  const records = [
    { date: new Date("2023-01-01T00:00:00.000Z"), close: 100 },
    { date: new Date("2024-01-03T00:00:00.000Z"), close: 120 },
    { date: new Date("2025-01-02T00:00:00.000Z"), close: 132 },
  ];
  assert.equal(calculateObservedReturn(records, now), 10.01);
});

test("one-year observed return is withheld without sufficient history", () => {
  assert.equal(calculateObservedReturn([
    { date: new Date("2024-06-01T00:00:00.000Z"), value: 100 },
    { date: new Date("2025-01-01T00:00:00.000Z"), value: 110 },
  ], new Date("2025-01-01T00:00:00.000Z")), null);
});

test("historical risk metrics require a full year and report volatility and drawdown", () => {
  assert.equal(calculateHistoricalRiskMetrics(Array.from({ length: 12 }, (_, index) => ({
    date: new Date(Date.UTC(2024, index, 1)),
    value: 100 + index,
  }))), null);

  const metrics = calculateHistoricalRiskMetrics(Array.from({ length: 13 }, (_, index) => ({
    date: new Date(Date.UTC(2024, index, 1)),
    value: index === 8 ? 90 : 100 + index,
  })));
  assert.equal(metrics.monthly_return_observation_count, 12);
  assert.ok(metrics.annualized_volatility_percent > 0);
  assert.ok(metrics.maximum_drawdown_percent < 0);
  assert.equal(metrics.start_date.toISOString().slice(0, 10), "2024-01-01");
});

test("candidate ranking uses historical distance to assumption, not predicted likelihood", () => {
  const ranked = rankCandidatesForExpectedReturn([
    { id: "far-below", name: "Far below", historical_return_1y_percent: 3, market_data_status: "fresh_observation_available" },
    { id: "near", name: "Near", historical_return_1y_percent: 8.5, market_data_status: "fresh_observation_available" },
    { id: "above", name: "Above", historical_return_1y_percent: 10, market_data_status: "fresh_observation_available" },
    { id: "no-history", name: "No history", historical_return_1y_percent: null, market_data_status: "fresh_observation_available" },
  ], 9);

  assert.deepEqual(ranked.map((candidate) => candidate.id), ["near", "above", "far-below", "no-history"]);
  assert.equal(ranked[0].historical_return_comparison.relation, "near_assumption_historically");
  assert.equal(ranked[1].historical_return_comparison.gap_percent_points, 1);
  assert.equal(ranked[3].historical_return_comparison, null);
});

test("return optimizer meets a reachable historical objective with minimal baseline adjustment", () => {
  const result = optimizeAllocationForExpectedReturn({
    baselineAllocation: { equity: 40, debt: 50, commodity: 10 },
    historicalClassEstimates: {
      equity: { annualized_observed_change_percent: 12 },
      debt: { annualized_observed_change_percent: 4 },
      commodity: { annualized_observed_change_percent: 10 },
    },
    expectedReturnPercent: 8.5,
    maxVolatileExposurePercent: 60,
  });
  assert.equal(result.status, "historical_target_met_within_risk_cap");
  assert.ok(result.estimated_return_percent >= 8.5);
  assert.ok(result.allocation.equity + result.allocation.commodity <= 60);
  assert.equal(
    result.allocation.equity + result.allocation.debt + result.allocation.commodity,
    100,
  );
});

test("return optimizer returns the closest achievable result without exceeding risk cap", () => {
  const result = optimizeAllocationForExpectedReturn({
    baselineAllocation: { equity: 20, debt: 70, commodity: 10 },
    historicalClassEstimates: {
      equity: { annualized_observed_change_percent: 5 },
      debt: { annualized_observed_change_percent: 4 },
      commodity: { annualized_observed_change_percent: 3 },
    },
    expectedReturnPercent: 9,
    maxVolatileExposurePercent: 25,
  });
  assert.equal(result.status, "historical_target_not_met_within_risk_cap");
  assert.ok(result.estimated_return_percent < 9);
  assert.ok(result.allocation.equity + result.allocation.commodity <= 25);
  assert.ok(result.target_gap_percent_points > 0);
});

test("return optimizer retains the baseline if any asset-class history is missing", () => {
  const baselineAllocation = { equity: 20, debt: 70, commodity: 10 };
  const result = optimizeAllocationForExpectedReturn({
    baselineAllocation,
    historicalClassEstimates: {
      equity: { annualized_observed_change_percent: 8 },
      debt: { annualized_observed_change_percent: null },
      commodity: { annualized_observed_change_percent: 12 },
    },
    expectedReturnPercent: 9,
    maxVolatileExposurePercent: 35,
  });
  assert.equal(result.status, "optimization_withheld_insufficient_class_history");
  assert.deepEqual(result.allocation, baselineAllocation);
  assert.deepEqual(result.missing_classes, ["debt"]);
});

test("portfolio examples preserve the class mix and divide amounts across verified candidates", () => {
  const portfolios = buildPortfolioOptions({
    allocation: { equity: 40, debt: 50, commodity: 10 },
    classAmounts: {
      equity: { one_time_investment_inr: 4000, monthly_contribution_inr: 6000 },
      debt: { one_time_investment_inr: 5000, monthly_contribution_inr: 7500 },
      commodity: { one_time_investment_inr: 1000, monthly_contribution_inr: 1500 },
    },
    byAssetClass: {
      equity: [{ id: "e1", asset_class: "equity" }, { id: "e2", asset_class: "equity" }, { id: "e3", asset_class: "equity" }],
      debt: [{ id: "d1", asset_class: "debt" }, { id: "d2", asset_class: "debt" }],
      commodity: [{ id: "c1", asset_class: "commodity" }, { id: "c2", asset_class: "commodity" }, { id: "c3", asset_class: "commodity" }],
    },
  });

  assert.equal(portfolios.length, 2);
  for (const portfolio of portfolios) {
    assert.equal(portfolio.holdings.length, 6);
    assert.equal(portfolio.holdings.filter((holding) => holding.asset_class === "equity")
      .reduce((total, holding) => total + holding.allocation_percent, 0), 40);
    assert.equal(portfolio.holdings.filter((holding) => holding.asset_class === "debt")
      .reduce((total, holding) => total + holding.monthly_contribution_inr, 0), 7500);
    assert.equal(portfolio.holdings.filter((holding) => holding.asset_class === "commodity")
      .reduce((total, holding) => total + holding.one_time_investment_inr, 0), 1000);
  }
  assert.notDeepEqual(
    portfolios[0].holdings.map((holding) => holding.id),
    portfolios[1].holdings.map((holding) => holding.id),
  );
});

test("portfolio examples are withheld when an allocated class has no candidates", () => {
  assert.deepEqual(buildPortfolioOptions({
    allocation: { equity: 40, debt: 50, commodity: 10 },
    classAmounts: {},
    byAssetClass: {
      equity: [{ id: "e1", asset_class: "equity" }],
      debt: [],
      commodity: [{ id: "c1", asset_class: "commodity" }],
    },
  }), []);
});
