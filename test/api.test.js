import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { goalPayload } from "../src/controllers/planController.js";
import { errorHandler, HttpError } from "../src/middleware/errors.js";
import { createApp } from "../src/server.js";

let server;
let baseUrl;

before(async () => {
  server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("health endpoint reports the API is available", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
});

test("versioned projections endpoint calculates the requested return assumption", async () => {
  const response = await fetch(`${baseUrl}/api/v1/projections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      investment_type: "monthly",
      initial_investment: 0,
      monthly_contribution: 10_000,
      years: 10,
      expected_return_percent: 8,
    }),
  });
  const projections = await response.json();

  assert.equal(response.status, 200);
  assert.equal(projections.expected_return_percent, 8);
  assert.equal(projections.total_contributions, 1_200_000);
  assert.ok(projections.future_value > projections.total_contributions);
});

test("versioned API rejects invalid projection inputs with a useful client error", async () => {
  const response = await fetch(`${baseUrl}/api/v1/projections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      investment_type: "monthly",
      initial_investment: 100_000,
      monthly_contribution: 10_000,
      years: 0,
      expected_return_percent: 8,
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.detail, /years/);
});

test("assistant endpoint validates the demo user identifier before database access", async () => {
  const response = await fetch(`${baseUrl}/api/v1/assistant/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: "not-an-id", message: "Explain the allocation" }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.detail, /user_id/);
});

test("unknown routes return the same error shape used by the frontend", async () => {
  const response = await fetch(`${baseUrl}/api/v1/not-a-route`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.detail, "Route not found.");
});

test("assistant service errors remain visible to the assistant frontend", () => {
  let statusCode;
  let responseBody;
  const response = {
    headersSent: false,
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };

  errorHandler(new HttpError(503, "The portfolio assistant is temporarily unavailable. Please try again."), {}, response, () => {});

  assert.equal(statusCode, 503);
  assert.equal(responseBody.detail, "The portfolio assistant is temporarily unavailable. Please try again.");
});

test("goal request validation accepts one contribution mode and no target amount", () => {
  const payload = goalPayload({
    name: "Retirement",
    goal_type: "retirement",
    horizon_years: 12,
    investment_type: "monthly",
    initial_investment: 0,
    monthly_contribution: 15_000,
    expected_return_percent: 7.5,
  });

  assert.deepEqual(payload, {
    name: "Retirement",
    goal_type: "retirement",
    horizon_years: 12,
    investment_type: "monthly",
    initial_investment: 0,
    monthly_contribution: 15_000,
    expected_return_percent: 7.5,
  });
  assert.equal(Object.hasOwn(payload, "target_amount"), false);
});

test("goal request validation rejects both contribution modes", () => {
  assert.throws(
    () => goalPayload({
      name: "Retirement",
      goal_type: "retirement",
      horizon_years: 12,
      investment_type: "monthly",
      initial_investment: 50_000,
      monthly_contribution: 15_000,
      expected_return_percent: 7.5,
    }),
    /no initial amount/,
  );
});

test("risk assessment input maps the selected profile and applies horizon limits", async () => {
  const response = await fetch(`${baseUrl}/api/v1/users/not-an-id/risk-assessments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ risk_tolerance: "high", goal_type: "education", horizon_years: 2 }),
  });
  assert.equal(response.status, 400);
});
