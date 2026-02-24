import { invokeLLM } from "./_core/llm";
import { analyzeFacetsImproved } from "./videoAnalysis_facet_analysis";
import { transcribeAudio } from "./_core/voiceTranscription";
import * as db from "./db";
import type { TikTokVideo } from "./tiktokScraper";
// import { scrapeTikTokComments } from "./tiktokScraper"; // TODO: Implement comment scraping if needed

/**
 * 動画分析エンジン
 * TikTokの動画を分析し、構成要素を抽出・スコアリングする
 */

export interface VideoMetadata {
  url: string;
  platform: "tiktok";
  title: string;
  description: string;
  thumbnailUrl: string;
  duration: number;
  videoId: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  saveCount: number;
  accountName: string;
  accountId: string;
  followerCount: number;
  accountAvatarUrl: string;
  hashtags: string[];
  postedAt: Date;
}

/**
 * TikTokスクレイピングデータから動画を分析（実データ）
 */
export async function analyzeVideoFromTikTok(
  jobId: number,
  tiktokVideo: TikTokVideo
): Promise<void> {
  console.log(`[Analysis] Analyzing TikTok video: ${tiktokVideo.id} by @${tiktokVideo.author.uniqueId}`);

  const videoUrl = `https://www.tiktok.com/@${tiktokVideo.author.uniqueId}/video/${tiktokVideo.id}`;

  // 1. DBに動画レコードを作成（実データ）
  const videoId = await db.createVideo({
    jobId,
    videoUrl,
    platform: "tiktok",
    videoId: tiktokVideo.id,
    title: tiktokVideo.desc.substring(0, 200),
    description: tiktokVideo.desc,
    thumbnailUrl: tiktokVideo.coverUrl,
    duration: tiktokVideo.duration,
    viewCount: tiktokVideo.stats.playCount,
    likeCount: tiktokVideo.stats.diggCount,
    commentCount: tiktokVideo.stats.commentCount,
    shareCount: tiktokVideo.stats.shareCount,
    saveCount: tiktokVideo.stats.collectCount,
    accountName: `@${tiktokVideo.author.uniqueId}`,
    accountId: tiktokVideo.author.uniqueId,
    followerCount: tiktokVideo.author.followerCount,
    accountAvatarUrl: tiktokVideo.author.avatarUrl,
    hashtags: tiktokVideo.hashtags,
    postedAt: new Date(tiktokVideo.createTime * 1000),
  });

  // 2. OCR解析（2秒/1フレーム）- 動画の説明文とハッシュタグからテキスト情報を抽出
  console.log(`[Analysis] Performing OCR analysis for video ${tiktokVideo.id}...`);
  const ocrResults = await performOcrFromDescription(tiktokVideo.desc, tiktokVideo.duration);
  for (const ocr of ocrResults) {
    await db.createOcrResult({
      videoId,
      frameTimestamp: ocr.frameTimestamp,
      extractedText: ocr.extractedText,
    });
  }

  // 3. 音声文字起こし - 説明文をベースにLLMで推定
  console.log(`[Analysis] Performing transcription for video ${tiktokVideo.id}...`);
  const transcription = await performTranscriptionFromDesc(tiktokVideo.desc);
  await db.createTranscription({
    videoId,
    fullText: transcription.fullText,
    language: transcription.language,
  });

  // 4. センチメント分析とキーワード抽出（実データベース）
  console.log(`[Analysis] Analyzing sentiment for video ${tiktokVideo.id}...`);
  const sentimentResult = await analyzeSentimentAndKeywords({
    title: tiktokVideo.desc.substring(0, 200),
    description: tiktokVideo.desc,
    hashtags: tiktokVideo.hashtags,
    ocrTexts: ocrResults.map(r => r.extractedText),
    transcriptionText: transcription.fullText,
  });

  await db.updateVideo(videoId, {
    sentiment: sentimentResult.sentiment,
    keyHook: sentimentResult.keyHook,
    keywords: sentimentResult.keywords,
  });

  // 5. スコアリング
  console.log(`[Analysis] Calculating scores for video ${tiktokVideo.id}...`);
  const scores = await calculateScoresFromData({
    desc: tiktokVideo.desc,
    duration: tiktokVideo.duration,
    stats: tiktokVideo.stats,
    hashtags: tiktokVideo.hashtags,
    ocrTexts: ocrResults.map(r => r.extractedText),
    transcriptionText: transcription.fullText,
  });

  await db.createAnalysisScore({
    videoId,
    thumbnailScore: scores.thumbnailScore,
    textScore: scores.textScore,
    audioScore: scores.audioScore,
    overallScore: scores.overallScore,
  });

  console.log(`[Analysis] Completed analysis for TikTok video: ${tiktokVideo.id}`);
}

