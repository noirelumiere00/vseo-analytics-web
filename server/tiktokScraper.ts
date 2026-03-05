import puppeteer, { type Browser, type Page } from "puppeteer-core";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// Stealth プラグインを有効化
const stealthPlugin = StealthPlugin();

// TikTok内部APIから検索結果を取得するモジュール
// 3つの独立したシークレット（インコグニート）ブラウザコンテキストで
// 同一キーワードを検索し、パーソナライズを排除した純粋なアルゴリズム評価を行う

export interface TikTokVideo {
  id: string;
  desc: string;
  createTime: number;
  duration: number;
  coverUrl: string;
  playUrl: string;
  author: {
    uniqueId: string;
    nickname: string;
    avatarUrl: string;
    followerCount: number;
    followingCount: number;
    heartCount: number;
    videoCount: number;
  };
  stats: {
    playCount: number;
    diggCount: number;
    commentCount: number;
    shareCount: number;
    collectCount: number;
  };
  hashtags: string[];
}

export interface TikTokSearchResult {
  videos: TikTokVideo[];
  keyword: string;
  totalFetched: number;
  sessionIndex: number;
}

// 複数回の検索結果と重複度分析を含む結果
export interface TikTokTripleSearchResult {
  searches: TikTokSearchResult[];
  duplicateAnalysis: {
    // 出現回数別の動画リスト（key=出現回数, value=動画配列）
    videosByAppearanceCount: Record<number, TikTokVideo[]>;
    // 全ユニーク動画（出現回数降順→再生数降順）
    allUniqueVideos: TikTokVideo[];
    // 重複率 （2回以上出現 / 全ユニーク × 100）
    overlapRate: number;
    // 実際に成功したセッション数
    numSessions: number;
  };
  keyword: string;
}

// User-Agentのバリエーション（各シークレットブラウザで異なるUAを使用）
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
];

