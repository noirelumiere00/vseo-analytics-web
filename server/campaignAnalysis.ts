import { invokeLLM, LLMQuotaExhaustedError } from "./_core/llm";
import { searchTikTokByUrl, type TikTokVideo } from "./tiktokScraper";
import * as db from "./db";

/**
 * 施策レポート分析エンジン
 * 施策動画のスクレイピング → 集計 → AI評価 → Next提案生成
 */

/**
 * TikTok URL から動画データをスクレイピングし campaign_videos に保存
 */
export async function scrapeCampaignVideos(
  campaignId: number,
  videoUrls: string[],
  onProgress?: (msg: string, pct: number) => void,
): Promise<void> {
  // 既存データをクリア（再実行対応）
  await db.clearCampaignVideos(campaignId);

  for (let i = 0; i < videoUrls.length; i++) {
    const url = videoUrls[i];
    onProgress?.(`動画データ取得中... (${i + 1}/${videoUrls.length})`, Math.round(((i + 1) / videoUrls.length) * 40));

    try {
      const tiktokVideo = await searchTikTokByUrl(url);
      if (tiktokVideo) {
        await saveTikTokVideoAsCampaignVideo(campaignId, tiktokVideo, url);
      } else {
        // スクレイピング失敗 → プレースホルダとして保存
        await db.createCampaignVideo({
          campaignId,
          videoUrl: url,
          videoId: extractVideoId(url),
          platform: "tiktok",
          title: "データ取得失敗",
          description: "",
        });
      }
    } catch (error) {
      console.error(`[Campaign] Failed to scrape video ${url}:`, error);
      await db.createCampaignVideo({
        campaignId,
        videoUrl: url,
        videoId: extractVideoId(url),
        platform: "tiktok",
        title: "データ取得失敗",
        description: "",
      });
    }
  }
}

async function saveTikTokVideoAsCampaignVideo(
  campaignId: number,
  video: TikTokVideo,
  originalUrl: string,
): Promise<void> {
  const views = video.stats.playCount || 0;
  const eng = (video.stats.diggCount || 0) + (video.stats.commentCount || 0) +
    (video.stats.shareCount || 0) + (video.stats.collectCount || 0);
  const er = views > 0 ? Math.round((eng / views) * 10000) : 0; // percentage * 100

  await db.createCampaignVideo({
    campaignId,
    videoUrl: originalUrl,
    videoId: video.id,
    platform: "tiktok",
    title: video.desc.substring(0, 200),
    description: video.desc,
    thumbnailUrl: video.coverUrl,
    duration: video.duration,
    viewCount: video.stats.playCount,
    likeCount: video.stats.diggCount,
    commentCount: video.stats.commentCount,
    shareCount: video.stats.shareCount,
    saveCount: video.stats.collectCount,
    engagementRate: er,
    accountName: `@${video.author.uniqueId}`,
    accountId: video.author.uniqueId,
    followerCount: video.author.followerCount,
    accountAvatarUrl: video.author.avatarUrl,
    hashtags: video.hashtags,
    postedAt: new Date(video.createTime * 1000),
  });
}

/**
 * 施策動画のセンチメント分析（バッチ）
 */