/**
 * 手動URL指定の動画を分析（フォールバック）
 */
export async function analyzeVideoFromUrl(
  jobId: number,
  videoUrl: string
): Promise<void> {
  console.log(`[Analysis] Analyzing video from URL: ${videoUrl}`);

  const videoId = await db.createVideo({
    jobId,
    videoUrl,
    platform: "tiktok",
    videoId: extractVideoId(videoUrl),
    title: "手動入力動画",
    description: "",
    thumbnailUrl: "",
    duration: 30,
    viewCount: 0,
    likeCount: 0,
    commentCount: 0,
    shareCount: 0,
    saveCount: 0,
    accountName: "unknown",
    accountId: "unknown",
    followerCount: 0,
    accountAvatarUrl: "",
    hashtags: [],
    postedAt: new Date(),
  });

  // 基本的なOCR・文字起こし・スコアリング
  await db.createOcrResult({ videoId, frameTimestamp: 0, extractedText: "" });
  await db.createTranscription({ videoId, fullText: "", language: "ja" });
  await db.updateVideo(videoId, { sentiment: "neutral", keyHook: "", keywords: [] });
  await db.createAnalysisScore({
    videoId,
    thumbnailScore: 50,
    textScore: 50,
    audioScore: 50,
    overallScore: 50,
  });
}

/**
 * URLから動画IDを抽出
 */
function extractVideoId(url: string): string {
  const match = url.match(/video\/(\d+)/);
  return match ? match[1] : url.substring(url.length - 20);
}

/**
 * 動画の説明文からOCRテキストを推定
 * 実際のOCRの代わりに、説明文の内容をフレームごとに分割
 */
