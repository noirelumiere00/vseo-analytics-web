import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { TRPCError } from "@trpc/server";
import { analyzeVideo, analyzeDuplicates } from "./videoAnalysis";

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

        const videos = await db.getVideosByJobId(input.jobId);
        
        // 各動画のOCR結果、音声文字起こし、スコアを取得
        const videosWithDetails = await Promise.all(
          videos.map(async (video) => {
            const ocrResults = await db.getOcrResultsByVideoId(video.id);
            const transcription = await db.getTranscriptionByVideoId(video.id);
            const score = await db.getAnalysisScoreByVideoId(video.id);
            
            return {
              ...video,
              ocrResults,
              transcription,
              score,
            };
          })
        );

        return {
          job,
          videos: videosWithDetails,
        };
      }),

    // 分析を実行（バックグラウンド処理をシミュレート）
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

        // 分析対象の動画URLを取得
        let videoUrls: string[] = [];
        
        if (job.manualUrls && job.manualUrls.length > 0) {
          // 手動URL指定の場合
          videoUrls = job.manualUrls;
        } else if (job.keyword) {
          // キーワード指定の場合：ダミーで3アカウント×3動画を生成
          // 実際の実装では、TikTok/YouTube APIを使用して上位20投稿を取得
          videoUrls = [
            `https://www.tiktok.com/@account1/video/${Date.now()}001`,
            `https://www.tiktok.com/@account1/video/${Date.now()}002`,
            `https://www.tiktok.com/@account1/video/${Date.now()}003`,
            `https://www.tiktok.com/@account2/video/${Date.now()}001`,
            `https://www.tiktok.com/@account2/video/${Date.now()}002`,
            `https://www.tiktok.com/@account2/video/${Date.now()}003`,
            `https://www.tiktok.com/@account3/video/${Date.now()}001`,
            `https://www.tiktok.com/@account3/video/${Date.now()}002`,
            `https://www.tiktok.com/@account3/video/${Date.now()}003`,
          ];
        }

        // ステータスを処理中に更新
        await db.updateAnalysisJobStatus(input.jobId, "processing");

        // 非同期で分析を実行（バックグラウンド処理）
        // 実際の本番環境ではジョブキューを使用することを推奨
        setImmediate(async () => {
          try {
            console.log(`[Analysis] Starting analysis for ${videoUrls.length} videos`);
            
            // 各動画を分析
            for (const videoUrl of videoUrls) {
              await analyzeVideo(input.jobId, videoUrl);
            }

            // 重複度分析
            await analyzeDuplicates(input.jobId);

            // ステータスを完了に更新
            await db.updateAnalysisJobStatus(input.jobId, "completed", new Date());
            console.log(`[Analysis] Completed analysis for job ${input.jobId}`);
          } catch (error) {
            console.error("[Analysis] Error:", error);
            await db.updateAnalysisJobStatus(input.jobId, "failed");
          }
        });

        return { success: true, message: `分析を開始しました。${videoUrls.length}件の動画を分析します。` };
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

        const videos = await db.getVideosByJobId(input.jobId);
        const totalVideos = videos.length;
        
        // 各動画の分析完了状況をチェック
        let completedVideos = 0;
        for (const video of videos) {
          const score = await db.getAnalysisScoreByVideoId(video.id);
          if (score) {
            completedVideos++;
          }
        }

        // 進捗率を計算
        const progress = totalVideos > 0 ? Math.round((completedVideos / totalVideos) * 100) : 0;

        return {
          status: job.status,
          totalVideos,
          completedVideos,
          progress,
          currentStep: job.status === "processing" 
            ? `動画分析中... (${completedVideos}/${totalVideos})`
            : job.status === "completed"
            ? "分析完了"
            : job.status === "failed"
            ? "分析失敗"
            : "待機中",
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
