# TikTokスクレイピング 4段構え実装ガイド

## 目的

現在のTikTok検索スクレイパー（`server/tiktokScraper.ts`）は、1セッションあたり最大12件しか動画を取得できない。
本ガイドに従い、**4段構えのフォールバック戦略**で確実に30件以上の動画を取得できるように改修する。

---

## 現状の問題点

### 現在のアーキテクチャ
```
searchTikTokTriple()
  └─ 3回のシークレットセッション (順次実行)
       └─ searchInIncognitoContext(maxVideos=15)
            └─ fetchSearchResults(page, keyword, offset)
                 ← page.evaluate() 内で fetch() を直接実行
                 endpoint: /api/search/general/full/
                 offset: 0, 12, 24...
                 batchSize: 12
```

### 12件で止まる原因
1. `page.evaluate()` 内の `fetch()` はブラウザの自然なXHR通信と異なり、TikTokのBot検出に引っかかりやすい
2. TikTokの検索APIが `has_more=false` を1バッチ目で返す（セッションの信頼スコアが低い場合）
3. offset=12 以降のリクエストで空レスポンスが返り、`retryCount` が3に達してループ終了

---

## 改修方針: 4段構えフォールバック戦略

```
┌──────────────────────────────────────────────────────────┐
│  Phase 1: SSR埋め込みJSON抽出（即時、~12件）               │
│  __UNIVERSAL_DATA_FOR_REHYDRATION__ からパース              │
│  → 最も高速。ページロード時点で取得可能                      │
└──────────────────┬───────────────────────────────────────┘
                   │ まだ < 30件
┌──────────────────▼───────────────────────────────────────┐
│  Phase 2+3: 自動スクロール + DOM抽出 + ネットワーク監視     │
│  （Phase 2 と Phase 3 は同時並行で実行）                    │
│                                                           │
│  Phase 2: DOM から動画カードを querySelectorAll で抽出      │
│  Phase 3: page.on('response') で API レスポンスを横取り     │
│  → スクロールのたびに両方からデータを収集                    │
└──────────────────┬───────────────────────────────────────┘
                   │ まだ < 30件
┌──────────────────▼───────────────────────────────────────┐
│  Phase 4: 直接API呼び出し（cursorベース、最終フォールバック）│
│  Phase 3 で取得した cursor を使って API を直接呼び出す       │
│  → 現在の fetchSearchResults() をフォールバックとして使用    │
└──────────────────────────────────────────────────────────┘

最終: 全 Phase の結果を動画ID で重複排除して統合
```

---

## 変更対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `server/tiktokScraper.ts` | `searchInIncognitoContext()` を4段構えに書き換え |
| `server/routers.ts` | `videosPerSearch` を `15` → `30` に変更 |

**注意: 以下は変更しない**
- `TikTokVideo` / `TikTokSearchResult` / `TikTokTripleSearchResult` のインターフェース定義（既存のまま）
- `searchTikTokTriple()` の3セッション構造（既存のまま）
- `analyzeDuplicates()` 関数（既存のまま）
- `parseVideoData()` 関数（既存のまま。Phase 3/4 で引き続き使用）
- `fetchSearchResults()` 関数（既存のまま。Phase 4 のフォールバックとして使用）

---

## Phase 1: SSR埋め込みJSON抽出

### 概要
TikTokの検索ページには `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">` というタグが埋め込まれている。
ここにサーバーサイドレンダリング(SSR)された初回バッチのデータ（約12件）がJSON形式で格納されている。

### 実装手順

検索ページへの遷移後（`page.goto()` の後）、以下のコードで SSR データを抽出する。

