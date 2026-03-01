import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { TRPCError } from "@trpc/server";
import { analyzeVideoFromTikTok, analyzeVideoFromUrl, generateAnalysisReport, analyzeWinPatternCommonality, analyzeSentimentAndKeywordsBatch, type SentimentInput } from "./videoAnalysis";
import { LLMQuotaExhaustedError } from "./_core/llm";
import { searchTikTokTriple, type TikTokVideo, type TikTokTripleSearchResult } from "./tiktokScraper";
import { generateAnalysisReportDocx } from "./pdfGenerator";
import { generatePdfFromUrl, generatePdfFromSnapshot } from "./pdfExporter";
import { generateExportToken } from "./_core/exportToken";
import * as fs from "fs";
import * as path from "path";
import { logBuffer } from "./logBuffer";

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

        const videosData = await db.getVideosByJobId(input.jobId);
        
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

        // 3シークレットブラウザ検索結果をDBから取得
        const tripleSearchData = await db.getTripleSearchResultByJobId(input.jobId);

        // 各動画の順位情報を searchData から計算（重複率分析の高度化）
        // dominanceScore: 各セッションでの順位の逆数の平均 × 100（高いほど上位に安定して表示される）
        const rankInfo: Record<string, {
          ranks: (number | null)[];   // [セッション0での順位, 1での順位, 2での順位] (null=未出現)
          avgRank: number;            // 出現セッションでの平均順位
          dominanceScore: number;     // 0-100、高いほど安定して上位に表示
        }> = {};
        if (tripleSearchData?.searchData) {
          const allVideoIds = [
            ...(tripleSearchData.appearedInAll3Ids ?? []),
            ...(tripleSearchData.appearedIn2Ids ?? []),
            ...(tripleSearchData.appearedIn1OnlyIds ?? []),
          ];
          for (const videoId of allVideoIds) {
            const ranks: (number | null)[] = [null, null, null];
            for (const session of tripleSearchData.searchData) {
              const idx = session.videoIds.indexOf(videoId);
              if (idx !== -1) ranks[session.sessionIndex] = idx + 1; // 1-indexed
            }
            const presentRanks = ranks.filter((r): r is number => r !== null);
            const avgRank = presentRanks.length > 0
              ? presentRanks.reduce((a, b) => a + b, 0) / presentRanks.length
              : 999;
            // (1/r1 + 1/r2 + 1/r3) / 3 * 100: rank#1 in all 3 = 100, rank#10 in 1 only = ~3.3
            const dominanceScore = presentRanks.reduce((sum, r) => sum + (1 / r), 0) / 3 * 100;
            rankInfo[videoId] = { ranks, avgRank, dominanceScore };
          }
        }

        return {
          job,
          videos: videosWithDetails,
          report,
          tripleSearch: tripleSearchData ? {
            searches: tripleSearchData.searchData ?? [],
            duplicateAnalysis: {
              appearedInAll3Count: tripleSearchData.appearedInAll3Ids?.length ?? 0,
              appearedIn2Count: tripleSearchData.appearedIn2Ids?.length ?? 0,
              appearedIn1OnlyCount: tripleSearchData.appearedIn1OnlyIds?.length ?? 0,
              overlapRate: (tripleSearchData.overlapRate ?? 0) / 10, // DB stores as percentage * 10
              appearedInAll3Ids: tripleSearchData.appearedInAll3Ids ?? [],
              appearedIn2Ids: tripleSearchData.appearedIn2Ids ?? [],
              appearedIn1OnlyIds: tripleSearchData.appearedIn1OnlyIds ?? [],
            },
            commonalityAnalysis: tripleSearchData.commonalityAnalysis ?? null,
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

    // 分析を実行（バックグラウンド処理）- 3シークレットブラウザ検索方式
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

        // 既に処理中の場合は重複実行を防止
        if (job.status === "processing") {
          return { success: true, message: "分析は既に実行中です。" };
        }

        // ステータスを処理中に更新
        await db.updateAnalysisJobStatus(input.jobId, "processing");
        setProgress(input.jobId, { message: "分析を開始しています...", percent: 0 });

        // 非同期で分析を実行
        setImmediate(async () => {
          try {
            // 既存の分析データをクリア（再実行時の重複防止）
            await db.clearAnalysisJobData(input.jobId);
            console.log(`[Analysis] Cleared existing data for job ${input.jobId}`);

            if (job.keyword) {
              // === 3シークレットブラウザでTikTok検索 ===
              console.log(`[Analysis] Starting triple TikTok search for keyword: ${job.keyword}`);
              setProgress(input.jobId, { message: "3つのシークレットブラウザでTikTok検索を開始...", percent: 5 });

              const tripleResult = await searchTikTokTriple(
                job.keyword,
                15, // 各セッション15件
                (msg: string) => {
                  setProgress(input.jobId, { message: msg, percent: 40 });
                }
              );

              // 3シークレットブラウザ検索結果をDBに永続化
              await db.saveTripleSearchResult({
                jobId: input.jobId,
                searchData: tripleResult.searches.map(s => ({
                  sessionIndex: s.sessionIndex,
                  totalFetched: s.totalFetched,
                  videoIds: s.videos.map(v => v.id),
                })),
                appearedInAll3Ids: tripleResult.duplicateAnalysis.appearedInAll3.map(v => v.id),
                appearedIn2Ids: tripleResult.duplicateAnalysis.appearedIn2.map(v => v.id),
                appearedIn1OnlyIds: tripleResult.duplicateAnalysis.appearedIn1Only.map(v => v.id),
                overlapRate: Math.round(tripleResult.duplicateAnalysis.overlapRate * 10), // Store as percentage * 10
              });

              console.log(`[Analysis] Triple search complete:`,
                `3回全出現=${tripleResult.duplicateAnalysis.appearedInAll3.length},`,
                `2回出現=${tripleResult.duplicateAnalysis.appearedIn2.length},`,
                `1回のみ=${tripleResult.duplicateAnalysis.appearedIn1Only.length},`,
                `重複率=${tripleResult.duplicateAnalysis.overlapRate.toFixed(1)}%`
              );

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
            setProgress(input.jobId, { message: "分析レポート生成中...", percent: 85 });
            await generateAnalysisReport(input.jobId);

            // 勝ちパターン動画の共通点をLLMで分析
            setProgress(input.jobId, { message: "勝ちパターン動画の共通点を分析中...", percent: 92 });
            if (job.keyword) {
              await analyzeWinPatternCommonality(input.jobId, job.keyword);
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
        });

        return { success: true, message: "3つのシークレットブラウザでTikTok検索を開始しました。" };
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
    // デバッグ用: サーバーログを取得
    getLogs: publicProcedure
      .input(z.object({
        lines: z.number().default(500),
      }))
      .query(async ({ input }) => {
        try {
          // まずインメモリバッファからログを取得（本番環境対応）
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
          
          // フォールバック: ファイルから読み取り（開発環境）
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
