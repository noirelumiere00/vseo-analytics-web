/**
 * STEP 3: Pain Hypothesis Generation
 *
 * Uses LLM to generate pain hypotheses from product features.
 * Pure LLM inference — no external data fetching.
 */
import { invokeLLM, parseLLMJson } from "../../../_core/llm";
import {
  painHypothesesArraySchema,
  PAIN_HYPOTHESES_JSON_SCHEMA,
  type PainHypothesis,
  type ProductFeatures,
  type ProgressFn,
} from "../schemas";
import type { S1RawData, S3RawData } from "../../contextAnalyzer/schemas";
import {
  PAIN_HYPOTHESIS_SYSTEM_PROMPT,
  buildPainHypothesisPrompt,
} from "../prompts";

function formatS1Summary(data: S1RawData[]): string {
  return data.flatMap(d => d.results.map(r => `${r.title}: ${r.snippet}`)).join("\n").slice(0, 1500);
}

function formatS3Summary(data: S3RawData[]): string {
  return data.flatMap(d => d.results.map(r => `${r.title}: ${r.snippet}`)).join("\n").slice(0, 1500);
}

export async function generatePainHypotheses(
  productName: string,
  features: ProductFeatures,
  s1Data: S1RawData[],
  s3Data: S3RawData[],
  onProgress?: ProgressFn,
): Promise<PainHypothesis[]> {
  await onProgress?.({ message: "ペイン仮説をAIが生成中...", percent: 35, phase: "hypothesizing" });

  const result = await invokeLLM({
    messages: [
      { role: "system", content: PAIN_HYPOTHESIS_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildPainHypothesisPrompt(
          productName,
          features,
          formatS1Summary(s1Data),
          formatS3Summary(s3Data),
        ),
      },
    ],
    maxTokens: 4096,
    responseFormat: {
      type: "json_schema",
      json_schema: PAIN_HYPOTHESES_JSON_SCHEMA,
    },
  });

  const parsed = parseLLMJson(result) as any;
  const validated = painHypothesesArraySchema.safeParse(parsed);

  if (!validated.success) {
    console.error("[PainAnalyzer/Step3] Hypothesis validation failed:", validated.error);
    // Fallback: try to extract hypotheses array directly
    const hypotheses = parsed.hypotheses || parsed;
    if (Array.isArray(hypotheses)) {
      return hypotheses.map((h: any, i: number) => ({
        id: h.id || `pain_${String(i + 1).padStart(2, "0")}`,
        pain: h.pain || "不明なペイン",
        feature: h.feature || "",
        searchQuery: h.searchQuery || h.search_query || productName,
        confidence: h.confidence || 0.5,
        approved: true,
      }));
    }
    throw new Error("Failed to parse pain hypotheses from LLM response");
  }

  // Mark all as approved by default (user can toggle in approval UI)
  return validated.data.hypotheses.map(h => ({
    ...h,
    approved: true,
  }));
}
