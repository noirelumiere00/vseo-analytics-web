/**
 * Instagram スクレイパー（Apify経由 + Puppeteerハッシュタグ検索）
 * apify~instagram-scraper を使用して投稿データを取得
 * searchInstagramHashtag: explore/tags ページをPuppeteerでスクレイプし検索順位を取得
 */

import { ENV } from "./_core/env";
import puppeteer, { type Page } from "puppeteer-core";
import { findChromiumPath, buildChromiumArgs } from "./tiktokScraper";

export interface InstagramPostData {
  videoId: string;
  videoUrl: string;
  coverUrl: string;
  caption: string;
  viewCount: number;
  /** 3秒以上視聴数（videoViewCount）— 有効再生数 */
  threeSecViewCount: number;
  likeCount: number;
  commentCount: number;
  publishedAt: string;
  ownerUsername: string;
  musicInfo?: { title: string; artistName: string } | null;
  metricsReliable?: boolean;
}

/** Apify実行のステータスを待機してポーリング */
async function waitForApifyRun(runId: string, token: string, maxWaitMs: number = 300_000): Promise<string> {
  const start = Date.now();
  const POLL_INTERVAL = 10_000;
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
    if (!res.ok) {
      console.warn(`[Instagram] Apify poll failed: HTTP ${res.status}`);
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }
    const data = (await res.json()) as any;
    const status = data?.data?.status;
    if (status === "SUCCEEDED" || status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      return status;
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
  return "POLL_TIMEOUT";
}

/** Apifyレスポンスアイテムを InstagramPostData に変換 */
function parseInstagramItem(item: any): InstagramPostData {
  const shortcode = item.shortCode || item.id || "";
  const postUrl = item.url || (shortcode ? `https://www.instagram.com/p/${shortcode}` : "");
  const rawMusic = item.musicInfo || item.music;
  const musicInfo = rawMusic
    ? { title: rawMusic.title || rawMusic.music_title || "", artistName: rawMusic.artistName || rawMusic.music_author || rawMusic.artist_name || "" }
    : null;

  // videoPlayCount と videoViewCount のどちらか大きい方を採用
  // Apifyのバージョンにより返されるフィールドが異なるため安定化
  const viewCount = Math.max(item.videoPlayCount || 0, item.videoViewCount || 0);
  const likesCount = (item.likesCount != null && item.likesCount >= 0) ? item.likesCount : 0;
  const commentsCount = item.commentsCount || 0;

  return {
    videoId: shortcode,
    videoUrl: postUrl,
    coverUrl: item.displayUrl || item.thumbnailUrl || "",
    caption: item.caption || "",
    viewCount,
    threeSecViewCount: item.videoViewCount || 0,
    likeCount: likesCount,
    commentCount: commentsCount,
    publishedAt: item.timestamp || "",
    ownerUsername: item.ownerUsername || "",
    musicInfo: musicInfo && (musicInfo.title || musicInfo.artistName) ? musicInfo : null,
    metricsReliable: !(viewCount > 100 && likesCount === 0 && commentsCount === 0),
  };
}

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

    if (!res.ok) {
      console.error(`[Instagram] Apify run request failed: HTTP ${res.status}`);
      return results;
    }
    const runData = await res.json() as any;
    const runId = runData?.data?.id;
    const datasetId = runData?.data?.defaultDatasetId;
    if (!datasetId) {
      console.error("[Instagram] Apify run failed:", runData?.data?.status);
      return results;
    }

    // 実行ステータスを確認 — RUNNING中なら完了までポーリング待機
    const runStatus = runData?.data?.status;
    if (runStatus && runStatus !== "SUCCEEDED") {
      if (runStatus === "RUNNING" && runId) {
        console.log(`[Instagram] Apify run still RUNNING, polling for completion...`);
        const finalStatus = await waitForApifyRun(runId, token, 120_000);
        if (finalStatus !== "SUCCEEDED") {
          console.warn(`[Instagram] Apify run finished with status: ${finalStatus} (may have partial results)`);
        }
      } else {
        console.warn(`[Instagram] Apify run status: ${runStatus}`);
      }
    }

    // データセットから結果取得
    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&limit=200`,
    );
    if (!itemsRes.ok) {
      console.error(`[Instagram] Dataset fetch failed: HTTP ${itemsRes.status}`);
      return results;
    }
    const itemsRaw = await itemsRes.json();
    const items: any[] = Array.isArray(itemsRaw) ? itemsRaw : [];

    for (const item of items) {
      results.push(parseInstagramItem(item));
    }

    // 未取得URLを検出してログ出力
    const fetchedUrls = new Set(results.map(r => r.videoUrl));
    const missingUrls = urls.filter(u => !fetchedUrls.has(u) && !results.some(r => u.includes(r.videoId)));
    if (missingUrls.length > 0) {
      console.warn(`[Instagram] ${missingUrls.length}/${urls.length} posts not returned by Apify (input URLs missing from results)`);
    }

    console.log(`[Instagram] Apify scraped ${results.length}/${urls.length} posts`);
  } catch (e) {
    console.error("[Instagram] Apify scrape failed:", e);
  }

  return results;
}

// ============================
// Instagram ハッシュタグ検索順位スクレイパー
// ============================

export interface InstagramHashtagPost {
  position: number;
  shortcode: string;
  username: string;
  type: "reel" | "image" | "video" | "carousel";
  likeCount: number;
  commentCount: number;
  viewCount: number;
  caption: string;
  coverUrl: string;
  postUrl: string;
  isOwn: boolean;
}

export interface InstagramHashtagResult {
  hashtag: string;
  totalFetched: number;
  method: "puppeteer" | "apify";
  topPosts: InstagramHashtagPost[];
  ownRanks: number[];
}

/**
 * Instagram explore/tags/{hashtag} ページをPuppeteerでスクレイプし、
 * 検索上位の投稿データとランキング位置を取得する。
 *
 * sessionid Cookieが必要（INSTAGRAM_SESSION_ID env var）。
 * sessionidが未設定の場合は Apify フォールバックを試行。
 */
export async function searchInstagramHashtag(
  hashtag: string,
  maxResults: number = 30,
  ownAccountNames: string[] = [],
): Promise<InstagramHashtagResult> {
  const ownNamesLower = new Set(ownAccountNames.map(n => n.toLowerCase().replace(/^@/, "")));
  const tag = hashtag.replace(/^#/, "").trim();

  // Puppeteer方式を試行
  const sessionId = process.env.INSTAGRAM_SESSION_ID;
  if (sessionId) {
    try {
      const result = await scrapeHashtagWithPuppeteer(tag, maxResults, ownNamesLower);
      if (result.topPosts.length > 0) {
        console.log(`[Instagram Hashtag] Puppeteer: #${tag} → ${result.topPosts.length} posts`);
        return result;
      }
      console.warn(`[Instagram Hashtag] Puppeteer returned 0 posts for #${tag}, trying Apify fallback`);
    } catch (e) {
      console.error(`[Instagram Hashtag] Puppeteer failed for #${tag}:`, e);
    }
  } else {
    console.log(`[Instagram Hashtag] INSTAGRAM_SESSION_ID not set, using Apify`);
  }

  // Apify フォールバック
  return scrapeHashtagWithApify(tag, maxResults, ownNamesLower);
}

