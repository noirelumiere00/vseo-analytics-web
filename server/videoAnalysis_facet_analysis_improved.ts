/**
 * 側面分析の改善版実装
 * 参考資料に基づいた実装
 */

import { invokeLLM } from "./_core/llm";

export async function analyzeFacetsImproved(
  videosData: Array<{ accountName: string | null; description: string | null; jobId?: number }>,
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

    // 複数動画のテキストを統合
    const allTexts = filteredVideos
      .map(v => `@${v.accountName}: ${v.description || ""}`)
      .join("\n\n");

    console.log("[Facet Analysis] Analyzing facets for jobId:", jobId);
    console.log("[Facet Analysis] Total videos:", filteredVideos.length);

    // LLM プロンプト生成
    const facetAnalysisPrompt = `
あなたはビジネス視点の動画コンテンツ分析専門家です。
以下の複数動画のテキストから、対象を評価する上で重要な「側面」、4-6個を動的に抽出してください。

【重要な注意事項】
- 固有名詞（地名、施設名、製品名、ブランド名）は側面として抽出しないでくだい
- 感情を表す言葉、体験的な特性、ビジネス上の評価身を側面として抽出してください
- 例：「価格・コスト」「品質・性能」「デザイン・外観」「サービス・対応」「信頻性・安全性」「使いやすさ・利便性」など

各側面について、複数動画での言及頻度に基づいて、ポジティブ・ネガティブ率（％）を計算してください。

【動画テキスト】
${allTexts}

JSON形式で返してください。
`;

    const facetResponse = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are a business-focused video content analysis expert. Extract 4-6 main aspects from the given texts. Do NOT include proper nouns (place names, facility names, product names, brand names) as aspects. Always respond in valid JSON format.",
        },
        { role: "user", content: facetAnalysisPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "facet_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              aspect_analysis: {
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
            required: ["aspect_analysis"],
            additionalProperties: false,
          },
        },
      },
    });

    // LLM 応答を解析
    console.log("[Facet Analysis] LLM Response:", JSON.stringify(facetResponse, null, 2).substring(0, 500));
    
    if (!facetResponse.choices || !facetResponse.choices[0] || !facetResponse.choices[0].message) {
      console.error("[Facet Analysis] Invalid LLM response structure:", facetResponse);
      // エラー時は空配列を返す
      return [];
    }

    const facetContent = typeof facetResponse.choices[0].message.content === 'string'
      ? facetResponse.choices[0].message.content
      : JSON.stringify(facetResponse.choices[0].message.content);
    
    console.log("[Facet Analysis] Parsed content:", facetContent.substring(0, 300));
    
    const facetParsed = JSON.parse(facetContent || "{}");
    
    if (!facetParsed.aspect_analysis || !Array.isArray(facetParsed.aspect_analysis)) {
      console.warn("[Facet Analysis] No aspect_analysis in response:", facetParsed);
      // エラー時は空配列を返す
      return [];
    }

    console.log("[Facet Analysis] Extracted facets:", facetParsed.aspect_analysis);

    // 出力形式に変換（参考資料に合わせる）
    return facetParsed.aspect_analysis.map((a: any) => ({
      aspect: a.aspect,
      positive_percentage: a.positive_percentage,
      negative_percentage: a.negative_percentage,
    }));

  } catch (error) {
    console.error("[Facet Analysis] Error:", error);
    return [];
  }
}
