import puppeteer, { type Browser, type Page } from "puppeteer-core";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

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

// 3回の検索結果と重複度分析を含む結果
export interface TikTokTripleSearchResult {
  searches: [TikTokSearchResult, TikTokSearchResult, TikTokSearchResult];
  duplicateAnalysis: {
    // 3回全てに出現（最強の勝ちパターン）
    appearedInAll3: TikTokVideo[];
    // 2回出現（準勝ちパターン）
    appearedIn2: TikTokVideo[];
    // 1回のみ出現
    appearedIn1Only: TikTokVideo[];
    // 全ユニーク動画
    allUniqueVideos: TikTokVideo[];
    // 重複率
    overlapRate: number;
  };
  keyword: string;
}

// User-Agentのバリエーション（各シークレットブラウザで異なるUAを使用）
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
];

// TikTokの内部APIを呼び出して検索結果を取得
async function fetchSearchResults(
  page: Page,
  keyword: string,
  offset: number = 0
): Promise<any> {
  return page.evaluate(
    async (kw: string, off: number) => {
      const encodedKeyword = encodeURIComponent(kw);
      const url = `https://www.tiktok.com/api/search/general/full/?keyword=${encodedKeyword}&offset=${off}&search_source=normal_search&WebIdLastTime=${Math.floor(Date.now() / 1000)}&aid=1988&app_language=ja-JP&app_name=tiktok_web&browser_language=ja-JP&browser_name=Mozilla&browser_online=true&browser_platform=Win32&browser_version=121.0.0.0&channel=tiktok_web&cookie_enabled=true&device_platform=web_pc&focus_state=true&from_page=search&history_len=3&is_fullscreen=false&is_page_visible=true&os=windows&priority_region=JP&region=JP&screen_height=1080&screen_width=1920&webcast_language=ja-JP`;

      try {
        const response = await fetch(url, { credentials: "include" });
        
        // いきなり .json() でパースせず、まずはテキストとして受け取る
        const text = await response.text();
        
        // 空のレスポンス（Bot弾きの典型）の場合
        if (!text || text.trim() === "") {
          console.error(`[TikTok API] Empty response (Status: ${response.status}). Likely blocked by anti-bot.`);
          return { error: `TikTok returned an empty response (Status: ${response.status}). Likely blocked by anti-bot.` };
        }
        
        // HTMLエラーページの検出（CAPTCHA等）
        if (text.includes("<html") || text.includes("<!DOCTYPE")) {
          const htmlSnippet = text.substring(0, 200).replace(/\n/g, " ");
          console.error(`[TikTok API] Received HTML instead of JSON (likely CAPTCHA or error page):`, htmlSnippet);
          return { error: `TikTok returned an error page (possibly CAPTCHA). Please try again later.` };
        }
        
        try {
          // テキストをJSONにパースする
          const json = JSON.parse(text);
          if (!response.ok) {
            console.error(`[TikTok API] HTTP Error ${response.status}`);
            console.error(`[TikTok API] Response body:`, JSON.stringify(json).substring(0, 500));
          }
          return { status: response.status, data: json };
        } catch (parseError: any) {
          // JSONパースに失敗した場合、返ってきたテキストの先頭100文字をエラーに含める
          const snippet = text.substring(0, 100).replace(/\n/g, " ");
          console.error(`[TikTok API] JSON Parse Error: ${parseError.message}`);
          console.error(`[TikTok API] Response snippet:`, snippet);
          return { error: `JSON Parse Error: ${parseError.message}. Response: ${snippet}` };
        }
      } catch (e: any) {
        console.error(`[TikTok API] Fetch error: ${e.message}`);
        return { error: e.message };
      }
    },
    keyword,
    offset
  );
}

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

  try {
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(USER_AGENTS[sessionIndex % USER_AGENTS.length]);
    await page.setExtraHTTPHeaders({
      "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
    });

    // 【Bright Data プロキシ設定】セッション固定（Sticky Session）の動的生成
    const proxyServer = process.env.PROXY_SERVER;
    const proxyUsername = process.env.PROXY_USERNAME;
    const proxyPassword = process.env.PROXY_PASSWORD;

    if (proxyServer && proxyUsername && proxyPassword) {
      const sessionId = `session-${Date.now()}-${sessionIndex}`;
      const authenticatedUsername = `${proxyUsername}-${sessionId}`;
      console.log(`[TikTok Session ${sessionIndex + 1}] Proxy authentication with session: ${sessionId}`);
      if (onProgress) onProgress(`検索${sessionIndex + 1}: プロキシ認証中 (${sessionId})...`);
      await page.authenticate({
        username: authenticatedUsername,
        password: proxyPassword,
      });
    } else {
      console.warn(`[TikTok Session ${sessionIndex + 1}] Proxy environment variables not set. Running without proxy.`);
    }

    // 【通信最適化】リクエストインターセプトを有効化（画像・動画・フォント・トラッキングをブロック）
    await page.setRequestInterception(true);

    page.on('request', (request) => {
      const resourceType = request.resourceType();
      const url = request.url();

      // 許可：document, script, xhr, fetch （TikTok画面構篆とAPI JSON取得に必須）
      if (
        resourceType === 'document' ||
        resourceType === 'script' ||
        resourceType === 'xhr' ||
        resourceType === 'fetch'
      ) {
        request.continue();
        return;
      }

      // 遭断：image, media, stylesheet, font （通信量を跳ね上げる原因）
      if (
        resourceType === 'image' ||
        resourceType === 'media' ||
        resourceType === 'stylesheet' ||
        resourceType === 'font'
      ) {
        request.abort();
        return;
      }

      // 遭断：Google Analytics 等のトラッキング URL
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

    console.log(`[TikTok Session ${sessionIndex + 1}] Request interception enabled (images, media, fonts, tracking blocked)`);

    // 【接続確認】lumtest.com/myip.json でプロキシ経由の IP を確認
    console.log(`[TikTok Session ${sessionIndex + 1}] Verifying proxy connection...`);
    if (onProgress) onProgress(`検索${sessionIndex + 1}: プロキシ接続確認中...`);

    try {
      const ipCheckResponse = await page.evaluate(async () => {
        const response = await fetch('https://lumtest.com/myip.json');
        return response.json();
      });

      const ip = ipCheckResponse.ip || 'unknown';
      const country = ipCheckResponse.country || 'unknown';
      console.log(`[TikTok Session ${sessionIndex + 1}] Proxy IP: ${ip}, Country: ${country}`);
      if (onProgress) onProgress(`検索${sessionIndex + 1}: プロキシ IP: ${ip} (${country})`);

      if (country !== 'JP') {
        console.warn(`[TikTok Session ${sessionIndex + 1}] WARNING: Expected country JP, but got ${country}`);
      } else {
        console.log(`[TikTok Session ${sessionIndex + 1}] ✓ Confirmed: Japanese residential IP`);
      }
    } catch (ipCheckError: any) {
      console.warn(`[TikTok Session ${sessionIndex + 1}] Failed to verify proxy IP:`, ipCheckError.message);
    }

    // TikTokにアクセスしてCookieを取得
    console.log(`[TikTok Session ${sessionIndex + 1}] Initializing...`);
    if (onProgress) onProgress(`検索${sessionIndex + 1}: ブラウザ初期化中...`);

    await page.goto("https://www.tiktok.com/", {
      waitUntil: "domcontentloaded", // 画像ブロックでもDOM構篆完了を待機
      timeout: 30000,
    });
    // セッションごとに異なる待機時間（フィンガープリント対策）
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));

    // 【スクロール処理の「力技」化】CSS 遮断環境での堅牢なスクロール
    const performRobustScroll = async (maxScrolls: number = 5) => {
      for (let i = 0; i < maxScrolls; i++) {
        await page.evaluate(() => {
          window.scrollBy(0, 500);
        });
        await new Promise((r) => setTimeout(r, 500));
      }
      console.log(`[TikTok Session ${sessionIndex + 1}] Robust scroll completed (${maxScrolls} scrolls)`);
    };

    // 検索ページに遷移してCookieを確立
    console.log(`[TikTok Session ${sessionIndex + 1}] Navigating to search page...`);
    if (onProgress) onProgress(`検索${sessionIndex + 1}: 検索ページに遷移中...`);
    
    await page.goto(`https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`, {
      waitUntil: "domcontentloaded", // 画像ブロックでもDOM構篆完了を待機
      timeout: 30000,
    });
    
    // 【通信最適化】画像ブロックのためスクリーンショットを削除
    // （画像ブロックで画像データが取得できないため削除）
    console.log(`[TikTok Session ${sessionIndex + 1}] Screenshot skipped (images blocked for bandwidth optimization)`);
    
    await new Promise((r) => setTimeout(r, 3000));
    // 【スクロール処理の「力技」化】CSS 遮断環境での堅牢なスクロール実行
    await performRobustScroll(3);

    const allVideos: TikTokVideo[] = [];
    let offset = 0;
    const batchSize = 12;
    let hasMore = true;
    let retryCount = 0;
    const maxRetries = 3;

    while (allVideos.length < maxVideos && hasMore && retryCount < maxRetries) {
      console.log(
        `[TikTok Session ${sessionIndex + 1}] Fetching offset=${offset}, current=${allVideos.length}/${maxVideos}`
      );
      if (onProgress)
        onProgress(
          `検索${sessionIndex + 1}: 動画取得中 (${allVideos.length}/${maxVideos})`
        );

      const result = await fetchSearchResults(page, keyword, offset);

      if (result.error) {
        console.error(
          `[TikTok Session ${sessionIndex + 1}] API error: ${result.error}`
        );
        retryCount++;
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      if (
        !result.data ||
        result.data.status_code !== 0 ||
        !result.data.data
      ) {
        console.log(
          `[TikTok Session ${sessionIndex + 1}] No more data or error status: ${result.data?.status_code}`
        );
        hasMore = false;
        break;
      }

      const items = result.data.data;
      let newVideos = 0;

      for (const item of items) {
        const video = parseVideoData(item);
        if (video && !allVideos.find((v) => v.id === video.id)) {
          allVideos.push(video);
          newVideos++;
          if (allVideos.length >= maxVideos) break;
        }
      }

      console.log(
        `[TikTok Session ${sessionIndex + 1}] Got ${newVideos} new videos, total: ${allVideos.length}`
      );

      if (newVideos === 0) {
        retryCount++;
      } else {
        retryCount = 0;
      }

      offset += batchSize;

      // レート制限対策: セッションごとに異なる間隔
      const delay = 1500 + Math.random() * 2000;
      await new Promise((r) => setTimeout(r, delay));

      if (result.data.has_more === 0 || result.data.has_more === false) {
        hasMore = false;
      }
    }

    console.log(
      `[TikTok Session ${sessionIndex + 1}] Complete: ${allVideos.length} videos`
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

// 重複度分析: 3回の検索結果を比較して勝ちパターン動画を特定
function analyzeDuplicates(
  searches: [TikTokSearchResult, TikTokSearchResult, TikTokSearchResult]
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

  const appearedInAll3: TikTokVideo[] = [];
  const appearedIn2: TikTokVideo[] = [];
  const appearedIn1Only: TikTokVideo[] = [];

  for (const [videoId, count] of Array.from(videoAppearanceCount.entries())) {
    const video = videoMap.get(videoId)!;
    if (count >= 3) {
      appearedInAll3.push(video);
    } else if (count === 2) {
      appearedIn2.push(video);
    } else {
      appearedIn1Only.push(video);
    }
  }

  // 各カテゴリ内で再生数順にソート
  appearedInAll3.sort((a, b) => b.stats.playCount - a.stats.playCount);
  appearedIn2.sort((a, b) => b.stats.playCount - a.stats.playCount);
  appearedIn1Only.sort((a, b) => b.stats.playCount - a.stats.playCount);

  const allUniqueVideos = [...appearedInAll3, ...appearedIn2, ...appearedIn1Only];
  const totalUniqueCount = allUniqueVideos.length;
  const duplicateCount = appearedInAll3.length + appearedIn2.length;
  const overlapRate =
    totalUniqueCount > 0 ? (duplicateCount / totalUniqueCount) * 100 : 0;

  return {
    appearedInAll3,
    appearedIn2,
    appearedIn1Only,
    allUniqueVideos,
    overlapRate,
  };
}

// メイン関数: 3つのシークレットブラウザで同一キーワード検索→重複度分析
export async function searchTikTokTriple(
  keyword: string,
  videosPerSearch: number = 15,
  onProgress?: (message: string, percent: number) => void
): Promise<TikTokTripleSearchResult> {
  // ブラウザを起動
  let browser: Browser;
  try {
    console.log("[Puppeteer] Launching browser with executablePath: /usr/bin/chromium-browser");
    browser = await puppeteer.launch({
      executablePath: "/usr/bin/chromium-browser",
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1920,1080",
        "--lang=ja-JP",
      ],
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
    if (onProgress) onProgress("3つのシークレットブラウザを起動中...", 5);

    // 3つのシークレットブラウザコンテキストで順次検索
    // （並列だとレート制限に引っかかるため順次実行）
    const searches: TikTokSearchResult[] = [];

    for (let i = 0; i < 3; i++) {
      if (onProgress) {
        onProgress(`検索${i + 1}/3: シークレットブラウザで検索中...`, 10 + i * 25);
      }

      const result = await searchInIncognitoContext(
        browser,
        keyword,
        videosPerSearch,
        i,
        (msg) => {
          if (onProgress) {
            const basePercent = 10 + i * 25;
            onProgress(msg, basePercent);
          }
        }
      );

      searches.push(result);

      // 次の検索前に間隔を空ける（レート制限対策）
      if (i < 2) {
        if (onProgress)
          onProgress(`検索${i + 1}完了。次の検索まで待機中...`, 10 + (i + 1) * 25 - 5);
        await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000));
      }
    }

    if (onProgress) onProgress("重複度分析中...", 85);

    // 重複度分析
    const tripleSearches = searches as [
      TikTokSearchResult,
      TikTokSearchResult,
      TikTokSearchResult,
    ];
    const duplicateAnalysis = analyzeDuplicates(tripleSearches);

    console.log(
      `[TikTok] Triple search complete for "${keyword}":`,
      `3回全出現=${duplicateAnalysis.appearedInAll3.length},`,
      `2回出現=${duplicateAnalysis.appearedIn2.length},`,
      `1回のみ=${duplicateAnalysis.appearedIn1Only.length},`,
      `重複率=${duplicateAnalysis.overlapRate.toFixed(1)}%`
    );

    if (onProgress) onProgress("データ収集完了", 90);

    return {
      searches: tripleSearches,
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
  maxVideos: number = 15,
  onProgress?: (fetched: number, total: number) => void
): Promise<TikTokSearchResult> {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium-browser",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1920,1080",
      "--lang=ja-JP",
    ],
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
  const puppeteer = require("puppeteer-extra");
  
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1920,1080",
      "--lang=ja-JP",
    ],
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
