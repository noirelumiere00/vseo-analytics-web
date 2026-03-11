/**
 * キャンペーンスナップショット取得ロジック
 * 既存のPuppeteerスクレイパーを再利用して、キャンペーンのベースライン/効果測定データを収集
 */

import { searchTikTokVideos, type TikTokVideo } from "./tiktokScraper";
import { storagePut } from "./storage";
import puppeteer from "puppeteer-core";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
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

  // ============================
  // A. KW別の検索結果（自社+競合+全体）
  // ============================
  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    report("search", `KW検索: ${kw} (${i + 1}/${keywords.length})`, Math.round((i / keywords.length) * 40));

    let videos: TikTokVideo[];
    try {
      const result = await searchTikTokVideos(kw, 30);
      videos = result.videos;
    } catch (e) {
      console.error(`Search failed for "${kw}":`, e);
      videos = [];
    }

    // 全動画を正規化
    const allVideos = videos.map((v, idx) => normalizeVideo(v, idx + 1));

    // 自社動画のポジション
    const ownVideos: NormalizedVideoWithER[] = allVideos
      .filter(v => ownAccountIds.includes(v.creator_username))
      .map(v => ({ ...v, er: calcER(v) }));

    // 競合のポジション
    const competitorPositions = competitors.map(comp => {
      const compVideos = allVideos.filter(v => v.creator_username === comp.account_id);
      return {
        competitor_name: comp.name,
        competitor_id: comp.account_id,
        best_rank: compVideos.length > 0 ? Math.min(...compVideos.map(v => v.search_rank)) : null,
        video_count_in_top30: compVideos.length,
      };
    });

    // シェア・オブ・ボイス
    const ownCountInResults = allVideos.filter(v => ownAccountIds.includes(v.creator_username)).length;

    // スクリーンショット取得
    let screenshotKey: string | null = null;
    try {
      screenshotKey = await captureSearchScreenshot(kw, campaign.id, snapshotType);
    } catch (e) {
      console.error(`Screenshot failed for "${kw}":`, e);
    }

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
      screenshot_key: screenshotKey,
    };

    await sleep(3000 + Math.random() * 2000);
  }

  // ============================
  // B. 競合のプロフィール（投稿頻度比較用）
  // ============================
  report("profiles", `競合プロフィール取得中...`, 45);

  for (let i = 0; i < competitors.length; i++) {
    const comp = competitors[i];
    report("profiles", `プロフィール取得: ${comp.name} (${i + 1}/${competitors.length})`, 45 + Math.round((i / competitors.length) * 15));

    try {
      const profile = await scrapeProfile(comp.account_id);
      competitorProfiles[comp.account_id] = {
        name: comp.name,
        follower_count: profile.followerCount,
        video_count: profile.videoCount,
        recent_post_dates: profile.recentPostDates,
      };
    } catch (e) {
      console.error(`Profile scrape failed for ${comp.account_id}:`, e);
    }

    await sleep(2000);
  }

  // ============================
  // C. 波及効果データ（キャンペーン#の投稿状況）
  // ============================
  report("ripple", `波及効果データ取得中...`, 65);

  for (let i = 0; i < campaignHashtags.length; i++) {
    const tag = campaignHashtags[i];
    report("ripple", `ハッシュタグ検索: ${tag} (${i + 1}/${campaignHashtags.length})`, 65 + Math.round((i / campaignHashtags.length) * 25));

    let videos: TikTokVideo[];
    try {
      const result = await searchTikTokVideos(tag, 30);
      videos = result.videos;
    } catch (e) {
      console.error(`Hashtag search failed for "${tag}":`, e);
      videos = [];
    }

    const allNormalized = videos.map((v, idx) => normalizeVideo(v, idx + 1));

    // 自社動画を除外した「他者の投稿」
    const otherVideos = allNormalized.filter(v =>
      !ownAccountIds.includes(v.creator_username) &&
      !ownVideoIds.includes(v.video_id)
    );

    // オマージュ検出
    const omaageVideos = otherVideos.filter(v =>
      detectOmaage(v, campaign, snapshotType)
    );

    rippleEffect[tag] = {
      total_post_count: allNormalized.length,
      other_post_count: otherVideos.length,
      other_total_views: otherVideos.reduce((sum, v) => sum + (v.view_count || 0), 0),
      other_avg_views: otherVideos.length > 0
        ? Math.round(otherVideos.reduce((sum, v) => sum + (v.view_count || 0), 0) / otherVideos.length)
        : 0,
      omaage_videos: omaageVideos.map(v => ({
        video_url: v.video_url,
        creator: v.creator_username,
        views: v.view_count,
        likes: v.like_count,
        description: v.description,
        hashtags: v.hashtags,
        posted_at: v.created_at,
      })),
    };

    await sleep(3000 + Math.random() * 2000);
  }

  report("complete", "スナップショット取得完了", 100);

  return {
    campaignId: campaign.id,
    snapshotType,
    status: "completed",
    searchResults,
    competitorProfiles,
    rippleEffect,
    capturedAt: new Date(),
  };
}

