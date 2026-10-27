const DEFAULT_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};
const DEFAULT_SELECTION_LLM_MODEL = "claude-haiku-4-5-20251001";

const MAX_BING_TEXT_LENGTH = 1000;
const MAX_SELECTION_TEXT_LENGTH = 12000;
const MAX_CLI_ARGS = 64;
const MAX_CLI_ARG_LENGTH = 4096;
const MAX_LOAD_TEST_REQUESTS = 200;
const MAX_LOAD_TEST_CONCURRENCY = 16;
// Bing keeps the original 15s per-request budget (session is cached so cold start is rare).
const BING_REQUEST_TIMEOUT_MS = 15000;
const BING_SESSION_TTL_MS = 10 * 60 * 1000;
// LLM selection translation is the path that actually needs a longer budget.
const LLM_REQUEST_TIMEOUT_MS = 45000;
// Selection translation always forces low reasoning effort (do not inherit sidebar effort).
const SELECTION_TRANSLATION_EFFORT = "low";
// The managed Responses route needs enough budget for Kimi to consistently
// finish its translation response instead of returning empty `incomplete`
// payloads.
const RESPONSES_SELECTION_MAX_OUTPUT_TOKENS = 2048;
const BING_HTML_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const BING_JSON_RESPONSE_MAX_BYTES = 1024 * 1024;
const LLM_JSON_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const EDGE_PUNCTUATION_PATTERN =
  /^[\s"'`“”‘’«»「」『』（）()\[\]{}<>.,!?;:，。！？；：、]+|[\s"'`“”‘’«»「」『』（）()\[\]{}<>.,!?;:，。！？；：、]+$/gu;
const REFERENCE_MARKER_PATTERN = /[*†‡§¶‖※⁂#]+|[¹²³⁴⁵⁶⁷⁸⁹⁰]+/gu;
// Opening / closing square-bracket variants seen in PDF text extraction.
const CITATION_BRACKET_OPEN_CLASS = "\\[［【〔⟦";
const CITATION_BRACKET_CLOSE_CLASS = "\\]］】〕⟧";
// [1]-[3] / [1]–[5] written as two bracket groups joined by a dash.
const CITATION_BRACKET_RANGE_PATTERN = new RegExp(
  `[${CITATION_BRACKET_OPEN_CLASS}]\\s*\\d{1,4}[A-Za-z]?\\s*[${CITATION_BRACKET_CLOSE_CLASS}]\\s*[-–—]\\s*[${CITATION_BRACKET_OPEN_CLASS}]\\s*\\d{1,4}[A-Za-z]?\\s*[${CITATION_BRACKET_CLOSE_CLASS}]`,
  "gu",
);
// Any [...] group; content is then validated as a numeric citation list.
const CITATION_BRACKET_GROUP_PATTERN = new RegExp(
  `[${CITATION_BRACKET_OPEN_CLASS}]([^${CITATION_BRACKET_CLOSE_CLASS}]{0,160})[${CITATION_BRACKET_CLOSE_CLASS}]`,
  "gu",
);

function parseArgs(argv) {
  const safeArgv = Array.isArray(argv)
    ? argv.slice(0, MAX_CLI_ARGS).map((value) => String(value || "").slice(0, MAX_CLI_ARG_LENGTH))
    : [];
  const options = {
    from: "en",
    to: "zh-Hans",
    text: "",
    mode: "translate",
    test: false,
    loadTest: false,
    concurrency: 4,
    requests: 20,
  };

  for (let i = 0; i < safeArgv.length; i += 1) {
    const arg = safeArgv[i];
    if (arg === "--from") {
      options.from = safeArgv[++i] || options.from;
    } else if (arg === "--to") {
      options.to = safeArgv[++i] || options.to;
    } else if (arg === "--text") {
      options.text = safeArgv[++i] || "";
    } else if (arg === "--mode") {
      options.mode = safeArgv[++i] || options.mode;
    } else if (arg === "--test") {
      options.test = true;
    } else if (arg === "--load-test") {
      options.loadTest = true;
    } else if (arg === "--concurrency") {
      options.concurrency = Number(safeArgv[++i] || options.concurrency);
    } else if (arg === "--requests") {
      options.requests = Number(safeArgv[++i] || options.requests);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("--") && !options.text) {
      options.text = arg;
    }
  }

  options.concurrency = Math.max(1, Math.min(Number(options.concurrency) || 4, MAX_LOAD_TEST_CONCURRENCY));
  options.requests = Math.max(1, Math.min(Number(options.requests) || 20, MAX_LOAD_TEST_REQUESTS));
  options.text = String(options.text || "").slice(0, MAX_SELECTION_TEXT_LENGTH);
  return options;
}

function printHelp() {
  console.log(`Usage:
  node selection-translation-service.mjs --from en --to zh-Hans --text "hello world"
  node selection-translation-service.mjs --mode selection --from en --to zh-Hans --text "apple,"
  node selection-translation-service.mjs --test
  node selection-translation-service.mjs --load-test --requests 20 --concurrency 4
`);
}

function extractSingle(pattern, input, name) {
  const match = input.match(pattern);
  if (!match) {
    throw new Error(`Failed to extract ${name} from Bing translator page`);
  }
  return match[1];
}

async function fetchWithTimeout(url, options = {}, timeoutMs = BING_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: options.signal || controller.signal,
    });
  }
  finally {
    clearTimeout(timer);
  }
}

async function readResponseTextWithLimit(response, maxBytes, label = "response") {
  const contentLength = Number(response.headers?.get?.("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new Error(`${label} is too large (${contentLength} bytes)`);
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new Error(`${label} is too large (${buffer.byteLength} bytes)`);
    }
    return new TextDecoder("utf-8").decode(buffer);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || []);
    total += chunk.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // Ignore stream cancellation errors after enforcing the size gate.
      }
      throw new Error(`${label} is too large (${total} bytes)`);
    }
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return text;
}

async function readJsonWithLimit(response, maxBytes, label = "JSON response") {
  const text = await readResponseTextWithLimit(response, maxBytes, label);
  return text ? JSON.parse(text) : null;
}

function emitTranslationDelta(onDelta, delta) {
	if (typeof onDelta !== "function" || !delta) return;
	try {
		onDelta(delta);
	}
	catch {
		// A renderer-side progress listener must never make a translation fail.
	}
}

function parseSseBlock(block) {
	const lines = String(block || "").split(/\r?\n/);
	const eventName = lines
		.find((line) => line.startsWith("event:"))
		?.slice("event:".length)
		.trim() || "";
	const data = lines
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice("data:".length).trimStart())
		.join("\n");
	if (!data || data === "[DONE]") {
		return { eventName, payload: null };
	}
	try {
		return { eventName, payload: JSON.parse(data) };
	}
	catch {
		return { eventName, payload: null };
	}
}

