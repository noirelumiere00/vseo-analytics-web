/**
 * S3 Collector — Web Reputation (reviews, comparison articles)
 *
 * Uses Google search (CSE + Puppeteer fallback) to find review/comparison content,
 * then scrapes with Puppeteer for full text.
 */
import puppeteer from "puppeteer-core";
import { findChromiumPath, buildChromiumArgs } from "../../../tiktokScraper";
import { googleSearch } from "./googleSearch";
import type { S3RawData } from "../schemas";

const SCRAPE_TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 3000;

/**
 * Generate search queries for S3 (web reputation)
 */
function buildQueries(productName: string): string[] {
  return [
    `${productName} レビュー 口コミ`,
    `${productName} 比較 おすすめ`,
    `${productName} メリット デメリット`,
  ];
}

/**
 * Scrape page body text with Puppeteer
 */
async function scrapePageBody(url: string): Promise<string> {
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: findChromiumPath(),
      headless: true,
      args: buildChromiumArgs(),
    });
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: SCRAPE_TIMEOUT_MS });

    const bodyText = await page.evaluate(() => {
      document.querySelectorAll("script, style, nav, footer, header, aside").forEach(el => el.remove());
      const main = document.querySelector("main, article, .article-body, .entry-content, .review-content, #content");
      return (main || document.body).innerText.trim();
    });

    return bodyText.slice(0, MAX_BODY_CHARS);
  } catch (e) {
    console.warn(`[S3] Scrape failed for ${url}:`, e);
    return "";
  } finally {
    await browser?.close();
  }
}

/**
 * Collect S3 data: search for reviews and comparison articles, scrape content
 */
export async function collectS3(productName: string): Promise<S3RawData[]> {
  const queries = buildQueries(productName);
  const allResults: S3RawData[] = [];

  for (const query of queries) {
    const searchResults = await googleSearch(query);

    // Scrape top results for full body text
    const enriched = await Promise.all(
      searchResults.slice(0, 3).map(async (result) => {
        const body = await scrapePageBody(result.url);
        return { ...result, body };
      })
    );

    allResults.push({ query, results: enriched });

    // Polite delay between searches
    await new Promise(r => setTimeout(r, 1000));
  }

  return allResults;
}
