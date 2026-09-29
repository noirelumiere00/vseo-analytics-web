#!/usr/bin/env node
// TikTok 検索スクレイパ CLI (TeamAgent tiktok_search Skill 用)
//
// 方式: Puppeteer で実ブラウザ Chrome を起動 → TikTok 検索/タグページに遷移 →
//       人間的にスクロール → 内部 API (/api/search/general/, /api/challenge/item_list/)
//       のレスポンスをネットワーク傍受でキャプチャ → 動画メタを JSON で stdout に出す。
//       X-Bogus 等の署名はブラウザ自身が生成するため外部リクエスト不要。
//
// 出典: vseo-analytics-web/server/tiktokScraper.ts の searchInIncognitoContext を
//       Mac/CLI 向けに移植・単純化 (3 重検索→単一セッション、結果は1回分)。
//
// 使い方:
//   node search.mjs --query "新宿 ランチ" --type keyword --max 10 [--out /tmp/x.json]
//   node search.mjs --query "新宿"        --type hashtag  --max 10
//
// 出力 (stdout, JSON): { ok, query, type, count, videos: [...], error }
// ブラウザのログは stderr に出す (stdout は JSON のみ = Python が parse しやすい)。

import puppeteer from "puppeteer-core";

// ---- 引数パース ----
function parseArgs(argv) {
  const a = {
    mode: "search", // "search" | "comments" | "download"
    query: "",
    type: "keyword",
    max: 10,
    url: "", // comments モードの対象動画 URL
    maxComments: 50,
    out: null,
    headful: false,
    sessions: 1, // 独立セッション数 (>1 で複数回検索→出現頻度ランク=単発失敗に強くする)
    // ---- fetch モード（動画の確実取得）----
    urlsFile: null,     // 1行1URL のファイル
    outdir: null,       // 保存先ディレクトリ
    runDir: null,       // 案件フォルダ。指定すると <run-dir>/media へ保存する
    concurrency: 3,     // 同時実行数。実測で並列3が最速（待つほど悪化する）
    maxRetries: 10,     // yt-dlp フォールバックの最大試行回数
    noFallback: false,  // 埋め込み経路が失敗しても yt-dlp を使わない
    // ---- 走査の深さ（--max all のときは自動で引き上げる）----
    maxPages: null,     // 内部APIを何ページまで追うか
    maxScroll: null,    // スクロール試行の上限
    noNewLimit: null,        // 新規0が何回続いたら諦めるか
    hasMoreFalseLimit: null, // has_more=false が何回続いたら諦めるか（一時的に false になる）
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--mode") a.mode = argv[++i];
    else if (k === "--query") a.query = argv[++i];
    else if (k === "--type") a.type = argv[++i];
    else if (k === "--max") {
      const raw = String(argv[++i]).trim().toLowerCase();
      // "all" / "0" / "max" は無制限。TikTok が has_more=false を返すまで掘る。
      a.max = (raw === "all" || raw === "max" || raw === "0") ? Infinity : (parseInt(raw, 10) || 10);
    }
    else if (k === "--max-pages") a.maxPages = Math.max(1, parseInt(argv[++i], 10) || 18);
    else if (k === "--max-scroll") a.maxScroll = Math.max(1, parseInt(argv[++i], 10) || 20);
    else if (k === "--no-new-limit") a.noNewLimit = Math.max(1, parseInt(argv[++i], 10) || 5);
    else if (k === "--has-more-false-limit") a.hasMoreFalseLimit = Math.max(1, parseInt(argv[++i], 10) || 3);
    else if (k === "--url") a.url = argv[++i];
    else if (k === "--max-comments") a.maxComments = parseInt(argv[++i], 10) || 50;
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--sessions") a.sessions = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (k === "--headful") {
      a.headful = true;
      // 画面つきで自動操作すると、かえって検知されやすくブロックを招く。
      // 別PCで「0件だったので --headful で確認」を機械的に繰り返して詰まった前歴がある
      console.error(
        "[tiktok] 警告: --headful は Chrome の画面を開きます。人が CAPTCHA の有無を目で確かめる時だけ使ってください。\n" +
        "[tiktok]        0件のときはまず `--sessions 3` で再試行を。自動実行で --headful を付けるとブロックされやすくなります。");
    }
    else if (k === "--urls-file") a.urlsFile = argv[++i];
    else if (k === "--outdir") a.outdir = argv[++i];
    else if (k === "--run-dir") a.runDir = argv[++i];
    else if (k === "--concurrency") a.concurrency = Math.max(1, parseInt(argv[++i], 10) || 3);
    else if (k === "--max-retries") a.maxRetries = Math.max(1, parseInt(argv[++i], 10) || 10);
    else if (k === "--no-fallback") a.noFallback = true;
  }
  // 無制限指定（--max all）のときは掘り切る前提で上限を引き上げる。
  // TikTok は has_more=true のまま一時的に新規0を返すことがあり（実測: page2で+0→page3で+16と復活）、
  // 既定の noNew>=5 だとそこで諦めてしまう。
  const unlimited = !Number.isFinite(a.max);
  if (a.maxPages === null) a.maxPages = unlimited ? 60 : 18;
  if (a.maxScroll === null) a.maxScroll = unlimited ? 80 : 20;
  if (a.noNewLimit === null) a.noNewLimit = unlimited ? 12 : 5;
  if (a.hasMoreFalseLimit === null) a.hasMoreFalseLimit = unlimited ? 10 : 3;
  return a;
}

const args = parseArgs(process.argv);
const log = (...m) => console.error("[tiktok]", ...m); // stderr

// ---- Chrome 実行パス自動検出 (Mac/Linux 両対応) ----
import fs from "fs";
function findChrome() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  const candidates = [
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    // Linux
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    // Windows
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    `${process.env.LOCALAPPDATA || ""}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.PROGRAMFILES || ""}\\Google\\Chrome\\Application\\chrome.exe`,
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error(
    "Chrome/Chromium が見つかりません。環境変数 CHROMIUM_PATH に実行ファイルのフルパスを設定してください。\n" +
    "  macOS  : /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n" +
    "  Windows: C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe\n" +
    "  Linux  : /usr/bin/google-chrome"
  );
}

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
];

function humanDelay(minMs, maxMs) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((r) => setTimeout(r, ms));
}

