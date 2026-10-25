const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/**
 * A local, deterministic assistant for explaining the plan already saved in
 * the app. It does not call an AI provider, browse the web, or fetch markets.
 */
export async function generateAssistantReply({ message, planContext }) {
  const question = message.toLowerCase();
  const portfolio = planContext.portfolio;

  if (matches(question, ["candidate", "option", "instrument", "fund"])) {
    return { reply: explainCandidates(portfolio) };
  }
  if (matches(question, ["contribution", "monthly", "one-time", "one time", "split"])) {
    return { reply: explainContributions(planContext, portfolio) };
  }
  if (matches(question, ["projection", "return", "future value", "growth"])) {
    return { reply: explainProjection(planContext.illustrative_projection) };
  }
  if (matches(question, ["rebalance", "drift"])) {
    return { reply: explainRebalancing(portfolio) };
  }
  if (matches(question, ["risk", "allocation", "portfolio", "mix", "weight"])) {
    return { reply: explainAllocation(planContext, portfolio) };
  }

  return {
    reply: [
      "I can explain the portfolio details saved in this app.",
      `Your risk profile is ${safeText(planContext.risk_profile, "not available")} and your goal horizon is ${safeText(planContext.goal?.horizon_years, "not available")} years.`,
      portfolio ? `Target allocation: ${formatAllocation(portfolio.target_allocation_percent)}.` : "A saved portfolio allocation is not available.",
      "Ask about your allocation, risk profile, contribution split, portfolio candidates, projection, or rebalance simulation.",
    ].join("\n\n"),
  };
}

function explainAllocation(planContext, portfolio) {
  if (!portfolio) return "A saved portfolio allocation is not available yet. Save a complete plan first.";

  const target = formatAllocation(portfolio.target_allocation_percent);
  const current = formatAllocation(portfolio.current_allocation_percent);
  const cap = planContext.risk_constraints?.max_volatile_exposure_percent;
  const parts = [
    `Your saved risk profile is ${safeText(planContext.risk_profile, "not available")}, based on ${safeText(planContext.risk_tolerance, "your selected")} risk tolerance and a ${safeText(planContext.goal?.horizon_years, "not available")}-year ${formatGoal(planContext.goal?.type)} goal.`,
    `Your target allocation is ${target}.`,
    `Your current simulated allocation is ${current}.`,
  ];
  if (Number.isFinite(cap)) parts.push(`Equity plus commodity exposure is capped at ${cap}% for this saved plan.`);
  if (portfolio.recommendation_explanation) parts.push(portfolio.recommendation_explanation);
  parts.push("This explains the saved plan only; it is not investment advice or a recommendation to trade.");
  return parts.join("\n\n");
}

function explainContributions(planContext, portfolio) {
  const goal = planContext.goal ?? {};
  const amount = goal.investment_type === "monthly" ? goal.monthly_contribution_inr : goal.initial_investment_inr;
  const label = goal.investment_type === "monthly" ? "monthly contribution" : "one-time contribution";
  const parts = [
    `Your saved ${label} is ${formatRupees(amount)} over a ${safeText(goal.horizon_years, "not available")}-year horizon.`,
  ];
  if (portfolio?.target_allocation_percent) {
    parts.push(`The plan applies the target split of ${formatAllocation(portfolio.target_allocation_percent)} to that contribution.`);
  }
  const amounts = portfolio?.investment_options?.class_amounts;
  if (amounts && typeof amounts === "object") {
    const detail = Object.entries(amounts)
      .filter(([, value]) => Number.isFinite(value))
      .map(([assetClass, value]) => `${title(assetClass)} ${formatRupees(value)}`)
      .join(", ");
    if (detail) parts.push(`Saved class amounts: ${detail}.`);
  }
  return parts.join("\n\n");
}

function explainProjection(projection) {
  if (!projection) return "The illustrative projection is not available in the saved plan.";
  return [
    `The saved projection uses a ${safeText(projection.expected_return_percent, "not available")}% annual return assumption for ${safeText(projection.years, "not available")} years.`,
    `Total planned contributions are ${formatRupees(projection.total_contributions)}. The illustrative future value is ${formatRupees(projection.future_value)}, including ${formatRupees(projection.estimated_growth)} of estimated growth.`,
    projection.disclaimer || "This is an illustration, not a forecast or guarantee.",
  ].join("\n\n");
}

function explainCandidates(portfolio) {
  const byClass = portfolio?.investment_options?.candidates_by_class;
  if (!byClass || typeof byClass !== "object") return "Saved educational portfolio candidates are not available yet.";
  const groups = Object.entries(byClass)
    .map(([assetClass, candidates]) => {
      const names = (Array.isArray(candidates) ? candidates : [])
        .slice(0, 4)
        .map((candidate) => candidate?.name || candidate?.symbol)
        .filter(Boolean);
      return names.length ? `${title(assetClass)}: ${names.join(", ")}.` : null;
    })
    .filter(Boolean);
  return [
    "These are educational candidates recorded with your saved portfolio; they are not buy or sell recommendations.",
    groups.length ? groups.join("\n") : "No candidate details are available in the saved portfolio.",
  ].join("\n\n");
}

function explainRebalancing(portfolio) {
  if (!portfolio) return "A saved portfolio is not available yet.";
  const parts = [
    `Rebalancing compares the current simulated allocation (${formatAllocation(portfolio.current_allocation_percent)}) with the saved target (${formatAllocation(portfolio.target_allocation_percent)}).`,
    "In this demo, a confirmed rebalance simulation resets the simulated weights to the saved target. It does not place real trades.",
  ];
  if (!portfolio.has_simulated_market) parts.push("There is no simulated market movement yet, so there is no simulated drift to reset.");
  return parts.join("\n\n");
}

function matches(question, terms) {
  return terms.some((term) => question.includes(term));
}

function formatAllocation(allocation) {
  if (!allocation || typeof allocation !== "object") return "not available";
  return ["equity", "debt", "commodity"]
    .filter((assetClass) => Number.isFinite(allocation[assetClass]))
    .map((assetClass) => `${title(assetClass)} ${allocation[assetClass]}%`)
    .join(", ") || "not available";
}

function formatRupees(value) {
  return Number.isFinite(value) ? rupees.format(value) : "not available";
}

function formatGoal(value) {
  return typeof value === "string" ? value.replaceAll("_", " ") : "saved";
}

function title(value) {
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeText(value, fallback) {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}