// APIレスポンスからTikTokVideoオブジェクトに変換
function parseVideoData(item: any): TikTokVideo | null {
  if (!item || item.type !== 1 || !item.item) return null;

  const v = item.item;
  const stats = v.stats || {};
  const author = v.author || {};
  // 投稿者の統計情報用オブジェクトを取得（authorStats または author_stats）
  const authorStats = v.authorStats || v.author_stats || {};

  const hashtags: string[] = [];
  if (v.textExtra) {
    v.textExtra.forEach((te: any) => {
      if (te.hashtagName) hashtags.push(te.hashtagName);
    });
  }
  const hashtagMatches = (v.desc || "").match(/#[\w\u3000-\u9FFF]+/g);
  if (hashtagMatches) {
    hashtagMatches.forEach((tag: string) => {
      const cleaned = tag.replace("#", "");
      if (!hashtags.includes(cleaned)) hashtags.push(cleaned);
    });
  }

  return {
    id: v.id,
    desc: v.desc || "",
    createTime: v.createTime || 0,
    duration: v.video?.duration || 0,
    coverUrl: v.video?.cover || "",
    playUrl: v.video?.playAddr || v.video?.downloadAddr || "",
    author: {
      uniqueId: author.uniqueId || "",
      nickname: author.nickname || "",
      avatarUrl: author.avatarThumb || author.avatarMedium || "",
      // authorの中になければ、authorStatsから取得するようにフォールバックを追加
      followerCount: author.followerCount || authorStats.followerCount || 0,
      followingCount: author.followingCount || authorStats.followingCount || 0,
      heartCount: author.heartCount || author.heart || authorStats.heartCount || 0,
      videoCount: author.videoCount || authorStats.videoCount || 0,
    },
    stats: {
      playCount: stats.playCount || 0,
      diggCount: stats.diggCount || 0,
      commentCount: stats.commentCount || 0,
      shareCount: stats.shareCount || 0,
      collectCount: stats.collectCount || 0,
    },
    hashtags,
  };
}

// 1つのシークレットブラウザコンテキストでキーワード検索して動画を取得
// プランB: ネットワークインターセプト + ブラウザ内スクロールトリガーによるページネーション
// ブラウザ自体にX-Bogus等の署名を生成させ、AWS側からの直接APIリクエストは行わない
async function searchInIncognitoContext(
  browser: Browser,
  keyword: string,
  maxVideos: number,
  sessionIndex: number,
  onProgress?: (message: string) => void
): Promise<TikTokSearchResult> {
  // 新しいインコグニートコンテキストを作成（Cookie/履歴なし）
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  // ページネーション安全装置: 最大10ページまで
  const MAX_PAGES = 10;

  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(USER_AGENTS[sessionIndex % USER_AGENTS.length]);
    await page.setExtraHTTPHeaders({
      "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
    });

    // プロキシ認証（有効時のみ）
    if (isProxyEnabled()) {
      const sessionId = `session-${Date.now()}-${sessionIndex}`;
      const authenticatedUsername = `${process.env.PROXY_USERNAME}-${sessionId}`;
      console.log(`[TikTok Session ${sessionIndex + 1}] Proxy session: ${sessionId}`);
      await page.authenticate({
        username: authenticatedUsername,
        password: process.env.PROXY_PASSWORD!,
      });
    }

    // 通信最適化: 不要リソースをブロック
    await page.setRequestInterception(true);

    page.on('request', (request) => {
      const resourceType = request.resourceType();
      const url = request.url();

      // 許可：document, script, xhr, fetch, stylesheet（TikTok画面構築とAPI JSON取得に必須）
      if (
        resourceType === 'document' ||
        resourceType === 'script' ||
        resourceType === 'xhr' ||
        resourceType === 'fetch' ||
        resourceType === 'stylesheet'
      ) {
        request.continue();
        return;
      }

      // 遮断：media, font のみ（動画データとフォントは不要）
      // 画像は許可 — サムネイル読み込みによりDOMの高さが正常に伸び、
      // IntersectionObserverによるページネーションが機能する
      if (
        resourceType === 'media' ||
        resourceType === 'font'
      ) {
        request.abort();
        return;
      }

      // 遮断：Google Analytics 等のトラッキング URL
      if (
        url.includes('google-analytics.com') ||
        url.includes('analytics.google.com') ||
        url.includes('googletagmanager.com') ||
        url.includes('doubleclick.net')
      ) {
        request.abort();
        return;
      }

      // その他のリソース種別は続行
      request.continue();
    });

    console.log(`[TikTok Session ${sessionIndex + 1}] Request interception enabled`);

    // プロキシ接続確認（プロキシ有効時のみ）
    if (isProxyEnabled()) {
      try {
        const ipCheckResponse = await page.evaluate(async () => {
          const response = await fetch('https://lumtest.com/myip.json');
          return response.json();
        });
        const ip = ipCheckResponse.ip || 'unknown';
        const country = ipCheckResponse.country || 'unknown';
        console.log(`[TikTok Session ${sessionIndex + 1}] Proxy IP: ${ip} (${country})`);
      } catch (ipCheckError: any) {
        console.warn(`[TikTok Session ${sessionIndex + 1}] Proxy IP check failed:`, ipCheckError.message);
      }
    }

    // TikTokにアクセスしてCookieを取得
    console.log(`[TikTok Session ${sessionIndex + 1}] Initializing...`);
    if (onProgress) onProgress(`検索${sessionIndex + 1}: ブラウザ初期化中...`);

    await page.goto("https://www.tiktok.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    // セッションごとに異なる待機時間（フィンガープリント対策）
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));

    // ========================================================
    // プランB: ネットワークインターセプト + スクロールトリガー方式
    // ブラウザのIntersectionObserver → 内部API発火 → レスポンスをキャプチャ
    // X-Bogus等の署名はブラウザ自体が生成するため、外部リクエスト不要
    // ========================================================
    const allVideos: TikTokVideo[] = [];
    let latestCursor = 0;
    let latestHasMore = true;
    let pagesFetched = 0;

    // 【重要】page.goto の前にリスナーを設定し、初回APIレスポンスも確実にキャプチャする
    page.on('response', async (response) => {
      const url = response.url();
      // TikTok検索APIのレスポンスを検出（URLパターンは複数ありうる）
      if (!url.includes('/api/search/general/')) return;

      try {
        const text = await response.text();
        if (!text || text.trim() === '' || text.includes('<html') || text.includes('<!DOCTYPE')) {
          console.warn(`[TikTok Session ${sessionIndex + 1}] Non-JSON response from search API (status: ${response.status()})`);
          return;
        }

        const json = JSON.parse(text);
        const items = json?.data || json?.item_list || [];
        const newVideos: TikTokVideo[] = [];

        for (const item of items) {
          const video = parseVideoData(item);
          if (video && !allVideos.find(v => v.id === video.id)) {
            allVideos.push(video);
            newVideos.push(video);
          }
        }

        // ページネーション情報を抽出（cursor / offset / has_more）
        const cursor = json.cursor ?? json.offset ?? 0;
        const hasMore = json.has_more === true || json.has_more === 1;

        pagesFetched++;
        latestCursor = cursor;
        latestHasMore = hasMore;

        console.log(
          `[TikTok Session ${sessionIndex + 1}] API intercepted (page ${pagesFetched}): ` +
          `+${newVideos.length} new, ${allVideos.length} total unique | cursor=${cursor}, has_more=${hasMore}`
        );
      } catch (e) {
        // パース失敗は無視（非JSONレスポンス等）
      }
    });

    // 検索ページに遷移（リスナーが初回APIレスポンスをキャプチャ）
    console.log(`[TikTok Session ${sessionIndex + 1}] Navigating to search page...`);
    if (onProgress) onProgress(`検索${sessionIndex + 1}: 検索ページに遷移中...`);

    await page.goto(`https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // 初回データ待機: TikTokのJSハイドレーション完了を待つ
    // 動画グリッドが描画されるまで最大15秒待機（domcontentloadedだけではJS未完了）
    try {
      await page.waitForSelector('[data-e2e="search_top-item-list"], [data-e2e="search-common-link"], [class*="DivItemContainerV2"]', {
        timeout: 15000,
      });
      console.log(`[TikTok Session ${sessionIndex + 1}] Video grid detected in DOM`);
    } catch {
      console.warn(`[TikTok Session ${sessionIndex + 1}] Video grid selector not found within 15s, continuing with fallback...`);
    }
    // 追加の安定待機（IntersectionObserver初期化完了のため）
    await new Promise((r) => setTimeout(r, 3000));

    // SSRフォールバック: XHRリスナーで初回データが取れなかった場合、
    // ページ埋め込みJSON（__UNIVERSAL_DATA_FOR_REHYDRATION__）から抽出
    if (allVideos.length === 0) {
      console.log(`[TikTok Session ${sessionIndex + 1}] No XHR data yet, trying SSR extraction...`);
      try {
        const ssrVideos = await page.evaluate(() => {
          const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
          if (!el || !el.textContent) return null;
          try {
            const parsed = JSON.parse(el.textContent);
            const searchData = parsed?.['__DEFAULT_SCOPE__']?.['webapp.search-detail'];
            return searchData?.data ?? null;
          } catch { return null; }
        });
        if (ssrVideos && Array.isArray(ssrVideos)) {
          for (const item of ssrVideos) {
            const video = parseVideoData(item);
            if (video && !allVideos.find(v => v.id === video.id)) {
              allVideos.push(video);
            }
          }
          console.log(`[TikTok Session ${sessionIndex + 1}] SSR extraction: ${allVideos.length} videos`);
        }
      } catch (e) {
        console.log(`[TikTok Session ${sessionIndex + 1}] SSR extraction failed:`, e);
      }
    }

    console.log(`[TikTok Session ${sessionIndex + 1}] Initial batch: ${allVideos.length} videos`);

    // ページネーションループ: スクロールでTikTokの無限スクロールをトリガー
    // 複合スクロール: #grid-main コンテナ + window + IntersectionObserver番兵
    const MAX_SCROLL_ATTEMPTS = 15;
    let noNewDataCount = 0;

    for (let scroll = 0; scroll < MAX_SCROLL_ATTEMPTS; scroll++) {
      if (allVideos.length >= maxVideos) {
        console.log(`[TikTok Session ${sessionIndex + 1}] Reached target: ${allVideos.length}/${maxVideos} videos`);
        break;
      }
      if (!latestHasMore && pagesFetched > 0) {
        console.log(`[TikTok Session ${sessionIndex + 1}] Server indicated no more results (has_more=false)`);
        break;
      }
      if (pagesFetched >= MAX_PAGES) {
        console.log(`[TikTok Session ${sessionIndex + 1}] Reached max pagination limit (${MAX_PAGES} API pages)`);
        break;
      }

      const prevCount = allVideos.length;

      // 複合スクロール: 3つの方法を組み合わせてIntersectionObserverを確実に発火させる
      const currentHeight = await page.evaluate((scrollIdx) => {
        // 1) #grid-main コンテナをスクロール（TikTokの内部スクロール要素）
        const container = document.querySelector('#grid-main') as HTMLElement | null;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }

        // 2) IntersectionObserver番兵要素をビューポートに入れる
        const sentinels = [
          '[data-e2e="search-common-infinite-scroll"]',
          '[class*="InfiniteScroll"]',
          '[class*="LoadMore"]',
          '[class*="DivLoaderContainer"]',
        ];
        for (const sel of sentinels) {
          const el = document.querySelector(sel);
          if (el) {
            el.scrollIntoView({ behavior: 'instant', block: 'center' });
            break;
          }
        }

        // 3) window スクロール（フォールバック）
        const targetY = (scrollIdx + 1) * 3000;
        window.scrollTo(0, Math.max(document.body.scrollHeight, targetY));

        return container?.scrollHeight || document.body.scrollHeight;
      }, scroll);

      // API呼出→レスポンス受信→DOM追加を待つ
      await new Promise(r => setTimeout(r, 3000));

      if (onProgress) {
        onProgress(`検索${sessionIndex + 1}: 動画取得中 (${allVideos.length}/${maxVideos}) [スクロール${scroll + 1}]`);
      }
      console.log(
        `[TikTok Session ${sessionIndex + 1}] Scroll ${scroll + 1}: ` +
        `${allVideos.length} videos (height: ${currentHeight}, pages: ${pagesFetched}, cursor: ${latestCursor})`
      );

      if (allVideos.length === prevCount) {
        noNewDataCount++;
        if (noNewDataCount >= 3) {
          console.log(`[TikTok Session ${sessionIndex + 1}] No new data after ${noNewDataCount} scrolls, stopping`);
          break;
        }
      } else {
        noNewDataCount = 0;
      }
    }

    console.log(
      `[TikTok Session ${sessionIndex + 1}] Complete: ${allVideos.length} videos in ${pagesFetched} API pages`
    );

    return {
      videos: allVideos.slice(0, maxVideos),
      keyword,
      totalFetched: allVideos.length,
      sessionIndex,
    };
  } finally {
    await page.close();
    await context.close(); // インコグニートコンテキストを完全に破棄
  }
}

// 重複度分析: 複数回の検索結果を比較して勝ちパターン動画を特定
function analyzeDuplicates(
  searches: TikTokSearchResult[],
  numSearches: number
): TikTokTripleSearchResult["duplicateAnalysis"] {
  // 各動画IDの出現回数をカウント
  const videoAppearanceCount = new Map<string, number>();
  const videoMap = new Map<string, TikTokVideo>();

  for (const search of searches) {
    const seenInThisSearch = new Set<string>();
    for (const video of search.videos) {
      if (!seenInThisSearch.has(video.id)) {
        seenInThisSearch.add(video.id);
        videoAppearanceCount.set(
          video.id,
          (videoAppearanceCount.get(video.id) || 0) + 1
        );
        // 最新のデータで上書き（statsが最新のものを使う）
        if (
          !videoMap.has(video.id) ||
          video.stats.playCount > (videoMap.get(video.id)?.stats.playCount || 0)
        ) {
          videoMap.set(video.id, video);
        }
      }
    }
  }

  // 出現回数別にグループ化（numSearches回 → 1回 まで）
  const videosByAppearanceCount: Record<number, TikTokVideo[]> = {};
  for (let c = numSearches; c >= 1; c--) {
    videosByAppearanceCount[c] = [];
  }

  for (const [videoId, count] of Array.from(videoAppearanceCount.entries())) {
    const video = videoMap.get(videoId)!;
    const clampedCount = Math.min(count, numSearches);
    if (!videosByAppearanceCount[clampedCount]) {
      videosByAppearanceCount[clampedCount] = [];
    }
    videosByAppearanceCount[clampedCount].push(video);
  }

  // 各カテゴリ内で再生数順にソート
  for (const videos of Object.values(videosByAppearanceCount)) {
    videos.sort((a, b) => b.stats.playCount - a.stats.playCount);
  }

  // 全ユニーク動画（出現回数降順→再生数降順）
  const allUniqueVideos: TikTokVideo[] = [];
  for (let c = numSearches; c >= 1; c--) {
    allUniqueVideos.push(...(videosByAppearanceCount[c] || []));
  }

  const totalUniqueCount = allUniqueVideos.length;
  const duplicateCount = totalUniqueCount - (videosByAppearanceCount[1]?.length ?? 0);
  const overlapRate =
    totalUniqueCount > 0 ? (duplicateCount / totalUniqueCount) * 100 : 0;

  return {
    videosByAppearanceCount,
    allUniqueVideos,
    overlapRate,
    numSessions: numSearches,
  };
}

// Chromium/Chrome実行パスを自動検出
function findChromiumPath(): string {
  // 環境変数で指定があればそれを優先
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }

  // Puppeteer がインストールした Chrome を最優先で探す（snap版より安定）
  try {
    const puppeteerFull = require("puppeteer");
    const bundledPath = puppeteerFull.executablePath?.();
    if (bundledPath && fs.existsSync(bundledPath)) {
      console.log(`[Puppeteer] Found bundled Chrome at: ${bundledPath}`);
      return bundledPath;
    }
  } catch {
    // puppeteer (full) が使えない場合はスキップ
  }

  // .cache 内のPuppeteer Chromeを直接探す
  const cacheDir = path.join(process.cwd(), ".cache", "puppeteer", "chrome");
  if (fs.existsSync(cacheDir)) {
    try {
      const versions = fs.readdirSync(cacheDir).filter(d =>
        d.startsWith("linux-")
      );
      for (const ver of versions.sort().reverse()) {
        const chromePath = path.join(cacheDir, ver, "chrome-linux64", "chrome");
        if (fs.existsSync(chromePath)) {
          console.log(`[Puppeteer] Found cached Chrome at: ${chromePath}`);
          return chromePath;
        }
      }
    } catch {
      // ignore
    }
  }

  // 候補パスをチェック（優先度順 — snap版は最後に配置）
  const candidates = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/opt/google/chrome/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      console.log(`[Puppeteer] Found browser at: ${candidate}`);
      return candidate;
    }
  }

  // whichコマンドでの検索をフォールバック
  try {
    const result = execSync("which google-chrome-stable || which google-chrome || which chromium-browser || which chromium", { encoding: "utf-8" }).trim();
    if (result) {
      console.log(`[Puppeteer] Found browser via which: ${result}`);
      return result;
    }
  } catch {
    // ignore
  }

  // デフォルトフォールバック
  console.warn("[Puppeteer] No browser found, falling back to /usr/bin/chromium-browser");
  return "/usr/bin/chromium-browser";
}

// プロキシが有効かどうかを判定
function isProxyEnabled(): boolean {
  return !!(process.env.PROXY_SERVER && process.env.PROXY_USERNAME && process.env.PROXY_PASSWORD);
}

// Chromium起動引数を一元管理（メモリ最適化 + プロキシ設定）
function buildChromiumArgs(): string[] {
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-default-apps",
    "--no-first-run",
    "--window-size=1280,900",
    "--lang=ja-JP",
  ];
  if (process.env.PROXY_SERVER) {
    args.push(`--proxy-server=${process.env.PROXY_SERVER}`);
    if (process.env.PROXY_KYC_VERIFIED !== "true") {
      args.push("--ignore-certificate-errors");
    }
    console.log(`[TikTok] Proxy: ${process.env.PROXY_SERVER}`);
  } else {
    console.log("[TikTok] Running without proxy (direct connection)");
  }
  return args;
}

// メイン関数: 複数のシークレットブラウザで同一キーワード検索→重複度分析
export async function searchTikTokTriple(
  keyword: string,
  videosPerSearch: number = 30,
  numSearches: number = 5,
  onProgress?: (message: string, percent: number) => void
): Promise<TikTokTripleSearchResult> {
  // ブラウザを起動
  let browser: Browser;
  try {
    const chromiumPath = findChromiumPath();
    console.log(`[Puppeteer] Launching browser with executablePath: ${chromiumPath}`);
    browser = await puppeteer.launch({
      executablePath: chromiumPath,
      headless: true,
      args: buildChromiumArgs(),
    });
    console.log("[Puppeteer] Browser launched successfully");
  } catch (launchError: any) {
    console.error("[Puppeteer] CRITICAL: Failed to launch browser");
    console.error("[Puppeteer] Error message:", launchError.message);
    console.error("[Puppeteer] Error code:", launchError.code);
    console.error("[Puppeteer] Error stack:", launchError.stack);
    throw launchError;
  }

  try {
    if (onProgress) onProgress(`${numSearches}つのシークレットブラウザを起動中...`, 5);

    // 並列実行（スタガード起動で接続集中を回避）
    // 各セッションは独立したincognitoコンテキストで実行される
    const STAGGER_DELAY_MS = 1500;
    const progressPerSearch = Math.floor(75 / numSearches);
    const sessionProgress = new Array(numSearches).fill(0);

    const searchPromises = Array.from({ length: numSearches }, (_, i) =>
      new Promise<TikTokSearchResult>(async (resolve, reject) => {
        // スタガード起動: セッションごとに1.5秒ずらして開始
        if (i > 0) {
          await new Promise((r) => setTimeout(r, STAGGER_DELAY_MS * i));
        }

        try {
          if (onProgress) {
            onProgress(`検索${i + 1}/${numSearches}: シークレットブラウザで検索中...`, 10 + i * progressPerSearch);
          }

          const result = await searchInIncognitoContext(
            browser,
            keyword,
            videosPerSearch,
            i,
            (msg) => {
              if (onProgress) {
                sessionProgress[i] = 1;
                const completedSessions = sessionProgress.filter(p => p > 0).length;
                const pct = Math.min(85, 10 + Math.floor((completedSessions / numSearches) * 75));
                onProgress(`[${completedSessions}/${numSearches}] ${msg}`, pct);
              }
            }
          );

          console.log(`[TikTok] Session ${i + 1}/${numSearches} completed: ${result.videos.length} videos`);
          resolve(result);
        } catch (err) {
          console.error(`[TikTok] Session ${i + 1}/${numSearches} failed:`, err);
          reject(err);
        }
      })
    );

    // 全セッションの完了を待機（1つ失敗しても他は続行）
    const settled = await Promise.allSettled(searchPromises);
    const searches: TikTokSearchResult[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value.videos.length > 0) {
        searches.push(result.value);
      }
    }

    if (searches.length === 0) {
      throw new Error("全てのTikTok検索セッションが失敗しました");
    }

    console.log(`[TikTok] ${searches.length}/${numSearches} sessions succeeded`);

    if (onProgress) onProgress("重複度分析中...", 85);

    // 重複度分析（成功したセッション数で判定）
    const duplicateAnalysis = analyzeDuplicates(searches, searches.length);

    const countSummary = Object.entries(duplicateAnalysis.videosByAppearanceCount)
      .sort(([a], [b]) => Number(b) - Number(a))
      .map(([count, videos]) => `${count}回出現=${videos.length}`)
      .join(", ");
    console.log(
      `[TikTok] Search complete for "${keyword}" (${duplicateAnalysis.numSessions}sessions):`,
      `${countSummary},`,
      `重複率=${duplicateAnalysis.overlapRate.toFixed(1)}%`
    );

    if (onProgress) onProgress("データ収集完了", 90);

    return {
      searches,
      duplicateAnalysis,
      keyword,
    };
  } finally {
    await browser.close();
  }
}

// 後方互換性のために残す（単一検索）
export async function searchTikTokVideos(
  keyword: string,
  maxVideos: number = 30,
  onProgress?: (fetched: number, total: number) => void
): Promise<TikTokSearchResult> {
  const browser = await puppeteer.launch({
    executablePath: findChromiumPath(),
    headless: true,
    args: buildChromiumArgs(),
  });

  try {
    const result = await searchInIncognitoContext(
      browser,
      keyword,
      maxVideos,
      0,
      (msg) => console.log(msg)
    );
    return result;
  } finally {
    await browser.close();
  }
}


/**
 * TikTok動画のコメントを取得する関数
 * ネットワーク監視を使用してコメントAPIのレスポンスを横取りする
 */
export async function scrapeTikTokComments(videoUrl: string): Promise<string[]> {
  const browser = await puppeteer.launch({
    executablePath: findChromiumPath(),
    headless: true,
    args: buildChromiumArgs(),
  });

  const page = await browser.newPage();
  const comments: string[] = [];

  try {
    // 【最重要】ネットワーク通信を監視してコメントAPIの返事を横取りする
    page.on("response", async (response: any) => {
      const url = response.url();
      // URLに「api/comment/list」が含まれていたら、それはコメントのデータ
      if (url.includes("/api/comment/list/")) {
        try {
          const json = await response.json();
          // json.comments の中にコメントデータの配列が入っている
          if (json && json.comments) {
            json.comments.forEach((c: any) => {
              if (c.text) {
                comments.push(c.text); // コメントの文章だけを抽出
              }
            });
          }
        } catch (e) {
          console.error("[TikTok Comments] JSON parsing error:", e);
        }
      }
    });

    // 動画ページにアクセス
    await page.goto(videoUrl, { waitUntil: "networkidle2" });

    // コメント欄を読み込ませるために、画面を少し下にスクロールする
    await page.evaluate(() => {
      window.scrollBy(0, 800);
    });

    // 通信が終わるまで数秒待機
    await new Promise((r) => setTimeout(r, 3000));

    console.log(`[TikTok Comments] Extracted ${comments.length} comments from ${videoUrl}`);
  } catch (error) {
    console.error("[TikTok Comments] Error scraping comments:", error);
  } finally {
    await browser.close();
  }

  return comments;
}