```typescript
// Phase 1: SSR埋め込みJSON抽出
async function extractSSRData(page: Page): Promise<TikTokVideo[]> {
  const ssrVideos = await page.evaluate(() => {
    const script = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
    if (!script || !script.textContent) return null;

    try {
      const data = JSON.parse(script.textContent);
      const scope = data['__DEFAULT_SCOPE__'];
      if (!scope) return null;

      // 検索結果ページのキーを探す
      // TikTokはキー名を変更することがあるので複数パターンを試行する
      const searchData =
        scope['webapp.search-detail'] ||
        scope['webapp.search'] ||
        scope['seo.search'] ||
        null;

      if (!searchData) {
        // キーが見つからない場合、scope の全キーを返して調査可能にする
        return { keys: Object.keys(scope), items: [] };
      }

      // 動画リストを探す（TikTokのバージョンによりパスが異なる）
      const itemList =
        searchData.itemList ||
        searchData.items ||
        searchData.data ||
        [];

      return { keys: Object.keys(scope), items: itemList };
    } catch (e) {
      return null;
    }
  });

  if (!ssrVideos || !ssrVideos.items || ssrVideos.items.length === 0) {
    console.log(`[Phase 1] SSRデータなし or 動画0件 (keys: ${ssrVideos?.keys?.join(', ') || 'N/A'})`);
    return [];
  }

  // parseVideoData() で統一フォーマットに変換
  // SSRデータの構造は API レスポンスと異なる可能性があるため、
  // 両方のパターンに対応する変換を行う
  const videos: TikTokVideo[] = [];
  for (const item of ssrVideos.items) {
    // APIレスポンスと同じ { type: 1, item: {...} } 形式の場合
    const video = parseVideoData(item);
    if (video) {
      videos.push(video);
      continue;
    }
    // SSR独自の形式の場合（itemが直接動画データの場合）
    const videoAlt = parseVideoData({ type: 1, item: item });
    if (videoAlt) {
      videos.push(videoAlt);
    }
  }

  console.log(`[Phase 1] SSRから ${videos.length} 件取得`);
  return videos;
}
```

### 注意事項
- TikTokは `__UNIVERSAL_DATA_FOR_REHYDRATION__` 内のキー名を頻繁に変更する
  - 過去の例: `webapp.search-detail`, `webapp.search`, `seo.search`
  - 旧形式: `SIGI_STATE` というIDの `<script>` タグが使われていた
- SSRデータに `stats`（再生数等）が含まれない場合がある。その場合は後続の Phase で補完する
- **Phase 1 だけで30件取れることは期待しない**。あくまで初期データとして活用

---

## Phase 2: DOM抽出（自動スクロールと同時実行）

### 概要
検索結果ページのDOM上にレンダリングされた動画カード要素から、`querySelectorAll` でデータを直接抽出する。
スクロールのたびにDOMを再スキャンし、新たに描画された動画カードを拾う。

### DOMセレクタ一覧

以下のセレクタを**優先度順**に試行する。TikTokはセレクタを頻繁に変更するため、複数パターンで冗長化する。

```typescript
// 動画カード要素のセレクタ（優先度順）
const VIDEO_CARD_SELECTORS = [
  '[data-e2e="search_top-item"]',        // 検索トップ結果
  '[data-e2e="search-card-desc"]',        // 検索カード説明
  'div[class*="DivItemContainer"]',       // 汎用コンテナ（CSS Modules ハッシュ付き）
  'div[class*="DivVideoCard"]',           // 動画カード
];

// 動画リンクのセレクタ（全パターン共通）
const VIDEO_LINK_SELECTOR = 'a[href*="/video/"]';

// ログインモーダル閉じるボタン
const MODAL_CLOSE_SELECTORS = [
  '[data-e2e="modal-close-inner-button"]',
  'button[aria-label="Close"]',
  'div[role="dialog"] button',
];
```

### 実装手順

