import puppeteer from "puppeteer";
import { Browser, Page } from "puppeteer";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import puppeteerExtra from "puppeteer-extra";
import * as fs from "fs";
import * as os from "os";
import { setupSwap } from "./setupSwap";

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
// 最新の Windows Chrome を優先し、検出回避性を向上
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
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
        
        // JSON パース
        const data = JSON.parse(text);
        
        // エラーレスポンスの検出
        if (data.status_code && data.status_code !== 0) {
          console.error(`[TikTok API] Error response: status_code=${data.status_code}, status_msg=${data.status_msg}`);
          return { error: `TikTok API error: ${data.status_msg || 'Unknown error'}` };
        }
        
        return data;
      } catch (err: any) {
        console.error(`[TikTok API] Fetch error: ${err.message}`);
        return { error: err.message };
      }
    },
    keyword,
    offset
  );
}

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
        try {
          const response = await fetch('https://lumtest.com/myip.json');
          if (!response.ok) {
            if (response.status === 407) {
              return { error: 'Proxy Authentication Required (407)', statusCode: 407 };
            } else if (response.status === 403) {
              return { error: 'Forbidden (403) - IP blocked', statusCode: 403 };
            } else if (response.status === 502 || response.status === 503) {
              return { error: `Proxy Service Error (${response.status})`, statusCode: response.status };
            }
            return { error: `HTTP Error: ${response.status}`, statusCode: response.status };
          }
          const text = await response.text();
          if (!text) {
            return { error: 'Empty response from proxy check', statusCode: response.status };
          }
          return JSON.parse(text);
        } catch (err: any) {
          console.error(`[Proxy Check] Fetch error: ${err.message}`);
          console.error(`[Proxy Check] Error name: ${err.name}`);
          console.error(`[Proxy Check] Error cause: ${err.cause}`);
          return { error: err.message, errorName: err.name, errorCause: err.cause, type: 'FetchError' };
        }
      });

      if (ipCheckResponse.error) {
        console.error(`[TikTok Session ${sessionIndex + 1}] Proxy connection error: ${ipCheckResponse.error}`);
        if (ipCheckResponse.statusCode) {
          console.error(`[TikTok Session ${sessionIndex + 1}] HTTP Status Code: ${ipCheckResponse.statusCode}`);
        }
      } else {
        console.log(`[Proxy Info] Country: ${ipCheckResponse.country}, IP: ${ipCheckResponse.ip_version}`);
        console.log(`[Proxy Info] Full response:`, JSON.stringify(ipCheckResponse, null, 2));
      }
    } catch (error) {
      console.error(`[TikTok Session ${sessionIndex + 1}] Proxy verification failed:`, error);
    }

    // TikTok検索ページにアクセス
    const searchUrl = `https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`;
    console.log(`[TikTok Session ${sessionIndex + 1}] Accessing search URL: ${searchUrl}`);
    if (onProgress) onProgress(`検索${sessionIndex + 1}: TikTok検索ページにアクセス中...`);

    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 120000 });

    // 動画データを取得
    const videos: TikTokVideo[] = [];
    let offset = 0;

    while (videos.length < maxVideos) {
      console.log(`[TikTok Session ${sessionIndex + 1}] Fetching videos (offset: ${offset}, current: ${videos.length}/${maxVideos})`);
      if (onProgress) onProgress(`検索${sessionIndex + 1}: 動画取得中 (${videos.length}/${maxVideos})...`);

      const result = await fetchSearchResults(page, keyword, offset);

      if (result.error) {
        console.error(`[TikTok Session ${sessionIndex + 1}] API error:`, result.error);
        break;
      }

      const itemList = result.data?.item_list || [];
      if (!itemList || itemList.length === 0) {
        console.log(`[TikTok Session ${sessionIndex + 1}] No more videos found`);
        break;
      }

      for (const item of itemList) {
        if (videos.length >= maxVideos) break;

        try {
          const video = item.item_info?.video;
          if (!video) continue;

          const author = item.item_info?.author;
          if (!author) continue;

          const stats = item.item_info?.statistics;

          videos.push({
            id: video.id || "",
            desc: video.desc || "",
            createTime: video.create_time || 0,
            duration: video.duration || 0,
            coverUrl: video.cover?.url_list?.[0] || "",
            playUrl: video.play_addr?.url_list?.[0] || "",
            author: {
              uniqueId: author.unique_id || "",
              nickname: author.nickname || "",
              avatarUrl: author.avatar_medium?.url_list?.[0] || "",
              followerCount: author.follower_count || 0,
              followingCount: author.following_count || 0,
              heartCount: author.heart_count || 0,
              videoCount: author.video_count || 0,
            },
            stats: {
              playCount: stats?.play_count || 0,
              diggCount: stats?.digg_count || 0,
              commentCount: stats?.comment_count || 0,
              shareCount: stats?.share_count || 0,
              collectCount: stats?.collect_count || 0,
            },
            hashtags: item.item_info?.challenges?.map((c: any) => c.title) || [],
          });
        } catch (e) {
          console.error(`[TikTok Session ${sessionIndex + 1}] Error parsing video:`, e);
        }
      }

      offset += 30;

      // レート制限対策：次のリクエスト前に待機
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1000));
    }

    console.log(`[TikTok Session ${sessionIndex + 1}] Fetched ${videos.length} videos`);
    if (onProgress) onProgress(`検索${sessionIndex + 1}: 完了 (${videos.length}件取得)`);

    return {
      videos,
      keyword,
      totalFetched: videos.length,
      sessionIndex,
    };
  } catch (error) {
    console.error(`[TikTok Session ${sessionIndex + 1}] Error in searchInIncognitoContext:`, error);
    throw error;
  } finally {
    await context.close();
  }
}

