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
以下の複数動画のテキストから、ビジネス上重要な「側面」を4-6個抽出してください。

【抽出すべき側面の例】
- 価格・チケット（料金、チケット代、コスパ等）
- 集客・混雑（来客数、混雑度、待ち時間等）
- 施設・環境（施設の質、清潔さ、設備等）
- 体験・アトラクション（体験の質、楽しさ、満足度等）
- 食事・飲食（食事の質、価格、メニュー等）
- スタッフ・サービス（接客、対応、サービス品質等）

【重要な注意事項】
- 固有名詞（地名、施設名、製品名、ブランド名）は側面として抽出しないでください
- 例: 「沖縄」「ジャングリア」「シャウエッセン」などは側面ではありません
- 感情を表す言葉のみを側面として抽出してください

各側面について、複数動画での言及頻度に基づいて、ポジティブ・ネガティブ率を計算してください。

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
    if (!facetResponse.choices || !facetResponse.choices[0] || !facetResponse.choices[0].message) {
      throw new Error("Invalid LLM response structure");
    }

    const facetContent = typeof facetResponse.choices[0].message.content === 'string'
      ? facetResponse.choices[0].message.content
      : JSON.stringify(facetResponse.choices[0].message.content);
    
    const facetParsed = JSON.parse(facetContent || "{}");
    
    if (!facetParsed.aspect_analysis || !Array.isArray(facetParsed.aspect_analysis)) {
      console.warn("[Facet Analysis] No aspect_analysis in response:", facetParsed);
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
