/**
 * jobExecutor.ts — ジョブ実行ロジック（routers.ts から抽出）
 *
 * 各関数は純粋なジョブ実行ロジック。
 * 進捗は onProgress コールバック経由で報告し、呼び出し側（ワーカー）が DB に書き込む。
 */

import { SCRAPER_SESSION_COUNT, SCRAPER_VIDEOS_PER_SESSION, TREND_VIDEOS_PER_QUERY } from "@shared/const";
import * as db from "./db";
import {
  analyzeVideoFromTikTok,
  analyzeVideoFromUrl,
  generateAnalysisReport,
  analyzeWinPatternCommonality,
  analyzeLosePatternCommonality,
  analyzeWinPatternCommonalityAd,
  analyzeLosePatternCommonalityAd,
  analyzeSentimentAndKeywordsBatch,
  type SentimentInput,
} from "./videoAnalysis";
import { searchTikTokTriple, searchTikTokBatch, scrapeTikTokMetaKeywords } from "./tiktokScraper";
import { expandPersonaToQueries, flattenTikTokVideo, computeCrossAnalysis, generateTrendSummary } from "./trendDiscovery";
import { captureSnapshot } from "./campaignSnapshot";
import { generateCampaignReport } from "./campaignReport";
import { LLMQuotaExhaustedError } from "./_core/llm";

export type ProgressInfo = {
  message: string;
  percent: number;
  failedVideos?: Array<{ tiktokVideoId: string; error: string }>;
  totalTarget?: number;
  processedCount?: number;
  phase?: string;
};

export class JobCancelledError extends Error {
  constructor(jobId: number) {
    super(`Job ${jobId} was cancelled by user`);
    this.name = "JobCancelledError";
  }
}

