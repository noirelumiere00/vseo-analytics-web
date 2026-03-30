/**
 * Instagram スクレイパー（Apify経由）
 * apify~instagram-scraper を使用して投稿データを取得
 */

import { ENV } from "./_core/env";

export interface InstagramPostData {
  videoId: string;
  videoUrl: string;
  coverUrl: string;
  caption: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  publishedAt: string;
  ownerUsername: string;
  musicInfo?: { title: string; artistName: string } | null;
}

/**
 * Apify Instagram Scraper で投稿データを一括取得
 */
export async function fetchInstagramPosts(urls: string[]): Promise<InstagramPostData[]> {
  const token = ENV.apifyApiToken;
  if (!token) {
    console.warn("[Instagram] APIFY_API_TOKEN not set, skipping");
    return [];
  }
  if (urls.length === 0) return [];

  const results: InstagramPostData[] = [];

  try {
    // apify~instagram-scraper (directUrls対応)
    const res = await fetch(
      `https://api.apify.com/v2/acts/apify~instagram-scraper/runs?token=${token}&waitForFinish=180`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directUrls: urls,
          resultsType: "posts",
          resultsLimit: urls.length,
        }),
        signal: AbortSignal.timeout(200_000),
      },
    );

    const runData = await res.json() as any;
    const datasetId = runData?.data?.defaultDatasetId;
    if (!datasetId) {
      console.error("[Instagram] Apify run failed:", runData?.data?.status, JSON.stringify(runData?.error || {}).slice(0, 200));
      return results;
    }

    // データセットから結果取得
    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&limit=200`,
    );
    const items = await itemsRes.json() as any[];

    for (const item of items) {
      const shortcode = item.shortCode || item.id || "";
      const postUrl = item.url || (shortcode ? `https://www.instagram.com/p/${shortcode}` : "");

      // 音源情報（Apifyレスポンスに含まれる場合がある）
      const rawMusic = item.musicInfo || item.music;
      const musicInfo = rawMusic
        ? { title: rawMusic.title || rawMusic.music_title || "", artistName: rawMusic.artistName || rawMusic.music_author || rawMusic.artist_name || "" }
        : null;

      results.push({
        videoId: shortcode,
        videoUrl: postUrl,
        coverUrl: item.displayUrl || item.thumbnailUrl || "",
        caption: item.caption || "",
        viewCount: item.videoViewCount || item.videoPlayCount || 0,
        likeCount: item.likesCount || 0,
        commentCount: item.commentsCount || 0,
        publishedAt: item.timestamp || "",
        ownerUsername: item.ownerUsername || "",
        musicInfo: musicInfo && (musicInfo.title || musicInfo.artistName) ? musicInfo : null,
      });
    }

    console.log(`[Instagram] Apify scraped ${results.length} posts`);
  } catch (e) {
    console.error("[Instagram] Apify scrape failed:", e);
  }

  return results;
}
