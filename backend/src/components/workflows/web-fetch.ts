import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { tool } from '@langchain/core/tools';
import { Readability } from '@mozilla/readability';
import ipaddr from 'ipaddr.js';
import { JSDOM } from 'jsdom';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { z } from 'zod';

import { config } from '#utils/config.js';

const fetchWebPageSchema = z.object({
  url: z.url().describe('URL of the page to fetch and read.'),
});

// Lightpanda re-resolves DNS itself, so rebinding (a different answer on its own lookup) is an accepted gap — this only blocks the direct cases.
async function blockedReason(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `${raw} is not a valid URL`;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `${url.protocol} URLs are not fetchable — use http or https`;
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  // Allowlist unicast rather than denylist — a denylist misses ranges (e.g. IPv6 multicast).
  if (isIP(host)) {
    return ipaddr.process(host).range() !== 'unicast'
      ? `${host} is not a public address`
      : null;
  }

  // Single-label names are the deployment's own service names (lightpanda, monitoring, …), never public sites.
  if (!host.includes('.')) {
    return `${host} is not a public hostname`;
  }

  const resolved = await lookup(host, { all: true }).catch(() => []);
  if (!resolved.length) return `${host} could not be resolved`;
  return resolved.some((r) => ipaddr.process(r.address).range() !== 'unicast')
    ? `${host} resolves to a non-public address`
    : null;
}

// Chat has no tool-output-cap middleware (unlike MR-review's toolOutputCapMiddleware) — an arbitrary fetched page has no size ceiling otherwise.
const FETCH_WEB_PAGE_MAX_CHARS = 20_000;

const DESCRIPTION =
  "Render a URL in a headless browser and return the page's main article content (title + text), truncated if very long.";

// Neither Readability nor a raw textContent dump normalizes whitespace — both leave behind the whitespace-only text nodes between decorative wrapper elements (icons, buttons) that real pages are full of.
function cleanWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

// Unlike innerText, Readability scores DOM structure rather than visual layout, so it isn't tripped up by Lightpanda's layout-engine gaps (verified: it extracted content innerText missed on a page where a real element got a zero-height computed box).
function extractArticle(
  html: string,
  url: string,
): { content: string; title?: string } {
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  const articleText = article?.textContent?.trim();
  if (article && articleText) {
    return {
      content: cleanWhitespace(articleText),
      title: article.title ?? undefined,
    };
  }

  // Readability rejects pages it judges too thin/non-article (landing pages, short docs indexes) — fall back rather than returning nothing.
  const root =
    dom.window.document.querySelector('main') ?? dom.window.document.body;
  root.querySelectorAll('script, style, noscript').forEach((el) => el.remove());
  return { content: cleanWhitespace(root.textContent ?? '') };
}

async function renderPage(url: string, page: Page) {
  const blocked = await blockedReason(url);
  if (blocked) return { error: `Refused to fetch: ${blocked}` };

  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    // page.goto resolves with a response even for a 403/503 bot-challenge page — without this check its (often empty) body would pass through as if it were the real page.
    if (response && !response.ok()) {
      return {
        error: `Fetch failed: ${url} returned HTTP ${response.status()}`,
      };
    }
    // A public URL is free to redirect somewhere internal, so the landing URL needs the same check as the one asked for.
    const landed = page.url();
    if (landed !== url) {
      const blockedAfter = await blockedReason(landed);
      if (blockedAfter) {
        return { error: `Refused to fetch: redirected to ${blockedAfter}` };
      }
    }
    const html = await page.content();
    const { content, title } = extractArticle(html, url);
    const truncated = content.length > FETCH_WEB_PAGE_MAX_CHARS;
    return {
      ...(title && { title }),
      content: truncated ? content.slice(0, FETCH_WEB_PAGE_MAX_CHARS) : content,
      truncated,
    };
  } catch (err) {
    return {
      error: `Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// Per-process only — multiple backend replicas would still race Lightpanda's one target.
let queue: Promise<unknown> = Promise.resolve();
// Serializes calls: the single shared page can't navigate two URLs at once.
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.then(
    () => {},
    () => {},
  );
  return result;
}

const CONNECT_TIMEOUT_MS = 15_000;

// Connects per call — sandboxed workflows build tools once at boot, before Lightpanda may be up.
export const fetchWebPage = tool(
  ({ url }) =>
    serialized(async () => {
      let browser: Browser | undefined;
      try {
        // connect()'s handshake fetch() has no built-in timeout, so a wedged Lightpanda would jam the queue forever.
        browser = await Promise.race([
          puppeteer.connect({ browserURL: config.lightpanda.cdpUrl }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('Timed out connecting to Lightpanda')),
              CONNECT_TIMEOUT_MS,
            ),
          ),
        ]);
        // browser.pages()' existing page is Lightpanda's inert startup placeholder — goto() on it just hangs.
        const page = await browser.newPage();
        return await renderPage(url, page);
      } catch (err) {
        return {
          error: `Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}`,
        };
      } finally {
        // disconnect(), not close() — this is Lightpanda's shared browser process, not ours to shut down.
        browser?.disconnect();
      }
    }),
  {
    name: 'fetch_web_page',
    description: DESCRIPTION,
    schema: fetchWebPageSchema,
  },
);