export async function analyzeCampaignSentiment(campaignId: number): Promise<void> {
  const videos = await db.getCampaignVideosByCampaignId(campaignId);
  const validVideos = videos.filter(v => v.description && v.description.length > 0);

  if (validVideos.length === 0) return;

  const BATCH_SIZE = 5;
  for (let i = 0; i < validVideos.length; i += BATCH_SIZE) {
    const batch = validVideos.slice(i, i + BATCH_SIZE);
    const videoList = batch.map((v, idx) =>
      `[動画${idx}]\n説明: ${(v.description || "").substring(0, 300)}\nハッシュタグ: ${(v.hashtags as string[] || []).join(", ")}`
    ).join("\n\n");

    try {
      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are a sentiment analysis expert for TikTok videos. Always respond in valid JSON format." },
          {
            role: "user",
            content: `以下の${batch.length}本のTikTok動画のセンチメント分析を行い、results配列で返してください。

【分析基準】
- sentiment: positive/neutral/negative
- keyHook: 主要な訴求ポイント（1文、日本語）
- keywords: 主要キーワード（5-10個、日本語）

${videoList}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "sentiment_batch",
            strict: true,
            schema: {
              type: "object",
              properties: {
                results: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      index: { type: "number" },
                      sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
                      keyHook: { type: "string" },
                      keywords: { type: "array", items: { type: "string" } },
                    },
                    required: ["index", "sentiment", "keyHook", "keywords"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["results"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = typeof response.choices[0].message.content === "string"
        ? response.choices[0].message.content
        : JSON.stringify(response.choices[0].message.content);
      const parsed = JSON.parse(content || "{}");
      const resultMap = new Map<number, { sentiment: string; keyHook: string; keywords: string[] }>(
        (parsed.results || []).map((r: any) => [r.index, r])
      );

      for (let j = 0; j < batch.length; j++) {
        const result = resultMap.get(j);
        if (result) {
          await db.updateCampaignVideo(batch[j].id, {
            sentiment: result.sentiment as "positive" | "neutral" | "negative",
            keyHook: result.keyHook,
            keywords: result.keywords,
          });
        }
      }
    } catch (error) {
      if (error instanceof LLMQuotaExhaustedError) throw error;
      console.error("[Campaign Sentiment] Batch error:", error);
    }
  }
}

/**
 * 施策レポートの集計 + Before/After比較 + AI分析を実行
 */
export async function generateCampaignReport(campaignId: number): Promise<void> {
  const campaign = await db.getCampaignReportById(campaignId);
  if (!campaign) throw new Error("Campaign not found");

  const videos = await db.getCampaignVideosByCampaignId(campaignId);
  const validVideos = videos.filter(v => v.viewCount != null && v.viewCount > 0);

  // === 基本集計 ===
  const totalVideos = validVideos.length;
  const totalViews = validVideos.reduce((s, v) => s + (v.viewCount || 0), 0);
  const totalLikes = validVideos.reduce((s, v) => s + (v.likeCount || 0), 0);
  const totalComments = validVideos.reduce((s, v) => s + (v.commentCount || 0), 0);
  const totalShares = validVideos.reduce((s, v) => s + (v.shareCount || 0), 0);
  const totalSaves = validVideos.reduce((s, v) => s + (v.saveCount || 0), 0);
  const totalEngagement = totalLikes + totalComments + totalShares + totalSaves;
  const avgEngagementRate = totalViews > 0 ? Math.round((totalEngagement / totalViews) * 10000) : 0;

  // センチメント集計
  const positiveCount = validVideos.filter(v => v.sentiment === "positive").length;
  const neutralCount = validVideos.filter(v => v.sentiment === "neutral").length;
  const negativeCount = validVideos.filter(v => v.sentiment === "negative").length;
  const positivePercentage = totalVideos > 0 ? Math.round((positiveCount / totalVideos) * 100) : 0;
  const neutralPercentage = totalVideos > 0 ? Math.round((neutralCount / totalVideos) * 100) : 0;
  const negativePercentage = totalVideos > 0 ? Math.round((negativeCount / totalVideos) * 100) : 0;

  // === KPI達成率 ===
  const viewsAchievementRate = campaign.targetViews
    ? Math.round((totalViews / campaign.targetViews) * 100)
    : null;
  const erAchievementRate = campaign.targetEngagementRate
    ? Math.round((avgEngagementRate / campaign.targetEngagementRate) * 100)
    : null;

  // === コスト指標 ===
  const cpv = campaign.adSpend && totalViews > 0
    ? Math.round((campaign.adSpend / totalViews) * 100)
    : null;
  const cpe = campaign.adSpend && totalEngagement > 0
    ? Math.round((campaign.adSpend / totalEngagement) * 100)
    : null;

  // === Before/After比較 ===
  let beforeAfterComparison = null;
  if (campaign.beforeJobId) {
    const beforeReport = await db.getAnalysisReportByJobId(campaign.beforeJobId);
    if (beforeReport) {
      const beforeAvgER = beforeReport.totalViews && Number(beforeReport.totalViews) > 0
        ? Math.round((Number(beforeReport.totalEngagement) / Number(beforeReport.totalViews)) * 10000)
        : 0;

      const beforeData = {
        totalVideos: beforeReport.totalVideos || 0,
        totalViews: Number(beforeReport.totalViews) || 0,
        avgEngagementRate: beforeAvgER,
        positivePercentage: beforeReport.positivePercentage || 0,
        negativePercentage: beforeReport.negativePercentage || 0,
        topKeywords: (beforeReport.positiveWords as string[] || []).slice(0, 5),
      };

      const afterData = {
        totalVideos,
        totalViews,
        avgEngagementRate,
        positivePercentage,
        negativePercentage,
        topKeywords: getTopKeywords(validVideos),
      };

      beforeAfterComparison = {
        before: beforeData,
        after: afterData,
        changes: {
          viewsChange: beforeData.totalViews > 0
            ? Math.round(((totalViews - beforeData.totalViews) / beforeData.totalViews) * 100)
            : 0,
          erChange: (avgEngagementRate - beforeAvgER), // in *100 units
          sentimentChange: positivePercentage - beforeData.positivePercentage,
        },
      };
    }
  }

  // === AI分析: 評価 + 効果分析 + Next提案 + クロージングサマリー ===
  let overallEvaluation: "excellent" | "good" | "needs_improvement" | "poor" = "good";
  let evaluationSummary = "";
  let effectAnalysis: Array<{ category: "strength" | "improvement" | "risk"; title: string; description: string; metric?: string }> = [];
  let nextRecommendations: Array<{ priority: "high" | "medium" | "low"; title: string; description: string; actionItems: string[] }> = [];
  let closingSummary = "";

  try {
    const videoSummaries = validVideos.slice(0, 10).map(v => ({
      account: v.accountName,
      desc: (v.description || "").substring(0, 100),
      views: v.viewCount,
      likes: v.likeCount,
      comments: v.commentCount,
      shares: v.shareCount,
      saves: v.saveCount,
      sentiment: v.sentiment,
      keyHook: v.keyHook,
      hashtags: (v.hashtags as string[] || []).slice(0, 5),
    }));

    const response = await invokeLLM({
      maxTokens: 8192,
      messages: [
        {
          role: "system",
          content: "あなたはTikTokマーケティング施策の分析コンサルタントです。クライアントへの報告書に使える質の高い分析を提供してください。必ずJSONで返答してください。",
        },
        {
          role: "user",
          content: `以下のTikTok施策の成果を分析し、評価・効果分析・次回提案・クロージング用サマリーを生成してください。

【施策情報】
- 施策名: ${campaign.campaignName}
- キーワード: ${campaign.keyword || "未設定"}
- 期間: ${campaign.startDate ? new Date(campaign.startDate).toLocaleDateString("ja-JP") : "未設定"} ～ ${campaign.endDate ? new Date(campaign.endDate).toLocaleDateString("ja-JP") : "未設定"}
- 施策概要: ${campaign.description || "未設定"}
- 広告費: ${campaign.adSpend ? `¥${campaign.adSpend.toLocaleString()}` : "未設定"}

【成果数値】
- 動画数: ${totalVideos}本
- 合計再生数: ${totalViews.toLocaleString()}
- 合計いいね: ${totalLikes.toLocaleString()} / コメント: ${totalComments.toLocaleString()} / シェア: ${totalShares.toLocaleString()} / 保存: ${totalSaves.toLocaleString()}
- 平均ER: ${(avgEngagementRate / 100).toFixed(2)}%
${campaign.targetViews ? `- 目標再生数: ${campaign.targetViews.toLocaleString()} → 達成率: ${viewsAchievementRate}%` : ""}
${cpv ? `- CPV: ¥${(cpv / 100).toFixed(1)}` : ""}
${cpe ? `- CPE: ¥${(cpe / 100).toFixed(1)}` : ""}
- センチメント: Positive ${positivePercentage}% / Neutral ${neutralPercentage}% / Negative ${negativePercentage}%

${beforeAfterComparison ? `【Before/After比較】
- 再生数変化: ${beforeAfterComparison.changes.viewsChange > 0 ? "+" : ""}${beforeAfterComparison.changes.viewsChange}%
- ER変化: ${(beforeAfterComparison.changes.erChange / 100).toFixed(2)}pt
- ポジティブ率変化: ${beforeAfterComparison.changes.sentimentChange > 0 ? "+" : ""}${beforeAfterComparison.changes.sentimentChange}pt` : ""}

【動画サンプル】
${videoSummaries.map((v, i) => `${i + 1}. @${v.account}: ${v.desc} (再生${v.views?.toLocaleString()} / ER${v.likes && v.views ? ((((v.likes||0)+(v.comments||0)+(v.shares||0)+(v.saves||0))/(v.views||1))*100).toFixed(1) : 0}%) [${v.sentiment}] ${v.keyHook || ""}`).join("\n")}

【出力形式】
1. overallEvaluation: excellent/good/needs_improvement/poor
2. evaluationSummary: 総合評価（3-5文、クライアント報告用）
3. effectAnalysis: 効果分析（3-5項目、category: strength/improvement/risk）
4. nextRecommendations: Next提案（3項目、priority: high/medium/low、actionItems含む）
5. closingSummary: クロージング用サマリー（クライアントにコピペで送れる報告文、5-8文）`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "campaign_analysis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              overallEvaluation: { type: "string", enum: ["excellent", "good", "needs_improvement", "poor"] },
              evaluationSummary: { type: "string" },
              effectAnalysis: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    category: { type: "string", enum: ["strength", "improvement", "risk"] },
                    title: { type: "string" },
                    description: { type: "string" },
                    metric: { type: "string" },
                  },
                  required: ["category", "title", "description", "metric"],
                  additionalProperties: false,
                },
              },
              nextRecommendations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    priority: { type: "string", enum: ["high", "medium", "low"] },
                    title: { type: "string" },
                    description: { type: "string" },
                    actionItems: { type: "array", items: { type: "string" } },
                  },
                  required: ["priority", "title", "description", "actionItems"],
                  additionalProperties: false,
                },
              },
              closingSummary: { type: "string" },
            },
            required: ["overallEvaluation", "evaluationSummary", "effectAnalysis", "nextRecommendations", "closingSummary"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = typeof response.choices[0].message.content === "string"
      ? response.choices[0].message.content
      : JSON.stringify(response.choices[0].message.content);
    const parsed = JSON.parse(content || "{}");

    overallEvaluation = parsed.overallEvaluation || "good";
    evaluationSummary = parsed.evaluationSummary || "";
    effectAnalysis = parsed.effectAnalysis || [];
    nextRecommendations = parsed.nextRecommendations || [];
    closingSummary = parsed.closingSummary || "";
  } catch (error) {
    if (error instanceof LLMQuotaExhaustedError) throw error;
    console.error("[Campaign] AI analysis error:", error);
    evaluationSummary = `${totalVideos}本の施策動画を分析しました。合計再生数${totalViews.toLocaleString()}、平均ER${(avgEngagementRate / 100).toFixed(2)}%。`;
  }

  // === DB更新 ===
  await db.updateCampaignReport(campaignId, {
    totalVideos,
    totalViews,
    totalLikes,
    totalComments,
    totalShares,
    totalSaves,
    totalEngagement,
    avgEngagementRate,
    positiveCount,
    positivePercentage,
    neutralCount,
    neutralPercentage,
    negativeCount,
    negativePercentage,
    viewsAchievementRate,
    erAchievementRate,
    cpv,
    cpe,
    beforeAfterComparison,
    overallEvaluation,
    evaluationSummary,
    effectAnalysis,
    nextRecommendations,
    closingSummary,
  });

  console.log(`[Campaign] Report generated for campaign ${campaignId}`);
}

function getTopKeywords(videos: Array<{ keywords?: string[] | null }>): string[] {
  const counts = new Map<string, number>();
  for (const v of videos) {
    for (const kw of (v.keywords as string[] || [])) {
      counts.set(kw, (counts.get(kw) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([kw]) => kw);
}

function extractVideoId(url: string): string {
  const match = url.match(/video\/(\d+)/);
  return match ? match[1] : url.substring(url.length - 20);
}
