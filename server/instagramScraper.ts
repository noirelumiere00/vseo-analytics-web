/**
 * Instagram Hashtag Ranking Scraper
 *
 * Captures top posts for a given hashtag in their exact display order,
 * using a logged-in session cookie to access Instagram's internal API.
 *
 * Architecture:
 *   1. Intercept Instagram's internal /api/v1/tags/ response (primary)
 *   2. Fall back to DOM link extraction + per-post API detail fetch
 *   3. Both paths produce the same InstagramPost[] output
 *
 * Setup:
 *   INSTAGRAM_SESSION_ID=<value from browser DevTools → Cookies → sessionid>
 */

import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { type Browser, type Page } from "puppeteer-core";
import * as fs from "fs";
import * as path from "path";

puppeteerExtra.use(StealthPlugin());

// ─── Types ───────────────────────────────────────────────────────────

export interface InstagramPost {
  position: number;
  postId: string;
  shortcode: string;
  postUrl: string;
  username: string;
  caption: string;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  thumbnailUrl: string;
  type: "image" | "video" | "carousel" | "reel";
  postedAt: string;
  duration: number;
  hashtags: string[];
  isOwn: boolean;
}

export interface InstagramHashtagResult {
  hashtag: string;
  topPosts: InstagramPost[];
  totalFetched: number;
  fetchedAt: string;
  totalPostCount: number | null;
  method: "api" | "dom";
}

// ─── Constants ───────────────────────────────────────────────────────

const SESSION_ERROR_PATTERNS = ["sessionid", "ログイン", "login required", "checkpoint_required"];
const HASHTAG_REGEX = /#[\p{L}\p{N}_]+/gu;
const INTER_REQUEST_DELAY = { min: 400, max: 900 };
const INTER_TAG_DELAY = { min: 3000, max: 5000 };
const API_WAIT_TIMEOUT = 8000;
const NAV_TIMEOUT = 30000;
const MAX_RETRIES = 2;
const DETAIL_FETCH_LIMIT = 30;

// ─── Chrome Discovery (shared with TikTok scraper) ──────────────────

function findChromePath(): string {
  try {
    const p = require("puppeteer");
    const bp = p.executablePath?.();
    if (bp && fs.existsSync(bp)) return bp;
  } catch {}

  const cache = path.join(process.cwd(), ".cache", "puppeteer", "chrome");
  if (fs.existsSync(cache)) {
    try {
      for (const v of fs.readdirSync(cache).filter(d => d.startsWith("linux-")).sort().reverse()) {
        const cp = path.join(cache, v, "chrome-linux64", "chrome");
        if (fs.existsSync(cp)) return cp;
      }
    } catch {}
  }

  for (const c of [
    "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome",
    "/opt/google/chrome/chrome", "/usr/bin/chromium",
    "/usr/bin/chromium-browser", "/snap/bin/chromium",
  ]) {
    if (fs.existsSync(c)) return c;
  }

  throw new Error("[IG] Chrome not found");
}

// ─── Utilities ───────────────────────────────────────────────────────

