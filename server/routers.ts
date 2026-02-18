import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { TRPCError } from "@trpc/server";
import { analyzeVideoFromTikTok, analyzeVideoFromUrl, analyzeDuplicates, generateAnalysisReport } from "./videoAnalysis";
import { searchTikTokVideos, type TikTokVideo } from "./tiktokScraper";

// 進捗状態を保持するインメモリストア
const progressStore = new Map<number, { message: string; percent: number }>();

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
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
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "分析ジョブが見つかりません",
          });
        }
        if (job.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "このジョブにアクセスする権限がありません",
          });
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

        return {
          job,
          videos: videosWithDetails,
          report,
        };
      }),

    // 分析を実行（バックグラウンド処理）
    execute: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const job = await db.getAnalysisJobById(input.jobId);
        if (!job) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "分析ジョブが見つかりません",
          });
        }
        if (job.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "このジョブにアクセスする権限がありません",
          });
        }

        // ステータスを処理中に更新
        await db.updateAnalysisJobStatus(input.jobId, "processing");
        progressStore.set(input.jobId, { message: "分析を開始しています...", percent: 0 });

        // 非同期で分析を実行
        setImmediate(async () => {
          try {
            if (job.keyword) {
              // === TikTokスクレイピングで実データ取得 ===
              console.log(`[Analysis] Starting TikTok scraping for keyword: ${job.keyword}`);
              progressStore.set(input.jobId, { message: "TikTokから動画データを収集中...", percent: 5 });

              // TikTok検索で動画を取得（最大45件 = 3アカウント×15本を目標）
              const searchResult = await searchTikTokVideos(
                job.keyword,
                60, // 多めに取得してアカウント別に分類
                (fetched, total) => {
                  const percent = Math.min(30, Math.floor((fetched / total) * 30));
                  progressStore.set(input.jobId, {
                    message: `TikTok動画データ収集中... (${fetched}件取得)`,
                    percent: 5 + percent,
                  });
                }
              );

              console.log(`[Analysis] Fetched ${searchResult.videos.length} videos from TikTok`);
              progressStore.set(input.jobId, { message: "アカウント別に分類中...", percent: 35 });

              // アカウント別にグループ化して上位3アカウント×15本を選択
              const accountMap = new Map<string, TikTokVideo[]>();
              for (const video of searchResult.videos) {
                const key = video.author.uniqueId;
                if (!accountMap.has(key)) {
                  accountMap.set(key, []);
                }
                accountMap.get(key)!.push(video);
              }

              // 総再生数が多い順にアカウントをソート
              const sortedAccounts = Array.from(accountMap.entries())
                .map(([uniqueId, vids]) => ({
                  uniqueId,
                  videos: vids.sort((a, b) => b.stats.playCount - a.stats.playCount),
                  totalViews: vids.reduce((s, v) => s + v.stats.playCount, 0),
                }))
                .sort((a, b) => b.totalViews - a.totalViews)
                .slice(0, 3); // 上位3アカウント

              // 各アカウントから上位15本を選択
              const selectedVideos: TikTokVideo[] = [];
              for (const account of sortedAccounts) {
                const topVideos = account.videos.slice(0, 15);
                selectedVideos.push(...topVideos);
              }

              console.log(`[Analysis] Selected ${selectedVideos.length} videos from ${sortedAccounts.length} accounts`);
              progressStore.set(input.jobId, {
                message: `${selectedVideos.length}件の動画を分析中...`,
                percent: 40,
              });

              // 各動画を分析
              for (let i = 0; i < selectedVideos.length; i++) {
                const tiktokVideo = selectedVideos[i];
                const percent = 40 + Math.floor(((i + 1) / selectedVideos.length) * 45);
                progressStore.set(input.jobId, {
                  message: `動画分析中... (${i + 1}/${selectedVideos.length}) - @${tiktokVideo.author.uniqueId}`,
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

            // 重複度分析
            progressStore.set(input.jobId, { message: "重複度分析中...", percent: 88 });
            await analyzeDuplicates(input.jobId);

            // レポート生成
            progressStore.set(input.jobId, { message: "分析レポート生成中...", percent: 92 });
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

        return { success: true, message: "分析を開始しました。TikTokから動画データを収集します。" };
      }),

    // 分析の進捗状況を取得
    getProgress: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        const job = await db.getAnalysisJobById(input.jobId);
        if (!job) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "分析ジョブが見つかりません",
          });
        }
        if (job.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "このジョブにアクセスする権限がありません",
          });
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
  }),
});

export type AppRouter = typeof appRouter;