function appendSseChunks(state, text, consumeBlock) {
	state.buffer += String(text || "");
	for (;;) {
		const boundary = state.buffer.match(/\r?\n\r?\n/);
		if (!boundary || boundary.index === undefined) break;
		const block = state.buffer.slice(0, boundary.index);
		state.buffer = state.buffer.slice(boundary.index + boundary[0].length);
		consumeBlock(block);
	}
}

function createOpenAIResponsesSseState() {
	return {
		buffer: "",
		completed: null,
		outputText: "",
	};
}

function consumeOpenAIResponsesSseBlock(block, state, onDelta) {
	const { eventName, payload } = parseSseBlock(block);
	if (!payload) return;

	const type = eventName || String(payload?.type || "");
	if (type === "response.output_text.delta") {
		const delta = String(payload?.delta || "");
		if (delta) {
			state.outputText += delta;
			emitTranslationDelta(onDelta, delta);
		}
	}
	else if (type === "response.output_text.done" && !state.outputText) {
		const completedText = String(payload?.text || "");
		if (completedText) {
			state.outputText = completedText;
			emitTranslationDelta(onDelta, completedText);
		}
	}

	if (payload?.response && typeof payload.response === "object") {
		state.completed = payload.response;
	}
	else if (payload?.object === "response") {
		state.completed = payload;
	}
}

function appendOpenAIResponsesSseChunk(state, text, onDelta) {
	appendSseChunks(state, text, (block) => consumeOpenAIResponsesSseBlock(block, state, onDelta));
}

function finishOpenAIResponsesSse(state, onDelta) {
	if (state.buffer.trim()) {
		consumeOpenAIResponsesSseBlock(state.buffer, state, onDelta);
	}
	state.buffer = "";
	if (state.outputText.trim()) {
		return { ...(state.completed || {}), output_text: state.outputText.trim() };
	}
	return state.completed;
}

function parseOpenAIResponsesSse(text, { onDelta } = {}) {
	const state = createOpenAIResponsesSseState();
	appendOpenAIResponsesSseChunk(state, text, onDelta);
	return finishOpenAIResponsesSse(state, onDelta);
}

async function readOpenAIResponsesPayload(response, { onDelta } = {}) {
	const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
	const reader = contentType.includes("text/event-stream")
		&& typeof response.body?.getReader === "function"
		? response.body.getReader()
		: null;
	if (reader) {
		const decoder = new TextDecoder();
		const state = createOpenAIResponsesSseState();
		let total = 0;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || []);
				total += chunk.byteLength;
				if (total > LLM_JSON_RESPONSE_MAX_BYTES) {
					try {
						await reader.cancel();
					}
					catch {
						// Ignore cancellation errors after enforcing the response-size limit.
					}
					throw new Error(`OpenAI Responses translate response is too large (${total} bytes)`);
				}
				appendOpenAIResponsesSseChunk(state, decoder.decode(chunk, { stream: true }), onDelta);
			}
			appendOpenAIResponsesSseChunk(state, decoder.decode(), onDelta);
		}
		finally {
			reader.releaseLock?.();
		}
		const payload = finishOpenAIResponsesSse(state, onDelta);
		if (payload) return payload;
		throw new Error("OpenAI Responses stream did not contain a completed response.");
	}

	const text = await readResponseTextWithLimit(response, LLM_JSON_RESPONSE_MAX_BYTES, "OpenAI Responses translate response");
	if (!text) return null;
	if (contentType.includes("text/event-stream") || /^\s*(?:event|data):/u.test(text)) {
		const payload = parseOpenAIResponsesSse(text, { onDelta });
		if (payload) return payload;
		throw new Error("OpenAI Responses stream did not contain a completed response.");
	}
	return JSON.parse(text);
}

async function readStreamingJsonPayload(response, {
	label,
	createState,
	appendChunk,
	finish,
} = {}) {
	const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
	const reader = contentType.includes("text/event-stream")
		&& typeof response.body?.getReader === "function"
		? response.body.getReader()
		: null;
	if (reader) {
		const decoder = new TextDecoder();
		const state = createState();
		let total = 0;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || []);
				total += chunk.byteLength;
				if (total > LLM_JSON_RESPONSE_MAX_BYTES) {
					try {
						await reader.cancel();
					}
					catch {
						// Ignore cancellation errors after enforcing the response-size limit.
					}
					throw new Error(`${label} is too large (${total} bytes)`);
				}
				appendChunk(state, decoder.decode(chunk, { stream: true }));
			}
			appendChunk(state, decoder.decode());
		}
		finally {
			reader.releaseLock?.();
		}
		return finish(state);
	}

	const text = await readResponseTextWithLimit(response, LLM_JSON_RESPONSE_MAX_BYTES, label);
	if (!text) return null;
	if (contentType.includes("text/event-stream") || /^\s*(?:event|data):/u.test(text)) {
		const state = createState();
		appendChunk(state, text);
		return finish(state);
	}
	return JSON.parse(text);
}

function createStreamedTextState() {
	return {
		buffer: "",
		outputText: "",
		lastPayload: null,
	};
}

function consumeOpenAIChatSseBlock(block, state, onDelta) {
	const { payload } = parseSseBlock(block);
	if (!payload) return;
	state.lastPayload = payload;
	const delta = extractOpenAIStreamDelta(payload?.choices?.[0]?.delta?.content);
	if (!delta) return;
	state.outputText += delta;
	emitTranslationDelta(onDelta, delta);
}

function appendOpenAIChatSseChunk(state, text, onDelta) {
	appendSseChunks(state, text, (block) => consumeOpenAIChatSseBlock(block, state, onDelta));
}

function finishOpenAIChatSse(state, onDelta) {
	if (state.buffer.trim()) {
		consumeOpenAIChatSseBlock(state.buffer, state, onDelta);
	}
	state.buffer = "";
	if (state.outputText.trim()) {
		return {
			choices: [{
				message: { content: state.outputText.trim() },
			}],
		};
	}
	return state.lastPayload;
}

async function readOpenAIChatPayload(response, { onDelta } = {}) {
	return readStreamingJsonPayload(response, {
		label: "OpenAI Chat Completions translate response",
		createState: createStreamedTextState,
		appendChunk: (state, text) => appendOpenAIChatSseChunk(state, text, onDelta),
		finish: (state) => finishOpenAIChatSse(state, onDelta),
	});
}

function consumeAnthropicMessagesSseBlock(block, state, onDelta) {
	const { eventName, payload } = parseSseBlock(block);
	if (!payload) return;
	state.lastPayload = payload;
	const type = eventName || String(payload?.type || "");
	if (type !== "content_block_delta") return;
	const delta = String(payload?.delta?.text || "");
	if (!delta) return;
	state.outputText += delta;
	emitTranslationDelta(onDelta, delta);
}

