/**
 * 日次メトリクス取得モジュール
 * 全プラットフォームの施策動画メトリクスを取得してDBに保存
 */

import { getDb } from "./db";
import { campaignDailyMetrics } from "../drizzle/schema";
import type { Campaign } from "../drizzle/schema";
import { detectPlatform, extractVideoId } from "../shared/videoUrl";
import { scrapeTikTokVideosByUrls } from "./tiktokScraper";
import { fetchYouTubeVideos } from "./youtubeScraper";
import { fetchInstagramPosts } from "./instagramScraper";
import { sql } from "drizzle-orm";

/**
 * キャンペーンの全施策動画の最新メトリクスを取得してDB保存
 */
export async function captureDailyMetrics(campaign: Campaign): Promise<{ captured: number }> {
  const urls = (campaign.ownVideoUrls || []) as string[];
  if (urls.length === 0) return { captured: 0 };

  const dateKey = new Date().toISOString().slice(0, 10); // "2026-03-27"

  // URLをプラットフォーム別にグループ分け
  const tiktokUrls: string[] = [];
  const youtubeIds: string[] = [];
  const youtubeUrlMap = new Map<string, string>(); // videoId -> original url
  const instagramUrls: string[] = [];

  for (const url of urls) {
    const platform = detectPlatform(url);
    if (platform === "tiktok") {
      tiktokUrls.push(url);
    } else if (platform === "youtube") {
      const extracted = extractVideoId(url);
      if (extracted) {
        youtubeIds.push(extracted.id);
        youtubeUrlMap.set(extracted.id, url);
      }
    } else if (platform === "instagram") {
      instagramUrls.push(url);
    }
  }

  const rows: Array<{
    campaignId: number; videoUrl: string;
    platform: "tiktok" | "youtube" | "instagram";
    dateKey: string;
    viewCount: number; likeCount: number; commentCount: number;
    shareCount: number; saveCount: number;
  }> = [];

  // TikTok
  if (tiktokUrls.length > 0) {
    try {
      const scraped = await scrapeTikTokVideosByUrls(tiktokUrls);
      for (const [url, v] of scraped) {
        rows.push({
          campaignId: campaign.id, videoUrl: url, platform: "tiktok", dateKey,
          viewCount: v.viewCount, likeCount: v.likeCount,
          commentCount: v.commentCount, shareCount: v.shareCount,
          saveCount: v.saveCount,
        });
      }
    } catch (e) {
      console.error("[DailyMetrics] TikTok scrape failed:", e);
    }
  }

  // YouTube
  if (youtubeIds.length > 0) {
    try {
      const videos = await fetchYouTubeVideos(youtubeIds);
      for (const v of videos) {
        const originalUrl = youtubeUrlMap.get(v.videoId) || v.videoUrl;
        rows.push({
          campaignId: campaign.id, videoUrl: originalUrl, platform: "youtube", dateKey,
          viewCount: v.viewCount, likeCount: v.likeCount,
          commentCount: v.commentCount, shareCount: 0, saveCount: 0,
        });
      }
    } catch (e) {
      console.error("[DailyMetrics] YouTube fetch failed:", e);
    }
  }

  // Instagram
  if (instagramUrls.length > 0) {
    try {
      const posts = await fetchInstagramPosts(instagramUrls);
      for (const p of posts) {
        rows.push({
          campaignId: campaign.id, videoUrl: p.videoUrl, platform: "instagram", dateKey,
          viewCount: p.viewCount, likeCount: p.likeCount,
          commentCount: p.commentCount, shareCount: 0, saveCount: 0,
        });
      }
    } catch (e) {
      console.error("[DailyMetrics] Instagram fetch failed:", e);
    }
  }

  // Upsert all rows
  const db = await getDb();
  if (!db) return { captured: 0 };

  for (const row of rows) {
    await db.insert(campaignDailyMetrics).values(row)
      .onDuplicateKeyUpdate({
        set: {
          viewCount: sql`VALUES(viewCount)`,
          likeCount: sql`VALUES(likeCount)`,
          commentCount: sql`VALUES(commentCount)`,
          shareCount: sql`VALUES(shareCount)`,
          saveCount: sql`VALUES(saveCount)`,
        },
      });
  }

  return { captured: rows.length };
}
