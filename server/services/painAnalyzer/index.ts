/**
 * Pain Analyzer — Phase 1 Orchestrator
 *
 * STEP 2: Product Feature Extraction (S1 + S3 + LLM)
 * STEP 3: Pain Hypothesis Generation (LLM)
 *
 * Stops at status="awaiting_approval" for user review.
 * Phase 2 (STEP 4-7) is triggered by user approval.
 */
import { extractProductFeatures } from "./steps/step2FeatureExtraction";
import { generatePainHypotheses } from "./steps/step3PainHypothesis";
import type { PainHypothesis, ProductFeatures, ProgressFn } from "./schemas";
import type { S1RawData, S3RawData } from "../contextAnalyzer/schemas";

export type PainAnalysisPhase1Result = {
  s1RawData: S1RawData[];
  s3RawData: S3RawData[];
  productFeatures: ProductFeatures;
  painHypotheses: PainHypothesis[];
};

/**
 * Execute Phase 1 of pain analysis pipeline.
 * Returns features + hypotheses, ready for user approval.
 */
export async function executePainAnalysisPhase1(
  productName: string,
  productUrl: string | null,
  onProgress?: ProgressFn,
): Promise<PainAnalysisPhase1Result> {
  // ── STEP 2: Feature Extraction ──
  const { s1Data, s3Data, features } = await extractProductFeatures(
    productName,
    productUrl,
    onProgress,
  );

  // ── STEP 3: Pain Hypothesis Generation ──
  const painHypotheses = await generatePainHypotheses(
    productName,
    features,
    s1Data,
    s3Data,
    onProgress,
  );

  await onProgress?.({
    message: "ペイン仮説が生成されました。確認をお待ちしています...",
    percent: 45,
    phase: "awaiting_approval",
  });

  return {
    s1RawData: s1Data,
    s3RawData: s3Data,
    productFeatures: features,
    painHypotheses,
  };
}