// CDN(Akamai 等)によるアクセス拒否の検出。captcha とは別物なので分けて扱う。
// これが無かったため、TikTok が "Access Denied" を返しているのに
// 「0件」として静かに返り、5軸すべて空という状態の原因が分からなかった。
async function detectCdnDenied(page) {
  try {
    return await page.evaluate(() => {
      const title = document.title || "";
      const body = (document.body && document.body.innerText || "").slice(0, 2000);
      // Akamai の定型文面。Reference # は問い合わせ番号なので拾って返す
      if (/Access Denied/i.test(title) || /You don't have permission to access/i.test(body)) {
        const m = body.match(/Reference\s*#\s*([0-9a-f.]+)/i);
        return { denied: true, reference: m ? m[1] : null, title };
      }
      if (/^\s*(403 Forbidden|Forbidden)\s*$/i.test(title)) {
        return { denied: true, reference: null, title };
      }
      return { denied: false };
    });
  } catch (e) { return { denied: false }; }
}

// captcha/verify ページの能動検出 (推測でなく実検知)。0件の原因切り分け用。
async function detectBotWall(page) {
  try {
    return await page.evaluate(() => {
      const url = location.href || "";
      const title = document.title || "";
      if (/\/(verify|captcha|security-check)/i.test(url)) return true;
      if (/captcha|verif|セキュリティ|認証|ロボットでは/i.test(title)) return true;
      const sels = [
        "#captcha-verify-page", ".captcha_verify_container", '[id*="captcha" i]',
        '[class*="captcha" i]', '[class*="Captcha"]', '[data-e2e="verify-bar"]',
      ];
      for (const s of sels) { try { if (document.querySelector(s)) return true; } catch (e) {} }
      return false;
    });
  } catch (e) { return false; }
}

// API レスポンス item → 動画オブジェクト (search/general 形式: {type:1, item:{...}})
function parseSearchItem(item) {
  if (!item || item.type !== 1 || !item.item) return null;
  return normalizeVideo(item.item);
}

// challenge / SSR 形式: 動画オブジェクト直
function normalizeVideo(v) {
  if (!v || !v.id) return null;
  const stats = v.stats || {};
  const author = v.author || {};
  const authorStats = v.authorStats || v.author_stats || {};
  const hashtags = [];
  if (Array.isArray(v.textExtra)) {
    for (const te of v.textExtra) if (te.hashtagName) hashtags.push(te.hashtagName);
  }
  const m = (v.desc || "").match(/#[\w　-鿿]+/g);
  if (m) for (const t of m) { const c = t.replace("#", ""); if (!hashtags.includes(c)) hashtags.push(c); }

  return {
    id: String(v.id),
    url: `https://www.tiktok.com/@${author.uniqueId || "_"}/video/${v.id}`,
    desc: v.desc || "",
    createTime: v.createTime || 0,
    duration: v.video?.duration || v.music?.duration || 0,
    coverUrl: v.video?.cover || v.video?.originCover || "",
    // ダウンロード用 URL（download モードが使う。検索/board には非破壊で追加するだけ）
    playAddr: v.video?.playAddr || "",
    downloadAddr: v.video?.downloadAddr || "",
    bitrateUrls: Array.isArray(v.video?.bitrateInfo)
      ? v.video.bitrateInfo.map((b) => b?.PlayAddr?.UrlList?.[0]).filter(Boolean)
      : [],
    author: {
      uniqueId: author.uniqueId || "",
      nickname: author.nickname || "",
      followerCount: author.followerCount || authorStats.followerCount || 0,
      // 追加: 投稿者の規模・信頼性（VSEO で「弱いアカウントでも入賞できるか」の判定に使う）
      heartCount: authorStats.heartCount || 0,
      videoCount: authorStats.videoCount || 0,
      verified: !!author.verified,
      secUid: author.secUid || "",
      signature: (author.signature || "").replace(/\s+/g, " ").trim(),
      // 投稿者アイコン。資料に「誰が出ているか」を実物で見せるのに要る。
      // TikTok は複数サイズを返すので大きいものから拾う。
      avatarUrl: author.avatarLarger || author.avatarMedium || author.avatarThumb || "",
    },
    stats: {
      playCount: stats.playCount || 0,
      diggCount: stats.diggCount || 0,
      commentCount: stats.commentCount || 0,
      shareCount: stats.shareCount || 0,
      collectCount: Number(stats.collectCount) || 0,
    },
    hashtags,
    music: v.music
      ? {
          title: v.music.title || "",
          authorName: v.music.authorName || "",
          original: !!v.music.original,
          id: v.music.id ? String(v.music.id) : "",
          duration: v.music.duration || 0,
          isCopyrighted: !!v.music.isCopyrighted,
        }
      : null,
    // --- 以下は内部 API に元から入っていたが捨てていた項目（2026-08-28 追加） ---
    // TikTok 自身が持つ広告フラグ。#PR 表記に頼らず PR 投稿を判定できる
    isAd: !!v.isAd,
    // 店舗/ロケーション（飲食・店舗系の案件で上位動画がどの店舗を指すか）
    poi: v.poi
      ? {
          id: v.poi.id ? String(v.poi.id) : "",
          name: v.poi.name || "",
          address: v.poi.address || "",
          city: v.poi.city || "",
        }
      : null,
    // 参加タグ企画名
    challenges: Array.isArray(v.challenges)
      ? v.challenges.map((c) => c?.title).filter(Boolean)
      : [],
    // 本文の言語（ja / th など。検索面に外国語投稿が混ざるのを検出）
    textLanguage: v.textLanguage || "",
    // 本文を行単位に分割したもの（構成分析用）
    contents: Array.isArray(v.contents)
      ? v.contents.map((c) => (c?.desc || "").trim()).filter(Boolean)
      : [],
    // video / photo(画像カルーセル) の別。photo は duration=0 になる
    mediaType: v.imagePost ? "photo" : "video",
    imageCount: v.imagePost?.images?.length || 0,
    // 動画スペック（画質・音量。サムネ/音圧の傾向分析に使う）
    videoMeta: v.video
      ? {
          width: v.video.width || 0,
          height: v.video.height || 0,
          ratio: v.video.ratio || "",
          definition: v.video.definition || "",
          size: v.video.size || 0,
          codecType: v.video.codecType || "",
          vqScore: v.video.VQScore ?? null,
          loudness: v.video.volumeInfo?.Loudness ?? null,
        }
      : null,
  };
}

async function searchOnce(browser, query, type, maxVideos) {
  const isTag = type === "hashtag";
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const allVideos = [];
  let pagesFetched = 0;
  let latestHasMore = true;
  let captchaDetected = false;
  let cdnDenied = { denied: false };
  let gridFound = false;
  let ssrCount = 0;

  const MAX_PAGES = args.maxPages;
  const MAX_SCROLL = args.maxScroll;
  const NO_NEW_LIMIT = args.noNewLimit;
  const HAS_MORE_FALSE_LIMIT = args.hasMoreFalseLimit;

  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]);
    await page.setExtraHTTPHeaders({ "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7" });

    // プロキシ認証 (任意。PROXY_USERNAME/PASSWORD があれば)
    if (process.env.PROXY_USERNAME && process.env.PROXY_PASSWORD) {
      await page.authenticate({
        username: `${process.env.PROXY_USERNAME}-session-${Date.now()}`,
        password: process.env.PROXY_PASSWORD,
      });
    }

    // 不要リソース遮断 (media/font) — 画像は残す (DOM高さ→IntersectionObserver発火に必要)
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const rt = req.resourceType();
      const u = req.url();
      if (rt === "media" || rt === "font") return req.abort();
      if (u.includes("google-analytics.com") || u.includes("googletagmanager.com") || u.includes("doubleclick.net"))
        return req.abort();
      return req.continue();
    });

    // ネットワーク傍受: 検索 API / challenge API
    page.on("response", async (resp) => {
      const url = resp.url();
      const isSearch = url.includes("/api/search/general/");
      const isChallenge = isTag && url.includes("/api/challenge/item_list/");
      if (!isSearch && !isChallenge) return;
      try {
        const text = await resp.text();
        if (!text || text.includes("<html") || text.includes("<!DOCTYPE")) return;
        const json = JSON.parse(text);
        const items = json?.data || json?.itemList || json?.item_list || [];
        let added = 0;
        for (const it of items) {
          const v = isSearch ? parseSearchItem(it) : normalizeVideo(it);
          if (v && !allVideos.find((e) => e.id === v.id)) { allVideos.push(v); added++; }
        }
        pagesFetched++;
        latestHasMore = json.has_more === true || json.has_more === 1 || json.hasMore === true;
        log(`API page ${pagesFetched}: +${added} (total ${allVideos.length}) has_more=${latestHasMore}`);
      } catch { /* 非JSONは無視 */ }
    });

    // 初回 Cookie/トークン取得 (ウォームアップ): トップで滞在＋軽いスクロール/マウスで ttwid/msToken を成熟させてから検索へ
    await page.goto("https://www.tiktok.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await humanDelay(2500, 4000);
    try {
      await page.evaluate(() => window.scrollTo(0, 600));
      await page.mouse.move(400 + Math.random() * 300, 300 + Math.random() * 200);
    } catch (e) { /* warmup は best-effort */ }
    await humanDelay(1500, 2500);

    // 検索/タグページへ
    const navUrl = isTag
      ? `https://www.tiktok.com/tag/${encodeURIComponent(query)}`
      : `https://www.tiktok.com/search?q=${encodeURIComponent(query)}`;
    log(`navigate: ${navUrl}`);
    await page.goto(navUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    const waitSel = isTag
      ? '[data-e2e="challenge-item"], [class*="DivItemContainerV2"]'
      : '[data-e2e="search_top-item-list"], [class*="DivItemContainerV2"]';
    try {
      await page.waitForSelector(waitSel, { timeout: 15000 });
      gridFound = true;
    } catch { log("grid selector timeout, continue with SSR/scroll"); }
    // captcha/verify を能動検出 (0件の原因を推測でなく実検知で切り分け)
    captchaDetected = await detectBotWall(page);
    if (captchaDetected) log("CAPTCHA/verify page detected (bot wall)");
    // CDN 拒否は captcha とは原因も打ち手も違う（待っても解けない／別回線が要る）
    cdnDenied = await detectCdnDenied(page);
    if (cdnDenied.denied) {
      log(`CDN ACCESS DENIED: ${cdnDenied.title}` +
          (cdnDenied.reference ? ` (Reference #${cdnDenied.reference})` : ""));
    }
    await humanDelay(3000, 4500);

    // SSR フォールバック (傍受で 0 件のとき埋め込み JSON から)
    if (allVideos.length === 0) {
      try {
        const ssr = await page.evaluate((tag) => {
          const el = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
          if (!el?.textContent) return null;
          try {
            const p = JSON.parse(el.textContent);
            const scope = p?.["__DEFAULT_SCOPE__"] || {};
            if (tag) {
              const cd = scope["webapp.challenge-detail"];
              return cd?.itemList || null;
            }
            return scope["webapp.search-detail"]?.data || null;
          } catch { return null; }
        }, isTag);
        if (Array.isArray(ssr)) {
          for (const it of ssr) {
            const v = isTag ? normalizeVideo(it) : parseSearchItem(it);
            if (v && !allVideos.find((e) => e.id === v.id)) { allVideos.push(v); ssrCount++; }
          }
          log(`SSR extraction: ${allVideos.length} videos (ssr+${ssrCount})`);
        }
      } catch (e) { log("SSR extraction failed:", e.message); }
    }

    // ページネーション (スクロールで内部 API を誘発)
    let noNew = 0;
    let hasMoreFalseRetries = 0;
    for (let s = 0; s < MAX_SCROLL; s++) {
      if (allVideos.length >= maxVideos) { log(`reached target ${allVideos.length}/${maxVideos}`); break; }
      if (pagesFetched >= MAX_PAGES) break;
      if (!latestHasMore && pagesFetched > 0) {
        // has_more=false は一時的なことがある（実測: page2 で false → page3 で +16 と復活）。
        // 無制限モードでは粘る回数を増やす。ここが 3 固定だと 22 件で打ち切っていた。
        if (hasMoreFalseRetries >= HAS_MORE_FALSE_LIMIT) {
          log(`has_more=false x${HAS_MORE_FALSE_LIMIT}, stop`);
          break;
        }
        hasMoreFalseRetries++;
        await humanDelay(3000, 5000);
      }
      const prev = allVideos.length;
      await page.evaluate((idx) => {
        const c = document.querySelector("#grid-main");
        if (c) c.scrollTop = c.scrollHeight;
        for (const sel of ['[data-e2e="search-common-infinite-scroll"]', '[class*="InfiniteScroll"]', '[class*="LoadMore"]']) {
          const el = document.querySelector(sel);
          if (el) { el.scrollIntoView({ behavior: "instant", block: "center" }); break; }
        }
        window.scrollTo(0, Math.max(document.body.scrollHeight, (idx + 1) * 3000));
      }, s);
      await humanDelay(3000, 4500);
      if (allVideos.length > prev) { noNew = 0; hasMoreFalseRetries = 0; }
      else {
        noNew++;
        if (noNew >= NO_NEW_LIMIT) { log(`no new data x${NO_NEW_LIMIT}, stop`); break; }
        if (noNew >= 2) await humanDelay(2000, 3000);
      }
    }

    const diag = { pagesFetched, captchaDetected, cdnDenied: cdnDenied.denied,
      cdnDeniedReference: cdnDenied.reference || null,
      gridFound, ssrCount, videosFound: allVideos.length };
    return { videos: allVideos.slice(0, maxVideos), diag };
  } finally {
    await page.close();
    await context.close();
  }
}

