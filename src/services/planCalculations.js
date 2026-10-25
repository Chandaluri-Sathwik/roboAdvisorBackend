export const RISK_PROFILES = ["Conservative", "Moderate", "Aggressive"];

export const TARGET_ALLOCATIONS = {
  Conservative: { equity: 20, debt: 70, commodity: 10 },
  Moderate: { equity: 40, debt: 50, commodity: 10 },
  Aggressive: { equity: 70, debt: 20, commodity: 10 },
};

export const ASSET_CLASSES = ["equity", "debt", "commodity"];

export function calculateRiskProfile({
  risk_tolerance,
  goal_type,
  horizon_years,
}) {
  const riskProfiles = { low: "Conservative", moderate: "Moderate", high: "Aggressive" };
  const unconstrainedRiskProfile = riskProfiles[risk_tolerance];
  if (!unconstrainedRiskProfile) throw new Error("risk_tolerance must be low, moderate, or high.");
  if (!Number.isInteger(horizon_years) || horizon_years < 1 || horizon_years > 100) {
    throw new Error("horizon_years must be a whole number between 1 and 100.");
  }
  if (!["wealth_creation", "home", "education", "retirement", "other"].includes(goal_type)) {
    throw new Error("goal_type is not supported.");
  }

  let riskProfile = unconstrainedRiskProfile;
  let maxVolatileExposurePct;
  const reasons = [`Risk tolerance is ${risk_tolerance}.`];
  const warnings = [];

  if (horizon_years <= 3) {
    riskProfile = "Conservative";
    maxVolatileExposurePct = 25;
    reasons.push("A horizon of three years or less caps volatile exposure at 25%.");
  } else if (horizon_years <= 5) {
    maxVolatileExposurePct = 50;
    if (risk_tolerance === "high") riskProfile = "Moderate";
    reasons.push("A horizon of five years or less caps volatile exposure at 50%.");
  } else {
    maxVolatileExposurePct = {
      low: 35,
      moderate: 60,
      high: 80,
    }[risk_tolerance];
    reasons.push("The longer horizon permits, but does not require, more volatile exposure.");
  }

  if (["home", "education"].includes(goal_type) && horizon_years <= 5) {
    maxVolatileExposurePct = Math.min(maxVolatileExposurePct, 40);
    reasons.push(`${goal_type} goals with a five-year-or-shorter horizon have a 40% volatile-exposure cap.`);
  }
  if (riskProfile !== unconstrainedRiskProfile) {
    warnings.push(`The ${risk_tolerance} risk preference was constrained by the selected goal horizon.`);
  }

  return {
    risk_tolerance,
    risk_profile: riskProfile,
    unconstrained_risk_profile: unconstrainedRiskProfile,
    horizon_years,
    goal_type,
    constraints: { max_volatile_exposure_percent: maxVolatileExposurePct },
    reasons,
    warnings,
  };
}

export function calculateProjections({
  investment_type,
  initial_investment,
  monthly_contribution,
  years,
  expected_return_percent,
}) {
  if (!["one_time", "monthly"].includes(investment_type)) {
    throw new Error("investment_type must be one_time or monthly.");
  }
  if (!Number.isInteger(years) || years < 1 || years > 100) {
    throw new Error("years must be a whole number between 1 and 100.");
  }
  for (const [field, value] of [
    ["initial_investment", initial_investment],
    ["monthly_contribution", monthly_contribution],
  ]) {
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000_000) {
      throw new Error(`${field} must be between 0 and 1000000000000.`);
    }
  }
  if (!Number.isFinite(expected_return_percent) || expected_return_percent < 0 || expected_return_percent > 100) {
    throw new Error("expected_return_percent must be between 0 and 100.");
  }
  if (investment_type === "one_time" && (initial_investment <= 0 || monthly_contribution !== 0)) {
    throw new Error("A one-time plan requires an initial investment and no monthly contribution.");
  }
  if (investment_type === "monthly" && (monthly_contribution <= 0 || initial_investment !== 0)) {
    throw new Error("A monthly plan requires a monthly contribution and no initial investment.");
  }

  const months = years * 12;
  const monthlyRate = Math.pow(1 + expected_return_percent / 100, 1 / 12) - 1;
  const growthFactor = Math.pow(1 + monthlyRate, months);
  const initialFutureValue = initial_investment * growthFactor;
  const contributionsFutureValue = monthlyRate === 0
    ? monthly_contribution * months
    : monthly_contribution * ((growthFactor - 1) / monthlyRate);
  const totalContributions = initial_investment + monthly_contribution * months;

  return {
    investment_type,
    years,
    expected_return_percent,
    contribution_timing: "end_of_month",
    future_value: roundCurrency(initialFutureValue + contributionsFutureValue),
    total_contributions: roundCurrency(totalContributions),
    estimated_growth: roundCurrency(initialFutureValue + contributionsFutureValue - totalContributions),
    disclaimer: "Illustrative projection using the entered return assumption; not a forecast or guarantee.",
  };
}

