import puppeteer, { type Browser, type Page } from "puppeteer-core";

// TikTok内部APIから検索結果を取得するモジュール
// Puppeteerでブラウザコンテキストを作成し、内部APIを呼び出す

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
}

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }
  browserInstance = await puppeteer.launch({
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
  return browserInstance;
}

async function createPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
  );
  await page.setExtraHTTPHeaders({
    "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
  });
  return page;
}

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
        const json = await response.json();
        return { status: response.status, data: json };
      } catch (e: any) {
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

  // ハッシュタグを抽出
  const hashtags: string[] = [];
  if (v.textExtra) {
    v.textExtra.forEach((te: any) => {
      if (te.hashtagName) hashtags.push(te.hashtagName);
    });
  }
  // descからも#タグを抽出
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
      followerCount: author.followerCount || 0,
      followingCount: author.followingCount || 0,
      heartCount: author.heartCount || author.heart || 0,
      videoCount: author.videoCount || 0,
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

// メイン関数: キーワードで検索して指定件数の動画を取得
export async function searchTikTokVideos(
  keyword: string,
  maxVideos: number = 45,
  onProgress?: (fetched: number, total: number) => void
): Promise<TikTokSearchResult> {
  const browser = await getBrowser();
  const page = await createPage(browser);

  try {
    // Step 1: TikTokにアクセスしてCookieを取得
    console.log(`[TikTok] Initializing browser session...`);
    await page.goto("https://www.tiktok.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await new Promise((r) => setTimeout(r, 3000));

    // Step 2: ページネーションで動画を取得
    const allVideos: TikTokVideo[] = [];
    let offset = 0;
    const batchSize = 12; // TikTokのデフォルトバッチサイズ
    let hasMore = true;
    let retryCount = 0;
    const maxRetries = 3;

    while (allVideos.length < maxVideos && hasMore && retryCount < maxRetries) {
      console.log(
        `[TikTok] Fetching offset=${offset}, current=${allVideos.length}/${maxVideos}`
      );

      const result = await fetchSearchResults(page, keyword, offset);

      if (result.error) {
        console.error(`[TikTok] API error: ${result.error}`);
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
          `[TikTok] No more data or error status: ${result.data?.status_code}`
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
        `[TikTok] Got ${newVideos} new videos, total: ${allVideos.length}`
      );

      if (onProgress) {
        onProgress(allVideos.length, maxVideos);
      }

      if (newVideos === 0) {
        retryCount++;
      } else {
        retryCount = 0;
      }

      offset += batchSize;

      // レート制限対策: リクエスト間隔を2-4秒に設定
      const delay = 2000 + Math.random() * 2000;
      await new Promise((r) => setTimeout(r, delay));

      // has_moreフラグをチェック
      if (result.data.has_more === 0 || result.data.has_more === false) {
        hasMore = false;
      }
    }

    console.log(
      `[TikTok] Search complete: ${allVideos.length} videos for "${keyword}"`
    );

    return {
      videos: allVideos.slice(0, maxVideos),
      keyword,
      totalFetched: allVideos.length,
    };
  } finally {
    await page.close();
  }
}

// アカウント別に上位動画を取得（3アカウント × 上位15本）
export async function searchTikTokByAccounts(
  keyword: string,
  maxAccountCount: number = 3,
  videosPerAccount: number = 15,
  onProgress?: (message: string, percent: number) => void
): Promise<{
  accounts: Array<{
    uniqueId: string;
    nickname: string;
    avatarUrl: string;
    followerCount: number;
    videos: TikTokVideo[];
    totalViews: number;
    totalLikes: number;
  }>;
  allVideos: TikTokVideo[];
  keyword: string;
}> {
  // まず十分な数の動画を取得
  if (onProgress) onProgress("TikTok検索中...", 5);

  const searchResult = await searchTikTokVideos(
    keyword,
    100, // 多めに取得してアカウント別に分類
    (fetched, total) => {
      if (onProgress) {
        const percent = Math.min(40, Math.floor((fetched / total) * 40));
        onProgress(`動画データ収集中... (${fetched}/${total})`, percent);
      }
    }
  );

  if (onProgress) onProgress("アカウント別に分類中...", 45);

  // アカウント別にグループ化
  const accountMap = new Map<
    string,
    {
      uniqueId: string;
      nickname: string;
      avatarUrl: string;
      followerCount: number;
      videos: TikTokVideo[];
    }
  >();

  for (const video of searchResult.videos) {
    const key = video.author.uniqueId;
    if (!accountMap.has(key)) {
      accountMap.set(key, {
        uniqueId: video.author.uniqueId,
        nickname: video.author.nickname,
        avatarUrl: video.author.avatarUrl,
        followerCount: video.author.followerCount,
        videos: [],
      });
    }
    accountMap.get(key)!.videos.push(video);
  }

  // 動画数が多い順にソートして上位アカウントを選択
  const sortedAccounts = Array.from(accountMap.values())
    .sort((a, b) => {
      // 総再生数でソート
      const aViews = a.videos.reduce((s, v) => s + v.stats.playCount, 0);
      const bViews = b.videos.reduce((s, v) => s + v.stats.playCount, 0);
      return bViews - aViews;
    })
    .slice(0, maxAccountCount);

  // 各アカウントの上位動画を選択（再生数順）
  const accounts = sortedAccounts.map((account) => {
    const topVideos = account.videos
      .sort((a, b) => b.stats.playCount - a.stats.playCount)
      .slice(0, videosPerAccount);

    return {
      ...account,
      videos: topVideos,
      totalViews: topVideos.reduce((s, v) => s + v.stats.playCount, 0),
      totalLikes: topVideos.reduce((s, v) => s + v.stats.diggCount, 0),
    };
  });

  // 全動画をフラットにまとめる
  const allVideos = accounts.flatMap((a) => a.videos);

  if (onProgress) onProgress("データ収集完了", 50);

  return {
    accounts,
    allVideos,
    keyword,
  };
}

// ブラウザを閉じる
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