function appendAnthropicMessagesSseChunk(state, text, onDelta) {
	appendSseChunks(state, text, (block) => consumeAnthropicMessagesSseBlock(block, state, onDelta));
}

function finishAnthropicMessagesSse(state, onDelta) {
	if (state.buffer.trim()) {
		consumeAnthropicMessagesSseBlock(state.buffer, state, onDelta);
	}
	state.buffer = "";
	if (state.outputText.trim()) {
		return {
			content: [{ type: "text", text: state.outputText.trim() }],
		};
	}
	return state.lastPayload;
}

async function readAnthropicMessagesPayload(response, { onDelta } = {}) {
	return readStreamingJsonPayload(response, {
		label: "Anthropic Messages translate response",
		createState: createStreamedTextState,
		appendChunk: (state, text) => appendAnthropicMessagesSseChunk(state, text, onDelta),
		finish: (state) => finishAnthropicMessagesSse(state, onDelta),
	});
}

let cachedBingSession = null;
let cachedBingSessionExpiresAt = 0;
let bingSessionInflight = null;

function clearBingSessionCache() {
  cachedBingSession = null;
  cachedBingSessionExpiresAt = 0;
}

async function fetchBingSessionFresh() {
  const response = await fetchWithTimeout("https://www.bing.com/translator", {
    method: "GET",
    headers: DEFAULT_HEADERS,
    redirect: "follow",
  }, BING_REQUEST_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`Failed to load Bing translator page: ${response.status}`);
  }

  const html = await readResponseTextWithLimit(response, BING_HTML_RESPONSE_MAX_BYTES, "Bing translator page");
  const pageUrl = new URL(response.url);
  const baseUrl = `${pageUrl.protocol}//${pageUrl.host}/`;
  const ig = extractSingle(/"ig":"(.*?)"/, html, "IG");

  const iidMatches = [...html.matchAll(/data-iid="(.*?)"/g)];
  if (iidMatches.length === 0) {
    throw new Error("Failed to extract IID from Bing translator page");
  }
  const iid = iidMatches[iidMatches.length - 1][1];

  const abuseMatch = html.match(
    /params_AbusePreventionHelper\s=\s\[(.*?),"(.+?)",/s,
  );
  if (!abuseMatch) {
    throw new Error("Failed to extract key/token from Bing translator page");
  }

  return {
    baseUrl,
    ig,
    iid,
    key: abuseMatch[1],
    token: abuseMatch[2],
    fetchedAt: Date.now(),
  };
}

async function getBingSession({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (
    !forceRefresh
    && cachedBingSession
    && cachedBingSessionExpiresAt > now
  ) {
    return cachedBingSession;
  }

  if (!forceRefresh && bingSessionInflight) {
    return bingSessionInflight;
  }

  const request = fetchBingSessionFresh()
    .then((session) => {
      cachedBingSession = session;
      cachedBingSessionExpiresAt = Date.now() + BING_SESSION_TTL_MS;
      return session;
    })
    .finally(() => {
      if (bingSessionInflight === request) {
        bingSessionInflight = null;
      }
    });
  bingSessionInflight = request;
  return request;
}

function normalizeText(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("Text must be a non-empty string");
  }
  return text.length > MAX_BING_TEXT_LENGTH
    ? text.slice(0, MAX_BING_TEXT_LENGTH)
    : text;
}

