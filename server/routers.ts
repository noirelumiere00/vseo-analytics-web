import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { TRPCError } from "@trpc/server";
import { generateAnalysisReportDocx } from "./pdfGenerator";
import { generateExportToken } from "./_core/exportToken";
import * as fs from "fs";
import * as path from "path";
import { logBuffer } from "./logBuffer";
import { generateCampaignReport, generateCampaignCsv } from "./campaignReport";
import { checkQuota, PLAN_LIMITS } from "./_core/quota";
import { createCheckoutSession, createPortalSession } from "./_core/stripe";
import { ENV } from "./_core/env";

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


export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => {
      if (!opts.ctx.user) return null;
      const { passwordHash, openId, googleId, ...safeUser } = opts.ctx.user;
      return safeUser;
    }),
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
        await checkQuota(ctx.user.id);

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

    // 分析を実行（ワーカーキューに投入）
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

        // ステータスを queued に設定してワーカーに任せる
        await db.updateAnalysisJobStatus(input.jobId, "queued");
        await db.setCancelRequested(input.jobId, 0);
        await db.updateJobProgress("analysis", input.jobId, { message: "ワーカーの処理待ち中...", percent: 0 });

        // queuedAction を設定
        const dbInstance = await db.getDb();
        if (dbInstance) {
          const { analysisJobs } = await import("../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          await dbInstance.update(analysisJobs).set({ queuedAction: "execute" }).where(eq(analysisJobs.id, input.jobId));
        }

        return { success: true, message: "分析をキューに追加しました。ワーカーが処理を開始します。" };
      }),

    // LLM再分析（ワーカーキューに投入）
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

        // ステータスを queued に設定
        await db.updateAnalysisJobStatus(input.jobId, "queued");
        await db.updateJobProgress("analysis", input.jobId, { message: "ワーカーの処理待ち中...", percent: 0 });

        // queuedAction を reAnalyzeLLM に設定
        const dbInstance = await db.getDb();
        if (dbInstance) {
          const { analysisJobs } = await import("../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          await dbInstance.update(analysisJobs).set({ queuedAction: "reAnalyzeLLM" }).where(eq(analysisJobs.id, input.jobId));
        }

        return { success: true, message: "LLM再分析をキューに追加しました" };
      }),

    // 分析の進捗状況を取得（DBベース）
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

        // DB の progress カラムから進捗を取得
        const progressInfo = (job as any).progress as {
          message?: string;
          percent?: number;
          failedVideos?: Array<{ tiktokVideoId: string; error: string }>;
          totalTarget?: number;
          processedCount?: number;
        } | null;

        const videosData = await db.getVideosByJobId(input.jobId);
        const totalVideos = videosData.length;

        return {
          status: job.status,
          totalVideos,
          completedVideos: totalVideos,
          progress: progressInfo?.percent ?? 0,
          currentStep: progressInfo?.message ?? (
            job.status === "queued"
              ? "ワーカーの処理待ち中..."
              : job.status === "processing"
              ? "処理中..."
              : job.status === "completed"
              ? "分析完了"
              : job.status === "failed"
              ? "分析失敗: 分析に失敗しました。再実行してください。"
              : "待機中"
          ),
          failedVideos: progressInfo?.failedVideos ?? [],
          queue: { activeJobs: 0, pendingJobs: 0 },
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

    // ダッシュボード: 統合俯瞰データ (マーケター向け)
    dashboard: protectedProcedure
      .query(async ({ ctx }) => {
        const userId = ctx.user.id;

        const [allAnalysisJobs, trendJobs, campaignList, activeJobs] = await Promise.all([
          db.getAnalysisJobsByUserId(userId),
          db.getTrendDiscoveryJobsByUserId(userId),
          db.getCampaignsByUserId(userId),
          db.getActiveJobsByUserId(userId),
        ]);

        const completedAnalysis = allAnalysisJobs.filter(j => j.status === "completed");
        const completedTrends = trendJobs.filter(j => j.status === "completed");

        // 今週の増分 (7日以内)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const weeklyAnalyses = allAnalysisJobs.filter(j => j.status === "completed" && new Date(j.createdAt) >= sevenDaysAgo).length;
        const weeklyTrends = trendJobs.filter(j => j.status === "completed" && new Date(j.createdAt) >= sevenDaysAgo).length;

        // KPI (3枚)
        const kpi = {
          totalAnalyses: completedAnalysis.length + completedTrends.length,
          weeklyDelta: weeklyAnalyses + weeklyTrends,
          failedJobs: allAnalysisJobs.filter(j => j.status === "failed").length + trendJobs.filter(j => j.status === "failed").length,
        };

        // 統合タイムライン (最新5件)
        type ActivityItem =
          | { type: "seo"; jobId: number; keyword: string; date: Date; totalVideos: number | null; totalViews: number; positivePercentage: number | null; negativePercentage: number | null }
          | { type: "trend"; jobId: number; persona: string; date: Date; keywordCount: number; hashtagCount: number; topTags: string[] };

        const recentActivity: ActivityItem[] = [];

        for (const job of completedAnalysis.slice(0, 5)) {
          const report = await db.getAnalysisReportByJobId(job.id);
          if (report) {
            recentActivity.push({
              type: "seo",
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

        for (const job of completedTrends.slice(0, 5)) {
          const ca = job.crossAnalysis as any;
          const topTags = (ca?.trendingHashtags || []).slice(0, 3).map((t: any) => t.tag);
          recentActivity.push({
            type: "trend",
            jobId: job.id,
            persona: job.persona,
            date: job.createdAt,
            keywordCount: (job.expandedKeywords as string[] | null)?.length ?? 0,
            hashtagCount: (job.expandedHashtags as string[] | null)?.length ?? 0,
            topTags,
          });
        }

        recentActivity.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const trimmedActivity = recentActivity.slice(0, 5);

        return {
          kpi,
          activeJobs,
          recentActivity: trimmedActivity,
        };
      }),

    // ユーザー別インサイト
    platformInsights: protectedProcedure
      .query(async ({ ctx }) => {
        return db.getPlatformInsights(ctx.user.id);
      }),

    // 統合アクティビティ (SEO + トレンド全件)
    allActivity: protectedProcedure
      .query(async ({ ctx }) => {
        const userId = ctx.user.id;
        const [analysisJobs, trendJobs] = await Promise.all([
          db.getAnalysisJobsByUserId(userId),
          db.getTrendDiscoveryJobsByUserId(userId),
        ]);

        type ActivityItem =
          | { type: "seo"; id: number; label: string; status: string; date: Date; completedAt: Date | null; totalVideos?: number | null; totalViews?: number; positivePercentage?: number | null; negativePercentage?: number | null; manualUrls?: string[] | null }
          | { type: "trend"; id: number; label: string; status: string; date: Date; completedAt: Date | null; keywordCount: number; hashtagCount: number; topTags: string[] };

        const items: ActivityItem[] = [];

        // SEO items
        for (const job of analysisJobs) {
          const item: ActivityItem = {
            type: "seo",
            id: job.id,
            label: job.keyword || "手動URL",
            status: job.status,
            date: job.createdAt,
            completedAt: job.completedAt ?? null,
            manualUrls: job.manualUrls as string[] | null,
          };
          if (job.status === "completed") {
            const report = await db.getAnalysisReportByJobId(job.id);
            if (report) {
              (item as any).totalVideos = report.totalVideos;
              (item as any).totalViews = Number(report.totalViews);
              (item as any).positivePercentage = report.positivePercentage;
              (item as any).negativePercentage = report.negativePercentage;
            }
          }
          items.push(item);
        }

        // Trend items
        for (const job of trendJobs) {
          const ca = job.crossAnalysis as any;
          const topTags = (ca?.trendingHashtags || []).slice(0, 3).map((t: any) => t.tag);
          items.push({
            type: "trend",
            id: job.id,
            label: job.persona,
            status: job.status,
            date: job.createdAt,
            completedAt: job.completedAt ?? null,
            keywordCount: (job.expandedKeywords as string[] | null)?.length ?? 0,
            hashtagCount: (job.expandedHashtags as string[] | null)?.length ?? 0,
            topTags,
          });
        }

        items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return items;
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
        if (job.status === "processing" || job.status === "queued") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "処理中またはキュー中のジョブは削除できません" });
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
          if (job.status === "processing" || job.status === "queued") {
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

    // 分析をキャンセル（DB経由でワーカーに通知）
    cancel: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const job = await db.getAnalysisJobById(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "分析ジョブが見つかりません" });
        if (job.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "このジョブにアクセスする権限がありません" });

        if (job.status !== "processing" && job.status !== "queued") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "実行中またはキュー中のジョブのみキャンセルできます" });
        }

        await db.setCancelRequested(input.jobId, 1);
        await db.updateJobProgress("analysis", input.jobId, { message: "キャンセル中...（次のチェックポイントで停止します）", percent: -1 });
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
        await checkQuota(ctx.user.id);
        await db.updateAnalysisJobStatus(input.jobId, "pending");
        return { success: true, jobId: input.jobId };
      }),
  }),

  trendDiscovery: router({
    create: protectedProcedure
      .input(z.object({ persona: z.string().min(1).max(200) }))
      .mutation(async ({ ctx, input }) => {
        await checkQuota(ctx.user.id);

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
        if (job.status === "processing" || job.status === "queued") return { success: true, message: "既に実行中です" };
        if (job.status === "completed") return { success: true, message: "既に完了しています" };

        // failed ジョブのリトライ時はデータをリセット
        if (job.status === "failed") {
          await db.updateTrendDiscoveryJob(input.jobId, {
            scrapedVideos: null as any,
            crossAnalysis: null as any,
          });
        }

        // ステータスを queued に設定してワーカーに任せる
        await db.updateTrendDiscoveryJobStatus(input.jobId, "queued");
        await db.updateJobProgress("trend", input.jobId, { message: "ワーカーの処理待ち中...", percent: 0 });

        // queuedAction を設定
        const dbInstance = await db.getDb();
        if (dbInstance) {
          const { trendDiscoveryJobs } = await import("../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          await dbInstance.update(trendDiscoveryJobs).set({ queuedAction: "execute" }).where(eq(trendDiscoveryJobs.id, input.jobId));
        }

        return { success: true, message: "実行をキューに追加しました" };
      }),

    recomputeStatistics: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const job = await db.getTrendDiscoveryJobById(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        if (job.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        if (!job.scrapedVideos || job.scrapedVideos.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "スクレイピングデータがありません" });
        }

        // ステータスを queued に設定してワーカーに任せる
        await db.updateTrendDiscoveryJobStatus(input.jobId, "queued");
        await db.updateJobProgress("trend", input.jobId, { message: "ワーカーの処理待ち中...", percent: 0 });

        // queuedAction を recompute に設定
        const dbInstance = await db.getDb();
        if (dbInstance) {
          const { trendDiscoveryJobs } = await import("../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          await dbInstance.update(trendDiscoveryJobs).set({ queuedAction: "recompute" }).where(eq(trendDiscoveryJobs.id, input.jobId));
        }

        return { success: true, message: "統計再計算をキューに追加しました" };
      }),

    getProgress: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        const job = await db.getTrendDiscoveryJobById(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        if (job.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });

        // DB の progress カラムから進捗を取得
        const progressInfo = (job as any).progress as { message?: string; percent?: number } | null;
        return {
          status: job.status,
          progress: progressInfo?.percent ?? 0,
          currentStep: progressInfo?.message ?? (
            job.status === "queued" ? "ワーカーの処理待ち中..."
            : job.status === "completed" ? "完了"
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
        if (job.status === "processing" || job.status === "queued") throw new TRPCError({ code: "BAD_REQUEST", message: "処理中またはキュー中のジョブは削除できません" });
        await db.deleteTrendDiscoveryJob(input.jobId);
        return { success: true };
      }),

    cancel: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const job = await db.getTrendDiscoveryJobById(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        if (job.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
        if (job.status !== "processing" && job.status !== "queued") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "キャンセルできるのは実行中またはキュー中のジョブのみです" });
        }
        await db.updateTrendDiscoveryJobStatus(input.jobId, "failed", new Date());
        await db.updateJobProgress("trend", input.jobId, { message: "ユーザーによりキャンセルされました", percent: 0 });
        return { success: true };
      }),
  }),

  subscription: router({
    // プラン + 利用状況
    status: protectedProcedure.query(async ({ ctx }) => {
      const sub = await db.getSubscriptionByUserId(ctx.user.id);
      const plan = sub?.plan ?? "free";
      const limit = PLAN_LIMITS[plan] ?? 3;
      const now = new Date();
      const since = new Date(now.getFullYear(), now.getMonth(), 1);
      const used = await db.countMonthlyJobs(ctx.user.id, since);
      return { plan, used, limit, isExceeded: used >= limit, sub: sub ?? null };
    }),

    // Stripe Checkout Session作成
    createCheckout: protectedProcedure
      .input(z.object({ plan: z.enum(["pro", "business"]) }))
      .mutation(async ({ ctx, input }) => {
        const successUrl = `${ENV.appUrl}/pricing?success=true`;
        const cancelUrl = `${ENV.appUrl}/pricing?canceled=true`;
        const session = await createCheckoutSession(ctx.user.id, input.plan, successUrl, cancelUrl);
        return { url: session.url };
      }),

    // Stripe Customer Portal Session作成
    createPortal: protectedProcedure.mutation(async ({ ctx }) => {
      const sub = await db.getSubscriptionByUserId(ctx.user.id);
      if (!sub?.stripeCustomerId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "サブスクリプションが見つかりません" });
      }
      const returnUrl = `${ENV.appUrl}/pricing`;
      const session = await createPortalSession(sub.stripeCustomerId, returnUrl);
      return { url: session.url };
    }),
  }),

  admin: router({
    // ユーザー一覧（サブスクリプション情報付き）
    listUsers: adminProcedure.query(async () => {
      const users = await db.getAllUsersWithSubscriptions();
      // センシティブ情報をAPIレスポンスから除外
      return users.map(({ role, passwordHash, openId, googleId, ...rest }: any) => rest);
    }),

    // デバッグ用: サーバーログを取得
    getLogs: adminProcedure
      .input(z.object({
        lines: z.number().min(1).max(5000).default(500),
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

    // スナップショット取得実行（ワーカーキューに投入）
    captureSnapshot: protectedProcedure
      .input(z.object({
        campaignId: z.number(),
        type: z.enum(["baseline", "measurement"]),
      }))
      .mutation(async ({ ctx, input }) => {
        await checkQuota(ctx.user.id);

        const campaign = await db.getCampaignById(input.campaignId);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "キャンペーンが見つかりません" });
        }

        // スナップショットレコードを queued で作成
        const snapshotId = await db.createCampaignSnapshot({
          campaignId: input.campaignId,
          snapshotType: input.type,
          status: "queued",
        });

        await db.updateJobProgress("campaign", snapshotId, { message: "ワーカーの処理待ち中...", percent: 0 });

        return { snapshotId };
      }),

    // スナップショット進捗取得（DBベース）
    getSnapshotProgress: protectedProcedure
      .input(z.object({ snapshotId: z.number() }))
      .query(async ({ ctx, input }) => {
        const snapshot = await db.getCampaignSnapshotById(input.snapshotId);
        if (!snapshot) throw new TRPCError({ code: "NOT_FOUND", message: "スナップショットが見つかりません" });
        const campaign = await db.getCampaignById(snapshot.campaignId);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "アクセス権限がありません" });
        }
        const progressInfo = (snapshot as any)?.progress as { message?: string; percent?: number; phase?: string } | null;
        return {
          status: snapshot?.status || "pending",
          progress: progressInfo || null,
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