export function calculateAssetAllocation(riskAssessment) {
  const baseline = TARGET_ALLOCATIONS[riskAssessment?.risk_profile];
  const maxVolatile = riskAssessment?.constraints?.max_volatile_exposure_percent;
  if (!baseline || !Number.isFinite(maxVolatile) || maxVolatile < 0 || maxVolatile > 100) {
    throw new Error("A valid risk assessment and volatile-exposure cap are required.");
  }

  const currentVolatile = baseline.equity + baseline.commodity;
  const scale = currentVolatile > maxVolatile ? maxVolatile / currentVolatile : 1;
  const equity = roundPercent(baseline.equity * scale);
  const commodity = roundPercent(baseline.commodity * scale);
  const debt = roundPercent(100 - equity - commodity);
  return {
    assetAllocation: { equity, debt, commodity },
    totalAllocation: 100,
    volatileExposurePct: roundPercent(equity + commodity),
    maxVolatileExposurePct: maxVolatile,
    assumptions: [
      "Low, moderate, and high risk tolerance map to Conservative, Moderate, and Aggressive profiles.",
      "Goal type and horizon constrain equity plus commodity exposure.",
      "Expected return is a projection assumption and does not increase the risk-based allocation.",
    ],
  };
}

export function applyMarketReturns({ allocation, current_value, changes }) {
  const holdings = Object.fromEntries(
    ASSET_CLASSES.map((assetClass) => {
      const returnRate = changes[assetClass] ?? 0;
      return [assetClass, (current_value * allocation[assetClass]) / 100 * (1 + returnRate)];
    })
  );
  const nextValue = Object.values(holdings).reduce((total, value) => total + value, 0);

  if (nextValue === 0) {
    return { current_value: 0, actual_allocation: { ...allocation } };
  }

  const roundedAllocation = Object.fromEntries(
    ASSET_CLASSES.map((assetClass) => [
      assetClass,
      roundPercent((holdings[assetClass] / nextValue) * 100),
    ])
  );
  const roundingDifference = roundPercent(
    100 - Object.values(roundedAllocation).reduce((total, value) => total + value, 0)
  );
  const largestAsset = ASSET_CLASSES.reduce((largest, current) =>
    roundedAllocation[current] > roundedAllocation[largest] ? current : largest
  );
  roundedAllocation[largestAsset] = roundPercent(
    roundedAllocation[largestAsset] + roundingDifference
  );

  return {
    current_value: roundCurrency(nextValue),
    actual_allocation: roundedAllocation,
  };
}

export function validateAllocation(allocation) {
  return (
    allocation &&
    ASSET_CLASSES.every(
      (assetClass) =>
        Number.isFinite(allocation[assetClass]) &&
        allocation[assetClass] >= 0 &&
        allocation[assetClass] <= 100
    ) &&
    Math.abs(ASSET_CLASSES.reduce((sum, assetClass) => sum + allocation[assetClass], 0) - 100) <
      0.001
  );
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundPercent(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
