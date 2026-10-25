const GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss/search";
const GDELT_DOC_API_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const NEWS_TIMEOUT_MS = 5_000;
const MAX_HEADLINES = 6;

/** Fetches a small attributed snapshot for educational market discussion. */
export async function getMarketNewsSnapshot({ investmentOptions, topic } = {}) {
  const query = buildNewsQuery(investmentOptions, topic);
  const url = new URL(GOOGLE_NEWS_RSS_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en-IN");
  url.searchParams.set("gl", "IN");
  url.searchParams.set("ceid", "IN:en");

  try { return await fetchGoogleNews(url, query); }
  catch {
    try { return await fetchGdeltNews(query); }
    catch {
      return {
        status: "unavailable", query, fetched_at: new Date().toISOString(), headlines: [],
        limitations: "Neither live-news provider could be reached from this server. Check the server's outbound internet or configure ALPHA_VANTAGE_API_KEY for the additional provider.",
      };
    }
  }
}

async function fetchGoogleNews(url, query) {
  const response = await fetch(url, {
    headers: { "User-Agent": "FinGuide educational research assistant/1.0" },
    signal: AbortSignal.timeout(NEWS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Google News returned ${response.status}.`);
  const headlines = parseRssItems(await response.text()).slice(0, MAX_HEADLINES);
  if (!headlines.length) throw new Error("Google News returned no usable headlines.");
  return {
    status: "available", provider: "Google News RSS", query, fetched_at: new Date().toISOString(), headlines,
    limitations: "Headlines are third-party reporting, not verified price data or a prediction of an instrument's future price.",
  };
}

async function fetchGdeltNews(query) {
  const url = new URL(GDELT_DOC_API_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", String(MAX_HEADLINES));
  const response = await fetch(url, { signal: AbortSignal.timeout(NEWS_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`GDELT returned ${response.status}.`);
  const payload = await response.json();
  const headlines = (payload?.articles ?? []).map((article) => ({
    title: String(article.title ?? "").trim(),
    source: String(article.domain ?? "GDELT source").trim(),
    published_at: String(article.seendate ?? "").trim(),
    url: String(article.url ?? "").trim(),
  })).filter((item) => item.title && isSafeHttpUrl(item.url)).slice(0, MAX_HEADLINES);
  if (!headlines.length) throw new Error("GDELT returned no usable headlines.");
  return {
    status: "available", provider: "GDELT", query, fetched_at: new Date().toISOString(), headlines,
    limitations: "Headlines are third-party reporting, not verified price data or a prediction of an instrument's future price.",
  };
}

function buildNewsQuery(investmentOptions, topic) {
  const symbols = Object.values(investmentOptions?.by_asset_class ?? {})
    .flat().map((candidate) => candidate?.symbol)
    .filter((symbol) => typeof symbol === "string" && /^[A-Za-z0-9._-]{1,20}$/.test(symbol))
    .slice(0, 4);
  const topicalTerms = typeof topic === "string"
    ? topic.toLowerCase().match(/\b(oil|crude|inflation|interest rates?|rbi|bond|rupee|currency|gold|commodity|equity|stock market)\b/g)?.slice(0, 4).join(" ")
    : "";
  return `India markets equity debt commodities${topicalTerms ? ` ${topicalTerms}` : ""}${symbols.length ? ` ${symbols.join(" ")}` : ""}`;
}

function parseRssItems(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
    const item = match[1];
    const rawTitle = readTag(item, "title");
    const sourceMatch = rawTitle.match(/\s+-\s+([^–-]+)$/);
    return {
      title: decodeXml(rawTitle.replace(/\s+-\s+[^–-]+$/, "").trim()),
      source: decodeXml(readTag(item, "source") || sourceMatch?.[1] || "News source"),
      published_at: decodeXml(readTag(item, "pubDate")),
      url: decodeXml(readTag(item, "link")),
    };
  }).filter((item) => item.title && isSafeHttpUrl(item.url));
}

function readTag(text, tag) {
  const match = text.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, "")?.trim() ?? "";
}

function decodeXml(value) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function isSafeHttpUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; }
}