// 1 本の動画 URL からコメントを取得する (コメント API /api/comment/list/ を傍受)。
// 出典: vseo-analytics-web の scrapeTikTokComments を移植。スクロールで追加コメントを誘発。
async function scrapeComments(browser, videoUrl, maxComments) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const comments = [];
  const seen = new Set();

  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]);
    await page.setExtraHTTPHeaders({ "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.7" });

    if (process.env.PROXY_USERNAME && process.env.PROXY_PASSWORD) {
      await page.authenticate({
        username: `${process.env.PROXY_USERNAME}-session-${Date.now()}`,
        password: process.env.PROXY_PASSWORD,
      });
    }

    // コメント API を傍受 (json.comments[].text)
    page.on("response", async (resp) => {
      const url = resp.url();
      if (!url.includes("/api/comment/list/")) return;
      try {
        const text = await resp.text();
        if (!text || text.includes("<html")) return;
        const json = JSON.parse(text);
        for (const c of json?.comments || []) {
          const t = (c?.text || "").trim();
          if (t && !seen.has(t)) {
            seen.add(t);
            comments.push({
              text: t,
              likes: c?.digg_count || 0,
              author: c?.user?.unique_id || c?.user?.nickname || "",
            });
          }
        }
        log(`comment API: +intercepted (total ${comments.length})`);
      } catch {
        /* 非 JSON は無視 */
      }
    });

    log(`goto video: ${videoUrl}`);
    await page.goto(videoUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await humanDelay(3000, 4500);

    // コメント欄を読み込ませるためにスクロール (最大 8 回、目標件数まで)
    for (let s = 0; s < 8 && comments.length < maxComments; s++) {
      await page.evaluate(() => {
        const panel = document.querySelector(
          '[data-e2e="comment-list"], [class*="DivCommentListContainer"]',
        );
        if (panel) panel.scrollTop = panel.scrollHeight;
        window.scrollBy(0, 1000);
      });
      await humanDelay(2000, 3500);
    }
    log(`comments complete: ${comments.length}`);
    return comments.slice(0, maxComments);
  } finally {
    await page.close();
    await context.close();
  }
}