// =============================
// Screenshot capture
// =============================

async function captureSearchScreenshot(
  keyword: string,
  campaignId: number,
  snapshotType: string,
): Promise<string | null> {
  const chromiumPath = findChromiumPath();
  const browser = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1280,900",
      "--lang=ja-JP",
    ],
  });

  try {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    );

    const url = `https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`;
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // 検索結果のロードを待つ
    try {
      await page.waitForSelector('[data-e2e="search_top-item"], [data-e2e="search-card-desc"]', { timeout: 15000 });
    } catch {
      // セレクタが見つからなくてもスクショは試みる
    }

    await page.evaluate(() => window.scrollBy(0, 300));
    await new Promise(r => setTimeout(r, 2000));

    const screenshotBuffer = await page.screenshot({ fullPage: false });
    await context.close();

    // StorageにアップロードDue
    const safeKw = keyword.replace(/[^a-zA-Z0-9\u3040-\u9FFF]/g, "_");
    const filename = `${snapshotType}_${safeKw}_${Date.now()}.png`;
    const storageKey = `campaigns/${campaignId}/screenshots/${filename}`;

    try {
      await storagePut(storageKey, Buffer.from(screenshotBuffer), "image/png");
      return storageKey;
    } catch (e) {
      console.error(`Screenshot upload failed:`, e);
      // ローカルフォールバック
      const dir = `/tmp/screenshots/campaigns/${campaignId}`;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), screenshotBuffer);
      return `local:${dir}/${filename}`;
    }
  } finally {
    await browser.close();
  }
}

// =============================
// Profile scraper
// =============================

interface ProfileData {
  followerCount: number;
  videoCount: number;
  recentPostDates: string[];
}

async function scrapeProfile(accountId: string): Promise<ProfileData> {
  const chromiumPath = findChromiumPath();
  const browser = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1280,900",
      "--lang=ja-JP",
    ],
  });

  try {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    );

    // TikTokプロフィールページからSSRデータを取得
    const profileUrl = `https://www.tiktok.com/@${accountId}`;
    await page.goto(profileUrl, { waitUntil: "networkidle2", timeout: 30000 });

    const data = await page.evaluate(() => {
      const ssrData = (window as any).__UNIVERSAL_DATA_FOR_REHYDRATION__;
      if (!ssrData) return null;
      const defaultScope = ssrData.__DEFAULT_SCOPE__;
      if (!defaultScope) return null;
      const userDetail = defaultScope["webapp.user-detail"];
      if (!userDetail) return null;
      return userDetail;
    });

    let followerCount = 0;
    let videoCount = 0;
    const recentPostDates: string[] = [];

    if (data?.userInfo?.stats) {
      followerCount = data.userInfo.stats.followerCount || 0;
      videoCount = data.userInfo.stats.videoCount || 0;
    }

    // 直近の動画の投稿日時をページから取得
    if (data?.userInfo?.user?.id) {
      // itemListに直近動画のcreateTimeが含まれている場合
      const items = defaultScopeItems(data);
      for (const item of items.slice(0, 10)) {
        if (item.createTime) {
          recentPostDates.push(new Date(item.createTime * 1000).toISOString());
        }
      }
    }

    await context.close();

    return { followerCount, videoCount, recentPostDates };
  } finally {
    await browser.close();
  }
}

function defaultScopeItems(data: any): any[] {
  try {
    const itemModule = data?.__DEFAULT_SCOPE__?.["webapp.user-detail"]?.itemList;
    if (Array.isArray(itemModule)) return itemModule;

    // 別のパスを試す
    const videoList = data?.itemList;
    if (Array.isArray(videoList)) return videoList;

    return [];
  } catch {
    return [];
  }
}

// =============================
// Omaage detection
// =============================

function detectOmaage(
  video: NormalizedVideo,
  campaign: Campaign,
  snapshotType: string,
): boolean {
  const videoTags = (video.hashtags || []).map(t => t.toLowerCase());
  const campaignTags = (campaign.campaignHashtags || []).map(t => t.toLowerCase().replace(/^#/, ""));

  // 条件1: キャンペーン#を2つ以上使用
  const matchingTags = videoTags.filter(t => campaignTags.includes(t.replace(/^#/, "")));
  if (matchingTags.length >= 2) return true;

  // 条件2: 説明文にブランド名/商品名が含まれる
  const brandKeywords = campaign.brandKeywords || [];
  if (brandKeywords.length > 0) {
    const desc = (video.description || "").toLowerCase();
    if (brandKeywords.some(bk => desc.includes(bk.toLowerCase()))) return true;
  }

  // 条件3: キャンペーン#を1つ以上使用（measurementスナップショット時のみ）
  if (snapshotType === "measurement" && matchingTags.length >= 1) {
    return true;
  }

  return false;
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
