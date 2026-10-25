import assert from "node:assert/strict";
import { test } from "node:test";
import { generateAssistantReply } from "../src/services/portfolioAssistantService.js";

const planContext = {
  risk_tolerance: "moderate",
  risk_profile: "Moderate",
  risk_constraints: { max_volatile_exposure_percent: 60 },
  goal: { type: "retirement", horizon_years: 12, investment_type: "monthly", monthly_contribution_inr: 10_000 },
  portfolio: {
    target_allocation_percent: { equity: 40, debt: 50, commodity: 10 },
    current_allocation_percent: { equity: 43, debt: 47, commodity: 10 },
    has_simulated_market: true,
    investment_options: { candidates_by_class: { equity: [{ name: "Example Equity Fund" }] } },
  },
  illustrative_projection: {
    years: 12,
    expected_return_percent: 8,
    total_contributions: 1_440_000,
    future_value: 2_300_000,
    estimated_growth: 860_000,
    disclaimer: "Illustrative only.",
  },
};

test("portfolio assistant explains saved allocation without an external provider", async () => {
  const result = await generateAssistantReply({ message: "Explain my risk-based allocation", history: [], planContext });

  assert.match(result.reply, /Moderate/);
  assert.match(result.reply, /Equity 40%/);
  assert.match(result.reply, /Equity 43%/);
  assert.match(result.reply, /60%/);
  assert.equal(Object.hasOwn(result, "model"), false);
});

test("portfolio assistant explains saved projections and candidates", async () => {
  const projection = await generateAssistantReply({ message: "Explain my projection", history: [], planContext });
  const candidates = await generateAssistantReply({ message: "Explain investment options", history: [], planContext });

  assert.match(projection.reply, /8% annual return assumption/);
  assert.match(projection.reply, /₹14,40,000/);
  assert.match(candidates.reply, /Example Equity Fund/);
  assert.match(candidates.reply, /not buy or sell recommendations/);
});