// ============================================================
// Analysis Job (execute) — routers.ts L360-654
// ============================================================
export async function executeAnalysisJob(
  jobId: number,
  onProgress: (progress: ProgressInfo) => void,
  checkCancelled: () => Promise<void>,
) {
  const job = await db.getAnalysisJobById(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);

  // 検索データが既に存在するかチェック（途中再開判定）
  const existingSearchResult = await db.getTripleSearchResultByJobId(jobId);
  const existingVideos = await db.getVideosByJobId(jobId);
  const canResume = !!(job.keyword && existingSearchResult && existingVideos.length > 0);

  if (!canResume) {
    await db.clearJobVideoData(jobId);
  }

  // キャンセルフラグクリア
  await db.setCancelRequested(jobId, 0);

  onProgress({ message: "分析を開始しています...", percent: 0 });

  // Mutable state for tracking failed videos
  const failedVideos: Array<{ tiktokVideoId: string; error: string }> = [];
  let totalTarget = 0;
  let processedCount = 0;

  const addFailedVideo = (tiktokVideoId: string, error: string) => {
    failedVideos.push({ tiktokVideoId, error: error.substring(0, 200) });
  };

  try {
    await checkCancelled();

    if (job.keyword) {
      if (canResume) {
        // === 途中再開モード ===
        console.log(`[Analysis] Resuming job ${jobId} - skipping search (${existingVideos.length} videos in DB)`);
        onProgress({ message: `途中から再開中...（${existingVideos.length}件の動画データを再利用）`, percent: 42 });

        const videosNeedingSentiment = existingVideos.filter(v => !v.sentiment);

        if (videosNeedingSentiment.length > 0) {
          const BATCH_SIZE = 5;
          const total = videosNeedingSentiment.length;
          totalTarget = existingVideos.length;
          processedCount = existingVideos.length - total;

          for (let i = 0; i < total; i += BATCH_SIZE) {
            await checkCancelled();
            const batch = videosNeedingSentiment.slice(i, i + BATCH_SIZE);
            const done = Math.min(i + BATCH_SIZE, total);

            onProgress({
              message: `センチメント分析中... (${done}/${total})`,
              percent: 42 + Math.floor((done / total) * 36),
              failedVideos,
              totalTarget,
              processedCount: existingVideos.length - total + done,
            });

            const sentimentInputs: SentimentInput[] = await Promise.all(
              batch.map(async (v) => {
                const ocrData = await db.getOcrResultsByVideoId(v.id);
                const transcription = await db.getTranscriptionByVideoId(v.id);
                return {
                  title: v.title || "",
                  description: v.description || "",
                  hashtags: (v.hashtags as string[]) || [],
                  ocrTexts: ocrData.map((o: any) => o.extractedText || ""),
                  transcriptionText: transcription?.fullText || "",
                };
              })
            );

            const sentimentResults = await analyzeSentimentAndKeywordsBatch(sentimentInputs);
            await Promise.all(
              batch.map((v, j) => db.updateVideo(v.id, {
                sentiment: sentimentResults[j]?.sentiment ?? "neutral",
                keyHook: sentimentResults[j]?.keyHook ?? "",
                keywords: sentimentResults[j]?.keywords ?? [],
              }))
            );

            processedCount = existingVideos.length - total + done;
          }
        }

        await db.deleteAnalysisReportByJobId(jobId);
      } else {
        // === 新規実行: 複数シークレットブラウザでTikTok検索 ===
        await checkCancelled();
        console.log(`[Analysis] Starting triple TikTok search for keyword: ${job.keyword}`);
        onProgress({ message: `${SCRAPER_SESSION_COUNT}つのシークレットブラウザでTikTok検索を開始...`, percent: 5 });

        const tripleResult = await searchTikTokTriple(
          job.keyword,
          SCRAPER_VIDEOS_PER_SESSION,
          SCRAPER_SESSION_COUNT,
          (msg: string, scraperPct: number) => {
            const pct = Math.min(40, Math.round(5 + ((scraperPct - 5) / 85) * 35));
            onProgress({ message: msg, percent: pct, failedVideos });
          }
        );

        const { videosByAppearanceCount, numSessions } = tripleResult.duplicateAnalysis;
        const allSessionVideos = videosByAppearanceCount[numSessions] ?? [];
        const oneOnlyVideos = videosByAppearanceCount[1] ?? [];
        const midVideos: typeof allSessionVideos = [];
        for (let c = numSessions - 1; c >= 2; c--) {
          midVideos.push(...(videosByAppearanceCount[c] ?? []));
        }

        await db.saveTripleSearchResult({
          jobId,
          searchData: tripleResult.searches.map(s => ({
            sessionIndex: s.sessionIndex,
            totalFetched: s.totalFetched,
            videoIds: s.videos.map(v => v.id),
          })),
          appearedInAll3Ids: allSessionVideos.map(v => v.id),
          appearedIn2Ids: midVideos.map(v => v.id),
          appearedIn1OnlyIds: oneOnlyVideos.map(v => v.id),
          overlapRate: Math.round(tripleResult.duplicateAnalysis.overlapRate * 10),
        });

        const countSummary = Object.entries(videosByAppearanceCount)
          .sort(([a], [b]) => Number(b) - Number(a))
          .map(([count, videos]) => `${count}回出現=${videos.length}`)
          .join(", ");
        console.log(`[Analysis] Search complete (${numSessions}sessions): ${countSummary}, 重複率=${tripleResult.duplicateAnalysis.overlapRate.toFixed(1)}%`);

        const allUniqueVideos = tripleResult.duplicateAnalysis.allUniqueVideos;
        totalTarget = allUniqueVideos.length;
        processedCount = 0;

        onProgress({
          message: `${allUniqueVideos.length}件のユニーク動画を分析中...`,
          percent: 42,
          failedVideos,
          totalTarget,
          processedCount,
        });

        const BATCH_SIZE = 5;
        const total = allUniqueVideos.length;

        for (let i = 0; i < total; i += BATCH_SIZE) {
          await checkCancelled();
          const batch = allUniqueVideos.slice(i, i + BATCH_SIZE);
          const done = Math.min(i + BATCH_SIZE, total);

          const p1Pct = 42 + Math.floor((i / total) * 36);
          onProgress({
            message: `動画登録中... (${done}/${total})`,
            percent: p1Pct,
            failedVideos,
            totalTarget,
            processedCount,
          });

          const batchSettled = await Promise.allSettled(
            batch.map(tiktokVideo => analyzeVideoFromTikTok(jobId, tiktokVideo, { skipSentiment: true }))
          );
          const batchResults = batchSettled
            .filter((r): r is PromiseFulfilledResult<{ dbVideoId: number; sentimentInput: SentimentInput }> => r.status === "fulfilled")
            .map(r => r.value);

          batchSettled.forEach((r, idx) => {
            if (r.status === "rejected") {
              const vid = batch[idx];
              const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
              console.error(`[Analysis] Video ${vid.id} failed:`, errMsg);
              addFailedVideo(vid.id, errMsg);
            }
          });

          if (batchResults.length === 0) {
            processedCount = done;
            continue;
          }

          const p2Pct = 42 + Math.floor(((i + BATCH_SIZE * 0.5) / total) * 36);
          onProgress({
            message: `センチメント分析中... (${done}/${total})`,
            percent: p2Pct,
            failedVideos,
            totalTarget,
            processedCount,
          });

          const sentimentResults = await analyzeSentimentAndKeywordsBatch(
            batchResults.map(r => r.sentimentInput)
          );

          await Promise.all(
            batchResults.map((r, j) => db.updateVideo(r.dbVideoId, {
              sentiment: sentimentResults[j]?.sentiment ?? "neutral",
              keyHook: sentimentResults[j]?.keyHook ?? "",
              keywords: sentimentResults[j]?.keywords ?? [],
            }))
          );

          processedCount = done;

          const p3Pct = 42 + Math.floor((done / total) * 36);
          onProgress({
            message: `動画分析中... (${done}/${total}${failedVideos.length ? ` / ${failedVideos.length}件失敗` : ""})`,
            percent: p3Pct,
            failedVideos,
            totalTarget,
            processedCount,
          });
        }
      }
    } else if (job.manualUrls && job.manualUrls.length > 0) {
      // === 手動URL指定の場合 ===
      for (let i = 0; i < job.manualUrls.length; i++) {
        const url = job.manualUrls[i];
        const percent = Math.floor(((i + 1) / job.manualUrls.length) * 85);
        onProgress({
          message: `動画分析中... (${i + 1}/${job.manualUrls.length})`,
          percent,
          failedVideos,
        });
        await analyzeVideoFromUrl(jobId, url);
      }
    }

    // レポート生成
    await checkCancelled();
    onProgress({ message: "分析レポート生成中...", percent: 85, failedVideos });
    await generateAnalysisReport(jobId);

    // 勝ちパターン分析（オーガニック）
    await checkCancelled();
    onProgress({ message: "勝ちパターン（オーガニック）を分析中...", percent: 88, failedVideos });
    if (job.keyword) await analyzeWinPatternCommonality(jobId, job.keyword);

    // 勝ちパターン分析（Ad）
    await checkCancelled();
    onProgress({ message: "勝ちパターン（Ad）を分析中...", percent: 91, failedVideos });
    if (job.keyword) await analyzeWinPatternCommonalityAd(jobId, job.keyword);

    // 負けパターン分析（オーガニック）
    await checkCancelled();
    onProgress({ message: "負けパターン（オーガニック）を分析中...", percent: 94, failedVideos });
    if (job.keyword) await analyzeLosePatternCommonality(jobId, job.keyword);

    // 負けパターン分析（Ad）
    await checkCancelled();
    onProgress({ message: "負けパターン（Ad）を分析中...", percent: 97, failedVideos });
    if (job.keyword) await analyzeLosePatternCommonalityAd(jobId, job.keyword);

    // 完了
    await db.updateAnalysisJobStatus(jobId, "completed", new Date());
    onProgress({ message: "分析完了", percent: 100, failedVideos });
    console.log(`[Analysis] Completed analysis for job ${jobId}`);
  } catch (error) {
    if (error instanceof JobCancelledError) {
      await db.updateAnalysisJobStatus(jobId, "failed");
      onProgress({ message: "分析がキャンセルされました。収集済みデータは保持されています。", percent: -1, failedVideos });
      console.log(`[Analysis] Job ${jobId} cancelled by user`);
      return;
    }

    const errorMessage = error instanceof Error ? error.message : "不明なエラー";
    const isLLMQuotaError = error instanceof LLMQuotaExhaustedError
      || errorMessage.includes("usage exhausted")
      || errorMessage.includes("412 Precondition Failed")
      || errorMessage.includes("quota");
    console.error("[Analysis] Error:", errorMessage);
    console.error("[Analysis] Full error:", error);

    await db.updateAnalysisJobStatus(jobId, "failed");

    let userMessage = "分析に失敗しました。";
    if (isLLMQuotaError) {
      userMessage = "分析データを取得できませんでした。LLMのトークン上限に達した可能性があります。後日再度お試しください。";
    } else if (errorMessage.includes("empty response")) {
      userMessage = "TikTokがアクセスを制限しています。しばらく待ってから再度お試しください。";
    } else if (errorMessage.includes("CAPTCHA")) {
      userMessage = "TikTokのCAPTCHA認証が必要です。しばらく待ってから再度お試しください。";
    } else if (errorMessage.includes("JSON Parse Error")) {
      userMessage = "TikTokからのデータ取得に失敗しました。ネットワークを確認してから再度お試しください。";
    } else if (errorMessage.includes("Puppeteer")) {
      userMessage = "ブラウザの起動に失敗しました。サーバーリソースが不足している可能性があります。";
    }

    onProgress({ message: `分析失敗: ${userMessage}`, percent: -1, failedVideos });
    throw error;
  }
}

