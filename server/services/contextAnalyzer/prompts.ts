/**
 * Context Analyzer — Bedrock prompt definitions
 */

export const CONTEXT_ANALYZER_SYSTEM_PROMPT = `あなたはショート動画マーケティングの専門アナリストです。
商品のコンテキスト（文脈）を分析し、界雈マーケティングにおける「刺さる層」と「まだ届いていない層」を特定します。

分析の観点:
1. クライアントの発信意図と実際の反応のギャップ
2. SNS上での語られ方の偏り（どの「悩み」の文脈で語られているか）
3. Web上での評価と競合とのポジショニング差異
4. まだアプローチされていない「悩み層」の発掘

「悩み」の解像度に注意してください。
例: 「睡眠に悩んでる人」の中にも:
  - 枕が合わない人（モノ起点）
  - 寝る前の習慣が原因の人（行動起点）
  - そもそも寝付けない人（体質起点）
がいて、それぞれ刺さるコンテンツが違います。
この解像度で層を分類してください。

出力は指定のJSONスキーマに厳密に従ってください。
JSON以外のテキストは一切出力しないでください。`;

export function buildUserPrompt(
  productName: string,
  s1Data: string,
  s2Data: string,
  s3Data: string,
): string {
  return `# 分析対象商品: ${productName}

## セグメント1: クライアント発信（PR・公式情報）
${s1Data}

## セグメント2: SNS反応（TikTok・Instagram）
${s2Data}

## セグメント3: Web評判（レビュー・比較記事）
${s3Data}

上記3セグメントのデータを統合分析し、以下のJSONスキーマに従って結果を出力してください。`;
}

/**
 * JSON schema for the LLM output (used in response_format)
 */
export const ANALYSIS_RESULT_JSON_SCHEMA = {
  name: "context_analysis_result",
  schema: {
    type: "object",
    required: ["productName", "summary", "segments", "gapAnalysis", "contextMap"],
    properties: {
      productName: { type: "string" },
      summary: { type: "string", description: "全体のコンテキスト要約（3-5文）" },
      segments: {
        type: "object",
        required: ["clientIntent", "socialReaction", "webReputation"],
        properties: {
          clientIntent: {
            type: "object",
            required: ["mainMessage", "targetAudience", "keyPoints", "sources"],
            properties: {
              mainMessage: { type: "string" },
              targetAudience: { type: "string" },
              keyPoints: { type: "array", items: { type: "string" } },
              sources: { type: "array", items: { type: "object", properties: { url: { type: "string" }, title: { type: "string" }, snippet: { type: "string" } } } },
            },
          },
          socialReaction: {
            type: "object",
            properties: {
              tiktok: {
                type: "object",
                properties: {
                  dominantNarrative: { type: "string" },
                  engagementPatterns: { type: "array", items: { type: "string" } },
                  topHashtags: { type: "array", items: { type: "string" } },
                  videoCount: { type: "number" },
                  avgEngagementRate: { type: "number" },
                },
              },
              instagram: {
                type: "object",
                properties: {
                  dominantNarrative: { type: "string" },
                  engagementPatterns: { type: "array", items: { type: "string" } },
                  topHashtags: { type: "array", items: { type: "string" } },
                  videoCount: { type: "number" },
                  avgEngagementRate: { type: "number" },
                },
              },
            },
          },
          webReputation: {
            type: "object",
            required: ["overallSentiment", "strengths", "weaknesses", "comparisonContext", "sources"],
            properties: {
              overallSentiment: { type: "string", enum: ["positive", "neutral", "negative", "mixed"] },
              strengths: { type: "array", items: { type: "string" } },
              weaknesses: { type: "array", items: { type: "string" } },
              comparisonContext: { type: "string" },
              sources: { type: "array", items: { type: "object", properties: { url: { type: "string" }, title: { type: "string" }, snippet: { type: "string" } } } },
            },
          },
        },
      },
      gapAnalysis: {
        type: "object",
        required: ["reachedAudiences", "unreachedAudiences", "competitorGaps"],
        properties: {
          reachedAudiences: { type: "array", items: { type: "object", properties: { segment: { type: "string" }, strength: { type: "string", enum: ["high", "medium", "low"] }, evidence: { type: "string" } } } },
          unreachedAudiences: { type: "array", items: { type: "object", properties: { segment: { type: "string" }, opportunity: { type: "string" }, barrier: { type: "string" } } } },
          competitorGaps: { type: "array", items: { type: "object", properties: { competitor: { type: "string" }, theirStrength: { type: "string" }, ourWeakness: { type: "string" } } } },
        },
      },
      contextMap: {
        type: "array",
        items: {
          type: "object",
          properties: {
            context: { type: "string" },
            currentPresence: { type: "string", enum: ["strong", "weak", "absent"] },
            relevantPlatform: { type: "string", enum: ["tiktok", "instagram", "web"] },
            description: { type: "string" },
          },
        },
      },
    },
  },
  strict: false,
};
