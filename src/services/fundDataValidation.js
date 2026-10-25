const VALID_PROXY_CLASSES = new Set(["equity", "debt", "gold", "cash_proxy"]);

export function validateConfiguredFundMetadata(fund, records) {
  if (!VALID_PROXY_CLASSES.has(fund.assetClass)) {
    throw new Error(`Unsupported mutual-fund proxy class: ${fund.assetClass}`);
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`Scheme ${fund.schemeCode} returned no valid NAV history.`);
  }

  const metadata = records[0].rawData;
  if (String(metadata?.schemeCode) !== String(fund.schemeCode)) {
    throw new Error(`Scheme identity mismatch for ${fund.schemeCode}.`);
  }

  const name = String(metadata.schemeName ?? "").toLowerCase();
  const category = String(metadata.schemeCategory ?? "").toLowerCase();
  if (!name || !category) {
    throw new Error(`Scheme ${fund.schemeCode} is missing name or category metadata.`);
  }
  if (!name.includes(fund.nameMustInclude.toLowerCase())) {
    throw new Error(
      `Scheme ${fund.schemeCode} name does not match the configured ${fund.assetClass} proxy.`,
    );
  }
  if (!category.includes(fund.categoryMustInclude.toLowerCase())) {
    throw new Error(
      `Scheme ${fund.schemeCode} category "${metadata.schemeCategory}" does not match the configured category.`,
    );
  }
  if (!name.includes("direct") || !name.includes("growth")) {
    throw new Error(`Scheme ${fund.schemeCode} is not confirmed as Direct Growth.`);
  }
  if (/\b(idcw|dividend|bonus|reinvestment|payout)\b/.test(name)) {
    throw new Error(`Scheme ${fund.schemeCode} appears to be a distribution or bonus option.`);
  }
  if (
    records.some(
      (record) =>
        record.source !== "MFapi.in" ||
        record.currency !== "INR" ||
        !Number.isFinite(record.value) ||
        record.value <= 0,
    )
  ) {
    throw new Error(`Scheme ${fund.schemeCode} contains invalid source, currency, or NAV values.`);
  }

  return {
    schemeCode: String(metadata.schemeCode),
    schemeName: metadata.schemeName,
    schemeCategory: metadata.schemeCategory,
    fundHouse: metadata.fundHouse,
    isinGrowth: metadata.isinGrowth,
  };
}