/**
 * Puppeteerで https://www.instagram.com/explore/tags/{tag}/ をスクレイプ
 */
async function scrapeHashtagWithPuppeteer(
  tag: string,
  maxResults: number,
  ownNamesLower: Set<string>,
): Promise<InstagramHashtagResult> {
  const sessionId = process.env.INSTAGRAM_SESSION_ID!;
  const chromiumPath = findChromiumPath();
  const browser = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: true,
    args: buildChromiumArgs(),
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    );

    // sessionid Cookieを設定
    await page.setCookie({
      name: "sessionid",
      value: sessionId,
      domain: ".instagram.com",
      path: "/",
      httpOnly: true,
      secure: true,
    });

    // GraphQL / REST APIレスポンスをインターセプト
    const capturedData: any[] = [];
    page.on("response", async (response) => {
      const url = response.url();
      // Instagram GraphQL + REST API endpoints
      if (
        url.includes("/graphql/query") ||
        url.includes("/api/graphql") ||
        url.includes("/api/v1/tags/") ||
        url.includes("/fbsearch/") ||
        url.includes("/api/v1/explore/")
      ) {
        try {
          const text = await response.text();
          if (!text || text.startsWith("<")) return;
          const json = JSON.parse(text);
          // キャプチャ対象: ハッシュタグ関連データを含むレスポンス
          capturedData.push(json);
        } catch { /* non-JSON response */ }
      }
    });

    // explore/tags ページに遷移
    const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
    console.log(`[Instagram Hashtag] Navigating to ${url}`);

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    // sessionid期限切れ検出: ログインページへリダイレクトされた場合
    const currentUrl = page.url();
    if (currentUrl.includes("/accounts/login") || currentUrl.includes("/challenge/")) {
      console.error("[Instagram Hashtag] Session expired — redirected to login/challenge page");
      return {
        hashtag: tag,
        totalFetched: 0,
        method: "puppeteer",
        topPosts: [],
        ownRanks: [],
      };
    }

    // 1. まずGraphQLインターセプトデータからパース
    let posts = parseGraphQLData(capturedData, ownNamesLower);

    // 2. フォールバック: ページHTMLから __NEXT_DATA__ / additionalData をパース
    if (posts.length === 0) {
      const pageData = await page.evaluate(() => {
        // __NEXT_DATA__
        const nextDataEl = document.querySelector('script#__NEXT_DATA__');
        if (nextDataEl?.textContent) {
          try { return JSON.parse(nextDataEl.textContent); } catch {}
        }
        // window.__additionalDataLoaded
        const scripts = Array.from(document.querySelectorAll("script"));
        for (const s of scripts) {
          const text = s.textContent || "";
          if (text.includes("edge_hashtag_to_media") || text.includes("edge_hashtag_to_top_posts")) {
            const match = text.match(/\{[^]*edge_hashtag_to_(?:media|top_posts)[^]*\}/);
            if (match) {
              try { return JSON.parse(match[0]); } catch {}
            }
          }
        }
        return null;
      });

      if (pageData) {
        capturedData.push(pageData);
        posts = parseGraphQLData(capturedData, ownNamesLower);
      }
    }

    // 3. フォールバック: DOMから直接パース
    if (posts.length === 0) {
      posts = await parseDOMPosts(page, ownNamesLower);
    }

    // スクロールで追加データ取得（maxResults未達の場合）
    if (posts.length < maxResults && posts.length > 0) {
      const maxScrolls = 10;
      let noProgressCount = 0;
      for (let scroll = 0; scroll < maxScrolls && posts.length < maxResults; scroll++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise(r => setTimeout(r, 2500));
        const domPosts = await parseDOMPosts(page, ownNamesLower);
        const newPosts = parseGraphQLData(capturedData, ownNamesLower);
        // GraphQL + DOM の両方からマージ
        const merged = [...newPosts];
        const seenCodes = new Set(merged.map(p => p.shortcode));
        for (const dp of domPosts) {
          if (!seenCodes.has(dp.shortcode)) {
            merged.push(dp);
            seenCodes.add(dp.shortcode);
          }
        }
        if (merged.length > posts.length) {
          posts = merged;
          noProgressCount = 0;
          console.log(`[Instagram Hashtag] Scroll ${scroll + 1}: ${posts.length} posts (${posts.filter(p => p.type === "reel").length} reels)`);
        } else {
          noProgressCount++;
          if (noProgressCount >= 2) break;
        }
      }
    }

    // 全タイプ混合ランキング（Instagramの実際の表示順を維持）
    const allPosts = posts
      .slice(0, maxResults)
      .map((p, i) => ({ ...p, position: i + 1 }));
    const ownRanks = allPosts.filter(p => p.isOwn).map(p => p.position);
    const typeBreakdown = {
      reel: allPosts.filter(p => p.type === "reel").length,
      image: allPosts.filter(p => p.type === "image").length,
      carousel: allPosts.filter(p => p.type === "carousel").length,
      video: allPosts.filter(p => p.type === "video").length,
    };
    console.log(`[Instagram Hashtag] #${tag}: ${posts.length} total → ${allPosts.length} posts (reel:${typeBreakdown.reel} image:${typeBreakdown.image} carousel:${typeBreakdown.carousel})`);

    return {
      hashtag: tag,
      totalFetched: allPosts.length,
      method: "puppeteer",
      topPosts: allPosts,
      ownRanks,
    };
  } finally {
    await browser.close();
  }
}