function randomDelay(range: { min: number; max: number }): Promise<void> {
  return new Promise(r => setTimeout(r, range.min + Math.random() * (range.max - range.min)));
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === MAX_RETRIES) throw e;
      const wait = 2000 * (attempt + 1);
      console.warn(`[IG] ${label} failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw new Error("unreachable");
}

function isSessionError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return SESSION_ERROR_PATTERNS.some(p => lower.includes(p));
}

function extractHashtags(text: string): string[] {
  return (text.match(HASHTAG_REGEX) || []).map(t => t.slice(1));
}

function safeErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "unknown error";
}

function validateSessionId(id: string): void {
  const trimmed = id.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null" || trimmed.length < 10) {
    throw new Error("[IG] INSTAGRAM_SESSION_ID is invalid (empty, too short, or literal 'undefined')");
  }
}

// ─── Browser Session ─────────────────────────────────────────────────

async function createSession(sessionId: string): Promise<{ browser: Browser; page: Page }> {
  const browser = await puppeteerExtra.launch({
    executablePath: findChromePath(),
    headless: true,
    args: [
      "--no-sandbox", "--disable-setuid-sandbox",
      "--disable-dev-shm-usage", "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1280,900", "--lang=ja-JP",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // Set session cookie before any navigation
  await page.setCookie({
    name: "sessionid",
    value: sessionId,
    domain: ".instagram.com",
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
  });

  // Warm up: navigate to instagram.com to acquire csrftoken and other cookies
  await withRetry(
    () => page.goto("https://www.instagram.com/", { waitUntil: "networkidle2", timeout: NAV_TIMEOUT }),
    "warmup navigation",
  );

  // Verify session is valid
  if (page.url().includes("/accounts/login") || page.url().includes("challenge")) {
    await browser.close();
    throw new Error("[IG] sessionidが無効/期限切れです。ブラウザから再取得してください。");
  }

  return { browser, page };
}

// ─── API Response Extraction ─────────────────────────────────────────

function extractMediaFromApi(data: unknown): any[] {
  const items: any[] = [];
  const d = data as any;
  if (!d) return items;

  // Instagram returns different structures depending on endpoint version.
  // We try all known patterns and merge results.
  const sectionSources = [
    d?.data?.top?.sections,
    d?.data?.recent?.sections,
    d?.sections,
  ];

  for (const sections of sectionSources) {
    if (!Array.isArray(sections)) continue;
    for (const sec of sections) {
      for (const m of sec?.layout_content?.medias || []) {
        if (m?.media) items.push(m.media);
      }
    }
    if (items.length > 0) return items; // Use first matching pattern
  }

  // GraphQL response pattern
  if (d?.top_posts?.edges) {
    return d.top_posts.edges.map((e: any) => e.node).filter(Boolean);
  }

  // Direct array patterns
  if (Array.isArray(d?.ranked)) return d.ranked;
  if (Array.isArray(d?.items)) return d.items;

  return items;
}

function parseMediaItem(item: any, ownSet: Set<string>): Omit<InstagramPost, "position"> | null {
  try {
    const username = item.user?.username || item.owner?.username || "";
    const shortcode = item.code || item.shortcode || "";

    let caption = item.caption?.text
      || item.edge_media_to_caption?.edges?.[0]?.node?.text
      || "";

    let type: InstagramPost["type"] = "image";
    if (item.product_type === "clips" || item.product_type === "reels") type = "reel";
    else if (item.media_type === 2 || item.is_video) type = "video";
    else if (item.media_type === 8 || item.edge_sidecar_to_children) type = "carousel";

    const timestamp = item.taken_at || item.taken_at_timestamp || 0;

    return {
      postId: String(item.pk || item.id || shortcode),
      shortcode,
      postUrl: shortcode ? `https://www.instagram.com/p/${shortcode}/` : "",
      username,
      caption: caption.slice(0, 500),
      likeCount: item.like_count ?? item.edge_liked_by?.count ?? 0,
      commentCount: item.comment_count ?? item.edge_media_to_comment?.count ?? 0,
      viewCount: item.play_count ?? item.video_view_count ?? 0,
      thumbnailUrl: item.image_versions2?.candidates?.[0]?.url || item.thumbnail_src || item.display_url || "",
      type,
      postedAt: timestamp ? new Date(timestamp * 1000).toISOString() : "",
      duration: Math.round(item.video_duration || 0),
      hashtags: extractHashtags(caption),
      isOwn: ownSet.has(username.toLowerCase()),
    };
  } catch {
    return null;
  }
}

// ─── DOM Scraping (fallback) ─────────────────────────────────────────

async function extractPostLinksFromDom(page: Page, maxPosts: number): Promise<Array<{ href: string; imgSrc: string }>> {
  return page.evaluate((max: number) => {
    const seen = new Set<string>();
    const results: Array<{ href: string; imgSrc: string }> = [];
    for (const link of document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')) {
      const href = (link as HTMLAnchorElement).href;
      if (seen.has(href)) continue;
      seen.add(href);
      results.push({ href, imgSrc: link.querySelector("img")?.src || "" });
      if (results.length >= max) break;
    }
    return results;
  }, maxPosts);
}