// 動画オブジェクト v から DL 候補 URL を集める（playAddr > downloadAddr > bitrate variants）。
function collectPlayAddrs(v, arr) {
  if (!v) return;
  const push = (u) => {
    if (u && typeof u === "string" && u.startsWith("http") && !arr.includes(u)) arr.push(u);
  };
  push(v.playAddr);
  push(v.downloadAddr);
  if (Array.isArray(v.bitrateInfo)) {
    for (const b of v.bitrateInfo) {
      const list = b?.PlayAddr?.UrlList;
      if (Array.isArray(list) && list.length) push(list[list.length - 1]); // 末尾=軽量画質を優先
    }
  }
}

// 1 本の動画 URL から動画バイトを取得して outPath に保存する。
// 検索と同一 Chrome session（ブラウザが署名/Cookie/UA/proxy を自前管理）で playAddr を確定し、
//  (第一) playAddr へ page.goto → response.buffer()  … ナビゲーション＝CORS非該当・最堅牢
//  (第二) goto 全滅時のみ動画ページに戻って fetch → arrayBuffer  … opaque リスク有の最後の手段
async function downloadVideoFromUrl(browser, videoUrl, outPath) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const playAddrs = [];
  let lastErr = null;
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]);
    await page.setExtraHTTPHeaders({ "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.7" });
    if (process.env.PROXY_USERNAME && process.env.PROXY_PASSWORD) {
      await page.authenticate({
        username: `${process.env.PROXY_USERNAME}-session-${Date.now()}`,
        password: process.env.PROXY_PASSWORD,
      });
    }

    // 動画詳細 API を傍受して playAddr を集める
    page.on("response", async (resp) => {
      const url = resp.url();
      if (!url.includes("/api/item/detail/") && !url.includes("/aweme/v1/")) return;
      try {
        const text = await resp.text();
        if (!text || text.includes("<html")) return;
        const json = JSON.parse(text);
        const v = json?.itemInfo?.itemStruct?.video || json?.aweme_detail?.video || null;
        collectPlayAddrs(v, playAddrs);
      } catch {
        /* 非 JSON は無視 */
      }
    });

    log(`goto video: ${videoUrl}`);
    await page.goto(videoUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await humanDelay(2500, 4000);

    // SSR フォールバック（傍受で 0 件のとき埋め込み JSON から）
    if (playAddrs.length === 0) {
      try {
        const ssrVideo = await page.evaluate(() => {
          const el = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
          if (!el?.textContent) return null;
          try {
            const p = JSON.parse(el.textContent);
            const scope = p?.["__DEFAULT_SCOPE__"] || {};
            return scope["webapp.video-detail"]?.itemInfo?.itemStruct?.video || null;
          } catch {
            return null;
          }
        });
        collectPlayAddrs(ssrVideo, playAddrs);
      } catch (e) {
        log("SSR video extraction failed:", e.message);
      }
    }
    if (playAddrs.length === 0) throw new Error("playAddr を取得できませんでした (SSR/API 双方空)");
    log(`playAddr candidates: ${playAddrs.length}`);

    let buf = null;
    let mime = "video/mp4";

    // 第一: tiktok.com origin に留まったまま fetch（ブラウザが Cookie/UA/Referer/proxy を自前付与）。
    // TikTok web プレイヤー自身が同じ署名URLを fetch するため、同origin文脈が最も自然に通る。
    // ※媒体URLへ page.goto すると 'load' を待ち続けてハングするため、ナビゲーションは使わない。
    for (const addr of playAddrs) {
      const got = await page.evaluate(async (u) => {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 25000);
          const r = await fetch(u, { credentials: "include", signal: ctrl.signal });
          clearTimeout(t);
          if (!r.ok) return { ok: false, status: r.status };
          const ab = await r.arrayBuffer();
          const bytes = new Uint8Array(ab);
          let s = "";
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
          }
          return { ok: true, b64: btoa(s), ct: r.headers.get("content-type") || "" };
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) };
        }
      }, addr);
      if (got && got.ok && got.b64) {
        const cand = Buffer.from(got.b64, "base64");
        if (cand.length > 0) {
          buf = cand;
          if (got.ct) mime = got.ct;
          log(`downloaded via in-page fetch (${cand.length} bytes)`);
          break;
        }
      } else {
        lastErr = new Error("fetch: " + JSON.stringify(got));
        log("fetch candidate failed:", JSON.stringify(got));
      }
    }

    // 第二: fetch が opaque/失敗のとき、commit 待ちナビゲーション + response.buffer()。
    // waitUntil:"commit" は応答受信時点で解決＝媒体URLで load を待ち続けるハングを避ける。
    if (!buf) {
      for (const addr of playAddrs) {
        try {
          const resp = await page.goto(addr, { waitUntil: "commit", timeout: 25000 });
          if (resp && resp.ok()) {
            const b = await resp.buffer();
            if (b && b.length > 0) {
              buf = b;
              mime = resp.headers()["content-type"] || mime;
              log(`downloaded via page.goto/commit (${b.length} bytes)`);
              break;
            }
          }
        } catch (e) {
          lastErr = e;
          log("goto candidate failed:", String((e && e.message) || e));
        }
      }
    }
    if (!buf || buf.length === 0) {
      throw new Error("動画バイト取得失敗 " + (lastErr ? String(lastErr.message || lastErr) : ""));
    }
    mime = String(mime).split(";")[0].trim() || "video/mp4"; // charset 等を落とす
    fs.writeFileSync(outPath, buf);
    return { savedTo: outPath, mime, bytes: buf.length };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

function buildChromeArgs() {
  const chromeArgs = [
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
    "--disable-gpu", "--window-size=1280,900", "--lang=ja-JP",
  ];
  if (process.env.PROXY_SERVER) {
    chromeArgs.push(`--proxy-server=${process.env.PROXY_SERVER}`);
    // 証明書検証は既定で有効にする。以前は「PROXY_KYC_VERIFIED=true でない限り無効」
    // という既定だったため、プロキシを設定しただけで黙って検証が外れていた。
    // 外すのは明示的に PROXY_INSECURE=true を置いたときだけにし、警告を出す。
    if (process.env.PROXY_INSECURE === "true") {
      chromeArgs.push("--ignore-certificate-errors");
      console.error("[warn] PROXY_INSECURE=true のため TLS 証明書の検証を無効にして起動します。"
        + "通信内容が第三者に読まれうる状態です。社内プロキシの自己署名CAが原因なら、"
        + "CA を OS の信頼ストアに入れるほうが安全です。");
    }
  }
  return chromeArgs;
}