// ============================================================
// Analysis Job (reAnalyzeLLM) — routers.ts L663-779
// ============================================================
export async function executeReAnalyzeLLM(
  jobId: number,
  onProgress: (progress: ProgressInfo) => void,
) {
  const job = await db.getAnalysisJobById(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);

  const videos = await db.getVideosByJobId(jobId);
  if (videos.length === 0) throw new Error("動画データがありません");

  onProgress({ message: "LLM再分析を開始...", percent: 5 });

  try {
    const BATCH_SIZE = 5;
    const total = videos.length;

    for (let i = 0; i < total; i += BATCH_SIZE) {
      const batch = videos.slice(i, i + BATCH_SIZE);
      const done = Math.min(i + BATCH_SIZE, total);
      onProgress({
        message: `センチメント再分析中... (${done}/${total})`,
        percent: Math.floor((done / total) * 60),
      });

      const sentimentInputs: SentimentInput[] = await Promise.all(
        batch.map(async (v) => {
          const ocrResults = await db.getOcrResultsByVideoId(v.id);
          const transcription = await db.getTranscriptionByVideoId(v.id);
          return {
            title: v.title || "",
            description: v.description || "",
            hashtags: (v.hashtags as string[]) || [],
            ocrTexts: ocrResults.map((o: any) => o.extractedText || ""),
            transcriptionText: transcription?.fullText || "",
          };
        })
      );

      const sentimentResults = await analyzeSentimentAndKeywordsBatch(sentimentInputs);
      await Promise.all(
        batch.map((v, j) => db.updateVideo(v.id, {
          sentiment: sentimentResults[j]?.sentiment ?? "neutral",
          keyHook: sentimentResults[j]?.keyHook ?? "",
          keywords: sentimentResults[j]?.keywords ?? [],
        }))
      );
    }

    onProgress({ message: "レポート再生成中...", percent: 70 });
    await db.deleteAnalysisReportByJobId(jobId);
    await generateAnalysisReport(jobId);

    onProgress({ message: "勝ちパターン（オーガニック）を再分析中...", percent: 80 });
    if (job.keyword) await analyzeWinPatternCommonality(jobId, job.keyword);

    onProgress({ message: "勝ちパターン（Ad）を再分析中...", percent: 85 });
    if (job.keyword) await analyzeWinPatternCommonalityAd(jobId, job.keyword);

    onProgress({ message: "負けパターン（オーガニック）を再分析中...", percent: 90 });
    if (job.keyword) await analyzeLosePatternCommonality(jobId, job.keyword);

    onProgress({ message: "負けパターン（Ad）を再分析中...", percent: 95 });
    if (job.keyword) await analyzeLosePatternCommonalityAd(jobId, job.keyword);

    await db.updateAnalysisJobStatus(jobId, "completed", new Date());
    onProgress({ message: "LLM再分析完了", percent: 100 });
    console.log(`[ReAnalyze] Completed LLM re-analysis for job ${jobId}`);
  } catch (error) {
    console.error("[ReAnalyze] Error:", error);
    await db.updateAnalysisJobStatus(jobId, "completed", new Date());
    onProgress({ message: "LLM再分析でエラー発生", percent: -1 });
    throw error;
  }
}

