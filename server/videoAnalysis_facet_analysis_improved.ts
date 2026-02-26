/**
 * 側面分析の改善版実装
 * 実データに基づいて動的に側面を抽出し、ポジティブ/ネガティブ比率を計算
 */

import { invokeLLM } from "./_core/llm";

export async function analyzeFacetsImproved(
  videosData: Array<{ accountName: string | null; description: string | null; sentiment?: string | null; jobId?: number }>,
  jobId?: number
): Promise<Array<{ aspect: string; positive_percentage: number; negative_percentage: number }>> {
  try {
    // 同じ jobId の動画のみをフィルタリング
    const filteredVideos = jobId 
      ? videosData.filter(v => v.jobId === jobId).slice(0, 20)
      : videosData.slice(0, 20);
    
    if (filteredVideos.length === 0) {
      console.warn("[Facet Analysis] No videos found for jobId:", jobId);
      return [];
    }

    // 複数動画のテキストを統合（センチメント情報も含める）
    const allTexts = filteredVideos
      .map(v => `@${v.accountName} [${v.sentiment || 'neutral'}]: ${v.description || ""}`)
      .join("\n\n");

    console.log("[Facet Analysis] Analyzing facets for jobId:", jobId);
    console.log("[Facet Analysis] Total videos:", filteredVideos.length);

    // 側面の抽出とポジネガ比率を1回のLLMコールで取得
    const facetPrompt = `
あなたはビジネス視点の動画コンテンツ分析専門家です。
以下の複数動画のテキストから、実際に言及されている「ビジネス上重要な側面」を4-6個抽出し、各側面のポジティブ/ネガティブ比率を計算してください。

【抽出のルール】
- 動画テキストに実際に言及されている側面のみを抽出してください
- 固有名詞（地名、施設名、製品名、ブランド名）は側面として抽出しないでください
- 感情や評価を表す言葉ではなく、「何について」言及されているかを抽出してください
- 各側面の比率: ポジティブ + ネガティブ = 100%（ニュートラルは除外）

【動画テキスト】
${allTexts}
`;

    const facetResponse = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are a business-focused video content analysis expert. Extract 4-6 main aspects actually mentioned in the texts (no proper nouns) and calculate positive/negative sentiment percentages for each aspect. Always respond in valid JSON format.",
        },
        { role: "user", content: facetPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "facet_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              aspects: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    aspect: { type: "string" },
                    positive_percentage: { type: "number", minimum: 0, maximum: 100 },
                    negative_percentage: { type: "number", minimum: 0, maximum: 100 },
                  },
                  required: ["aspect", "positive_percentage", "negative_percentage"],
                  additionalProperties: false,
                },
                minItems: 4,
                maxItems: 6,
              },
            },
            required: ["aspects"],
            additionalProperties: false,
          },
        },
      },
    });

    const facetContent = typeof facetResponse.choices[0]?.message?.content === 'string'
      ? facetResponse.choices[0].message.content
      : JSON.stringify(facetResponse.choices[0]?.message?.content);

    let aspectsWithSentiment: Array<{ aspect: string; positive_percentage: number; negative_percentage: number }> = [];
    try {
      const parsed = JSON.parse(facetContent || "{}");
      aspectsWithSentiment = parsed.aspects || [];
      console.log("[Facet Analysis] Aspects with sentiment:", aspectsWithSentiment);
    } catch (error) {
      console.error("[Facet Analysis] Error parsing facet response:", error);
      return [];
    }

    if (aspectsWithSentiment.length === 0) {
      console.warn("[Facet Analysis] No aspects returned");
      return [];
    }

    return aspectsWithSentiment;

  } catch (error) {
    console.error("[Facet Analysis] Error:", error);
    return [];
  }
}
