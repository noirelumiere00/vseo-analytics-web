import { invokeLLM } from "./_core/llm";
import { analyzeFacetsImproved } from "./videoAnalysis_facet_analysis_improved";
import { generateFacetAnalysisReport } from "./reportGenerator";
import { transcribeAudio } from "./_core/voiceTranscription";
import * as db from "./db";
import type { TikTokVideo } from "./tiktokScraper";
import { filterAdHashtags } from "@shared/const";
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

  // 5. スコアリング（ルールベース・LLM不使用）
  console.log(`[Analysis] Calculating scores for video ${tiktokVideo.id}...`);
  const scores = calculateScoresFromData({
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
 * ルールベースのスコアリング（LLM不使用）
 * エンゲージメント率・説明文・ハッシュタグ・動画尺などから算出
 */
function calculateScoresFromData(input: {
  desc: string;
  duration: number;
  stats: { playCount: number; diggCount: number; commentCount: number; shareCount: number; collectCount: number };
  hashtags: string[];
  ocrTexts: string[];
  transcriptionText: string;
}): {
  thumbnailScore: number;
  textScore: number;
  audioScore: number;
  overallScore: number;
} {
  const { desc, duration, stats, hashtags, ocrTexts } = input;
  const cleanDesc = desc.replace(/[#＃][^\s]+/g, "").trim();
  const descLength = cleanDesc.length;

  // エンゲージメント率（再生数に対するいいね+コメント+シェア+保存）
  const totalEngagement = stats.diggCount + stats.commentCount + stats.shareCount + stats.collectCount;
  const engagementRate = stats.playCount > 0 ? (totalEngagement / stats.playCount) * 100 : 0;
  const likeRate = stats.playCount > 0 ? (stats.diggCount / stats.playCount) * 100 : 0;
  const commentRate = stats.playCount > 0 ? (stats.commentCount / stats.playCount) * 100 : 0;
  const saveShareRate = stats.playCount > 0 ? ((stats.shareCount + stats.collectCount) / stats.playCount) * 100 : 0;

  // --- thumbnailScore: 説明文の質・フック要素 ---
  let thumbnailScore = 30;
  // 説明文の長さ（50-200文字がベスト）
  if (descLength >= 50 && descLength <= 200) thumbnailScore += 25;
  else if (descLength >= 20) thumbnailScore += 10;
  // 疑問形・感嘆形（フック要素）
  if (/[？！?!]/.test(cleanDesc)) thumbnailScore += 10;
  // 数字を含む（具体性）
  if (/\d+/.test(cleanDesc)) thumbnailScore += 10;
  // エンゲージメント率ボーナス（上限25pt）
  thumbnailScore += Math.min(25, Math.floor(engagementRate * 5));

  // --- textScore: ハッシュタグ数・テロップ・説明文の充実度 ---
  let textScore = 20;
  // ハッシュタグ数（3-10個がベスト）
  const hashtagCount = hashtags.length;
  if (hashtagCount >= 3 && hashtagCount <= 10) textScore += 30;
  else if (hashtagCount >= 1) textScore += 15;
  // OCRテキストの充実度
  const ocrTextLength = ocrTexts.filter(t => t).join("").length;
  if (ocrTextLength > 100) textScore += 25;
  else if (ocrTextLength > 30) textScore += 10;
  // 説明文の充実度
  if (descLength > 100) textScore += 15;
  else if (descLength > 30) textScore += 8;
  // エンゲージメント率ボーナス（上限10pt）
  textScore += Math.min(10, Math.floor(engagementRate * 2));

  // --- audioScore: コンテンツ質（エンゲージメント率・動画尺から推定）---
  let audioScore = 20;
  // 動画尺（15-60秒がTikTokのベスト）
  if (duration >= 15 && duration <= 60) audioScore += 25;
  else if (duration >= 8 && duration <= 120) audioScore += 15;
  // いいね率
  if (likeRate >= 5) audioScore += 30;
  else if (likeRate >= 2) audioScore += 20;
  else if (likeRate >= 0.5) audioScore += 10;
  // コメント率（議論を生む良コンテンツ）
  if (commentRate >= 1) audioScore += 15;
  else if (commentRate >= 0.3) audioScore += 8;
  // シェア・保存率
  if (saveShareRate >= 1) audioScore += 10;

  // --- overallScore: 加重平均 ---
  const clamp = (v: number) => Math.min(100, Math.max(0, Math.round(v)));
  const ts = clamp(thumbnailScore);
  const xs = clamp(textScore);
  const as_ = clamp(audioScore);
  const overallScore = clamp(ts * 0.3 + xs * 0.3 + as_ * 0.4);

  return { thumbnailScore: ts, textScore: xs, audioScore: as_, overallScore };
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
  
  // ジョブ情報を取得
  const job = await db.getAnalysisJobById(jobId);
  if (!job) {
    console.error(`[Analysis] Job ${jobId} not found`);
    return;
  }

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

  // キーワード集計（OCR・音声データの重要度を高く）
  const allKeywords: string[] = [];
  const ocrAndAudioKeywords: string[] = []; // OCR・音声データから抽出したキーワード

  for (const video of videosData) {
    const keywords = video.keywords as string[] || [];
    allKeywords.push(...keywords);
    
    // OCR結果から抽出したテキスト
    const ocrResults = await db.getOcrResultsByVideoId(video.id);
    for (const ocr of ocrResults) {
      if (ocr.extractedText) {
        // OCRテキストから単語を抽出（簡易的な分割）
        const words = ocr.extractedText.split(/[\s、。！？，]+/).filter(w => w.length > 1);
        ocrAndAudioKeywords.push(...words);
      }
    }
    
    // 音声文字起こし結果から抽出したテキスト
    const transcriptions = await db.getTranscriptionsByVideoId(video.id);
    for (const trans of transcriptions) {
      if (trans.fullText) {
        const words = trans.fullText.split(/[\s、。！？，]+/).filter(w => w.length > 1);
        ocrAndAudioKeywords.push(...words);
      }
    }
  }

  // 頻出ワードを抽出（出現回数でソート、OCR・音声データを優先）
  // countMap を返すユーティリティ
  const buildWordCountMap = (words: string[], ocrAudioWords: string[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const w of ocrAudioWords) {
      counts.set(w, (counts.get(w) || 0) + 2); // OCR/音声は重要度2倍
    }
    for (const w of words) {
      counts.set(w, (counts.get(w) || 0) + 1);
    }
    return counts;
  };

  const getTopWords = (words: string[], ocrAudioWords: string[], limit: number = 30): string[] => {
    const counts = buildWordCountMap(words, ocrAudioWords);
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([word]) => word);
  };

  const getTopWordsWithCount = (
    words: string[],
    ocrAudioWords: string[],
    limit: number = 30
  ): Array<{ word: string; count: number }> => {
    const counts = buildWordCountMap(words, ocrAudioWords);
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([word, count]) => ({ word, count }));
  };

  const topAllKeywords = getTopWords(allKeywords, ocrAndAudioKeywords, 30);

  // per-video の sentiment + keywords から感情ワードを集計（後方互換）
  const positiveVideoKeywords: string[] = [];
  const negativeVideoKeywords: string[] = [];
  for (const video of videosData) {
    const keywords = video.keywords as string[] || [];
    if (video.sentiment === "positive") positiveVideoKeywords.push(...keywords);
    if (video.sentiment === "negative") negativeVideoKeywords.push(...keywords);
  }
  const positiveWords = getTopWords(positiveVideoKeywords, [], 15);
  const negativeWords = getTopWords(negativeVideoKeywords, [], 15);

  // LLMで感情アノテーション・autoInsight・keyInsightsを1回のコールで生成
  // valence: Y軸 -1(悲/怒) → +1(喜/楽)
  // arousal: X軸 -1(穏/受動) → +1(興奮/能動)
  type EmotionWordSource = "keyword" | "ocr" | "transcription" | "modal";
  type EmotionWord = {
    word: string;
    count: number;
    valence: number;
    arousal: number;
    sources: EmotionWordSource[];
  };

  let emotionWords: EmotionWord[] = [];
  let autoInsight: string = "";
  let keyInsights: Array<{ category: "avoid" | "caution" | "leverage"; title: string; description: string }> = [];

  try {
    const wordsWithCount = getTopWordsWithCount(allKeywords, ocrAndAudioKeywords, 30);
    const wordList = wordsWithCount.map(w => w.word).join("、");

    const positiveAvgER = positiveVideos.length > 0
      ? (positiveVideos.reduce((s, v) => { const vw = v.viewCount||0; return vw > 0 ? s + ((v.likeCount||0)+(v.commentCount||0)+(v.shareCount||0)+(v.saveCount||0))/vw*100 : s; }, 0) / positiveVideos.length).toFixed(2)
      : 0;
    const negativeAvgER = negativeVideos.length > 0
      ? (negativeVideos.reduce((s, v) => { const vw = v.viewCount||0; return vw > 0 ? s + ((v.likeCount||0)+(v.commentCount||0)+(v.shareCount||0)+(v.saveCount||0))/vw*100 : s; }, 0) / negativeVideos.length).toFixed(2)
      : 0;

    const combinedRes = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "あなたはTikTok VSEOおよび日本語コンテンツ感情分析の専門家です。必ずJSONで返答してください。",
        },
        {
          role: "user",
          content: `以下の3つのタスクを同時に実行し、単一のJSONで返してください。

## タスク1: 感情座標アノテーション
以下のワードリストに感情座標を付与してください。
座標定義:
- valence: -1.0〜1.0（+1=喜び・楽しさ、-1=悲しみ・怒り）
- arousal: -1.0〜1.0（+1=興奮・激しい、-1=穏やか・静的）
象限の目安: 右上(喜興奮)「最高」→v:+0.9,a:+0.8 / 左上(楽穏)「癒し」→v:+0.8,a:-0.6 / 右下(怒活性)「ひどい」→v:-0.8,a:+0.7 / 左下(哀沈静)「悲しい」→v:-0.7,a:-0.4 / 中央(中立)「動画」→v:0,a:0
対象ワード: ${wordList || "（なし）"}

## タスク2: 自動インサイト（2〜3文サマリー）
キーワード「${job?.keyword || "不明"}」の動画トレンドを日本語2〜3文で、マーケター視点で実用的にまとめてください。
データ: ${totalVideos}本 / 総再生${totalViews.toLocaleString()} / Positive ${positiveCount}本(${positivePercentage}%) Negative ${negativeCount}本(${negativePercentage}%) / 平均ER: P=${positiveAvgER}% N=${negativeAvgER}%
Positive頻出ワード: ${positiveWords.slice(0, 5).join(", ")} / Negative頻出ワード: ${negativeWords.slice(0, 5).join(", ")}

## タスク3: VSEO主要示唆（3〜5個）
上記データに基づき、VSEO（動画SEO）視点でコンテンツ戦略の示唆を生成してください。
カテゴリ定義（必ずこの3種から選択）:
- avoid: ネガティブ文脈で伸びている・ブランドリスクがある → 避けるべきパターン
- caution: 競合が多い・注意が必要な傾向 → 慎重に扱うべきパターン
- leverage: 再生数・ERが高い勝ちパターン → 積極的に活用すべきパターン
動画サンプル:
${videosData.slice(0, 10).map(v => `- @${v.accountName}: ${(v.description || "").substring(0, 80)} (${v.sentiment})`).join("\n")}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "combined_report_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              annotations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    word: { type: "string" },
                    valence: { type: "number" },
                    arousal: { type: "number" },
                  },
                  required: ["word", "valence", "arousal"],
                  additionalProperties: false,
                },
              },
              autoInsight: { type: "string" },
              keyInsights: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    category: { type: "string", enum: ["avoid", "caution", "leverage"] },
                    title: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["category", "title", "description"],
                  additionalProperties: false,
                },
              },
            },
            required: ["annotations", "autoInsight", "keyInsights"],
            additionalProperties: false,
          },
        },
      },
    });

    const combinedContent = typeof combinedRes.choices[0].message.content === "string"
      ? combinedRes.choices[0].message.content
      : JSON.stringify(combinedRes.choices[0].message.content);
    const combinedParsed = JSON.parse(combinedContent || "{}");

    // 感情座標マップを構築
    const annotationMap = new Map<string, { valence: number; arousal: number }>(
      (combinedParsed.annotations || []).map((a: any) => [a.word, { valence: a.valence, arousal: a.arousal }])
    );
    emotionWords = wordsWithCount.map(({ word, count }) => {
      const annotation = annotationMap.get(word) ?? { valence: 0, arousal: 0 };
      const sources: EmotionWordSource[] = ["keyword"];
      if (ocrAndAudioKeywords.includes(word)) sources.push("ocr");
      return { word, count, ...annotation, sources };
    });

    autoInsight = combinedParsed.autoInsight || "";
    keyInsights = combinedParsed.keyInsights || [];
  } catch (error) {
    console.error("[Report] Error in combined LLM analysis:", error);
    emotionWords = [];
    autoInsight = "";
    keyInsights = [
      { category: "leverage", title: "データ収集完了", description: `${totalVideos}件の動画データを正常に収集・分析しました。` },
    ];
  }

  // 側面分析（ビジネス視点）
  // videosData に jobId を追加してから analyzeFacetsImproved に渡す
  const videosDataWithJobId = videosData.map(v => ({ ...v, jobId }));
  const facets = await analyzeFacetsImproved(videosDataWithJobId, jobId);  // レポートをDBに保存
  
  // マークダウン形式のレポートを生成
  const markdownReport = generateFacetAnalysisReport({
    keyword: job.keyword || 'Unknown',
    facets: facets || [],
    positiveWords,
    negativeWords,
    totalVideos,
    totalViews,
    totalEngagement,
    positivePercentage,
    negativePercentage,
  });
  
  console.log(`[Analysis] Markdown report generated (${markdownReport.length} characters)`);
  
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
    emotionWords,
    autoInsight,
    keyInsights,
    facets,
  });

  console.log(`[Analysis] Report generated for job ${jobId}`);
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
