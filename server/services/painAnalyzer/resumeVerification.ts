/**
 * Pain Analyzer — Phase 2 Orchestrator
 *
 * STEP 4: Pain Verification (X MCP + TikTok)
 * STEP 5: Segment Classification (X MCP + LLM)
 * STEP 6: Purchase Attitude Estimation (LLM)
 * STEP 7: Proposal Generation (LLM)
 *
 * Triggered after user approves pain hypotheses.
 * Reads approved data from DB, executes STEP 4-7, writes results back.
 */
import * as db from "../../db";
import { verifyPains } from "./steps/step4PainVerification";
import { classifySegments } from "./steps/step5SegmentClassification";
import { estimatePurchaseAttitude } from "./steps/step6PurchaseAttitude";
import { generateProposals } from "./steps/step7ProposalGeneration";
import type { PainHypothesis, ProductFeatures, ProgressFn } from "./schemas";

/**
 * Execute Phase 2 of pain analysis pipeline.
 * Reads approved hypotheses from DB, runs verification → proposals.
 */
export async function executePainAnalysisPhase2(
  analysisId: number,
  onProgress?: ProgressFn,
): Promise<void> {
  const row = await db.getPainAnalysis(analysisId);
  if (!row) throw new Error(`Pain analysis ${analysisId} not found`);

  const approvedPains: PainHypothesis[] = (row.painHypotheses || []).filter(
    (h: any) => h.approved
  );
  const features: ProductFeatures = row.productFeatures as ProductFeatures;

  if (!features || approvedPains.length === 0) {
    throw new Error("No approved hypotheses or product features found");
  }

  // ── STEP 4: Pain Verification ──
  await onProgress?.({ message: "ペインをSNSで検証中...", percent: 50, phase: "verifying" });

  const verificationData = await verifyPains(approvedPains, onProgress);

  // Checkpoint: save verification data
  await db.updatePainAnalysis(analysisId, {
    verificationData: verificationData,
    status: "segmenting",
  });

  // ── STEP 5: Segment Classification ──
  await onProgress?.({ message: "セグメントを分類中...", percent: 70, phase: "segmenting" });

  const segmentData = await classifySegments(
    row.productName,
    verificationData.verifiedPains,
    verificationData.xPosts,
    verificationData.tiktokVideos,
    onProgress,
  );

  // Checkpoint: save segment data
  await db.updatePainAnalysis(analysisId, {
    segmentData: segmentData,
    status: "estimating",
  });

  // ── STEP 6: Purchase Attitude Estimation ──
  await onProgress?.({ message: "購買態度を推定中...", percent: 85, phase: "estimating" });

  const purchaseAttitudes = await estimatePurchaseAttitude(
    row.productName,
    segmentData.segments,
    verificationData.xPosts,
    onProgress,
  );

  // Checkpoint: save purchase attitudes
  await db.updatePainAnalysis(analysisId, {
    purchaseAttitudes: purchaseAttitudes,
    status: "proposing",
  });

  // ── STEP 7: Proposal Generation ──
  await onProgress?.({ message: "訴求案を生成中...", percent: 90, phase: "proposing" });

  const { proposals, analysisResult } = await generateProposals(
    row.productName,
    segmentData.segments,
    purchaseAttitudes,
    features,
    verificationData.xPosts,
    verificationData.tiktokVideos,
    onProgress,
  );

  // ── Final: Save everything ──
  await db.updatePainAnalysis(analysisId, {
    proposals,
    analysisResult: {
      ...analysisResult,
      totalPainsVerified: verificationData.verifiedPains.filter(p => p.verificationScore >= 0.3).length,
    },
    status: "completed",
    completedAt: new Date(),
    progress: { message: "分析が完了しました", percent: 100, phase: "completed" },
  });
}