/** GraphQL/RESTキャプチャデータからポスト一覧を抽出 */
function parseGraphQLData(
  capturedData: any[],
  ownNamesLower: Set<string>,
): InstagramHashtagPost[] {
  const posts: InstagramHashtagPost[] = [];
  const seen = new Set<string>();

  /** メディアオブジェクトを統一フォーマットでpushする共通ヘルパー */
  function pushMedia(media: any) {
    const code = media.code || media.shortcode || String(media.pk || media.id || "");
    if (!code || seen.has(code)) return;
    seen.add(code);

    const username = media.user?.username || media.owner?.username || "";
    const mediaType = media.media_type ?? (media.is_video ? 2 : 1);
    const productType = media.product_type || "";
    const typename = media.__typename || "";
    // media_type: 1=image, 2=video, 8=carousel
    // product_type: "clips"=reel, "feed"/"igtv"=video
    // __typename: GraphQLSidecar=carousel, GraphQLVideo=video/reel, GraphQLImage=image
    const type: InstagramHashtagPost["type"] =
      mediaType === 8 || typename === "GraphQLSidecar" ? "carousel" :
      mediaType === 2 || typename === "GraphQLVideo" || media.is_video === true
        ? (productType === "clips" || productType === "reels" ? "reel" : "video")
        : "image";
    posts.push({
      position: posts.length + 1,
      shortcode: code,
      username,
      type,
      likeCount: media.like_count || media.edge_liked_by?.count || 0,
      commentCount: media.comment_count || media.edge_media_to_comment?.count || 0,
      viewCount: type === "image" || type === "carousel"
        ? 0
        : (media.play_count || media.view_count || media.video_view_count || 0),
      caption: media.caption?.text || media.edge_media_to_caption?.edges?.[0]?.node?.text || "",
      coverUrl: media.image_versions2?.candidates?.[0]?.url || media.thumbnail_src || media.display_url || "",
      postUrl: `https://www.instagram.com/p/${code}/`,
      isOwn: ownNamesLower.has(username.toLowerCase()),
    });
  }

  for (const data of capturedData) {
    // 再帰的に全データ構造を走査してメディアを抽出
    extractMediasRecursive(data, pushMedia);

    // GraphQL v1 API形式 (ranked_items / recent_items)
    const sections = data?.sections || data?.data?.sections;
    if (sections && Array.isArray(sections)) {
      for (const section of sections) {
        const medias = section?.layout_content?.medias || [];
        for (const m of medias) {
          if (m?.media) pushMedia(m.media);
        }
      }
    }

    // GraphQL classic形式 (edge_hashtag_to_top_posts / edge_hashtag_to_media)
    const hashtag = data?.data?.hashtag || data?.graphql?.hashtag || data?.hashtag;
    if (hashtag) {
      const edges = [
        ...(hashtag.edge_hashtag_to_top_posts?.edges || []),
        ...(hashtag.edge_hashtag_to_media?.edges || []),
      ];
      for (const edge of edges) {
        if (edge?.node) pushMedia(edge.node);
      }
    }

    // fbsearch/web/top_serp 形式（新explore/search/keyword）
    const informUnits = data?.media_grid?.sections ||
      data?.data?.xdt_api__v1__fbsearch__web__top_serp_?.media_grid?.sections;
    if (informUnits && Array.isArray(informUnits)) {
      for (const section of informUnits) {
        const medias = section?.layout_content?.medias || [];
        for (const m of medias) {
          if (m?.media) pushMedia(m.media);
        }
      }
    }
  }

  return posts;
}

