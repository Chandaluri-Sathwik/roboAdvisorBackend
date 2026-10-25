import mongoose from "mongoose";
import Goal from "../models/Goal.js";
import Portfolio from "../models/Portfolio.js";
import RiskAssessment from "../models/RiskAssessment.js";
import User from "../models/User.js";
import { HttpError } from "../middleware/errors.js";
import { calculateProjections } from "../services/planCalculations.js";
import { generateAssistantReply } from "../services/portfolioAssistantService.js";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_TEXT_LENGTH = 3000;

export async function sendAssistantMessage(req, res) {
  const body = req.body ?? {};
  const userId = body.user_id;
  const message = validateText(body.message, "message", MAX_MESSAGE_LENGTH);

  if (!mongoose.isValidObjectId(userId)) {
    throw new HttpError(400, "user_id is invalid.");
  }

  const history = validateHistory(body.history ?? []);
  const user = await User.findById(userId);
  if (!user) throw new HttpError(404, "User not found.");

  const [risk, goal] = await Promise.all([
    RiskAssessment.findOne({ user: user._id }),
    Goal.findOne({ user: user._id }),
  ]);
  if (!goal || !risk) {
    throw new HttpError(409, "Save a complete plan before asking about it.");
  }
  if (!goal.investment_type || !Number.isFinite(goal.expected_return_percent)) {
    throw new HttpError(409, "Update your saved plan with an investment mode and expected return before asking about it.");
  }

  const portfolio = await Portfolio.findOne({ goal: goal._id });
  const projections = calculateProjections({
    investment_type: goal.investment_type,
    initial_investment: goal.initial_investment,
    monthly_contribution: goal.monthly_contribution,
    years: goal.horizon_years,
    expected_return_percent: goal.expected_return_percent,
  });

  const planContext = {
    risk_tolerance: risk.risk_tolerance,
    risk_profile: risk.risk_profile,
    risk_constraints: risk.constraints,
    goal: {
      type: goal.goal_type,
      horizon_years: goal.horizon_years,
      investment_type: goal.investment_type,
      expected_return_percent: goal.expected_return_percent,
      initial_investment_inr: goal.initial_investment,
      monthly_contribution_inr: goal.monthly_contribution,
    },
    portfolio: portfolio
      ? {
          current_simulated_value_inr: portfolio.current_value,
          target_allocation_percent: portfolio.target_allocation.toObject(),
          current_allocation_percent: portfolio.actual_allocation.toObject(),
          has_simulated_market: portfolio.has_simulated_market,
          recommendation_explanation: portfolio.recommendation_explanation,
          investment_options: assistantInvestmentOptions(portfolio.investment_options),
        }
      : null,
    illustrative_projection: projections,
  };

  if (isRebalanceRequest(message)) {
    if (!portfolio?.has_simulated_market) {
      return res.json({
        reply: "There is no simulated allocation drift to rebalance yet. Use ‘Simulate market movement’ on the Portfolio page first, then ask me to rebalance. This demo never places real trades.",
        action: null,
      });
    }
    return res.json({
      reply: "Your simulated allocation has drifted from its target. I can apply the existing rebalance simulation, which resets the simulated weights to your saved target allocation. It does not buy or sell real instruments. Would you like to confirm?",
      action: { type: "confirm_rebalance" },
    });
  }

  const result = await generateAssistantReply({ message, history, planContext });
  return res.json(result);
}

function isRebalanceRequest(message) {
  const text = message.toLowerCase();
  if (!text.includes("rebalance") || /\b(what|why|how|meaning|mean|explain|does)\b/.test(text)) return false;
  return /\b(now|my|portfolio|apply|confirm|please|go ahead|do it|this|the)\b/.test(text);
}

function assistantInvestmentOptions(options) {
  if (!options) return null;
  return {
    status: options.status,
    investment_type: options.investment_type,
    class_amounts: options.class_amounts,
    candidates_by_class: Object.fromEntries(
      Object.entries(options.by_asset_class ?? {}).map(([assetClass, candidates]) => [
        assetClass,
        candidates.slice(0, 4).map(({
          symbol,
          name,
          instrument_type,
          latest_observation,
          historical_return_1y_percent,
          historical_return_comparison,
          historical_risk_metrics,
        }) => ({
          symbol,
          name,
          instrument_type,
          latest_observation,
          historical_return_1y_percent,
          historical_return_comparison,
          historical_risk_metrics,
        })),
      ]),
    ),
    return_analysis: options.return_analysis,
    government_security_yield_references: options.government_security_yield_references?.slice(0, 5) ?? [],
    limitations: options.limitations,
  };
}

function validateText(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new HttpError(400, `${field} must contain 1 to ${maxLength} characters.`);
  }
  return value.trim();
}

function validateHistory(history) {
  if (!Array.isArray(history) || history.length > MAX_HISTORY_MESSAGES) {
    throw new HttpError(400, `history must be an array with no more than ${MAX_HISTORY_MESSAGES} messages.`);
  }

  return history.map((item, index) => {
    if (!item || !["user", "assistant"].includes(item.role)) {
      throw new HttpError(400, `history[${index}].role must be user or assistant.`);
    }
    return {
      role: item.role,
      text: validateText(item.text, `history[${index}].text`, MAX_HISTORY_TEXT_LENGTH),
    };
  });
}
