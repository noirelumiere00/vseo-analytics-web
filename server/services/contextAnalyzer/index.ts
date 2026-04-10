/**
 * Context Analyzer — Orchestrator
 *
 * Controls the full pipeline: data collection (parallel) → LLM analysis → result storage.
 * Designed to run inside the PM2 worker process.
 */
import pLimit from "p-limit";
import { collectS1 } from "./collectors/s1ClientIntent";
import { collectS2 } from "./collectors/s2SocialReaction";
import { collectS3 } from "./collectors/s3WebReputation";
import { analyzeWithBedrock } from "./analyzer";
import type { AnalysisResult, S1RawData, S2RawData, S3RawData } from "./schemas";

export type ContextAnalysisProgress = {
  message: string;
  percent: number;
  phase?: "collecting" | "analyzing" | "completed" | "failed";
};

export type ContextAnalysisResult = {
  s1RawData: S1RawData[];
  s2RawData: S2RawData;
  s3RawData: S3RawData[];
  analysisResult: AnalysisResult;
};

const collectLimit = pLimit(2); // Puppeteer concurrency limit (EC2 RAM constraint)

/**
 * Execute the full context analysis pipeline
 */
export async function executeContextAnalysis(
  productName: string,
  onProgress?: (progress: ContextAnalysisProgress) => Promise<void>,
): Promise<ContextAnalysisResult> {
  // ── Step 1: Parallel data collection ──
  await onProgress?.({ message: "データ収集を開始しています...", percent: 5, phase: "collecting" });

  const [s1Result, s2Result, s3Result] = await Promise.allSettled([
    collectLimit(() => {
      console.log(`[Orchestrator] Collecting S1 (Client Intent) for "${productName}"`);
      return collectS1(productName);
    }),
    // S2 doesn't use Puppeteer so no need for limit
    (async () => {
      console.log(`[Orchestrator] Collecting S2 (Social Reaction) for "${productName}"`);
      return collectS2(productName);
    })(),
    collectLimit(() => {
      console.log(`[Orchestrator] Collecting S3 (Web Reputation) for "${productName}"`);
      return collectS3(productName);
    }),
  ]);

  await onProgress?.({ message: "データ収集が完了しました。分析を開始します...", percent: 50, phase: "analyzing" });

  // Extract results (graceful degradation — partial data is OK)
  const s1Data: S1RawData[] = s1Result.status === "fulfilled" ? s1Result.value : [];
  const s2Data: S2RawData = s2Result.status === "fulfilled" ? s2Result.value : { tiktok: { videos: [], totalCount: 0 }, instagram: { videos: [], totalCount: 0 } };
  const s3Data: S3RawData[] = s3Result.status === "fulfilled" ? s3Result.value : [];

  // Log any collection failures
  if (s1Result.status === "rejected") console.error("[Orchestrator] S1 collection failed:", s1Result.reason);
  if (s2Result.status === "rejected") console.error("[Orchestrator] S2 collection failed:", s2Result.reason);
  if (s3Result.status === "rejected") console.error("[Orchestrator] S3 collection failed:", s3Result.reason);

  // ── Step 2: LLM Analysis ──
  await onProgress?.({ message: "AIがコンテキストを分析中...", percent: 60, phase: "analyzing" });

  const analysisResult = await analyzeWithBedrock(productName, s1Data, s2Data, s3Data);

  await onProgress?.({ message: "分析が完了しました", percent: 100, phase: "completed" });

  return { s1RawData: s1Data, s2RawData: s2Data, s3RawData: s3Data, analysisResult };
}