/** 深いネストされたJSON構造からmediaオブジェクトを再帰的に探す */
function extractMediasRecursive(obj: any, pushMedia: (m: any) => void, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 8) return;
  // mediaオブジェクト判定: code + (media_type or is_video) が存在
  if (obj.code && (obj.media_type != null || obj.is_video != null) && (obj.user || obj.owner)) {
    pushMedia(obj);
    return;
  }
  // nodeオブジェクト（GraphQL edge形式）
  if (obj.shortcode && (obj.is_video != null || obj.__typename)) {
    pushMedia(obj);
    return;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) extractMediasRecursive(item, pushMedia, depth + 1);
  } else {
    for (const key of Object.keys(obj)) {
      if (key === "user" || key === "owner" || key === "caption") continue; // 循環参照回避
      extractMediasRecursive(obj[key], pushMedia, depth + 1);
    }
  }
}

/** DOM直接パース（フォールバック） */
async function parseDOMPosts(
  page: Page,
  ownNamesLower: Set<string>,
): Promise<InstagramHashtagPost[]> {
  const posts: InstagramHashtagPost[] = [];

  try {
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
      return anchors.map((a: any, i: number) => {
        const href = a.getAttribute("href") || "";
        const match = href.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
        const img = a.querySelector("img");
        return {
          shortcode: match ? match[1] : "",
          href,
          coverUrl: img?.src || "",
          position: i + 1,
        };
      }).filter((x: any) => x.shortcode);
    });

    for (const link of links) {
      posts.push({
        position: link.position,
        shortcode: link.shortcode,
        username: "",
        type: link.href.includes("/reel/") ? "reel" : "image",
        likeCount: 0,
        commentCount: 0,
        viewCount: 0,
        caption: "",
        coverUrl: link.coverUrl,
        postUrl: `https://www.instagram.com${link.href}`,
        isOwn: false,
      });
    }
  } catch (e) {
    console.error("[Instagram Hashtag] DOM parse failed:", e);
  }

  return posts;
}

