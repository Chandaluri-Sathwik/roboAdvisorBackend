/*
 * Editable seed universe.
 *
 * Stocks: symbols are a starting point, not a live official constituent list.
 * Constituents change over time; verify against the latest NSE/BSE lists before
 * using this for production portfolio recommendations.
 *
 * Mutual funds: add verified MFapi.in scheme codes. The code deliberately does
 * not label an unverified list as "top 10 by AUM". Pick the 10 largest schemes
 * by AUM in each category from a dated, reliable source, prefer Direct-Growth,
 * then paste the exact MFapi scheme codes below.
 */

export const stockUniverse = [
  // NIFTY 50 / SENSEX commonly traded symbols; remove duplicates hello automatically
  "RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "ITC", "LT",
  "SBIN", "BHARTIARTL", "AXISBANK", "KOTAKBANK", "HINDUNILVR",
  "BAJFINANCE", "MARUTI", "SUNPHARMA", "TITAN", "NTPC", "POWERGRID",
  "M&M", "TATAMOTORS", "TATASTEEL", "ULTRACEMCO", "ASIANPAINT",
  "HCLTECH", "WIPRO", "TECHM", "INDUSINDBK", "ONGC", "COALINDIA",
  "JSWSTEEL", "ADANIENT", "ADANIPORTS", "NESTLEIND", "GRASIM",
  "CIPLA", "DRREDDY", "EICHERMOT", "HEROMOTOCO", "BRITANNIA",
  "APOLLOHOSP", "DIVISLAB", "BPCL", "IOC", "TATACONSUM",
  "SBILIFE", "HDFCLIFE", "BAJAJFINSV", "TRENT", "BEL",
  "BANKBARODA", "CANBK", "PNB", "IDFCFIRSTB", "DMART", "PIDILITIND",
  "HAVELLS", "DABUR", "GODREJCP", "SHRIRAMFIN", "VEDL", "ZOMATO"
];

// Populate with verified MFapi.in scheme codes before running hello the seed script.
// Shape: { category: "largeCap" | "midCap" | "smallCap" | "hybrid",
//          schemeCode: "numeric MFapi scheme code", schemeName: "optional label" }
export const mutualFundUniverse = [

  // Flexi-cap equity
  122639, // Parag Parikh Flexi Cap Fund

  // Large & mid-cap equity
  145110, // Axis Large & Mid Cap Fund

  // Index funds
  118347, // IDBI NIFTY 50 Index Fund
  118348, // IDBI Nifty Next 50 Index Fund
  148363, // L&T Next Nifty 50 Index Fund
  120684, // ICICI Prudential Nifty Next 50 Index Fund
  143341, // UTI Nifty Next 50 Index Fund

  // Balanced advantage funds
  119298, // L&T Balanced Advantage Fund
  119482, // Principal Balanced Advantage Fund

  // Fund-of-funds schemes returned by the search
  132185, // Aditya Birla Sun Life Aggressive Hybrid Omni FOF
  129200, // HSBC Aggressive Hybrid Active FOF
  120700, // ICICI Prudential Aggressive Hybrid Active FOF
];

export const commodityUniverse = [
  "WTI", "BRENT", "NATURAL_GAS", "COPPER", "ALUMINUM",
  "WHEAT", "CORN", "COTTON", "SUGAR", "COFFEE"
];

export const bondUniverse = [
  // RBI DBIE endpoint currently returns a table of government-security yields.
  // The importer fetches the provider table as a whole; it does not synthesize
  // individual bond prices or maturities.
  "RBI_DBIE_GOVT_SECURITY_YIELDS"
];

export const seedOptions = {
  exchange: "nse",
  // Keep requests manageable; TejHQ may not support every symbol/date range.
  from: "2021-01-01",
  to: new Date().toISOString().slice(0, 10),
  commodityInterval: "monthly",
  delayMs: 1200
};
