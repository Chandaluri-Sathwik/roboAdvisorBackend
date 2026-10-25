import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMarketReturns,
  calculateAssetAllocation,
  calculateProjections,
  calculateRiskProfile,
  TARGET_ALLOCATIONS,
  validateAllocation,
} from "../src/services/planCalculations.js";

test("low, moderate, and high risk tolerance map to the three configured profiles", () => {
  const assessment = (risk_tolerance) => calculateRiskProfile({
    risk_tolerance,
    goal_type: "wealth_creation",
    horizon_years: 10,
  });
  assert.equal(assessment("low").risk_profile, "Conservative");
  assert.equal(assessment("moderate").risk_profile, "Moderate");
  assert.equal(assessment("high").risk_profile, "Aggressive");
});

test("short horizons constrain both the profile and volatile exposure", () => {
  const risk = calculateRiskProfile({
    risk_tolerance: "high",
    goal_type: "retirement",
    horizon_years: 2,
  });
  const allocation = calculateAssetAllocation(risk);
  assert.equal(risk.risk_profile, "Conservative");
  assert.equal(risk.constraints.max_volatile_exposure_percent, 25);
  assert.ok(allocation.volatileExposurePct <= 25);
  assert.equal(validateAllocation(allocation.assetAllocation), true);
});

test("short home and education plans receive an additional exposure cap", () => {
  const risk = calculateRiskProfile({
    risk_tolerance: "high",
    goal_type: "education",
    horizon_years: 5,
  });
  assert.equal(risk.risk_profile, "Moderate");
  assert.equal(risk.constraints.max_volatile_exposure_percent, 40);
  assert.ok(risk.reasons.some((reason) => reason.includes("education")));
});

test("configured allocations use only the three portfolio classes", () => {
  for (const allocation of Object.values(TARGET_ALLOCATIONS)) {
    assert.equal(validateAllocation(allocation), true);
    assert.deepEqual(Object.keys(allocation).sort(), ["commodity", "debt", "equity"]);
  }
  assert.equal(validateAllocation({ equity: 20, debt: 60, gold: 10, cash: 10 }), false);
});

test("one-time and monthly projections use the entered annual return assumption", () => {
  const monthly = calculateProjections({
    investment_type: "monthly",
    initial_investment: 0,
    monthly_contribution: 10_000,
    years: 10,
    expected_return_percent: 9,
  });
  const oneTime = calculateProjections({
    investment_type: "one_time",
    initial_investment: 100_000,
    monthly_contribution: 0,
    years: 10,
    expected_return_percent: 9,
  });
  assert.equal(monthly.expected_return_percent, 9);
  assert.equal(monthly.total_contributions, 1_200_000);
  assert.ok(monthly.future_value > monthly.total_contributions);
  assert.ok(oneTime.future_value > oneTime.total_contributions);
  assert.equal(monthly.contribution_timing, "end_of_month");
});

test("projection rejects combined contribution modes and supports a zero-return assumption", () => {
  assert.throws(() => calculateProjections({
    investment_type: "monthly",
    initial_investment: 100,
    monthly_contribution: 10,
    years: 1,
    expected_return_percent: 4,
  }), /no initial investment/);
  const result = calculateProjections({
    investment_type: "one_time",
    initial_investment: 100,
    monthly_contribution: 0,
    years: 1,
    expected_return_percent: 0,
  });
  assert.equal(result.future_value, 100);
  assert.equal(result.estimated_growth, 0);
});

test("market returns update portfolio value and keep allocation at 100 percent", () => {
  const result = applyMarketReturns({
    allocation: TARGET_ALLOCATIONS.Moderate,
    current_value: 100_000,
    changes: { equity: 0.22, debt: -0.03, commodity: 0.04 },
  });
  assert.ok(result.current_value > 100_000);
  assert.equal(validateAllocation(result.actual_allocation), true);
  assert.ok(result.actual_allocation.equity > TARGET_ALLOCATIONS.Moderate.equity);
});

test("zero-value portfolio simulation preserves its allocation", () => {
  const result = applyMarketReturns({
    allocation: TARGET_ALLOCATIONS.Conservative,
    current_value: 0,
    changes: { equity: 0.2 },
  });
  assert.equal(result.current_value, 0);
  assert.deepEqual(result.actual_allocation, TARGET_ALLOCATIONS.Conservative);
});