export async function searchTikTokTriple(
  keyword: string,
  maxVideos: number = 15,
  onProgress?: (message: string) => void
): Promise<TikTokTripleSearchResult> {
  puppeteerExtra.use(stealthPlugin);

  setupSwap();

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();
  console.log(`[Puppeteer searchTikTokTriple] executablePath: ${executablePath}`);
  console.log(`[Memory] Before browser launch: ${Math.round(os.freemem() / 1024 / 1024)} MB free`);

  const browser = await puppeteerExtra.launch({
    executablePath,
    headless: false, // --headless=shell を使用するため false に設定
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--single-process",
      "--headless=shell",
      "--ignore-certificate-errors",
      "--ignore-certificate-errors-spki-list",
      "--window-size=1920,1080",
      "--lang=ja-JP",
    ],
    timeout: 120000,
  });

  try {
    console.log(`[Memory] After browser launch: ${Math.round(os.freemem() / 1024 / 1024)} MB free`);

    // 3つのシークレットウィンドウで順次検索（並列ではなく順次実行）
    const searches: TikTokSearchResult[] = [];

    for (let i = 0; i < 3; i++) {
      console.log(`[TikTok] Starting search session ${i + 1}/3...`);
      const result = await searchInIncognitoContext(browser, keyword, maxVideos, i, onProgress);
      searches.push(result);

      // 次の検索前に間隔を空ける（レート制限対策）
      if (i < 2) {
        await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000));
      }
    }

    console.log(`[Memory] After all searches: ${Math.round(os.freemem() / 1024 / 1024)} MB free`);

    // 重複分析
    const videoMap = new Map<string, { video: TikTokVideo; count: number }>();

    searches.forEach((search) => {
      search.videos.forEach((video) => {
        if (videoMap.has(video.id)) {
          videoMap.get(video.id)!.count++;
        } else {
          videoMap.set(video.id, { video, count: 1 });
        }
      });
    });

    const appearedInAll3 = Array.from(videoMap.values())
      .filter((v) => v.count === 3)
      .map((v) => v.video);
    const appearedIn2 = Array.from(videoMap.values())
      .filter((v) => v.count === 2)
      .map((v) => v.video);
    const appearedIn1Only = Array.from(videoMap.values())
      .filter((v) => v.count === 1)
      .map((v) => v.video);
    const allUniqueVideos = Array.from(videoMap.values()).map((v) => v.video);

    const overlapRate = appearedInAll3.length > 0 ? (appearedInAll3.length / allUniqueVideos.length) * 100 : 0;

    return {
      searches: [searches[0], searches[1], searches[2]],
      duplicateAnalysis: {
        appearedInAll3,
        appearedIn2,
        appearedIn1Only,
        allUniqueVideos,
        overlapRate,
      },
      keyword,
    };
  } catch (error) {
    console.error("[TikTok] Error in searchTikTokTriple:", error);
    throw error;
  } finally {
    await browser.close();
    console.log(`[Memory] After browser close: ${Math.round(os.freemem() / 1024 / 1024)} MB free`);
  }
}

