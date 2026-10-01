const NWU_SEARCH_ENDPOINT = "https://www.nwu.ac.za/multisite-search";
const SEARCH_HTML_LIMIT = 600_000;
const DOCUMENT_HTML_LIMIT = 750_000;
const PDF_BYTE_LIMIT = 5 * 1024 * 1024;
const MAX_RESULTS = 20;
const MAX_ROOT_PAGES = 2;
const MAX_LINKED_PDFS = 1;
const MAX_SOURCES = 3;
const MAX_EXCERPT_CHARS = 3_200;
const REQUEST_TIMEOUT_MS = 7_000;

const BLOCKED_HOSTS = new Set([
  "efundi.nwu.ac.za",
  "intranet.nwu.ac.za",
  "diyservices.nwu.ac.za",
  "webmail.nwu.ac.za",
  "sso.nwu.ac.za",
  "login.nwu.ac.za"
]);

const STOP_WORDS = new Set([
  "a", "an", "the", "for", "who", "what", "why", "how", "can", "could", "would",
  "please", "help", "me", "explain", "tell", "understand", "about", "does", "do", "is",
  "are", "was", "were", "to", "of", "and", "or", "in", "on", "at", "by", "with",
  "from", "using", "use", "be", "it", "this", "that", "these", "those", "my", "your",
  "our", "their", "i", "we", "you", "them", "they", "give", "show", "please"
]);

const SOURCE_PAGE_SEEDS = [
  {
    name: "NWU Academic Policies",
    url: "https://www.nwu.ac.za/governance-and-management/academic-policies",
    matches: /academic integrity|academic rules|student discipline|admission policy|assessment policy|senate rules|artificial intelligence|\bai policy\b|plagiar|nwu polic/i
  },
  {
    name: "NWU Library Research Policies",
    url: "https://library.nwu.ac.za/research-policies",
    matches: /research data|open science|open access|research polic|research integrity|thesis|dissertation|scholarship/i
  },
  {
    name: "NWU Library Support Guides",
    url: "https://library.nwu.ac.za/support-guides",
    matches: /citation|referenc|library support|research guide|database search|literature review/i
  }
];

export function buildNwuSearchQuery(question = "") {
  const original = String(question).normalize("NFKC");
  const words = original.match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) || [];
  const seen = new Set();
  const selected = [];
  for (const word of words) {
    const normalized = word.toLowerCase();
    if ((normalized.length < 3 && normalized !== "ai") || STOP_WORDS.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    selected.push(word);
    if (selected.length >= 16) break;
  }
  return (selected.join(" ") || original.replace(/[\r\n\t]+/g, " ").trim()).slice(0, 120);
}

export function isPublicNwuUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
    const host = url.hostname.toLowerCase();
    const officialHost = host === "nwu.ac.za" || host.endsWith(".nwu.ac.za");
    const privateHost = [...BLOCKED_HOSTS].some(blocked => host === blocked || host.endsWith(`.${blocked}`));
    return officialHost && !privateHost;
  } catch {
    return false;
  }
}

