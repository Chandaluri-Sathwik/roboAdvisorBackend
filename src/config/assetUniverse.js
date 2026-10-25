/*
 * Editable seed universe.
 *
 * Stocks: symbols are a starting point, not a live official constituent list.
 * Constituents change over time; verify against the latest NSE/BSE lists before
 * using this for production portfolio recommendations.
 *
 * Mutual funds: research proxies are not endorsements or a ranking. Add only
 * MFapi.in schemes with verified identity, category, Direct-Growth option, and
 * current NAV history. Do not claim complete class coverage from a partial set.
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

// Research-only class proxies. The selected groups target three schemes per
// class, but debt and cash-like coverage remain incomplete until fresh,
// category-matched candidates are verified.
export const mutualFundUniverse = [
  {
    schemeCode: 120716,
    schemeName: "UTI Nifty 50 Index Fund - Direct Plan - Growth",
    assetClass: "equity",
    categoryMustInclude: "index funds",
    nameMustInclude: "nifty 50",
  },
  {
    schemeCode: 118482,
    schemeName: "Bandhan Nifty 50 Index Fund - Direct Plan - Growth",
    assetClass: "equity",
    categoryMustInclude: "index funds",
    nameMustInclude: "nifty 50",
  },
  {
    schemeCode: 118741,
    schemeName: "Nippon India Index Fund - Nifty 50 Plan - Direct Plan - Growth Option",
    assetClass: "equity",
    categoryMustInclude: "index funds",
    nameMustInclude: "nifty 50",
  },
  {
    schemeCode: 120754,
    schemeName: "ICICI Prudential Short Term Fund - Direct Plan - Growth",
    assetClass: "debt",
    categoryMustInclude: "short duration fund",
    nameMustInclude: "short term fund",
  },
  {
    schemeCode: 119781,
    schemeName: "Kotak Gold Fund - Direct Plan - Growth",
    assetClass: "gold",
    categoryMustInclude: "fof domestic",
    nameMustInclude: "gold",
  },
  {
    schemeCode: 154295,
    schemeName: "HSBC Gold ETF Fund of Fund - Direct Plan - Growth",
    assetClass: "gold",
    categoryMustInclude: "fund of funds scheme (domestic)",
    nameMustInclude: "gold",
  },
  {
    schemeCode: 119132,
    schemeName: "HDFC Gold ETF Fund of Fund - Direct Plan - Growth Option",
    assetClass: "gold",
    categoryMustInclude: "fof domestic",
    nameMustInclude: "gold",
  },
  {
    schemeCode: 149760,
    schemeName: "Nippon India Silver ETF FOF - Direct Plan - Growth Option",
    assetClass: "commodity",
    categoryMustInclude: "fof domestic",
    nameMustInclude: "silver",
  },
  {
    schemeCode: 149775,
    schemeName: "ICICI Prudential Silver ETF FOF - Direct Plan - Growth",
    assetClass: "commodity",
    categoryMustInclude: "fof domestic",
    nameMustInclude: "silver",
  },
  {
    schemeCode: 149780,
    schemeName: "Aditya Birla Sun Life Silver ETF FOF - Direct Plan - GROWTH",
    assetClass: "commodity",
    categoryMustInclude: "fund of funds scheme (domestic)",
    nameMustInclude: "silver",
  },
  {
    schemeCode: 149664,
    schemeName: "Sundaram Liquid Fund - Direct Plan - Growth",
    assetClass: "cash_proxy",
    categoryMustInclude: "liquid fund",
    nameMustInclude: "liquid fund",
  },
];

export const targetFundCountPerProxyClass = 3;

export const additionalMutualFundHistoryUniverse = [
  122639, 145110, 118347, 118348, 148363, 120684, 143341,
  119298, 119482, 132185, 129200, 120700,
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
