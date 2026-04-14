/**
 * Pain Analyzer — Phase 2 Orchestrator
 *
 * STEP 4:  Pain Verification (X MCP + TikTok)
 * STEP 5:  Segment Classification (X MCP + LLM) — 5界隈固定 + 文化コード + GAP
 * STEP 5b: Keyword Quantification (TikTok + Instagram 実データ)
 * STEP 6:  Purchase Attitude Estimation (LLM)
 * STEP 7:  Proposal Generation (LLM)
 * STEP 7b: Kaiwai Creative Generation (5界隈×3KW×右脳左脳 = 30案)
 * STEP 8:  Genspark Markdown Export (27枚スライド構成)
 *
 * Triggered after user approves pain hypotheses.
 */
import * as db from "../../db";
import { verifyPains } from "./steps/step4PainVerification";
import { classifySegments } from "./steps/step5SegmentClassification";
import { quantifyKeywords } from "./steps/step5bKeywordQuantification";
import { estimatePurchaseAttitude } from "./steps/step6PurchaseAttitude";
import { generateProposals } from "./steps/step7ProposalGeneration";
import { generateKaiwaiCreatives } from "./steps/step7bKaiwaiCreative";
import { generateGensparkMarkdown } from "./steps/step8GensparkExport";
import type { PainHypothesis, ProductFeatures, ProgressFn } from "./schemas";
import type { S1RawData, S3RawData } from "../contextAnalyzer/schemas";

/**
 * Execute Phase 2 of pain analysis pipeline.
 * Reads approved hypotheses from DB, runs verification → Genspark export.
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

  // Prepare S1/S3 summaries for STEP 5 GAP analysis
  const s1Data = (row.s1RawData || []) as S1RawData[];
  const s3Data = (row.s3RawData || []) as S3RawData[];
  const s1Summary = s1Data.flatMap(d => d.results.map(r => `${r.title}: ${r.snippet}`)).join("\n").slice(0, 2000);
  const s3Summary = s3Data.flatMap(d => d.results.map(r => `${r.title}: ${r.snippet}`)).join("\n").slice(0, 2000);

  // ── STEP 4: Pain Verification ──
  await onProgress?.({ message: "ペインをSNSで検証中...", percent: 50, phase: "verifying" });

  const verificationData = await verifyPains(approvedPains, onProgress);

  await db.updatePainAnalysis(analysisId, {
    verificationData: verificationData,
    status: "segmenting",
  });

  // ── STEP 5: Segment Classification (5界隈固定 + 文化コード + GAP) ──
  await onProgress?.({ message: "界隈を発見・分類中...", percent: 70, phase: "segmenting" });

  const segmentData = await classifySegments(
    row.productName,
    verificationData.verifiedPains,
    verificationData.xPosts,
    verificationData.tiktokVideos,
    onProgress,
    s1Summary,
    s3Summary,
  );

  // ── STEP 5b: Keyword Quantification (TT/IG実データ) ──
  await onProgress?.({ message: "キーワードを定量検証中...", percent: 78, phase: "segmenting" });

  const enrichedCommunities = await quantifyKeywords(segmentData.communities, onProgress);
  segmentData.communities = enrichedCommunities as typeof segmentData.communities;

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

  await db.updatePainAnalysis(analysisId, {
    purchaseAttitudes: purchaseAttitudes,
    status: "proposing",
  });

  // ── STEP 7: Proposal Generation (従来の訴求案) ──
  await onProgress?.({ message: "訴求案を生成中...", percent: 88, phase: "proposing" });

  const { proposals, analysisResult } = await generateProposals(
    row.productName,
    segmentData.segments,
    purchaseAttitudes,
    features,
    verificationData.xPosts,
    verificationData.tiktokVideos,
    onProgress,
  );

  // ── STEP 7b: Kaiwai Creative Generation (30案) ──
  await onProgress?.({ message: "界隈別クリエイティブ案を生成中 (30案)...", percent: 90, phase: "proposing" });

  // Find primaryPain for each community from segments
  const communitiesWithPain = segmentData.communities.map(c => {
    const relatedSegment = segmentData.segments.find(s => s.communityIds.includes(c.id));
    return { ...c, primaryPain: relatedSegment?.primaryPain };
  });

  const kaiwaiCreatives = await generateKaiwaiCreatives(
    row.productName,
    communitiesWithPain,
    onProgress,
  );

  // ── STEP 8: Genspark Markdown Export ──
  await onProgress?.({ message: "Genspark用マークダウンを生成中...", percent: 96, phase: "proposing" });

  const gensparkMarkdown = generateGensparkMarkdown(
    row.productName,
    segmentData.communities,
    segmentData.segments,
    kaiwaiCreatives,
    approvedPains,
  );

  // ── Final: Save everything ──
  await db.updatePainAnalysis(analysisId, {
    proposals,
    kaiwaiCreatives,
    gensparkMarkdown,
    analysisResult: {
      ...analysisResult,
      totalPainsVerified: verificationData.verifiedPains.filter(p => p.verificationScore >= 0.3).length,
    },
    status: "completed",
    completedAt: new Date(),
    progress: { message: "分析が完了しました", percent: 100, phase: "completed" },
  });
}