/**
 * Apifyフォールバック: apify/instagram-hashtag-scraper を使用
 */
async function scrapeHashtagWithApify(
  tag: string,
  maxResults: number,
  ownNamesLower: Set<string>,
): Promise<InstagramHashtagResult> {
  const token = ENV.apifyApiToken;
  if (!token) {
    console.warn("[Instagram Hashtag] No APIFY_API_TOKEN, returning empty");
    return { hashtag: tag, totalFetched: 0, method: "apify", topPosts: [], ownRanks: [] };
  }

  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/runs?token=${token}&waitForFinish=120`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hashtags: [tag],
          resultsLimit: Math.max(maxResults * 2, 50),
          resultsType: "posts",
        }),
        signal: AbortSignal.timeout(150_000),
      },
    );

    if (!res.ok) {
      console.error(`[Instagram Hashtag] Apify run request failed: HTTP ${res.status}`);
      return { hashtag: tag, totalFetched: 0, method: "apify", topPosts: [], ownRanks: [] };
    }
    const runData = await res.json() as any;
    const datasetId = runData?.data?.defaultDatasetId;
    const runId = runData?.data?.id;
    if (!datasetId) {
      console.error("[Instagram Hashtag] Apify run failed:", runData?.data?.status);
      return { hashtag: tag, totalFetched: 0, method: "apify", topPosts: [], ownRanks: [] };
    }

    // ステータス待機
    const runStatus = runData?.data?.status;
    if (runStatus === "RUNNING" && runId) {
      const finalStatus = await waitForApifyRun(runId, token, 120_000);
      if (finalStatus !== "SUCCEEDED") {
        console.warn(`[Instagram Hashtag] Apify run finished: ${finalStatus}`);
      }
    }

    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&limit=${Math.max(maxResults * 2, 50)}`,
    );
    if (!itemsRes.ok) {
      console.error(`[Instagram Hashtag] Dataset fetch failed: HTTP ${itemsRes.status}`);
      return { hashtag: tag, totalFetched: 0, method: "apify" as const, topPosts: [], ownRanks: [] };
    }
    const itemsRaw = await itemsRes.json();
    const items: any[] = Array.isArray(itemsRaw) ? itemsRaw : [];

    const allPosts: InstagramHashtagPost[] = items.map((item: any, i: number) => {
      const username = item.ownerUsername || item.owner?.username || "";
      return {
        position: i + 1,
        shortcode: item.shortCode || item.id || "",
        username,
        type: item.type === "Sidecar" ? "carousel"
            : (item.type === "Video" || item.isVideo)
              ? (item.productType === "clips" || item.productType === "reels" ? "reel" : "video")
              : "image",
        likeCount: Math.max(0, item.likesCount || 0),
        commentCount: item.commentsCount || 0,
        viewCount: item.videoPlayCount || item.videoViewCount || 0,
        caption: item.caption || "",
        coverUrl: item.displayUrl || item.thumbnailUrl || "",
        postUrl: item.url || `https://www.instagram.com/p/${item.shortCode || ""}/`,
        isOwn: ownNamesLower.has(username.toLowerCase()),
      };
    });

    // 全タイプ混合ランキング + position再番号付け
    const posts = allPosts
      .slice(0, maxResults)
      .map((p, i) => ({ ...p, position: i + 1 }));
    const ownRanks = posts.filter(p => p.isOwn).map(p => p.position);
    console.log(`[Instagram Hashtag] Apify: #${tag} → ${allPosts.length} total, ${posts.length} posts`);

    return {
      hashtag: tag,
      totalFetched: posts.length,
      method: "apify",
      topPosts: posts,
      ownRanks,
    };
  } catch (e) {
    console.error(`[Instagram Hashtag] Apify failed for #${tag}:`, e);
    return { hashtag: tag, totalFetched: 0, method: "apify", topPosts: [], ownRanks: [] };
  }
}

