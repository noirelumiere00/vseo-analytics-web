/**
 * キャンペーンスナップショット取得ロジック
 * TikTokスクレイパー + Apify APIを使用して、キャンペーンのベースライン/効果測定データを収集
 *
 * Phase A: KW検索（batchSearch 3並列）
 * Phase B: プロフィール取得（Apify API）
 * Phase C: 波及効果（batchSearch 3並列）
 * Phase D: 施策動画メトリクス
 * Phase E: ビッグKW検索（batchSearch 3並列）
 * Phase G: 競合自動検出（インメモリ）
 */

import { searchTikTokVideos, scrapeTikTokVideosByUrls, type TikTokVideo } from "./tiktokScraper";
import { fetchYouTubeVideos } from "./youtubeScraper";
import { fetchInstagramPosts } from "./instagramScraper";
import { fallbackTikTokViaApify, fallbackYouTubeViaApify } from "./apifyFallback";
import type { Campaign, InsertCampaignSnapshot } from "../drizzle/schema";
import { detectPlatform, extractVideoId } from "../shared/videoUrl";

// =============================
// Types
// =============================

export interface NormalizedVideo {
  video_id: string;
  video_url: string;
  creator_username: string;
  description: string;
  hashtags: string[];
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  search_rank: number;
  created_at: string;
  is_ad?: boolean;
  aigc_description?: string;
  cover_url?: string;
}

export interface NormalizedVideoWithER extends NormalizedVideo {
  er: number;
}

export interface SnapshotProgress {
  message: string;
  percent: number;
  phase: string;
}

// =============================
// Helpers
// =============================

function normalizeVideo(v: TikTokVideo, rank: number): NormalizedVideo {
  return {
    video_id: v.id,
    video_url: `https://www.tiktok.com/@${v.author.uniqueId}/video/${v.id}`,
    creator_username: v.author.uniqueId,
    description: v.desc,
    hashtags: v.hashtags || [],
    view_count: v.stats.playCount || 0,
    like_count: v.stats.diggCount || 0,
    comment_count: v.stats.commentCount || 0,
    share_count: v.stats.shareCount || 0,
    search_rank: rank,
    created_at: new Date(v.createTime * 1000).toISOString(),
    is_ad: v.isAd || false,
    aigc_description: v.aigcDescription || "",
    cover_url: v.coverUrl || "",
  };
}

