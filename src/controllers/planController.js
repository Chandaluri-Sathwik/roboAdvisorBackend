import mongoose from "mongoose";
import Goal from "../models/Goal.js";
import Portfolio from "../models/Portfolio.js";
import RiskAssessment from "../models/RiskAssessment.js";
import User from "../models/User.js";
import {
  applyMarketReturns,
  calculateAssetAllocation,
  calculateProjections,
  calculateRiskProfile,
  ASSET_CLASSES,
  RISK_PROFILES,
  validateAllocation,
} from "../services/planCalculations.js";
import { HttpError } from "../middleware/errors.js";
import { selectPortfolioAssets } from "../services/portfolioSelectionService.js";

const GOAL_TYPES = ["wealth_creation", "home", "education", "retirement", "other"];

export async function createUser(req, res) {
  const body = req.body ?? {};
  const display_name = requiredString(body.display_name, "display_name", 100);
  const email =
    typeof body.email === "string" && body.email.trim()
      ? body.email.trim().toLowerCase()
      : `demo-${new mongoose.Types.ObjectId()}@finguide.local`;

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "email must be a valid email address.");
  }

  const user = await User.findOneAndUpdate(
    { email },
    { $set: { display_name }, $setOnInsert: { email } },
    { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
  return res.status(201).json(userResponse(user));
}

export async function getUser(req, res) {
  const user = await findUser(req.params.userId);
  return res.json(userResponse(user));
}

export async function updateUserProfile(req, res) {
  const user = await findUser(req.params.userId);
  const body = req.body ?? {};
  const update = {};

  if (body.display_name !== undefined) {
    update.display_name = requiredString(body.display_name, "display_name", 100);
  }

  if (body.email !== undefined) {
    if (typeof body.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
      throw new HttpError(400, "email must be a valid email address.");
    }
    update.email = body.email.trim().toLowerCase();
  }

  Object.assign(user, update);
  await user.save();
  return res.json(userResponse(user));
}

export async function getUserPlan(req, res) {
  const user = await findUser(req.params.userId);
  const [risk, goal] = await Promise.all([
    RiskAssessment.findOne({ user: user._id }),
    Goal.findOne({ user: user._id }).sort({ updatedAt: -1 }),
  ]);
  const portfolio = goal ? await Portfolio.findOne({ goal: goal._id }) : null;

  return res.json({
    user: userResponse(user),
    risk_assessment: risk ? riskResponse(risk) : null,
    goal: goal ? goalResponse(goal) : null,
    portfolio: portfolio ? portfolioResponse(portfolio) : null,
  });
}

export async function saveRiskAssessment(req, res) {
  const user = await findUser(req.params.userId);
  const body = req.body ?? {};
  let risk;
  try {
    risk = calculateRiskProfile({
      risk_tolerance: body.risk_tolerance,
      goal_type: body.goal_type,
      horizon_years: numberInRange(body.horizon_years, "horizon_years", 1, 100),
    });
  } catch (error) {
    throw new HttpError(400, error.message);
  }
  const assessment = await RiskAssessment.findOneAndUpdate(
    { user: user._id },
    {
      ...risk,
    },
    { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );

  return res.json(riskResponse(assessment));
}

export async function createGoal(req, res) {
  const user = await findUser(req.params.userId);
  const goal = await Goal.findOneAndUpdate(
    { user: user._id },
    goalPayload(req.body ?? {}),
    { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
  return res.status(201).json({ id: String(goal._id) });
}

export async function updateGoal(req, res) {
  const goal = await findGoal(req.params.goalId);
  Object.assign(goal, goalPayload(req.body ?? {}));
  await goal.save();

  const portfolio = await Portfolio.findOne({ goal: goal._id });
  if (portfolio) {
    portfolio.current_value = goal.investment_type === "one_time" ? goal.initial_investment : 0;
    await portfolio.save();
  }

  return res.json({ id: String(goal._id) });
}

export async function recommendPortfolio(req, res) {
  const goal = await findGoal(req.body?.goal_id);
  const assessment = await RiskAssessment.findOne({ user: goal.user });
  if (!assessment) {
    throw new HttpError(409, "Save a risk assessment before requesting a recommendation.");
  }

  const legacyRiskTolerance = assessment.risk_profile === "Conservative"
    ? "low"
    : assessment.risk_profile === "Aggressive" || assessment.risk_profile === "Growth"
      ? "high"
      : "moderate";
  const normalizedAssessment = calculateRiskProfile({
    risk_tolerance: assessment.risk_tolerance ?? legacyRiskTolerance,
    goal_type: goal.goal_type,
    horizon_years: goal.horizon_years,
  });
  Object.assign(assessment, normalizedAssessment);
  await assessment.save();

  if (!RISK_PROFILES.includes(assessment.risk_profile)) {
    throw new HttpError(500, "The configured portfolio allocation is invalid.");
  }
  const allocationResult = calculateAssetAllocation(assessment);
  const baselineAllocation = allocationResult.assetAllocation;
  let target_allocation = baselineAllocation;
  if (!validateAllocation(target_allocation)) {
    throw new HttpError(500, "The risk-capped allocation is invalid.");
  }
  const investment_options = await selectPortfolioAssets({
    allocation: baselineAllocation,
    maxVolatileExposurePercent: allocationResult.maxVolatileExposurePct,
    investmentType: goal.investment_type,
    initialInvestment: goal.initial_investment,
    monthlyContribution: goal.monthly_contribution,
    expectedReturnPercent: goal.expected_return_percent,
  });
  target_allocation = investment_options.allocation;
  if (!validateAllocation(target_allocation)
    || target_allocation.equity + target_allocation.commodity
      > allocationResult.maxVolatileExposurePct + 0.01) {
    throw new HttpError(500, "The return-oriented allocation violates the configured risk cap.");
  }
  const recommendedAllocationResult = {
    ...allocationResult,
    assetAllocation: target_allocation,
    volatileExposurePct: target_allocation.equity + target_allocation.commodity,
  };
  const projection = calculateProjections({
    investment_type: goal.investment_type,
    initial_investment: goal.initial_investment,
    monthly_contribution: goal.monthly_contribution,
    years: goal.horizon_years,
    expected_return_percent: goal.expected_return_percent,
  });

  const portfolio = await Portfolio.findOneAndUpdate(
    { goal: goal._id },
    {
      user: goal.user,
      risk_profile: assessment.risk_profile,
      unconstrained_risk_profile: assessment.unconstrained_risk_profile,
      target_allocation,
      actual_allocation: target_allocation,
      current_value: goal.investment_type === "one_time" ? goal.initial_investment : 0,
      has_simulated_market: false,
      recommendation_version: "historical-return-risk-capped-v2",
      recommendation_explanation: recommendationExplanation(
        assessment,
        recommendedAllocationResult,
        investment_options.return_analysis,
      ),
      market_data_context: {
        method: "curated_instrument_catalog_and_provider_history",
        status: "reference_data_only",
        generated_at: investment_options.generated_at,
      },
      investment_examples: null,
      investment_options,
      projection,
    },
    { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );

  return res.json(portfolioResponse(portfolio));
}

export async function getProjections(req, res) {
  const body = req.body ?? {};
  const input = {
    investment_type: body.investment_type,
    initial_investment: numberInRange(body.initial_investment, "initial_investment", 0, 1_000_000_000_000),
    monthly_contribution: numberInRange(body.monthly_contribution, "monthly_contribution", 0, 1_000_000_000_000),
    years: numberInRange(body.years, "years", 1, 100),
    expected_return_percent: numberInRange(body.expected_return_percent, "expected_return_percent", 0, 100),
  };

  if (!Number.isInteger(input.years)) {
    throw new HttpError(400, "years must be a whole number.");
  }

  try {
    return res.json(calculateProjections(input));
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}

export async function simulateMarket(req, res) {
  const portfolio = await findPortfolio(req.params.portfolioId);
  if (portfolio.has_simulated_market) {
    return res.json(portfolioResponse(portfolio));
  }

  const changes = req.body?.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new HttpError(400, "changes must contain hypothetical returns by asset class.");
  }
  if (Object.keys(changes).some((assetClass) => !ASSET_CLASSES.includes(assetClass))) {
    throw new HttpError(400, `changes may only include: ${ASSET_CLASSES.join(", ")}.`);
  }

  for (const assetClass of ASSET_CLASSES) {
    const returnRate = changes[assetClass] ?? 0;
    numberInRange(returnRate, `changes.${assetClass}`, -1, 1);
  }

  const result = applyMarketReturns({
    allocation: portfolio.actual_allocation.toObject(),
    current_value: portfolio.current_value,
    changes,
  });
  portfolio.current_value = result.current_value;
  portfolio.actual_allocation = result.actual_allocation;
  portfolio.has_simulated_market = true;
  await portfolio.save();

  return res.json(portfolioResponse(portfolio));
}

export async function applyRebalance(req, res) {
  const portfolio = await findPortfolio(req.params.portfolioId);
  if (!portfolio.has_simulated_market) {
    return res.json(portfolioResponse(portfolio));
  }

  portfolio.actual_allocation = portfolio.target_allocation.toObject();
  portfolio.has_simulated_market = false;
  await portfolio.save();
  return res.json(portfolioResponse(portfolio));
}

export function goalPayload(body) {
  if (!GOAL_TYPES.includes(body.goal_type)) {
    throw new HttpError(400, `goal_type must be one of: ${GOAL_TYPES.join(", ")}.`);
  }

  const investment_type = body.investment_type;
  if (!["one_time", "monthly"].includes(investment_type)) {
    throw new HttpError(400, "investment_type must be one_time or monthly.");
  }
  const initial_investment = numberInRange(body.initial_investment, "initial_investment", 0, 1_000_000_000_000);
  const monthly_contribution = numberInRange(body.monthly_contribution, "monthly_contribution", 0, 1_000_000_000_000);
  if (investment_type === "one_time" && (initial_investment <= 0 || monthly_contribution !== 0)) {
    throw new HttpError(400, "One-time investment requires a positive initial amount and no monthly contribution.");
  }
  if (investment_type === "monthly" && (monthly_contribution <= 0 || initial_investment !== 0)) {
    throw new HttpError(400, "Monthly investment requires a positive monthly contribution and no initial amount.");
  }

  const payload = {
    name: requiredString(body.name, "name", 120),
    goal_type: body.goal_type,
    horizon_years: numberInRange(body.horizon_years, "horizon_years", 1, 100),
    investment_type,
    initial_investment,
    monthly_contribution,
    expected_return_percent: numberInRange(body.expected_return_percent, "expected_return_percent", 0, 100),
  };
  if (!Number.isInteger(payload.horizon_years)) {
    throw new HttpError(400, "horizon_years must be a whole number.");
  }
  return payload;
}

function requiredString(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new HttpError(400, `${field} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value.trim();
}

function numberInRange(value, field, minimum, maximum) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new HttpError(400, `${field} must be a number between ${minimum} and ${maximum}.`);
  }
  return value;
}

async function findUser(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw new HttpError(400, "userId is invalid.");
  }
  const user = await User.findById(id);
  if (!user) throw new HttpError(404, "User not found.");
  return user;
}

async function findGoal(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw new HttpError(400, "goalId is invalid.");
  }
  const goal = await Goal.findById(id);
  if (!goal) throw new HttpError(404, "Goal not found.");
  return goal;
}

async function findPortfolio(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw new HttpError(400, "portfolioId is invalid.");
  }
  const portfolio = await Portfolio.findById(id);
  if (!portfolio) throw new HttpError(404, "Portfolio not found.");
  return portfolio;
}

function userResponse(user) {
  return { id: String(user._id), email: user.email, display_name: user.display_name };
}

function goalResponse(goal) {
  return {
    id: String(goal._id),
    name: goal.name,
    goal_type: goal.goal_type,
    horizon_years: goal.horizon_years,
    investment_type: goal.investment_type,
    initial_investment: goal.initial_investment,
    monthly_contribution: goal.monthly_contribution,
    expected_return_percent: goal.expected_return_percent,
  };
}

function riskResponse(assessment) {
  const storedProfile = assessment.risk_profile;
  const riskProfile = storedProfile === "Growth" ? "Aggressive" : storedProfile;
  return {
    risk_tolerance: assessment.risk_tolerance ?? (storedProfile === "Conservative" ? "low" : storedProfile === "Aggressive" || storedProfile === "Growth" ? "high" : "moderate"),
    risk_profile: riskProfile,
    unconstrained_risk_profile: assessment.unconstrained_risk_profile === "Growth"
      ? "Aggressive"
      : assessment.unconstrained_risk_profile ?? riskProfile,
    goal_type: assessment.goal_type,
    horizon_years: assessment.horizon_years,
    constraints: assessment.constraints ?? null,
    reasons: assessment.reasons ?? [],
    warnings: assessment.warnings ?? [],
  };
}

function portfolioResponse(portfolio) {
  const targetAllocation = portfolio.target_allocation.toObject();
  const actualAllocation = portfolio.actual_allocation.toObject();

  return {
    id: String(portfolio._id),
    current_value: portfolio.current_value,
    target_allocation: targetAllocation,
    actual_allocation: actualAllocation,
    risk_profile: portfolio.risk_profile === "Growth" ? "Aggressive" : portfolio.risk_profile,
    has_simulated_market: portfolio.has_simulated_market,
    recommendation_version: portfolio.recommendation_version,
    recommendation_explanation: portfolio.recommendation_explanation,
    market_data_context: portfolio.market_data_context ?? null,
    investment_examples: portfolio.investment_examples ?? null,
    investment_options: portfolio.investment_options ?? null,
    projection: portfolio.projection ?? null,
  };
}

function recommendationExplanation(assessment, allocationResult, returnAnalysis) {
  const optimization = returnAnalysis.allocation_optimization;
  const returnMessage = optimization.status === "historical_target_met_within_risk_cap"
    ? `Adjusted toward your ${returnAnalysis.expected_annual_return_percent}% assumption; historical proxy: ${optimization.estimated_return_percent}%.`
    : optimization.status === "historical_target_not_met_within_risk_cap"
      ? `Closest historical proxy: ${optimization.estimated_return_percent}% against your ${returnAnalysis.expected_annual_return_percent}% assumption.`
      : "Insufficient historical data; baseline mix retained.";
  return `${assessment.risk_profile} profile; Equity + Commodity capped at ` +
    `${allocationResult.maxVolatileExposurePct}%. ${returnMessage} Historical data only—not a forecast or guarantee.`;
}
