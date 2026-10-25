const MFAPI_URL = "https://api.mfapi.in/mf";
const ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query";
const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 10 * 60 * 1_000;
const cache = new Map();

/**
 * Small live-data supplement for chat. It deliberately returns observations
 * with their dates, rather than treating delayed NAVs or commodity references
 * as live tradable prices.
 */
export async function getAssistantLiveMarketContext({ investmentOptions, message } = {}) {
  const candidates = Object.values(investmentOptions?.by_asset_class ?? {}).flat();
  const context = { fetched_at: new Date().toISOString(), mutual_fund_navs: [], commodity_references: [], alpha_vantage_news: null };

  if (shouldFetchFundNavs(message)) {
    const schemeCodes = [...new Set(candidates
      .filter((candidate) => candidate?.instrument_type === "mutualFund")
      .map((candidate) => String(candidate.scheme_code || candidate.symbol || "").trim())
      .filter((code) => /^\d+$/.test(code)))]
      .slice(0, 3);
    const results = await Promise.allSettled(schemeCodes.map(fetchLatestMutualFundNav));
    context.mutual_fund_navs = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
  }

  if (/\b(oil|crude|energy)\b/i.test(message || "")) {
    const brent = await fetchCommodityReference("BRENT");
    if (brent) context.commodity_references.push(brent);
  }

  if (shouldFetchNews(message)) {
    context.alpha_vantage_news = await fetchAlphaVantageNews();
  }

  return context;
}

function shouldFetchFundNavs(message) {
  return /\b(nav|mutual fund|fund|latest|current|today|price|portfolio value)\b/i.test(message || "");
}

function shouldFetchNews(message) {
  return /\b(latest|current|today|news|market|price|prices|impact|affect|effect|happening|update|oil|crude)\b/i.test(message || "");
}

async function fetchLatestMutualFundNav(schemeCode) {
  const payload = await cachedJson(`mfapi:${schemeCode}`, `${MFAPI_URL}/${encodeURIComponent(schemeCode)}/latest`);
  const latest = payload?.data?.[0];
  const nav = Number(latest?.nav);
  if (!payload?.meta?.scheme_name || !Number.isFinite(nav) || nav <= 0 || !latest?.date) {
    throw new Error("MFapi returned an invalid latest NAV response.");
  }
  return {
    scheme_code: schemeCode,
    scheme_name: payload.meta.scheme_name,
    nav,
    nav_date: latest.date,
    source: "MFapi.in",
    status: "latest_published_nav",
    limitation: "Mutual-fund NAVs are normally published once per valuation day and are not intraday prices.",
  };
}

async function fetchCommodityReference(functionName) {
  if (!process.env.ALPHA_VANTAGE_API_KEY) return null;
  try {
    const payload = await cachedJson(
      `alpha:${functionName}`,
      `${ALPHA_VANTAGE_URL}?function=${encodeURIComponent(functionName)}&interval=monthly&apikey=${encodeURIComponent(process.env.ALPHA_VANTAGE_API_KEY)}`,
    );
    const rows = Object.values(payload ?? {}).find(Array.isArray);
    const latest = [...(rows ?? [])]
      .map((row) => ({ date: row.date ?? row.Date, value: Number(row.value ?? row.Value) }))
      .filter((row) => row.date && Number.isFinite(row.value))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    return latest ? {
      benchmark: functionName,
      value: latest.value,
      currency: "USD",
      date: latest.date,
      source: "Alpha Vantage",
      status: "monthly_reference_price",
      limitation: "This is a global monthly reference series, not a live MCX price or an INR investment return.",
    } : null;
  } catch {
    return null;
  }
}

async function fetchAlphaVantageNews() {
  if (!process.env.ALPHA_VANTAGE_API_KEY) {
    return { status: "not_configured", limitation: "Set ALPHA_VANTAGE_API_KEY to include Alpha Vantage market news." };
  }
  try {
    const payload = await cachedJson(
      "alpha:news:financial_markets",
      `${ALPHA_VANTAGE_URL}?function=NEWS_SENTIMENT&topics=financial_markets&limit=4&apikey=${encodeURIComponent(process.env.ALPHA_VANTAGE_API_KEY)}`,
    );
    const headlines = Array.isArray(payload?.feed) ? payload.feed.slice(0, 4).map((item) => ({
      title: item.title,
      source: item.source,
      published_at: item.time_published,
      url: item.url,
    })).filter((item) => item.title && item.source && isSafeHttpUrl(item.url)) : [];
    return headlines.length
      ? { status: "available", headlines, source: "Alpha Vantage News & Sentiment" }
      : { status: "unavailable", limitation: "Alpha Vantage returned no usable market-news headlines." };
  } catch {
    return { status: "unavailable", limitation: "Alpha Vantage news could not be retrieved for this response." };
  }
}

async function cachedJson(key, url) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.payload;
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Provider returned ${response.status}.`);
  const payload = await response.json();
  if (payload?.["Error Message"] || payload?.Note || payload?.Information) throw new Error("Provider rejected the request.");
  cache.set(key, { fetchedAt: Date.now(), payload });
  return payload;
}

function isSafeHttpUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; }
}
