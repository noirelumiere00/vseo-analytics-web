/**
 * Instagram ハッシュタグ検索順位スクレイパー（Puppeteer版）
 *
 * ログイン済みCookieを使用してInstagramにアクセスし、
 * ハッシュタグ検索のトップ投稿の順位を取得する。
 *
 * セットアップ手順:
 *   1. ブラウザでInstagramにログイン
 *   2. DevTools → Application → Cookies → instagram.com
 *   3. "sessionid" の値をコピー
 *   4. 環境変数に設定: INSTAGRAM_SESSION_ID=xxxxx
 */

import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { type Browser, type Page } from "puppeteer-core";
import * as fs from "fs";
import * as path from "path";

// Stealth プラグインを有効化
puppeteerExtra.use(StealthPlugin());

// ========================================
// Types
// ========================================

export interface InstagramPost {
  /** 取得順位（1始まり） */
  position: number;
  /** 投稿ID */
  postId: string;
  /** 投稿URL */
  postUrl: string;
  /** 投稿者ユーザー名 */
  username: string;
  /** キャプション（説明文） */
  caption: string;
  /** いいね数 */
  likeCount: number;
  /** コメント数 */
  commentCount: number;
  /** 再生数（リールの場合） */
  viewCount: number;
  /** サムネイルURL */
  thumbnailUrl: string;
  /** 投稿タイプ */
  type: "image" | "video" | "carousel" | "reel";
  /** 投稿日時（ISO string） */
  postedAt: string;
  /** リール/動画の長さ（秒） */
  duration: number;
  /** 投稿に含まれるハッシュタグ */
  hashtags: string[];
  /** 自社アカウントかどうか */
  isOwn: boolean;
}

export interface InstagramHashtagResult {
  /** 検索したハッシュタグ */
  hashtag: string;
  /** トップ投稿の順位リスト */
  topPosts: InstagramPost[];
  /** 取得した投稿数 */
  totalFetched: number;
  /** 取得日時 */
  fetchedAt: string;
  /** ハッシュタグの総投稿数（取得できた場合） */
  totalPostCount: number | null;
}

// ========================================
// Chrome Path Resolution
// ========================================

function findChromePath(): string {
  try {
    const puppeteerFull = require("puppeteer");
    const bundledPath = puppeteerFull.executablePath?.();
    if (bundledPath && fs.existsSync(bundledPath)) return bundledPath;
  } catch { /* skip */ }

  const cacheDir = path.join(process.cwd(), ".cache", "puppeteer", "chrome");
  if (fs.existsSync(cacheDir)) {
    try {
      const versions = fs.readdirSync(cacheDir).filter(d => d.startsWith("linux-"));
      for (const ver of versions.sort().reverse()) {
        const chromePath = path.join(cacheDir, ver, "chrome-linux64", "chrome");
        if (fs.existsSync(chromePath)) return chromePath;
      }
    } catch { /* skip */ }
  }

  const candidates = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/opt/google/chrome/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  throw new Error("[Instagram] Chrome binary not found");
}

// ========================================
// Retry Helper
// ========================================

async function withRetry<T>(fn: () => Promise<T>, retries = 2, delay = 2000): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === retries) throw e;
      console.log(`[Instagram] Retry ${i + 1}/${retries}...`);
      await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
  throw new Error("unreachable");
}

// ========================================
// Main Scraper
// ========================================

/**
 * Instagramハッシュタグのトップ投稿を順位付きで取得
 *
 * @param hashtag - 検索するハッシュタグ（#付きでも#なしでもOK）
 * @param maxPosts - 取得する最大投稿数（デフォルト: 30）
 * @param ownAccountIds - 自社アカウントのユーザー名リスト（順位チェック用）
 */
