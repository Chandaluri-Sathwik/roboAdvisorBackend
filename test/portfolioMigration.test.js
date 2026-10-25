import assert from "node:assert/strict";
import test from "node:test";
import { migrateLegacyPortfolioDocument } from "../src/services/portfolioMigrationService.js";

test("legacy portfolio allocations and example splits migrate to equity, debt, and commodity", () => {
  const oldContext = {
    status: "applied",
    class_returns: {
      equity: { annualized_observed_change_percent: 4, usable_proxy_count: 1, scheme_codes: ["1"] },
      debt: { annualized_observed_change_percent: 5, usable_proxy_count: 1, scheme_codes: ["2"] },
      gold: { annualized_observed_change_percent: 6, usable_proxy_count: 1, scheme_codes: ["3"] },
      cash: { annualized_observed_change_percent: 3, usable_proxy_count: 1, scheme_codes: ["4"] },
    },
    applied_shift: { from_asset_class: "cash", to_asset_class: "gold", percentage_points: 5 },
  };
  const portfolio = {
    target_allocation: { equity: 20, debt: 60, gold: 10, cash: 10 },
    actual_allocation: { equity: 19, debt: 61, gold: 9, cash: 11 },
    market_data_context: oldContext,
    investment_examples: {
      class_amounts: {
        equity: { allocation_percent: 20, initial_investment_inr: 200, monthly_contribution_inr: 20 },
        debt: { allocation_percent: 60, initial_investment_inr: 600, monthly_contribution_inr: 60 },
        gold: { allocation_percent: 10, initial_investment_inr: 100, monthly_contribution_inr: 10 },
        cash: { allocation_percent: 10, initial_investment_inr: 100, monthly_contribution_inr: 10 },
      },
      examples_by_class: {
        equity: [{ scheme_code: "1" }],
        debt: [{ scheme_code: "2" }],
        gold: [{ scheme_code: "3" }],
        cash: [{ scheme_code: "4" }],
      },
    },
  };

  const migrated = migrateLegacyPortfolioDocument(portfolio);

  assert.deepEqual(migrated.target_allocation, { equity: 20, debt: 70, commodity: 10 });
  assert.deepEqual(migrated.actual_allocation, { equity: 19, debt: 72, commodity: 9 });
  assert.deepEqual(migrated.investment_examples.class_amounts, {
    equity: { allocation_percent: 20, initial_investment_inr: 200, monthly_contribution_inr: 20 },
    debt: { allocation_percent: 70, initial_investment_inr: 700, monthly_contribution_inr: 70 },
    commodity: { allocation_percent: 10, initial_investment_inr: 100, monthly_contribution_inr: 10 },
  });
  assert.deepEqual(migrated.investment_examples.examples_by_class.debt, [
    { scheme_code: "2" },
    { scheme_code: "4" },
  ]);
  assert.equal(migrated.market_data_context.status, "baseline_used");
  assert.deepEqual(migrated.market_data_context.unavailable_classes, ["debt"]);
  assert.deepEqual(migrated.market_data_context.legacy_four_class_context, oldContext);
  assert.equal(migrated.recommendation_version, "three-class-v2-migrated");
});

test("three-class portfolios are not migrated twice", () => {
  assert.equal(migrateLegacyPortfolioDocument({
    target_allocation: { equity: 50, debt: 40, commodity: 10 },
    actual_allocation: { equity: 50, debt: 40, commodity: 10 },
    investment_examples: {
      class_amounts: { equity: {}, debt: {}, commodity: {} },
      examples_by_class: { equity: [], debt: [], commodity: [] },
    },
  }), null);
});
