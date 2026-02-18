import { invokeLLM } from "./_core/llm";
import { transcribeAudio } from "./_core/voiceTranscription";
import * as db from "./db";

/**
 * 動画分析エンジン
 * TikTok/YouTube Shortsの動画を分析し、構成要素を抽出・スコアリングする
 */

export interface VideoMetadata {
  url: string;
  platform: "tiktok" | "youtube";
  title: string;
  description: string;
  thumbnailUrl: string;
  duration: number;
  videoId: string;
  
  // エンゲージメント数値
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  saveCount: number;
  
  // KOL情報
  accountName: string;
  accountId: string;
  followerCount: number;
  accountAvatarUrl: string;
  
  // その他
  hashtags: string[];
  postedAt: Date;
}

export interface AnalysisResult {
  videoId: number;
  ocrResults: Array<{
    frameTimestamp: number;
    extractedText: string;
  }>;
  transcription: {
    fullText: string;
    language: string;
  };
  scores: {
    thumbnailScore: number;
    textScore: number;
    audioScore: number;
    overallScore: number;
  };
}

/**
 * 動画URLからメタデータを取得
 * 実際の実装ではTikTok/YouTube APIを使用
 * 現時点ではダミーデータを返す
 */
export async function fetchVideoMetadata(url: string): Promise<VideoMetadata> {
  // TODO: 実際のAPI連携を実装
  // TikTok: https://developers.tiktok.com/
  // YouTube: https://developers.google.com/youtube/v3
  
  const isTikTok = url.includes("tiktok.com");
  const videoId = extractVideoId(url);
  
  // ダミーデータ（実際はAPIから取得）
  const randomViews = Math.floor(Math.random() * 10000000) + 100000;
  const randomLikes = Math.floor(randomViews * (Math.random() * 0.1 + 0.05));
  const randomComments = Math.floor(randomLikes * (Math.random() * 0.05 + 0.01));
  const randomShares = Math.floor(randomLikes * (Math.random() * 0.03 + 0.005));
  const randomSaves = Math.floor(randomLikes * (Math.random() * 0.02 + 0.003));
  const randomFollowers = Math.floor(Math.random() * 500000) + 10000;
  
  return {
    url,
    platform: isTikTok ? "tiktok" : "youtube",
    title: "サンプル動画タイトル - 沖縄旅行のベストスポット",
    description: "沖縄の隠れた名所を紹介！絶対に行くべきスポットをまとめました",
    thumbnailUrl: "https://placehold.co/600x400/8A2BE2/white?text=Video+Thumbnail",
    duration: 30,
    videoId,
    
    viewCount: randomViews,
    likeCount: randomLikes,
    commentCount: randomComments,
    shareCount: randomShares,
    saveCount: randomSaves,
    
    accountName: `@user_${videoId.substring(0, 8)}`,
    accountId: `user_${videoId}`,
    followerCount: randomFollowers,
    accountAvatarUrl: "https://placehold.co/100x100/FF6B6B/white?text=Avatar",
    
    hashtags: ["#沖縄旅行", "#観光スポット", "#おすすめ"],
    postedAt: new Date(Date.now() - Math.floor(Math.random() * 30) * 24 * 60 * 60 * 1000),
  };
}

/**
 * URLから動画IDを抽出
 */
