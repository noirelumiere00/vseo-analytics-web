/**
 * STEP 2: Product Feature Extraction
 *
 * Re-uses existing S1 (press releases) and S3 (web reputation) collectors,
 * then sends the collected data to LLM for feature extraction.
 */
import pLimit from "p-limit";
import { collectS1 } from "../../contextAnalyzer/collectors/s1ClientIntent";
import { collectS3 } from "../../contextAnalyzer/collectors/s3WebReputation";
import { invokeLLM, parseLLMJson } from "../../../_core/llm";
import type { S1RawData, S3RawData } from "../../contextAnalyzer/schemas";
import {
  productFeaturesSchema,
  PRODUCT_FEATURES_JSON_SCHEMA,
  type ProductFeatures,
  type ProgressFn,
} from "../schemas";
import {
  FEATURE_EXTRACTION_SYSTEM_PROMPT,
  buildFeatureExtractionPrompt,
} from "../prompts";

const collectLimit = pLimit(2);

function formatS1(data: S1RawData[]): string {
  return data.map(d =>
    `【${d.query}】\n${d.results.map(r =>
      `- ${r.title}\n  ${r.snippet}\n  ${r.body ? r.body.slice(0, 500) : ""}`
    ).join("\n")}`
  ).join("\n\n").slice(0, 3000);
}

function formatS3(data: S3RawData[]): string {
  return data.map(d =>
    `【${d.query}】\n${d.results.map(r =>
      `- ${r.title}\n  ${r.snippet}\n  ${r.body ? r.body.slice(0, 500) : ""}`
    ).join("\n")}`
  ).join("\n\n").slice(0, 3000);
}

export async function extractProductFeatures(
  productName: string,
  productUrl: string | null,
  onProgress?: ProgressFn,
): Promise<{
  s1Data: S1RawData[];
  s3Data: S3RawData[];
  features: ProductFeatures;
}> {
  await onProgress?.({ message: "商品データを収集中...", percent: 5, phase: "collecting" });

  // Parallel collection with graceful degradation
  const [s1Result, s3Result] = await Promise.allSettled([
    collectLimit(() => collectS1(productName)),
    collectLimit(() => collectS3(productName)),
  ]);

  const s1Data = s1Result.status === "fulfilled" ? s1Result.value : [];
  const s3Data = s3Result.status === "fulfilled" ? s3Result.value : [];

  if (s1Result.status === "rejected") {
    console.error("[PainAnalyzer/Step2] S1 collection failed:", s1Result.reason);
  }
  if (s3Result.status === "rejected") {
    console.error("[PainAnalyzer/Step2] S3 collection failed:", s3Result.reason);
  }

  await onProgress?.({ message: "商品特徴をAIが抽出中...", percent: 25, phase: "collecting" });

  // LLM feature extraction
  const result = await invokeLLM({
    messages: [
      { role: "system", content: FEATURE_EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: buildFeatureExtractionPrompt(productName, formatS1(s1Data), formatS3(s3Data)) },
    ],
    maxTokens: 4096,
    responseFormat: {
      type: "json_schema",
      json_schema: PRODUCT_FEATURES_JSON_SCHEMA,
    },
  });

  const parsed = parseLLMJson(result) as any;
  const validated = productFeaturesSchema.safeParse(parsed);

  if (!validated.success) {
    console.error("[PainAnalyzer/Step2] Feature validation failed:", validated.error);
    // Fallback: return partial data
    return {
      s1Data,
      s3Data,
      features: {
        features: parsed.features || [`${productName}の主要機能`],
        targetAudience: parsed.targetAudience || "一般消費者",
        competitors: parsed.competitors || [],
        productCategory: parsed.productCategory || "不明",
      },
    };
  }

  return { s1Data, s3Data, features: validated.data };
}