export async function searchInstagramHashtag(
  hashtag: string,
  maxPosts: number = 30,
  ownAccountIds: string[] = [],
): Promise<InstagramHashtagResult> {
  const sessionId = process.env.INSTAGRAM_SESSION_ID;
  if (!sessionId) {
    throw new Error(
      "[Instagram] INSTAGRAM_SESSION_ID環境変数が未設定。\n" +
      "取得方法: ブラウザでIG→DevTools→Application→Cookies→sessionidをコピー"
    );
  }

  const cleanTag = hashtag.replace(/^#/, "").trim();
  if (!cleanTag) throw new Error("[Instagram] ハッシュタグが空です");

  console.log(`[Instagram] Searching #${cleanTag} (max ${maxPosts})`);

  let browser: Browser | null = null;

  try {
    browser = await puppeteerExtra.launch({
      executablePath: findChromePath(),
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

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 900 });

    // ログインCookie設定
    await page.setCookie({
      name: "sessionid",
      value: sessionId,
      domain: ".instagram.com",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    });

    // Instagram内部APIレスポンスをキャプチャ
    let apiData: any = null;
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/api/v1/tags/") || url.includes("tag_name=")) {
        try {
          const json = await response.json();
          if (json?.data || json?.top || json?.sections) {
            apiData = json;
            console.log("[Instagram] API response captured");
          }
        } catch { /* non-JSON */ }
      }
    });

    // まずinstagram.comにアクセスしてcsrftokenを取得
    await withRetry(() => page.goto("https://www.instagram.com/", { waitUntil: "networkidle2", timeout: 30000 }));

    // ハッシュタグページにアクセス
    const hashtagUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(cleanTag)}/`;
    await withRetry(() => page.goto(hashtagUrl, { waitUntil: "networkidle2", timeout: 30000 }));

    // ログインチェック
    if (page.url().includes("/accounts/login")) {
      throw new Error("[Instagram] sessionidが無効/期限切れです。再取得してください。");
    }

    // 404チェック
    const html = await page.content();
    if (html.includes("Sorry, this page") || html.includes("ページが見つかりません")) {
      throw new Error(`[Instagram] #${cleanTag} が見つかりません`);
    }

    // API応答を待つ
    try {
      await page.waitForResponse(
        res => res.url().includes("/api/v1/tags/") && res.status() === 200,
        { timeout: 8000 }
      );
      await new Promise(r => setTimeout(r, 500)); // small buffer
    } catch { /* timeout = API not captured, will use DOM fallback */ }

    const ownSet = new Set(ownAccountIds.map(id => id.toLowerCase().replace(/^@/, "")));
    let posts: InstagramPost[] = [];

    if (apiData) {
      posts = parseApiResponse(apiData, ownSet);
    } else {
      console.log("[Instagram] API未キャプチャ。DOM解析にフォールバック...");
      posts = await scrapeDom(page, maxPosts, ownSet);
    }

    posts = posts.slice(0, maxPosts);
    posts.forEach((p, i) => { p.position = i + 1; });

    // 総投稿数を取得
    let totalPostCount: number | null = null;
    try {
      const countText = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll("span, header *"));
        for (const el of spans) {
          const text = el.textContent || "";
          const match = text.match(/([\d,]+)\s*件/);
          if (match) return match[1].replace(/,/g, "");
        }
        return null;
      });
      if (countText) totalPostCount = parseInt(countText, 10);
    } catch { /* ignore */ }

    const ownPosts = posts.filter(p => p.isOwn);
    if (ownPosts.length > 0) {
      console.log(`[Instagram] 自社順位: ${ownPosts.map(p => `@${p.username}→${p.position}位`).join(", ")}`);
    } else {
      console.log(`[Instagram] 自社アカウントはトップ${posts.length}件に未出現`);
    }

    return {
      hashtag: cleanTag,
      topPosts: posts,
      totalFetched: posts.length,
      fetchedAt: new Date().toISOString(),
      totalPostCount,
    };

  } finally {
    if (browser) await browser.close();
  }
}