// ---- main: comments モード ----
async function mainComments() {
  const result = { ok: false, mode: "comments", url: args.url, count: 0, comments: [], error: null };
  if (!args.url || !args.url.includes("tiktok.com")) {
    result.error = "有効な TikTok 動画 URL が必要です (--url)";
    process.stdout.write(JSON.stringify(result), () => process.exit(2));
  }
  let browser;
  try {
    const chrome = findChrome();
    log(`launch chrome: ${chrome} (headless=${!args.headful})`);
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: !args.headful,
      args: buildChromeArgs(),
    });
    const comments = await scrapeComments(browser, args.url, args.maxComments);
    result.ok = comments.length > 0;
    result.count = comments.length;
    result.comments = comments;
    if (comments.length === 0) {
      result.error = "コメントを取得できませんでした (非公開/0件/captcha の可能性)";
    }
  } catch (e) {
    result.error = String((e && e.message) || e);
    log("ERROR:", result.error);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  const out = JSON.stringify(result);
  if (args.out) fs.writeFileSync(args.out, out);
  process.stdout.write(out, () => process.exit(result.ok ? 0 : 2));
}

// ---- main: download モード ----
// バイトは --out（ファイル）に保存し、stdout には薄いメタ JSON のみ出す
// （巨大 base64 で stdout を汚さない＝Python の subprocess capture を膨らませない）。
async function mainDownload() {
  const result = {
    ok: false, mode: "download", url: args.url,
    savedTo: null, mime: null, bytes: 0, error: null,
  };
  if (!args.url || !args.url.includes("tiktok.com")) {
    result.error = "有効な TikTok 動画 URL が必要です (--url)";
    process.stdout.write(JSON.stringify(result), () => process.exit(2));
  }
  if (!args.out) {
    result.error = "保存先 --out が必要です (バイトは stdout に載せません)";
    process.stdout.write(JSON.stringify(result), () => process.exit(2));
  }
  let browser;
  try {
    const chrome = findChrome();
    log(`launch chrome: ${chrome} (headless=${!args.headful})`);
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: !args.headful,
      args: buildChromeArgs(),
    });
    const dl = await downloadVideoFromUrl(browser, args.url, args.out);
    result.ok = dl.bytes > 0;
    result.savedTo = dl.savedTo;
    result.mime = dl.mime;
    result.bytes = dl.bytes;
    if (!result.ok) result.error = "動画バイトを取得できませんでした";
  } catch (e) {
    result.error = String((e && e.message) || e);
    log("ERROR:", result.error);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  process.stdout.write(JSON.stringify(result), () => process.exit(result.ok ? 0 : 2));
}

// ---- main ----

// ============================================================================
// fetch モード: 動画を確実に取得する
// ----------------------------------------------------------------------------
// 動画ページ (/@user/video/<id>) は初回HTMLに rehydration データが入るか否かが
// 確率事象で、実測の単発成功率は約 22〜26%。yt-dlp も search.mjs --mode download も
// 同じ壁に当たる。一方 **埋め込みページ (/embed/v2/<id>)** は第三者サイト埋め込み用で
// 保護が軽く、実測 12/12 + 独立検証 2/2 でプレイヤーがレンダリングされた。
//
// 署名 playAddr は CDN が CORS を許さないため page 内 fetch では取れない（実測 0/6）。
// そこで CDP Fetch ドメインで **プレイヤー自身が出すメディアリクエスト** を捕まえ、
// Request 段で Range を落として 200 全長にし、Response 段で本体を回収する。
// 署名の偽造も CAPTCHA 回避もしていない（ブラウザが作った正規リクエストを読むだけ）。
// ============================================================================

async function launchBrowser() {
  return puppeteer.launch({
    executablePath: findChrome(),
    headless: !args.headful,
    args: [...buildChromeArgs(), "--autoplay-policy=no-user-gesture-required"],
  });
}

const MEDIA_URL_RE = /mime_type=video_mp4|\/video\/tos\//;
// 写真投稿の BGM。写真投稿は audio_path が無いと ASR に回らないため取得する。
const AUDIO_URL_RE = /mime_type=audio|\/audio\/tos\/|\.(?:m4a|mp3)(?:\?|$)/i;
// 写真投稿（Photo Mode）の画像。アバター（tos-*-avt-*）と区別するため photomode を必須にする。
const PHOTO_URL_RE = /i-photomode/;

// 署名クエリが付くため、URL 全体ではなくパス末尾のファイルIDで突き合わせる。
function mediaKey(u) {
  const m = String(u).match(/\/([0-9a-f]{16,})~/);
  return m ? m[1] : String(u).split("?")[0];
}

function videoIdFromUrl(u) {
  const m = String(u || "").match(/\/(?:video|photo)\/(\d+)/);
  return m ? m[1] : null;
}

