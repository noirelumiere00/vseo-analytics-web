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
import { fallbackTikTokViaApify, fallbackYouTubeViaApify } from "./apifyFallback";
import { sql } from "drizzle-orm";

/**
 * キャンペーンの全施策動画の最新メトリクスを取得してDB保存
 */
export async function captureDailyMetrics(campaign: Campaign, targetUrls?: string[]): Promise<{ captured: number }> {
  const urls = targetUrls || (campaign.ownVideoUrls || []) as string[];
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
    shareCount: number | null; saveCount: number | null;
  }> = [];

  // TikTok
  if (tiktokUrls.length > 0) {
    try {
      const scraped = await scrapeTikTokVideosByUrls(tiktokUrls);

      // Apify フォールバック: プライマリで取得できなかったURLのみ
      const missingTikTok = tiktokUrls.filter((u) => !scraped.has(u));
      if (missingTikTok.length > 0) {
        console.log(`[DailyMetrics] TikTok: ${missingTikTok.length}/${tiktokUrls.length} missing, trying Apify fallback...`);
        try {
          const recovered = await fallbackTikTokViaApify(missingTikTok);
          for (const [url, v] of recovered) {
            scraped.set(url, v);
          }
        } catch (fbErr) {
          console.error("[DailyMetrics] TikTok Apify fallback failed:", fbErr);
        }
      }

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

      // Apify フォールバック: プライマリで取得できなかったIDのみ
      const fetchedIds = new Set(videos.map((v) => v.videoId));
      const missingYouTube = youtubeIds.filter((id) => !fetchedIds.has(id));
      if (missingYouTube.length > 0) {
        console.log(`[DailyMetrics] YouTube: ${missingYouTube.length}/${youtubeIds.length} missing, trying Apify fallback...`);
        try {
          const recovered = await fallbackYouTubeViaApify(missingYouTube, youtubeUrlMap);
          videos.push(...recovered);
        } catch (fbErr) {
          console.error("[DailyMetrics] YouTube Apify fallback failed:", fbErr);
        }
      }

      for (const v of videos) {
        const originalUrl = youtubeUrlMap.get(v.videoId) || v.videoUrl;
        rows.push({
          campaignId: campaign.id, videoUrl: originalUrl, platform: "youtube", dateKey,
          viewCount: v.viewCount, likeCount: v.likeCount,
          commentCount: v.commentCount, shareCount: null, saveCount: null,
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
          commentCount: p.commentCount, shareCount: null, saveCount: null,
        });
      }
    } catch (e) {
      console.error("[DailyMetrics] Instagram fetch failed:", e);
    }
  }

  // キャプチャサマリー — 期待値と実績を比較してログ出力
  const ttCaptured = rows.filter(r => r.platform === "tiktok").length;
  const ytCaptured = rows.filter(r => r.platform === "youtube").length;
  const igCaptured = rows.filter(r => r.platform === "instagram").length;

  const summary = [
    tiktokUrls.length > 0 ? `TT:${ttCaptured}/${tiktokUrls.length}` : null,
    youtubeIds.length > 0 ? `YT:${ytCaptured}/${youtubeIds.length}` : null,
    instagramUrls.length > 0 ? `IG:${igCaptured}/${instagramUrls.length}` : null,
  ].filter(Boolean).join(" ");

  const totalExpected = tiktokUrls.length + youtubeIds.length + instagramUrls.length;
  if (rows.length < totalExpected) {
    console.warn(`[DailyMetrics] Campaign ${campaign.id} INCOMPLETE: ${rows.length}/${totalExpected} (${summary})`);
  } else {
    console.log(`[DailyMetrics] Campaign ${campaign.id} OK: ${rows.length}/${totalExpected} (${summary})`);
  }

  // Upsert all rows
  const db = await getDb();
  if (!db) return { captured: 0 };

  for (const row of rows) {
    // GREATEST を使い、スクレイパー失敗で0が返った場合に既存の正しい値を保護
    // shareCount/saveCount は IG/YT で null（非対応）なので COALESCE で既存値を保持
    await db.insert(campaignDailyMetrics).values(row)
      .onDuplicateKeyUpdate({
        set: {
          viewCount: sql`GREATEST(viewCount, VALUES(viewCount))`,
          likeCount: sql`GREATEST(likeCount, VALUES(likeCount))`,
          commentCount: sql`GREATEST(commentCount, VALUES(commentCount))`,
          shareCount: sql`CASE WHEN VALUES(shareCount) IS NULL THEN shareCount ELSE GREATEST(COALESCE(shareCount, 0), VALUES(shareCount)) END`,
          saveCount: sql`CASE WHEN VALUES(saveCount) IS NULL THEN saveCount ELSE GREATEST(COALESCE(saveCount, 0), VALUES(saveCount)) END`,
        },
      });
  }

  return { captured: rows.length };
}