// ========================================
// API Response Parser
// ========================================

function parseApiResponse(data: any, ownSet: Set<string>): InstagramPost[] {
  const mediaItems: any[] = [];

  // パターン1: data.top.sections[].layout_content.medias[]
  if (data?.data?.top?.sections) {
    for (const sec of data.data.top.sections) {
      for (const m of sec?.layout_content?.medias || []) {
        if (m?.media) mediaItems.push(m.media);
      }
    }
  }
  // パターン2: data.sections[]
  if (mediaItems.length === 0 && data?.sections) {
    for (const sec of data.sections) {
      for (const m of sec?.layout_content?.medias || []) {
        if (m?.media) mediaItems.push(m.media);
      }
    }
  }
  // パターン3: data.top_posts.edges[]
  if (mediaItems.length === 0 && data?.top_posts?.edges) {
    for (const edge of data.top_posts.edges) {
      if (edge?.node) mediaItems.push(edge.node);
    }
  }
  // パターン4: data.ranked[] or data.items[]
  if (mediaItems.length === 0) {
    if (data?.ranked) mediaItems.push(...data.ranked);
    if (data?.items) mediaItems.push(...data.items);
  }

  return mediaItems.map((item, i) => parseMediaItem(item, i + 1, ownSet)).filter(Boolean) as InstagramPost[];
}