// 埋め込みページ経由で1本取得する。動画投稿と写真投稿(Photo Mode)の両方を1回の
// ページ読み込みで扱う。動画なら {ok,bytes,contentType,kind:"video"}、
// 写真なら {ok,bytes,files,kind:"photo"} を返す。
async function fetchViaEmbed(browser, url, outPath, budgetMs = 45000) {
  const id = videoIdFromUrl(url);
  if (!id) return { ok: false, error: "URL から動画IDを取り出せません" };
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const deadline = Date.now() + budgetMs;
  let videoBuf = null, videoCt = "";
  const photoBufs = new Map(); // mediaKey -> {buf, ct}
  let audioBuf = null, audioCt = "";
  try {
    await page.setUserAgent(EMBED_UA);
    await page.setViewport({ width: 1280, height: 900 });
    const cdp = await page.createCDPSession();
    await cdp.send("Fetch.enable", {
      patterns: [
        { urlPattern: "*", requestStage: "Request" },
        { urlPattern: "*", requestStage: "Response" },
      ],
    });
    const gotVideo = new Promise((resolve) => {
      cdp.on("Fetch.requestPaused", async (ev) => {
        const u = ev.request.url;
        try {
          if (ev.responseStatusCode === undefined) {
            if (MEDIA_URL_RE.test(u) || AUDIO_URL_RE.test(u)) {
              // Range を外して全長 200 を要求する（206 の分割だと本体を取り切れない）
              const headers = Object.entries(ev.request.headers)
                .filter(([k]) => k.toLowerCase() !== "range")
                .map(([name, value]) => ({ name, value }));
              await cdp.send("Fetch.continueRequest", { requestId: ev.requestId, headers });
            } else {
              await cdp.send("Fetch.continueRequest", { requestId: ev.requestId });
            }
            return;
          }
          const cth = (ev.responseHeaders || []).find((h) => h.name.toLowerCase() === "content-type");
          const ct = cth ? cth.value : "";
          // content-type を必須にする。URL パターンだけで判定すると
          // サムネイル JPEG を動画として保存する誤検知が起きる。
          if (MEDIA_URL_RE.test(u) && /^video\//i.test(ct) && !videoBuf) {
            const r = await cdp.send("Fetch.getResponseBody", { requestId: ev.requestId }).catch(() => null);
            if (r && r.body) {
              const b = Buffer.from(r.body, r.base64Encoded ? "base64" : "utf8");
              if (b.length > 10000) { videoBuf = b; videoCt = ct; resolve(); }
            }
          } else if (!audioBuf && /^audio\//i.test(ct) && AUDIO_URL_RE.test(u)) {
            const r = await cdp.send("Fetch.getResponseBody", { requestId: ev.requestId }).catch(() => null);
            if (r && r.body) {
              const b = Buffer.from(r.body, r.base64Encoded ? "base64" : "utf8");
              if (b.length > 5000) { audioBuf = b; audioCt = ct; }
            }
          } else if (PHOTO_URL_RE.test(u) && /^image\//i.test(ct)) {
            const k = mediaKey(u);
            if (!photoBufs.has(k)) {
              const r = await cdp.send("Fetch.getResponseBody", { requestId: ev.requestId }).catch(() => null);
              if (r && r.body) {
                const b = Buffer.from(r.body, r.base64Encoded ? "base64" : "utf8");
                if (b.length > 3000) photoBufs.set(k, { buf: b, ct });
              }
            }
          }
          await cdp.send("Fetch.continueResponse", { requestId: ev.requestId }).catch(() => {});
        } catch { /* 競合したリクエストは無視してよい */ }
      });
    });

    await page.goto(`https://www.tiktok.com/embed/v2/${id}`, { waitUntil: "domcontentloaded", timeout: 30000 });

    // 動画投稿なら <video>.src が入る。写真投稿なら i-photomode の <img> が並ぶ。
    const shape = await page
      .waitForFunction(() => {
        const v = document.querySelector("video");
        if (v && (v.src || v.currentSrc)) return { kind: "video" };
        const imgs = [...document.querySelectorAll("img")]
          .map((i) => i.src || "")
          .filter((s) => /i-photomode/.test(s));
        if (imgs.length) return { kind: "photo", srcs: imgs };
        return null;
      }, { timeout: 25000, polling: 300 })
      .then((h) => h.jsonValue())
      .catch(() => null);

    if (!shape) return { ok: false, error: "埋め込みプレイヤーが描画されませんでした (非公開/削除済みの可能性)" };

    if (shape.kind === "video") {
      // 自動再生されない環境向けの保険。実データを読ませてメディアリクエストを発火させる。
      await page.evaluate(() => {
        const v = document.querySelector("video");
        if (v) { v.muted = true; v.play().catch(() => {}); }
      }).catch(() => {});
      await Promise.race([gotVideo, new Promise((r) => setTimeout(r, Math.max(1000, deadline - Date.now())))]);
      if (!videoBuf || !videoBuf.length) return { ok: false, error: "メディア本体を回収できませんでした" };
      fs.mkdirSync(pathDirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, videoBuf);
      return { ok: true, kind: "video", bytes: videoBuf.length, contentType: videoCt };
    }

    // ---- 写真投稿 ----
    // BGM を鳴らして音声リクエストを発火させる（写真投稿は <video> が無いので
    // <audio> か Web Audio 経由。自動再生されないことがあるため明示的に再生する）。
    await page.evaluate(() => {
      document.querySelectorAll("audio,video").forEach((el) => {
        try { el.muted = true; el.play().catch(() => {}); } catch {}
      });
      const btn = document.querySelector('[class*="Play"],[aria-label*="Play"],[data-e2e*="play"]');
      if (btn) btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }).catch(() => {});
    // カルーセルを一巡させて未ロードの画像も読み込ませる。
    const wanted = shape.srcs.length;
    for (let i = 0; i < 12 && photoBufs.size < wanted && Date.now() < deadline; i++) {
      await page.evaluate(() => {
        const imgs = [...document.querySelectorAll("img")];
        imgs.forEach((im) => im.scrollIntoView({ block: "center" }));
        const next = document.querySelector('[class*="Next"],[aria-label*="Next"],[data-e2e*="next"]');
        if (next) next.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }).catch(() => {});
      await new Promise((r) => setTimeout(r, 700));
    }
    // 取得できたバイトを DOM の表示順に並べる（順番は分析の前提なので崩さない）。
    // 分析モジュール(extract_signals.py)は media/<id>_photos/NN.jpg を期待する。
    // ここを <id>/ にすると写真が1枚も認識されない。
    const dir = outPath.replace(/\.mp4$/i, "") + "_photos";
    fs.mkdirSync(dir, { recursive: true });
    const files = [];
    shape.srcs.forEach((src, idx) => {
      const hit = photoBufs.get(mediaKey(src));
      if (!hit) return;
      const ext = /png/i.test(hit.ct) ? "png" : "jpg";
      const fp = `${dir}/${String(idx + 1).padStart(2, "0")}.${ext}`;
      fs.writeFileSync(fp, hit.buf);
      files.push({ order: idx + 1, path: fp, bytes: hit.buf.length });
    });
    if (!files.length) return { ok: false, error: `写真を回収できませんでした (DOM上は ${wanted} 枚)` };
    let audioPath = null;
    if (audioBuf && audioBuf.length) {
      const aext = /mp4|m4a|aac/i.test(audioCt) ? "m4a" : "mp3";
      audioPath = `${dir.replace(/_photos$/, "")}_audio.${aext}`;
      fs.writeFileSync(audioPath, audioBuf);
    }
    const total = files.reduce((a, f) => a + f.bytes, 0) + (audioBuf ? audioBuf.length : 0);
    return {
      ok: true, kind: "photo", bytes: total, files,
      audioPath, audioBytes: audioBuf ? audioBuf.length : 0,
      // 表示順に並べた枚数と、DOM で見えた枚数。欠けたら「未取得」として残す。
      imageCount: files.length, imageCountExpected: wanted,
      contentType: "image/*",
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }
}

const EMBED_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function pathDirname(p) {
  const i = String(p).replace(/\\/g, "/").lastIndexOf("/");
  return i <= 0 ? "." : String(p).slice(0, i);
}

// 保存した媒体に音声トラックがあるかを ffprobe で判定する。
// 分析モジュールは has_audio===false の投稿を ASR から外すので、
// 未設定のままだと無音動画にも文字起こしを走らせて時間を無駄にする。
async function probeHasAudio(filePath) {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v", "error", "-select_streams", "a",
      "-show_entries", "stream=codec_type", "-of", "csv=p=0", filePath,
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d.toString(); });
    p.on("close", () => resolve(/audio/.test(out)));
    p.on("error", () => resolve(null)); // ffprobe が無い環境は未判定(null)にする
  });
}

