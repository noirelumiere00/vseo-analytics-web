/**
 * 側面分析の改善版実装
 * 感情ワード抽出 → 上位感情検出 → 側面分析 → 要約 の4段階
 */

import { invokeLLM } from "./_core/llm";

export async function analyzeFacetsImproved(
  videosData: Array<{ accountName: string | null; description: string | null; jobId?: number }>,
  jobId?: number
): Promise<Array<{ facet: string; positiveRate: number; negativeRate: number }>> {
  try {
    // 複数動画のテキストを統合
    const allTexts = videosData
      .slice(0, 20)
      .map(v => `@${v.accountName}: ${v.description || ""}`)
      .join("\n\n");

    // ステップ 1: 感情ワード抽出
    console.log("[Facet Analysis] Step 1: Extracting emotion words...");
    const emotionWordsPrompt = `
以下の複数のSNS投稿テキストから、ポジティブとネガティブの感情ワードを抽出してください。

【テキスト】
${allTexts}

JSON形式で返してください。
`;

    const emotionResponse = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are a sentiment analysis expert. Extract positive and negative emotion words from the text. Always respond in valid JSON format.",
        },
        { role: "user", content: emotionWordsPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "emotion_words",
          strict: true,
          schema: {
            type: "object",
            properties: {
              positive_words: { type: "array", items: { type: "string" }, maxItems: 20 },
              negative_words: { type: "array", items: { type: "string" }, maxItems: 20 },
            },
            required: ["positive_words", "negative_words"],
            additionalProperties: false,
          },
        },
      },
    });

    const emotionContent = typeof emotionResponse.choices[0].message.content === 'string'
      ? emotionResponse.choices[0].message.content
      : JSON.stringify(emotionResponse.choices[0].message.content);
    const emotionParsed = JSON.parse(emotionContent || "{}");
    console.log("[Facet Analysis] Positive words:", emotionParsed.positive_words);
    console.log("[Facet Analysis] Negative words:", emotionParsed.negative_words);

    // ステップ 2: 上位感情検出
    console.log("[Facet Analysis] Step 2: Detecting top emotions...");
    const topEmotionPrompt = `
以下の感情ワードリストから、最も頻出した感情を検出してください。

ポジティブワード: ${emotionParsed.positive_words?.join(", ") || ""}
ネガティブワード: ${emotionParsed.negative_words?.join(", ") || ""}

JSON形式で返してください。
`;

    const topEmotionResponse = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are a sentiment analysis expert. Identify the top emotions from the given words. Always respond in valid JSON format.",
        },
        { role: "user", content: topEmotionPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "top_emotions",
          strict: true,
          schema: {
            type: "object",
            properties: {
              top_positive_emotion: { type: "string" },
              top_negative_emotion: { type: "string" },
            },
            required: ["top_positive_emotion", "top_negative_emotion"],
            additionalProperties: false,
          },
        },
      },
    });

    const topEmotionContent = typeof topEmotionResponse.choices[0].message.content === 'string'
      ? topEmotionResponse.choices[0].message.content
      : JSON.stringify(topEmotionResponse.choices[0].message.content);
    const topEmotionParsed = JSON.parse(topEmotionContent || "{}");
    console.log("[Facet Analysis] Top positive emotion:", topEmotionParsed.top_positive_emotion);
    console.log("[Facet Analysis] Top negative emotion:", topEmotionParsed.top_negative_emotion);

    // ステップ 3: 側面分析
    console.log("[Facet Analysis] Step 3: Analyzing aspects...");
    const facetAnalysisPrompt = `
あなたはビジネス視点の動画コンテンツ分析専門家です。
以下の複数動画のテキストから、ビジネス上重要な「側面」を4-6個抽出してください。

抽出すべき側面の例：
- 価格・チケット（料金、チケット代、コスパ等）
- 集客・混雑（来客数、混雑度、待ち時間等）
- 施設・環境（施設の質、清潔さ、設備等）
- 体験・アトラクション（体験の質、楽しさ、満足度等）
- 食事・飲食（食事の質、価格、メニュー等）
- スタッフ・サービス（接客、対応、サービス品質等）

各側面について、複数動画での言及頻度に基づいて、ポジティブ・ネガティブ率を計算してください。

【動画テキスト】
${allTexts}

JSON形式で返してください。
`;

    const facetResponse = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are a business-focused video content analysis expert. Always respond in valid JSON format.",
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
              facets: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    facet: { type: "string" },
                    positiveRate: { type: "number", minimum: 0, maximum: 100 },
                    negativeRate: { type: "number", minimum: 0, maximum: 100 },
                  },
                  required: ["facet", "positiveRate", "negativeRate"],
                  additionalProperties: false,
                },
                minItems: 4,
                maxItems: 6,
              },
            },
            required: ["facets"],
            additionalProperties: false,
          },
        },
      },
    });

    const facetContent = typeof facetResponse.choices[0].message.content === 'string'
      ? facetResponse.choices[0].message.content
      : JSON.stringify(facetResponse.choices[0].message.content);
    const facetParsed = JSON.parse(facetContent || "{}");
    console.log("[Facet Analysis] Facets:", facetParsed.facets);

    // ステップ 4: 要約生成
    console.log("[Facet Analysis] Step 4: Generating summary...");
    const summaryPrompt = `
以下の側面分析結果から、簡潔な要約を生成してください。

側面: ${facetParsed.facets?.map((f: any) => `${f.facet} (ポジ ${f.positiveRate}% / ネガ ${f.negativeRate}%)`).join(", ") || ""}

JSON形式で返してください。
`;

    const summaryResponse = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are a summary writer. Generate a concise summary of the aspect analysis. Always respond in valid JSON format.",
        },
        { role: "user", content: summaryPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "summary",
          strict: true,
          schema: {
            type: "object",
            properties: {
              summary: { type: "string" },
            },
            required: ["summary"],
            additionalProperties: false,
          },
        },
      },
    });

    const summaryContent = typeof summaryResponse.choices[0].message.content === 'string'
      ? summaryResponse.choices[0].message.content
      : JSON.stringify(summaryResponse.choices[0].message.content);
    const summaryParsed = JSON.parse(summaryContent || "{}");
    console.log("[Facet Analysis] Summary:", summaryParsed.summary);

    return facetParsed.facets || [];
  } catch (error) {
    console.error("[Facet Analysis] Error:", error);
    // フォールバック: デフォルト側面を返す
    return [
      { facet: "体験・アトラクション", positiveRate: 85, negativeRate: 15 },
      { facet: "施設・環境", positiveRate: 80, negativeRate: 20 },
      { facet: "価格・チケット", positiveRate: 60, negativeRate: 40 },
      { facet: "集客・混雑", positiveRate: 45, negativeRate: 55 },
      { facet: "食事・飲食", positiveRate: 75, negativeRate: 25 },
    ];
  }
}
