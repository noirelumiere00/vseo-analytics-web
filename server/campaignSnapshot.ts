/**
 * キャンペーンスナップショット取得ロジック
 * 既存のPuppeteerスクレイパーを再利用して、キャンペーンのベースライン/効果測定データを収集
 *
 * 最適化ポイント:
 * - 検索を最大3並列で実行（Phase A, E）
 * - Phase C はチャレンジページ SSR から軽量取得（sharedBrowser 再利用）
 * - スクリーンショット・プロフィール取得で共有ブラウザ使用
 * - バッチ間sleep短縮（2-3秒）
 */

import { searchTikTokVideos, scrapeTikTokVideosByUrls, parseVideoData, type TikTokVideo } from "./tiktokScraper";
import { storagePut } from "./storage";
import puppeteer from "puppeteer-core";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { Campaign, InsertCampaignSnapshot } from "../drizzle/schema";

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

function findChromiumPath(): string {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const candidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  try {
    return execSync("which chromium-browser || which chromium || which google-chrome", { encoding: "utf-8" }).trim();
  } catch {
    return "/usr/bin/chromium-browser";
  }
}

const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--window-size=1280,900",
  "--lang=ja-JP",
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
): Promise<Map<string, TikTokVideo[]>> {
  const result = new Map<string, TikTokVideo[]>();
  const batches = chunk(queries, concurrency);

  let completed = 0;
  for (const batch of batches) {
    const settled = await Promise.allSettled(
      batch.map(async (q) => {
        const r = await searchTikTokVideos(q, 30);
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
          const r = await searchTikTokVideos(q, 30);
          return { query: q, videos: r.videos };
        }),
      );
      for (const s of settled) {
        if (s.status === "fulfilled" && s.value.videos.length > 0) {
          result.set(s.value.query, s.value.videos);
          console.log(`[batchSearch] Retry success: "${s.value.query}" got ${s.value.videos.length} results`);
        }
      }
      if (batch !== retryBatches[retryBatches.length - 1]) {
        await sleep(sleepMs + Math.random() * 1000);
      }
    }
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

  // 共有ブラウザ（スクリーンショット・プロフィール・波及効果取得用）
  const sharedBrowser = await puppeteer.launch({
    executablePath: findChromiumPath(),
    headless: true,
    args: CHROMIUM_ARGS,
  });

  try {
    // ============================
    // A. KW別の検索結果（3並列） + スクリーンショット並列
    // ============================
    report("search", `KW検索中 (${keywords.length}件)...`, 5);

    const kwResults = await batchSearch(keywords, 3, 2000, (done, total) =>
      report("search", `KW検索: ${done}/${total}`, Math.round((done / total) * 30))
    );

    // スクリーンショットを並列取得（共有ブラウザ使用）
    report("search", `スクリーンショット取得中...`, 32);
    const screenshotPromises = keywords.map(kw =>
      captureSearchScreenshotWithBrowser(sharedBrowser, kw, campaign.id, snapshotType)
        .catch(e => { console.error(`Screenshot failed for "${kw}":`, e); return null; })
    );
    const screenshotResults = await Promise.all(screenshotPromises);

    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i];
      const videos = kwResults.get(kw) || [];
      const allVideos = videos.map((v, idx) => normalizeVideo(v, idx + 1));

      const ownVideos: NormalizedVideoWithER[] = allVideos
        .filter(v => ownAccountIds.includes(v.creator_username))
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

      const ownCountInResults = allVideos.filter(v => ownAccountIds.includes(v.creator_username)).length;

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
        screenshot_key: screenshotResults[i],
      };
    }

    // ============================
    // B. 自社+競合プロフィール（Apify一括取得）
    // ============================
    const allAccountIds = [...new Set([...ownAccountIds, ...competitors.map(c => c.account_id)])];
    if (allAccountIds.length > 0) {
      report("profiles", `プロフィール取得中 (${allAccountIds.length}アカウント)...`, 38);

      const profileMap = await scrapeProfilesWithApify(allAccountIds);

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
    // C. 波及効果データ（sharedBrowser で軽量取得）
    // ============================
    let effectiveHashtags = [...campaignHashtags];
    if (effectiveHashtags.length === 0) {
      const ownVidData = (campaign as any).ownVideoData as Array<{ hashtags: string[] }> | undefined;
      if (ownVidData?.length) {
        const tagCounts = new Map<string, number>();
        for (const v of ownVidData) {
          for (const tag of (v.hashtags || [])) {
            const n = tag.toLowerCase().replace(/^#/, "");
            if (n) tagCounts.set(n, (tagCounts.get(n) || 0) + 1);
          }
        }
        effectiveHashtags = [...tagCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([t]) => `#${t}`);
      }
    }
    if (effectiveHashtags.length > 0) {
      report("ripple", `波及効果データ取得中 (${effectiveHashtags.length}タグ)...`, 45);

      const CONCURRENCY = 3;
      for (let i = 0; i < effectiveHashtags.length; i += CONCURRENCY) {
        const batch = effectiveHashtags.slice(i, i + CONCURRENCY);
        if (i > 0) await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));

        await Promise.allSettled(batch.map(async (tag, batchIdx) => {
          const cleanTag = tag.replace(/^#/, "");
          const context = await sharedBrowser.createBrowserContext();
          const page = await context.newPage();
          try {
            await page.setViewport({ width: 1280, height: 900 });
            await page.setExtraHTTPHeaders({ "Accept-Language": "ja-JP,ja;q=0.9" });
            if (batchIdx > 0) await new Promise(r => setTimeout(r, batchIdx * 800));

            await page.goto(`https://www.tiktok.com/tag/${encodeURIComponent(cleanTag)}`, {
              waitUntil: "domcontentloaded", timeout: 20000,
            });
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));

            // SSR から videoCount + itemList を抽出
            const ssrResult = await page.evaluate(() => {
              const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
              if (!el?.textContent) return null;
              try {
                const parsed = JSON.parse(el.textContent);
                const cd = parsed?.['__DEFAULT_SCOPE__']?.['webapp.challenge-detail'];
                const videoCount = cd?.challengeInfo?.challenge?.videoCount
                  ?? cd?.stats?.videoCount ?? null;
                const items = cd?.itemList || [];
                return { videoCount, items };
              } catch { return null; }
            });

            // parseVideoData + normalizeVideo で既存パイプラインに合流
            const videos: TikTokVideo[] = [];
            if (ssrResult?.items) {
              for (const item of ssrResult.items) {
                if (!item?.id) continue;
                const video = parseVideoData({ type: 1, item });
                if (video) videos.push(video);
              }
            }

            const allNormalized = videos.map((v, idx) => normalizeVideo(v, idx + 1));

            // 自社動画の包括的な排除セット構築
            // ownAccountIds に加え、ownVideoData の authorUniqueId も自社アカウントとして扱う
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

            const isOwnVideo = (v: NormalizedVideo): boolean => {
              return allOwnAccounts.has(v.creator_username.toLowerCase()) ||
                     allOwnVideoIds.has(v.video_id);
            };

            // キャンペーン関連性フィルタ（多段階）:
            // チャレンジページの動画は検索タグ自体は含むので、
            // それだけでは汎用タグ（日傘、沖縄旅行等）で無関係な動画が混入する。
            // → 複数のシグナルで関連性を判定し、厳密→緩和のフォールバックで0件を防ぐ
            const lowerTag = cleanTag.toLowerCase();
            const lowerKeywords = keywords.map(k => k.toLowerCase().replace(/^#/, ""));
            const otherCampaignTags = effectiveHashtags
              .map(t => t.replace(/^#/, "").toLowerCase())
              .filter(t => t !== lowerTag);

            // 追加シグナル: brandKeywords, clientName, 自社アカウント名
            const brandKws = ((campaign as any).brandKeywords as string[] | undefined) || [];
            const clientName = ((campaign as any).clientName as string | undefined) || "";
            const extraSignals: string[] = [
              ...brandKws.map(k => k.toLowerCase()),
              ...(clientName ? [clientName.toLowerCase()] : []),
              ...[...allOwnAccounts], // 自社アカウントID（@メンション検出用）
            ].filter(s => s.length >= 2); // 短すぎるものは除外

            // ownVideoDataから共通ハッシュタグを抽出（自社動画に頻出するタグ = キャンペーン関連）
            const ownCommonTags = new Set<string>();
            if (ownVidData && ownVidData.length > 0) {
              const tagFreq = new Map<string, number>();
              for (const v of ownVidData as Array<{ hashtags?: string[] }>) {
                for (const h of (v.hashtags || [])) {
                  const lower = h.toLowerCase().replace(/^#/, "");
                  if (lower && lower !== lowerTag) tagFreq.set(lower, (tagFreq.get(lower) || 0) + 1);
                }
              }
              // 自社動画の半数以上で使われているタグをキャンペーン関連とみなす
              const threshold = Math.max(1, Math.floor(ownVidData.length * 0.5));
              for (const [t, count] of tagFreq) {
                if (count >= threshold) ownCommonTags.add(t);
              }
            }

            const isCampaignRelevant = (v: NormalizedVideo): boolean => {
              const desc = v.description.toLowerCase();
              const vTags = v.hashtags.map(h => h.toLowerCase().replace(/^#/, ""));
              // 他のキャンペーンハッシュタグを含む
              if (otherCampaignTags.some(ct => vTags.includes(ct) || desc.includes(ct))) return true;
              // キャンペーンのキーワードを含む
              if (lowerKeywords.some(kw => desc.includes(kw))) return true;
              // ブランド名・クライアント名・自社アカウントへのメンション
              if (extraSignals.some(sig => desc.includes(sig) || desc.includes(`@${sig}`))) return true;
              // 自社動画の共通ハッシュタグを含む
              if (ownCommonTags.size > 0 && vTags.some(t => ownCommonTags.has(t))) return true;
              return false;
            };

            // 自社動画を排除
            const nonOwnVideos = allNormalized.filter(v => !isOwnVideo(v));
            // 厳密フィルタ適用
            const strictFiltered = nonOwnVideos.filter(isCampaignRelevant);
            // フォールバック: 厳密フィルタで0件の場合、自社除外のみ
            // （ユーザーが明示的にキャンペーンタグとして設定 → タグ自体に関連性あり）
            const relevantThirdParty = strictFiltered.length > 0 ? strictFiltered : nonOwnVideos;
            const thirdPartyVideos = relevantThirdParty
              .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
              .slice(0, 5);

            rippleEffect[tag] = {
              total_post_count: ssrResult?.videoCount ?? allNormalized.length,
              other_post_count: relevantThirdParty.length,
              other_total_views: relevantThirdParty.reduce((sum, v) => sum + (v.view_count || 0), 0),
              other_avg_views: relevantThirdParty.length > 0
                ? Math.round(relevantThirdParty.reduce((s, v) => s + (v.view_count || 0), 0) / relevantThirdParty.length)
                : 0,
              third_party_videos: thirdPartyVideos.map(v => ({
                video_url: v.video_url, creator: v.creator_username,
                views: v.view_count, likes: v.like_count,
                description: v.description, hashtags: v.hashtags,
                posted_at: v.created_at,
              })),
            };
          } catch (err) {
            console.error(`[Ripple] #${cleanTag} failed:`, err);
          } finally {
            await context.close();
          }
        }));

        report("ripple", `ハッシュタグ検索: ${Math.min(i + CONCURRENCY, effectiveHashtags.length)}/${effectiveHashtags.length}`,
          45 + Math.round((Math.min(i + CONCURRENCY, effectiveHashtags.length) / effectiveHashtags.length) * 20));
      }
    }

    // ============================
    // D. 施策動画メトリクス（既に3並列）
    // ============================
    let ownVideoMetrics: NonNullable<InsertCampaignSnapshot["ownVideoMetrics"]> = {};

    const ownVideoUrls = (campaign as any).ownVideoUrls as string[] | undefined;
    if (ownVideoUrls && ownVideoUrls.length > 0) {
      report("video_metrics", `施策動画メトリクス取得中 (${ownVideoUrls.length}本)...`, 68);
      try {
        const scraped = await scrapeTikTokVideosByUrls(ownVideoUrls, (msg) =>
          report("video_metrics", msg, 72)
        );
        for (const [, v] of scraped) {
          ownVideoMetrics[v.videoId] = {
            viewCount: v.viewCount,
            likeCount: v.likeCount,
            commentCount: v.commentCount,
            shareCount: v.shareCount,
            saveCount: v.saveCount,
          };
        }
      } catch (e) {
        console.error("Own video metrics scrape failed:", e);
      }
    }

    // ============================
    // E. ビッグキーワード検索（3並列）
    // ============================
    let bigKeywordResults: NonNullable<InsertCampaignSnapshot["bigKeywordResults"]> = {};

    const bigKeywords = (campaign as any).bigKeywords as string[] | undefined;
    if (bigKeywords && bigKeywords.length > 0) {
      report("big_keywords", `ビッグキーワード検索中 (${bigKeywords.length}件)...`, 90);

      const allOwnVideoIds = new Set<string>(ownVideoIds);
      const ownVideoData2 = (campaign as any).ownVideoData as Array<{ videoId: string }> | undefined;
      if (ownVideoData2) {
        for (const v of ownVideoData2) {
          if (v.videoId) allOwnVideoIds.add(v.videoId);
        }
      }

      const bkResults = await batchSearch(bigKeywords, 3, 2000, (done, total) =>
        report("big_keywords", `ビッグKW検索: ${done}/${total}`, 90 + Math.round((done / total) * 7))
      );

      for (const [bkw, bkVideos] of bkResults) {
        const ownVideosInTop30: Array<{ videoId: string; rank: number; viewCount: number }> = [];
        for (let idx = 0; idx < bkVideos.length; idx++) {
          const v = bkVideos[idx];
          if (ownAccountIds.includes(v.author.uniqueId) || allOwnVideoIds.has(v.id)) {
            ownVideosInTop30.push({
              videoId: v.id,
              rank: idx + 1,
              viewCount: v.stats.playCount || 0,
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

        bigKeywordResults[bkw] = {
          ownVideosInTop30,
          competitorPositions,
          totalResults: bkVideos.length,
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
        if (ownAccountIds.includes(acct) || competitorIds.has(acct)) continue;

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
      capturedAt: new Date(),
    };
  } finally {
    await sharedBrowser.close();
  }
}

// =============================
// Screenshot capture (shared browser)
// =============================

async function captureSearchScreenshotWithBrowser(
  browser: any,
  keyword: string,
  campaignId: number,
  snapshotType: string,
): Promise<string | null> {
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.setUserAgent(UA);

    const url = `https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`;
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    try {
      await page.waitForSelector('[data-e2e="search_top-item"], [data-e2e="search-card-desc"]', { timeout: 15000 });
    } catch {
      // セレクタが見つからなくてもスクショは試みる
    }

    await page.evaluate(() => window.scrollBy(0, 300));
    await new Promise(r => setTimeout(r, 2000));

    const screenshotBuffer = await page.screenshot({ fullPage: false });

    const safeKw = keyword.replace(/[^a-zA-Z0-9\u3040-\u9FFF]/g, "_");
    const filename = `${snapshotType}_${safeKw}_${Date.now()}.png`;
    const storageKey = `campaigns/${campaignId}/screenshots/${filename}`;

    try {
      await storagePut(storageKey, Buffer.from(screenshotBuffer), "image/png");
      return storageKey;
    } catch (e) {
      console.error(`Screenshot upload failed:`, e);
      const dir = `/tmp/screenshots/campaigns/${campaignId}`;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), screenshotBuffer);
      return `local:${dir}/${filename}`;
    }
  } finally {
    await context.close();
  }
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