function decodeHtmlEntities(input) {
  return input
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripTags(input) {
  return decodeHtmlEntities(input.replace(/<[^>]+>/g, " "));
}

function compactWhitespace(input) {
  return input.replace(/\s+/g, " ").trim();
}

function canonicalizeSelectionText(input) {
  return input
    .replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, "")
    .normalize("NFKC")
    .replace(/[\u2000-\u200A\u202F\u205F\u3000\u00A0]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00AD/g, "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/(\p{L})-\s*\r?\n\s*(\p{L})/gu, "$1$2");
}

function normalizeCitationInner(inner) {
  return String(inner || "")
    .normalize("NFKC")
    .replace(/[\u2000-\u200A\u202F\u205F\u3000\u00A0]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u2010-\u2015]/g, "-")
    // PDF / CJK punctuation variants that often replace ASCII commas.
    .replace(/[‚、﹐﹑，]/g, ",")
    .replace(/[;；]/g, ";")
    .replace(/[./／]/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function isNumericCitationContent(inner) {
  const content = normalizeCitationInner(inner);
  if (!content || content.length > 160) {
    return false;
  }
  // Must contain a digit and only citation-safe characters.
  if (!/\d/u.test(content)) {
    return false;
  }
  // Reject words like "appendix" / "et al"; allow single-letter suffixes (12a).
  if (/[A-Za-z]{2,}/u.test(content)) {
    return false;
  }
  if (!/^[0-9A-Za-z\s,;/\-]+$/u.test(content)) {
    return false;
  }
  const tokens = content.split(/[\s,;/]+/).filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }
  // Each token: 4, 12a, 1-5, 3a-4b
  return tokens.every((token) => /^\d{1,4}[A-Za-z]?(?:-\d{1,4}[A-Za-z]?)?$/u.test(token));
}

function stripNumericCitationMarkers(input) {
  // Empty replacement: surrounding spaces are collapsed later.
  // Avoid inserting a space so CJK runs like "结果[1]显示" stay tight.
  //
  // Content-validated stripping is intentional: PDF extraction often turns
  // "[4, 13, 64]" into space-separated or odd-comma forms that a fixed
  // "digit-comma-digit" regex misses intermittently.
  return String(input || "")
    .replace(CITATION_BRACKET_RANGE_PATTERN, "")
    .replace(CITATION_BRACKET_GROUP_PATTERN, (full, inner) => (
      isNumericCitationContent(inner) ? "" : full
    ));
}

function tidySelectionWhitespace(input) {
  return String(input || "")
    .replace(/\s+([,.;:!?，。！？；：、])/gu, "$1")
    .replace(/([(\[（「『“"‘'])\s+/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function trimEdgePunctuation(input) {
  return input.replace(EDGE_PUNCTUATION_PATTERN, "");
}

function stripDictionaryNoiseFromToken(token) {
  return trimEdgePunctuation(
    stripNumericCitationMarkers(token.replace(REFERENCE_MARKER_PATTERN, "")),
  );
}

function normalizeSelectionInput(input) {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error("Selection text must be a non-empty string");
  }

  let normalized = canonicalizeSelectionText(input.slice(0, MAX_SELECTION_TEXT_LENGTH));
  // Strip [n] / [n,m] style reference markers before edge-punctuation cleanup.
  // Edge-only [] trimming is inconsistent: "text [1]" used to leave "text [1" because
  // digits break the trailing punctuation class.
  normalized = stripNumericCitationMarkers(normalized);
  normalized = compactWhitespace(normalized);
  normalized = trimEdgePunctuation(normalized);
  normalized = tidySelectionWhitespace(normalized);

  if (!normalized) {
    throw new Error("Selection text is empty after normalization");
  }
  return normalized;
}

function normalizeDictionaryQuery(input) {
  const normalized = normalizeSelectionInput(input);
  const dictionaryQuery = compactWhitespace(
    normalized
      .split(/\s+/)
      .map(stripDictionaryNoiseFromToken)
      .filter(Boolean)
      .join(" "),
  );
  if (!dictionaryQuery) {
    throw new Error("Selection text is empty after dictionary normalization");
  }
  return dictionaryQuery;
}

function looksLikeWordOrPhrase(input) {
  const normalized = normalizeSelectionInput(input);
  const dictionaryNormalized = normalizeDictionaryQuery(normalized);
  if (dictionaryNormalized.length > 80) {
    return {
      normalized: dictionaryNormalized,
      rawNormalized: normalized,
      isWordLike: false,
      reason: "too_long",
    };
  }
  if (/[\r\n]/.test(normalized)) {
    return {
      normalized: dictionaryNormalized,
      rawNormalized: normalized,
      isWordLike: false,
      reason: "contains_line_break",
    };
  }
  if (/[.!?。！？]/u.test(normalized)) {
    return {
      normalized: dictionaryNormalized,
      rawNormalized: normalized,
      isWordLike: false,
      reason: "contains_sentence_punctuation",
    };
  }
  if (/[,:;，：；、]/u.test(normalized)) {
    return {
      normalized: dictionaryNormalized,
      rawNormalized: normalized,
      isWordLike: false,
      reason: "contains_clause_punctuation",
    };
  }

  const tokens = dictionaryNormalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return {
      normalized: dictionaryNormalized,
      rawNormalized: normalized,
      isWordLike: false,
      reason: "empty",
    };
  }
  if (tokens.length > 6) {
    return {
      normalized: dictionaryNormalized,
      rawNormalized: normalized,
      isWordLike: false,
      reason: "too_many_tokens",
    };
  }

  const tokenPattern =
    /^[\p{L}\p{N}][\p{L}\p{N}.'’+\-/#&]*[\p{L}\p{N}]$|^[\p{L}\p{N}]$/u;
  const isWordLike = tokens.every((token) => tokenPattern.test(token));
  return {
    normalized: dictionaryNormalized,
    rawNormalized: normalized,
    isWordLike,
    reason: isWordLike ? "word_or_phrase" : "invalid_token_shape",
  };
}

function buildSelectionDebugInfo(text, candidate) {
  return {
    rawInputText: text,
    rawInputLength: typeof text === "string" ? text.length : 0,
    rawNormalizedText: candidate.rawNormalized,
    normalizedText: candidate.normalized,
    isWordLike: candidate.isWordLike,
    reason: candidate.reason,
  };
}

async function fetchBingDictionaryPage(query) {
  if (
    typeof window !== "undefined" &&
    window?.electronAPI?.fetchBingDictionaryPage
  ) {
    return window.electronAPI.fetchBingDictionaryPage(query);
  }

  const url = `https://cn.bing.com/dict/search?q=${encodeURIComponent(query)}`;
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: DEFAULT_HEADERS,
    redirect: "follow",
  }, BING_REQUEST_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`Failed to load Bing dictionary page: ${response.status}`);
  }

  return {
    url: response.url,
    html: await readResponseTextWithLimit(response, BING_HTML_RESPONSE_MAX_BYTES, "Bing dictionary page"),
  };
}

function parseDictionaryEntriesFromHtml(html) {
  const qdefMatch = html.match(/<div class="qdef">([\s\S]*?)<\/ul>/);
  const sourceHtml = qdefMatch?.[1] || html;
  if (!sourceHtml) {
    return null;
  }

  const headword =
    compactWhitespace(
      stripTags(
        sourceHtml.match(/<div class="hd_div"[^>]*>[\s\S]*?<strong>([\s\S]*?)<\/strong>/)?.[1] ||
          sourceHtml.match(/<div[^>]*class="[^"]*hd_div[^"]*"[\s\S]*?<strong>([\s\S]*?)<\/strong>/)?.[1] ||
          "",
      ),
    ) || null;

  const phonetics = {};
  const usMatch = sourceHtml.match(/<div class="hd_prUS b_primtxt">([\s\S]*?)<\/div>/)
    || sourceHtml.match(/<span[^>]*class="[^"]*hd_prUS[^"]*"[^>]*>([\s\S]*?)<\/span>/);
  const ukMatch = sourceHtml.match(/<div class="hd_pr b_primtxt">([\s\S]*?)<\/div>/)
    || sourceHtml.match(/<span[^>]*class="[^"]*hd_pr(?!US)[^"]*"[^>]*>([\s\S]*?)<\/span>/);
  if (usMatch) {
    phonetics.us = compactWhitespace(stripTags(usMatch[1])).replace(/^US\s*/i, "");
  }
  if (ukMatch) {
    phonetics.uk = compactWhitespace(stripTags(ukMatch[1])).replace(/^UK\s*/i, "");
  }

  let meanings = [...html.matchAll(
    /<li><span class="pos(?: web)?">([\s\S]*?)<\/span><span class="def b_regtxt"><span>([\s\S]*?)<\/span><\/span><\/li>/g,
  )].map((match) => ({
    pos: compactWhitespace(stripTags(match[1])),
    definition: compactWhitespace(stripTags(match[2])),
  }));

  if (!meanings.length) {
    meanings = [...sourceHtml.matchAll(
      /<span[^>]*class="[^"]*pos[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<span[^>]*class="[^"]*def[^"]*"[^>]*>\s*(?:<span>)?([\s\S]*?)(?:<\/span>)?\s*<\/span>/g,
    )].map((match) => ({
      pos: compactWhitespace(stripTags(match[1])),
      definition: compactWhitespace(stripTags(match[2])),
    }));
  }

  return {
    headword,
    phonetics,
    meanings: meanings.filter((meaning) => meaning.pos || meaning.definition),
  };
}

function parseDictionaryEntriesFromMetaDescription(html) {
  const description = decodeHtmlEntities(
    html.match(/<meta name="description" content="([^"]+)"/i)?.[1] || "",
  ).trim();
  if (
    !description
    || !/[释义美英网络]/u.test(description)
    || /^dictionary$/iu.test(description)
  ) {
    return null;
  }

  const headword =
    compactWhitespace(
      description.match(/为您提供(.+?)的释义/)?.[1]
      || html.match(/<title>(.*?)\s*-\s*(?:搜索|Search)\s*词典<\/title>/i)?.[1]
      || "",
    ) || null;

  const phonetics = {};
  const usMatch = description.match(/美(\[[^\]]+\]|[^，；]+)/);
  const ukMatch = description.match(/英(\[[^\]]+\]|[^，；]+)/);
  if (usMatch) {
    phonetics.us = compactWhitespace(usMatch[1]);
  }
  if (ukMatch) {
    phonetics.uk = compactWhitespace(ukMatch[1]);
  }

  const meanings = [];
  const meaningSection = compactWhitespace(
    description
      .replace(/^.*?释义[，,:：]\s*/u, "")
      .replace(/^(?:美[^，；]+[，,]\s*)?(?:英[^，；]+[，,]\s*)?/u, ""),
  );
  if (meaningSection) {
    const webSplitIndex = meaningSection.indexOf("网络释义");
    const lexicalSection = webSplitIndex >= 0
      ? meaningSection.slice(0, webSplitIndex)
      : meaningSection;
    const webSection = webSplitIndex >= 0
      ? meaningSection.slice(webSplitIndex)
      : "";

    for (const part of lexicalSection.split("；").map(compactWhitespace).filter(Boolean)) {
      const lexicalMatch = part.match(/^([A-Za-z]+(?:\.[A-Za-z]+)*\.)\s*(.+)$/);
      if (lexicalMatch) {
        meanings.push({
          pos: lexicalMatch[1],
          definition: compactWhitespace(lexicalMatch[2]),
        });
      }
      else if (part) {
        meanings.push({
          pos: "",
          definition: part,
        });
      }
    }

    const webMeaning = compactWhitespace(
      webSection
        .replace(/^网络释义[：:]\s*/u, "")
        .replace(/；+$/u, ""),
    );
    if (webMeaning) {
      meanings.push({
        pos: "Web",
        definition: webMeaning,
      });
    }
  }

  return {
    headword,
    phonetics,
    meanings: meanings.filter((meaning) => meaning.pos || meaning.definition),
  };
}

