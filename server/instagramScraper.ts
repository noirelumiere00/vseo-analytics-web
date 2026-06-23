/**
 * Instagram スクレイパー（Apify経由 + Puppeteerハッシュタグ検索）
 * apify~instagram-scraper を使用して投稿データを取得
 * searchInstagramHashtag: explore/tags ページをPuppeteerでスクレイプし検索順位を取得
 */

import { ENV } from "./_core/env";
import puppeteer, { type Page } from "puppeteer-core";
import { findChromiumPath, buildChromiumArgs } from "./tiktokScraper";
import { extractVideoId } from "../shared/videoUrl";

/** Instagram sessionid のフォーマット検証（英数字+%エンコード、1000文字以内） */
function isValidSessionId(sessionId: string): boolean {
  return /^[a-zA-Z0-9%:_-]{10,1000}$/.test(sessionId);
}

/** 検証済み sessionid を返す（無効な場合は undefined） */
function getValidatedSessionId(): string | undefined {
  const raw = process.env.INSTAGRAM_SESSION_ID;
  if (!raw) return undefined;
  if (!isValidSessionId(raw)) {
    console.warn("[Instagram] INSTAGRAM_SESSION_ID has invalid format, ignoring");
    return undefined;
  }
  return raw;
}

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

  // Instagram URLからトラッキングパラメータを除去（Apifyの取得精度向上）
  const cleanUrls = urls.map(u => {
    try {
      const parsed = new URL(u);
      if (parsed.hostname.includes("instagram.com")) {
        // /reels/ → /reel/ に正規化
        parsed.pathname = parsed.pathname.replace(/\/reels\//, "/reel/");
        parsed.search = "";
        parsed.hash = "";
        return parsed.toString();
      }
    } catch { /* keep original */ }
    return u;
  });

  const results: InstagramPostData[] = [];

  try {
    // apify~instagram-scraper (directUrls対応)
    const res = await fetch(
      `https://api.apify.com/v2/acts/apify~instagram-scraper/runs?token=${token}&waitForFinish=180`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directUrls: cleanUrls,
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

    // 実行ステータスを確認 — 未完了なら完了までポーリング待機
    const runStatus = runData?.data?.status;
    if (runStatus && runStatus !== "SUCCEEDED") {
      if (runId && (runStatus === "RUNNING" || runStatus === "READY")) {
        console.log(`[Instagram] Apify run status: ${runStatus}, polling for completion...`);
        const finalStatus = await waitForApifyRun(runId, token, 180_000);
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
  method: "puppeteer" | "apify" | "api";
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
  const sessionId = getValidatedSessionId();
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
 * Instagram の「キーワード検索」（ハッシュタグではない、スマホアプリ版の検索＝`/popular/<KW>`）の
 * 表示順位を取得する。
 *
 * `/popular/<KW>` ページが JS で叩く **fbsearch keyword SERP**（`/api/v1/fbsearch/web/top_serp/`）を
 * Node fetch で直接認証付きリクエストする（Chromium 不要・TLS は検証済み）。
 * Cookie は `sessionid` ＋ `ds_user_id`（sessionid 先頭の user id）が必須。`X-IG-App-ID` も付与。
 * `next_max_id` でページ送りして maxResults 件まで集める。レスポンスの `media_grid.sections[].layout_content.medias[].media`
 * は既存 `parseGraphQLData` がそのまま解釈できる。戻り値の形は `searchInstagramHashtag` と同一
 * （`hashtag` フィールドにクエリ文字列を格納）。
 */
export async function searchInstagramKeyword(
  query: string,
  maxResults: number = 30,
  ownAccountNames: string[] = [],
): Promise<InstagramHashtagResult> {
  const ownNamesLower = new Set(ownAccountNames.map(n => n.toLowerCase().replace(/^@/, "")));
  const term = query.replace(/^#/, "").trim();
  const empty: InstagramHashtagResult = { hashtag: term, totalFetched: 0, method: "api", topPosts: [], ownRanks: [] };

  const sessionId = getValidatedSessionId();
  if (!sessionId) {
    console.warn("[Instagram Keyword] INSTAGRAM_SESSION_ID 未設定 — キーワード検索にはセッションが必須です");
    return empty;
  }
  const dsUserId = sessionId.split(/%3A|:/)[0]; // sessionid 先頭が user id
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "X-IG-App-ID": "936619743392459",
    Referer: "https://www.instagram.com/",
    Accept: "*/*",
    Cookie: `sessionid=${sessionId}; ds_user_id=${dsUserId}`,
  };

  const merged: InstagramHashtagPost[] = [];
  const seen = new Set<string>();
  let nextMaxId: string | null = null;
  try {
    for (let page = 0; page < 8 && merged.length < maxResults; page++) {
      let url =
        `https://www.instagram.com/api/v1/fbsearch/web/top_serp/?query=${encodeURIComponent(term)}` +
        `&enable_metadata=true&search_surface=web_top_search_page`;
      if (nextMaxId) url += `&next_max_id=${encodeURIComponent(nextMaxId)}`;

      const res = await fetch(url, { headers, redirect: "manual" });
      if (res.status !== 200) {
        console.warn(`[Instagram Keyword] "${term}" HTTP ${res.status}（セッション失効/未認証 or IPブロックの可能性）`);
        break;
      }
      const json: any = await res.json();
      const pagePosts = parseGraphQLData([json], ownNamesLower);
      let added = 0;
      for (const p of pagePosts) {
        if (!seen.has(p.shortcode)) {
          seen.add(p.shortcode);
          merged.push(p);
          added++;
        }
      }
      const mg = json.media_grid || {};
      console.log(`[Instagram Keyword] "${term}" page ${page + 1}: +${added} (total ${merged.length})`);
      if (!mg.has_more || !mg.next_max_id || added === 0) break;
      nextMaxId = mg.next_max_id;
    }
  } catch (e) {
    console.error(`[Instagram Keyword] fetch failed for "${term}":`, e);
    if (merged.length === 0) return empty;
  }

  const top = merged.slice(0, maxResults).map((p, i) => ({ ...p, position: i + 1 }));
  const ownRanks = top.filter(p => p.isOwn).map(p => p.position);
  console.log(`[Instagram Keyword] "${term}": ${top.length} posts (自社 ${ownRanks.length} 件)`);
  return { hashtag: term, totalFetched: top.length, method: "api", topPosts: top, ownRanks };
}

/**
 * Puppeteerで https://www.instagram.com/explore/tags/{tag}/ をスクレイプ
 */
async function scrapeHashtagWithPuppeteer(
  tag: string,
  maxResults: number,
  ownNamesLower: Set<string>,
): Promise<InstagramHashtagResult> {
  const sessionId = getValidatedSessionId()!;
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
      const maxScrolls = Number(process.env.IG_MAX_SCROLLS) || 10;
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
          if (noProgressCount >= 3) break;
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
// Puppeteer fallback: バッチ投稿データ取得（年齢制限対応）
// ============================

/**
 * Puppeteer + sessionid を使用してInstagram投稿をバッチ取得。
 * 単一ブラウザインスタンスでページを使い回し、年齢制限投稿にも対応。
 * GraphQL/APIレスポンスをインターセプトしてフル InstagramPostData を返却。
 */
async function fetchInstagramPostsViaPuppeteer(
  urls: string[],
): Promise<InstagramPostData[]> {
  const sessionId = getValidatedSessionId();
  if (!sessionId) {
    console.warn("[Instagram Puppeteer Batch] INSTAGRAM_SESSION_ID not set, skipping");
    return [];
  }
  if (urls.length === 0) return [];

  const chromePath = findChromiumPath();
  if (!chromePath) {
    console.warn("[Instagram Puppeteer Batch] Chromium not found");
    return [];
  }

  const results: InstagramPostData[] = [];
  let browser;

  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: buildChromiumArgs(),
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    );
    await page.setCookie({
      name: "sessionid",
      value: sessionId,
      domain: ".instagram.com",
      path: "/",
      httpOnly: true,
      secure: true,
    });

    console.log(`[Instagram Puppeteer Batch] Processing ${urls.length} URLs...`);

    for (let i = 0; i < urls.length; i++) {
      const postUrl = urls[i];
      // Extract shortcode from URL
      const shortcodeMatch = postUrl.match(/\/(p|reels?|tv)\/([A-Za-z0-9_-]+)/);
      if (!shortcodeMatch) {
        console.warn(`[Instagram Puppeteer Batch] Could not extract shortcode from: ${postUrl}`);
        continue;
      }
      const shortcode = shortcodeMatch[2];

      let mediaData: any = null;

      // Set up response interception for this page load
      const responseHandler = async (response: any) => {
        try {
          const url = response.url();
          if (
            url.includes("/graphql") ||
            url.includes("/api/v1/media/") ||
            url.includes("/api/graphql")
          ) {
            const text = await response.text();
            if (!text || text.startsWith("<")) return;
            if (
              text.includes(shortcode) ||
              text.includes("edge_media_preview_like") ||
              text.includes("like_count") ||
              text.includes("play_count")
            ) {
              const json = JSON.parse(text);
              const media =
                json?.data?.shortcode_media ||
                json?.data?.xdt_shortcode_media ||
                json?.items?.[0];
              if (media && !mediaData) {
                mediaData = media;
              }
            }
          }
        } catch {
          // Ignore parse errors
        }
      };

      page.on("response", responseHandler);

      try {
        await page.goto(`https://www.instagram.com/p/${shortcode}/`, {
          waitUntil: "networkidle2",
          timeout: 30_000,
        });

        // セッション期限切れ検出
        const currentUrl = page.url();
        if (currentUrl.includes("/accounts/login") || currentUrl.includes("/challenge/")) {
          console.error("[Instagram Puppeteer Batch] Session expired — redirected to login. Stopping batch.");
          page.off("response", responseHandler);
          break;
        }

        // Wait for GraphQL responses
        await new Promise((r) => setTimeout(r, 3000));

        if (mediaData) {
          const viewCount = mediaData.play_count
            || mediaData.video_play_count
            || mediaData.video_view_count
            || mediaData.edge_media_video_views?.count
            || 0;
          const likeCount = mediaData.edge_media_preview_like?.count
            ?? mediaData.like_count
            ?? 0;
          const commentCount = mediaData.edge_media_preview_comment?.count
            ?? mediaData.edge_media_to_parent_comment?.count
            ?? mediaData.comment_count
            ?? 0;
          const caption = mediaData.edge_media_to_caption?.edges?.[0]?.node?.text
            || mediaData.caption?.text
            || "";
          const ownerUsername = mediaData.owner?.username
            || mediaData.user?.username
            || "";
          const publishedAt = mediaData.taken_at_timestamp
            ? new Date(mediaData.taken_at_timestamp * 1000).toISOString()
            : mediaData.taken_at
              ? new Date(mediaData.taken_at * 1000).toISOString()
              : "";
          const coverUrl = mediaData.display_url
            || mediaData.thumbnail_src
            || mediaData.image_versions2?.candidates?.[0]?.url
            || "";
          const rawMusic = mediaData.clips_music_attribution_info || mediaData.music_metadata?.music_info?.music_asset_info;
          const musicInfo = rawMusic
            ? { title: rawMusic.title || rawMusic.song_name || "", artistName: rawMusic.artist_name || rawMusic.display_artist || "" }
            : null;

          results.push({
            videoId: shortcode,
            videoUrl: postUrl,
            coverUrl,
            caption,
            viewCount,
            threeSecViewCount: mediaData.video_view_count || 0,
            likeCount,
            commentCount,
            publishedAt,
            ownerUsername,
            musicInfo: musicInfo && (musicInfo.title || musicInfo.artistName) ? musicInfo : null,
            metricsReliable: true,
          });

          if ((i + 1) % 10 === 0) {
            console.log(`[Instagram Puppeteer Batch] Progress: ${i + 1}/${urls.length} (${results.length} succeeded)`);
          }
        } else {
          console.warn(`[Instagram Puppeteer Batch] No media data for ${shortcode}`);
        }
      } catch (e) {
        console.warn(`[Instagram Puppeteer Batch] Failed for ${shortcode}:`, e);
      } finally {
        page.off("response", responseHandler);
      }

      // Rate limiting: small delay between requests
      if (i < urls.length - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    console.log(`[Instagram Puppeteer Batch] Completed: ${results.length}/${urls.length} posts recovered`);
  } catch (e) {
    console.error("[Instagram Puppeteer Batch] Browser error:", e);
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }

  return results;
}

/**
 * Puppeteer + sessionid を使用して単一Instagram投稿のメトリクスを取得。
 * GraphQL APIレスポンスをインターセプトしてlike/comment数を抽出。
 */
async function fetchInstagramPostMetrics(
  postUrl: string,
): Promise<{ likeCount: number; commentCount: number } | null> {
  const sessionId = getValidatedSessionId();
  if (!sessionId) return null;

  // Extract shortcode from URL
  const shortcodeMatch = postUrl.match(/\/(p|reels?|tv)\/([A-Za-z0-9_-]+)/);
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
 * 1. Apifyで全URL取得
 * 2. Apifyが返さなかったURL（= missingUrls）を特定
 * 3. Apifyが返したが不完全な投稿（= incompleteUrls）も特定
 * 4. missingUrls + incompleteUrls をまとめてPuppeteerバッチで取得
 * 5. 結果をマージして返却
 */
export async function fetchInstagramPostsWithFallback(
  urls: string[],
): Promise<InstagramPostData[]> {
  const results = await fetchInstagramPosts(urls);

  if (!getValidatedSessionId()) {
    return results;
  }

  // Build a set of videoIds returned by Apify for matching
  const apifyVideoIds = new Set(results.map((r) => r.videoId).filter(Boolean));

  // Find URLs that Apify did not return at all (e.g. age-restricted posts)
  const missingUrls = urls.filter((u) => {
    const parsed = extractVideoId(u);
    if (!parsed || parsed.platform !== "instagram") return false;
    return !apifyVideoIds.has(parsed.id);
  });

  // Find posts Apify returned but with incomplete metrics
  const incompleteItems = results.filter(
    (r) => r.viewCount > 100 && r.likeCount === 0 && r.commentCount === 0,
  );
  const incompleteUrls = incompleteItems.map((r) => r.videoUrl);

  const puppeteerTargetUrls = [...missingUrls, ...incompleteUrls];

  if (puppeteerTargetUrls.length > 0) {
    console.log(
      `[Instagram] Puppeteer fallback: ${missingUrls.length} missing + ${incompleteUrls.length} incomplete = ${puppeteerTargetUrls.length} URLs`,
    );

    const puppeteerResults = await fetchInstagramPostsViaPuppeteer(puppeteerTargetUrls);

    // Index Puppeteer results by videoId for fast lookup
    const puppeteerMap = new Map<string, InstagramPostData>();
    for (const pr of puppeteerResults) {
      puppeteerMap.set(pr.videoId, pr);
    }

    // Update incomplete Apify results with Puppeteer data
    for (const item of incompleteItems) {
      const recovered = puppeteerMap.get(item.videoId);
      if (recovered && (recovered.likeCount > 0 || recovered.commentCount > 0)) {
        item.likeCount = recovered.likeCount;
        item.commentCount = recovered.commentCount;
        if (recovered.viewCount > 0) item.viewCount = recovered.viewCount;
        item.metricsReliable = true;
        puppeteerMap.delete(item.videoId); // consumed
      }
    }

    // Add missing posts that were recovered by Puppeteer
    for (const [, pr] of puppeteerMap) {
      // Only add if this was a missing URL (not already in results)
      if (!apifyVideoIds.has(pr.videoId)) {
        results.push(pr);
      }
    }

    console.log(
      `[Instagram] Final: ${results.length}/${urls.length} posts (${results.filter((r) => r.metricsReliable !== false).length} with reliable metrics)`,
    );
  }

  return results;
}