export function normalizePublicNwuUrl(value, baseUrl = NWU_SEARCH_ENDPOINT) {
  try {
    const url = new URL(decodeHtmlEntities(String(value || "").trim()), baseUrl);
    if (url.protocol === "http:") url.protocol = "https:";
    if (!isPublicNwuUrl(url.href)) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function stripHtml(value = "") {
  const cleaned = String(value)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|tr|div|section|article|blockquote|header|footer)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(cleaned).replace(/[\t\f\v ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function parseNwuSearchResults(markup = "", baseUrl = NWU_SEARCH_ENDPOINT) {
  const html = String(markup).slice(0, SEARCH_HTML_LIMIT);
  const starts = [...html.matchAll(/<div\b[^>]*class=["'][^"']*\bsearch-scr\b[^"']*["'][^>]*>/gi)];
  const output = [];
  for (let i = 0; i < starts.length && output.length < MAX_RESULTS; i++) {
    const start = starts[i].index;
    const end = starts[i + 1]?.index ?? Math.min(html.length, start + 10_000);
    const row = html.slice(start, end);
    const titleMatch = row.match(/<h3\b[^>]*class=["'][^"']*\bsearch-h3\b[^"']*["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h3>/i);
    if (!titleMatch) continue;
    const url = normalizePublicNwuUrl(titleMatch[1], baseUrl);
    const name = stripHtml(titleMatch[2]).slice(0, 180);
    if (!url || !name) continue;
    const dateMatch = row.match(/<span\b[^>]*class=["'][^"']*\bdate-src\b[^"']*["'][^>]*>\s*<i>([\s\S]*?)<\/i>/i);
    const snippetMatch = row.match(/<span\b[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    output.push({
      name,
      url,
      date: dateMatch ? stripHtml(dateMatch[1]).slice(0, 40) : "",
      snippet: snippetMatch ? stripHtml(snippetMatch[1]).slice(0, 900) : "",
      source: "search"
    });
  }
  return output;
}

export function extractPublicPdfLinks(markup = "", baseUrl = NWU_SEARCH_ENDPOINT) {
  const html = String(markup).slice(0, DOCUMENT_HTML_LIMIT);
  const anchors = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  const output = [];
  const seen = new Set();
  let match;
  while ((match = anchors.exec(html)) && output.length < 50) {
    const url = normalizePublicNwuUrl(match[2], baseUrl);
    if (!url || !/\.pdf(?:$|[?#])/i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const name = stripHtml(match[3]).slice(0, 180) || url.split("/").pop()?.slice(0, 100) || "NWU document";
    const nearby = html.slice(Math.max(0, match.index - 180), Math.min(html.length, anchors.lastIndex + 420));
    output.push({ name, url, date: "", snippet: stripHtml(nearby).slice(0, 700), source: "linked-pdf" });
  }
  return output;
}

export function rankNwuSources(question, candidates = []) {
  const terms = queryTerms(question);
  const seen = new Set();
  return candidates
    .map((candidate, index) => {
      const name = String(candidate.name || "").toLowerCase();
      const url = String(candidate.url || "").toLowerCase();
      const snippet = String(candidate.snippet || "").toLowerCase();
      let score = Number(candidate.score) || 0;
      for (const term of terms) {
        if (name.includes(term)) score += 4;
        if (url.includes(term)) score += 2;
        if (snippet.includes(term)) score += 1;
      }
      if (/\.pdf(?:$|[?#])/i.test(url)) score += 0.5;
      return { ...candidate, score, originalIndex: index };
    })
    .filter(candidate => {
      if (!candidate.url || candidate.score <= 0 || seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    })
    .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);
}

export async function searchNwuLiveSources(question, options = {}) {
  const fetcher = options.fetcher || globalThis.fetch;
  const pdfParser = options.pdfParser;
  const searchQuery = buildNwuSearchQuery(question);
  const searchUrl = `${NWU_SEARCH_ENDPOINT}?search_api_fulltext=${encodeURIComponent(searchQuery)}`;
  if (!searchQuery || typeof fetcher !== "function") return { searchUrl, sources: [] };

  let searchResults = [];
  try {
    const result = await fetchNwuResponse(searchUrl, fetcher);
    if (result) {
      const markup = (await result.response.text()).slice(0, SEARCH_HTML_LIMIT);
      searchResults = parseNwuSearchResults(markup, result.url);
    }
  } catch {
    // Public search is best-effort; saved and uploaded material can still answer the question.
  }

  const seeds = SOURCE_PAGE_SEEDS
    .filter(seed => seed.matches.test(String(question)))
    .map(seed => {
      const listing = searchResults.find(result => result.url === seed.url);
      return { ...seed, snippet: listing?.snippet || "", date: listing?.date || "", source: "curated-public-entry", score: 24 };
    });
  const roots = rankNwuSources(question, [...seeds, ...searchResults]).slice(0, MAX_ROOT_PAGES);
  const fetchedRoots = await Promise.all(roots.map(candidate => fetchNwuDocument(candidate, fetcher, pdfParser, MAX_EXCERPT_CHARS, false, question)));
  const rootSources = fetchedRoots.filter(Boolean);

  const linkedPdfs = rankNwuSources(
    question,
    rootSources.flatMap(source => source.pdfLinks || [])
  ).slice(0, MAX_LINKED_PDFS);
  const fetchedPdfs = await Promise.all(linkedPdfs.map(candidate => fetchNwuDocument(candidate, fetcher, pdfParser, MAX_EXCERPT_CHARS, false, question)));

  const allSources = [...fetchedPdfs.filter(Boolean), ...rootSources]
    .filter(source => source.content)
    .sort((a, b) => b.score - a.score || (a.kind === "pdf" ? -1 : 1));
  const seen = new Set();
  const sources = [];
  for (const source of allSources) {
    if (seen.has(source.url)) continue;
    seen.add(source.url);
    sources.push({
      name: source.name,
      url: source.url,
      date: source.date || "",
      type: "nwu_official_live",
      content: source.content
    });
    if (sources.length >= MAX_SOURCES) break;
  }
  return { searchUrl, sources };
}

export async function fetchNwuPublicDocument(value, options = {}) {
  const fetcher = options.fetcher || globalThis.fetch;
  const pdfParser = options.pdfParser;
  const maxChars = Math.min(Math.max(Number(options.maxChars) || MAX_EXCERPT_CHARS, 100), 120_000);
  const url = normalizePublicNwuUrl(value);
  if (!url || typeof fetcher !== "function") return null;
  const candidate = { name: url.split("/").pop()?.replace(/\.pdf$/i, "") || "NWU public document", url, snippet: "", date: "", score: 1 };
  return fetchNwuDocument(candidate, fetcher, pdfParser, maxChars, Boolean(options.fullText), options.relevanceQuery || candidate.name);
}

async function fetchNwuDocument(candidate, fetcher, pdfParser, maxChars = MAX_EXCERPT_CHARS, fullText = false, relevanceQuery = candidate.name || "") {
  try {
    const initialUrl = normalizePublicNwuUrl(candidate.url);
    if (!initialUrl) return null;
    const result = await fetchNwuResponse(initialUrl, fetcher);
    if (!result) return null;
    const response = result.response;
    const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
    const isPdf = /\.pdf(?:$|[?#])/i.test(result.url) || contentType.includes("application/pdf");
    let rawHtml = "";
    let text = "";
    let kind = "page";
    let links = [];

    if (isPdf) {
      if (typeof pdfParser !== "function") return null;
      const declaredSize = Number(response.headers?.get?.("content-length") || 0);
      if (declaredSize > PDF_BYTE_LIMIT) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > PDF_BYTE_LIMIT) return null;
      const parsed = await pdfParser(bytes);
      text = String(parsed?.text || "");
      kind = "pdf";
    } else {
      if (contentType && !contentType.includes("text/html") && !contentType.includes("text/plain")) return null;
      rawHtml = (await response.text()).slice(0, DOCUMENT_HTML_LIMIT);
      text = contentType.includes("text/plain") ? rawHtml : stripHtml(rawHtml);
      links = extractPublicPdfLinks(rawHtml, result.url);
    }

    const completeText = `${candidate.snippet || ""}\n${text}`.replace(/\u0000/g, " ").trim();
    const content = fullText ? completeText.slice(0, maxChars) : relevantExcerpt(completeText, relevanceQuery, maxChars);
    if (content.length < 40) return null;
    return {
      name: String(candidate.name || "NWU public source").slice(0, 180),
      url: result.url,
      date: String(candidate.date || "").slice(0, 40),
      content,
      pdfLinks: links,
      kind,
      score: Number(candidate.score) || 0
    };
  } catch {
    return null;
  }
}

async function fetchNwuResponse(value, fetcher) {
  let url = normalizePublicNwuUrl(value);
  if (!url) return null;
  for (let redirectCount = 0; redirectCount <= 2; redirectCount++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetcher(url, {
        redirect: "manual",
        headers: { Accept: "text/html, text/plain, application/pdf;q=0.9", "User-Agent": "TMJ-AI-Agent/1.0" },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get?.("location");
      if (!location) return null;
      url = normalizePublicNwuUrl(new URL(location, url).href);
      if (!url) return null;
      continue;
    }
    if (!response.ok) return null;
    const finalUrl = normalizePublicNwuUrl(response.url || url);
    if (!finalUrl) return null;
    return { response, url: finalUrl };
  }
  return null;
}

function relevantExcerpt(text, question, maxChars) {
  const clean = String(text || "").replace(/\u0000/g, " ").replace(/[\t\f\v ]+/g, " ").replace(/ *\n */g, "\n").trim();
  if (clean.length <= maxChars) return clean;
  const terms = queryTerms(question);
  const lines = clean.split(/\n+/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2 || !terms.length) return clean.slice(0, maxChars);
  const scored = lines.map((line, index) => {
    const lower = line.toLowerCase();
    const score = terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
    return { index, score };
  }).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return clean.slice(0, maxChars);
  const chosen = new Set();
  for (const entry of scored) {
    for (let index = Math.max(0, entry.index - 1); index <= Math.min(lines.length - 1, entry.index + 1); index++) chosen.add(index);
    if ([...chosen].reduce((total, index) => total + lines[index].length + 1, 0) >= maxChars) break;
  }
  let output = "";
  for (const index of [...chosen].sort((a, b) => a - b)) {
    const addition = `${output ? "\n" : ""}${lines[index]}`;
    if (output.length + addition.length > maxChars) {
      output += addition.slice(0, maxChars - output.length);
      break;
    }
    output += addition;
  }
  return output || clean.slice(0, maxChars);
}

function queryTerms(value) {
  const words = String(value || "").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) || [];
  return [...new Set(words.filter(word => (word.length >= 3 || word === "ai") && !STOP_WORDS.has(word)))].slice(0, 16);
}

function decodeHtmlEntities(value) {
  const named = { nbsp: " ", amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–" };
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|quot|apos|lt|gt|rsquo|lsquo|rdquo|ldquo|mdash|ndash);/gi, (entity, code) => {
    if (code[0] !== "#") return named[code.toLowerCase()] ?? entity;
    const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    try { return Number.isFinite(point) ? String.fromCodePoint(point) : entity; } catch { return entity; }
  });
}