export {
  normalizeSelectionInput,
  stripNumericCitationMarkers,
  tidySelectionWhitespace,
};

export async function lookupWordOrPhrase(query) {
  const normalized = normalizeSelectionInput(query);
  const { html, url } = await fetchBingDictionaryPage(normalized);
  const parsedFromHtml = parseDictionaryEntriesFromHtml(html);
  const parsedFromMeta = parsedFromHtml?.meanings?.length
    ? null
    : parseDictionaryEntriesFromMetaDescription(html);
  const parsed = parsedFromHtml?.meanings?.length ? parsedFromHtml : parsedFromMeta;
  if (
    parsed?.meanings?.length === 1
    && compactWhitespace(parsed.meanings[0].definition).toLowerCase() === "dictionary"
  ) {
    return {
      type: "dictionary",
      query: normalized,
      found: false,
      url,
      headword: null,
      phonetics: {},
      meanings: [],
      debug: {
        source: "invalid-meta-fallback",
        hasQdef: html.includes('class="qdef"'),
        hasHdDiv: html.includes('class="hd_div"'),
        title:
          decodeHtmlEntities(
            html.match(/<title>(.*?)<\/title>/i)?.[1] || "",
          ) || "",
        metaDescription:
          decodeHtmlEntities(
            html.match(/<meta name="description" content="([^"]+)"/i)?.[1] || "",
          ) || "",
      },
    };
  }

  if (!parsed || parsed.meanings.length === 0) {
    return {
      type: "dictionary",
      query: normalized,
      found: false,
      url,
      headword: null,
      phonetics: {},
      meanings: [],
      debug: {
        source: "missing",
        hasQdef: html.includes('class="qdef"'),
        hasHdDiv: html.includes('class="hd_div"'),
        title:
          decodeHtmlEntities(
            html.match(/<title>(.*?)<\/title>/i)?.[1] || "",
          ) || "",
        metaDescription:
          decodeHtmlEntities(
            html.match(/<meta name="description" content="([^"]+)"/i)?.[1] || "",
          ) || "",
      },
    };
  }

  return {
    type: "dictionary",
    query: normalized,
    found: true,
    url,
    headword: parsed.headword,
    phonetics: parsed.phonetics,
    meanings: parsed.meanings,
    debug: {
      source: parsedFromHtml?.meanings?.length ? "html" : "meta",
    },
  };
}

