/**
 * Product Page Scraper
 *
 * Scrapes title, meta description, OGP tags, and headings from a product URL.
 * Uses Puppeteer — runs under pLimit(2) to respect EC2 RAM constraints.
 */
import puppeteer from "puppeteer";
import { findChromiumPath, buildChromiumArgs } from "../../../tiktokScraper";

export type ProductPageData = {
  title: string;
  description: string;
  ogTags: Record<string, string>;
  headings: string[];
  // V2 拡張: ブランド・メーカー構造化データ
  siteName: string | null;
  jsonLd: { brand?: string; manufacturer?: string; category?: string } | null;
  breadcrumbs: string[];
  copyright: string | null;
  bodyText: string;  // メインコンテンツ本文（活用シーン・特徴等）
};

const SCRAPE_TIMEOUT_MS = 15_000;

/**
 * Scrape a product page for metadata and headings.
 * Returns null if scraping fails.
 */
export async function scrapeProductPage(url: string): Promise<ProductPageData | null> {
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

    const data = await page.evaluate(() => {
      const title = document.title || "";
      const descMeta = document.querySelector('meta[name="description"]');
      const description = descMeta?.getAttribute("content") || "";

      // OGP tags
      const ogTags: Record<string, string> = {};
      document.querySelectorAll('meta[property^="og:"]').forEach(el => {
        const prop = el.getAttribute("property");
        const content = el.getAttribute("content");
        if (prop && content) ogTags[prop.replace("og:", "")] = content;
      });

      // Main headings
      const headings: string[] = [];
      document.querySelectorAll("h1, h2, h3").forEach(el => {
        const text = (el as HTMLElement).innerText?.trim();
        if (text && text.length < 200) headings.push(text);
      });

      // og:site_name
      const siteNameMeta = document.querySelector('meta[property="og:site_name"]');
      const siteName = siteNameMeta?.getAttribute("content") || null;

      // JSON-LD (Schema.org Product)
      let jsonLd: { brand?: string; manufacturer?: string; category?: string } | null = null;
      document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
        try {
          const obj = JSON.parse(el.textContent || "");
          const items = Array.isArray(obj) ? obj : obj["@graph"] ? obj["@graph"] : [obj];
          for (const item of items) {
            if (item["@type"] === "Product" || item["@type"]?.includes?.("Product")) {
              jsonLd = {
                brand: typeof item.brand === "string" ? item.brand
                  : item.brand?.name || undefined,
                manufacturer: typeof item.manufacturer === "string" ? item.manufacturer
                  : item.manufacturer?.name || undefined,
                category: item.category || undefined,
              };
              break;
            }
          }
        } catch { /* ignore invalid JSON-LD */ }
      });

      // Breadcrumbs
      const breadcrumbs: string[] = [];
      // Schema.org BreadcrumbList
      document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
        try {
          const obj = JSON.parse(el.textContent || "");
          const items = Array.isArray(obj) ? obj : obj["@graph"] ? obj["@graph"] : [obj];
          for (const item of items) {
            if (item["@type"] === "BreadcrumbList" && Array.isArray(item.itemListElement)) {
              for (const crumb of item.itemListElement) {
                const name = crumb.name || crumb.item?.name;
                if (name) breadcrumbs.push(name);
              }
            }
          }
        } catch { /* ignore */ }
      });
      // Fallback: nav breadcrumb elements
      if (!breadcrumbs.length) {
        document.querySelectorAll('[class*="breadcrumb"] a, nav[aria-label*="パンくず"] a, nav[aria-label*="breadcrumb"] a').forEach(el => {
          const text = (el as HTMLElement).innerText?.trim();
          if (text && text.length < 100) breadcrumbs.push(text);
        });
      }

      // Copyright text
      let copyright: string | null = null;
      const footerEl = document.querySelector("footer");
      if (footerEl) {
        const footerText = footerEl.innerText || "";
        const match = footerText.match(/(?:©|&copy;|copyright)\s*.{0,100}/i);
        if (match) copyright = match[0].trim().slice(0, 150);
      }

      // メインコンテンツ本文抽出
      const bodyText = (() => {
        const container = document.querySelector(
          "main, article, [role='main'], .product-description, .product-detail, " +
          ".article-body, .entry-content, #content, #main-content, .main-content"
        );
        const target = container || document.body;
        const cloned = target.cloneNode(true) as Element;
        cloned.querySelectorAll("script, style, nav, footer, header, aside, iframe, noscript").forEach(el => el.remove());
        const text = (cloned as HTMLElement).innerText || "";
        // 連続空白・改行を圧縮
        return text.replace(/[\s\n]+/g, " ").trim();
      })();

      return {
        title, description, ogTags, headings: headings.slice(0, 20),
        siteName, jsonLd, breadcrumbs: breadcrumbs.slice(0, 10), copyright,
        bodyText: bodyText.slice(0, 2000),
      };
    });

    return data;
  } catch (e) {
    console.warn(`[ProductPageScraper] Failed to scrape ${url}:`, e);
    return null;
  } finally {
    await browser?.close();
  }
}