// ============================================================
// Trend Discovery Job (execute) — routers.ts L1386-1491
// ============================================================
export async function executeTrendDiscoveryJob(
  jobId: number,
  onProgress: (progress: ProgressInfo) => void,
) {
  const job = await db.getTrendDiscoveryJobById(jobId);
  if (!job) throw new Error(`Trend job ${jobId} not found`);

  try {
    // Step 1: LLM KW拡張
    onProgress({ message: "ペルソナからキーワードを拡張中...", percent: 5 });
    const { keywords, hashtags } = await expandPersonaToQueries(job.persona);
    console.log(`[TrendDiscovery] Job ${jobId}: expanded to ${keywords.length} KW + ${hashtags.length} HT`);

    await db.updateTrendDiscoveryJob(jobId, {
      expandedKeywords: keywords,
      expandedHashtags: hashtags,
    });

    // Step 2: バッチスクレイピング
    onProgress({ message: "TikTok検索を開始します...", percent: 10 });
    const queries = [
      ...keywords.map(k => ({ query: k, type: "keyword" as const })),
      ...hashtags.map(h => ({ query: h, type: "hashtag" as const })),
    ];

    const batchResults = await searchTikTokBatch(
      queries,
      TREND_VIDEOS_PER_QUERY,
      (msg, completed, total) => {
        const pct = 10 + Math.floor((completed / total) * 70);
        onProgress({ message: msg, percent: pct });
      },
    );

    const tagVideoCountMap = new Map<string, number>();
    for (const r of batchResults) {
      if (r.type === "hashtag" && r.tagVideoCount != null) {
        tagVideoCountMap.set(r.query, r.tagVideoCount);
      }
    }

    const allVideos = batchResults.flatMap(r =>
      r.videos.map(v => flattenTikTokVideo(v, r.query, r.type))
    );
    console.log(`[TrendDiscovery] Job ${jobId}: scraped ${allVideos.length} total videos`);

    await db.updateTrendDiscoveryJob(jobId, { scrapedVideos: allVideos });

    // Step 2.5: 全体上位20動画のメタキーワード取得
    onProgress({ message: "上位動画のSEOキーワードを取得中...", percent: 80 });
    let trendMetaKeywords: Array<{ videoId: string; authorUniqueId: string; keywords: string[] }> = [];
    try {
      const seenVideoIds = new Set<string>();
      const selectedVideos = allVideos
        .filter(v => {
          if (!v.authorUniqueId || seenVideoIds.has(v.videoId)) return false;
          seenVideoIds.add(v.videoId);
          return true;
        })
        .sort((a, b) => b.playCount - a.playCount)
        .slice(0, 20);

      if (selectedVideos.length > 0) {
        const urls = selectedVideos.map(v => `https://www.tiktok.com/@${v.authorUniqueId}/video/${v.videoId}`);
        const metaMap = await scrapeTikTokMetaKeywords(urls, (msg) =>
          onProgress({ message: msg, percent: 82 })
        );
        for (const v of selectedVideos) {
          const url = `https://www.tiktok.com/@${v.authorUniqueId}/video/${v.videoId}`;
          const kw = metaMap.get(url);
          if (kw && kw.length > 0) {
            trendMetaKeywords.push({ videoId: v.videoId, authorUniqueId: v.authorUniqueId, keywords: kw });
          }
        }
        console.log(`[TrendDiscovery] Job ${jobId}: fetched meta keywords for ${trendMetaKeywords.length}/${selectedVideos.length} videos`);
      }
    } catch (e) {
      console.warn(`[TrendDiscovery] Job ${jobId}: meta keywords scraping failed, skipping`, e);
    }

    // Step 3: 横断集計
    onProgress({ message: "横断集計を実行中...", percent: 85 });
    const crossAnalysis = computeCrossAnalysis(allVideos, new Date(), tagVideoCountMap, trendMetaKeywords);

    // Step 4: LLMレポート生成
    onProgress({ message: "AIレポートを生成中...", percent: 90 });
    const { summary, report } = await generateTrendSummary(job.persona, crossAnalysis);
    crossAnalysis.summary = summary;
    (crossAnalysis as any).report = report;

    // Step 5: 保存・完了
    onProgress({ message: "結果を保存中...", percent: 95 });
    await db.updateTrendDiscoveryJob(jobId, { crossAnalysis });
    await db.updateTrendDiscoveryJobStatus(jobId, "completed", new Date());
    onProgress({ message: "完了", percent: 100 });
    console.log(`[TrendDiscovery] Job ${jobId}: completed`);
  } catch (error) {
    console.error(`[TrendDiscovery] Job ${jobId} failed:`, error);
    await db.updateTrendDiscoveryJobStatus(jobId, "failed");
    onProgress({ message: `エラー: ${error instanceof Error ? error.message : "不明なエラー"}`, percent: -1 });
    throw error;
  }
}