async function postBingTranslate({ session, from, to, cleanedText }) {
  const body = new URLSearchParams({
    fromLang: from,
    to,
    text: cleanedText,
    token: session.token,
    key: session.key,
  });

  const endpoint = `${session.baseUrl}ttranslatev3?IG=${encodeURIComponent(session.ig)}&IID=${encodeURIComponent(session.iid)}`;
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: {
        ...DEFAULT_HEADERS,
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        accept: "application/json, text/javascript, */*; q=0.01",
        origin: "https://www.bing.com",
        referer: "https://www.bing.com/translator",
      },
      body,
    },
    BING_REQUEST_TIMEOUT_MS,
  );

  if (!response.ok) {
    const error = new Error(`Bing translate request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const result = await readJsonWithLimit(response, BING_JSON_RESPONSE_MAX_BYTES, "Bing translate JSON response");
  const translatedText = result?.[0]?.translations?.[0]?.text;
  if (!translatedText) {
    throw new Error(`Unexpected Bing response: ${JSON.stringify(result)}`);
  }

  return { translatedText, endpoint };
}

export async function translateWithBing({ text, from = "en", to = "zh-Hans" }) {
  let cleanedText;
  try {
    cleanedText = normalizeSelectionInput(text);
  }
  catch {
    cleanedText = normalizeText(text);
  }
  if (cleanedText.length > MAX_BING_TEXT_LENGTH) {
    cleanedText = cleanedText.slice(0, MAX_BING_TEXT_LENGTH);
  }

  let session = await getBingSession();
  try {
    const result = await postBingTranslate({ session, from, to, cleanedText });
    return {
      type: "translation",
      inputText: cleanedText,
      from,
      to,
      translatedText: result.translatedText,
      endpoint: result.endpoint,
    };
  }
  catch (error) {
    // Token/session often expires; refresh once and retry instead of hanging the UI.
    const status = Number(error?.status || 0);
    const message = String(error?.message || error || "");
    const shouldRefresh = status === 401 || status === 403 || status === 418
      || /token|key|abuse|unauthorized|forbidden|unexpected bing response/i.test(message);
    if (!shouldRefresh) {
      throw error;
    }
    clearBingSessionCache();
    session = await getBingSession({ forceRefresh: true });
    const result = await postBingTranslate({ session, from, to, cleanedText });
    return {
      type: "translation",
      inputText: cleanedText,
      from,
      to,
      translatedText: result.translatedText,
      endpoint: result.endpoint,
    };
  }
}

function extractClaudeText(responsePayload) {
	const blocks = Array.isArray(responsePayload?.content) ? responsePayload.content : [];
	const text = blocks
    .filter((block) => block?.type === "text" && typeof block?.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!text) {
    throw new Error(`Unexpected Claude response: ${JSON.stringify(responsePayload)}`);
  }
	return text;
}

function extractOpenAIContentText(value) {
	if (typeof value === "string") return value.trim();
	if (!Array.isArray(value)) return "";
	return value
		.map((part) => {
			if (typeof part === "string") return part;
			if (!part || typeof part !== "object") return "";
			if (typeof part.text === "string") return part.text;
			if (typeof part.text?.value === "string") return part.text.value;
			if (typeof part.content === "string") return part.content;
			return "";
		})
		.join("")
		.trim();
}

function extractOpenAIStreamDelta(value) {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.map((part) => {
			if (typeof part === "string") return part;
			if (!part || typeof part !== "object") return "";
			return typeof part.text === "string" ? part.text : "";
		})
		.join("");
}

function extractOpenAIChatText(responsePayload) {
	const choice = responsePayload?.choices?.[0] || {};
	const text = extractOpenAIContentText(choice?.message?.content)
		|| extractOpenAIContentText(choice?.delta?.content)
		|| extractOpenAIContentText(responsePayload?.output_text);
	if (!text) {
		throw new Error(`Unexpected OpenAI response: ${JSON.stringify(responsePayload)}`);
	}
	return text;
}

function extractOpenAIResponsesText(responsePayload) {
	const directText = extractOpenAIContentText(responsePayload?.output_text);
	if (directText) return directText;

	const outputText = (Array.isArray(responsePayload?.output) ? responsePayload.output : [])
		.map((item) => extractOpenAIContentText(item?.content))
		.filter(Boolean)
		.join("\n")
		.trim();
	if (outputText) return outputText;

	if (Array.isArray(responsePayload?.choices)) {
		return extractOpenAIChatText(responsePayload);
	}
	if (String(responsePayload?.status || "").toLowerCase() === "incomplete") {
		const reason = String(responsePayload?.incomplete_details?.reason || "").trim();
		throw new Error(`OpenAI Responses translation ended before producing text${reason ? ` (${reason})` : ""}.`);
	}
	throw new Error(`Unexpected OpenAI Responses response: ${JSON.stringify(responsePayload)}`);
}

function normalizeBaseUrl(baseUrl) {
  const raw = typeof baseUrl === "string" ? baseUrl.trim() : "";
  if (!raw) {
    throw new Error("LLM Base URL is not configured. Configure the third-party API or start CC Switch.");
  }
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported LLM base URL protocol: ${parsed.protocol}`);
  }
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function buildLlmEndpoint(baseUrl, suffix) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (new RegExp(`${suffix.replace(/\//g, "\\/")}$`, "i").test(normalized)) {
    return normalized;
  }
  if (/\/v1$/i.test(normalized)) {
    return `${normalized}${suffix.replace(/^\/v1/i, "")}`;
  }
  return `${normalized}${suffix}`;
}

function stringifyRemoteError(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (typeof value !== "object") return String(value);
  const candidates = [
    value.message,
    value.error,
    value.detail,
    value.details,
    value.error?.message,
    value.error?.type,
    value.error?.code,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === "string") return candidate;
    try {
      return JSON.stringify(candidate);
    } catch {
      return String(candidate);
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolveLlmApiKind({ model = "", providerId = "" } = {}) {
  const normalizedProvider = String(providerId || "").trim().toLowerCase();
  if (normalizedProvider === "codex" || normalizedProvider === "openai") return "openai";
  if (normalizedProvider === "claude" || normalizedProvider === "anthropic") return "anthropic";
  const normalizedModel = String(model || "").trim().toLowerCase();
  if (/^(gpt|o\d|chatgpt|codex|openai)/i.test(normalizedModel)) return "openai";
  return "anthropic";
}

function normalizeOpenAIWireApi(value) {
	return String(value || "").trim().toLowerCase() === "responses" ? "responses" : "chat-completions";
}

function resolveSelectionTranslationEffort(_value = SELECTION_TRANSLATION_EFFORT) {
	// Selection translation never inherits sidebar effort; always force low.
	return SELECTION_TRANSLATION_EFFORT;
}

function resolveClaudeSelectionEffort(value = SELECTION_TRANSLATION_EFFORT) {
	// Claude Messages / SDK style: low | medium | high | max — selection always low.
	return resolveSelectionTranslationEffort(value);
}

async function translateWithAnthropicMessages({
  text,
  from = "en",
  to = "zh-Hans",
  baseUrl = "",
  clientKey = "",
  model = DEFAULT_SELECTION_LLM_MODEL,
  onDelta = null,
  effort = SELECTION_TRANSLATION_EFFORT,
} = {}) {
  const normalizedText = normalizeSelectionInput(text);
	const stream = typeof onDelta === "function";
  const headers = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (clientKey) {
    headers.Authorization = `Bearer ${clientKey}`;
  }
  const claudeEffort = resolveClaudeSelectionEffort(effort);
  const response = await fetchWithTimeout(buildLlmEndpoint(baseUrl, "/v1/messages"), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: model || DEFAULT_SELECTION_LLM_MODEL,
      max_tokens: 512,
		stream,
      // Force low thinking/effort for selection translation relays that honor it.
      output_config: { effort: claudeEffort },
      messages: [
        {
          role: "user",
          content:
            `You are a translation engine.\n` +
            `Translate the selected text from ${from} to ${to}.\n` +
            `Keep technical terms accurate.\n` +
            `Return only the translated text without explanation, notes, or markdown.\n\n` +
            `Selected text:\n${normalizedText}`,
        },
      ],
    }),
  }, LLM_REQUEST_TIMEOUT_MS);

  const payload = await (stream
	? readAnthropicMessagesPayload(response, { onDelta })
	: readJsonWithLimit(response, LLM_JSON_RESPONSE_MAX_BYTES, "Anthropic translate JSON response")
  ).catch(() => null);
  if (!response.ok) {
    throw new Error(stringifyRemoteError(payload?.error || payload) || `Anthropic translate request failed: ${response.status}`);
  }
  return {
    translatedText: extractClaudeText(payload),
    raw: payload,
    apiKind: "anthropic",
  };
}