```typescript
// Phase 2: DOM から動画情報を抽出
async function extractFromDOM(page: Page): Promise<Array<{ id: string; desc: string; authorUniqueId: string; coverUrl: string; hashtags: string[] }>> {
  return page.evaluate(() => {
    const results: Array<{ id: string; desc: string; authorUniqueId: string; coverUrl: string; hashtags: string[] }> = [];

    // 全ての動画リンクを取得
    const videoLinks = document.querySelectorAll('a[href*="/video/"]');

    for (const link of Array.from(videoLinks)) {
      const href = (link as HTMLAnchorElement).href;
      // URL から動画IDを抽出: https://www.tiktok.com/@user/video/1234567890
      const videoIdMatch = href.match(/\/video\/(\d+)/);
      if (!videoIdMatch) continue;

      const videoId = videoIdMatch[1];

      // 既に取得済みならスキップ
      if (results.find(r => r.id === videoId)) continue;

      // 親要素から説明文・投稿者・カバー画像を探す
      const card = link.closest('div[class*="Container"], div[class*="Card"], div[data-e2e]') || link.parentElement;

      let desc = '';
      let authorUniqueId = '';
      let coverUrl = '';
      const hashtags: string[] = [];

      if (card) {
        // 説明文
        const descEl = card.querySelector('[data-e2e="search-card-desc"], span[class*="SpanText"], p, span');
        if (descEl) desc = descEl.textContent || '';

        // 投稿者（@username リンクから取得）
        const authorLink = card.querySelector('a[href^="/@"]');
        if (authorLink) {
          const authorMatch = (authorLink as HTMLAnchorElement).href.match(/\/@([^/?]+)/);
          if (authorMatch) authorUniqueId = authorMatch[1];
        }

        // カバー画像
        const img = card.querySelector('img[src*="tiktokcdn"], img[src*="tiktok"]');
        if (img) coverUrl = (img as HTMLImageElement).src;

        // ハッシュタグ
        const hashtagEls = card.querySelectorAll('a[href*="/tag/"], a[data-e2e="search-common-link"]');
        hashtagEls.forEach(el => {
          const tagMatch = (el as HTMLAnchorElement).href.match(/\/tag\/([^/?]+)/);
          if (tagMatch) hashtags.push(decodeURIComponent(tagMatch[1]));
        });

        // テキストからもハッシュタグ抽出
        const textHashtags = desc.match(/#[\w\u3000-\u9FFF]+/g);
        if (textHashtags) {
          textHashtags.forEach(tag => {
            const cleaned = tag.replace('#', '');
            if (!hashtags.includes(cleaned)) hashtags.push(cleaned);
          });
        }
      }

      results.push({ id: videoId, desc, authorUniqueId, coverUrl, hashtags });
    }

    return results;
  });
}
```

### DOM抽出データの制限
DOM からは以下のデータが**取得できない**:
- `stats`（playCount, diggCount, commentCount, shareCount, collectCount）
- `author` の詳細情報（followerCount, heartCount, videoCount）
- `createTime`
- `duration`
- `playUrl` / `downloadAddr`

これらは Phase 3（ネットワーク監視）の API レスポンスで補完する。

---

## Phase 3: ネットワーク監視（自動スクロールと同時実行）

### 概要
`page.on('response')` でTikTokがスクロール時に自動的に発行する内部APIのレスポンスを横取りし、構造化されたJSONデータを取得する。
**既にコメント取得（`scrapeTikTokComments` L660-711）で同じパターンを実装済み。**

### 実装手順

