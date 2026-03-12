import { COOKIE_NAME, SCRAPER_SESSION_COUNT, SCRAPER_VIDEOS_PER_SESSION, TREND_VIDEOS_PER_QUERY } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { TRPCError } from "@trpc/server";
import { analyzeVideoFromTikTok, analyzeVideoFromUrl, generateAnalysisReport, analyzeWinPatternCommonality, analyzeLosePatternCommonality, analyzeWinPatternCommonalityAd, analyzeLosePatternCommonalityAd, analyzeSentimentAndKeywordsBatch, type SentimentInput } from "./videoAnalysis";
import { LLMQuotaExhaustedError } from "./_core/llm";
import { searchTikTokTriple, searchTikTokBatch, type TikTokVideo, type TikTokTripleSearchResult } from "./tiktokScraper";
import { expandPersonaToQueries, flattenTikTokVideo, computeCrossAnalysis, generateTrendSummary } from "./trendDiscovery";
import { generateAnalysisReportDocx } from "./pdfGenerator";
// pdfExporter: 全エンドポイントがコメントアウト済みのため import 削除（メモリ節約）
// import { generatePdfFromUrl, generatePdfFromSnapshot } from "./pdfExporter";
import { generateExportToken } from "./_core/exportToken";
import * as fs from "fs";
import * as path from "path";
import { logBuffer } from "./logBuffer";
import pLimit from "p-limit";
import { captureSnapshot, type SnapshotProgress } from "./campaignSnapshot";
import { generateCampaignReport, generateCampaignCsv } from "./campaignReport";

// グローバルジョブキュー: 同時実行を最大2に制限（RAM 1.9GB、1ジョブ≒600MB）
const analysisQueue = pLimit(2);
let analysisQueuePending = 0; // キュー待ち数をトラッキング

// キャンセル管理: jobId → true でキャンセルフラグを保持
const cancelledJobs = new Set<number>();

class JobCancelledError extends Error {
  constructor(jobId: number) {
    super(`Job ${jobId} was cancelled by user`);
    this.name = "JobCancelledError";
  }
}

function checkCancelled(jobId: number) {
  if (cancelledJobs.has(jobId)) {
    throw new JobCancelledError(jobId);
  }
}

// CSV出力ヘルパー: ダブルクォートエスケープ
function csvEscape(val: string): string {
  const s = val.replace(/[\r\n]+/g, " ").trim();
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  return `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,"0")}${String(dt.getDate()).padStart(2,"0")}`;
}
function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

// 進捗状態を保持するインメモリストア（進捗は一時的なものなのでインメモリでOK）
type ProgressEntry = {
  message: string;
  percent: number;
  updatedAt: number;
  failedVideos: Array<{ tiktokVideoId: string; error: string }>;
  totalTarget: number;
  processedCount: number;
};
const progressStore = new Map<number, ProgressEntry>();

// メモリ管理: 10分以上更新のないエントリを定期的に削除
setInterval(() => {
  const staleThreshold = Date.now() - 10 * 60 * 1000;
  for (const [jobId, entry] of progressStore) {
    if (entry.updatedAt < staleThreshold) {
      progressStore.delete(jobId);
      console.log(`[ProgressStore] Evicted stale entry for job ${jobId}`);
    }
  }
  for (const [jobId, entry] of trendProgressStore) {
    if (entry.updatedAt < staleThreshold) {
      trendProgressStore.delete(jobId);
      console.log(`[TrendProgressStore] Evicted stale entry for job ${jobId}`);
    }
  }
  for (const [id, entry] of campaignProgressStore) {
    if (entry.updatedAt < staleThreshold) {
      campaignProgressStore.delete(id);
    }
  }
}, 5 * 60 * 1000).unref(); // .unref() でプロセス終了をブロックしない

// トレンド発見用の進捗ストア（既存のprogressStoreとは分離）
type TrendProgressEntry = {
  message: string;
  percent: number;
  updatedAt: number;
};
const trendProgressStore = new Map<number, TrendProgressEntry>();

function setTrendProgress(jobId: number, message: string, percent: number) {
  trendProgressStore.set(jobId, { message, percent, updatedAt: Date.now() });
}

// キャンペーンスナップショット用の進捗ストア
const campaignProgressStore = new Map<number, { message: string; percent: number; phase: string; updatedAt: number }>();
function setCampaignProgress(snapshotId: number, progress: SnapshotProgress) {
  campaignProgressStore.set(snapshotId, { ...progress, updatedAt: Date.now() });
}

function setProgress(jobId: number, progress: { message: string; percent: number }) {
  const existing = progressStore.get(jobId);
  progressStore.set(jobId, {
    ...progress,
    updatedAt: Date.now(),
    failedVideos: existing?.failedVideos ?? [],
    totalTarget: existing?.totalTarget ?? 0,
    processedCount: existing?.processedCount ?? 0,
  });
}

function addFailedVideo(jobId: number, tiktokVideoId: string, error: string) {
  const entry = progressStore.get(jobId);
  if (entry) {
    entry.failedVideos.push({ tiktokVideoId, error: error.substring(0, 200) });
    entry.updatedAt = Date.now();
  }
}


