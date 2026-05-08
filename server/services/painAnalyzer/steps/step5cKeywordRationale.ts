/**
 * STEP 5c: Keyword Selection Rationale
 *
 * Takes quantified keywords (from STEP 5b) and generates LLM-based rationale:
 * - selectionRationale: Why this keyword was selected (or not)
 * - trendBackground: Why this keyword is rising/declining
 * - competitorKeywords: KWs that could compete but don't fit the product
 *
 * This makes the keyword selection table "語れる" instead of just "数字が並んでる".
 */
import pLimit from "p-limit";
import { invokeLLM, parseLLMJson } from "../../../_core/llm";
import type { ProgressFn } from "../schemas";

const llmLimit = pLimit(2);

interface KeywordCandidate {
  keyword: string;
  tiktokViews: number;
  tiktokPostCount: number;
  tiktokAvgER: number;
  instagramPostCount: number;
  xPostCount: number;
  xTotalLikes: number;
  googleTrend: "rising" | "stable" | "declining";
  googleTrendScore: number;
  monthlySearchVolume: number;
  competition: string;
  trend: "rising" | "stable" | "declining";
  selected: boolean;
  selectionRationale?: string;
  trendBackground?: string;
  competitorKeywords?: Array<{ keyword: string; reason: string }>;
  sources?: {
    tiktokSearchUrl?: string;
    instagramTagUrl?: string;
    xSearchUrl?: string;
    googleTrendsUrl?: string;
  };
  [key: string]: any;
}

interface Community {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  keywordCandidates?: KeywordCandidate[];
  [key: string]: any;
}

const RATIONALE_SYSTEM_PROMPT = `あなたは界隈マーケティングのアナリストです。
キーワードの定量データ(TikTok再生数/投稿数/ER、Instagram投稿数、X投稿数、Google Trends、月間検索Vol)を元に、「なぜこのキーワードが刺さる/刺さらないのか」を**界隈の文脈で**言語化します。

【記述ルール】
- 数字を必ず引用する ("ER 8.4%は界隈平均の2.6倍" など比較を含める)
- 「人気がある」「多い」等の定性表現は禁止
- 2-3文で簡潔に
- 選抜されなかったKWは「なぜ選抜しなかったか」を書く
- トレンドの背景は推測でOK（「〜が推測される」「〜の影響と考えられる」）`;

function buildRationalePrompt(
  productName: string,
  community: Community,
  candidates: KeywordCandidate[],
): string {
  const candidatesText = candidates
    .map((c, i) => {
      const trendLabel = c.googleTrend === "rising" ? "上昇" : c.googleTrend === "declining" ? "下降" : "維持";
      return `${i + 1}. "${c.keyword}" ${c.selected ? "【採用】" : "【非採用】"}
  - TT: ${c.tiktokViews.toLocaleString()}再生 / ${c.tiktokPostCount.toLocaleString()}投稿 / ER ${c.tiktokAvgER}%
  - IG: ${c.instagramPostCount.toLocaleString()}投稿
  - X: ${c.xPostCount}投稿 / いいね合計${c.xTotalLikes}
  - 月間検索: ${c.monthlySearchVolume.toLocaleString()} / 競合度: ${c.competition}
  - Google Trends: ${trendLabel} (スコア${c.googleTrendScore})`;
    })
    .join("\n\n");

  return `以下の商品×界隈のキーワード候補について、選抜理由とトレンド背景を記述してください。

## 商品名
${productName}

## 界隈
${community.name}: ${community.description}

## キーワード候補 (${candidates.length}件)
${candidatesText}

## 指示
各キーワードについて以下を出力してください:
- **selectionRationale**: なぜ採用/非採用なのか(数字引用必須)
- **trendBackground**: Google Trends が上昇/下降している背景の推測(1-2文)
- **competitorKeywords**: このKWと競合するが自商材には合わないKWを1-2個 (任意)

全体として、各界隈ごとに「このKW群で狙う理由」の総論も短く付けてください。`;
}

const RATIONALE_JSON_SCHEMA = {
  name: "keywordRationale",
  schema: {
    type: "object",
    properties: {
      keywords: {
        type: "array",
        items: {
          type: "object",
          properties: {
            keyword: { type: "string" },
            selectionRationale: { type: "string" },
            trendBackground: { type: "string" },
            competitorKeywords: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  keyword: { type: "string" },
                  reason: { type: "string" },
                },
                required: ["keyword", "reason"],
              },
            },
          },
          required: ["keyword", "selectionRationale", "trendBackground"],
        },
      },
    },
    required: ["keywords"],
  },
};

function buildSources(keyword: string): KeywordCandidate["sources"] {
  const encoded = encodeURIComponent(keyword.replace(/^#/, ""));
  return {
    tiktokSearchUrl: `https://www.tiktok.com/search?q=${encoded}`,
    instagramTagUrl: `https://www.instagram.com/explore/tags/${encoded}/`,
    xSearchUrl: `https://x.com/search?q=${encoded}&f=live`,
    googleTrendsUrl: `https://trends.google.co.jp/trends/explore?q=${encoded}&geo=JP`,
  };
}

export async function generateKeywordRationale(
  productName: string,
  communities: Community[],
  onProgress?: ProgressFn,
): Promise<Community[]> {
  await onProgress?.({ message: "キーワード選抜理由を生成中...", percent: 84, phase: "segmenting" });

  const total = communities.length;

  const results = await Promise.allSettled(
    communities.map((community, idx) =>
      llmLimit(async () => {
        const candidates = community.keywordCandidates || [];
        if (candidates.length === 0) return { communityId: community.id, rationales: [] };

        try {
          const result = await invokeLLM({
            messages: [
              { role: "system", content: RATIONALE_SYSTEM_PROMPT },
              { role: "user", content: buildRationalePrompt(productName, community, candidates) },
            ],
            maxTokens: 4096,
            responseFormat: { type: "json_schema", json_schema: RATIONALE_JSON_SCHEMA },
          });

          const parsed = parseLLMJson(result) as any;

          onProgress?.({
            message: `KW選抜理由生成中 (${idx + 1}/${total}: ${community.name})...`,
            percent: 84 + Math.round(((idx + 1) / total) * 3),
            phase: "segmenting",
          });

          return { communityId: community.id, rationales: parsed.keywords || [] };
        } catch (e) {
          console.warn(`[Step5c] Rationale generation failed for ${community.name}:`, e);
          return { communityId: community.id, rationales: [] };
        }
      })
    )
  );

  // Merge rationales back to keywordCandidates + add source URLs
  for (const community of communities) {
    const result = results.find(r => r.status === "fulfilled" && r.value.communityId === community.id);
    const rationales: any[] = result && result.status === "fulfilled" ? result.value.rationales : [];

    if (community.keywordCandidates) {
      community.keywordCandidates = community.keywordCandidates.map(c => {
        const rationale = rationales.find((r: any) => r.keyword === c.keyword);
        return {
          ...c,
          selectionRationale: rationale?.selectionRationale,
          trendBackground: rationale?.trendBackground,
          competitorKeywords: rationale?.competitorKeywords,
          sources: buildSources(c.keyword),
        };
      });
    }
  }

  console.log(`[Step5c] Keyword rationale generation complete for ${communities.length} communities`);
  return communities;
}