function parseMediaItem(item: any, position: number, ownSet: Set<string>): InstagramPost | null {
  try {
    const username = item.user?.username || item.owner?.username || "";
    const code = item.code || item.shortcode || "";

    let caption = "";
    if (item.caption?.text) caption = item.caption.text;
    else if (item.edge_media_to_caption?.edges?.[0]?.node?.text) {
      caption = item.edge_media_to_caption.edges[0].node.text;
    }

    const hashtagMatches = caption.match(/#[\p{L}\p{N}_]+/gu) || [];

    let type: InstagramPost["type"] = "image";
    if (item.media_type === 2 || item.is_video) type = "video";
    if (item.media_type === 8 || item.edge_sidecar_to_children) type = "carousel";
    if (item.product_type === "clips" || item.product_type === "reels") type = "reel";

    const timestamp = item.taken_at || item.taken_at_timestamp || 0;

    return {
      position,
      postId: item.pk?.toString() || item.id?.toString() || code,
      postUrl: code ? `https://www.instagram.com/p/${code}/` : "",
      username,
      caption: caption.slice(0, 500),
      likeCount: item.like_count ?? item.edge_liked_by?.count ?? 0,
      commentCount: item.comment_count ?? item.edge_media_to_comment?.count ?? 0,
      viewCount: item.play_count ?? item.video_view_count ?? 0,
      thumbnailUrl: item.image_versions2?.candidates?.[0]?.url || item.thumbnail_src || item.display_url || "",
      type,
      postedAt: timestamp ? new Date(timestamp * 1000).toISOString() : "",
      duration: Math.round(item.video_duration || 0),
      hashtags: hashtagMatches.map((t: string) => t.replace(/^#/, "")),
      isOwn: ownSet.has(username.toLowerCase()),
    };
  } catch {
    return null;
  }
}

// ========================================
// DOM Scraping Fallback
// ========================================

async function scrapeDom(page: Page, maxPosts: number, ownSet: Set<string>): Promise<InstagramPost[]> {
  const postLinks = await page.evaluate((max: number) => {
    const links = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
    const seen = new Set<string>();
    const results: Array<{ href: string; imgSrc: string }> = [];
    for (const link of links) {
      const href = (link as HTMLAnchorElement).href;
      if (seen.has(href)) continue;
      seen.add(href);
      const img = link.querySelector("img");
      results.push({ href, imgSrc: img?.src || "" });
      if (results.length >= max) break;
    }
    return results;
  }, maxPosts);

  console.log(`[Instagram] DOM: ${postLinks.length}件の投稿リンクを検出`);

  const posts: InstagramPost[] = postLinks.map(({ href, imgSrc }, i) => {
    const match = href.match(/\/(p|reel)\/([^/]+)/);
    return {
      position: i + 1,
      postId: match?.[2] || "",
      postUrl: href,
      username: "",
      caption: "",
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      thumbnailUrl: imgSrc,
      type: (match?.[1] === "reel" ? "reel" : "image") as InstagramPost["type"],
      postedAt: "",
      duration: 0,
      hashtags: [],
      isOwn: false,
    };
  });

  // 上位投稿の詳細をAPI経由で取得
  const detailLimit = Math.min(posts.length, 30);
  for (let i = 0; i < detailLimit; i++) {
    const post = posts[i];
    if (!post.postId) continue;
    try {
      const detail = await page.evaluate(async (code: string) => {
        try {
          const res = await fetch(`https://www.instagram.com/api/v1/media/${code}/info/`, {
            credentials: "include",
            headers: {
              "X-CSRFToken": document.cookie.match(/csrftoken=([^;]+)/)?.[1] || "",
              "X-Instagram-AJAX": "1",
            }
          });
          if (!res.ok) return null;
          return await res.json();
        } catch { return null; }
      }, post.postId);

      if (detail?.items?.[0]) {
        const item = detail.items[0];
        post.username = item.user?.username || "";
        post.caption = (item.caption?.text || "").slice(0, 500);
        post.likeCount = item.like_count || 0;
        post.commentCount = item.comment_count || 0;
        post.viewCount = item.play_count || item.video_view_count || 0;
        post.thumbnailUrl = item.image_versions2?.candidates?.[0]?.url || post.thumbnailUrl;
        post.postedAt = item.taken_at ? new Date(item.taken_at * 1000).toISOString() : "";
        post.duration = Math.round(item.video_duration || 0);
        post.isOwn = ownSet.has(post.username.toLowerCase());
        if (item.product_type === "clips") post.type = "reel";
        else if (item.media_type === 2) post.type = "video";
        else if (item.media_type === 8) post.type = "carousel";
        const tags = post.caption.match(/#[\p{L}\p{N}_]+/gu) || [];
        post.hashtags = tags.map(t => t.replace(/^#/, ""));
      }

      if (i < detailLimit - 1) await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
    } catch { /* skip */ }
  }

  return posts;
}

// ========================================
// 複数ハッシュタグ一括検索
// ========================================

export async function searchInstagramHashtagBatch(
  hashtags: string[],
  ownAccountIds: string[] = [],
  maxPostsPerTag: number = 30,
): Promise<InstagramHashtagResult[]> {
  const results: InstagramHashtagResult[] = [];

  for (let i = 0; i < hashtags.length; i++) {
    console.log(`[Instagram] ${i + 1}/${hashtags.length}: #${hashtags[i]}`);
    try {
      results.push(await searchInstagramHashtag(hashtags[i], maxPostsPerTag, ownAccountIds));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      if (msg.includes("sessionid") || msg.includes("ログイン")) {
        console.error("[Instagram] Session expired, aborting batch");
        for (let j = i; j < hashtags.length; j++) {
          results.push({ hashtag: hashtags[j].replace(/^#/, ""), topPosts: [], totalFetched: 0, fetchedAt: new Date().toISOString(), totalPostCount: null });
        }
        break;
      }
      console.error(`[Instagram] #${hashtags[i]} failed:`, msg);
      results.push({
        hashtag: hashtags[i].replace(/^#/, ""),
        topPosts: [],
        totalFetched: 0,
        fetchedAt: new Date().toISOString(),
        totalPostCount: null,
      });
    }

    // BAN回避の待機
    if (i < hashtags.length - 1) {
      const wait = 3000 + Math.random() * 2000;
      await new Promise(r => setTimeout(r, wait));
    }
  }

  return results;
}
