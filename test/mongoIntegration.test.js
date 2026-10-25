import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import mongoose from "mongoose";
import { createApp } from "../src/server.js";

const testDatabaseUri = process.env.MONGODB_TEST_URI;

test("MongoDB-backed onboarding, restore, projection, simulation, and rebalance flow", {
  skip: !testDatabaseUri,
}, async () => {
  const target = new URL(testDatabaseUri);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(target.hostname),
    "MONGODB_TEST_URI must point to a local MongoDB server.",
  );
  assert.match(
    databaseName,
    /^roboadvisor_test_[a-z0-9_-]+$/i,
    "MONGODB_TEST_URI must use a dedicated roboadvisor_test_* database.",
  );

  let server;
  try {
    await mongoose.connect(testDatabaseUri, { serverSelectionTimeoutMS: 5000 });
    server = createApp().listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

    const request = async (path, options) => {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...options?.headers },
      });
      const body = await response.json();
      assert.ok(response.ok, `${path} failed (${response.status}): ${body.detail ?? "no detail"}`);
      return body;
    };

    const user = await request("/users", {
      method: "POST",
      body: JSON.stringify({
        email: `phase2-${randomUUID()}@finguide.local`,
        display_name: "Phase 2 Integration",
      }),
    });
    assert.ok(user.id);

    await request(`/users/${user.id}/profile`, {
      method: "PUT",
      body: JSON.stringify({ display_name: "Phase 2 Restored" }),
    });
    const risk = await request(`/users/${user.id}/risk-assessments`, {
      method: "POST",
      body: JSON.stringify({
        risk_tolerance: "high",
        goal_type: "wealth_creation",
        horizon_years: 10,
      }),
    });
    assert.equal(risk.risk_profile, "Aggressive");

    const goal = await request(`/users/${user.id}/goals`, {
      method: "POST",
      body: JSON.stringify({
        name: "Integration goal",
        goal_type: "wealth_creation",
        horizon_years: 5,
        investment_type: "monthly",
        initial_investment: 0,
        monthly_contribution: 10_000,
        expected_return_percent: 8,
      }),
    });
    const portfolio = await request("/portfolios/recommend", {
      method: "POST",
      body: JSON.stringify({ goal_id: goal.id }),
    });
    assert.equal(portfolio.recommendation_version, "verified-instrument-risk-capped-v1");
    assert.deepEqual(Object.keys(portfolio.target_allocation).sort(), ["commodity", "debt", "equity"]);
    assert.deepEqual(Object.keys(portfolio.investment_options.class_amounts).sort(), ["commodity", "debt", "equity"]);
    assert.equal(portfolio.investment_options.status, "incomplete_verified_instrument_coverage");
    assert.deepEqual(
      Object.values(portfolio.investment_options.class_amounts).reduce(
        (totals, item) => ({
          initial: totals.initial + item.one_time_investment_inr,
          monthly: totals.monthly + item.monthly_contribution_inr,
        }),
        { initial: 0, monthly: 0 },
      ),
      { initial: 0, monthly: 10_000 },
    );

    const restored = await request(`/users/${user.id}/plan`);
    assert.equal(restored.user.display_name, "Phase 2 Restored");
    assert.equal(restored.goal.id, goal.id);
    assert.equal(restored.risk_assessment.risk_profile, "Growth");
    assert.equal(restored.portfolio.id, portfolio.id);
    assert.deepEqual(restored.portfolio.investment_options, portfolio.investment_options);

    const projections = await request("/projections", {
      method: "POST",
      body: JSON.stringify({
        investment_type: "monthly",
        initial_investment: 0,
        monthly_contribution: 10_000,
        years: 5,
        expected_return_percent: 8,
      }),
    });
    assert.equal(projections.expected_return_percent, 8);
    assert.ok(projections.future_value > projections.total_contributions);

    const simulated = await request(`/portfolios/${portfolio.id}/simulate-market`, {
      method: "POST",
      body: JSON.stringify({ changes: { equity: 0.1, debt: -0.02, commodity: 0.03 } }),
    });
    assert.equal(simulated.has_simulated_market, true);

    const rebalanced = await request(`/portfolios/${portfolio.id}/rebalance/apply`, {
      method: "POST",
    });
    assert.equal(rebalanced.has_simulated_market, false);
    assert.deepEqual(rebalanced.actual_allocation, rebalanced.target_allocation);
  } finally {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
  }
});