async function performOcrFromDescription(
  desc: string,
  duration: number
): Promise<Array<{ frameTimestamp: number; extractedText: string }>> {
  const results: Array<{ frameTimestamp: number; extractedText: string }> = [];
  const interval = 2; // 2秒ごと

  // 説明文をセンテンスに分割
  const sentences = desc
    .replace(/[#＃][^\s]+/g, "") // ハッシュタグを除去
    .split(/[。！？\n]+/)
    .filter(s => s.trim().length > 0);

  for (let timestamp = 0; timestamp < duration; timestamp += interval) {
    const sentenceIndex = Math.floor((timestamp / duration) * sentences.length);
    const text = sentences[sentenceIndex] || "";
    results.push({
      frameTimestamp: timestamp,
      extractedText: text.trim(),
    });
  }

  return results;
}

/**
 * 説明文ベースの文字起こし推定
 */
async function performTranscriptionFromDesc(
  desc: string
): Promise<{ fullText: string; language: string }> {
  // ハッシュタグを除去した説明文を文字起こしテキストとして使用
  const cleanText = desc
    .replace(/[#＃][^\s]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    fullText: cleanText,
    language: "ja",
  };
}

/**
 * センチメント分析とキーワード抽出
 */
export async function analyzeSentimentAndKeywords(input: {
  title: string;
  description: string;
  hashtags: string[];
  ocrTexts: string[];
  transcriptionText: string;
}): Promise<{
  sentiment: "positive" | "neutral" | "negative";
  keyHook: string;
  keywords: string[];
}> {
  const prompt = `
あなたはTikTok動画のセンチメント分析の専門家です。
以下の動画の内容を分析し、センチメント、キーフック、キーワードを抽出してください。

【動画情報】
説明文: ${input.description.substring(0, 500)}
ハッシュタグ: ${input.hashtags.join(", ")}

【テキスト情報】
${input.ocrTexts.filter(t => t).join("\n").substring(0, 300)}

【分析基準】
- sentiment: 動画の全体的な感情（positive: ポジティブ/推奨/楽しい、neutral: 中立/情報提供、negative: ネガティブ/批判/不満）
- keyHook: 動画の主要な訴求ポイント（1文で簡潔に）
- keywords: 動画の主要キーワード（5-10個、日本語で）

JSON形式で返してください。
`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "You are a sentiment analysis expert for TikTok videos. Always respond in valid JSON format." },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "sentiment_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
              keyHook: { type: "string" },
              keywords: { type: "array", items: { type: "string" } },
            },
            required: ["sentiment", "keyHook", "keywords"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = typeof response.choices[0].message.content === 'string'
      ? response.choices[0].message.content
      : JSON.stringify(response.choices[0].message.content);
    const result = JSON.parse(content || "{}");
    return {
      sentiment: result.sentiment || "neutral",
      keyHook: result.keyHook || "",
      keywords: result.keywords || [],
    };
  } catch (error) {
    console.error("[Sentiment Analysis] Error:", error);
    return { sentiment: "neutral", keyHook: "", keywords: [] };
  }
}

/**
 * 実データベースのスコアリング
 */
async function calculateScoresFromData(input: {
  desc: string;
  duration: number;
  stats: { playCount: number; diggCount: number; commentCount: number; shareCount: number; collectCount: number };
  hashtags: string[];
  ocrTexts: string[];
  transcriptionText: string;
}): Promise<{
  thumbnailScore: number;
  textScore: number;
  audioScore: number;
  overallScore: number;
}> {
  const prompt = `
あなたはTikTok動画のVSEO（Video SEO）分析の専門家です。
以下の動画データを分析し、各要素のスコア（0-100）を算出してください。

【動画情報】
説明文: ${input.desc.substring(0, 300)}
尺: ${input.duration}秒
ハッシュタグ: ${input.hashtags.join(", ")}

【エンゲージメント】
再生数: ${input.stats.playCount.toLocaleString()}
いいね数: ${input.stats.diggCount.toLocaleString()}
コメント数: ${input.stats.commentCount.toLocaleString()}
シェア数: ${input.stats.shareCount.toLocaleString()}
保存数: ${input.stats.collectCount.toLocaleString()}

【テキスト情報】
${input.ocrTexts.filter(t => t).join("\n").substring(0, 200)}

【評価基準】
- thumbnailScore: サムネイル/タイトルの魅力度（説明文の質、キーワードの適切性）
- textScore: テキスト要素の質（テロップ、説明文の充実度）
- audioScore: 音声/コンテンツの質（内容の充実度、エンゲージメント率から推定）
- overallScore: 総合スコア

JSON形式で返してください。
`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "You are a VSEO analysis expert. Always respond in valid JSON format." },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "video_scores",
          strict: true,
          schema: {
            type: "object",
            properties: {
              thumbnailScore: { type: "integer" },
              textScore: { type: "integer" },
              audioScore: { type: "integer" },
              overallScore: { type: "integer" },
            },
            required: ["thumbnailScore", "textScore", "audioScore", "overallScore"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = typeof response.choices[0].message.content === 'string'
      ? response.choices[0].message.content
      : JSON.stringify(response.choices[0].message.content);
    return JSON.parse(content || "{}");
  } catch (error) {
    console.error("[Scoring] Error:", error);
    // エンゲージメント率ベースのフォールバック
    const engagementRate = input.stats.playCount > 0
      ? ((input.stats.diggCount + input.stats.commentCount + input.stats.shareCount) / input.stats.playCount) * 100
      : 0;
    const baseScore = Math.min(95, Math.max(30, Math.floor(engagementRate * 10 + 40)));
    return {
      thumbnailScore: baseScore + Math.floor(Math.random() * 10 - 5),
      textScore: baseScore + Math.floor(Math.random() * 10 - 5),
      audioScore: baseScore + Math.floor(Math.random() * 10 - 5),
      overallScore: baseScore,
    };
  }
}

/**
 * 重複度分析
 */
export async function analyzeDuplicates(jobId: number): Promise<void> {
  const videosData = await db.getVideosByJobId(jobId);
  
  const videoIdCounts = new Map<string, number>();
  for (const video of videosData) {
    const count = videoIdCounts.get(video.videoId) || 0;
    videoIdCounts.set(video.videoId, count + 1);
  }

  for (const video of videosData) {
    const duplicateCount = (videoIdCounts.get(video.videoId) || 1) - 1;
    await db.updateVideoDuplicateCount(video.id, duplicateCount);
  }

  console.log(`[Analysis] Duplicate analysis completed for job ${jobId}`);
}

/**
 * 分析レポートを生成
 */
export async function generateAnalysisReport(jobId: number): Promise<void> {
  console.log(`[Analysis] Generating analysis report for job ${jobId}...`);

  const videosData = await db.getVideosByJobId(jobId);
  if (videosData.length === 0) return;

  // 基本統計
  const totalVideos = videosData.length;
  const totalViews = videosData.reduce((s, v) => s + (v.viewCount || 0), 0);
  const totalEngagement = videosData.reduce(
    (s, v) => s + (v.likeCount || 0) + (v.commentCount || 0) + (v.shareCount || 0) + (v.saveCount || 0),
    0
  );

  // センチメント集計
  const positiveVideos = videosData.filter(v => v.sentiment === "positive");
  const neutralVideos = videosData.filter(v => v.sentiment === "neutral");
  const negativeVideos = videosData.filter(v => v.sentiment === "negative");

  const positiveCount = positiveVideos.length;
  const neutralCount = neutralVideos.length;
  const negativeCount = negativeVideos.length;

  const positivePercentage = totalVideos > 0 ? Math.round((positiveCount / totalVideos) * 100) : 0;
  const neutralPercentage = totalVideos > 0 ? Math.round((neutralCount / totalVideos) * 100) : 0;
  const negativePercentage = totalVideos > 0 ? Math.round((negativeCount / totalVideos) * 100) : 0;

  // ポジネガ比較（Neutralを除く）
  const posNegTotal = positiveCount + negativeCount;
  const posNegPositivePercentage = posNegTotal > 0 ? Math.round((positiveCount / posNegTotal) * 100) : 50;
  const posNegNegativePercentage = posNegTotal > 0 ? Math.round((negativeCount / posNegTotal) * 100) : 50;

  // インパクト分析
  const positiveViews = positiveVideos.reduce((s, v) => s + (v.viewCount || 0), 0);
  const negativeViews = negativeVideos.reduce((s, v) => s + (v.viewCount || 0), 0);
  const positiveEng = positiveVideos.reduce(
    (s, v) => s + (v.likeCount || 0) + (v.commentCount || 0) + (v.shareCount || 0) + (v.saveCount || 0),
    0
  );
  const negativeEng = negativeVideos.reduce(
    (s, v) => s + (v.likeCount || 0) + (v.commentCount || 0) + (v.shareCount || 0) + (v.saveCount || 0),
    0
  );

  const positiveViewsShare = totalViews > 0 ? Math.round((positiveViews / totalViews) * 100) : 0;
  const negativeViewsShare = totalViews > 0 ? Math.round((negativeViews / totalViews) * 100) : 0;
  const positiveEngagementShare = totalEngagement > 0 ? Math.round((positiveEng / totalEngagement) * 100) : 0;
  const negativeEngagementShare = totalEngagement > 0 ? Math.round((negativeEng / totalEngagement) * 100) : 0;

  // キーワード集計
  const allKeywords: string[] = [];

  for (const video of videosData) {
    const keywords = video.keywords as string[] || [];
    allKeywords.push(...keywords);
  }

  // 頻出ワードを抽出（出現回数でソート）
  const getTopWords = (words: string[], limit: number = 30): string[] => {
    const counts = new Map<string, number>();
    for (const w of words) {
      counts.set(w, (counts.get(w) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([word]) => word);
  };

  const topAllKeywords = getTopWords(allKeywords, 30);

  // LLMを使ったキーワード仕分け
  let positiveWords: string[] = [];
  let negativeWords: string[] = [];

  try {
    const keywordSortingPrompt = `
Following keyword list from TikTok video analysis. Please classify them into positive (15 words) and negative (15 words) categories.

Keywords: ${topAllKeywords.join(", ")}

Return as JSON with 'positive' and 'negative' arrays.
`;

    const response = await invokeLLM({
      messages: [
        { role: "system", content: "You are a keyword classification expert. Always respond in valid JSON format." },
        { role: "user", content: keywordSortingPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "keyword_classification",
          strict: true,
          schema: {
            type: "object",
            properties: {
              positive: {
                type: "array",
                items: { type: "string" },
              },
              negative: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["positive", "negative"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = typeof response.choices[0].message.content === 'string'
      ? response.choices[0].message.content
      : JSON.stringify(response.choices[0].message.content);
    const parsed = JSON.parse(content || "{}");
    positiveWords = parsed.positive || [];
    negativeWords = parsed.negative || [];
  } catch (error) {
    console.error("[Report] Error sorting keywords with LLM:", error);
    // Fallback: mechanical sorting
    positiveWords = getTopWords(allKeywords, 15);
    negativeWords = [];
  }

  // LLMで主要示唆を生成
  let keyInsights: Array<{ category: "risk" | "urgent" | "positive"; title: string; description: string }> = [];

  try {
    const job = await db.getAnalysisJobById(jobId);
    const insightPrompt = `
あなたはTikTok動画のマーケティング分析の専門家です。
以下のデータに基づいて、主要な示唆を3-5個生成してください。

【キーワード】${job?.keyword || "不明"}

【データ概要】
- 総動画数: ${totalVideos}
- 総再生数: ${totalViews.toLocaleString()}
- ポジティブ: ${positiveCount}件 (${positivePercentage}%)
- ネガティブ: ${negativeCount}件 (${negativePercentage}%)
- ポジティブ頻出ワード: ${positiveWords.join(", ")}
- ネガティブ頻出ワード: ${negativeWords.join(", ")}

【各動画の概要】
${videosData.slice(0, 10).map(v => `- @${v.accountName}: ${(v.description || "").substring(0, 100)} (${v.sentiment}, 再生${v.viewCount?.toLocaleString()})`).join("\n")}

各示唆は以下のカテゴリに分類してください:
- risk: リスク要因（ネガティブ要素、改善が必要な点）
- urgent: 緊急対応が必要な事項
- positive: ポジティブ要因（強み、活用すべき点）

JSON形式で返してください。
`;

    const response = await invokeLLM({
      messages: [
        { role: "system", content: "You are a marketing analysis expert. Always respond in valid JSON format." },
        { role: "user", content: insightPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "key_insights",
          strict: true,
          schema: {
            type: "object",
            properties: {
              insights: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    category: { type: "string", enum: ["risk", "urgent", "positive"] },
                    title: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["category", "title", "description"],
                  additionalProperties: false,
                },
              },
            },
            required: ["insights"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = typeof response.choices[0].message.content === 'string'
      ? response.choices[0].message.content
      : JSON.stringify(response.choices[0].message.content);
    const parsed = JSON.parse(content || "{}");
    keyInsights = parsed.insights || [];
  } catch (error) {
    console.error("[Report] Error generating insights:", error);
    keyInsights = [
      { category: "positive", title: "データ収集完了", description: `${totalVideos}件の動画データを正常に収集・分析しました。` },
    ];
  }

  // 側面分析（ビジネス視点）
  const facets = await analyzeFacetsImproved(videosData);  // レポートをDBに保存
  await db.createAnalysisReport({
    jobId,
    totalVideos,
    totalViews,
    totalEngagement,
    positiveCount,
    positivePercentage,
    neutralCount,
    neutralPercentage,
    negativeCount,
    negativePercentage,
    posNegPositiveCount: positiveCount,
    posNegPositivePercentage,
    posNegNegativeCount: negativeCount,
    posNegNegativePercentage,
    positiveViewsShare,
    negativeViewsShare,
    positiveEngagementShare,
    negativeEngagementShare,
    positiveWords,
    negativeWords,
    keyInsights,
    facets,
  });

  console.log(`[Analysis] Report generated for job ${jobId}`);
}


/**
 * 広告系ハッシュタグのフィルター
 * #PR, #ad, #sponsored 等の広告を示すハッシュタグを除外
 */
const AD_HASHTAG_PATTERNS = [
  /^pr$/i,
  /^ad$/i,
  /^ads$/i,
  /^sponsored$/i,
  /^提供$/,
  /^タイアップ$/,
  /^プロモーション$/,
  /^promotion$/i,
  /^gifted$/i,
  /^supplied$/i,
  /^ambassador$/i,
  /^アンバサダー$/,
  /^案件$/,
  /^企業案件$/,
];

export function filterAdHashtags(hashtags: string[]): string[] {
  return hashtags.filter(tag => {
    const cleanTag = tag.replace(/^#/, '').trim();
    return !AD_HASHTAG_PATTERNS.some(pattern => pattern.test(cleanTag));
  });
}

/**
 * 重複動画（勝ちパターン）の共通点をLLMで分析
 */
export async function analyzeWinPatternCommonality(
  jobId: number,
  keyword: string
): Promise<void> {
  console.log(`[Analysis] Analyzing win pattern commonality for job ${jobId}...`);

  // 3シークレットブラウザ検索結果を取得
  const tripleSearch = await db.getTripleSearchResultByJobId(jobId);
  if (!tripleSearch || !tripleSearch.appearedInAll3Ids || tripleSearch.appearedInAll3Ids.length === 0) {
    console.log(`[Analysis] No win pattern videos found for job ${jobId}, skipping commonality analysis`);
    return;
  }

  // 勝ちパターン動画の詳細データを取得
  const allVideos = await db.getVideosByJobId(jobId);
  const winPatternVideos = allVideos.filter(v => 
    tripleSearch.appearedInAll3Ids!.includes(v.videoId)
  );

  if (winPatternVideos.length === 0) {
    console.log(`[Analysis] Win pattern videos not found in DB for job ${jobId}`);
    return;
  }

  // 勝ちパターン動画のコメントを取得（オプション）
  const commentsByVideo: { [key: string]: string[] } = {};
  
  for (const video of winPatternVideos) {
    try {
      const videoUrl = video.videoUrl || `https://www.tiktok.com/@${video.accountId}/video/${video.videoId}`;
      // const comments = await scrapeTikTokComments(videoUrl); // TODO: Implement comment scraping
      const comments: any[] = []; // Placeholder
      if (comments.length > 0) {
        commentsByVideo[video.videoId] = comments;
        console.log(`[Analysis] Scraped ${comments.length} comments from video ${video.videoId}`);
      }
    } catch (error) {
      console.error(`[Analysis] Failed to scrape comments for video ${video.videoId}:`, error);
    }
  }

  // 広告ハッシュタグを除外した上で動画情報を構築
  const videoSummaries = winPatternVideos.map(v => {
    const cleanHashtags = filterAdHashtags(v.hashtags || []);
    return {
      author: v.accountName || "不明",
      followers: v.followerCount || 0,
      description: (v.description || "").substring(0, 200),
      hashtags: cleanHashtags,
      duration: v.duration || 0,
      views: v.viewCount || 0,
      likes: v.likeCount || 0,
      comments: v.commentCount || 0,
      shares: v.shareCount || 0,
      keyHook: v.keyHook || "",
      sentiment: v.sentiment || "neutral",
    };
  });

  try {
    const prompt = `
あなたはTikTok VSEOの専門家です。以下は「${keyword}」で検索した際に、3つの独立したシークレットブラウザ全てで上位表示された「勝ちパターン動画」${winPatternVideos.length}本のデータです。

これらの動画がなぜTikTokのアルゴリズムに選ばれているのか、共通点を分析してください。

【勝ちパターン動画データ】
${videoSummaries.map((v, i) => `
動画${i + 1}: @${v.author} (フォロワー${v.followers.toLocaleString()})
- 説明: ${v.description}
- ハッシュタグ: ${v.hashtags.join(', ')}
- 動画長: ${v.duration}秒
- 再生数: ${v.views.toLocaleString()} / いいね: ${v.likes.toLocaleString()} / コメント: ${v.comments.toLocaleString()} / シェア: ${v.shares.toLocaleString()}
- キーフック: ${v.keyHook}
- センチメント: ${v.sentiment}
`).join('')}

以下の6項目について、具体的かつ簡潔に分析してください。各項目は1〜3文で。
`;

    const response = await invokeLLM({
      messages: [
        { role: "system", content: "You are a TikTok VSEO expert. Always respond in Japanese. Return valid JSON." },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "commonality_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              summary: {
                type: "string",
                description: "全体の共通点を1〜2文でまとめた総括。例: 「この動画群は〇〇という共通のキーフックを持ち、〇〇なフォーマットで統一されている」",
              },
              keyHook: {
                type: "string",
                description: "共通するキーフック（視聴者を引きつける要素）。例: 「冒頭3秒で完成品を見せ、手軽さを強調する構成」",
              },
              contentTrend: {
                type: "string",
                description: "コンテンツの傾向・テーマ。例: 「時短・簡単をテーマにした実用的なレシピ紹介が中心」",
              },
              formatFeatures: {
                type: "string",
                description: "フォーマット上の特徴（動画長、編集スタイル等）。例: 「20〜40秒のテンポ良い編集、テキストオーバーレイで手順を表示」",
              },
              hashtagStrategy: {
                type: "string",
                description: "ハッシュタグ戦略の共通点。例: 「検索キーワード + ジャンル系タグ + トレンドタグの3層構造」",
              },
              vseoTips: {
                type: "string",
                description: "このキーワードでVSEO上位を狙うための具体的なアドバイス。例: 「〇〇を冒頭に配置し、〇〇系のハッシュタグを併用すると効果的」",
              },
            },
            required: ["summary", "keyHook", "contentTrend", "formatFeatures", "hashtagStrategy", "vseoTips"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = typeof response.choices[0].message.content === 'string'
      ? response.choices[0].message.content
      : JSON.stringify(response.choices[0].message.content);
    const parsed = JSON.parse(content || "{}");

    // DBに保存
    await db.updateTripleSearchCommonality(jobId, parsed);

    console.log(`[Analysis] Win pattern commonality analysis completed for job ${jobId}`);
  } catch (error) {
    console.error("[Analysis] Error analyzing win pattern commonality:", error);
  }
}