// yt-dlp フォールバック。
// 実測: 待つほど悪化する（指数バックオフが最悪）。失敗は「窓」でクラスタするため
// 単一URLを連打するより固定短待機で回すほうがよい。--compat-options no-certifi は
// 企業プロキシの自己署名CA環境で「映像だけ取れて音声取得がSSLで落ち、不完全ファイルになる」
// 事故を防ぐ（検証を無効化する --no-check-certificates とは別物）。
async function fetchViaYtDlp(url, outPath, maxRetries) {
  const { spawn } = await import("node:child_process");
  const run = () =>
    new Promise((resolve) => {
      const p = spawn("yt-dlp", [
        "--compat-options", "no-certifi",
        "--no-warnings", "-q",
        "-f", "mp4/best[height<=720]",
        "-o", outPath,
        url,
      ], { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      p.stderr.on("data", (d) => { err += d.toString().slice(0, 400); });
      p.on("close", () => resolve(err));
      p.on("error", (e) => resolve(String(e.message)));
    });
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const err = await run();
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
      return { ok: true, bytes: fs.statSync(outPath).size, attempts: attempt };
    }
    if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 3000));
    if (attempt === maxRetries) return { ok: false, error: (err || "取得失敗").trim().slice(0, 160), attempts: attempt };
  }
  return { ok: false, error: "取得失敗", attempts: maxRetries };
}

async function mainFetch() {
  const result = { ok: false, mode: "fetch", requested: 0, succeeded: 0, failed: 0, outdir: args.outdir, items: [], error: null };
  let urls = [];
  if (args.urlsFile) {
    if (!fs.existsSync(args.urlsFile)) {
      result.error = `--urls-file が見つかりません: ${args.urlsFile}`;
      process.stdout.write(JSON.stringify(result), () => process.exit(2));
      return;
    }
    urls = fs.readFileSync(args.urlsFile, "utf-8").split("\n").map((s) => s.trim()).filter(Boolean);
  } else if (args.url) {
    urls = args.url.split(",").map((s) => s.trim()).filter(Boolean);
  }
  urls = [...new Set(urls)];
  if (!urls.length) {
    result.error = "--url または --urls-file で対象URLを指定してください";
    process.stdout.write(JSON.stringify(result), () => process.exit(2));
    return;
  }
  // 分析モジュールは acquire_log の絶対パスが <run-dir>/media 配下にあることを要求する
  // （safe_acquired_path が media_dir の外を弾く）。--run-dir を使えばここを間違えない。
  const outdir = args.runDir ? `${args.runDir.replace(/\/$/, "")}/media` : (args.outdir || "./media");
  fs.mkdirSync(outdir, { recursive: true });
  result.requested = urls.length;
  result.outdir = outdir;

  const browser = await launchBrowser();
  const queue = urls.slice();
  const items = [];
  // 実測で並列3が最速（1本あたり 6.3s）。待機を伸ばすほど悪化する。
  const workers = Array.from({ length: Math.min(args.concurrency, urls.length) }, async () => {
    for (;;) {
      const url = queue.shift();
      if (!url) return;
      const id = videoIdFromUrl(url) || String(items.length + 1);
      const outPath = `${outdir}/${id}.mp4`;
      const t0 = Date.now();
      let r = await fetchViaEmbed(browser, url, outPath);
      let via = "embed";
      if (!r.ok && !args.noFallback) {
        log(`embed 失敗 → yt-dlp へフォールバック: ${id} (${r.error})`);
        const y = await fetchViaYtDlp(url, outPath, args.maxRetries);
        if (y.ok) { r = y; via = `yt-dlp(${y.attempts}回目)`; }
        else r = { ok: false, error: `embed: ${r.error} / yt-dlp: ${y.error}` };
      }
      const isPhoto = r.ok && r.kind === "photo";
      items.push({
        video_id: id, url, ok: !!r.ok, via: r.ok ? via : null,
        kind: r.ok ? (r.kind || "video") : null,
        bytes: r.bytes || 0,
        // 写真投稿は1本＝複数ファイルなので、保存先はディレクトリになる
        path: r.ok ? (isPhoto ? outPath.replace(/\.mp4$/i, "") : outPath) : null,
        image_count: isPhoto ? r.imageCount : null,
        audio_path: isPhoto ? (r.audioPath || null) : null,
        audio_bytes: isPhoto ? (r.audioBytes || 0) : 0,
        image_count_expected: isPhoto ? r.imageCountExpected : null,
        files: isPhoto ? r.files : null,
        error: r.ok ? null : r.error, seconds: +((Date.now() - t0) / 1000).toFixed(1),
      });
      const detail = r.ok
        ? (isPhoto
            ? `写真 ${r.imageCount}/${r.imageCountExpected} 枚 ${r.bytes}B 音声:${r.audioPath ? "取得" : "未取得"} via ${via}`
            : `${r.bytes}B via ${via}`)
        : r.error;
      log(`${r.ok ? "OK " : "NG "} ${id} ${((Date.now() - t0) / 1000).toFixed(1)}s ${detail}`);
    }
  });
  await Promise.all(workers);
  await browser.close().catch(() => {});

  items.sort((a, b) => urls.indexOf(a.url) - urls.indexOf(b.url));

  // ---- 分析モジュール向けの取得台帳（acquire_log.jsonl）----
  // extract_signals.py は media/acquire_log.jsonl を読んで解析対象を決める。
  // これが無いと媒体が実在しても target=0 / exit=0 で「対象なし」として
  // 静かに通過してしまう（納品書のない納品と同じ）。形式は acquire_media.py と揃える。
  const logLines = [];
  for (const it of items) {
    if (!it.ok) {
      logLines.push(JSON.stringify({
        video_id: it.video_id, status: "failed", error: it.error,
        method: "search.mjs:fetch", url: it.url,
      }));
      continue;
    }
    if (it.kind === "photo") {
      logLines.push(JSON.stringify({
        video_id: it.video_id, status: "ok", media_type: "photo",
        photo_paths: (it.files || []).map((f) => f.path),
        photo_count: it.image_count,
        photo_count_expected: it.image_count_expected,
        // 写真投稿の音声は基本 BGM のみで、投稿者自身の発話は入らない。
        // したがって ASR に回さないのが正しい:
        //   1. 発話が無いので文字起こしする対象がない
        //   2. 楽曲の歌詞をキーワード一致として拾うと「音声で言及された」という
        //      誤った計上になる（4経路指標を汚す）
        // voice_channel を not_applicable にして、分析側が「未計測(0件ではない)」でも
        // 「0件」でもなく「対象外」として分母から外せるようにする。
        audio_path: it.audio_path || null,
        has_audio: it.audio_path ? true : false,
        voice_channel: "not_applicable",
        voice_channel_reason: "写真投稿はBGMのみで投稿者の発話が無い前提。楽曲歌詞の誤計上を避けるためASR対象外",
        bytes: it.bytes, method: "search.mjs:fetch(embed)", url: it.url,
      }));
    } else {
      const hasAudio = await probeHasAudio(it.path);
      logLines.push(JSON.stringify({
        video_id: it.video_id, status: "ok", media_type: "video",
        path: it.path, has_audio: hasAudio,
        bytes: it.bytes, method: `search.mjs:fetch(${it.via})`, url: it.url,
      }));
    }
  }
  const logPath = `${outdir}/acquire_log.jsonl`;
  // 追記ではなく上書きにしていたため、2回目の fetch（下位群の追加取得など）で
  // 1回目の記録が消え、signals だけが残って extract_signals が KeyError で落ちていた。
  // 同じ video_id は新しい結果で置き換え、それ以外は残す。
  let merged = new Map();
  if (fs.existsSync(logPath)) {
    for (const line of fs.readFileSync(logPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec && rec.video_id) merged.set(rec.video_id, line);
      } catch (_) {
        // 壊れた行は捨てずに残す（黙って消すと取得漏れが見えなくなる）
        merged.set(`__broken_${merged.size}`, line);
      }
    }
  }
  for (const line of logLines) {
    try {
      const rec = JSON.parse(line);
      if (rec && rec.video_id) merged.set(rec.video_id, line);
    } catch (_) {
      merged.set(`__new_${merged.size}`, line);
    }
  }
  fs.writeFileSync(logPath, Array.from(merged.values()).join("\n") + "\n");
  result.acquire_log = logPath;
  log(`acquire_log.jsonl を書き出しました (${logLines.length}件)`);

  result.items = items;
  result.succeeded = items.filter((i) => i.ok).length;
  result.failed = items.length - result.succeeded;
  result.ok = result.failed === 0;
  // 取りこぼしを黙って消さないための注記。失敗は「0件」ではなく「取得失敗」として扱う。
  result.by_kind = {
    video: items.filter((i) => i.ok && i.kind === "video").length,
    photo: items.filter((i) => i.ok && i.kind === "photo").length,
  };
  result.note = result.failed
    ? `${result.failed}/${result.requested} 件が取得失敗。これらを0件として集計しないこと。`
    : `${result.succeeded}/${result.requested} 件すべて取得`;

  const out = JSON.stringify(result, null, 2);
  if (args.out) fs.writeFileSync(args.out, out);
  process.stdout.write(out, () => process.exit(result.ok ? 0 : 3));
}

