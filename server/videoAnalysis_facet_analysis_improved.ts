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

    // ステップ 1: 動画テキストから側面を動的に抽出
    const facetExtractionPrompt = `
あなたはビジネス視点の動画コンテンツ分析専門家です。
以下の複数動画のテキストから、実際に言及されている「ビジネス上重要な側面」を自動抽出してください。

【抽出のルール】
- 動画テキストに実際に言及されている側面のみを抽出してください
- 固有名詞（地名、施設名、製品名、ブランド名）は側面として抽出しないでください
- 例: 「沖縄」「ハリアー」「シャウエッセン」などは側面ではありません
- 感情や評価を表す言葉（良い、悪い、楽しい、つまらない等）ではなく、「何について」言及されているかを抽出してください
- 4-6個の側面を抽出してください

【動画テキスト】
${allTexts}

JSON形式で返してください。以下の形式で、抽出した側面のリストを返してください：
{
  "extracted_aspects": [
    "側面1",
    "側面2",
    ...
  ]
}
`;

    const extractionResponse = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are a business-focused video content analysis expert. Extract 4-6 main aspects that are actually mentioned in the given texts. Do NOT include proper nouns. Focus on what is being discussed, not emotional words. Always respond in valid JSON format.",
        },
        { role: "user", content: facetExtractionPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "aspect_extraction",
          strict: true,
          schema: {
            type: "object",
            properties: {
              extracted_aspects: {
                type: "array",
                items: { type: "string" },
                minItems: 4,
                maxItems: 6,
              },
            },
            required: ["extracted_aspects"],
            additionalProperties: false,
          },
        },
      },
    });

    let extractedAspects: string[] = [];
    try {
      const extractionContent = typeof extractionResponse.choices[0]?.message?.content === 'string'
        ? extractionResponse.choices[0].message.content
        : JSON.stringify(extractionResponse.choices[0]?.message?.content);
      
      const extractionParsed = JSON.parse(extractionContent || "{}");
      extractedAspects = extractionParsed.extracted_aspects || [];
      
      console.log("[Facet Analysis] Extracted aspects:", extractedAspects);
    } catch (error) {
      console.error("[Facet Analysis] Error extracting aspects:", error);
      return [];
    }

    if (extractedAspects.length === 0) {
      console.warn("[Facet Analysis] No aspects extracted");
      return [];
    }

    // ステップ 2: 各側面について、ポジティブ/ネガティブ比率を計算
    const aspectsWithSentiment = await Promise.all(
      extractedAspects.map(async (aspect) => {
        const sentimentAnalysisPrompt = `
以下の動画テキストから、「${aspect}」に関する言及を抽出し、ポジティブ/ネガティブ/ニュートラルの比率を計算してください。

【動画テキスト】
${allTexts}

【分析方法】
1. 「${aspect}」に言及している箇所を抽出
2. 各言及がポジティブ（肯定的、好評）か、ネガティブ（否定的、批判的）か、ニュートラルか判定
3. 比率を計算（ポジティブ + ネガティブ = 100%、ニュートラルは除外）

JSON形式で返してください：
{
  "aspect": "${aspect}",
  "positive_count": 数値,
  "negative_count": 数値,
  "neutral_count": 数値,
  "positive_percentage": 0-100の数値,
  "negative_percentage": 0-100の数値
}
`;

        try {
          const sentimentResponse = await invokeLLM({
            messages: [
              {
                role: "system",
                content: "You are a sentiment analysis expert. Analyze the sentiment of mentions about a specific aspect in the given texts. Classify each mention as positive, negative, or neutral. Calculate percentages based on positive and negative mentions only (excluding neutral). Always respond in valid JSON format.",
              },
              { role: "user", content: sentimentAnalysisPrompt },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "aspect_sentiment",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    aspect: { type: "string" },
                    positive_count: { type: "number", minimum: 0 },
                    negative_count: { type: "number", minimum: 0 },
                    neutral_count: { type: "number", minimum: 0 },
                    positive_percentage: { type: "number", minimum: 0, maximum: 100 },
                    negative_percentage: { type: "number", minimum: 0, maximum: 100 },
                  },
                  required: ["aspect", "positive_count", "negative_count", "neutral_count", "positive_percentage", "negative_percentage"],
                  additionalProperties: false,
                },
              },
            },
          });

          const sentimentContent = typeof sentimentResponse.choices[0]?.message?.content === 'string'
            ? sentimentResponse.choices[0].message.content
            : JSON.stringify(sentimentResponse.choices[0]?.message?.content);
          
          const sentimentParsed = JSON.parse(sentimentContent || "{}");
          
          console.log(`[Facet Analysis] Sentiment for "${aspect}":`, sentimentParsed);
          
          return {
            aspect: sentimentParsed.aspect || aspect,
            positive_percentage: sentimentParsed.positive_percentage || 50,
            negative_percentage: sentimentParsed.negative_percentage || 50,
          };
        } catch (error) {
          console.error(`[Facet Analysis] Error analyzing sentiment for "${aspect}":`, error);
          // フォールバック: 50/50 に設定
          return {
            aspect,
            positive_percentage: 50,
            negative_percentage: 50,
          };
        }
      })
    );

    console.log("[Facet Analysis] Final aspects with sentiment:", aspectsWithSentiment);

    return aspectsWithSentiment;

  } catch (error) {
    console.error("[Facet Analysis] Error:", error);
    return [];
  }
}