async function fetchPostDetail(page: Page, shortcode: string): Promise<any | null> {
  return page.evaluate(async (code: string) => {
    try {
      const csrfToken = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || "";
      const res = await fetch(`https://www.instagram.com/api/v1/media/${code}/info/`, {
        credentials: "include",
        headers: {
          "X-CSRFToken": csrfToken,
          "X-Instagram-AJAX": "1",
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }, shortcode);
}

async function enrichPostsFromDom(
  page: Page,
  links: Array<{ href: string; imgSrc: string }>,
  ownSet: Set<string>,
): Promise<InstagramPost[]> {
  const posts: InstagramPost[] = links.map(({ href, imgSrc }, i) => {
    const match = href.match(/\/(p|reel)\/([^/]+)/);
    return {
      position: i + 1,
      postId: "",
      shortcode: match?.[2] || "",
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

  const limit = Math.min(posts.length, DETAIL_FETCH_LIMIT);
  console.log(`[IG] Enriching ${limit} posts with API details...`);

  for (let i = 0; i < limit; i++) {
    const post = posts[i];
    if (!post.shortcode) continue;

    try {
      const detail = await fetchPostDetail(page, post.shortcode);
      const item = detail?.items?.[0];
      if (item) {
        const parsed = parseMediaItem(item, ownSet);
        if (parsed) Object.assign(post, parsed);
      }
    } catch {}

    if (i < limit - 1) await randomDelay(INTER_REQUEST_DELAY);
  }

  return posts;
}

// ─── Total Post Count Extraction ─────────────────────────────────────

async function extractTotalPostCount(page: Page): Promise<number | null> {
  try {
    const text = await page.evaluate(() => {
      for (const el of document.querySelectorAll("span, header *")) {
        const m = (el.textContent || "").match(/([\d,]+)\s*件/);
        if (m) return m[1].replace(/,/g, "");
      }
      return null;
    });
    return text ? parseInt(text, 10) : null;
  } catch {
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────

export async function searchInstagramHashtag(
  hashtag: string,
  maxPosts: number = 30,
  ownAccountIds: string[] = [],
): Promise<InstagramHashtagResult> {
  const sessionId = process.env.INSTAGRAM_SESSION_ID ?? "";
  validateSessionId(sessionId);

  const cleanTag = hashtag.replace(/^#/, "").trim();
  if (!cleanTag) throw new Error("[IG] Empty hashtag");

  console.log(`[IG] #${cleanTag} (max ${maxPosts})`);

  let browser: Browser | null = null;

  try {
    const session = await createSession(sessionId);
    browser = session.browser;
    const page = session.page;

    // Set up API response interception
    let capturedApiData: unknown = null;
    const targetUrlFragment = `/api/v1/tags/${encodeURIComponent(cleanTag).toLowerCase()}`;

    page.on("response", async (res) => {
      const url = res.url().toLowerCase();
      if (!url.includes("/api/v1/tags/") && !url.includes("tag_name=")) return;
      try {
        const json = await res.json();
        if (json?.data || json?.top || json?.sections) {
          capturedApiData = json;
        }
      } catch {}
    });

    // Navigate to hashtag page
    const hashtagUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(cleanTag)}/`;
    await withRetry(() => page.goto(hashtagUrl, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT }), "hashtag page");

    // Validate page loaded correctly
    if (page.url().includes("/accounts/login") || page.url().includes("challenge")) {
      throw new Error("[IG] sessionidが無効/期限切れです。再取得してください。");
    }

    const html = await page.content();
    if (html.includes("Sorry, this page") || html.includes("ページが見つかりません")) {
      throw new Error(`[IG] #${cleanTag} not found`);
    }

    // Wait for API response
    try {
      await page.waitForResponse(
        r => r.url().includes("/api/v1/tags/") && r.status() === 200,
        { timeout: API_WAIT_TIMEOUT },
      );
      await new Promise(r => setTimeout(r, 300));
    } catch {}

    // Parse results
    const ownSet = new Set(ownAccountIds.map(id => id.toLowerCase().replace(/^@/, "")));
    let posts: InstagramPost[];
    let method: "api" | "dom";

    const mediaItems = extractMediaFromApi(capturedApiData);

    if (mediaItems.length > 0) {
      method = "api";
      posts = mediaItems
        .map(item => parseMediaItem(item, ownSet))
        .filter((p): p is Omit<InstagramPost, "position"> => p !== null)
        .slice(0, maxPosts)
        .map((p, i) => ({ ...p, position: i + 1 }));
    } else {
      method = "dom";
      console.log("[IG] API not captured, falling back to DOM");
      const links = await extractPostLinksFromDom(page, maxPosts);
      posts = await enrichPostsFromDom(page, links, ownSet);
      posts = posts.slice(0, maxPosts);
      posts.forEach((p, i) => { p.position = i + 1; });
    }

    const totalPostCount = await extractTotalPostCount(page);

    // Log own account positions
    const ownPosts = posts.filter(p => p.isOwn);
    console.log(
      ownPosts.length > 0
        ? `[IG] Own: ${ownPosts.map(p => `@${p.username}→${p.position}位`).join(", ")}`
        : `[IG] Own accounts not in top ${posts.length}`,
    );

    return {
      hashtag: cleanTag,
      topPosts: posts,
      totalFetched: posts.length,
      fetchedAt: new Date().toISOString(),
      totalPostCount,
      method,
    };

  } finally {
    if (browser) await browser.close();
  }
}

export async function searchInstagramHashtagBatch(
  hashtags: string[],
  ownAccountIds: string[] = [],
  maxPostsPerTag: number = 30,
): Promise<InstagramHashtagResult[]> {
  const results: InstagramHashtagResult[] = [];
  const emptyResult = (tag: string): InstagramHashtagResult => ({
    hashtag: tag.replace(/^#/, ""),
    topPosts: [],
    totalFetched: 0,
    fetchedAt: new Date().toISOString(),
    totalPostCount: null,
    method: "dom",
  });

  for (let i = 0; i < hashtags.length; i++) {
    const tag = hashtags[i];
    console.log(`[IG] Batch ${i + 1}/${hashtags.length}: #${tag}`);

    try {
      results.push(await searchInstagramHashtag(tag, maxPostsPerTag, ownAccountIds));
    } catch (e) {
      const msg = safeErrorMessage(e);

      if (isSessionError(msg)) {
        console.error("[IG] Session expired — aborting remaining hashtags");
        for (let j = i; j < hashtags.length; j++) results.push(emptyResult(hashtags[j]));
        break;
      }

      console.error(`[IG] #${tag} failed: ${msg}`);
      results.push(emptyResult(tag));
    }

    if (i < hashtags.length - 1) await randomDelay(INTER_TAG_DELAY);
  }

  return results;
}