async function main() {
  if (args.mode === "comments") {
    await mainComments();
    return;
  }
  if (args.mode === "download") {
    await mainDownload();
    return;
  }
  if (args.mode === "fetch") {
    await mainFetch();
    return;
  }
  if (!args.query) {
    process.stdout.write(JSON.stringify({ ok: false, error: "query が空です" }), () => process.exit(1));
  }
  let browser;
  const result = { ok: false, query: args.query, type: args.type, count: 0, videos: [], error: null, errorCode: null, diag: null };
  try {
    const chrome = findChrome();
    log(`launch chrome: ${chrome} (headless=${!args.headful}) sessions=${args.sessions}`);
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: !args.headful,
      args: buildChromeArgs(),
    });

    let videos = [];
    let diag = { pagesFetched: 0, captchaDetected: false, cdnDenied: false,
      cdnDeniedReference: null, gridFound: false, ssrCount: 0, sessionsRun: 0 };

    if (args.sessions <= 1) {
      // 単一セッション (既定・低レイテンシ)
      const r = await searchOnce(browser, args.query, args.type, args.max);
      videos = r.videos;
      diag = { ...r.diag, sessionsRun: 1 };
      // タグ空振り → keyword 検索フォールバック (検索 API は安定)
      if (videos.length === 0 && args.type === "hashtag") {
        log("hashtag 空振り → keyword 検索にフォールバック");
        const r2 = await searchOnce(browser, args.query, "keyword", args.max);
        videos = r2.videos;
        diag = { ...r2.diag, sessionsRun: 1 };
        if (videos.length > 0) result.type = "keyword(fallback)";
      }
    } else {
      // 複数セッション順次 → 出現頻度ランク (1回失敗しても他で代替=単発失敗に強い。VSEO の triple search 方式)
      const freq = new Map();
      for (let si = 0; si < args.sessions; si++) {
        if (si > 0) await humanDelay(10000, 20000); // セッション間ギャップ (同一IP連打回避)
        const r = await searchOnce(browser, args.query, args.type, args.max);
        diag.sessionsRun++;
        diag.pagesFetched += r.diag.pagesFetched;
        diag.captchaDetected = diag.captchaDetected || r.diag.captchaDetected;
        diag.cdnDenied = diag.cdnDenied || r.diag.cdnDenied;
        diag.cdnDeniedReference = diag.cdnDeniedReference || r.diag.cdnDeniedReference || null;
        diag.gridFound = diag.gridFound || r.diag.gridFound;
        diag.ssrCount += r.diag.ssrCount;
        for (const v of r.videos) {
          const e = freq.get(v.id);
          if (e) { e.count++; } else { freq.set(v.id, { video: v, count: 1 }); }
        }
        log(`session ${si + 1}/${args.sessions}: unique ${freq.size}`);
      }
      videos = [...freq.values()]
        .sort((a, b) => b.count - a.count || (b.video.stats.playCount - a.video.stats.playCount))
        .map((x) => x.video)
        .slice(0, args.max);
    }

    result.ok = videos.length > 0;
    result.count = videos.length;
    result.videos = videos;
    result.diag = diag;
    // 並び順の出所を必ず出す。--sessions >1 は出現回数×再生数で並べ替えるので、
    // これを「検索表示順」として扱うと順位の章がまるごと嘘になる。
    result.order_basis = args.sessions <= 1 ? "search_display_order" : "frequency_then_playcount";
    result.order_basis_note = (args.sessions <= 1
      ? "TikTok の検索結果に出てきた順そのもの。順位として使える"
      : "複数セッションの和集合を『出現回数→再生数』で並べ替えた順。順位として使えない");
    if (videos.length === 0) {
      // 推測でなく診断で分類: captcha実検知 or 傍受0回 → BOT_WALL / API応答あり0件 → TRULY_EMPTY
      if (diag.cdnDenied) {
        result.errorCode = "TIKTOK_CDN_DENIED";
        result.error = "TIKTOK_CDN_DENIED: TikTok の CDN がこの出口IPからのアクセスを拒否している"
          + (diag.cdnDeniedReference ? ` (Reference #${diag.cdnDeniedReference})` : "")
          + "。待っても解けない。別の回線から実行するか、時間を置いて再試行する。"
          + "UA偽装やIPローテーションでの回避はしないこと";
      } else if (diag.captchaDetected) {
        result.errorCode = "TIKTOK_BOT_WALL";
        result.error = "TIKTOK_BOT_WALL: captcha/verify ページを検知 (Bot対策に阻まれた)";
      } else if (diag.pagesFetched === 0) {
        result.errorCode = "TIKTOK_BOT_WALL";
        result.error = "TIKTOK_BOT_WALL: 内部API応答0回 (Bot壁/DC-IP評価/署名欠落の可能性)";
      } else {
        result.errorCode = "TIKTOK_TRULY_EMPTY";
        result.error = "TIKTOK_TRULY_EMPTY: API応答はあるが該当動画0件";
      }
    }
  } catch (e) {
    result.error = String((e && e.message) || e);
    result.errorCode = "TIKTOK_EXCEPTION";
    log("ERROR:", result.error);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  const out = JSON.stringify(result);
  if (args.out) fs.writeFileSync(args.out, out);
  process.stdout.write(out, () => process.exit(result.ok ? 0 : 2));
}

main();
