/**
 * worker.ts — ジョブワーカープロセス
 *
 * DB ポーリングで status="queued" のジョブを取得し、pLimit(2) で実行する。
 * 進捗は DB の progress カラムに書き込む。
 */

import "dotenv/config";
import pLimit from "p-limit";
import * as db from "../db";
import {
  executeAnalysisJob,
  executeReAnalyzeLLM,
  executeTrendDiscoveryJob,
  executeTrendRecompute,
  executeCampaignSnapshot,
  JobCancelledError,
  type ProgressInfo,
} from "../jobExecutor";

const POLL_INTERVAL_MS = 3000;
const jobLimit = pLimit(2);

// 実行中のジョブ ID を追跡（graceful shutdown 用）
const runningJobs = new Set<string>();
let shuttingDown = false;

export async function startWorker() {
  console.log("[Worker] Starting job worker...");

  // サーバー再起動で中断された processing ジョブを queued に戻す
  try {
    const resetCount = await db.resetStuckProcessingJobs();
    if (resetCount > 0) {
      console.log(`[Worker] Reset ${resetCount} stuck processing jobs to queued`);
    }
  } catch (e) {
    console.warn("[Worker] Failed to reset stuck jobs:", e);
  }

  // ポーリングループ
  const poll = async () => {
    if (shuttingDown) return;

    try {
      // 全3テーブルから queued ジョブを取得
      const [analysisJobs, trendJobs, campaignSnapshots] = await Promise.all([
        db.getQueuedAnalysisJobs(),
        db.getQueuedTrendDiscoveryJobs(),
        db.getQueuedCampaignSnapshots(),
      ]);

      // Analysis jobs
      for (const job of analysisJobs) {
        if (shuttingDown) break;
        const jobKey = `analysis:${job.id}`;
        if (runningJobs.has(jobKey)) continue;

        runningJobs.add(jobKey);
        const queuedAction = (job as any).queuedAction || "execute";

        jobLimit(async () => {
          try {
            // status を processing に変更
            await db.updateAnalysisJobStatus(job.id, "processing");
            await db.updateJobProgress("analysis", job.id, { message: "処理を開始しています...", percent: 0 });

            const onProgress = async (progress: ProgressInfo) => {
              await db.updateJobProgress("analysis", job.id, progress);
            };

            if (queuedAction === "reAnalyzeLLM") {
              await executeReAnalyzeLLM(job.id, onProgress);
            } else {
              const checkCancelled = async () => {
                const cancelled = await db.getCancelRequested(job.id);
                if (cancelled) {
                  throw new JobCancelledError(job.id);
                }
              };
              await executeAnalysisJob(job.id, onProgress, checkCancelled);
            }
          } catch (error) {
            // エラーは jobExecutor 内で処理済み（status=failed 設定済み）
            if (!(error instanceof JobCancelledError)) {
              console.error(`[Worker] Analysis job ${job.id} error:`, error instanceof Error ? error.message : error);
            }
          } finally {
            runningJobs.delete(jobKey);
          }
        });
      }

      // Trend Discovery jobs
      for (const job of trendJobs) {
        if (shuttingDown) break;
        const jobKey = `trend:${job.id}`;
        if (runningJobs.has(jobKey)) continue;

        runningJobs.add(jobKey);
        const queuedAction = (job as any).queuedAction || "execute";

        jobLimit(async () => {
          try {
            await db.updateTrendDiscoveryJobStatus(job.id, "processing");
            await db.updateJobProgress("trend", job.id, { message: "処理を開始しています...", percent: 0 });

            const onProgress = async (progress: ProgressInfo) => {
              await db.updateJobProgress("trend", job.id, progress);
            };

            if (queuedAction === "recompute") {
              await executeTrendRecompute(job.id, onProgress);
              // recompute は status を変更しないので手動で completed に
              await db.updateTrendDiscoveryJobStatus(job.id, "completed", new Date());
            } else {
              await executeTrendDiscoveryJob(job.id, onProgress);
            }
          } catch (error) {
            console.error(`[Worker] Trend job ${job.id} error:`, error instanceof Error ? error.message : error);
          } finally {
            runningJobs.delete(jobKey);
          }
        });
      }

      // Campaign Snapshots
      for (const snapshot of campaignSnapshots) {
        if (shuttingDown) break;
        const jobKey = `campaign:${snapshot.id}`;
        if (runningJobs.has(jobKey)) continue;

        runningJobs.add(jobKey);

        jobLimit(async () => {
          try {
            await db.updateJobProgress("campaign", snapshot.id, { message: "処理を開始しています...", percent: 0 });

            const onProgress = async (progress: ProgressInfo) => {
              await db.updateJobProgress("campaign", snapshot.id, progress);
            };

            await executeCampaignSnapshot(snapshot.id, onProgress);
          } catch (error) {
            console.error(`[Worker] Campaign snapshot ${snapshot.id} error:`, error instanceof Error ? error.message : error);
          } finally {
            runningJobs.delete(jobKey);
          }
        });
      }
    } catch (error) {
      console.error("[Worker] Poll error:", error);
    }

    // 次のポーリングをスケジュール
    if (!shuttingDown) {
      setTimeout(poll, POLL_INTERVAL_MS);
    }
  };

  // 初回実行
  poll();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Worker] Received ${signal}, shutting down gracefully...`);

    // 実行中のジョブ完了を待つ（最大60秒）
    const deadline = Date.now() + 60_000;
    while (runningJobs.size > 0 && Date.now() < deadline) {
      console.log(`[Worker] Waiting for ${runningJobs.size} running job(s)...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (runningJobs.size > 0) {
      console.warn(`[Worker] Force shutdown with ${runningJobs.size} jobs still running`);
    }

    console.log("[Worker] Worker stopped");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  console.log("[Worker] Job worker started, polling every 3s");
}

// ワーカー単体起動用
if (process.env.SERVER_MODE === "worker") {
  startWorker().catch(err => {
    console.error("[Worker] Fatal error:", err);
    process.exit(1);
  });
}