async function translateWithOpenAIChatCompletions({
  text,
  from = "en",
  to = "zh-Hans",
  baseUrl = "",
  clientKey = "",
  model = DEFAULT_SELECTION_LLM_MODEL,
  onDelta = null,
  effort = SELECTION_TRANSLATION_EFFORT,
} = {}) {
  const normalizedText = normalizeSelectionInput(text);
	const stream = typeof onDelta === "function";
  const headers = {
    "content-type": "application/json",
  };
  if (clientKey) {
    headers.Authorization = `Bearer ${clientKey}`;
  }
  const normalizedEffort = resolveSelectionTranslationEffort(effort);
  const response = await fetchWithTimeout(buildLlmEndpoint(baseUrl, "/v1/chat/completions"), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: model || DEFAULT_SELECTION_LLM_MODEL,
      temperature: 0,
		stream,
      // Codex / OpenAI-compatible gateways commonly read top-level reasoning_effort.
      reasoning_effort: normalizedEffort,
      messages: [
        {
          role: "system",
          content: "You are a translation engine. Return only the translated text without explanation, notes, or markdown.",
        },
        {
          role: "user",
          content:
            `Translate the selected text from ${from} to ${to}.\n` +
            `Keep technical terms accurate.\n\n` +
            `Selected text:\n${normalizedText}`,
        },
      ],
    }),
  }, LLM_REQUEST_TIMEOUT_MS);

  const payload = await (stream
	? readOpenAIChatPayload(response, { onDelta })
	: readJsonWithLimit(response, LLM_JSON_RESPONSE_MAX_BYTES, "OpenAI translate JSON response")
  ).catch(() => null);
  if (!response.ok) {
    throw new Error(stringifyRemoteError(payload?.error || payload) || `OpenAI translate request failed: ${response.status}`);
  }
  return {
    translatedText: extractOpenAIChatText(payload),
    raw: payload,
    apiKind: "openai",
	};
}

async function translateWithOpenAIResponses({
	text,
	from = "en",
	to = "zh-Hans",
	baseUrl = "",
	clientKey = "",
	model = DEFAULT_SELECTION_LLM_MODEL,
	onDelta = null,
	effort = SELECTION_TRANSLATION_EFFORT,
} = {}) {
	const normalizedText = normalizeSelectionInput(text);
	const headers = {
		"content-type": "application/json",
	};
	if (clientKey) {
		headers.Authorization = `Bearer ${clientKey}`;
	}
	const normalizedEffort = resolveSelectionTranslationEffort(effort);
	const response = await fetchWithTimeout(buildLlmEndpoint(baseUrl, "/v1/responses"), {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: model || DEFAULT_SELECTION_LLM_MODEL,
			instructions: "You are a translation engine. Return only the translated text without explanation, notes, or markdown.",
			input: [{
				role: "user",
				content: [{
					type: "input_text",
					text:
						`Translate the selected text from ${from} to ${to}.\n` +
						`Keep technical terms accurate.\n\n` +
						`Selected text:\n${normalizedText}`,
				}],
			}],
			max_output_tokens: RESPONSES_SELECTION_MAX_OUTPUT_TOKENS,
			reasoning: { effort: normalizedEffort },
			store: false,
			stream: true,
		}),
	}, LLM_REQUEST_TIMEOUT_MS);

	const payload = await readOpenAIResponsesPayload(response, { onDelta }).catch(() => null);
	if (!response.ok) {
		throw new Error(stringifyRemoteError(payload?.error || payload) || `OpenAI Responses translate request failed: ${response.status}`);
	}
	return {
		translatedText: extractOpenAIResponsesText(payload),
		raw: payload,
		apiKind: "openai-responses",
	};
}

export async function translateWithRelayLLM({
  text,
  from = "en",
  to = "zh-Hans",
  baseUrl = "",
  clientKey = "",
	model = DEFAULT_SELECTION_LLM_MODEL,
	providerId = "",
	wireApi = "",
	allowEmptyApiKey = false,
	routeSource = "",
	onDelta = null,
	// Selection translation always forces low effort (ignores any caller override).
	effort = SELECTION_TRANSLATION_EFFORT,
} = {}) {
  const normalizedText = normalizeSelectionInput(text);
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedClientKey = typeof clientKey === "string" ? clientKey.trim() : "";
  const normalizedEffort = resolveSelectionTranslationEffort(effort);
  if (!normalizedClientKey && !allowEmptyApiKey) {
    throw new Error("LLM selection translation is missing an API key. Configure the third-party API before using this provider.");
  }

	const apiKind = resolveLlmApiKind({ model, providerId });
	const result = apiKind === "openai"
		? normalizeOpenAIWireApi(wireApi) === "responses"
			? await translateWithOpenAIResponses({ text: normalizedText, from, to, baseUrl: normalizedBaseUrl, clientKey: normalizedClientKey, model, onDelta, effort: normalizedEffort })
			: await translateWithOpenAIChatCompletions({ text: normalizedText, from, to, baseUrl: normalizedBaseUrl, clientKey: normalizedClientKey, model, onDelta, effort: normalizedEffort })
		: await translateWithAnthropicMessages({ text: normalizedText, from, to, baseUrl: normalizedBaseUrl, clientKey: normalizedClientKey, model, onDelta, effort: normalizedEffort });

  return {
    type: "translation",
    inputText: normalizedText,
    from,
    to,
    translatedText: result.translatedText,
    model: model || DEFAULT_SELECTION_LLM_MODEL,
    provider: "llm",
    apiKind: result.apiKind,
    effort: normalizedEffort,
    baseUrl: normalizedBaseUrl,
		routeSource: String(routeSource || "").trim(),
  };
}

/**
 * Selection translation has two fully separate engines:
 * - provider=llm  → configured LLM endpoint (never Bing session/dict)
 * - provider=bing → Bing dictionary (word-like) then Bing MT (never LLM)
 *
 * Previous bug: LLM mode still required !isWordLike, so short selections fell
 * through to Bing dictionary/MT and timed out when Bing was slow/blocked.
 */
export function resolveSelectionLookupPlan({
  provider = "bing",
  isWordLike = false,
} = {}) {
  const normalizedProvider = provider === "llm" ? "llm" : "bing";
  if (normalizedProvider === "llm") {
    return {
      provider: "llm",
      engine: "llm",
      tryDictionary: false,
      isWordLike: isWordLike === true,
    };
  }
  return {
    provider: "bing",
    engine: "bing",
    tryDictionary: isWordLike === true,
    isWordLike: isWordLike === true,
  };
}