// ============================================================
// Trend Discovery (recomputeStatistics) — routers.ts L1497-1560
// ============================================================
export async function executeTrendRecompute(
  jobId: number,
  onProgress: (progress: ProgressInfo) => void,
) {
  const job = await db.getTrendDiscoveryJobById(jobId);
  if (!job) throw new Error(`Trend job ${jobId} not found`);
  if (!job.scrapedVideos || job.scrapedVideos.length === 0) {
    throw new Error("スクレイピングデータがありません");
  }

  onProgress({ message: "SEOキーワードを取得中...", percent: 20 });

  let trendMetaKeywords: Array<{ videoId: string; authorUniqueId: string; keywords: string[] }> = [];
  try {
    const seenVideoIds = new Set<string>();
    const selectedVideos = job.scrapedVideos
      .filter(v => {
        if (!v.authorUniqueId || seenVideoIds.has(v.videoId)) return false;
        seenVideoIds.add(v.videoId);
        return true;
      })
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, 20);

    if (selectedVideos.length > 0) {
      const urls = selectedVideos.map(v => `https://www.tiktok.com/@${v.authorUniqueId}/video/${v.videoId}`);
      const metaMap = await scrapeTikTokMetaKeywords(urls, (msg) =>
        onProgress({ message: msg, percent: 40 })
      );
      for (const v of selectedVideos) {
        const url = `https://www.tiktok.com/@${v.authorUniqueId}/video/${v.videoId}`;
        const kw = metaMap.get(url);
        if (kw && kw.length > 0) {
          trendMetaKeywords.push({ videoId: v.videoId, authorUniqueId: v.authorUniqueId, keywords: kw });
        }
      }
    }
  } catch (e) {
    console.warn(`[TrendDiscovery] recompute meta keywords failed, skipping`, e);
  }

  onProgress({ message: "統計を再計算中...", percent: 60 });

  const crossAnalysis = computeCrossAnalysis(
    job.scrapedVideos,
    job.completedAt ?? new Date(),
    undefined,
    trendMetaKeywords,
  );

  const existing = job.crossAnalysis as any;
  if (existing?.summary) crossAnalysis.summary = existing.summary;
  if (existing?.report) (crossAnalysis as any).report = existing.report;

  onProgress({ message: "保存中...", percent: 90 });
  await db.updateTrendDiscoveryJob(jobId, { crossAnalysis });
  onProgress({ message: "完了", percent: 100 });
}

