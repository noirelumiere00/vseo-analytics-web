/**
 * STEP 6: Purchase Attitude Estimation
 *
 * Uses X post data + LLM to estimate purchase attitudes per segment.
 */
import { invokeLLM } from "../../../_core/llm";
import {
  purchaseAttitudeSchema,
  PURCHASE_ATTITUDE_JSON_SCHEMA,
  type PurchaseAttitude,
  type Segment,
  type ProgressFn,
} from "../schemas";
import {
  PURCHASE_ATTITUDE_SYSTEM_PROMPT,
  buildPurchaseAttitudePrompt,
} from "../prompts";

interface XPostData {
  postId: string;
  text: string;
  authorUsername: string;
  authorId: string;
  likeCount: number;
  retweetCount: number;
  painId: string;
  relevanceScore: number;
}

export async function estimatePurchaseAttitude(
  productName: string,
  segments: Segment[],
  xPosts: XPostData[],
  onProgress?: ProgressFn,
): Promise<PurchaseAttitude[]> {
  await onProgress?.({ message: "購買態度をAIが推定中...", percent: 85, phase: "estimating" });

  // Prepare X posts sample for purchase attitude analysis
  const xPostsSample = xPosts
    .sort((a, b) => b.likeCount - a.likeCount)
    .slice(0, 50)
    .map(p => `@${p.authorUsername}: ${p.text.slice(0, 200)} (${p.likeCount}いいね)`)
    .join("\n")
    .slice(0, 4000);

  const segmentInput = segments.map(s => ({
    id: s.id,
    name: s.name,
    primaryPain: s.primaryPain,
    appeals: s.appeals,
  }));

  const result = await invokeLLM({
    messages: [
      { role: "system", content: PURCHASE_ATTITUDE_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildPurchaseAttitudePrompt(productName, segmentInput, xPostsSample),
      },
    ],
    maxTokens: 4096,
    responseFormat: {
      type: "json_schema",
      json_schema: PURCHASE_ATTITUDE_JSON_SCHEMA,
    },
  });

  const text = typeof result.choices[0]?.message?.content === "string"
    ? result.choices[0].message.content
    : "";
  const parsed = JSON.parse(text);

  const attitudes: PurchaseAttitude[] = (parsed.attitudes || []).map((att: any) => {
    const validated = purchaseAttitudeSchema.safeParse(att);
    if (validated.success) return validated.data;
    return {
      segmentId: att.segmentId || "unknown",
      attitude: att.attitude || "不明",
      priceRange: att.priceRange || "不明",
      purchaseDrivers: att.purchaseDrivers || [],
      purchaseBarriers: att.purchaseBarriers || [],
      evidence: att.evidence || [],
    };
  });

  // Ensure all segments have an attitude entry
  for (const segment of segments) {
    if (!attitudes.find(a => a.segmentId === segment.id)) {
      attitudes.push({
        segmentId: segment.id,
        attitude: "データ不足のため推定不可",
        priceRange: "不明",
        purchaseDrivers: [],
        purchaseBarriers: [],
        evidence: [],
      });
    }
  }

  return attitudes;
}