```typescript
// Phase 3: ネットワーク監視セットアップ
// ※ page.goto() の「前」にセットアップすること（遷移時のレスポンスも捕捉するため）

interface NetworkCaptureState {
  videos: TikTokVideo[];
  lastCursor: number | string | null;
  hasMore: boolean;
  rawResponses: any[];  // デバッグ用
}

function setupNetworkInterception(page: Page): NetworkCaptureState {
  const state: NetworkCaptureState = {
    videos: [],
    lastCursor: null,
    hasMore: true,
    rawResponses: [],
  };

  page.on('response', async (response) => {
    const url = response.url();

    // 検索API のレスポンスを横取り
    if (
      (url.includes('/api/search/general/full') || url.includes('/api/search/item/full')) &&
      response.status() === 200
    ) {
      try {
        const json = await response.json();
        state.rawResponses.push(json);

        if (json.status_code === 0 && json.data) {
          for (const item of json.data) {
            const video = parseVideoData(item);
            if (video && !state.videos.find(v => v.id === video.id)) {
              state.videos.push(video);
            }
          }
        }

        // cursor と has_more を更新
        if (json.cursor !== undefined) {
          state.lastCursor = json.cursor;
        }
        if (json.has_more === 0 || json.has_more === false) {
          state.hasMore = false;
        }

        console.log(`[Phase 3] API横取り: ${state.videos.length}件 (cursor=${state.lastCursor}, hasMore=${state.hasMore})`);
      } catch (e) {
        // response.json() が失敗する場合がある（既にbodyが消費済み等）
        // 無視して続行
      }
    }
  });

  return state;
}
```

### 重要なポイント
1. **`page.goto()` の前にセットアップする**こと。ページ遷移時にTikTokが自動発行する最初のAPI呼び出しも捕捉できる
2. `response.json()` は1回しか呼べない。`response.text()` → `JSON.parse()` の方が安全な場合もある
3. API の URL パターンは `/api/search/general/full` と `/api/search/item/full` の2種類がある

---

## Phase 2+3 統合: 自動スクロールループ

### 概要
Phase 2（DOM抽出）と Phase 3（ネットワーク監視）は**自動スクロール中に同時に動作する**。
スクロールのたびにDOMとネットワーク両方からデータを収集し、重複排除して統合する。

### 実装手順

```typescript
async function scrollAndCollect(
  page: Page,
  networkState: NetworkCaptureState,
  maxVideos: number,
  sessionIndex: number,
  onProgress?: (message: string) => void
): Promise<TikTokVideo[]> {
  const maxScrollAttempts = 25;  // 最大スクロール回数
  let noNewVideoCount = 0;
  let prevTotalCount = 0;

  // ログインモーダルを閉じる（表示されている場合）
  try {
    const closeBtn = await page.$(
      '[data-e2e="modal-close-inner-button"], button[aria-label="Close"], div[role="dialog"] button'
    );
    if (closeBtn) {
      await closeBtn.click();
      console.log(`[Session ${sessionIndex + 1}] ログインモーダルを閉じた`);
      await new Promise(r => setTimeout(r, 1000));
    }
    // ESCキーでも試す
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 500));
  } catch (e) {
    // モーダルがなければ無視
  }

  for (let i = 0; i < maxScrollAttempts; i++) {
    // --- Phase 2: DOM から抽出 ---
    const domResults = await extractFromDOM(page);

    // DOM結果を networkState.videos とマージ
    // （networkState.videos には Phase 3 の結果が随時追加されている）
    for (const domItem of domResults) {
      if (!networkState.videos.find(v => v.id === domItem.id)) {
        // DOMからしか取れなかった動画 → stats は空のまま仮登録
        networkState.videos.push({
          id: domItem.id,
          desc: domItem.desc,
          createTime: 0,
          duration: 0,
          coverUrl: domItem.coverUrl,
          playUrl: '',
          author: {
            uniqueId: domItem.authorUniqueId,
            nickname: '',
            avatarUrl: '',
            followerCount: 0,
            followingCount: 0,
            heartCount: 0,
            videoCount: 0,
          },
          stats: {
            playCount: 0,
            diggCount: 0,
            commentCount: 0,
            shareCount: 0,
            collectCount: 0,
          },
          hashtags: domItem.hashtags,
        });
      }
    }

    const currentTotal = networkState.videos.length;
    console.log(`[Session ${sessionIndex + 1}] スクロール ${i + 1}/${maxScrollAttempts}: DOM=${domResults.length}件, 合計=${currentTotal}件`);

    if (onProgress) {
      onProgress(`検索${sessionIndex + 1}: ${currentTotal}/${maxVideos}件取得中 (スクロール ${i + 1})`);
    }

    // 目標達成チェック
    if (currentTotal >= maxVideos) {
      console.log(`[Session ${sessionIndex + 1}] 目標 ${maxVideos} 件達成`);
      break;
    }

    // 新規動画が増えなくなったら終了判定
    if (currentTotal === prevTotalCount) {
      noNewVideoCount++;
      if (noNewVideoCount >= 4) {
        console.log(`[Session ${sessionIndex + 1}] 4回連続で新規動画なし → スクロール終了`);
        break;
      }
    } else {
      noNewVideoCount = 0;
    }
    prevTotalCount = currentTotal;

    // スクロール実行（人間らしいランダムな動き）
    const scrollDistance = 600 + Math.floor(Math.random() * 400); // 600-1000px
    await page.evaluate((dist) => window.scrollBy(0, dist), scrollDistance);

    // ランダムな待機時間（人間らしさ + API応答待ち）
    const delay = 2000 + Math.random() * 2000; // 2-4秒
    await new Promise(r => setTimeout(r, delay));
  }

  return networkState.videos;
}
```

