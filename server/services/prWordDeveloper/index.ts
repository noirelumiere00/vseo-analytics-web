/**
 * PR Word Developer — Orchestrator
 *
 * Pipeline: parallel data collection (S1 + S3 + Google Suggest + URL scrape) → LLM analysis
 * Designed to run inside the PM2 worker process.
 */
import pLimit from "p-limit";
import { collectS1 } from "../contextAnalyzer/collectors/s1ClientIntent";
import { collectS3 } from "../contextAnalyzer/collectors/s3WebReputation";
import { collectGoogleSuggest, type GoogleSuggestOptions } from "./collectors/googleSuggest";
import { scrapeProductPage, type ProductPageData } from "./collectors/productPageScraper";
import { discoverTikTokHashtags, type TikTokHashtagDiscoveryResult } from "./collectors/tiktokHashtagDiscovery";
import { invokeLLM } from "../../_core/llm";
import { prWordResultSchemaV2, PR_WORD_RESULT_JSON_SCHEMA_V2, type PrWordResultV2 } from "./schemas";
import { PR_WORD_SYSTEM_PROMPT, buildUserPrompt } from "./prompts";
import type { S1RawData, S3RawData } from "../contextAnalyzer/schemas";

export type PrWordProgress = {
  message: string;
  percent: number;
  phase?: "collecting" | "analyzing" | "completed" | "failed";
};

export type PrWordExecutionResult = {
  s1RawData: S1RawData[];
  s3RawData: S3RawData[];
  googleSuggestData: string[];
  productPageData: ProductPageData | null;
  tiktokDiscoveryData: TikTokHashtagDiscoveryResult | null;
  analysisResult: PrWordResultV2;
};

const collectLimit = pLimit(2); // Puppeteer concurrency limit

const MAX_SEGMENT_CHARS = 3000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "... (truncated)";
}

function formatS1(data: S1RawData[]): string {
  if (!data?.length) return "（データなし）";
  const parts: string[] = [];
  for (const entry of data) {
    for (const r of entry.results) {
      parts.push(`- [${r.title}](${r.url})\n  ${r.snippet}\n  ${r.body ? truncate(r.body, 500) : ""}`);
    }
  }
  return truncate(parts.join("\n\n"), MAX_SEGMENT_CHARS);
}

function formatS3(data: S3RawData[]): string {
  if (!data?.length) return "（データなし）";
  const parts: string[] = [];
  for (const entry of data) {
    for (const r of entry.results) {
      parts.push(`- [${r.title}](${r.url})\n  ${r.snippet}\n  ${r.body ? truncate(r.body, 500) : ""}`);
    }
  }
  return truncate(parts.join("\n\n"), MAX_SEGMENT_CHARS);
}

function formatGoogleSuggest(data: string[]): string {
  if (!data?.length) return "（データなし）";
  return data.join(", ");
}

function formatTikTokDiscovery(data: TikTokHashtagDiscoveryResult | null): string | undefined {
  if (!data?.topHashtags.length && !data?.captionKeywords?.length) return undefined;
  const parts: string[] = [];

  if (data.topHashtags.length) {
    const lines = data.topHashtags.map(h => {
      const countStr = h.postCount != null ? `${(h.postCount / 10000).toFixed(1)}万件` : "不明";
      return `- #${h.tag}（出現${h.frequency}本、投稿数: ${countStr}）`;
    });
    parts.push(`### ハッシュタグ\n検索「${data.searchQueries.join("」「")}」で${data.totalVideosScraped}本の動画を分析:\n${lines.join("\n")}`);
  }

  if (data.captionKeywords?.length) {
    const kwLines = data.captionKeywords.map(k => `- ${k.word}（${k.frequency}本）`);
    parts.push(`### キャプション頻出ワード\n動画キャプション内で繰り返し使われている表現:\n${kwLines.join("\n")}`);
  }

  return parts.join("\n\n");
}