// ============================================================
// Campaign Snapshot — routers.ts L1830-1877
// ============================================================
export async function executeCampaignSnapshot(
  snapshotId: number,
  onProgress: (progress: ProgressInfo) => void,
) {
  const snapshot = await db.getCampaignSnapshotById(snapshotId);
  if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found`);

  const campaign = await db.getCampaignById(snapshot.campaignId);
  if (!campaign) throw new Error(`Campaign ${snapshot.campaignId} not found`);

  try {
    await db.updateCampaignSnapshot(snapshotId, { status: "processing" });

    const snapshotData = await captureSnapshot(
      campaign,
      snapshot.snapshotType,
      (progress) => onProgress({ message: progress.message, percent: progress.percent, phase: progress.phase }),
    );

    await db.updateCampaignSnapshot(snapshotId, {
      status: "completed",
      searchResults: snapshotData.searchResults,
      competitorProfiles: snapshotData.competitorProfiles,
      rippleEffect: snapshotData.rippleEffect,
      capturedAt: new Date(),
    });

    // キャンペーンのステータスとスナップショットIDを更新
    const updateData: Record<string, any> = {};
    if (snapshot.snapshotType === "baseline") {
      updateData.baselineSnapshotId = snapshotId;
      updateData.status = "baseline_captured";
    } else {
      updateData.measurementSnapshotId = snapshotId;
      updateData.status = "measurement_captured";
    }
    await db.updateCampaign(snapshot.campaignId, updateData);

    // 両方のスナップショットが揃ったらレポート自動生成
    const updatedCampaign = await db.getCampaignById(snapshot.campaignId);
    if (updatedCampaign?.baselineSnapshotId && updatedCampaign?.measurementSnapshotId) {
      const baselineSnapshot = await db.getCampaignSnapshotById(updatedCampaign.baselineSnapshotId);
      const measurementSnapshot = await db.getCampaignSnapshotById(updatedCampaign.measurementSnapshotId);
      if (baselineSnapshot?.status === "completed" && measurementSnapshot?.status === "completed") {
        const reportData = generateCampaignReport(updatedCampaign, baselineSnapshot, measurementSnapshot);
        await db.upsertCampaignReport(reportData);
        await db.updateCampaign(snapshot.campaignId, { status: "report_ready" });
      }
    }

    onProgress({ message: "完了", percent: 100 });
    console.log(`[Campaign] Snapshot ${snapshotId} completed for campaign ${snapshot.campaignId}`);
  } catch (error) {
    console.error(`[Campaign] Snapshot ${snapshotId} failed:`, error);
    await db.updateCampaignSnapshot(snapshotId, { status: "failed" });
    onProgress({ message: `エラー: ${error instanceof Error ? error.message : "不明なエラー"}`, percent: -1 });
    throw error;
  }
}