export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  analysis: router({
    // 新しい分析ジョブを作成
    create: protectedProcedure
      .input(z.object({
        keyword: z.string().optional(),
        manualUrls: z.array(z.string().url()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!input.keyword && (!input.manualUrls || input.manualUrls.length === 0)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "キーワードまたは動画URLのいずれかを指定してください",
          });
        }

        const jobId = await db.createAnalysisJob({
          userId: ctx.user.id,
          keyword: input.keyword,
          manualUrls: input.manualUrls,
          status: "pending",
        });

        return { jobId };
      }),

    // 分析ジョブの一覧を取得
    list: protectedProcedure.query(async ({ ctx }) => {
      return db.getAnalysisJobsByUserId(ctx.user.id);
    }),

    // 特定の分析ジョブの詳細を取得
    getById: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        try {
          const job = await db.getAnalysisJobById(input.jobId);
        if (!job) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分析ジョブが見つかりません" });
        }
        if (job.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "このジョブにアクセスする権限がありません" });
        }

        const videosDataRaw = await db.getVideosByJobId(input.jobId);

        // 重複排除: 同じvideoIdが複数レコード存在する場合、最新（id大）を優先
        const seen = new Map<string, typeof videosDataRaw[0]>();
        for (const v of videosDataRaw) {
          const existing = seen.get(v.videoId);
          if (!existing || v.id > existing.id) {
            seen.set(v.videoId, v);
          }
        }
        const videosData = Array.from(seen.values());

        // 各動画のOCR結果、音声文字起こし、スコアを取得
        const videosWithDetails = await Promise.all(
          videosData.map(async (video) => {
            const ocrResultsData = await db.getOcrResultsByVideoId(video.id);
            const transcription = await db.getTranscriptionByVideoId(video.id);
            const score = await db.getAnalysisScoreByVideoId(video.id);
            
            return {
              ...video,
              ocrResults: ocrResultsData,
              transcription,
              score,
            };
          })
        );

        // レポートを取得
        const report = await db.getAnalysisReportByJobId(input.jobId);

        // 検索結果をDBから取得
        const tripleSearchData = await db.getTripleSearchResultByJobId(input.jobId);

        // セッション数を searchData から動的に取得
        const numSessions = tripleSearchData?.searchData?.length ?? 0;

        // 各動画の出現回数を searchData から動的に計算
        const videoAppearanceCount = new Map<string, number>();
        if (tripleSearchData?.searchData) {
          for (const session of tripleSearchData.searchData) {
            const seen = new Set<string>();
            for (const vid of session.videoIds) {
              if (!seen.has(vid)) {
                seen.add(vid);
                videoAppearanceCount.set(vid, (videoAppearanceCount.get(vid) || 0) + 1);
              }
            }
          }
        }

        // 出現回数別にグループ化（API返却用）
        const appearanceCountMap: Record<number, string[]> = {};
        for (let c = numSessions; c >= 1; c--) {
          appearanceCountMap[c] = [];
        }
        for (const [videoId, count] of videoAppearanceCount.entries()) {
          const clamped = Math.min(count, numSessions || count);
          if (!appearanceCountMap[clamped]) appearanceCountMap[clamped] = [];
          appearanceCountMap[clamped].push(videoId);
        }

        // 各動画の順位情報を searchData から計算（重複率分析の高度化）
        // dominanceScore: 各セッションでの順位の逆数の平均 × 100（高いほど上位に安定して表示される）
        const rankInfo: Record<string, {
          ranks: (number | null)[];
          avgRank: number;
          dominanceScore: number;
          appearanceCount: number;
        }> = {};
        if (tripleSearchData?.searchData && numSessions > 0) {
          const allVideoIds = [
            ...(tripleSearchData.appearedInAll3Ids ?? []),
            ...(tripleSearchData.appearedIn2Ids ?? []),
            ...(tripleSearchData.appearedIn1OnlyIds ?? []),
          ];
          for (const videoId of allVideoIds) {
            const ranks: (number | null)[] = new Array(numSessions).fill(null);
            for (const session of tripleSearchData.searchData) {
              const idx = session.videoIds.indexOf(videoId);
              if (idx !== -1 && session.sessionIndex < numSessions) {
                ranks[session.sessionIndex] = idx + 1;
              }
            }
            const presentRanks = ranks.filter((r): r is number => r !== null);
            const avgRank = presentRanks.length > 0
              ? presentRanks.reduce((a, b) => a + b, 0) / presentRanks.length
              : 999;
            const dominanceScore = presentRanks.reduce((sum, r) => sum + (1 / r), 0) / numSessions * 100;
            rankInfo[videoId] = { ranks, avgRank, dominanceScore, appearanceCount: videoAppearanceCount.get(videoId) ?? 0 };
          }
        }

        return {
          job,
          videos: videosWithDetails,
          report,
          tripleSearch: tripleSearchData ? {
            searches: tripleSearchData.searchData ?? [],
            numSessions,
            duplicateAnalysis: {
              appearedInAll3Count: tripleSearchData.appearedInAll3Ids?.length ?? 0,
              appearedIn2Count: tripleSearchData.appearedIn2Ids?.length ?? 0,
              appearedIn1OnlyCount: tripleSearchData.appearedIn1OnlyIds?.length ?? 0,
              overlapRate: (tripleSearchData.overlapRate ?? 0) / 10,
              appearedInAll3Ids: tripleSearchData.appearedInAll3Ids ?? [],
              appearedIn2Ids: tripleSearchData.appearedIn2Ids ?? [],
              appearedIn1OnlyIds: tripleSearchData.appearedIn1OnlyIds ?? [],
              appearanceCountMap,
            },
            commonalityAnalysis: tripleSearchData.commonalityAnalysis ?? null,
            losePatternAnalysis: tripleSearchData.losePatternAnalysis ?? null,
            commonalityAnalysisAd: tripleSearchData.commonalityAnalysisAd ?? null,
            losePatternAnalysisAd: tripleSearchData.losePatternAnalysisAd ?? null,
            rankInfo,
          } : null,
        };
        } catch (error) {
          console.error(`[Analysis] Error in getById for job ${input.jobId}:`, error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "分析ジョブの詳細取得に失敗しました",
          });
        }
      }),

    // 分析を実行（バックグラウンド処理）- 5シークレットブラウザ検索方式
    execute: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const job = await db.getAnalysisJobById(input.jobId);
        if (!job) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分析ジョブが見つかりません" });
        }
        if (job.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "このジョブにアクセスする権限がありません" });
        }

        // ユーザーレート制限: 1人1つまで同時分析可能
        const processingJob = await db.getProcessingJobByUserId(ctx.user.id);
        if (processingJob && processingJob.id !== input.jobId) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `別の分析が実行中です（ジョブ #${processingJob.id}）。完了後に再度お試しください。`,
          });
        }

        // ステータスを処理中に更新
        await db.updateAnalysisJobStatus(input.jobId, "processing");

        // 検索データが既に存在するかチェック（途中再開判定）
        const existingSearchResult = await db.getTripleSearchResultByJobId(input.jobId);
        const existingVideos = await db.getVideosByJobId(input.jobId);
        const canResume = !!(job.keyword && existingSearchResult && existingVideos.length > 0);

        if (!canResume) {
          // 新規実行: 古い動画データをクリア（重複防止）
          await db.clearJobVideoData(input.jobId);
        }

        // ジョブキューに投入（グローバル同時実行制限）
        analysisQueuePending++;
        const queuePosition = analysisQueuePending;
        if (analysisQueue.activeCount >= 2) {
          setProgress(input.jobId, { message: `キュー待ち中...（${queuePosition}番目）`, percent: 0 });
          console.log(`[Analysis] Job ${input.jobId} queued (position: ${queuePosition}, active: ${analysisQueue.activeCount})`);
        } else {
          setProgress(input.jobId, { message: "分析を開始しています...", percent: 0 });
        }

        // キャンセルフラグをクリア（再実行に備える）
        cancelledJobs.delete(input.jobId);

        // ジョブキュー経由で非同期実行
        analysisQueue(async () => {
          analysisQueuePending--;
          setProgress(input.jobId, { message: "分析を開始しています...", percent: 0 });
          try {
            checkCancelled(input.jobId);
            if (job.keyword) {
              if (canResume) {
                // === 途中再開モード: 検索スキップ、未分析動画のみ再処理 ===
                console.log(`[Analysis] Resuming job ${input.jobId} - skipping search (${existingVideos.length} videos in DB)`);
                setProgress(input.jobId, { message: `途中から再開中...（${existingVideos.length}件の動画データを再利用）`, percent: 42 });

                // センチメント未分析の動画を抽出
                const videosNeedingSentiment = existingVideos.filter(v => !v.sentiment);

                if (videosNeedingSentiment.length > 0) {
                  const BATCH_SIZE = 5;
                  const total = videosNeedingSentiment.length;
                  {
                    const entry = progressStore.get(input.jobId);
                    if (entry) {
                      entry.totalTarget = existingVideos.length;
                      entry.processedCount = existingVideos.length - total;
                    }
                  }

                  for (let i = 0; i < total; i += BATCH_SIZE) {
                    checkCancelled(input.jobId);
                    const batch = videosNeedingSentiment.slice(i, i + BATCH_SIZE);
                    const done = Math.min(i + BATCH_SIZE, total);

                    setProgress(input.jobId, {
                      message: `センチメント分析中... (${done}/${total})`,
                      percent: 42 + Math.floor((done / total) * 36),
                    });

                    // DBからSentimentInputを復元
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

                    const entry = progressStore.get(input.jobId);
                    if (entry) entry.processedCount = existingVideos.length - total + done;
                  }
                }

                // レポート再生成のため既存レポートを削除
                await db.deleteAnalysisReportByJobId(input.jobId);

              } else {
              // === 新規実行: 複数シークレットブラウザでTikTok検索 ===
              checkCancelled(input.jobId);
              console.log(`[Analysis] Starting triple TikTok search for keyword: ${job.keyword}`);
              setProgress(input.jobId, { message: `${SCRAPER_SESSION_COUNT}つのシークレットブラウザでTikTok検索を開始...`, percent: 5 });

              const tripleResult = await searchTikTokTriple(
                job.keyword,
                SCRAPER_VIDEOS_PER_SESSION,
                SCRAPER_SESSION_COUNT,
                (msg: string, scraperPct: number) => {
                  // スクレイパーの進捗(5-90%)を全体の検索フェーズ(5-40%)にマッピング
                  const pct = Math.min(40, Math.round(5 + ((scraperPct - 5) / 85) * 35));
                  setProgress(input.jobId, { message: msg, percent: pct });
                }
              );

              // 検索結果をDBに永続化
              // DB列: appearedInAll3Ids=全セッション出現, appearedIn2Ids=2回以上(全未満), appearedIn1OnlyIds=1回のみ
              const { videosByAppearanceCount, numSessions } = tripleResult.duplicateAnalysis;
              const allSessionVideos = videosByAppearanceCount[numSessions] ?? [];
              const oneOnlyVideos = videosByAppearanceCount[1] ?? [];
              // 2回以上〜全セッション未満の動画を結合
              const midVideos: typeof allSessionVideos = [];
              for (let c = numSessions - 1; c >= 2; c--) {
                midVideos.push(...(videosByAppearanceCount[c] ?? []));
              }

              await db.saveTripleSearchResult({
                jobId: input.jobId,
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

              // 全ユニーク動画を分析対象にする（重複度情報付き）
              const allUniqueVideos = tripleResult.duplicateAnalysis.allUniqueVideos;
              
              setProgress(input.jobId, {
                message: `${allUniqueVideos.length}件のユニーク動画を分析中...`,
                percent: 42,
              });

              // 各動画を分析（重複度情報も含めてDB保存）
              // 5本ずつバッチ処理: Phase1=並列OCR+DB登録, Phase2=センチメント1回LLM, Phase3=DB更新
              const BATCH_SIZE = 5;
              const total = allUniqueVideos.length;
              {
                const entry = progressStore.get(input.jobId);
                if (entry) { entry.totalTarget = total; entry.processedCount = 0; }
              }

              for (let i = 0; i < total; i += BATCH_SIZE) {
                checkCancelled(input.jobId);
                const batch = allUniqueVideos.slice(i, i + BATCH_SIZE);
                const done = Math.min(i + BATCH_SIZE, total);

                // Phase1: 並列でOCR・DB登録（センチメントLLMはスキップ）
                const p1Pct = 42 + Math.floor((i / total) * 36);
                setProgress(input.jobId, {
                  message: `動画登録中... (${done}/${total})`,
                  percent: p1Pct,
                });

                const batchSettled = await Promise.allSettled(
                  batch.map(tiktokVideo => analyzeVideoFromTikTok(input.jobId, tiktokVideo, { skipSentiment: true }))
                );
                const batchResults = batchSettled
                  .filter((r): r is PromiseFulfilledResult<{ dbVideoId: number; sentimentInput: SentimentInput }> => r.status === "fulfilled")
                  .map(r => r.value);
                // 失敗した動画を記録
                batchSettled.forEach((r, idx) => {
                  if (r.status === "rejected") {
                    const vid = batch[idx];
                    const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
                    console.error(`[Analysis] Video ${vid.id} failed:`, errMsg);
                    addFailedVideo(input.jobId, vid.id, errMsg);
                  }
                });

                if (batchResults.length === 0) {
                  const entry = progressStore.get(input.jobId);
                  if (entry) entry.processedCount = done;
                  continue;
                }

                // Phase2: センチメント分析（1回のLLM）
                const p2Pct = 42 + Math.floor(((i + BATCH_SIZE * 0.5) / total) * 36);
                setProgress(input.jobId, {
                  message: `センチメント分析中... (${done}/${total})`,
                  percent: p2Pct,
                });

                const sentimentResults = await analyzeSentimentAndKeywordsBatch(
                  batchResults.map(r => r.sentimentInput)
                );

                // Phase3: DB更新
                await Promise.all(
                  batchResults.map((r, j) => db.updateVideo(r.dbVideoId, {
                    sentiment: sentimentResults[j]?.sentiment ?? "neutral",
                    keyHook: sentimentResults[j]?.keyHook ?? "",
                    keywords: sentimentResults[j]?.keywords ?? [],
                  }))
                );

                const entry = progressStore.get(input.jobId);
                if (entry) entry.processedCount = done;

                const p3Pct = 42 + Math.floor((done / total) * 36);
                setProgress(input.jobId, {
                  message: `動画分析中... (${done}/${total}${entry?.failedVideos.length ? ` / ${entry.failedVideos.length}件失敗` : ""})`,
                  percent: p3Pct,
                });
              }

              } // end of else (new execution with search)
            } else if (job.manualUrls && job.manualUrls.length > 0) {
              // === 手動URL指定の場合 ===
              for (let i = 0; i < job.manualUrls.length; i++) {
                const url = job.manualUrls[i];
                const percent = Math.floor(((i + 1) / job.manualUrls.length) * 85);
                setProgress(input.jobId, {
                  message: `動画分析中... (${i + 1}/${job.manualUrls.length})`,
                  percent,
                });
                await analyzeVideoFromUrl(input.jobId, url);
              }
            }

            // レポート生成
            checkCancelled(input.jobId);
            setProgress(input.jobId, { message: "分析レポート生成中...", percent: 85 });
            await generateAnalysisReport(input.jobId);

            // 勝ちパターン動画の共通点をLLMで分析（オーガニック）
            checkCancelled(input.jobId);
            setProgress(input.jobId, { message: "勝ちパターン（オーガニック）を分析中...", percent: 88 });
            if (job.keyword) {
              await analyzeWinPatternCommonality(input.jobId, job.keyword);
            }

            // 勝ちパターン動画の共通点をLLMで分析（Ad）
            checkCancelled(input.jobId);
            setProgress(input.jobId, { message: "勝ちパターン（Ad）を分析中...", percent: 91 });
            if (job.keyword) {
              await analyzeWinPatternCommonalityAd(input.jobId, job.keyword);
            }

            // 負けパターン動画のBadポイント分析（オーガニック）
            checkCancelled(input.jobId);
            setProgress(input.jobId, { message: "負けパターン（オーガニック）を分析中...", percent: 94 });
            if (job.keyword) {
              await analyzeLosePatternCommonality(input.jobId, job.keyword);
            }

            // 負けパターン動画のBadポイント分析（Ad）
            checkCancelled(input.jobId);
            setProgress(input.jobId, { message: "負けパターン（Ad）を分析中...", percent: 97 });
            if (job.keyword) {
              await analyzeLosePatternCommonalityAd(input.jobId, job.keyword);
            }

            // ステータスを完了に更新
            await db.updateAnalysisJobStatus(input.jobId, "completed", new Date());
            setProgress(input.jobId, { message: "分析完了", percent: 100 });
            // メモリリーク対策: 完了後に進捗情報を削除
            setTimeout(() => {
              progressStore.delete(input.jobId);
              console.log(`[Analysis] Progress store cleaned for job ${input.jobId}`);
            }, 5000);
            console.log(`[Analysis] Completed analysis for job ${input.jobId}`);
          } catch (error) {
            // キャンセル処理
            if (error instanceof JobCancelledError) {
              cancelledJobs.delete(input.jobId);
              await db.updateAnalysisJobStatus(input.jobId, "failed");
              setProgress(input.jobId, { message: "分析がキャンセルされました。収集済みデータは保持されています。", percent: -1 });
              console.log(`[Analysis] Job ${input.jobId} cancelled by user`);
              return;
            }

            const errorMessage = error instanceof Error ? error.message : "不明なエラー";
            const isLLMQuotaError = error instanceof LLMQuotaExhaustedError
              || errorMessage.includes("usage exhausted")
              || errorMessage.includes("412 Precondition Failed")
              || errorMessage.includes("quota");
            console.error("[Analysis] Error:", errorMessage);
            console.error("[Analysis] Full error:", error);

            await db.updateAnalysisJobStatus(input.jobId, "failed");

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

            setProgress(input.jobId, {
              message: `分析失敗: ${userMessage}`,
              percent: -1,
            });
            // メモリリーク対策: エラー時は5分後に進捗情報を削除（エラーメッセージを保持するため長めに設定）
            setTimeout(() => {
              progressStore.delete(input.jobId);
              console.log(`[Analysis] Progress store cleaned after error for job ${input.jobId}`);
            }, 5 * 60 * 1000);
          }
        }).catch(err => {
          console.error(`[Analysis] Queue error for job ${input.jobId}:`, err);
        });

        return { success: true, message: `${SCRAPER_SESSION_COUNT}つのシークレットブラウザでTikTok検索を開始しました。` };
      }),

    // LLM再分析（既存動画データに対してLLM部分だけ再実行）
    reAnalyzeLLM: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const job = await db.getAnalysisJobById(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "ジョブが見つかりません" });
        if (job.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });

        const videos = await db.getVideosByJobId(input.jobId);
        if (videos.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "動画データがありません" });

        // ユーザーレート制限: 1人1つまで同時分析可能
        const processingJob = await db.getProcessingJobByUserId(ctx.user.id);
        if (processingJob && processingJob.id !== input.jobId) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `別の分析が実行中です（ジョブ #${processingJob.id}）。完了後に再度お試しください。`,
          });
        }

        // ステータスをprocessingに
        await db.updateAnalysisJobStatus(input.jobId, "processing");

        // ジョブキューに投入
        analysisQueuePending++;
        if (analysisQueue.activeCount >= 2) {
          setProgress(input.jobId, { message: "キュー待ち中...", percent: 0 });
        } else {
          setProgress(input.jobId, { message: "LLM再分析を開始...", percent: 5 });
        }

        analysisQueue(async () => {
          analysisQueuePending--;
          setProgress(input.jobId, { message: "LLM再分析を開始...", percent: 5 });
          try {
            const BATCH_SIZE = 5;
            const total = videos.length;

            // Phase1: センチメント再分析
            for (let i = 0; i < total; i += BATCH_SIZE) {
              const batch = videos.slice(i, i + BATCH_SIZE);
              const done = Math.min(i + BATCH_SIZE, total);
              setProgress(input.jobId, {
                message: `センチメント再分析中... (${done}/${total})`,
                percent: Math.floor((done / total) * 60),
              });

              // 各動画のOCR/Transcriptionデータを取得
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

            // Phase2: 既存レポート削除 → レポート再生成
            setProgress(input.jobId, { message: "レポート再生成中...", percent: 70 });
            await db.deleteAnalysisReportByJobId(input.jobId);
            await generateAnalysisReport(input.jobId);

            // Phase3: 勝ちパターン共通点分析（オーガニック）
            setProgress(input.jobId, { message: "勝ちパターン（オーガニック）を再分析中...", percent: 80 });
            if (job.keyword) {
              await analyzeWinPatternCommonality(input.jobId, job.keyword);
            }

            // Phase4: 勝ちパターン共通点分析（Ad）
            setProgress(input.jobId, { message: "勝ちパターン（Ad）を再分析中...", percent: 85 });
            if (job.keyword) {
              await analyzeWinPatternCommonalityAd(input.jobId, job.keyword);
            }

            // Phase5: 負けパターン分析（オーガニック）
            setProgress(input.jobId, { message: "負けパターン（オーガニック）を再分析中...", percent: 90 });
            if (job.keyword) {
              await analyzeLosePatternCommonality(input.jobId, job.keyword);
            }

            // Phase6: 負けパターン分析（Ad）
            setProgress(input.jobId, { message: "負けパターン（Ad）を再分析中...", percent: 95 });
            if (job.keyword) {
              await analyzeLosePatternCommonalityAd(input.jobId, job.keyword);
            }

            await db.updateAnalysisJobStatus(input.jobId, "completed", new Date());
            setProgress(input.jobId, { message: "LLM再分析完了", percent: 100 });
            setTimeout(() => progressStore.delete(input.jobId), 5000);
            console.log(`[ReAnalyze] Completed LLM re-analysis for job ${input.jobId}`);
          } catch (error) {
            console.error("[ReAnalyze] Error:", error);
            await db.updateAnalysisJobStatus(input.jobId, "completed", new Date());
            setProgress(input.jobId, { message: "LLM再分析でエラー発生", percent: -1 });
            setTimeout(() => progressStore.delete(input.jobId), 5 * 60 * 1000);
          }
        }).catch(err => {
          console.error(`[ReAnalyze] Queue error for job ${input.jobId}:`, err);
        });

        return { success: true, message: "LLM再分析を開始しました" };
      }),

    // 分析の進捗状況を取得
    getProgress: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        const job = await db.getAnalysisJobById(input.jobId);
        if (!job) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分析ジョブが見つかりません" });
        }
        if (job.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "このジョブにアクセスする権限がありません" });
        }

        // インメモリの進捗情報を取得
        const progressInfo = progressStore.get(input.jobId);

        const videosData = await db.getVideosByJobId(input.jobId);
        const totalVideos = videosData.length;
        
        // 各動画の分析完了状況をチェック
        let completedVideos = 0;
        for (const video of videosData) {
          const score = await db.getAnalysisScoreByVideoId(video.id);
          if (score) {
            completedVideos++;
          }
        }

        return {
          status: job.status,
          totalVideos,
          completedVideos,
          progress: progressInfo?.percent ?? (totalVideos > 0 ? Math.round((completedVideos / totalVideos) * 100) : 0),
          currentStep: progressInfo?.message ?? (
            job.status === "processing"
              ? `動画分析中... (${completedVideos}/${totalVideos})`
              : job.status === "completed"
              ? "分析完了"
              : job.status === "failed"
              ? "分析失敗: 分析に失敗しました。再実行してください。"
              : "待機中"
          ),
          failedVideos: progressInfo?.failedVideos ?? [],
          queue: {
            activeJobs: analysisQueue.activeCount,
            pendingJobs: analysisQueue.pendingCount,
          },
        };
      }),
    // CSVエクスポート（動画一覧）
    exportCsv: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        const job = await db.getAnalysisJobById(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        if (job.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });

        const videos = await db.getVideosByJobId(input.jobId);
        const tripleSearch = await db.getTripleSearchResultByJobId(input.jobId);
        const rankInfo = (tripleSearch as any)?.rankInfo ?? {};

        const header = "No,動画ID,アカウント名,フォロワー数,説明文,再生数,いいね,コメント,シェア,保存,ER(%),センチメント,キーフック,ハッシュタグ,動画尺(秒),投稿日時,Ad判定,出現回数,URL";
        const rows = videos.map((v, i) => {
          const views = Number(v.viewCount) || 0;
          const eng = (Number(v.likeCount)||0) + (Number(v.commentCount)||0) + (Number(v.shareCount)||0) + (Number(v.saveCount)||0);
          const er = views > 0 ? ((eng / views) * 100).toFixed(2) : "0";
          const hashtags = (v.hashtags as string[] || []).join(" ");
          const posted = v.postedAt ? new Date(v.postedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "";
          const ri = rankInfo[v.videoId];
          const isAd = (v as any).isAd ? "Yes" : "No";
          return [
            i + 1,
            v.videoId,
            csvEscape(v.accountName || ""),
            v.followerCount ?? "",
            csvEscape(v.description || ""),
            v.viewCount,
            v.likeCount,
            v.commentCount,
            v.shareCount,
            v.saveCount,
            er,
            v.sentiment === "positive" ? "Positive" : v.sentiment === "negative" ? "Negative" : v.sentiment === "neutral" ? "Neutral" : "",
            csvEscape(v.keyHook || ""),
            csvEscape(hashtags),
            v.duration || "",
            posted,
            isAd,
            ri?.appearanceCount ?? "",
            v.videoUrl,
          ].join(",");
        });
        return { csv: [header, ...rows].join("\n"), filename: `動画一覧_${job.keyword || "manual"}_${fmtDate(job.createdAt)}.csv` };
      }),

    // トレンド推移: 同一キーワードの過去ジョブ+レポートを取得
    trend: protectedProcedure
      .input(z.object({ keyword: z.string() }))
      .query(async ({ ctx, input }) => {
        const allJobs = await db.getAnalysisJobsByUserId(ctx.user.id);
        const matchedJobs = allJobs
          .filter(j => j.keyword === input.keyword && j.status === "completed")
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        const results = [];
        for (const job of matchedJobs) {
          const report = await db.getAnalysisReportByJobId(job.id);
          if (report) {
            results.push({
              jobId: job.id,
              date: job.createdAt,
              totalVideos: report.totalVideos,
              totalViews: Number(report.totalViews),
              totalEngagement: Number(report.totalEngagement),
              positivePercentage: report.positivePercentage,
              neutralPercentage: report.neutralPercentage,
              negativePercentage: report.negativePercentage,
              positiveViewsShare: report.positiveViewsShare,
              negativeViewsShare: report.negativeViewsShare,
            });
          }
        }
        return { keyword: input.keyword, points: results };
      }),

    // ダッシュボード: 全ジョブの俯瞰データ
    dashboard: protectedProcedure
      .query(async ({ ctx }) => {
        const allJobs = await db.getAnalysisJobsByUserId(ctx.user.id);
        const completedJobs = allJobs.filter(j => j.status === "completed");

        // キーワード別集計
        const keywordMap = new Map<string, number>();
        for (const job of completedJobs) {
          if (job.keyword) {
            keywordMap.set(job.keyword, (keywordMap.get(job.keyword) || 0) + 1);
          }
        }

        // 最新5ジョブのレポートサマリ
        const recentSummaries = [];
        for (const job of completedJobs.slice(0, 5)) {
          const report = await db.getAnalysisReportByJobId(job.id);
          if (report) {
            recentSummaries.push({
              jobId: job.id,
              keyword: job.keyword || "手動URL",
              date: job.createdAt,
              totalVideos: report.totalVideos,
              totalViews: Number(report.totalViews),
              positivePercentage: report.positivePercentage,
              negativePercentage: report.negativePercentage,
            });
          }
        }

        return {
          totalJobs: allJobs.length,
          completedJobs: completedJobs.length,
          failedJobs: allJobs.filter(j => j.status === "failed").length,
          topKeywords: Array.from(keywordMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([keyword, count]) => ({ keyword, count })),
          recentSummaries,
        };
      }),

    // ジョブを削除
    delete: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const job = await db.getAnalysisJobById(input.jobId);
        if (!job) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分析ジョブが見つかりません" });
        }
        if (job.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "このジョブにアクセスする権限がありません" });
        }
        if (job.status === "processing") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "処理中のジョブは削除できません" });
        }
        await db.deleteAnalysisJob(input.jobId);
        return { success: true };
      }),

    // ジョブを一括削除
    bulkDelete: protectedProcedure
      .input(z.object({ jobIds: z.array(z.number()).min(1).max(100) }))
      .mutation(async ({ ctx, input }) => {
        const skipped: number[] = [];
        let deleted = 0;
        for (const jobId of input.jobIds) {
          const job = await db.getAnalysisJobById(jobId);
          if (!job || job.userId !== ctx.user.id) {
            skipped.push(jobId);
            continue;
          }
          if (job.status === "processing") {
            skipped.push(jobId);
            continue;
          }
          await db.deleteAnalysisJob(jobId);
          deleted++;
        }
        return { success: true, deleted, skipped };
      }),

    // 単一ジョブのPDFエクスポート（仮組環境では停止）
    // exportPdf: protectedProcedure
    //   .input(z.object({ jobId: z.number() }))
    //   .mutation(async ({ ctx, input }) => {
    //     const job = await db.getAnalysisJobById(input.jobId);
    //     if (!job) {
    //       throw new TRPCError({ code: "NOT_FOUND", message: "分析ジョブが見つかりません" });
    //     }
    //     if (job.userId !== ctx.user.id) {
    //       throw new TRPCError({ code: "FORBIDDEN", message: "このジョブにアクセスする権限がありません" });
    //     }
    //
    //     // 分析データを取得
    //     const videosData = await db.getVideosByJobId(input.jobId);
    //     const report = await db.getAnalysisReportByJobId(input.jobId);
    //     const tripleSearch = await db.getTripleSearchResultByJobId(input.jobId);
    //
    //     // PDFを生成
    //     const docxBuffer = await generateAnalysisReportDocx({
    //       job,
    //       report: report || undefined,
    //       videos: videosData,
    //       tripleSearch: tripleSearch || undefined,
    //       keyword: job.keyword || undefined,
    //     });
    //
    //     return {
    //       success: true,
    //       buffer: docxBuffer.toString("base64"),
    //       filename: `VSEO_Report_${job.id}_${new Date().toISOString().split("T")[0]}.docx`,
    //     };
    //   }),

    // Puppeteer を使用したPDF出力（アコーディオン全開）（仮組環境では停止）
    // exportPdfPuppeteer: protectedProcedure
    //   .input(z.object({ jobId: z.number() }))
    //   .mutation(async ({ ctx, input }) => {
    //     const job = await db.getAnalysisJobById(input.jobId);
    //     if (!job) {
    //       throw new TRPCError({ code: "NOT_FOUND", message: "分析ジョブが見つかりません" });
    //     }
    //     if (job.userId !== ctx.user.id) {
    //       throw new TRPCError({ code: "FORBIDDEN", message: "このジョブにアクセスする権限がありません" });
    //     }
    //
    //     // トークンを生成（10分有効）
    //     const token = generateExportToken(input.jobId, ctx.user.id, 600);
    //
    //     // レポートビューページのURLを構築
    //     const baseUrl = process.env.VITE_FRONTEND_URL || "http://localhost:3000";
    //     const reportUrl = `${baseUrl}/report/view/${input.jobId}?token=${token}`;
    //
    //     // リクエストからセッション Cookie を取得（堅牢な正規表現処理）
    //     const rawCookieHeader = ctx.req.headers.cookie || "";
    //     const match = rawCookieHeader.match(/(?:^|;\\s*)app_session_id=([^;]*)/);
    //     let sessionCookie: string | undefined = match ? match[1] : undefined;
    //
    //     if (sessionCookie) {
    //       try {
    //         // URLエンコードされている場合にデコード
    //         sessionCookie = decodeURIComponent(sessionCookie);
    //         console.log("[PDF Export] Session cookie extracted and decoded");
    //       } catch (e) {
    //         console.warn("[PDF Export] Cookie decode error:", e);
    //         sessionCookie = undefined;
    //       }
    //     }
    //
    //     try {
    //       // Puppeteer でPDFを生成
    //       const pdfBuffer = await generatePdfFromUrl(reportUrl, {
    //         width: 1200,
    //         height: 1600,
    //         waitForSelector: "h1.gradient-text",
    //         waitForTimeout: 3000,
    //         sessionCookie: sessionCookie,
    //       });
    //
    //       const filename = `VSEO_Report_${job.id}_${new Date().toISOString().split("T")[0]}.pdf`;
    //       console.log(`[PDF Export] PDF generated successfully for jobId: ${job.id}`);
    //       
    //       return {
    //         success: true,
    //         downloadUrl: `data:application/pdf;base64,${pdfBuffer.toString("base64")}`,
    //         filename,
    //       };
    //     } catch (error) {
    //       const errorMessage = error instanceof Error ? error.message : "不明なエラー";
    //       console.error("[PDF Export] Puppeteer error:", errorMessage);
    //       throw new TRPCError({
    //         code: "INTERNAL_SERVER_ERROR",
    //         message: "PDFの生成に失敗しました: " + errorMessage,
    //       });
    //     }
    //   }),

    // HTML スナップショットから PDF を生成（認証不要）（仮組環境では停止）
    // exportPdfSnapshot: protectedProcedure
    //   .input(z.object({
    //     html: z.string(),
    //     baseUrl: z.string().url(),
    //   }))
    //   .mutation(async ({ ctx, input }) => {
    //     try {
    //       console.log(`[PDF Export] Generating PDF from HTML snapshot`);
    //       const pdfBuffer = await generatePdfFromSnapshot(input.html, input.baseUrl);
    //       
    //       const filename = `VSEO_Report_${new Date().toISOString().split("T")[0]}.pdf`;
    //       console.log(`[PDF Export] PDF generated successfully from snapshot`);
    //       
    //       return {
    //         success: true,
    //         downloadUrl: `data:application/pdf;base64,${pdfBuffer.toString("base64")}`,
    //         filename,
    //       };
    //     } catch (error) {
    //       const errorMessage = error instanceof Error ? error.message : "不明なエラー";
    //       console.error("[PDF Export] Snapshot PDF generation error:", errorMessage);
    //       throw new TRPCError({
    //         code: "INTERNAL_SERVER_ERROR",
    //         message: "PDFの生成に失敗しました: " + errorMessage,
    //       });
    //     }
    //   }),

    // 分析をキャンセル
    cancel: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const job = await db.getAnalysisJobById(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "分析ジョブが見つかりません" });
        if (job.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "このジョブにアクセスする権限がありません" });

        // 既にキャンセル済みの場合は重複リクエストを無視
        if (cancelledJobs.has(input.jobId)) {
          return { success: true, message: "キャンセル処理中です" };
        }

        if (job.status !== "processing") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "実行中のジョブのみキャンセルできます" });
        }

        cancelledJobs.add(input.jobId);
        setProgress(input.jobId, { message: "キャンセル中...（次のチェックポイントで停止します）", percent: -1 });
        console.log(`[Analysis] Cancel requested for job ${input.jobId}`);
        return { success: true, message: "キャンセルリクエストを受け付けました" };
      }),

    // 統合レポートCSV（サマリ＋動画一覧＋アカウント集計＋パターン分析 すべて統合）
    exportCsvReport: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        const job = await db.getAnalysisJobById(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        if (job.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });

        const report = await db.getAnalysisReportByJobId(input.jobId);
        const tripleSearch = await db.getTripleSearchResultByJobId(input.jobId);
        const videos = await db.getVideosByJobId(input.jobId);
        const rankInfo = (tripleSearch as any)?.rankInfo ?? {};

        const lines: string[] = [];

        // ════════════════════════════════════════
        // 1. 分析概要
        // ════════════════════════════════════════
        lines.push("[分析概要]");
        lines.push("項目,値");
        lines.push(`検索キーワード,${csvEscape(job.keyword || "手動URL")}`);
        lines.push(`分析日時,${fmtDateTime(job.createdAt)}`);
        lines.push(`分析動画数,${report?.totalVideos ?? videos.length}`);
        lines.push(`合計再生数,${report?.totalViews ?? ""}`);
        lines.push(`合計エンゲージメント,${report?.totalEngagement ?? ""}`);
        lines.push("");

        // ════════════════════════════════════════
        // 2. センチメント分布＋インパクト
        // ════════════════════════════════════════
        lines.push("[センチメント分布]");
        lines.push("分類,件数,割合(%),再生数シェア(%),エンゲージメントシェア(%)");
        lines.push(`Positive（好意的）,${report?.positiveCount ?? ""},${report?.positivePercentage ?? ""},${report?.positiveViewsShare ?? ""},${report?.positiveEngagementShare ?? ""}`);
        lines.push(`Neutral（中立）,${report?.neutralCount ?? ""},${report?.neutralPercentage ?? ""},,`);
        lines.push(`Negative（否定的）,${report?.negativeCount ?? ""},${report?.negativePercentage ?? ""},${report?.negativeViewsShare ?? ""},${report?.negativeEngagementShare ?? ""}`);
        lines.push("");

        // ════════════════════════════════════════
        // 3. 重複分析
        // ════════════════════════════════════════
        if (tripleSearch) {
          const all3 = (tripleSearch.appearedInAll3Ids as string[] || []).length;
          const in2 = (tripleSearch.appearedIn2Ids as string[] || []).length;
          const in1 = (tripleSearch.appearedIn1OnlyIds as string[] || []).length;
          lines.push("[検索重複分析（3回独立検索）]");
          lines.push("出現パターン,動画数");
          lines.push(`3回すべてに出現（安定上位）,${all3}`);
          lines.push(`2回出現,${in2}`);
          lines.push(`1回のみ出現,${in1}`);
          lines.push(`重複率,${((tripleSearch.overlapRate ?? 0) / 10).toFixed(1)}%`);
          lines.push("");
        }

        // ════════════════════════════════════════
        // 4. 動画一覧（全データ）
        // ════════════════════════════════════════
        lines.push("[動画一覧]");
        lines.push("No,動画ID,アカウント名,フォロワー数,説明文,再生数,いいね,コメント,シェア,保存,ER(%),センチメント,キーフック,ハッシュタグ,動画尺(秒),投稿日時,Ad判定,出現回数,支配度スコア,URL");
        videos.forEach((v, i) => {
          const views = Number(v.viewCount) || 0;
          const eng = (Number(v.likeCount)||0) + (Number(v.commentCount)||0) + (Number(v.shareCount)||0) + (Number(v.saveCount)||0);
          const er = views > 0 ? ((eng / views) * 100).toFixed(2) : "0";
          const hashtags = (v.hashtags as string[] || []).join(" ");
          const posted = v.postedAt ? fmtDateTime(v.postedAt) : "";
          const ri = rankInfo[v.videoId];
          const isAd = (v as any).isAd ? "Yes" : "No";
          lines.push([
            i + 1, v.videoId, csvEscape(v.accountName || ""), v.followerCount ?? "",
            csvEscape(v.description || ""), v.viewCount, v.likeCount, v.commentCount,
            v.shareCount, v.saveCount, er,
            v.sentiment === "positive" ? "Positive" : v.sentiment === "negative" ? "Negative" : v.sentiment === "neutral" ? "Neutral" : "",
            csvEscape(v.keyHook || ""), csvEscape(hashtags), v.duration || "", posted,
            isAd, ri?.appearanceCount ?? "", ri?.dominanceScore?.toFixed(1) ?? "", v.videoUrl,
          ].join(","));
        });
        lines.push("");

        // ════════════════════════════════════════
        // 5. アカウント別集計
        // ════════════════════════════════════════
        lines.push("[アカウント別集計]");
        lines.push("順位,アカウント名,動画数,合計再生数,平均再生数,合計いいね,平均ER(%),フォロワー数");
        const accountMap = new Map<string, typeof videos>();
        for (const v of videos) {
          const name = v.accountName || "不明";
          if (!accountMap.has(name)) accountMap.set(name, []);
          accountMap.get(name)!.push(v);
        }
        [...accountMap.entries()]
          .map(([name, acctVids]) => {
            const totalViews = acctVids.reduce((s, v) => s + (Number(v.viewCount) || 0), 0);
            const totalEng = acctVids.reduce((s, v) => s + (Number(v.likeCount)||0) + (Number(v.commentCount)||0) + (Number(v.shareCount)||0) + (Number(v.saveCount)||0), 0);
            return { name, acctVids, totalViews, totalEng };
          })
          .sort((a, b) => b.totalViews - a.totalViews)
          .forEach((entry, i) => {
            const { name, acctVids, totalViews, totalEng } = entry;
            const avgViews = Math.round(totalViews / acctVids.length);
            const totalLikes = acctVids.reduce((s, v) => s + (Number(v.likeCount) || 0), 0);
            const avgER = totalViews > 0 ? ((totalEng / totalViews) * 100).toFixed(2) : "0";
            const follower = acctVids[0]?.followerCount ?? "";
            lines.push(`${i + 1},${csvEscape(name)},${acctVids.length},${totalViews},${avgViews},${totalLikes},${avgER},${follower}`);
          });
        lines.push("");

        // ════════════════════════════════════════
        // 6. 勝ち／負けパターン分析
        // ════════════════════════════════════════
        const renderPattern = (label: string, p: any, isWin: boolean) => {
          if (!p) return;
          lines.push(`[${label}]`);
          lines.push("分析項目,内容");
          lines.push(`総評,${csvEscape(p.summary || "")}`);
          if (isWin) {
            lines.push(`共通キーフック,${csvEscape(p.keyHook || "")}`);
            lines.push(`コンテンツ傾向,${csvEscape(p.contentTrend || "")}`);
            lines.push(`フォーマット特徴,${csvEscape(p.formatFeatures || "")}`);
            lines.push(`ハッシュタグ戦略,${csvEscape(p.hashtagStrategy || "")}`);
            lines.push(`VSEO攻略ポイント,${csvEscape(p.vseoTips || "")}`);
          } else {
            lines.push(`失敗フック要素,${csvEscape(p.badHook || "")}`);
            lines.push(`コンテンツの弱点,${csvEscape(p.contentWeakness || "")}`);
            lines.push(`フォーマット問題,${csvEscape(p.formatProblems || "")}`);
            lines.push(`ハッシュタグの誤り,${csvEscape(p.hashtagMistakes || "")}`);
            lines.push(`避けるべきポイント,${csvEscape(p.avoidTips || "")}`);
          }
          lines.push("");
        };
        renderPattern("勝ちパターン（オーガニック）", tripleSearch?.commonalityAnalysis, true);
        renderPattern("勝ちパターン（Ad広告）", tripleSearch?.commonalityAnalysisAd, true);
        renderPattern("負けパターン（オーガニック）", tripleSearch?.losePatternAnalysis, false);
        renderPattern("負けパターン（Ad広告）", tripleSearch?.losePatternAnalysisAd, false);

        // ════════════════════════════════════════
        // 7. ハッシュタグ戦略
        // ════════════════════════════════════════
        const hs = report?.hashtagStrategy as any;
        if (hs?.topCombinations?.length) {
          lines.push("[ハッシュタグ組合せランキング]");
          lines.push("順位,タグ組合せ,出現回数,平均ER(%)");
          hs.topCombinations.slice(0, 20).forEach((combo: any, i: number) => {
            const tags = (combo.tags || []).map((t: string) => `#${t}`).join(" ");
            lines.push(`${i + 1},${csvEscape(tags)},${combo.count ?? ""},${combo.avgER ?? ""}`);
          });
          lines.push("");
        }

        // ════════════════════════════════════════
        // 8. ファセット分析
        // ════════════════════════════════════════
        const facets = report?.facets as any[];
        if (facets?.length) {
          lines.push("[ファセット分析（ビジネス観点別）]");
          lines.push("観点,Positive(%),Negative(%),判定");
          for (const f of facets) {
            const pos = Number(f.positive) || 0;
            const judgment = pos >= 75 ? "強み" : pos >= 50 ? "普通" : "改善余地";
            lines.push(`${csvEscape(f.aspect)},${f.positive ?? ""},${f.negative ?? ""},${judgment}`);
          }
          lines.push("");
        }

        // ════════════════════════════════════════
        // 9. AIインサイト＋重要インサイト
        // ════════════════════════════════════════
        if (report?.autoInsight) {
          lines.push("[AIによる総合インサイト]");
          lines.push(csvEscape(report.autoInsight as string));
          lines.push("");
        }

        const keyInsights = report?.keyInsights as any[];
        if (keyInsights?.length) {
          lines.push("[重要インサイト]");
          lines.push("重要度,タイトル,詳細");
          const catLabel: Record<string, string> = { avoid: "要回避", caution: "注意", leverage: "活用推奨" };
          for (const ins of keyInsights) {
            lines.push(`${catLabel[ins.category] || ins.category},${csvEscape(ins.title || "")},${csvEscape(ins.description || "")}`);
          }
        }

        return { csv: lines.join("\n"), filename: `レポート_${job.keyword || "manual"}_${fmtDate(job.createdAt)}.csv` };
      }),

    // ジョブを再実行（failed/pendingのジョブをリセットして再実行）
    retry: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const job = await db.getAnalysisJobById(input.jobId);
        if (!job) {
          throw new TRPCError({ code: "NOT_FOUND", message: "分析ジョブが見つかりません" });
        }
        if (job.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "このジョブにアクセスする権限がありません" });
        }
        if (job.status !== "failed" && job.status !== "pending") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "失敗または待機中のジョブのみ再実行できます" });
        }
        // ステータスをpendingにリセット
        await db.updateAnalysisJobStatus(input.jobId, "pending");
        return { success: true, jobId: input.jobId };
      }),
  }),

  trendDiscovery: router({
    create: protectedProcedure
      .input(z.object({ persona: z.string().min(1).max(200) }))
      .mutation(async ({ ctx, input }) => {
        const jobId = await db.createTrendDiscoveryJob({
          userId: ctx.user.id,
          persona: input.persona,
          status: "pending",
        });
        return { jobId };
      }),

    list: protectedProcedure.query(async ({ ctx }) => {
      return db.getTrendDiscoveryJobsByUserId(ctx.user.id);
    }),

    getById: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        const job = await db.getTrendDiscoveryJobById(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "ジョブが見つかりません" });
        if (job.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        return job;
      }),

    execute: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const job = await db.getTrendDiscoveryJobById(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        if (job.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        if (job.status === "processing") return { success: true, message: "既に実行中です" };
        if (job.status === "completed") return { success: true, message: "既に完了しています" };

        await db.updateTrendDiscoveryJobStatus(input.jobId, "processing");
        setTrendProgress(input.jobId, "処理を開始しています...", 0);

        // バックグラウンド実行（共有キュー使用）
        analysisQueue(async () => {
          try {
            // Step 1: LLM KW拡張 (5%)
            setTrendProgress(input.jobId, "ペルソナからキーワードを拡張中...", 5);
            const { keywords, hashtags } = await expandPersonaToQueries(job.persona);
            console.log(`[TrendDiscovery] Job ${input.jobId}: expanded to ${keywords.length} KW + ${hashtags.length} HT`);

            await db.updateTrendDiscoveryJob(input.jobId, {
              expandedKeywords: keywords,
              expandedHashtags: hashtags,
            });

            // Step 2: バッチスクレイピング (10-80%)
            setTrendProgress(input.jobId, "TikTok検索を開始します...", 10);

            const queries = [
              ...keywords.map(k => ({ query: k, type: "keyword" as const })),
              ...hashtags.map(h => ({ query: h, type: "hashtag" as const })),
            ];

            const batchResults = await searchTikTokBatch(
              queries,
              TREND_VIDEOS_PER_QUERY,
              (msg, completed, total) => {
                const pct = 10 + Math.floor((completed / total) * 70);
                setTrendProgress(input.jobId, msg, pct);
              },
            );

            // tagVideoCountマッピング構築（ハッシュタグ → 総投稿数）
            const tagVideoCountMap = new Map<string, number>();
            for (const r of batchResults) {
              if (r.type === "hashtag" && r.tagVideoCount != null) {
                tagVideoCountMap.set(r.query, r.tagVideoCount);
              }
            }
            if (tagVideoCountMap.size > 0) {
              console.log(`[TrendDiscovery] Job ${input.jobId}: tagVideoCount for ${tagVideoCountMap.size} hashtags`);
            }

            // フラット化
            const allVideos = batchResults.flatMap(r =>
              r.videos.map(v => flattenTikTokVideo(v, r.query, r.type))
            );
            console.log(`[TrendDiscovery] Job ${input.jobId}: scraped ${allVideos.length} total videos`);

            await db.updateTrendDiscoveryJob(input.jobId, {
              scrapedVideos: allVideos,
            });

            // Step 3: 横断集計 (80-90%)
            setTrendProgress(input.jobId, "横断集計を実行中...", 80);
            const crossAnalysis = computeCrossAnalysis(allVideos, new Date(), tagVideoCountMap);

            // Step 4: LLMサマリー (90-95%)
            setTrendProgress(input.jobId, "AIサマリーを生成中...", 90);
            const summary = await generateTrendSummary(job.persona, crossAnalysis);
            crossAnalysis.summary = summary;

            // Step 5: DB保存・完了 (95-100%)
            setTrendProgress(input.jobId, "結果を保存中...", 95);
            await db.updateTrendDiscoveryJob(input.jobId, {
              crossAnalysis,
            });
            await db.updateTrendDiscoveryJobStatus(input.jobId, "completed", new Date());
            setTrendProgress(input.jobId, "完了", 100);
            console.log(`[TrendDiscovery] Job ${input.jobId}: completed`);
          } catch (error) {
            console.error(`[TrendDiscovery] Job ${input.jobId} failed:`, error);
            await db.updateTrendDiscoveryJobStatus(input.jobId, "failed");
            setTrendProgress(input.jobId, `エラー: ${error instanceof Error ? error.message : "不明なエラー"}`, -1);
          }
        });

        return { success: true, message: "実行を開始しました" };
      }),

    getProgress: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        const job = await db.getTrendDiscoveryJobById(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        if (job.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });

        const progressInfo = trendProgressStore.get(input.jobId);
        return {
          status: job.status,
          progress: progressInfo?.percent ?? 0,
          currentStep: progressInfo?.message ?? (
            job.status === "completed" ? "完了"
            : job.status === "failed" ? "失敗"
            : "待機中"
          ),
        };
      }),

    exportCsv: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        const job = await db.getTrendDiscoveryJobById(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        if (job.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });

        const lines: string[] = [];

        // トレンドハッシュタグ
        lines.push("[トレンドハッシュタグ]");
        lines.push("順位,ハッシュタグ,出現動画数,クエリ横断数,平均ER(%)");
        const tags = (job.crossAnalysis as any)?.trendingHashtags || [];
        tags.forEach((t: any, i: number) => {
          lines.push(`${i + 1},#${t.tag},${t.videoCount},${t.queryCount},${t.avgER}`);
        });
        lines.push("");

        // トップ動画
        lines.push("[トップ動画（ER順）]");
        lines.push("順位,動画ID,クリエイター,再生数,ER(%),説明文,ハッシュタグ");
        const topVids = (job.crossAnalysis as any)?.topVideos || [];
        topVids.forEach((v: any, i: number) => {
          lines.push(`${i + 1},${v.videoId},@${v.authorUniqueId},${v.playCount},${v.er},${csvEscape(v.desc || "")},${csvEscape((v.hashtags || []).map((t: string) => "#" + t).join(" "))}`);
        });
        lines.push("");

        // 共起タグ
        lines.push("[共起タグペア]");
        lines.push("順位,タグA,タグB,共起数");
        const pairs = (job.crossAnalysis as any)?.coOccurringTags || [];
        pairs.forEach((p: any, i: number) => {
          lines.push(`${i + 1},#${p.tagA},#${p.tagB},${p.count}`);
        });
        lines.push("");

        // キークリエイター
        lines.push("[キークリエイター]");
        lines.push("順位,ユーザーID,ニックネーム,フォロワー数,動画数,クエリ横断数,合計再生数");
        const creators = (job.crossAnalysis as any)?.keyCreators || [];
        creators.forEach((c: any, i: number) => {
          lines.push(`${i + 1},@${c.uniqueId},${csvEscape(c.nickname || "")},${c.followerCount},${c.videoCount},${c.queryCount},${c.totalPlays}`);
        });

        return {
          csv: lines.join("\n"),
          filename: `トレンド発見_${job.persona}_${fmtDate(job.createdAt)}.csv`,
        };
      }),

    delete: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const job = await db.getTrendDiscoveryJobById(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        if (job.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        if (job.status === "processing") throw new TRPCError({ code: "BAD_REQUEST", message: "処理中のジョブは削除できません" });
        await db.deleteTrendDiscoveryJob(input.jobId);
        return { success: true };
      }),
  }),

  admin: router({
    // ユーザー一覧
    listUsers: adminProcedure.query(async () => {
      return db.getAllUsers();
    }),

    // ユーザーのrole変更
    updateUserRole: adminProcedure
      .input(z.object({ userId: z.number(), role: z.enum(["user", "admin"]) }))
      .mutation(async ({ input }) => {
        await db.updateUserRole(input.userId, input.role);
        return { success: true };
      }),

    // ユーザー削除
    deleteUser: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (input.userId === ctx.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "自分自身は削除できません" });
        }
        await db.deleteUserById(input.userId);
        return { success: true };
      }),

    // デバッグ用: サーバーログを取得
    getLogs: adminProcedure
      .input(z.object({
        lines: z.number().default(500),
      }))
      .query(async ({ input }) => {
        try {
          const memoryLogs = logBuffer.getLines(input.lines);

          if (memoryLogs.length > 0) {
            return {
              success: true,
              logs: memoryLogs,
              totalLines: logBuffer.totalLines,
              displayedLines: memoryLogs.length,
              message: `インメモリバッファから最新 ${memoryLogs.length} 行を取得しました`,
            };
          }

          const logPath = path.join(process.cwd(), '.manus-logs', 'devserver.log');

          if (!fs.existsSync(logPath)) {
            return {
              success: false,
              logs: ['[情報] ログファイルが見つからず、インメモリバッファも空です。サーバーが起動したばかりか、まだログが出力されていません。'],
              message: 'ログファイルが見つからず、インメモリバッファも空です',
            };
          }

          const content = fs.readFileSync(logPath, 'utf-8');
          const lines = content.split('\n').filter((line: string) => line.trim());
          const recentLines = lines.slice(Math.max(0, lines.length - input.lines));

          return {
            success: true,
            logs: recentLines,
            totalLines: lines.length,
            displayedLines: recentLines.length,
            message: `ファイルから最新 ${recentLines.length} 行を取得しました`,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '不明なエラー';
          console.error('[Admin] Log retrieval error:', errorMessage);
          return {
            success: false,
            logs: [`[エラー] ログ取得失敗: ${errorMessage}`],
            message: `ログ取得エラー: ${errorMessage}`,
          };
        }
      }),
  }),

  // ============================
  // 施策効果レポート（キャンペーン）
  // ============================
  campaign: router({
    // キャンペーン一覧
    list: protectedProcedure.query(async ({ ctx }) => {
      return db.getCampaignsByUserId(ctx.user.id);
    }),

    // キャンペーン作成
    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1, "キャンペーン名を入力してください"),
        clientName: z.string().optional(),
        keywords: z.array(z.string()).min(1, "キーワードを1つ以上入力してください"),
        ownAccountIds: z.array(z.string()).min(1, "自社アカウントIDを1つ以上入力してください"),
        ownVideoIds: z.array(z.string()).optional(),
        campaignHashtags: z.array(z.string()).optional(),
        competitors: z.array(z.object({
          name: z.string(),
          account_id: z.string(),
        })).optional(),
        brandKeywords: z.array(z.string()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await db.createCampaign({
          userId: ctx.user.id,
          name: input.name,
          clientName: input.clientName || null,
          keywords: input.keywords,
          ownAccountIds: input.ownAccountIds,
          ownVideoIds: input.ownVideoIds || [],
          campaignHashtags: input.campaignHashtags || [],
          competitors: input.competitors || [],
          brandKeywords: input.brandKeywords || [],
        });
        return { id };
      }),

    // キャンペーン詳細
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const campaign = await db.getCampaignById(input.id);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "キャンペーンが見つかりません" });
        }
        const snapshots = await db.getCampaignSnapshotsByCampaignId(input.id);
        const report = await db.getCampaignReportByCampaignId(input.id);
        return { campaign, snapshots, report };
      }),

    // キャンペーン更新
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        clientName: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        ownAccountIds: z.array(z.string()).optional(),
        ownVideoIds: z.array(z.string()).optional(),
        campaignHashtags: z.array(z.string()).optional(),
        competitors: z.array(z.object({
          name: z.string(),
          account_id: z.string(),
        })).optional(),
        brandKeywords: z.array(z.string()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const campaign = await db.getCampaignById(input.id);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "キャンペーンが見つかりません" });
        }
        const { id, ...updateData } = input;
        await db.updateCampaign(id, updateData);
        return { success: true };
      }),

    // キャンペーン削除
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const campaign = await db.getCampaignById(input.id);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "キャンペーンが見つかりません" });
        }
        await db.deleteCampaign(input.id);
        return { success: true };
      }),

    // スナップショット取得実行
    captureSnapshot: protectedProcedure
      .input(z.object({
        campaignId: z.number(),
        type: z.enum(["baseline", "measurement"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const campaign = await db.getCampaignById(input.campaignId);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "キャンペーンが見つかりません" });
        }

        // スナップショットレコードをpendingで作成
        const snapshotId = await db.createCampaignSnapshot({
          campaignId: input.campaignId,
          snapshotType: input.type,
          status: "pending",
        });

        // 非同期でスナップショット取得を実行
        (async () => {
          try {
            await db.updateCampaignSnapshot(snapshotId, { status: "processing" });

            const snapshotData = await captureSnapshot(
              campaign,
              input.type,
              (progress) => setCampaignProgress(snapshotId, progress),
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
            if (input.type === "baseline") {
              updateData.baselineSnapshotId = snapshotId;
              updateData.status = "baseline_captured";
            } else {
              updateData.measurementSnapshotId = snapshotId;
              updateData.status = "measurement_captured";
            }
            await db.updateCampaign(input.campaignId, updateData);

            // 両方のスナップショットが揃ったらレポート自動生成
            const updatedCampaign = await db.getCampaignById(input.campaignId);
            if (updatedCampaign?.baselineSnapshotId && updatedCampaign?.measurementSnapshotId) {
              const baselineSnapshot = await db.getCampaignSnapshotById(updatedCampaign.baselineSnapshotId);
              const measurementSnapshot = await db.getCampaignSnapshotById(updatedCampaign.measurementSnapshotId);
              if (baselineSnapshot?.status === "completed" && measurementSnapshot?.status === "completed") {
                const reportData = generateCampaignReport(updatedCampaign, baselineSnapshot, measurementSnapshot);
                await db.upsertCampaignReport(reportData);
                await db.updateCampaign(input.campaignId, { status: "report_ready" });
              }
            }

            console.log(`[Campaign] Snapshot ${snapshotId} completed for campaign ${input.campaignId}`);
          } catch (error) {
            console.error(`[Campaign] Snapshot ${snapshotId} failed:`, error);
            await db.updateCampaignSnapshot(snapshotId, { status: "failed" });
          } finally {
            campaignProgressStore.delete(snapshotId);
          }
        })();

        return { snapshotId };
      }),

    // スナップショット進捗取得
    getSnapshotProgress: protectedProcedure
      .input(z.object({ snapshotId: z.number() }))
      .query(async ({ input }) => {
        const snapshot = await db.getCampaignSnapshotById(input.snapshotId);
        const progress = campaignProgressStore.get(input.snapshotId);
        return {
          status: snapshot?.status || "pending",
          progress: progress || null,
        };
      }),

    // レポート取得
    getReport: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ ctx, input }) => {
        const campaign = await db.getCampaignById(input.campaignId);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "キャンペーンが見つかりません" });
        }
        const report = await db.getCampaignReportByCampaignId(input.campaignId);
        if (!report) {
          throw new TRPCError({ code: "NOT_FOUND", message: "レポートが生成されていません" });
        }
        return report;
      }),

    // レポート手動生成
    generateReport: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const campaign = await db.getCampaignById(input.campaignId);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "キャンペーンが見つかりません" });
        }
        if (!campaign.baselineSnapshotId || !campaign.measurementSnapshotId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "ベースラインと効果測定の両方のスナップショットが必要です" });
        }
        const baselineSnapshot = await db.getCampaignSnapshotById(campaign.baselineSnapshotId);
        const measurementSnapshot = await db.getCampaignSnapshotById(campaign.measurementSnapshotId);
        if (!baselineSnapshot || !measurementSnapshot) {
          throw new TRPCError({ code: "NOT_FOUND", message: "スナップショットが見つかりません" });
        }
        const reportData = generateCampaignReport(campaign, baselineSnapshot, measurementSnapshot);
        await db.upsertCampaignReport(reportData);
        await db.updateCampaign(input.campaignId, { status: "report_ready" });
        return { success: true };
      }),

    // CSVエクスポート
    exportCsv: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ ctx, input }) => {
        const campaign = await db.getCampaignById(input.campaignId);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const report = await db.getCampaignReportByCampaignId(input.campaignId);
        if (!report) {
          throw new TRPCError({ code: "NOT_FOUND", message: "レポートが生成されていません" });
        }
        return generateCampaignCsv(report);
      }),
  }),
});

export type AppRouter = typeof appRouter;
