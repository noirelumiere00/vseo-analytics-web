/**
 * YouTube Data API v3 スクレイパー
 * 動画IDからメタデータ＋統計情報を取得
 */

import { ENV } from "./_core/env";

export interface YouTubeVideoData {
  videoId: string;
  videoUrl: string;
  title: string;
  description: string;
  coverUrl: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  duration: number; // seconds
  publishedAt: string;
  channelTitle: string;
}

/**
 * ISO 8601 duration (PT1H2M3S) → seconds
 */
function parseDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] || "0") * 3600) +
         (parseInt(match[2] || "0") * 60) +
         (parseInt(match[3] || "0"));
}

/**
 * YouTube Data API v3 で動画情報を一括取得（50件ずつバッチ）
 */
export async function fetchYouTubeVideos(videoIds: string[]): Promise<YouTubeVideoData[]> {
  const apiKey = ENV.youtubeApiKey;
  if (!apiKey) {
    console.warn("[YouTube] YOUTUBE_API_KEY not set, skipping");
    return [];
  }
  if (videoIds.length === 0) return [];

  const results: YouTubeVideoData[] = [];
  const BATCH_SIZE = 50;

  for (let i = 0; i < videoIds.length; i += BATCH_SIZE) {
    const batch = videoIds.slice(i, i + BATCH_SIZE);
    const ids = batch.join(",");
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${ids}&key=${apiKey}`;

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) {
          const body = await res.text();
          console.error(`[YouTube] API error ${res.status} (attempt ${attempt + 1}): ${body}`);
          // 429 or 5xx: retry after delay
          if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
            continue;
          }
          break; // 4xx (non-429): don't retry
        }
        const data = await res.json();

        for (const item of data.items || []) {
          const snippet = item.snippet || {};
          const stats = item.statistics || {};
          const content = item.contentDetails || {};

          results.push({
            videoId: item.id,
            videoUrl: `https://www.youtube.com/watch?v=${item.id}`,
            title: snippet.title || "",
            description: snippet.description || "",
            coverUrl: snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || "",
            viewCount: parseInt(stats.viewCount || "0", 10),
            likeCount: parseInt(stats.likeCount || "0", 10),
            commentCount: parseInt(stats.commentCount || "0", 10),
            duration: parseDuration(content.duration || ""),
            publishedAt: snippet.publishedAt || "",
            channelTitle: snippet.channelTitle || "",
          });
        }
        break; // success — exit retry loop
      } catch (err) {
        console.error(`[YouTube] Fetch error for batch starting at ${i} (attempt ${attempt + 1}):`, err);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
    }
  }

  return results;
}