export async function lookupSelection({
  text,
  from = "en",
  to = "zh-Hans",
  provider = "bing",
  llmBaseUrl = "",
  llmClientKey = "",
	llmModel = DEFAULT_SELECTION_LLM_MODEL,
	llmProviderId = "",
	llmWireApi = "",
	llmAllowEmptyApiKey = false,
	llmRouteSource = "",
	onDelta = null,
} = {}) {
  const candidate = looksLikeWordOrPhrase(text);
  const sentenceText = candidate.rawNormalized || candidate.normalized;
  const plan = resolveSelectionLookupPlan({
    provider,
    isWordLike: candidate.isWordLike,
  });
  const debug = {
    ...buildSelectionDebugInfo(text, candidate),
    plan,
  };

  // ---- LLM path: never touch Bing (dict or MT) ----
  if (plan.engine === "llm") {
    const translationResult = await translateWithRelayLLM({
      text: sentenceText,
      from,
      to,
      baseUrl: llmBaseUrl,
      clientKey: llmClientKey,
      model: llmModel,
      providerId: llmProviderId,
		wireApi: llmWireApi,
		allowEmptyApiKey: llmAllowEmptyApiKey === true,
		routeSource: llmRouteSource,
		onDelta,
    });
    return {
      ...translationResult,
      mode: "translation",
      normalizedText: sentenceText,
      debug: {
        ...debug,
        provider: "llm",
			engine: "llm",
			model: llmModel || DEFAULT_SELECTION_LLM_MODEL,
			routeSource: String(llmRouteSource || "").trim(),
		},
    };
  }

  // ---- Bing path: optional dictionary, then Bing MT ----
  if (plan.tryDictionary) {
    try {
      const dictionaryResult = await lookupWordOrPhrase(candidate.normalized);
      if (dictionaryResult.found) {
        return {
          ...dictionaryResult,
          mode: "dictionary",
          normalizedText: candidate.normalized,
          debug: {
            ...debug,
            provider: "bing",
            engine: "bing-dictionary",
            dictionaryFound: true,
            dictionaryDebug: dictionaryResult.debug || null,
          },
        };
      }
      debug.dictionaryFound = false;
      debug.dictionaryDebug = dictionaryResult.debug || null;
    }
    catch (error) {
      // Dictionary is best-effort. Network/blocks should fall through to Bing MT
      // instead of failing the whole selection lookup.
      debug.dictionaryFound = false;
      debug.dictionaryError = error instanceof Error ? error.message : String(error);
    }
  }

  const translationResult = await translateWithBing({
    text: sentenceText,
    from,
    to,
  });
  return {
    ...translationResult,
    provider: "bing",
    mode: "translation",
    normalizedText: sentenceText,
    debug: {
      ...debug,
      provider: "bing",
      engine: "bing-translate",
    },
  };
}

async function runSmokeTests() {
  const testCases = [
    { from: "en", to: "zh-Hans", text: "hello world" },
    {
      from: "en",
      to: "zh-Hans",
      text: "Large language models are useful for document translation.",
    },
    { from: "zh-Hans", to: "en", text: "今天天气不错，适合出去散步。" },
  ];

  const results = [];
  for (const testCase of testCases) {
    const startedAt = Date.now();
    try {
      const result = await translateWithBing(testCase);
      results.push({
        ...testCase,
        ok: true,
        translatedText: result.translatedText,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (error) {
      results.push({
        ...testCase,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - startedAt,
      });
    }
  }

  return results;
}

function buildLoadCase(index) {
  return {
    from: index % 2 === 0 ? "en" : "zh-Hans",
    to: index % 2 === 0 ? "zh-Hans" : "en",
    text:
      index % 2 === 0
        ? `Load test sample ${index + 1}: This repository forwards the Bing option to pdf2zh.`
        : `压测样例 ${index + 1}：请把这句话翻译成自然的英文。`,
  };
}

async function runLoadBatch({ requests, concurrency }) {
  const jobs = Array.from({ length: requests }, (_, index) => buildLoadCase(index));
  const results = [];
  let nextIndex = 0;

  async function worker(workerId) {
    for (;;) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= jobs.length) {
        return;
      }

      const job = jobs[currentIndex];
      const startedAt = Date.now();
      try {
        const result = await translateWithBing(job);
        results.push({
          index: currentIndex,
          workerId,
          ok: true,
          elapsedMs: Date.now() - startedAt,
          from: job.from,
          to: job.to,
          translatedText: result.translatedText,
        });
      } catch (error) {
        results.push({
          index: currentIndex,
          workerId,
          ok: false,
          elapsedMs: Date.now() - startedAt,
          from: job.from,
          to: job.to,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const actualConcurrency = Math.max(1, Math.min(concurrency, requests));
  await Promise.all(
    Array.from({ length: actualConcurrency }, (_, workerId) => worker(workerId)),
  );

  results.sort((a, b) => a.index - b.index);
  const failures = results.filter((item) => !item.ok);
  const successes = results.filter((item) => item.ok);
  const totalElapsedMs = results.reduce((sum, item) => sum + item.elapsedMs, 0);
  const avgElapsedMs = results.length > 0 ? Math.round(totalElapsedMs / results.length) : 0;
  const errorCounts = Object.create(null);
  for (const failure of failures) {
    errorCounts[failure.error] = (errorCounts[failure.error] || 0) + 1;
  }

  return {
    requests,
    concurrency: actualConcurrency,
    successCount: successes.length,
    failureCount: failures.length,
    successRate: results.length > 0 ? Number((successes.length / results.length).toFixed(4)) : 0,
    avgElapsedMs,
    errors: errorCounts,
    sampleSuccesses: successes.slice(0, 3).map((item) => ({
      index: item.index,
      translatedText: item.translatedText,
    })),
    sampleFailures: failures.slice(0, 3),
  };
}

async function runStagedLoadTest(baseRequests, maxConcurrency) {
  const stagePlan = [1, 2, 4, 8, 12].filter((value) => value <= maxConcurrency);
  if (stagePlan.length === 0) {
    stagePlan.push(Math.max(1, maxConcurrency));
  }

  const stages = [];
  for (const concurrency of stagePlan) {
    const requests = Math.max(baseRequests, concurrency * 3);
    const summary = await runLoadBatch({ requests, concurrency });
    stages.push(summary);

    // Stop early if the endpoint starts failing noticeably.
    if (summary.failureCount > 0 && summary.successRate < 0.8) {
      break;
    }
  }

  return stages;
}

export async function runSelectionTranslationCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.test) {
    const results = await runSmokeTests();
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (options.loadTest) {
    const results = await runStagedLoadTest(options.requests, options.concurrency);
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (!options.text) {
    printHelp();
    process.exit(1);
  }

  const result =
    options.mode === "selection"
      ? await lookupSelection(options)
      : await translateWithBing(options);
  console.log(
    JSON.stringify(
      result.type === "dictionary"
        ? result
        : {
            ...result,
            endpoint: result.endpoint || "",
          },
      null,
      2,
    ),
  );
}

const isMainModule =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  !!process.argv[1] &&
  typeof window === "undefined" &&
  import.meta.url.split("/").pop() === process.argv[1].replace(/\\/g, "/").split("/").pop();

if (isMainModule) {
  runSelectionTranslationCli().catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exit(1);
  });
}