---

## Phase 4: 直接API呼び出し（フォールバック）

### 概要
Phase 2+3 で目標件数に達しなかった場合、Phase 3 で取得した `cursor` を使って既存の `fetchSearchResults()` を直接呼び出す。
**既存関数をそのまま使用する。**

### 実装手順

```typescript
async function fallbackDirectAPI(
  page: Page,
  keyword: string,
  currentVideos: TikTokVideo[],
  lastCursor: number | string | null,
  maxVideos: number,
  sessionIndex: number
): Promise<TikTokVideo[]> {
  console.log(`[Session ${sessionIndex + 1}][Phase 4] 直接API呼び出しフォールバック開始 (現在${currentVideos.length}件)`);

  const batchSize = 12;
  let offset = lastCursor ? Number(lastCursor) : currentVideos.length;
  let retryCount = 0;
  const maxRetries = 3;

  while (currentVideos.length < maxVideos && retryCount < maxRetries) {
    // 既存の fetchSearchResults() をそのまま使用
    const result = await fetchSearchResults(page, keyword, offset);

    if (result.error) {
      console.log(`[Phase 4] API エラー: ${result.error}`);
      retryCount++;
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    if (!result.data || result.data.status_code !== 0 || !result.data.data) {
      console.log(`[Phase 4] データなし or エラーステータス`);
      break;
    }

    let newVideos = 0;
    for (const item of result.data.data) {
      const video = parseVideoData(item);
      if (video && !currentVideos.find(v => v.id === video.id)) {
        currentVideos.push(video);
        newVideos++;
        if (currentVideos.length >= maxVideos) break;
      }
    }

    console.log(`[Phase 4] +${newVideos}件, 合計=${currentVideos.length}件`);

    if (newVideos === 0) {
      retryCount++;
    } else {
      retryCount = 0;
    }

    // cursor ベースのページネーション（固定offset より cursor を優先）
    if (result.data.cursor) {
      offset = Number(result.data.cursor);
    } else {
      offset += batchSize;
    }

    if (result.data.has_more === 0 || result.data.has_more === false) {
      break;
    }

    const delay = 1500 + Math.random() * 2000;
    await new Promise(r => setTimeout(r, delay));
  }

  return currentVideos;
}
```

---

## searchInIncognitoContext の書き換え

### 概要
上記4つの Phase を統合し、既存の `searchInIncognitoContext()` を書き換える。

### 書き換え方針
- 関数シグネチャは変更しない（既存の呼び出し元に影響しない）
- 内部のデータ取得ロジックのみ置き換える
- `fetchSearchResults()` 関数は削除しない（Phase 4 で使用）

### 書き換え後の全体フロー

