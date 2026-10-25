import assert from "node:assert/strict";
import { test } from "node:test";
import { generateAssistantReply } from "../src/services/geminiAssistantService.js";

test("Gemini requests keep credentials in a header and include plan context", async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  const originalSearchEnabled = process.env.GEMINI_GOOGLE_SEARCH_ENABLED;
  const originalFetch = globalThis.fetch;
  let requestUrl;
  let requestOptions;
  process.env.GEMINI_API_KEY = "test-key-never-send-to-url";
  process.env.GEMINI_MODEL = "test-flash";
  process.env.GEMINI_GOOGLE_SEARCH_ENABLED = "true";
  globalThis.fetch = async (url, options) => {
    requestUrl = String(url);
    requestOptions = options;
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Your saved plan uses a hypothetical allocation." }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const result = await generateAssistantReply({
      message: "Explain my target mix",
      history: [{ role: "user", text: "Hello" }],
      planContext: {
        target_allocation_percent: { equity: 50, debt: 40, commodity: 10 },
        investment_examples: { status: "illustrative_examples_only" },
      },
      liveProviderData: {
        mutual_fund_navs: [{ scheme_code: "120716", nav: 200, source: "MFapi.in" }],
      },
    });

    assert.equal(result.model, "test-flash");
    assert.match(result.reply, /hypothetical allocation/);
    assert.equal(requestUrl, "https://generativelanguage.googleapis.com/v1beta/models/test-flash:generateContent");
    assert.equal(requestOptions.headers["x-goog-api-key"], "test-key-never-send-to-url");
    assert.equal(requestUrl.includes("test-key-never-send-to-url"), false);
    assert.match(requestOptions.body, /target_allocation_percent/);
    assert.match(requestOptions.body, /illustrative_examples_only/);
    assert.match(requestOptions.body, /MFapi.in/);
    assert.match(requestOptions.body, /Never invent a product, amount, return, or fund detail/);
    assert.match(requestOptions.body, /Do not provide personalized investment/);
    assert.match(requestOptions.body, /3-5 short bullet points or paragraphs/);
    assert.equal(JSON.parse(requestOptions.body).generationConfig.maxOutputTokens, 4096);
    assert.deepEqual(JSON.parse(requestOptions.body).tools, [{ google_search: {} }]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = originalModel;
    if (originalSearchEnabled === undefined) delete process.env.GEMINI_GOOGLE_SEARCH_ENABLED;
    else process.env.GEMINI_GOOGLE_SEARCH_ENABLED = originalSearchEnabled;
  }
});

test("Gemini token-truncated answers are reported instead of shown as complete", async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{
      finishReason: "MAX_TOKENS",
      content: { parts: [{ text: "Here is an unfinished answer" }] },
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    await assert.rejects(
      () => generateAssistantReply({ message: "Explain my allocation", history: [], planContext: {} }),
      (error) => error.status === 502 && /cut off before it finished/.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test("Gemini timeout is returned as a specific retryable service error", async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = async () => {
    throw new DOMException("The operation timed out.", "TimeoutError");
  };

  try {
    await assert.rejects(
      () => generateAssistantReply({ message: "Help", history: [], planContext: {} }),
      (error) => error.status === 504 && /45 seconds/.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
});

test("Gemini service reports missing server configuration explicitly", async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    await assert.rejects(
      () => generateAssistantReply({ message: "Help", history: [], planContext: {} }),
      (error) => error.status === 503 && /GEMINI_API_KEY/.test(error.message),
    );
  } finally {
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
  }
});
