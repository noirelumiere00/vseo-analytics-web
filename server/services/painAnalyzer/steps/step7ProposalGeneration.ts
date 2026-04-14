/**
 * STEP 7: Proposal Generation
 *
 * Uses LLM to generate segment-specific copy proposals,
 * hashtag sets, and priority action plans.
 * Also generates the final executive summary.
 */
import { invokeLLM } from "../../../_core/llm";
import {
  proposalSchema,
  PROPOSAL_JSON_SCHEMA,
  ANALYSIS_RESULT_JSON_SCHEMA,
  analysisResultSummarySchema,
  type Proposal,
  type PurchaseAttitude,
  type Segment,
  type ProductFeatures,
  type ProgressFn,
} from "../schemas";
import {
  PROPOSAL_SYSTEM_PROMPT,
  buildProposalPrompt,
  FINAL_SUMMARY_SYSTEM_PROMPT,
  buildFinalSummaryPrompt,
} from "../prompts";

interface XPostData {
  postId: string;
  text: string;
  authorUsername: string;
  likeCount: number;
  painId: string;
}

interface TTVideoData {
  videoId: string;
  desc: string;
  authorUniqueId: string;
  playCount: number;
  painId: string;
}

export async function generateProposals(
  productName: string,
  segments: Segment[],
  purchaseAttitudes: PurchaseAttitude[],
  features: ProductFeatures,
  xPosts: XPostData[],
  tiktokVideos: TTVideoData[],
  onProgress?: ProgressFn,
): Promise<{
  proposals: Proposal[];
  analysisResult: {
    executiveSummary: string;
    totalPainsVerified: number;
    totalSegments: number;
    topSegment: string;
    recommendations: string[];
    segmentBreakdown: Array<{
      segmentName: string;
      percentage: number;
      icon: string;
    }>;
  };
}> {
  await onProgress?.({ message: "訴求案をAIが生成中...", percent: 90, phase: "proposing" });

  const segmentInput = segments.map(s => ({
    id: s.id,
    name: s.name,
    primaryPain: s.primaryPain,
    appeals: s.appeals,
  }));

  const attitudeInput = purchaseAttitudes.map(a => ({
    segmentId: a.segmentId,
    attitude: a.attitude,
    priceRange: a.priceRange,
  }));

  // Generate proposals
  const proposalResult = await invokeLLM({
    messages: [
      { role: "system", content: PROPOSAL_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildProposalPrompt(productName, segmentInput, attitudeInput, features),
      },
    ],
    maxTokens: 8192,
    responseFormat: {
      type: "json_schema",
      json_schema: PROPOSAL_JSON_SCHEMA,
    },
  });

  const proposalText = typeof proposalResult.choices[0]?.message?.content === "string"
    ? proposalResult.choices[0].message.content
    : "";
  const parsedProposals = JSON.parse(proposalText);

  const proposals: Proposal[] = (parsedProposals.proposals || []).map((p: any) => {
    const validated = proposalSchema.safeParse(p);
    if (validated.success) return validated.data;
    return {
      segmentId: p.segmentId || "unknown",
      segmentName: p.segmentName || "不明",
      copyProposals: p.copyProposals || [],
      hashtagSets: p.hashtagSets || [],
      representativeContent: [],
      priorityActions: p.priorityActions || [],
    };
  });

  // Enrich proposals with representative content from actual posts
  for (const proposal of proposals) {
    const segmentPains = segments.find(s => s.id === proposal.segmentId);
    if (!segmentPains) continue;

    // Find top X posts related to this segment's pain
    const relatedXPosts = xPosts
      .filter(p => p.likeCount > 0)
      .sort((a, b) => b.likeCount - a.likeCount)
      .slice(0, 3);

    const relatedTTVideos = tiktokVideos
      .filter(v => v.playCount > 0)
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, 3);

    proposal.representativeContent = [
      ...relatedXPosts.map(p => ({
        platform: "x" as const,
        url: `https://x.com/${p.authorUsername}/status/${p.postId}`,
        description: p.text.slice(0, 100),
        engagement: p.likeCount,
      })),
      ...relatedTTVideos.map(v => ({
        platform: "tiktok" as const,
        url: `https://www.tiktok.com/@${v.authorUniqueId}/video/${v.videoId}`,
        description: v.desc.slice(0, 100),
        engagement: v.playCount,
      })),
    ];
  }

  // Generate final summary
  await onProgress?.({ message: "エグゼクティブサマリーを生成中...", percent: 95, phase: "proposing" });

  const topSegment = segments.reduce((a, b) => a.matchScore > b.matchScore ? a : b);

  const summaryResult = await invokeLLM({
    messages: [
      { role: "system", content: FINAL_SUMMARY_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildFinalSummaryPrompt(
          productName,
          segments.map(s => s.name),
          segments.length,
          topSegment.name,
        ),
      },
    ],
    maxTokens: 2048,
    responseFormat: {
      type: "json_schema",
      json_schema: ANALYSIS_RESULT_JSON_SCHEMA,
    },
  });

  const summaryText = typeof summaryResult.choices[0]?.message?.content === "string"
    ? summaryResult.choices[0].message.content
    : "";
  const parsedSummary = JSON.parse(summaryText);
  const validatedSummary = analysisResultSummarySchema.safeParse(parsedSummary);

  const analysisResult = validatedSummary.success
    ? validatedSummary.data
    : {
        executiveSummary: parsedSummary.executiveSummary || `${productName}のペイン分析が完了しました。`,
        totalPainsVerified: parsedSummary.totalPainsVerified || 0,
        totalSegments: segments.length,
        topSegment: topSegment.name,
        recommendations: parsedSummary.recommendations || [],
        segmentBreakdown: segments.map(s => ({
          segmentName: s.name,
          percentage: Math.round(s.matchScore * 100 / segments.reduce((sum, seg) => sum + seg.matchScore, 0)),
          icon: s.icon,
        })),
      };

  return { proposals, analysisResult };
}
