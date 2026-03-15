import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

type SearchResult = {
  title: string;
  url: string;
  snippet?: string;
};

type FetchResult = {
  url: string;
  finalUrl: string;
  status: number;
  title?: string;
  text: string;
  links: string[];
};

function configuredSearchProviders() {
  return {
    tavily: !!process.env.TAVILY_API_KEY,
    brave: !!process.env.BRAVE_SEARCH_API_KEY,
  };
}

function normalizeUrl(input: string): string {
  const value = input.trim();
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(candidate);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Only http/https URLs are supported: ${input}`);
  }
  return url.toString();
}

function canonicalizeUrl(input: string): string {
  const u = new URL(input);
  u.hash = "";
  return u.toString();
}

function makeSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  if (timeoutMs <= 0) return signal ?? AbortSignal.timeout(60000);
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  return AbortSignal.any([signal, timeout]);
}

function extractReadable(html: string, url: string): { title?: string; text: string; links: string[] } {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const parsed = reader.parse();

  const title = parsed?.title || dom.window.document.title || undefined;
  const rawText =
    parsed?.textContent ||
    dom.window.document.body?.textContent ||
    dom.window.document.documentElement?.textContent ||
    "";

  const text = rawText
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const links = Array.from(dom.window.document.querySelectorAll("a[href]"))
    .map((el) => el.getAttribute("href") || "")
    .filter(Boolean)
    .map((href) => {
      try {
        return new URL(href, url).toString();
      } catch {
        return "";
      }
    })
    .filter((href) => href.startsWith("http://") || href.startsWith("https://"));

  return { title, text, links };
}

async function fetchPage(url: string, signal: AbortSignal, timeoutMs = 20000): Promise<FetchResult> {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
    },
    signal: makeSignal(signal, timeoutMs),
  });

  const finalUrl = res.url || url;
  const body = await res.text();
  const parsed = extractReadable(body, finalUrl);

  return {
    url,
    finalUrl,
    status: res.status,
    title: parsed.title,
    text: parsed.text,
    links: parsed.links,
  };
}

async function maybeTruncate(text: string) {
  const truncation = truncateHead(text, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });

  if (!truncation.truncated) {
    return {
      text: truncation.content,
      truncated: false,
    };
  }

  const tempPath = path.join(os.tmpdir(), `pi-web-access-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  await writeFile(tempPath, text, "utf8");

  let message = truncation.content;
  message += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`;
  message += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
  message += ` Full output saved to: ${tempPath}]`;

  return {
    text: message,
    truncated: true,
    tempPath,
    truncation,
  };
}

function short(text: string, maxChars: number) {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

async function tavilySearch(query: string, maxResults: number, signal: AbortSignal): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not set.");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "advanced",
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (!res.ok) throw new Error(`Tavily search failed (${res.status}): ${await res.text()}`);

  const data: any = await res.json();
  const results = Array.isArray(data?.results) ? data.results : [];

  return results
    .map((r: any) => ({
      title: String(r.title || r.url || "Untitled"),
      url: String(r.url || ""),
      snippet: r.content ? String(r.content) : undefined,
    }))
    .filter((r: SearchResult) => !!r.url);
}

async function braveSearch(query: string, maxResults: number, signal: AbortSignal): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) throw new Error("BRAVE_SEARCH_API_KEY is not set.");

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(maxResults));

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
      "User-Agent": USER_AGENT,
    },
    signal,
  });

  if (!res.ok) throw new Error(`Brave search failed (${res.status}): ${await res.text()}`);

  const data: any = await res.json();
  const results = Array.isArray(data?.web?.results) ? data.web.results : [];

  return results
    .map((r: any) => ({
      title: String(r.title || r.url || "Untitled"),
      url: String(r.url || ""),
      snippet: r.description ? String(r.description) : undefined,
    }))
    .filter((r: SearchResult) => !!r.url);
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("web-access-status", {
    description: "Show search/crawl capability status",
    handler: async (_args, ctx) => {
      const providers = configuredSearchProviders();
      const lines = [
        `Web access extension is loaded.`,
        `Tavily API key: ${providers.tavily ? "configured" : "missing"}`,
        `Brave API key: ${providers.brave ? "configured" : "missing"}`,
        `Browser renderer: playwright (install dependency + Chromium browser)`,
      ];
      if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web using Tavily or Brave Search API. Requires TAVILY_API_KEY or BRAVE_SEARCH_API_KEY.",
    promptSnippet: "Search the web and return ranked URLs/snippets for a query",
    promptGuidelines: [
      "Prefer this tool for discovering external sources and fresh information.",
      "If keys are missing, ask the user to configure TAVILY_API_KEY or BRAVE_SEARCH_API_KEY.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      provider: Type.Optional(StringEnum(["auto", "tavily", "brave"] as const, { description: "Search provider" })),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 5 })),
    }),
    async execute(_toolCallId, params, signal) {
      const provider = params.provider ?? "auto";
      const maxResults = params.max_results ?? 5;
      let usedProvider = provider;

      let results: SearchResult[] = [];
      if (provider === "auto") {
        const providers = configuredSearchProviders();
        if (providers.tavily) {
          usedProvider = "tavily";
          results = await tavilySearch(params.query, maxResults, signal);
        } else if (providers.brave) {
          usedProvider = "brave";
          results = await braveSearch(params.query, maxResults, signal);
        } else {
          throw new Error(
            "No search provider is configured. Set TAVILY_API_KEY or BRAVE_SEARCH_API_KEY, then /reload.",
          );
        }
      } else if (provider === "tavily") {
        results = await tavilySearch(params.query, maxResults, signal);
      } else {
        results = await braveSearch(params.query, maxResults, signal);
      }

      const lines: string[] = [];
      lines.push(`Provider: ${usedProvider}`);
      lines.push(`Query: ${params.query}`);
      lines.push("");

      if (results.length === 0) {
        lines.push("No results.");
      } else {
        results.forEach((r, i) => {
          lines.push(`${i + 1}. ${r.title}`);
          lines.push(`   URL: ${r.url}`);
          if (r.snippet) lines.push(`   Snippet: ${short(r.snippet, 350)}`);
          lines.push("");
        });
      }

      const output = await maybeTruncate(lines.join("\n"));
      return {
        content: [{ type: "text", text: output.text }],
        details: {
          provider: usedProvider,
          query: params.query,
          results,
          truncated: output.truncated,
          tempPath: output.tempPath,
        },
      };
    },
  });

  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description: "Fetch a URL over HTTP and extract readable article/page text.",
    promptSnippet: "Fetch a web URL and extract readable text + metadata",
    promptGuidelines: [
      "Use this after web_search to pull primary-source content.",
      "Prefer this fast HTTP fetch before resorting to browser_fetch.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch" }),
      timeout_ms: Type.Optional(Type.Integer({ minimum: 1000, maximum: 120000, default: 20000 })),
      max_chars: Type.Optional(Type.Integer({ minimum: 500, maximum: 50000, default: 12000 })),
    }),
    async execute(_toolCallId, params, signal) {
      const url = normalizeUrl(params.url);
      const timeoutMs = params.timeout_ms ?? 20000;
      const maxChars = params.max_chars ?? 12000;

      const page = await fetchPage(url, signal, timeoutMs);
      const visibleText = short(page.text || "", maxChars);

      const body = [
        `URL: ${page.url}`,
        `Final URL: ${page.finalUrl}`,
        `Status: ${page.status}`,
        page.title ? `Title: ${page.title}` : "Title: (none)",
        "",
        visibleText || "(no readable text extracted)",
      ].join("\n");

      const output = await maybeTruncate(body);
      return {
        content: [{ type: "text", text: output.text }],
        details: {
          ...page,
          text: visibleText,
          maxChars,
          truncated: output.truncated,
          tempPath: output.tempPath,
        },
      };
    },
  });

  pi.registerTool({
    name: "browser_fetch",
    label: "Browser Fetch",
    description:
      "Use Playwright Chromium for JavaScript-heavy pages, then extract rendered page text. Requires playwright + installed Chromium.",
    promptSnippet: "Open a page in headless browser, wait for render, then extract text",
    promptGuidelines: [
      "Use this for SPAs or pages that require JS execution.",
      "Use web_fetch first for static pages because it's faster and lighter.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to open in browser" }),
      wait_until: Type.Optional(StringEnum(["load", "domcontentloaded", "networkidle"] as const)),
      wait_for_selector: Type.Optional(Type.String({ description: "Optional CSS selector to wait for" })),
      wait_ms: Type.Optional(Type.Integer({ minimum: 0, maximum: 60000, default: 0 })),
      timeout_ms: Type.Optional(Type.Integer({ minimum: 1000, maximum: 120000, default: 30000 })),
      max_chars: Type.Optional(Type.Integer({ minimum: 500, maximum: 50000, default: 12000 })),
      screenshot_path: Type.Optional(Type.String({ description: "Optional screenshot path (relative to cwd or absolute)" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const { chromium } = await import("playwright");
      const url = normalizeUrl(params.url);
      const timeoutMs = params.timeout_ms ?? 30000;
      const maxChars = params.max_chars ?? 12000;
      const waitUntil = (params.wait_until ?? "domcontentloaded") as "load" | "domcontentloaded" | "networkidle";

      const browser = await chromium.launch({ headless: true });
      const abortHandler = () => {
        browser.close().catch(() => {});
      };
      signal?.addEventListener("abort", abortHandler, { once: true });

      try {
        const context = await browser.newContext({ userAgent: USER_AGENT });
        const page = await context.newPage();

        const response = await page.goto(url, {
          waitUntil,
          timeout: timeoutMs,
        });

        if (params.wait_for_selector) {
          await page.waitForSelector(params.wait_for_selector, {
            timeout: timeoutMs,
          });
        }

        if ((params.wait_ms ?? 0) > 0) {
          await page.waitForTimeout(params.wait_ms ?? 0);
        }

        const title = await page.title();
        const renderedText = await page.evaluate(() => document.body?.innerText ?? "");
        const text = short(renderedText.trim(), maxChars);

        let savedScreenshotPath: string | undefined;
        if (params.screenshot_path) {
          savedScreenshotPath = path.isAbsolute(params.screenshot_path)
            ? params.screenshot_path
            : path.join(ctx.cwd, params.screenshot_path);
          await mkdir(path.dirname(savedScreenshotPath), { recursive: true });
          await page.screenshot({ path: savedScreenshotPath, fullPage: true });
        }

        const body = [
          `URL: ${url}`,
          `Status: ${response?.status() ?? "unknown"}`,
          `Title: ${title || "(none)"}`,
          savedScreenshotPath ? `Screenshot: ${savedScreenshotPath}` : "",
          "",
          text || "(no rendered text extracted)",
        ]
          .filter(Boolean)
          .join("\n");

        const output = await maybeTruncate(body);
        return {
          content: [{ type: "text", text: output.text }],
          details: {
            url,
            status: response?.status() ?? null,
            title,
            text,
            screenshotPath: savedScreenshotPath,
            truncated: output.truncated,
            tempPath: output.tempPath,
          },
        };
      } finally {
        signal?.removeEventListener("abort", abortHandler);
        await browser.close().catch(() => {});
      }
    },
  });

  pi.registerTool({
    name: "site_crawl",
    label: "Site Crawl",
    description: "Crawl pages from a start URL using HTTP fetch and link discovery.",
    promptSnippet: "Crawl a site breadth-first and summarize discovered pages",
    promptGuidelines: [
      "Use conservative limits (pages/depth) unless user asks for a wider crawl.",
      "Prefer same-domain crawl unless user explicitly requests external links.",
    ],
    parameters: Type.Object({
      start_url: Type.String({ description: "Starting URL" }),
      max_pages: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, default: 8 })),
      max_depth: Type.Optional(Type.Integer({ minimum: 0, maximum: 5, default: 1 })),
      same_domain_only: Type.Optional(Type.Boolean({ default: true })),
      timeout_ms: Type.Optional(Type.Integer({ minimum: 1000, maximum: 120000, default: 20000 })),
    }),
    async execute(_toolCallId, params, signal) {
      const start = canonicalizeUrl(normalizeUrl(params.start_url));
      const maxPages = params.max_pages ?? 8;
      const maxDepth = params.max_depth ?? 1;
      const sameDomainOnly = params.same_domain_only ?? true;
      const timeoutMs = params.timeout_ms ?? 20000;

      const startHost = new URL(start).host;
      const queue: Array<{ url: string; depth: number }> = [{ url: start, depth: 0 }];
      const visited = new Set<string>();
      const pages: Array<{ url: string; status: number; title?: string; snippet: string; depth: number }> = [];
      const errors: Array<{ url: string; error: string }> = [];

      while (queue.length > 0 && pages.length < maxPages) {
        if (signal.aborted) break;

        const current = queue.shift()!;
        if (visited.has(current.url)) continue;
        visited.add(current.url);

        try {
          const page = await fetchPage(current.url, signal, timeoutMs);
          pages.push({
            url: page.finalUrl,
            status: page.status,
            title: page.title,
            snippet: short(page.text || "", 240).replace(/\n+/g, " "),
            depth: current.depth,
          });

          if (current.depth < maxDepth) {
            for (const link of page.links) {
              let normalized: string;
              try {
                normalized = canonicalizeUrl(link);
              } catch {
                continue;
              }
              if (visited.has(normalized)) continue;
              if (sameDomainOnly && new URL(normalized).host !== startHost) continue;
              queue.push({ url: normalized, depth: current.depth + 1 });
            }
          }
        } catch (error: any) {
          errors.push({
            url: current.url,
            error: error?.message ? String(error.message) : "Unknown error",
          });
        }
      }

      const lines: string[] = [];
      lines.push(`Start URL: ${start}`);
      lines.push(`Crawled pages: ${pages.length} / ${maxPages}`);
      lines.push(`Max depth: ${maxDepth}`);
      lines.push(`Same-domain only: ${sameDomainOnly ? "yes" : "no"}`);
      lines.push("");

      pages.forEach((p, i) => {
        lines.push(`${i + 1}. [${p.status}] ${p.title || "(untitled)"}`);
        lines.push(`   URL: ${p.url}`);
        if (p.snippet) lines.push(`   Snippet: ${p.snippet}`);
        lines.push("");
      });

      if (errors.length) {
        lines.push("Errors:");
        errors.slice(0, 10).forEach((e) => lines.push(`- ${e.url}: ${e.error}`));
      }

      const output = await maybeTruncate(lines.join("\n"));
      return {
        content: [{ type: "text", text: output.text }],
        details: {
          start,
          pages,
          errors,
          truncated: output.truncated,
          tempPath: output.tempPath,
        },
      };
    },
  });
}