```typescript
async function searchInIncognitoContext(
  browser: Browser,
  keyword: string,
  maxVideos: number,       // ← routers.ts から 30 が渡される
  sessionIndex: number,
  onProgress?: (message: string) => void
): Promise<TikTokSearchResult> {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  try {
    // ─── ブラウザ設定（既存コードと同じ） ───
    await page.setViewport({ width: 800, height: 600 });
    await page.setUserAgent(USER_AGENTS[sessionIndex % USER_AGENTS.length]);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
    });

    // プロキシ設定（既存コードと同じ）
    // ... 省略（現在の L197-213 をそのまま使用）...

    // リクエストインターセプト（既存コードと同じ）
    // ... 省略（現在の L215-257 をそのまま使用）...

    // プロキシ接続確認（既存コードと同じ）
    // ... 省略（現在の L261-283 をそのまま使用）...

    // ─── Phase 3: ネットワーク監視セットアップ（遷移前に設定） ───
    const networkState = setupNetworkInterception(page);

    // ─── TikTokにアクセスしてCookie取得（既存コードと同じ） ───
    if (onProgress) onProgress(`検索${sessionIndex + 1}: ブラウザ初期化中...`);
    await page.goto('https://www.tiktok.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));

    // ─── 検索ページに遷移 ───
    if (onProgress) onProgress(`検索${sessionIndex + 1}: 検索ページに遷移中...`);
    await page.goto(
      `https://www.tiktok.com/search?q=${encodeURIComponent(keyword)}`,
      { waitUntil: 'domcontentloaded', timeout: 30000 }
    );
    await new Promise(r => setTimeout(r, 3000));

    // ─── Phase 1: SSR データ抽出 ───
    if (onProgress) onProgress(`検索${sessionIndex + 1}: SSRデータ抽出中...`);
    const ssrVideos = await extractSSRData(page);

    // SSR結果を networkState にマージ
    for (const video of ssrVideos) {
      if (!networkState.videos.find(v => v.id === video.id)) {
        networkState.videos.push(video);
      }
    }
    console.log(`[Session ${sessionIndex + 1}] Phase 1 完了: ${networkState.videos.length}件`);

    // ─── Phase 2+3: 自動スクロール + DOM抽出 + ネットワーク監視 ───
    if (networkState.videos.length < maxVideos) {
      if (onProgress) onProgress(`検索${sessionIndex + 1}: スクロールでデータ収集中...`);
      await scrollAndCollect(page, networkState, maxVideos, sessionIndex, onProgress);
    }
    console.log(`[Session ${sessionIndex + 1}] Phase 2+3 完了: ${networkState.videos.length}件`);

    // ─── Phase 4: 直接API呼び出しフォールバック ───
    if (networkState.videos.length < maxVideos) {
      if (onProgress) onProgress(`検索${sessionIndex + 1}: API直接呼び出しで追加取得中...`);
      await fallbackDirectAPI(
        page,
        keyword,
        networkState.videos,
        networkState.lastCursor,
        maxVideos,
        sessionIndex
      );
    }
    console.log(`[Session ${sessionIndex + 1}] Phase 4 完了: ${networkState.videos.length}件`);

    // ─── 最終結果 ───
    const finalVideos = networkState.videos.slice(0, maxVideos);
    console.log(`[Session ${sessionIndex + 1}] 最終結果: ${finalVideos.length}件`);

    return {
      videos: finalVideos,
      keyword,
      totalFetched: finalVideos.length,
      sessionIndex,
    };
  } finally {
    await page.close();
    await context.close();
  }
}
```

---

## routers.ts の変更

### 変更箇所: L233-235

```typescript
// 変更前
const tripleResult = await searchTikTokTriple(
  job.keyword,
  15, // 各セッション15件

// 変更後
const tripleResult = await searchTikTokTriple(
  job.keyword,
  30, // 各セッション30件（4段構えで確実に取得）
```

---

## データ補完ロジック

Phase 2（DOM）で取得した動画は `stats` が空（全て0）になる。
Phase 3（ネットワーク監視）の API レスポンスに同じ動画IDのデータがあれば、`stats` を補完する。

### 補完タイミング
`scrollAndCollect()` 内の各スクロールループで、DOM取得済みの動画に対して networkState からstatsを補完する。

```typescript
// DOM で仮登録した動画の stats を、ネットワーク監視で取得したデータで補完
function mergeVideoData(videos: TikTokVideo[]): void {
  const videoMap = new Map<string, TikTokVideo>();

  for (const video of videos) {
    const existing = videoMap.get(video.id);
    if (!existing) {
      videoMap.set(video.id, video);
    } else {
      // stats が空（全て0）のものを、stats が入っているもので上書き
      if (existing.stats.playCount === 0 && video.stats.playCount > 0) {
        existing.stats = video.stats;
      }
      if (existing.author.followerCount === 0 && video.author.followerCount > 0) {
        existing.author = video.author;
      }
      if (!existing.createTime && video.createTime) {
        existing.createTime = video.createTime;
      }
      if (!existing.duration && video.duration) {
        existing.duration = video.duration;
      }
      if (!existing.playUrl && video.playUrl) {
        existing.playUrl = video.playUrl;
      }
    }
  }
}
```

---

## テスト・検証方法

### 動作確認ログ
各 Phase の結果をログ出力する。正常に動作していれば以下のようなログが出る:

```
[Session 1] Phase 1 完了: 12件
[Session 1] スクロール 1/25: DOM=12件, 合計=14件
[Session 1] スクロール 2/25: DOM=18件, 合計=20件
[Session 1] スクロール 3/25: DOM=24件, 合計=26件
[Session 1] スクロール 4/25: DOM=30件, 合計=32件
[Session 1] 目標 30 件達成
[Session 1] Phase 2+3 完了: 32件
[Session 1] 最終結果: 30件
```

### Phase 別の取得件数確認
ログに各 Phase の貢献件数を記録して、どの Phase が最も効いているかを確認する:

```
[Session 1] 取得内訳: Phase1(SSR)=12件, Phase2(DOM)=+8件, Phase3(API横取り)=+12件, Phase4(直接API)=+0件
```

---

## 実装時の注意事項

### 1. TikTokの構造変更への対応
- TikTokはDOMセレクタ、API エンドポイント、SSR データ構造を頻繁に変更する
- 各 Phase が独立して機能するため、1つの Phase が壊れても他の Phase でカバーできる
- 変更を検知するためにログを充実させる

### 2. レート制限
- スクロール間隔は最低 2 秒以上空ける
- 3セッションは順次実行する（並列にしない）
- セッション間は 3-5 秒の間隔を空ける（既存コード L592-596 と同じ）

### 3. メモリ管理
- `networkState.rawResponses` はデバッグ用。本番では無効化するか上限を設ける
- 画像・メディア・フォントのブロック（既存の request interception）は維持する

### 4. 既存コードの保持
- `fetchSearchResults()` は Phase 4 で使うため削除しない
- `parseVideoData()` は全 Phase で共有するため変更しない
- `analyzeDuplicates()` は入力データの件数が増えるだけなので変更不要
- `searchTikTokTriple()` の3セッション構造はそのまま維持

### 5. エラーハンドリング
- 各 Phase は独立して try-catch で囲む
- 1つの Phase が失敗しても次の Phase に進む
- Phase 3 の `response.json()` は body 消費済みエラーが出やすいので必ず try-catch

---

## まとめ

| 項目 | 変更前 | 変更後 |
|------|--------|--------|
| 取得方式 | 直接API 1本 | 4段構え (SSR + DOM + ネットワーク監視 + 直接API) |
| 1セッションの目標件数 | 15件 | 30件 |
| 実際の取得件数 | ~12件 | 30件以上 |
| Bot検出リスク | 高 | 低（自然なスクロール動作） |
| 3セッション合計 | ~36件 (重複含む) | ~90件 (重複含む) |
| ユニーク動画数 | ~20-25件 | ~50-70件 |
