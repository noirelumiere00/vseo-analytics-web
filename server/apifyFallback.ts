/**
 * Apify フォールバックスクレイパー（TikTok / YouTube）
 * プライマリスクレイパーが取得できなかった動画のみ Apify で再取得する。
 * instagramScraper.ts の Apify パターンを踏襲。
 */

import { ENV } from "./_core/env";
import type { ScrapedVideoData } from "./tiktokScraper";
import type { YouTubeVideoData } from "./youtubeScraper";

/** Apify実行完了までポーリング */
async function waitForApifyRun(runId: string, token: string, maxWaitMs: number = 120_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
    const data = (await res.json()) as any;
    const status = data?.data?.status;
    if (status === "SUCCEEDED" || status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      return status;
    }
    await new Promise(r => setTimeout(r, 10_000));
  }
  return "POLL_TIMEOUT";
}

/** Apify Runレスポンスのステータスを検証し、RUNNINGなら完了待機 */
async function ensureApifyRunComplete(runData: any, token: string, label: string): Promise<boolean> {
  const runStatus = runData?.data?.status;
  const runId = runData?.data?.id;
  if (runStatus === "SUCCEEDED") return true;
  if (runStatus === "RUNNING" && runId) {
    console.log(`[${label}] Apify run still RUNNING, polling...`);
    const finalStatus = await waitForApifyRun(runId, token);
    if (finalStatus !== "SUCCEEDED") {
      console.warn(`[${label}] Apify run finished with status: ${finalStatus}`);
    }
    return finalStatus === "SUCCEEDED";
  }
  if (runStatus === "FAILED" || runStatus === "ABORTED" || runStatus === "TIMED-OUT") {
    console.warn(`[${label}] Apify run status: ${runStatus}`);
    return false; // データセットに部分結果がある可能性があるので続行可
  }
  return true;
}

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------

const TIKTOK_ACTOR = "clockworks~tiktok-scraper";

/**
 * TikTok 動画URLリストを Apify 経由で取得。
 * videoId（長い数字列）の substring マッチで入力URLと紐付ける。
 */
export async function fallbackTikTokViaApify(
  urls: string[],
): Promise<Map<string, ScrapedVideoData>> {
  const result = new Map<string, ScrapedVideoData>();
  const token = ENV.apifyApiToken;
  if (!token) {
    console.warn("[ApifyFallback/TikTok] APIFY_API_TOKEN not set, skipping");
    return result;
  }
  if (urls.length === 0) return result;

  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${TIKTOK_ACTOR}/runs?token=${token}&waitForFinish=180`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postURLs: urls,
          resultsPerPage: urls.length,
        }),
        signal: AbortSignal.timeout(200_000),
      },
    );

    const runData = (await res.json()) as any;
    const datasetId = runData?.data?.defaultDatasetId;
    if (!datasetId) {
      console.error(
        "[ApifyFallback/TikTok] Run failed:",
        runData?.data?.status,
        JSON.stringify(runData?.error || {}).slice(0, 200),
      );
      return result;
    }

    // 実行完了を確認（RUNNINGならポーリング待機）
    await ensureApifyRunComplete(runData, token, "ApifyFallback/TikTok");

    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&limit=200`,
    );
    const items = (await itemsRes.json()) as any[];

    for (const item of items) {
      const videoId: string = String(item.id || "");
      if (!videoId) continue;

      // 入力URLとマッチ（videoIdのsubstringマッチ）
      const matchedUrl = urls.find((u) => u.includes(videoId));
      if (!matchedUrl) continue;

      const data: ScrapedVideoData = {
        videoId,
        videoUrl: item.webVideoUrl || matchedUrl,
        coverUrl: item.covers?.default || item.videoMeta?.coverUrl || "",
        description: item.text || "",
        hashtags: (item.hashtags || []).map((h: any) =>
          typeof h === "string" ? h : h?.name || "",
        ),
        duration: item.videoMeta?.duration || 0,
        createTime: item.createTimeISO
          ? Math.floor(new Date(item.createTimeISO).getTime() / 1000)
          : item.createTime || 0,
        authorUniqueId: item.authorMeta?.name || "",
        authorNickname: item.authorMeta?.nickName || "",
        authorAvatarUrl: item.authorMeta?.avatar || "",
        followerCount: item.authorMeta?.fans || 0,
        viewCount: item.playCount || 0,
        likeCount: item.diggCount || 0,
        commentCount: item.commentCount || 0,
        shareCount: item.shareCount || 0,
        saveCount: item.collectCount || 0,
        music: item.musicMeta
          ? {
              id: String(item.musicMeta.musicId || ""),
              title: item.musicMeta.musicName || "",
              authorName: item.musicMeta.musicAuthor || "",
              original: item.musicMeta.musicOriginal ?? false,
            }
          : undefined,
      };

      result.set(matchedUrl, data);
    }

    console.log(
      `[ApifyFallback/TikTok] Recovered ${result.size}/${urls.length} videos`,
    );
  } catch (e) {
    console.error("[ApifyFallback/TikTok] Failed:", e);
  }

  return result;
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

const YOUTUBE_ACTOR = "streamers~youtube-scraper";

/**
 * YouTube 動画IDリストを Apify 経由で取得。
 * @param videoIds - YouTube video IDs
 * @param youtubeUrlMap - videoId → original URL のマップ
 */
export async function fallbackYouTubeViaApify(
  videoIds: string[],
  youtubeUrlMap: Map<string, string>,
): Promise<YouTubeVideoData[]> {
  const token = ENV.apifyApiToken;
  if (!token) {
    console.warn("[ApifyFallback/YouTube] APIFY_API_TOKEN not set, skipping");
    return [];
  }
  if (videoIds.length === 0) return [];

  const results: YouTubeVideoData[] = [];

  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${YOUTUBE_ACTOR}/runs?token=${token}&waitForFinish=180`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startUrls: videoIds.map((id) => ({
            url: `https://www.youtube.com/watch?v=${id}`,
          })),
          maxResults: videoIds.length,
        }),
        signal: AbortSignal.timeout(200_000),
      },
    );

    const runData = (await res.json()) as any;
    const datasetId = runData?.data?.defaultDatasetId;
    if (!datasetId) {
      console.error(
        "[ApifyFallback/YouTube] Run failed:",
        runData?.data?.status,
        JSON.stringify(runData?.error || {}).slice(0, 200),
      );
      return results;
    }

    // 実行完了を確認（RUNNINGならポーリング待機）
    await ensureApifyRunComplete(runData, token, "ApifyFallback/YouTube");

    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&limit=200`,
    );
    const items = (await itemsRes.json()) as any[];

    for (const item of items) {
      const id: string = item.id || "";
      if (!id) continue;

      results.push({
        videoId: id,
        videoUrl: youtubeUrlMap.get(id) || `https://www.youtube.com/watch?v=${id}`,
        title: item.title || "",
        description: item.description || "",
        coverUrl: item.thumbnailUrl || "",
        viewCount: parseInt(String(item.viewCount || "0"), 10),
        likeCount: parseInt(String(item.likes || "0"), 10),
        commentCount: parseInt(String(item.commentCount || "0"), 10),
        duration: item.duration || 0,
        publishedAt: item.date || "",
        channelTitle: item.channelName || "",
      });
    }

    console.log(
      `[ApifyFallback/YouTube] Recovered ${results.length}/${videoIds.length} videos`,
    );
  } catch (e) {
    console.error("[ApifyFallback/YouTube] Failed:", e);
  }

  return results;
}