function calcER(v: NormalizedVideo): number {
  if (!v.view_count || v.view_count === 0) return 0;
  return Number(
    ((v.like_count + v.comment_count + v.share_count) / v.view_count * 100).toFixed(2)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** 配列を N 件ずつのバッチに分割 */
function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * 複数キーワードを最大 concurrency 並列で検索し、バッチ間に sleepMs の待機を入れる。
 * 返却: Map<keyword, TikTokVideo[]>
 */
async function batchSearch(
  queries: string[],
  concurrency: number,
  sleepMs: number,
  onProgress?: (completed: number, total: number) => void,
  count: number = 30,
): Promise<Map<string, TikTokVideo[]> & { _failedQueries?: string[] }> {
  const result = new Map<string, TikTokVideo[]>() as Map<string, TikTokVideo[]> & { _failedQueries?: string[] };
  const failedQueries = new Set<string>();
  const batches = chunk(queries, concurrency);

  let completed = 0;
  for (const batch of batches) {
    const settled = await Promise.allSettled(
      batch.map(async (q) => {
        const r = await searchTikTokVideos(q, count);
        return { query: q, videos: r.videos };
      }),
    );

    for (const s of settled) {
      if (s.status === "fulfilled") {
        result.set(s.value.query, s.value.videos);
      } else {
        const failedQuery = batch[settled.indexOf(s)];
        console.error(`Search failed for "${failedQuery}":`, s.reason);
        result.set(failedQuery, []);
        failedQueries.add(failedQuery);
      }
      completed++;
    }

    if (onProgress) onProgress(completed, queries.length);
    if (completed < queries.length) {
      await sleep(sleepMs + Math.random() * 1000);
    }
  }

  // 0件だったクエリをリトライ（最大2回）
  const MAX_RETRIES = 2;
  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    const zeroResultQueries = [...result.entries()]
      .filter(([, videos]) => videos.length === 0)
      .map(([q]) => q);
    if (zeroResultQueries.length === 0) break;

    console.log(`[batchSearch] Retry ${retry + 1}: ${zeroResultQueries.length} queries returned 0 results, retrying...`);
    await sleep(3000 + Math.random() * 2000);

    const retryBatches = chunk(zeroResultQueries, concurrency);
    for (const batch of retryBatches) {
      const settled = await Promise.allSettled(
        batch.map(async (q) => {
          const r = await searchTikTokVideos(q, count);
          return { query: q, videos: r.videos };
        }),
      );
      for (const s of settled) {
        if (s.status === "fulfilled" && s.value.videos.length > 0) {
          result.set(s.value.query, s.value.videos);
          failedQueries.delete(s.value.query); // リトライ成功 → 失敗リストから除外
          console.log(`[batchSearch] Retry success: "${s.value.query}" got ${s.value.videos.length} results`);
        }
      }
      if (batch !== retryBatches[retryBatches.length - 1]) {
        await sleep(sleepMs + Math.random() * 1000);
      }
    }
  }

  // APIエラーで失敗したクエリをメタデータとして付与
  if (failedQueries.size > 0) {
    result._failedQueries = [...failedQueries];
    console.warn(`[batchSearch] ${failedQueries.size} queries failed after retries: ${[...failedQueries].join(", ")}`);
  }

  return result;
}

// =============================
// Snapshot capture
// =============================

export async function captureSnapshot(
  campaign: Campaign,
  snapshotType: "baseline" | "measurement",
  onProgress?: (progress: SnapshotProgress) => void,
): Promise<Omit<InsertCampaignSnapshot, "id">> {
  const report = (phase: string, message: string, percent: number) => {
    if (onProgress) onProgress({ phase, message, percent });
  };

  const searchResults: NonNullable<InsertCampaignSnapshot["searchResults"]> = {};
  const competitorProfiles: NonNullable<InsertCampaignSnapshot["competitorProfiles"]> = {};
  const rippleEffect: NonNullable<InsertCampaignSnapshot["rippleEffect"]> = {};

  const keywords = campaign.keywords || [];
  const competitors = campaign.competitors || [];
  const campaignHashtags = campaign.campaignHashtags || [];
  const ownAccountIds = campaign.ownAccountIds || [];
  const ownVideoIds = campaign.ownVideoIds || [];

  // 施策動画のビデオID集合（SOV・順位マッチ用 — アカウント単位ではなく動画単位で判定）
  const ownVideoData = (campaign as any).ownVideoData as Array<{ videoId: string; authorUniqueId: string }> | undefined;
  const campaignVideoIds = new Set<string>(ownVideoIds);
  const campaignVideoAuthors = new Set<string>(); // 施策動画の投稿者（競合検出除外用）
  if (ownVideoData) {
    for (const v of ownVideoData) {
      if (v.videoId) campaignVideoIds.add(v.videoId);
      if (v.authorUniqueId) campaignVideoAuthors.add(v.authorUniqueId.toLowerCase());
    }
  }
  // サテライトアカウント
  const satelliteAccountIds = ((campaign as any).satelliteAccountIds || []) as string[];
  const satelliteAccountIdsLower = new Set<string>(satelliteAccountIds.map((id: string) => id.toLowerCase()));

  // 施策動画の判定: 自社アカウントの動画 OR サテライト OR 登録済み施策ビデオID
  const ownAccountIdsLower = new Set<string>(ownAccountIds.map((id: string) => id.toLowerCase()));
  const isCampaignVideo = (v: NormalizedVideo): boolean =>
    ownAccountIdsLower.has(v.creator_username.toLowerCase()) || satelliteAccountIdsLower.has(v.creator_username.toLowerCase()) || campaignVideoIds.has(v.video_id);

  // ============================
  // A. KW別の検索結果（3並列）
  // ============================
    report("search", `KW検索中 (${keywords.length}件)...`, 5);

    const kwResults = await batchSearch(keywords, 3, 2000, (done, total) =>
      report("search", `KW検索: ${done}/${total}`, Math.round((done / total) * 30)),
      60,
    );

    // 失敗したクエリ情報をスナップショットに記録
    const failedSearchQueries = (kwResults as any)._failedQueries as string[] | undefined;
    if (failedSearchQueries && failedSearchQueries.length > 0) {
      console.warn(`[captureSnapshot] ${failedSearchQueries.length} keywords had search failures: ${failedSearchQueries.join(", ")}`);
    }

    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i];
      const videos = kwResults.get(kw) || [];
      const allVideos = videos.map((v, idx) => normalizeVideo(v, idx + 1));

      const ownVideos: NormalizedVideoWithER[] = allVideos
        .filter(v => isCampaignVideo(v))
        .map(v => ({ ...v, er: calcER(v) }));

      const competitorPositions = competitors.map(comp => {
        const compVideos = allVideos.filter(v => v.creator_username === comp.account_id);
        return {
          competitor_name: comp.name,
          competitor_id: comp.account_id,
          best_rank: compVideos.length > 0 ? Math.min(...compVideos.map(v => v.search_rank)) : null,
          video_count_in_top30: compVideos.length,
        };
      });

      const ownCountInResults = allVideos.filter(v => isCampaignVideo(v)).length;

      searchResults[kw] = {
        total_results: allVideos.length,
        all_videos: allVideos,
        own_videos: ownVideos,
        competitor_positions: competitorPositions,
        share_of_voice: {
          own_count: ownCountInResults,
          total_count: allVideos.length,
          percentage: allVideos.length > 0 ? (ownCountInResults / allVideos.length * 100).toFixed(1) : "0",
        },
        screenshot_key: null,
      };
    }

    // ============================
    // B. 自社+競合プロフィール（Apify一括取得）
    // ============================
    const allProfileAccountIds = [...new Set([...ownAccountIds, ...satelliteAccountIds, ...competitors.map(c => c.account_id)])];
    if (allProfileAccountIds.length > 0) {
      report("profiles", `プロフィール取得中 (${allProfileAccountIds.length}アカウント)...`, 38);

      const profileMap = await scrapeProfilesWithApify(allProfileAccountIds);

      // 自社プロフィールも保存（投稿頻度算出用）
      for (const ownId of ownAccountIds) {
        const profile = profileMap.get(ownId);
        if (profile) {
          competitorProfiles[ownId] = {
            name: profile.nickname || ownId,
            follower_count: profile.followerCount,
            video_count: profile.videoCount,
            recent_post_dates: profile.recentPostDates,
          };
        }
      }

      for (const comp of competitors) {
        const profile = profileMap.get(comp.account_id);
        if (profile) {
          competitorProfiles[comp.account_id] = {
            name: profile.nickname || comp.name,
            follower_count: profile.followerCount,
            video_count: profile.videoCount,
            recent_post_dates: profile.recentPostDates,
          };
        }
      }
    }

    // ============================
    // C. 波及効果データ（batchSearchで取得）
    // ============================
    // 施策KW（CPKW）でSearch検索し、第三者投稿を取得
    const rippleKeywords = [...new Set(
      keywords.map((kw: string) => kw.trim()).filter(Boolean)
    )];

    if (rippleKeywords.length > 0) {
      report("ripple", `波及効果データ取得中 (${rippleKeywords.length}KW)...`, 45);

      const rippleResults = await batchSearch(rippleKeywords, 3, 2000, (done, total) =>
        report("ripple", `KW検索: ${done}/${total}`, 45 + Math.round((done / total) * 20))
      );

      // 自社動画の包括的な排除セット構築（ループ外で1回だけ）
      const ownVidData = (campaign as any).ownVideoData as Array<{
        videoId: string; authorUniqueId: string;
      }> | undefined;
      const allOwnAccounts = new Set(ownAccountIds.map((id: string) => id.toLowerCase()));
      const allOwnVideoIds = new Set(ownVideoIds.map((id: string) => id));
      if (ownVidData) {
        for (const v of ownVidData) {
          if (v.authorUniqueId) allOwnAccounts.add(v.authorUniqueId.toLowerCase());
          if (v.videoId) allOwnVideoIds.add(v.videoId);
        }
      }
      const isOwnVideo = (v: NormalizedVideo): boolean =>
        allOwnAccounts.has(v.creator_username.toLowerCase()) || allOwnVideoIds.has(v.video_id);

      for (const tag of rippleKeywords) {
        const videos = rippleResults.get(tag) || [];
        const allNormalized = videos.map((v, idx) => normalizeVideo(v, idx + 1));
        console.log(`[Ripple] #${tag}: search returned ${videos.length} videos`);

        const relevantThirdParty = allNormalized.filter(v => !isOwnVideo(v));
        const thirdPartyVideos = relevantThirdParty
          .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
          .slice(0, 60);

        rippleEffect[tag] = {
          total_post_count: allNormalized.length,
          other_post_count: relevantThirdParty.length,
          other_total_views: relevantThirdParty.reduce((sum, v) => sum + (v.view_count || 0), 0),
          other_avg_views: relevantThirdParty.length > 0
            ? Math.round(relevantThirdParty.reduce((s, v) => s + (v.view_count || 0), 0) / relevantThirdParty.length)
            : 0,
          third_party_videos: thirdPartyVideos.map(v => ({
            video_url: v.video_url, creator: v.creator_username,
            views: v.view_count, likes: v.like_count,
            comments: v.comment_count, shares: v.share_count,
            description: v.description, hashtags: v.hashtags,
            posted_at: v.created_at,
            search_rank: v.search_rank,
            cover_url: v.cover_url,
          })),
        };
      }
    }

    // ============================
    // D. 施策動画メトリクス（全プラットフォーム）
    // ============================
    let ownVideoMetrics: NonNullable<InsertCampaignSnapshot["ownVideoMetrics"]> = {};

    const ownVideoUrls = (campaign as any).ownVideoUrls as string[] | undefined;
    const allVideoUrls = ownVideoUrls || [];

    // URLをプラットフォーム別にグループ分け
    const tiktokVideoUrls: string[] = [];
    const youtubeVideoIds: string[] = [];
    const youtubeUrlMap = new Map<string, string>(); // videoId -> original url
    const instagramVideoUrls: string[] = [];

    for (const url of allVideoUrls) {
      const platform = detectPlatform(url);
      if (platform === "youtube") {
        const extracted = extractVideoId(url);
        if (extracted) {
          youtubeVideoIds.push(extracted.id);
          youtubeUrlMap.set(extracted.id, url);
        } else {
          console.warn(`[Snapshot/PhaseD] YouTube URL could not extract video ID: ${url}`);
        }
      } else if (platform === "instagram") {
        instagramVideoUrls.push(url);
      } else {
        // TikTok or unknown (default to TikTok)
        if (!platform) {
          console.warn(`[Snapshot/PhaseD] Unknown platform for URL, defaulting to TikTok: ${url}`);
        }
        tiktokVideoUrls.push(url);
      }
    }

    const totalVideoCount = tiktokVideoUrls.length + youtubeVideoIds.length + instagramVideoUrls.length;
    if (totalVideoCount > 0) {
      report("video_metrics", `施策動画メトリクス取得中 (${totalVideoCount}本: TT:${tiktokVideoUrls.length} YT:${youtubeVideoIds.length} IG:${instagramVideoUrls.length})...`, 68);
    }

    // TikTok metrics
    if (tiktokVideoUrls.length > 0) {
      try {
        const scraped = await scrapeTikTokVideosByUrls(tiktokVideoUrls, (msg) =>
          report("video_metrics", msg, 72)
        );

        // Apify fallback for URLs not returned by primary scraper
        const missingTikTok = tiktokVideoUrls.filter((u) => !scraped.has(u));
        if (missingTikTok.length > 0) {
          console.log(`[Snapshot/PhaseD] TikTok: ${missingTikTok.length}/${tiktokVideoUrls.length} missing, trying Apify fallback...`);
          try {
            const recovered = await fallbackTikTokViaApify(missingTikTok);
            for (const [url, v] of recovered) {
              scraped.set(url, v);
            }
            if (recovered.size > 0) {
              console.log(`[Snapshot/PhaseD] TikTok Apify fallback recovered ${recovered.size} videos`);
            }
          } catch (fbErr) {
            console.error("[Snapshot/PhaseD] TikTok Apify fallback failed:", fbErr);
          }
        }

        for (const [, v] of scraped) {
          ownVideoMetrics[v.videoId] = {
            viewCount: v.viewCount,
            likeCount: v.likeCount,
            commentCount: v.commentCount,
            shareCount: v.shareCount,
            saveCount: v.saveCount,
            platform: "tiktok",
          };
        }
        console.log(`[Snapshot/PhaseD] TikTok: ${scraped.size}/${tiktokVideoUrls.length} videos scraped`);
      } catch (e) {
        console.error("[Snapshot/PhaseD] TikTok metrics scrape failed:", e);
      }
    }

    // YouTube metrics
    if (youtubeVideoIds.length > 0) {
      try {
        const ytVideos = await fetchYouTubeVideos(youtubeVideoIds);

        // Apify fallback for IDs not returned by YouTube Data API
        const fetchedYtIds = new Set(ytVideos.map((v) => v.videoId));
        const missingYouTube = youtubeVideoIds.filter((id) => !fetchedYtIds.has(id));
        if (missingYouTube.length > 0) {
          console.log(`[Snapshot/PhaseD] YouTube: ${missingYouTube.length}/${youtubeVideoIds.length} missing, trying Apify fallback...`);
          try {
            const recovered = await fallbackYouTubeViaApify(missingYouTube, youtubeUrlMap);
            ytVideos.push(...recovered);
            if (recovered.length > 0) {
              console.log(`[Snapshot/PhaseD] YouTube Apify fallback recovered ${recovered.length} videos`);
            }
          } catch (fbErr) {
            console.error("[Snapshot/PhaseD] YouTube Apify fallback failed:", fbErr);
          }
        }

        for (const v of ytVideos) {
          ownVideoMetrics[v.videoId] = {
            viewCount: v.viewCount,
            likeCount: v.likeCount,
            commentCount: v.commentCount,
            shareCount: null,
            saveCount: null,
            platform: "youtube",
          };
        }
        console.log(`[Snapshot/PhaseD] YouTube: ${ytVideos.length}/${youtubeVideoIds.length} videos fetched`);
      } catch (e) {
        console.error("[Snapshot/PhaseD] YouTube metrics fetch failed:", e);
      }
    }

    // Instagram metrics
    if (instagramVideoUrls.length > 0) {
      try {
        const igPosts = await fetchInstagramPosts(instagramVideoUrls);
        for (const p of igPosts) {
          ownVideoMetrics[p.videoId] = {
            viewCount: p.viewCount,
            likeCount: p.likeCount,
            commentCount: p.commentCount,
            shareCount: null,
            saveCount: null,
            platform: "instagram",
          };
        }
        console.log(`[Snapshot/PhaseD] Instagram: ${igPosts.length}/${instagramVideoUrls.length} posts fetched`);
      } catch (e) {
        console.error("[Snapshot/PhaseD] Instagram metrics fetch failed:", e);
      }
    }

    // Phase D summary log — per-platform breakdown
    if (totalVideoCount > 0) {
      const metricsCount = Object.keys(ownVideoMetrics).length;
      const ttCollected = Object.values(ownVideoMetrics).filter(m => m.platform === "tiktok").length;
      const ytCollected = Object.values(ownVideoMetrics).filter(m => m.platform === "youtube").length;
      const igCollected = Object.values(ownVideoMetrics).filter(m => m.platform === "instagram").length;

      const summary = [
        tiktokVideoUrls.length > 0 ? `TT:${ttCollected}/${tiktokVideoUrls.length}` : null,
        youtubeVideoIds.length > 0 ? `YT:${ytCollected}/${youtubeVideoIds.length}` : null,
        instagramVideoUrls.length > 0 ? `IG:${igCollected}/${instagramVideoUrls.length}` : null,
      ].filter(Boolean).join(" ");

      if (metricsCount < totalVideoCount) {
        console.warn(`[Snapshot/PhaseD] INCOMPLETE: ${metricsCount}/${totalVideoCount} video metrics collected (${summary})`);
      } else {
        console.log(`[Snapshot/PhaseD] OK: ${metricsCount}/${totalVideoCount} video metrics collected (${summary})`);
      }
    }

    // ============================
    // E. ビッグキーワード検索（3並列）
    // ============================
    let bigKeywordResults: NonNullable<InsertCampaignSnapshot["bigKeywordResults"]> = {};

    const bigKeywords = (campaign as any).bigKeywords as string[] | undefined;
    if (bigKeywords && bigKeywords.length > 0) {
      report("big_keywords", `ビッグキーワード検索中 (${bigKeywords.length}件)...`, 90);

      const bkResults = await batchSearch(bigKeywords, 3, 2000, (done, total) =>
        report("big_keywords", `ビッグKW検索: ${done}/${total}`, 90 + Math.round((done / total) * 7))
      );

      // 施策KWに関連するコンテンツかを判定するキーワードセット
      const campaignTerms = [
        ...keywords.map((kw: string) => kw.replace(/^#/, "").toLowerCase()),
        ...campaignHashtags.map((h: string) => h.replace(/^#/, "").toLowerCase()),
      ].filter(Boolean);

      for (const [bkw, bkVideos] of bkResults) {
        const ownVideosInTop30: Array<{ videoId: string; rank: number; viewCount: number; username?: string; description?: string }> = [];
        for (let idx = 0; idx < bkVideos.length; idx++) {
          const v = bkVideos[idx];
          if (ownAccountIdsLower.has(v.author.uniqueId.toLowerCase()) || campaignVideoIds.has(v.id)) {
            // 施策KW関連の動画のみ対象（動画説明文 or ハッシュタグに施策KWが含まれるか）
            const desc = (v.desc || "").toLowerCase();
            const tags = (v.hashtags || []).map((h: string) => h.toLowerCase());
            const isRelevant = campaignVideoIds.has(v.id) || campaignTerms.some(term =>
              desc.includes(term) || tags.some(t => t.includes(term) || term.includes(t))
            );
            if (!isRelevant) continue;

            ownVideosInTop30.push({
              videoId: v.id,
              rank: idx + 1,
              viewCount: v.stats.playCount || 0,
              username: v.author.uniqueId,
              description: (v.desc || "").slice(0, 40),
            });
          }
        }

        const competitorPositions = competitors.map(comp => {
          const compVideos = bkVideos
            .map((v, idx) => ({ v, rank: idx + 1 }))
            .filter(({ v }) => v.author.uniqueId === comp.account_id);
          return {
            competitor_name: comp.name,
            competitor_id: comp.account_id,
            best_rank: compVideos.length > 0 ? Math.min(...compVideos.map(c => c.rank)) : null,
            video_count_in_top30: compVideos.length,
          };
        });

        // Top10を all_videos として保存（SOVスロットマップ用）
        const allVideosTop10 = bkVideos.slice(0, 10).map((v, idx) => normalizeVideo(v, idx + 1));

        bigKeywordResults[bkw] = {
          ownVideosInTop30,
          competitorPositions,
          totalResults: bkVideos.length,
          all_videos: allVideosTop10,
        };
      }
    }

    // ============================
    // G. 競合自動検出（インメモリ）
    // ============================
    let detectedCompetitors: NonNullable<InsertCampaignSnapshot["detectedCompetitors"]> = [];

    const competitorIds = new Set(competitors.map(c => c.account_id));
    const accountMap = new Map<string, {
      nickname: string; avatarUrl: string; followerCount: number;
      kwSet: Set<string>; totalVideos: number; ranks: number[];
    }>();

    for (const [kw, data] of Object.entries(searchResults)) {
      for (const v of data.all_videos) {
        const acct = v.creator_username;
        if (ownAccountIdsLower.has(acct.toLowerCase()) || campaignVideoAuthors.has(acct.toLowerCase()) || competitorIds.has(acct)) continue;

        if (!accountMap.has(acct)) {
          accountMap.set(acct, {
            nickname: acct, avatarUrl: "", followerCount: 0,
            kwSet: new Set(), totalVideos: 0, ranks: [],
          });
        }
        const entry = accountMap.get(acct)!;
        entry.kwSet.add(kw);
        entry.totalVideos++;
        entry.ranks.push(v.search_rank);
      }
    }

    detectedCompetitors = Array.from(accountMap.entries())
      .filter(([, e]) => e.kwSet.size >= 2)
      .map(([accountId, e]) => ({
        accountId,
        nickname: e.nickname,
        avatarUrl: e.avatarUrl,
        followerCount: e.followerCount,
        keywordAppearances: e.kwSet.size,
        totalVideosInTop30: e.totalVideos,
        avgRank: Math.round(e.ranks.reduce((a, b) => a + b, 0) / e.ranks.length),
      }))
      .sort((a, b) => b.keywordAppearances - a.keywordAppearances || a.avgRank - b.avgRank);

  report("complete", "スナップショット取得完了", 100);

  return {
    campaignId: campaign.id,
    snapshotType,
    status: "completed",
    searchResults,
    competitorProfiles,
    rippleEffect,
    ownVideoMetrics,
    detectedCompetitors,
    bigKeywordResults: Object.keys(bigKeywordResults).length > 0 ? bigKeywordResults : undefined,
    failedSearchQueries: failedSearchQueries && failedSearchQueries.length > 0 ? failedSearchQueries : undefined,
    capturedAt: new Date(),
  };
}

// =============================
// Profile scraper (Apify)
// =============================

interface ProfileData {
  followerCount: number;
  videoCount: number;
  nickname: string;
  recentPostDates: string[];
}

/**
 * Apify TikTok Profile Scraper で複数アカウントのプロフィール+最近の投稿を一括取得
 */
async function scrapeProfilesWithApify(accountIds: string[]): Promise<Map<string, ProfileData>> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    console.warn("[Profile] APIFY_API_TOKEN not set, skipping profile scrape");
    return new Map();
  }

  const results = new Map<string, ProfileData>();

  try {
    // Apify actor を同期実行（waitForFinish=180秒）
    const res = await fetch(
      `https://api.apify.com/v2/acts/clockworks~tiktok-profile-scraper/runs?token=${token}&waitForFinish=180`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profiles: accountIds,
          resultsPerPage: 10,
        }),
      },
    );
    const runData = await res.json() as any;
    const datasetId = runData?.data?.defaultDatasetId;
    if (!datasetId) {
      console.error("[Profile] Apify run failed:", runData?.data?.status);
      return results;
    }

    // データセットから結果取得
    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&limit=200`,
    );
    const items = await itemsRes.json() as any[];

    // アカウントごとに集約
    const accountMap = new Map<string, { profile: any; posts: any[] }>();
    for (const item of items) {
      const authorId = item.authorMeta?.name;
      if (!authorId) continue;
      if (!accountMap.has(authorId)) {
        accountMap.set(authorId, { profile: item.authorMeta, posts: [] });
      }
      accountMap.get(authorId)!.posts.push(item);
    }

    for (const [accountId, { profile, posts }] of accountMap) {
      const recentPostDates = posts
        .filter((p: any) => p.createTime)
        .sort((a: any, b: any) => b.createTime - a.createTime)
        .slice(0, 10)
        .map((p: any) => new Date(p.createTime * 1000).toISOString());

      results.set(accountId, {
        followerCount: profile.fans || 0,
        videoCount: profile.video || 0,
        nickname: profile.nickName || accountId,
        recentPostDates,
      });
    }

    console.log(`[Profile] Apify scraped ${results.size} profiles: ${[...results.keys()].join(", ")}`);
  } catch (e) {
    console.error("[Profile] Apify scrape failed:", e);
  }

  return results;
}

// =============================
// Posting frequency estimation
// =============================

export function estimatePostingFrequency(recentPostDates: string[] | null | undefined) {
  if (!recentPostDates || recentPostDates.length < 2) return null;

  const sorted = recentPostDates
    .map(d => new Date(d).getTime())
    .filter(t => !isNaN(t))
    .sort((a, b) => b - a);

  if (sorted.length < 2) return null;

  const intervals: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    intervals.push(sorted[i] - sorted[i + 1]);
  }

  const avgIntervalMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const avgIntervalDays = avgIntervalMs / (1000 * 60 * 60 * 24);

  return {
    avg_interval_days: Math.round(avgIntervalDays * 10) / 10,
    posts_per_week: avgIntervalDays > 0 ? Math.round(7 / avgIntervalDays * 10) / 10 : 0,
    sample_size: recentPostDates.length,
  };
}
