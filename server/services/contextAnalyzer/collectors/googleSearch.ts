/**
 * Google Search Helper — CSE API + Puppeteer fallback
 *
 * Primary: Google Custom Search API (stable, 100 queries/day free)
 * Fallback: Puppeteer direct google.co.jp scraping (free, block risk)
 */
import puppeteer from "puppeteer-core";
import { findChromiumPath, buildChromiumArgs } from "../../../tiktokScraper";
import { ENV } from "../../../_core/env";

const MAX_RESULTS = 5;
const SCRAPE_TIMEOUT_MS = 20_000;
const CSE_DAILY_LIMIT = 100;

type SearchResult = { url: string; title: string; snippet: string };

// ── CSE daily usage tracker (resets at midnight JST) ──
let cseCallCount = 0;
let cseCountDate = ""; // "YYYY-MM-DD" in JST

function getTodayJST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // "2026-04-09"
}

function canUseCSE(): boolean {
  const today = getTodayJST();
  if (cseCountDate !== today) {
    // New day → reset counter
    cseCallCount = 0;
    cseCountDate = today;
  }
  return cseCallCount < CSE_DAILY_LIMIT;
}

function recordCSECall(): void {
  const today = getTodayJST();
  if (cseCountDate !== today) {
    cseCallCount = 0;
    cseCountDate = today;
  }
  cseCallCount++;
  console.log(`[GoogleSearch] CSE usage: ${cseCallCount}/${CSE_DAILY_LIMIT} today`);
}

/**
 * Search via Google Custom Search API
 */
async function googleCSE(query: string): Promise<SearchResult[]> {
  const apiKey = ENV.googleSearchApiKey;
  const cx = ENV.googleSearchCx;
  if (!apiKey || !cx) return [];

  const params = new URLSearchParams({
    key: apiKey,
    cx,
    q: query,
    num: String(MAX_RESULTS),
    lr: "lang_ja",
    gl: "jp",
  });

  recordCSECall();
  const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 429 || body.includes("rateLimitExceeded") || body.includes("dailyLimitExceeded")) {
      throw new Error("CSE_QUOTA_EXCEEDED");
    }
    console.warn(`[GoogleSearch] CSE failed: ${res.status}`);
    return [];
  }
  const data = await res.json();
  return (data.items || []).map((item: any) => ({
    url: item.link || "",
    title: item.title || "",
    snippet: item.snippet || "",
  }));
}

/**
 * Fallback: scrape google.co.jp search results directly with Puppeteer
 */
async function googlePuppeteer(query: string): Promise<SearchResult[]> {
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: findChromiumPath(),
      headless: true,
      args: buildChromiumArgs(),
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "ja-JP,ja;q=0.9" });

    const searchUrl = `https://www.google.co.jp/search?q=${encodeURIComponent(query)}&hl=ja&gl=jp&num=${MAX_RESULTS}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: SCRAPE_TIMEOUT_MS });

    // Wait a moment for results to render
    await new Promise(r => setTimeout(r, 1500));

    const results = await page.evaluate(() => {
      const items: Array<{ url: string; title: string; snippet: string }> = [];
      // Standard Google search result selectors
      const blocks = document.querySelectorAll("#search .g, #rso .g");
      blocks.forEach((block) => {
        const anchor = block.querySelector("a[href^='http']") as HTMLAnchorElement | null;
        const titleEl = block.querySelector("h3");
        // Snippet: multiple possible selectors
        const snippetEl = block.querySelector(
          "[data-sncf], .VwiC3b, .IsZvec, .s3v9rd, .st"
        );
        if (anchor && titleEl) {
          items.push({
            url: anchor.href,
            title: titleEl.innerText.trim(),
            snippet: snippetEl?.textContent?.trim() || "",
          });
        }
      });
      return items;
    });

    console.log(`[GoogleSearch] Puppeteer scraped ${results.length} results for "${query}"`);
    return results.slice(0, MAX_RESULTS);
  } catch (e) {
    console.warn(`[GoogleSearch] Puppeteer fallback failed for "${query}":`, e);
    return [];
  } finally {
    await browser?.close();
  }
}

/**
 * Search Google: CSE first (with daily limit), Puppeteer fallback
 */
export async function googleSearch(query: string): Promise<SearchResult[]> {
  // Try CSE first (if configured and under daily limit)
  if (ENV.googleSearchApiKey && ENV.googleSearchCx && canUseCSE()) {
    try {
      const results = await googleCSE(query);
      if (results.length > 0) return results;
    } catch (e: any) {
      if (e.message === "CSE_QUOTA_EXCEEDED") {
        console.warn("[GoogleSearch] CSE quota exhausted by Google, switching to Puppeteer");
      }
    }
  } else if (ENV.googleSearchApiKey && !canUseCSE()) {
    console.warn(`[GoogleSearch] CSE daily limit reached (${cseCallCount}/${CSE_DAILY_LIMIT}), using Puppeteer`);
  }

  // Fallback to Puppeteer direct scraping
  console.log(`[GoogleSearch] Using Puppeteer fallback for "${query}"`);
  return googlePuppeteer(query);
}
