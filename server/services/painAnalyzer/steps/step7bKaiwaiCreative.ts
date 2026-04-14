/**
 * STEP 7b: Kaiwai Creative Generation
 *
 * Generates 30 creative proposals: 5 communities × 3 keywords × 2 axes (right/left brain).
 * Calls LLM once per community (5 calls × 6 proposals each).
 */
import pLimit from "p-limit";
import { invokeLLM } from "../../../_core/llm";
import {
  kaiwaiCreativeSchema,
  KAIWAI_CREATIVE_JSON_SCHEMA,
  type KaiwaiCreative,
  type ProgressFn,
} from "../schemas";
import {
  KAIWAI_CREATIVE_SYSTEM_PROMPT,
  buildKaiwaiCreativePrompt,
} from "../prompts";

const llmLimit = pLimit(2);

interface CommunityWithKeywords {
  id: string;
  name: string;
  keywords: string[];
  primaryPain?: string;
  keywordCandidates?: Array<{
    keyword: string;
    selected: boolean;
    [key: string]: any;
  }>;
  [key: string]: any;
}

export async function generateKaiwaiCreatives(
  productName: string,
  communities: CommunityWithKeywords[],
  onProgress?: ProgressFn,
): Promise<KaiwaiCreative[]> {
  await onProgress?.({ message: "界隈別クリエイティブ案を生成中...", percent: 90, phase: "proposing" });

  const allCreatives: KaiwaiCreative[] = [];
  const total = communities.length;

  const results = await Promise.allSettled(
    communities.map((community, idx) =>
      llmLimit(async () => {
        // Get selected keywords (top 3)
        const selectedKeywords = (community.keywordCandidates || [])
          .filter(k => k.selected)
          .map(k => k.keyword)
          .slice(0, 3);

        // Fallback: use first 3 keywords from community if no candidates
        const keywords = selectedKeywords.length >= 3
          ? selectedKeywords
          : community.keywords.slice(0, 3);

        if (keywords.length === 0) return [];

        onProgress?.({
          message: `クリエイティブ生成中 (${idx + 1}/${total}: ${community.name})...`,
          percent: 90 + Math.round(((idx + 1) / total) * 5),
          phase: "proposing",
        });

        const result = await invokeLLM({
          messages: [
            { role: "system", content: KAIWAI_CREATIVE_SYSTEM_PROMPT },
            {
              role: "user",
              content: buildKaiwaiCreativePrompt(productName, community, keywords),
            },
          ],
          maxTokens: 4096,
          responseFormat: {
            type: "json_schema",
            json_schema: KAIWAI_CREATIVE_JSON_SCHEMA,
          },
        });

        const text = typeof result.choices[0]?.message?.content === "string"
          ? result.choices[0].message.content
          : "";
        const parsed = JSON.parse(text);
        const creatives = (parsed.creatives || []).map((c: any) => {
          const validated = kaiwaiCreativeSchema.safeParse(c);
          if (validated.success) return validated.data;
          return {
            communityId: c.communityId || community.id,
            communityName: c.communityName || community.name,
            keyword: c.keyword || "",
            axis: c.axis || "right-brain",
            headline: c.headline || "",
            body: c.body || "",
            visualConcept: c.visualConcept || "",
          } satisfies KaiwaiCreative;
        });

        return creatives as KaiwaiCreative[];
      })
    )
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      allCreatives.push(...result.value);
    } else if (result.status === "rejected") {
      console.warn("[PainAnalyzer/Step7b] Creative generation failed for a community:", result.reason);
    }
  }

  console.log(`[PainAnalyzer/Step7b] Generated ${allCreatives.length} kaiwai creatives`);
  return allCreatives;
}
