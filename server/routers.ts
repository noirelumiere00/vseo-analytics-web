import { COOKIE_NAME, SCRAPER_SESSION_COUNT, SCRAPER_VIDEOS_PER_SESSION } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { TRPCError } from "@trpc/server";
import { analyzeVideoFromTikTok, analyzeVideoFromUrl, generateAnalysisReport, analyzeWinPatternCommonality, analyzeLosePatternCommonality, analyzeWinPatternCommonalityAd, analyzeLosePatternCommonalityAd, analyzeSentimentAndKeywordsBatch, type SentimentInput } from "./videoAnalysis";
import { LLMQuotaExhaustedError } from "./_core/llm";
import { searchTikTokTriple, type TikTokVideo, type TikTokTripleSearchResult } from "./tiktokScraper";
import { generateAnalysisReportDocx } from "./pdfGenerator";
// pdfExporter: 全エンドポイントがコメントアウト済みのため import 削除（メモリ節約）
// import { generatePdfFromUrl, generatePdfFromSnapshot } from "./pdfExporter";
import { generateExportToken } from "./_core/exportToken";
import * as fs from "fs";
import * as path from "path";
import { logBuffer } from "./logBuffer";
import pLimit from "p-limit";

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
}, 5 * 60 * 1000).unref(); // .unref() でプロセス終了をブロックしない

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
    // CSVエクスポート
    exportCsv: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        const job = await db.getAnalysisJobById(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        if (job.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });

        const videos = await db.getVideosByJobId(input.jobId);
        const header = "動画ID,アカウント,説明文,再生数,いいね,コメント,シェア,保存,ER%,センチメント,キーフック,ハッシュタグ,動画尺(秒),投稿日時,URL";
        const rows = videos.map(v => {
          const views = Number(v.viewCount) || 0;
          const eng = (Number(v.likeCount)||0) + (Number(v.commentCount)||0) + (Number(v.shareCount)||0) + (Number(v.saveCount)||0);
          const er = views > 0 ? ((eng / views) * 100).toFixed(2) : "0";
          const desc = (v.description || "").replace(/[\r\n,]/g, " ").substring(0, 100);
          const hashtags = (v.hashtags as string[] || []).join(" ");
          const posted = v.postedAt ? new Date(v.postedAt).toISOString() : "";
          return `${v.videoId},${v.accountName},"${desc}",${v.viewCount},${v.likeCount},${v.commentCount},${v.shareCount},${v.saveCount},${er},${v.sentiment || ""},${(v.keyHook || "").replace(/,/g, "；")},${hashtags},${v.duration || ""},${posted},${v.videoUrl}`;
        });
        return { csv: [header, ...rows].join("\n"), filename: `analysis_${input.jobId}_${job.keyword || "manual"}.csv` };
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
        if (job.status !== "processing") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "実行中のジョブのみキャンセルできます" });
        }

        cancelledJobs.add(input.jobId);
        setProgress(input.jobId, { message: "キャンセル中...", percent: -1 });
        console.log(`[Analysis] Cancel requested for job ${input.jobId}`);
        return { success: true, message: "キャンセルリクエストを受け付けました" };
      }),

    // レポートCSVエクスポート（センチメント分布、勝ち/負けパターン、ハッシュタグ戦略、インサイト）
    exportCsvReport: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        const job = await db.getAnalysisJobById(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        if (job.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });

        const report = await db.getAnalysisReportByJobId(input.jobId);
        const tripleSearch = await db.getTripleSearchResultByJobId(input.jobId);
        const videos = await db.getVideosByJobId(input.jobId);

        const sections: string[] = [];

        // セクション1: 基本情報
        sections.push("=== 基本情報 ===");
        sections.push(`キーワード,${job.keyword || "手動URL"}`);
        sections.push(`分析日時,${job.createdAt ? new Date(job.createdAt).toLocaleString("ja-JP") : ""}`);
        sections.push(`総動画数,${report?.totalVideos ?? videos.length}`);
        sections.push(`総再生数,${report?.totalViews ?? ""}`);
        sections.push(`総エンゲージメント,${report?.totalEngagement ?? ""}`);
        sections.push("");

        // セクション2: センチメント分布
        sections.push("=== センチメント分布 ===");
        sections.push("分類,件数,割合(%)");
        sections.push(`Positive,${report?.positiveCount ?? ""},${report?.positivePercentage ?? ""}`);
        sections.push(`Neutral,${report?.neutralCount ?? ""},${report?.neutralPercentage ?? ""}`);
        sections.push(`Negative,${report?.negativeCount ?? ""},${report?.negativePercentage ?? ""}`);
        sections.push("");

        // セクション3: インパクト分析
        sections.push("=== インパクト分析 ===");
        sections.push("指標,Positive(%),Negative(%)");
        sections.push(`再生数シェア,${report?.positiveViewsShare ?? ""},${report?.negativeViewsShare ?? ""}`);
        sections.push(`エンゲージメントシェア,${report?.positiveEngagementShare ?? ""},${report?.negativeEngagementShare ?? ""}`);
        sections.push("");

        // セクション4: 重複分析
        if (tripleSearch) {
          sections.push("=== 重複分析 ===");
          const all3 = (tripleSearch.appearedInAll3Ids as string[] || []).length;
          const in2 = (tripleSearch.appearedIn2Ids as string[] || []).length;
          const in1 = (tripleSearch.appearedIn1OnlyIds as string[] || []).length;
          sections.push(`全セッション出現,${all3}`);
          sections.push(`2セッション出現,${in2}`);
          sections.push(`1セッションのみ,${in1}`);
          sections.push(`重複率(%),${((tripleSearch.overlapRate ?? 0) / 10).toFixed(1)}`);
          sections.push("");
        }

        // セクション5: 勝ちパターン分析
        const winOrganic = tripleSearch?.commonalityAnalysis as any;
        if (winOrganic) {
          sections.push("=== 勝ちパターン（オーガニック） ===");
          sections.push(`サマリー,"${(winOrganic.summary || "").replace(/"/g, '""')}"`);
          sections.push(`キーフック,"${(winOrganic.keyHook || "").replace(/"/g, '""')}"`);
          sections.push(`コンテンツ傾向,"${(winOrganic.contentTrend || "").replace(/"/g, '""')}"`);
          sections.push(`フォーマット特徴,"${(winOrganic.formatFeatures || "").replace(/"/g, '""')}"`);
          sections.push(`ハッシュタグ戦略,"${(winOrganic.hashtagStrategy || "").replace(/"/g, '""')}"`);
          sections.push(`VSEOヒント,"${(winOrganic.vseoTips || "").replace(/"/g, '""')}"`);
          sections.push("");
        }

        const winAd = tripleSearch?.commonalityAnalysisAd as any;
        if (winAd) {
          sections.push("=== 勝ちパターン（Ad） ===");
          sections.push(`サマリー,"${(winAd.summary || "").replace(/"/g, '""')}"`);
          sections.push(`キーフック,"${(winAd.keyHook || "").replace(/"/g, '""')}"`);
          sections.push(`コンテンツ傾向,"${(winAd.contentTrend || "").replace(/"/g, '""')}"`);
          sections.push(`フォーマット特徴,"${(winAd.formatFeatures || "").replace(/"/g, '""')}"`);
          sections.push(`ハッシュタグ戦略,"${(winAd.hashtagStrategy || "").replace(/"/g, '""')}"`);
          sections.push(`VSEOヒント,"${(winAd.vseoTips || "").replace(/"/g, '""')}"`);
          sections.push("");
        }

        // セクション6: 負けパターン分析
        const loseOrganic = tripleSearch?.losePatternAnalysis as any;
        if (loseOrganic) {
          sections.push("=== 負けパターン（オーガニック） ===");
          sections.push(`サマリー,"${(loseOrganic.summary || "").replace(/"/g, '""')}"`);
          sections.push(`悪いフック,"${(loseOrganic.badHook || "").replace(/"/g, '""')}"`);
          sections.push(`コンテンツの弱点,"${(loseOrganic.contentWeakness || "").replace(/"/g, '""')}"`);
          sections.push(`フォーマット問題,"${(loseOrganic.formatProblems || "").replace(/"/g, '""')}"`);
          sections.push(`ハッシュタグの誤り,"${(loseOrganic.hashtagMistakes || "").replace(/"/g, '""')}"`);
          sections.push(`回避ヒント,"${(loseOrganic.avoidTips || "").replace(/"/g, '""')}"`);
          sections.push("");
        }

        const loseAd = tripleSearch?.losePatternAnalysisAd as any;
        if (loseAd) {
          sections.push("=== 負けパターン（Ad） ===");
          sections.push(`サマリー,"${(loseAd.summary || "").replace(/"/g, '""')}"`);
          sections.push(`悪いフック,"${(loseAd.badHook || "").replace(/"/g, '""')}"`);
          sections.push(`コンテンツの弱点,"${(loseAd.contentWeakness || "").replace(/"/g, '""')}"`);
          sections.push(`フォーマット問題,"${(loseAd.formatProblems || "").replace(/"/g, '""')}"`);
          sections.push(`ハッシュタグの誤り,"${(loseAd.hashtagMistakes || "").replace(/"/g, '""')}"`);
          sections.push(`回避ヒント,"${(loseAd.avoidTips || "").replace(/"/g, '""')}"`);
          sections.push("");
        }

        // セクション7: ハッシュタグ戦略
        const hashtagStrategy = report?.hashtagStrategy as any;
        if (hashtagStrategy?.topCombinations?.length) {
          sections.push("=== ハッシュタグ戦略 ===");
          sections.push("タグ組合せ,出現回数,平均ER(%)");
          for (const combo of hashtagStrategy.topCombinations.slice(0, 20)) {
            const tags = (combo.tags || []).join(" ");
            sections.push(`"${tags}",${combo.count ?? ""},${combo.avgER ?? ""}`);
          }
          sections.push("");
        }

        // セクション8: ファセット分析
        const facets = report?.facets as any[];
        if (facets?.length) {
          sections.push("=== ファセット分析 ===");
          sections.push("アスペクト,Positive(%),Negative(%)");
          for (const f of facets) {
            sections.push(`${f.aspect},${f.positive ?? ""},${f.negative ?? ""}`);
          }
          sections.push("");
        }

        // セクション9: AIインサイト
        if (report?.autoInsight) {
          sections.push("=== AIインサイト ===");
          sections.push(`"${(report.autoInsight as string).replace(/"/g, '""')}"`);
          sections.push("");
        }

        // セクション10: キーインサイト
        const keyInsights = report?.keyInsights as any[];
        if (keyInsights?.length) {
          sections.push("=== キーインサイト ===");
          sections.push("カテゴリ,タイトル,説明");
          for (const insight of keyInsights) {
            sections.push(`${insight.category},"${(insight.title || "").replace(/"/g, '""')}","${(insight.description || "").replace(/"/g, '""')}"`);
          }
        }

        return { csv: sections.join("\n"), filename: `report_${input.jobId}_${job.keyword || "manual"}.csv` };
      }),

    // 全データCSVエクスポート（動画一覧+アカウント集計+重複分析）
    exportCsvFull: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        const job = await db.getAnalysisJobById(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        if (job.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });

        const videos = await db.getVideosByJobId(input.jobId);
        const report = await db.getAnalysisReportByJobId(input.jobId);
        const tripleSearch = await db.getTripleSearchResultByJobId(input.jobId);

        const sections: string[] = [];

        // Part1: 動画一覧（既存exportCsvと同等+出現回数）
        sections.push("=== 動画一覧 ===");
        const rankInfo = (tripleSearch as any)?.rankInfo ?? {};
        sections.push("動画ID,アカウント,説明文,再生数,いいね,コメント,シェア,保存,ER%,センチメント,キーフック,ハッシュタグ,動画尺(秒),投稿日時,出現回数,支配度スコア,URL");
        for (const v of videos) {
          const views = Number(v.viewCount) || 0;
          const eng = (Number(v.likeCount)||0) + (Number(v.commentCount)||0) + (Number(v.shareCount)||0) + (Number(v.saveCount)||0);
          const er = views > 0 ? ((eng / views) * 100).toFixed(2) : "0";
          const desc = (v.description || "").replace(/[\r\n,"]/g, " ").substring(0, 100);
          const hashtags = (v.hashtags as string[] || []).join(" ");
          const posted = v.postedAt ? new Date(v.postedAt).toLocaleString("ja-JP") : "";
          const ri = rankInfo[v.videoId];
          const appearances = ri?.appearanceCount ?? "";
          const dominance = ri?.dominanceScore?.toFixed(1) ?? "";
          sections.push(`${v.videoId},${v.accountName},"${desc}",${v.viewCount},${v.likeCount},${v.commentCount},${v.shareCount},${v.saveCount},${er},${v.sentiment || ""},${(v.keyHook || "").replace(/,/g, "；")},${hashtags},${v.duration || ""},${posted},${appearances},${dominance},${v.videoUrl}`);
        }
        sections.push("");

        // Part2: アカウント集計
        sections.push("=== アカウント集計 ===");
        sections.push("アカウント名,動画数,合計再生数,平均再生数,合計いいね,平均ER%,フォロワー数");
        const accountMap = new Map<string, typeof videos>();
        for (const v of videos) {
          const name = v.accountName || "不明";
          if (!accountMap.has(name)) accountMap.set(name, []);
          accountMap.get(name)!.push(v);
        }
        for (const [name, acctVideos] of accountMap) {
          const totalViews = acctVideos.reduce((s, v) => s + (Number(v.viewCount) || 0), 0);
          const avgViews = Math.round(totalViews / acctVideos.length);
          const totalLikes = acctVideos.reduce((s, v) => s + (Number(v.likeCount) || 0), 0);
          const totalEng = acctVideos.reduce((s, v) => s + (Number(v.likeCount)||0) + (Number(v.commentCount)||0) + (Number(v.shareCount)||0) + (Number(v.saveCount)||0), 0);
          const avgER = totalViews > 0 ? ((totalEng / totalViews) * 100).toFixed(2) : "0";
          const follower = acctVideos[0]?.followerCount ?? "";
          sections.push(`${name},${acctVideos.length},${totalViews},${avgViews},${totalLikes},${avgER},${follower}`);
        }
        sections.push("");

        // Part3: 重複分析サマリ
        if (tripleSearch) {
          sections.push("=== 重複分析サマリ ===");
          const all3 = (tripleSearch.appearedInAll3Ids as string[] || []).length;
          const in2 = (tripleSearch.appearedIn2Ids as string[] || []).length;
          const in1 = (tripleSearch.appearedIn1OnlyIds as string[] || []).length;
          sections.push(`全セッション出現,${all3}`);
          sections.push(`2セッション出現,${in2}`);
          sections.push(`1セッションのみ,${in1}`);
          sections.push(`重複率(%),${((tripleSearch.overlapRate ?? 0) / 10).toFixed(1)}`);
          sections.push("");
        }

        // Part4: センチメント分布
        if (report) {
          sections.push("=== センチメント分布 ===");
          sections.push("分類,件数,割合(%)");
          sections.push(`Positive,${report.positiveCount ?? ""},${report.positivePercentage ?? ""}`);
          sections.push(`Neutral,${report.neutralCount ?? ""},${report.neutralPercentage ?? ""}`);
          sections.push(`Negative,${report.negativeCount ?? ""},${report.negativePercentage ?? ""}`);
        }

        return { csv: sections.join("\n"), filename: `full_${input.jobId}_${job.keyword || "manual"}.csv` };
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
});

export type AppRouter = typeof appRouter;