export async function searchTikTokVideos(
  keyword: string,
  maxVideos: number = 15
): Promise<TikTokVideo[]> {
  puppeteerExtra.use(stealthPlugin);

  setupSwap();

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();
  console.log(`[Puppeteer searchTikTokVideos] executablePath: ${executablePath}`);

  const browser = await puppeteerExtra.launch({
    executablePath,
    headless: false, // --headless=shell を使用するため false に設定
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--single-process",
      "--headless=shell",
      "--ignore-certificate-errors",
      "--ignore-certificate-errors-spki-list",
      "--window-size=1920,1080",
      "--lang=ja-JP",
    ],
    timeout: 120000,
  });

  try {
    const result = await searchInIncognitoContext(browser, keyword, maxVideos, 0);
    return result.videos;
  } catch (error) {
    console.error("[TikTok] Error in searchTikTokVideos:", error);
    throw error;
  } finally {
    await browser.close();
  }
}

/**
 * TikTok動画のコメントを取得する関数
 * ネットワーク監視を使用してコメントAPIのレスポンスを横取りする
 * 
 * 【サバイバル・ローンチ戦略】
 * - デフォルトコンテキストを再利用（browser.newPage() を削除）
 * - TargetCloseError 時に自動リトライ
 * - タイムアウトを120秒に延長
 */
export async function scrapeTikTokComments(videoUrl: string): Promise<string[]> {
  // puppeteer-extra は ESM import でトップレベルで読み込み済み
  puppeteerExtra.use(stealthPlugin);

  setupSwap();
  
  // 【サバイバル・ローンチ戦略】OSスワップの示唆
  process.env.PUPPETEER_DISABLE_HEADLESS_WARNING = 'true';
  
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();
  console.log(`[Puppeteer scrapeTikTokComments] executablePath: ${executablePath}`);
  
  // 【リトライロジック】TargetCloseError 時に自動リトライ
  let retryCount = 0;
  const maxRetries = 1;
  
  while (retryCount <= maxRetries) {
    try {
      const browser = await puppeteerExtra.launch({
        executablePath,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--single-process",
          "--ignore-certificate-errors",
          "--ignore-certificate-errors-spki-list",
          "--window-size=1920,1080",
          "--lang=ja-JP",
        ],
        timeout: 120000, // 【タイムアウトの極大化】120秒に延長
      });

      try {
        // 【デフォルトコンテキストの再利用】最初のページを取得（新しいタブを作らない）
        const pages = await browser.pages();
        const page = pages[0] || await browser.newPage();
        const comments: string[] = [];

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
        await page.goto(videoUrl, { waitUntil: "networkidle2", timeout: 120000 });

        // コメント欄を読み込ませるために、画面を少し下にスクロールする
        await page.evaluate(() => {
          window.scrollBy(0, 800);
        });

        // 通信が終わるまで数秒待機
        await new Promise((r) => setTimeout(r, 3000));

        console.log(`[TikTok Comments] Extracted ${comments.length} comments from ${videoUrl}`);
        return comments;
      } finally {
        await browser.close();
      }
    } catch (error: any) {
      // 【リトライロジック】TargetCloseError 時に自動リトライ
      if (error.name === 'TargetCloseError' && retryCount < maxRetries) {
        console.warn(`[TikTok Comments] TargetCloseError detected, retrying (${retryCount + 1}/${maxRetries})...`);
        retryCount++;
        await new Promise((r) => setTimeout(r, 2000)); // 2秒待機してリトライ
      } else {
        console.error("[TikTok Comments] Error scraping comments:", error);
        throw error;
      }
    }
  }

  return [];
}
