/**
 * 日次メトリクス定期観測スケジューラ
 *
 * 各動画の投稿日(postedAt)を基準に取得頻度を決定:
 *   0〜30日:  毎日
 *  31〜60日:  3日に1回
 *  61〜90日:  週1回
 *  91〜150日: 月1回（30日に1回）
 *  150日超:   追跡終了
 */

import * as db from "./db";
import { captureDailyMetrics } from "./dailyMetrics";
import type { Campaign } from "../drizzle/schema";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1時間
const TRACKING_END_DAYS = 150;

type VideoPhase = "daily" | "every3days" | "weekly" | "monthly" | "ended";

export function getVideoPhase(elapsedDays: number): VideoPhase {
  if (elapsedDays <= 30) return "daily";
  if (elapsedDays <= 60) return "every3days";
  if (elapsedDays <= 90) return "weekly";
  if (elapsedDays <= TRACKING_END_DAYS) return "monthly";
  return "ended";
}

function shouldCapture(phase: VideoPhase, daysSinceLastCapture: number): boolean {
  switch (phase) {
    case "daily": return daysSinceLastCapture >= 1;
    case "every3days": return daysSinceLastCapture >= 3;
    case "weekly": return daysSinceLastCapture >= 7;
    case "monthly": return daysSinceLastCapture >= 30;
    case "ended": return false;
  }
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

async function checkAndCapture() {
  const campaigns = await db.getTrackingEnabledCampaigns();
  if (campaigns.length === 0) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  for (const campaign of campaigns) {
    try {
      await processCampaign(campaign, today, todayStr);
    } catch (e) {
      console.error(`[DailyScheduler] Campaign ${campaign.id} error:`, e);
    }
  }
}

async function processCampaign(campaign: Campaign, today: Date, todayStr: string) {
  const ownVideoData = (campaign.ownVideoData || []) as Array<{
    videoUrl: string; createTime: number; publishedAt?: string;
  }>;
  const ownVideoUrls = (campaign.ownVideoUrls || []) as string[];
  if (ownVideoUrls.length === 0) return;

  // videoUrlごとの最新取得日
  const lastCapturedMap = await db.getLastCapturedDateByVideo(campaign.id);

  // videoUrlごとのpostedAt(createTimeをDateに)
  const postedAtMap = new Map<string, Date>();
  for (const v of ownVideoData) {
    const postedAt = v.publishedAt
      ? new Date(v.publishedAt)
      : v.createTime
        ? new Date(v.createTime * 1000)
        : null;
    if (postedAt) {
      postedAtMap.set(v.videoUrl, postedAt);
    }
  }

  const targetUrls: string[] = [];
  let allEnded = true;

  for (const url of ownVideoUrls) {
    const postedAt = postedAtMap.get(url);
    if (!postedAt) {
      // postedAtが不明 → 安全のため毎日取得扱い
      allEnded = false;
      const lastDate = lastCapturedMap.get(url);
      if (!lastDate || lastDate < todayStr) {
        targetUrls.push(url);
      }
      continue;
    }

    const elapsed = daysBetween(postedAt, today);
    const phase = getVideoPhase(elapsed);

    if (phase === "ended") continue;
    allEnded = false;

    const lastDate = lastCapturedMap.get(url);
    const daysSinceLast = lastDate
      ? daysBetween(new Date(lastDate), today)
      : Infinity;

    if (shouldCapture(phase, daysSinceLast)) {
      targetUrls.push(url);
    }
  }

  // 全動画が追跡終了 → trackingEnabled=false
  if (allEnded) {
    console.log(`[DailyScheduler] Campaign ${campaign.id}: all videos past ${TRACKING_END_DAYS} days, disabling tracking`);
    await db.setTrackingEnabled(campaign.id, false);
    return;
  }

  if (targetUrls.length === 0) {
    return; // 今回取得不要
  }

  console.log(`[DailyScheduler] Campaign ${campaign.id}: capturing ${targetUrls.length}/${ownVideoUrls.length} videos`);
  const result = await captureDailyMetrics(campaign, targetUrls);
  console.log(`[DailyScheduler] Campaign ${campaign.id}: captured ${result.captured} metrics`);
}

export function startDailyMetricsScheduler() {
  console.log("[DailyScheduler] Starting daily metrics scheduler (check every 1h)");

  // 初回は10秒後に実行
  setTimeout(async () => {
    try {
      await checkAndCapture();
    } catch (e) {
      console.error("[DailyScheduler] Initial check error:", e);
    }
  }, 10_000);

  // 以降1時間ごと
  setInterval(async () => {
    try {
      await checkAndCapture();
    } catch (e) {
      console.error("[DailyScheduler] Periodic check error:", e);
    }
  }, CHECK_INTERVAL_MS);
}
