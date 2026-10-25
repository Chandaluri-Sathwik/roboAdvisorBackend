import {
  bondUniverse,
  commodityUniverse,
  mutualFundUniverse,
  stockUniverse,
} from "./assetUniverse.js";

const catalogDefinitions = [
  ...[...new Set(stockUniverse)].map((symbol) => ({
    assetType: "stock",
    symbol: String(symbol).toUpperCase(),
    displayName: String(symbol).toUpperCase(),
    assetClass: "equity",
    dataKind: "unadjusted_price",
    currency: "INR",
    source: "TejHQ",
    cadence: "daily",
    priceAnalysisSupported: true,
    limitations: [
      "Price changes exclude dividends and may not adjust for corporate actions.",
      "This series is exploratory and is not sufficient for portfolio recommendations.",
    ],
  })),
  ...mutualFundUniverse.map((fund) => {
    const schemeCode =
      typeof fund === "object" && fund !== null
        ? fund.schemeCode
        : fund;
    const schemeName =
      typeof fund === "object" && fund !== null
        ? fund.schemeName
        : undefined;

    return {
      assetType: "mutualFund",
      symbol: String(schemeCode),
      displayName: schemeName ?? `MF scheme ${schemeCode}`,
      assetClass: fund.assetClass,
      dataKind: "nav",
      currency: "INR",
      source: "MFapi.in",
      cadence: "daily",
      priceAnalysisSupported: true,
      portfolioProxyClass: fund.assetClass,
      recommendationEligible: false,
      limitations: [
        "A single mutual-fund NAV series is only a research proxy, not a complete asset-class return series.",
        "Confirm the scheme's current name, category, plan and option with the fund provider; NAV changes are not personalized recommendations.",
        "Growth-plan NAV performance is after fund expenses but excludes investor tax and any applicable exit load.",
      ],
    };
  }),
  ...[...new Set(commodityUniverse)].map((symbol) => ({
    assetType: "commodity",
    symbol: String(symbol).toUpperCase(),
    displayName: String(symbol).replaceAll("_", " "),
    assetClass: "commodity",
    dataKind: "reference_price",
    currency: "USD",
    source: "Alpha Vantage",
    cadence: "monthly",
    priceAnalysisSupported: true,
    limitations: [
      "Reference-price changes exclude futures roll yield, collateral returns, fees, and INR currency effects.",
      "This series is not an investable Indian portfolio holding.",
    ],
  })),
  ...bondUniverse.map((dataset) => ({
    assetType: "bond",
    symbol: String(dataset),
    displayName: "RBI government-security yields",
    assetClass: "debt_yield",
    dataKind: "yield_observation",
    currency: "INR",
    source: "RBI DBIE",
    cadence: "daily",
    priceAnalysisSupported: false,
    limitations: [
      "Yield observations are not bond prices or bond total returns.",
      "No debt-portfolio performance analysis is available from this dataset.",
    ],
  })),
];

const catalogByIdentity = new Map(
  catalogDefinitions
    .filter((item) => item.assetType !== "bond")
    .map((item) => [`${item.assetType}:${item.symbol}`, item]),
);

export const ASSET_CATALOG = Object.freeze(catalogDefinitions);

export function getCatalogInstrument(assetType, symbol) {
  const normalizedSymbol =
    assetType === "stock" || assetType === "commodity"
      ? String(symbol).toUpperCase()
      : String(symbol);

  if (assetType === "bond") {
    return ASSET_CATALOG.find((item) => item.assetType === "bond");
  }

  return catalogByIdentity.get(`${assetType}:${normalizedSymbol}`);
}
