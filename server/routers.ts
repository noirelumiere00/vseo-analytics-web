import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { TRPCError } from "@trpc/server";
import { analyzeVideoFromTikTok, analyzeVideoFromUrl, generateAnalysisReport } from "./videoAnalysis";
import { searchTikTokTriple, type TikTokVideo, type TikTokTripleSearchResult } from "./tiktokScraper";

// 進捗状態を保持するインメモリストア（進捗は一時的なものなのでインメモリでOK）
const progressStore = new Map<number, { message: string; percent: number }>();

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
          } : null,
        };
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

        // ステータスを処理中に更新
        await db.updateAnalysisJobStatus(input.jobId, "processing");
        progressStore.set(input.jobId, { message: "分析を開始しています...", percent: 0 });

        // 非同期で分析を実行
        setImmediate(async () => {
          try {
            if (job.keyword) {
              // === 3シークレットブラウザでTikTok検索 ===
              console.log(`[Analysis] Starting triple TikTok search for keyword: ${job.keyword}`);
              progressStore.set(input.jobId, { message: "3つのシークレットブラウザでTikTok検索を開始...", percent: 5 });

              const tripleResult = await searchTikTokTriple(
                job.keyword,
                15, // 各セッション15件
                (msg, percent) => {
                  progressStore.set(input.jobId, { message: msg, percent: Math.min(percent, 40) });
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
              
              progressStore.set(input.jobId, {
                message: `${allUniqueVideos.length}件のユニーク動画を分析中...`,
                percent: 42,
              });

              // 各動画を分析（重複度情報も含めてDB保存）
              for (let i = 0; i < allUniqueVideos.length; i++) {
                const tiktokVideo = allUniqueVideos[i];
                const percent = 42 + Math.floor(((i + 1) / allUniqueVideos.length) * 40);
                
                // この動画が何回出現したか
                const appearanceCount = tripleResult.searches.filter(
                  s => s.videos.some(v => v.id === tiktokVideo.id)
                ).length;
                
                progressStore.set(input.jobId, {
                  message: `動画分析中... (${i + 1}/${allUniqueVideos.length}) - @${tiktokVideo.author.uniqueId} [${appearanceCount}回出現]`,
                  percent,
                });

                await analyzeVideoFromTikTok(input.jobId, tiktokVideo);
              }

            } else if (job.manualUrls && job.manualUrls.length > 0) {
              // === 手動URL指定の場合 ===
              for (let i = 0; i < job.manualUrls.length; i++) {
                const url = job.manualUrls[i];
                const percent = Math.floor(((i + 1) / job.manualUrls.length) * 85);
                progressStore.set(input.jobId, {
                  message: `動画分析中... (${i + 1}/${job.manualUrls.length})`,
                  percent,
                });
                await analyzeVideoFromUrl(input.jobId, url);
              }
            }

            // レポート生成
            progressStore.set(input.jobId, { message: "分析レポート生成中...", percent: 88 });
            await generateAnalysisReport(input.jobId);

            // ステータスを完了に更新
            await db.updateAnalysisJobStatus(input.jobId, "completed", new Date());
            progressStore.set(input.jobId, { message: "分析完了", percent: 100 });
            console.log(`[Analysis] Completed analysis for job ${input.jobId}`);
          } catch (error) {
            console.error("[Analysis] Error:", error);
            await db.updateAnalysisJobStatus(input.jobId, "failed");
            progressStore.set(input.jobId, {
              message: `分析失敗: ${error instanceof Error ? error.message : "不明なエラー"}`,
              percent: -1,
            });
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
              ? "分析失敗"
              : "待機中"
          ),
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
});

export type AppRouter = typeof appRouter;