// ============================
// Puppeteer fallback: 個別投稿メトリクス取得
// ============================

/**
 * Puppeteer + sessionid を使用して単一Instagram投稿のメトリクスを取得。
 * GraphQL APIレスポンスをインターセプトしてlike/comment数を抽出。
 */
async function fetchInstagramPostMetrics(
  postUrl: string,
): Promise<{ likeCount: number; commentCount: number } | null> {
  const sessionId = process.env.INSTAGRAM_SESSION_ID;
  if (!sessionId) return null;

  // Extract shortcode from URL
  const shortcodeMatch = postUrl.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
  if (!shortcodeMatch) return null;
  const shortcode = shortcodeMatch[2];

  const chromePath = findChromiumPath();
  if (!chromePath) {
    console.warn("[Instagram Puppeteer] Chromium not found");
    return null;
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: buildChromiumArgs(),
    });

    const page = await browser.newPage();
    await page.setCookie({
      name: "sessionid",
      value: sessionId,
      domain: ".instagram.com",
      path: "/",
      httpOnly: true,
      secure: true,
    });

    let metricsData: { likeCount: number; commentCount: number } | null = null;

    // Intercept GraphQL API responses to extract metrics
    page.on("response", async (response) => {
      try {
        const url = response.url();
        if (url.includes("/graphql") || url.includes("/api/v1/media/")) {
          const text = await response.text();
          if (text.includes(shortcode) || text.includes("edge_media_preview_like") || text.includes("like_count")) {
            const json = JSON.parse(text);
            // Try GraphQL format
            const media = json?.data?.shortcode_media
              || json?.data?.xdt_shortcode_media
              || json?.items?.[0];
            if (media) {
              const likes = media.edge_media_preview_like?.count
                ?? media.like_count
                ?? 0;
              const comments = media.edge_media_preview_comment?.count
                ?? media.edge_media_to_parent_comment?.count
                ?? media.comment_count
                ?? 0;
              if (likes > 0 || comments > 0) {
                metricsData = { likeCount: likes, commentCount: comments };
              }
            }
          }
        }
      } catch {
        // Ignore parse errors on non-JSON responses
      }
    });

    await page.goto(`https://www.instagram.com/p/${shortcode}/`, {
      waitUntil: "networkidle2",
      timeout: 30_000,
    });

    // Wait briefly for GraphQL responses to be processed
    await new Promise((r) => setTimeout(r, 3000));

    await browser.close();
    browser = undefined;

    if (metricsData) {
      console.log(`[Instagram Puppeteer] Recovered metrics for ${shortcode}: likes=${metricsData.likeCount}, comments=${metricsData.commentCount}`);
    }
    return metricsData;
  } catch (e) {
    console.warn(`[Instagram Puppeteer] Failed to fetch metrics for ${postUrl}:`, e);
    return null;
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * fetchInstagramPosts のラッパー。
 * メトリクス不完全（viewCount > 100 かつ like/comment ともに 0）な投稿に対して
 * Puppeteer フォールバックで正確なメトリクスの回復を試みる。
 */
export async function fetchInstagramPostsWithFallback(
  urls: string[],
): Promise<InstagramPostData[]> {
  const results = await fetchInstagramPosts(urls);

  // Find incomplete metrics
  const incomplete = results.filter(
    (r) => r.viewCount > 100 && r.likeCount === 0 && r.commentCount === 0,
  );

  if (incomplete.length > 0 && process.env.INSTAGRAM_SESSION_ID) {
    console.log(`[Instagram] ${incomplete.length}/${results.length} posts have incomplete metrics, trying Puppeteer fallback...`);
    for (const item of incomplete) {
      try {
        const recovered = await fetchInstagramPostMetrics(item.videoUrl);
        if (recovered && recovered.likeCount > 0) {
          item.likeCount = recovered.likeCount;
          item.commentCount = recovered.commentCount;
          item.metricsReliable = true;
        }
      } catch {
        /* skip — metricsReliable remains false */
      }
    }
  }

  return results;
}