function extractVideoId(url: string): string {
  if (url.includes("tiktok.com")) {
    const match = url.match(/video\/(\d+)/);
    return match ? match[1] : url;
  } else {
    const match = url.match(/shorts\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : url;
  }
}

/**
 * OCR解析（2秒/1フレーム）
 * 動画から2秒ごとにフレームを抽出し、テキストをOCR解析
 */
export async function performOcrAnalysis(
  videoUrl: string,
  duration: number
): Promise<Array<{ frameTimestamp: number; extractedText: string }>> {
  // TODO: 実際の動画フレーム抽出とOCR処理を実装
  // 1. ffmpegで2秒ごとにフレームを抽出
  // 2. Google Cloud Vision APIでOCR解析
  
  const results: Array<{ frameTimestamp: number; extractedText: string }> = [];
  const interval = 2; // 2秒ごと
  
  for (let timestamp = 0; timestamp < duration; timestamp += interval) {
    // ダミーデータ（実際はOCR APIを呼び出す）
    const extractedText = await simulateOcr(timestamp);
    results.push({
      frameTimestamp: timestamp,
      extractedText,
    });
  }
  
  return results;
}

/**
 * OCRシミュレーション（実装時は実際のOCR APIに置き換え）
 */
async function simulateOcr(timestamp: number): Promise<string> {
  const sampleTexts = [
    "今日のメイクポイント",
    "おすすめ商品",
    "フォローしてね！",
    "詳細は概要欄へ",
    "#PR #提供",
  ];
  
  return sampleTexts[timestamp % sampleTexts.length] || "";
}

/**
 * 音声の完全文字起こし
 * Whisper APIを使用して動画音声を全文テキスト化
 */
export async function performTranscription(
  videoUrl: string
): Promise<{ fullText: string; language: string }> {
  try {
    // TODO: 実際の動画から音声を抽出してWhisper APIに送信
    // 1. ffmpegで動画から音声を抽出（mp3形式）
    // 2. 音声ファイルをS3にアップロード
    // 3. transcribeAudio()を呼び出し
    
    // 現時点ではダミーデータを返す
    return {
      fullText: "こんにちは、今日は最新のメイクテクニックを紹介します。まずはベースメイクから始めましょう。この商品は本当におすすめです。ぜひ試してみてください。",
      language: "ja",
    };
    
    // 実際の実装例:
    // const audioUrl = await extractAudioFromVideo(videoUrl);
    // const result = await transcribeAudio({
    //   audioUrl,
    //   language: "ja",
    //   prompt: "ショート動画の音声文字起こし"
    // });
    // return {
    //   fullText: result.text,
    //   language: result.language,
    // };
  } catch (error) {
    console.error("[Transcription] Error:", error);
    return {
      fullText: "",
      language: "unknown",
    };
  }
}

/**
 * 構成要素のスコアリング
 * サムネイル、テキスト、音声の各要素を分析してスコア化
 */
export async function calculateScores(
  metadata: VideoMetadata,
  ocrResults: Array<{ frameTimestamp: number; extractedText: string }>,
  transcription: { fullText: string; language: string }
): Promise<{
  thumbnailScore: number;
  textScore: number;
  audioScore: number;
  overallScore: number;
}> {
  // LLMを使用して各要素を分析・スコアリング
  const prompt = `
あなたはショート動画のVSEO（Video SEO）分析の専門家です。
以下の動画の構成要素を分析し、各要素のスコア（0-100）を算出してください。

【動画情報】
タイトル: ${metadata.title}
プラットフォーム: ${metadata.platform}
尺: ${metadata.duration}秒

【OCR抽出テキスト】
${ocrResults.map(r => `${r.frameTimestamp}秒: ${r.extractedText}`).join("\n")}

【音声文字起こし】
${transcription.fullText}

【評価基準】
- サムネイルスコア: タイトルの魅力度、キーワードの適切性
- テキストスコア: OCRで抽出されたテキストの量と質、視認性
- 音声スコア: 音声内容の充実度、キーワードの含有率
- 総合スコア: 上記3要素の加重平均

JSON形式で以下のように返してください:
{
  "thumbnailScore": 85,
  "textScore": 70,
  "audioScore": 90,
  "overallScore": 82
}
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
              thumbnailScore: { type: "integer", description: "Thumbnail score (0-100)" },
              textScore: { type: "integer", description: "Text score (0-100)" },
              audioScore: { type: "integer", description: "Audio score (0-100)" },
              overallScore: { type: "integer", description: "Overall score (0-100)" },
            },
            required: ["thumbnailScore", "textScore", "audioScore", "overallScore"],
            additionalProperties: false,
          },
        },
      },
    });

    const message = response.choices[0]?.message;
    if (!message || typeof message.content !== 'string') {
      throw new Error("Invalid response from LLM");
    }
    const content = message.content;
    if (!content) {
      throw new Error("No response from LLM");
    }

    const scores = JSON.parse(content);
    return scores;
  } catch (error) {
    console.error("[Scoring] Error:", error);
    // フォールバック: ランダムスコア
    return {
      thumbnailScore: Math.floor(Math.random() * 30) + 70,
      textScore: Math.floor(Math.random() * 30) + 60,
      audioScore: Math.floor(Math.random() * 30) + 75,
      overallScore: Math.floor(Math.random() * 20) + 70,
    };
  }
}

/**
 * 動画の完全分析を実行
 */
export async function analyzeVideo(
  jobId: number,
  videoUrl: string
): Promise<AnalysisResult> {
  console.log(`[Analysis] Starting analysis for: ${videoUrl}`);
  
  // 1. メタデータ取得
  const metadata = await fetchVideoMetadata(videoUrl);
  
  // 2. DBに動画レコードを作成（エンゲージメント数値、KOL情報を含む）
  const videoId = await db.createVideo({
    jobId,
    videoUrl,
    platform: metadata.platform === 'youtube' ? 'youtube_shorts' : metadata.platform,
    videoId: metadata.videoId,
    title: metadata.title,
    description: metadata.description,
    thumbnailUrl: metadata.thumbnailUrl,
    duration: metadata.duration,
    
    // エンゲージメント数値
    viewCount: metadata.viewCount,
    likeCount: metadata.likeCount,
    commentCount: metadata.commentCount,
    shareCount: metadata.shareCount,
    saveCount: metadata.saveCount,
    
    // KOL情報
    accountName: metadata.accountName,
    accountId: metadata.accountId,
    followerCount: metadata.followerCount,
    accountAvatarUrl: metadata.accountAvatarUrl,
    
    // その他
    hashtags: metadata.hashtags,
    postedAt: metadata.postedAt,
  });
  
  // 3. OCR解析（2秒/1フレーム）
  console.log(`[Analysis] Performing OCR analysis...`);
  const ocrResults = await performOcrAnalysis(videoUrl, metadata.duration);
  
  // OCR結果をDBに保存
  for (const ocr of ocrResults) {
    await db.createOcrResult({
      videoId,
      frameTimestamp: ocr.frameTimestamp,
      extractedText: ocr.extractedText,
    });
  }
  
  // 4. 音声文字起こし
  console.log(`[Analysis] Performing transcription...`);
  const transcription = await performTranscription(videoUrl);
  
  // 文字起こし結果をDBに保存
  await db.createTranscription({
    videoId,
    fullText: transcription.fullText,
    language: transcription.language,
  });
  
  // 5. センチメント分析とキーワード抽出
  console.log(`[Analysis] Analyzing sentiment and keywords...`);
  const sentimentAnalysis = await analyzeSentimentAndKeywords(metadata, ocrResults, transcription);
  
  // センチメントとキーワードをDBに保存
  await db.updateVideo(videoId, {
    sentiment: sentimentAnalysis.sentiment,
    keyHook: sentimentAnalysis.keyHook,
    keywords: sentimentAnalysis.keywords,
  });
  
  // 6. スコアリング
  console.log(`[Analysis] Calculating scores...`);
  const scores = await calculateScores(metadata, ocrResults, transcription);
  
  // スコアをDBに保存
  await db.createAnalysisScore({
    videoId,
    thumbnailScore: scores.thumbnailScore,
    textScore: scores.textScore,
    audioScore: scores.audioScore,
    overallScore: scores.overallScore,
  });
  
  console.log(`[Analysis] Completed analysis for video ID: ${videoId}`);
  
  return {
    videoId,
    ocrResults,
    transcription,
    scores,
  };
}

/**
 * 重複度分析
 * 3アカウント間での動画重複をチェック
 */
export async function analyzeDuplicates(jobId: number): Promise<void> {
  const videos = await db.getVideosByJobId(jobId);
  
  // 動画IDの出現回数をカウント
  const videoIdCounts = new Map<string, number>();
  
  for (const video of videos) {
    const count = videoIdCounts.get(video.videoId) || 0;
    videoIdCounts.set(video.videoId, count + 1);
  }
  
  // 重複度をDBに更新
  for (const video of videos) {
    const duplicateCount = (videoIdCounts.get(video.videoId) || 1) - 1;
    await db.updateVideoDuplicateCount(video.id, duplicateCount);
  }
  
  console.log(`[Analysis] Duplicate analysis completed for job ${jobId}`);
}

/**
 * センチメント分析とキーワード抽出
 * LLMを使用して動画のセンチメント（Positive/Neutral/Negative）とキーワードを抽出
 */
export async function analyzeSentimentAndKeywords(
  metadata: VideoMetadata,
  ocrResults: Array<{ frameTimestamp: number; extractedText: string }>,
  transcription: { fullText: string; language: string }
): Promise<{
  sentiment: "positive" | "neutral" | "negative";
  keyHook: string;
  keywords: string[];
}> {
  const prompt = `
あなたはショート動画のセンチメント分析の専門家です。
以下の動画の内容を分析し、センチメント、キーフック、キーワードを抽出してください。

【動画情報】
タイトル: ${metadata.title}
説明: ${metadata.description}
ハッシュタグ: ${metadata.hashtags.join(", ")}

【OCR抽出テキスト】
${ocrResults.map(r => `${r.frameTimestamp}秒: ${r.extractedText}`).join("\n")}

【音声文字起こし】
${transcription.fullText}

【分析基準】
- sentiment: 動画の全体的な感情（positive: ポジティブ、neutral: 中立、negative: ネガティブ）
- keyHook: 動画の主要な訴求ポイント（1文で簡潔に）
- keywords: 動画の主要キーワード（5-10個）

JSON形式で以下のように返してください:
{
  "sentiment": "positive",
  "keyHook": "沖縄の隠れた絶景スポットを紹介",
  "keywords": ["沖縄", "旅行", "絶景", "観光", "おすすめ"]
}
`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "You are a sentiment analysis expert. Always respond in valid JSON format." },
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
              sentiment: {
                type: "string",
                enum: ["positive", "neutral", "negative"],
                description: "The overall sentiment of the video"
              },
              keyHook: {
                type: "string",
                description: "The main hook or appeal point of the video"
              },
              keywords: {
                type: "array",
                items: { type: "string" },
                description: "Main keywords extracted from the video"
              }
            },
            required: ["sentiment", "keyHook", "keywords"],
            additionalProperties: false
          }
        }
      }
    });

    const content = typeof response.choices[0].message.content === 'string' 
      ? response.choices[0].message.content 
      : JSON.stringify(response.choices[0].message.content);
    const result = JSON.parse(content || "{}");
    return {
      sentiment: result.sentiment || "neutral",
      keyHook: result.keyHook || "",
      keywords: result.keywords || []
    };
  } catch (error) {
    console.error("[Sentiment Analysis] Error:", error);
    // フォールバック: ダミーデータを返す
    return {
      sentiment: "neutral",
      keyHook: "動画の主要な訴求ポイント",
      keywords: ["キーワード1", "キーワード2", "キーワード3"]
    };
  }
}