function formatProductPage(data: ProductPageData | null): string {
  if (!data) return "（商品ページ未指定）";
  const parts: string[] = [];
  if (data.title) parts.push(`タイトル: ${data.title}`);
  if (data.description) parts.push(`説明: ${data.description}`);
  if (Object.keys(data.ogTags).length > 0) {
    parts.push(`OGP: ${Object.entries(data.ogTags).map(([k, v]) => `${k}="${v}"`).join(", ")}`);
  }
  if (data.headings.length > 0) {
    parts.push(`見出し:\n${data.headings.map(h => `  - ${h}`).join("\n")}`);
  }
  if (data.bodyText) {
    parts.push(`ページ本文:\n${truncate(data.bodyText, 1500)}`);
  }
  return truncate(parts.join("\n"), 5000); // 本文を含むので上限を拡張
}

function formatStructuredProductData(data: ProductPageData | null): string | undefined {
  if (!data) return undefined;
  const parts: string[] = [];
  if (data.siteName) parts.push(`サイト名 (og:site_name): ${data.siteName}`);
  if (data.jsonLd) {
    if (data.jsonLd.brand) parts.push(`ブランド (JSON-LD): ${data.jsonLd.brand}`);
    if (data.jsonLd.manufacturer) parts.push(`メーカー (JSON-LD): ${data.jsonLd.manufacturer}`);
    if (data.jsonLd.category) parts.push(`カテゴリ (JSON-LD): ${data.jsonLd.category}`);
  }
  if (data.breadcrumbs.length > 0) {
    parts.push(`パンくずリスト: ${data.breadcrumbs.join(" > ")}`);
  }
  if (data.copyright) parts.push(`Copyright: ${data.copyright}`);
  // タイトル区切りパターン（「商品名 | メーカー名」等）
  if (data.title) {
    const sep = data.title.match(/\s*[|｜\-–—]\s*/);
    if (sep) {
      const segments = data.title.split(/[|｜\-–—]/).map(s => s.trim()).filter(Boolean);
      if (segments.length >= 2) {
        parts.push(`タイトル区切り: ${segments.join(" / ")}`);
      }
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/**
 * Execute the full PR Word Development pipeline
 */
export async function executePrWordAnalysis(
  productName: string,
  purpose: string,
  productUrl: string | null,
  onProgress?: (progress: PrWordProgress) => Promise<void>,
): Promise<PrWordExecutionResult> {
  // ── Step 1: Parallel data collection ──
  await onProgress?.({ message: "データ収集を開始しています...", percent: 5, phase: "collecting" });

  // Phase 1: S1, S3, Product Page (if URL provided), TikTok — in parallel
  const phase1Collectors: Promise<any>[] = [
    collectLimit(() => {
      console.log(`[PrWordDev] Collecting S1 for "${productName}"`);
      return collectS1(productName);
    }),
    collectLimit(() => {
      console.log(`[PrWordDev] Collecting S3 for "${productName}"`);
      return collectS3(productName);
    }),
  ];

  // Product page scrape (needed before Google Suggest for category/brand context)
  const pagePromise = productUrl
    ? collectLimit(() => {
        console.log(`[PrWordDev] Scraping product page: ${productUrl}`);
        return scrapeProductPage(productUrl);
      })
    : Promise.resolve(null);
  phase1Collectors.push(pagePromise);

  // TikTok Hashtag Discovery
  phase1Collectors.push(
    collectLimit(() => {
      console.log(`[PrWordDev] Discovering TikTok hashtags for "${productName}"`);
      return discoverTikTokHashtags(productName, (msg) => {
        onProgress?.({ message: msg, percent: 20, phase: "collecting" });
      });
    })
  );

  const phase1Results = await Promise.allSettled(phase1Collectors);

  const s1Data: S1RawData[] = phase1Results[0].status === "fulfilled" ? phase1Results[0].value : [];
  const s3Data: S3RawData[] = phase1Results[1].status === "fulfilled" ? phase1Results[1].value : [];
  const pageData: ProductPageData | null = phase1Results[2].status === "fulfilled" ? phase1Results[2].value : null;
  const tiktokData: TikTokHashtagDiscoveryResult | null = phase1Results[3].status === "fulfilled" ? phase1Results[3].value : null;

  if (phase1Results[0].status === "rejected") console.error("[PrWordDev] S1 collection failed:", phase1Results[0].reason);
  if (phase1Results[1].status === "rejected") console.error("[PrWordDev] S3 collection failed:", phase1Results[1].reason);
  if (phase1Results[2].status === "rejected") console.error("[PrWordDev] Product page scrape failed:", phase1Results[2].reason);
  if (phase1Results[3].status === "rejected") console.error("[PrWordDev] TikTok discovery failed:", phase1Results[3].reason);

  // Phase 2: Google Suggest with product page context (category/brand enrichment)
  let suggestOptions: GoogleSuggestOptions | undefined;
  if (pageData) {
    suggestOptions = {
      category: pageData.jsonLd?.category || undefined,
      brand: pageData.jsonLd?.brand || pageData.jsonLd?.manufacturer || undefined,
      siteName: pageData.siteName || undefined,
    };
  }

  console.log(`[PrWordDev] Collecting Google Suggest for "${productName}" (options: ${JSON.stringify(suggestOptions || {})})`);
  let suggestData: string[] = [];
  try {
    suggestData = await collectGoogleSuggest(productName, suggestOptions);
  } catch (e) {
    console.error("[PrWordDev] Google Suggest failed:", e);
  }

  await onProgress?.({ message: "データ収集完了。AI分析を開始します...", percent: 50, phase: "analyzing" });

  // ── Step 2: LLM Analysis ──
  const userPrompt = buildUserPrompt(
    productName,
    purpose,
    formatS1(s1Data),
    formatS3(s3Data),
    formatGoogleSuggest(suggestData),
    formatProductPage(pageData),
    formatTikTokDiscovery(tiktokData),
    formatStructuredProductData(pageData),
  );

  console.log(`[PrWordDev] Sending to LLM for "${productName}" (prompt ~${userPrompt.length} chars)`);

  const llmResult = await invokeLLM({
    messages: [
      { role: "system", content: PR_WORD_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 8192,
    responseFormat: {
      type: "json_schema",
      json_schema: PR_WORD_RESULT_JSON_SCHEMA_V2,
    },
  });

  const raw = llmResult.choices[0]?.message?.content;
  const text = typeof raw === "string" ? raw : "";

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    console.error("[PrWordDev] Failed to parse LLM response:", text.slice(0, 500));
    throw new Error("LLM response is not valid JSON");
  }

  const validated = prWordResultSchemaV2.safeParse(parsed);
  if (!validated.success) {
    console.error("[PrWordDev] Zod validation failed:", validated.error.issues);
  }

  const analysisResult = validated.success ? validated.data : (parsed as PrWordResultV2);

  // Merge real TikTok post counts into search words
  if (tiktokData?.topHashtags.length) {
    const postCountMap = new Map<string, number>();
    for (const h of tiktokData.topHashtags) {
      if (h.postCount != null) {
        postCountMap.set(h.tag.toLowerCase(), h.postCount);
        postCountMap.set(`#${h.tag.toLowerCase()}`, h.postCount);
      }
    }
    const mergePostCount = (words: { word: string; tiktokPostCount: number | null }[]) => {
      if (!Array.isArray(words)) return;
      for (const w of words) {
        const key = w.word.toLowerCase().replace(/\s+/g, "");
        const real = postCountMap.get(key) ?? postCountMap.get(`#${key}`);
        if (real != null) w.tiktokPostCount = real;
      }
    };
    mergePostCount(analysisResult.brandedSearchWords);
    mergePostCount(analysisResult.genericSearchWords);
  }

  await onProgress?.({ message: "分析が完了しました", percent: 100, phase: "completed" });

  return {
    s1RawData: s1Data,
    s3RawData: s3Data,
    googleSuggestData: suggestData,
    productPageData: pageData,
    tiktokDiscoveryData: tiktokData,
    analysisResult,
  };
}
