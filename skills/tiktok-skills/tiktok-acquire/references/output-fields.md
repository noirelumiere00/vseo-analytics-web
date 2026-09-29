# 出力フィールド仕様

`search.mjs` が返す JSON の構造。`tiktok_report.py` はこれを読んで CSV / Markdown を作る。

## トップレベル

```json
{
  "ok": true,
  "query": "メガ割",
  "type": "keyword",
  "count": 30,
  "videos": [ ... ],
  "diag": { "pagesFetched": 3, "captchaDetected": false, "gridFound": true, "videosFound": 42 },
  "error": null
}
```

- `videos` の**配列順が検索表示順**。これが本スキルの中核。ソートし直すと意味が失われる
- `diag.captchaDetected` が `true` のときは取得が信用できない。再試行せず人に委ねる
- `ok: false` のときは `error` に理由が入る。**取得失敗を「0件」として集計しない**

## videos[] の各要素

| フィールド | 型 | 内容 |
|---|---|---|
| `id` | string | 動画 ID |
| `url` | string | 投稿 URL。証拠リンクの基点 |
| `desc` | string | 本文（キャプション）全文 |
| `createTime` | number | 投稿日時（UNIX 秒） |
| `duration` | number | 尺（秒）。画像投稿では音源の尺で補完される |
| `coverUrl` | string | カバー画像 URL |
| `playAddr` / `downloadAddr` | string | 動画の実ファイル URL |
| `bitrateUrls` | string[] | 画質別の URL |
| `hashtags` | string[] | ハッシュタグ（`#` なし） |

### author

| フィールド | 内容 |
|---|---|
| `uniqueId` | @ID |
| `nickname` | 表示名 |
| `followerCount` | フォロワー数 |
| `heartCount` | 総いいね数 |
| `videoCount` | 投稿本数 |
| `verified` | 認証バッジ |
| `secUid` | 内部ID（ユーザーの投稿一覧取得に必要） |
| `signature` | プロフィール文 |

### stats

| フィールド | 内容 |
|---|---|
| `playCount` | 再生数 |
| `diggCount` | いいね数 |
| `commentCount` | コメント数 |
| `shareCount` | シェア数 |
| `collectCount` | **保存数** |

保存率 = `collectCount / playCount`。ENG率 = `(digg + comment + share + collect) / playCount`。

### music

`title` / `authorName` / `original`（オリジナル音源か） / `id` / `duration` / `isCopyrighted`

### そのほか

| フィールド | 内容 |
|---|---|
| `isAd` | **TikTok 自身が持つ広告フラグ**。`#PR` 表記に依存しない PR 判定 |
| `poi` | 店舗・ロケーション `{ id, name, address, city }` |
| `challenges` | 参加しているタグ企画名 |
| `textLanguage` | 本文の言語（`ja` / `th` など）。外国語投稿の混入検出に使う |
| `contents` | 本文を行単位に分割した配列。構成分析用 |
| `mediaType` | `"video"` または `"photo"`（画像カルーセル） |
| `imageCount` | 画像投稿の枚数 |
| `videoMeta` | `{ width, height, ratio, definition, size, codecType, vqScore, loudness }` |

## コメント取得モード

```bash
node search.mjs --mode comments --url "<投稿URL>" --max-comments 50
```

```json
{ "ok": true, "mode": "comments", "url": "...", "count": 50,
  "comments": [ { "text": "...", "likes": 12, "author": "..." } ] }
```

## CSV の列

`tiktok_report.py` が出力する CSV は次の順。BOM 付き UTF-8。

```
rank, uniqueId, nickname, follower, verified, play, digg, comment, share, collect,
save_rate, eng_rate, posted, days_ago, is_ad, duration, media, lang, poi, music,
hashtags, desc, url
```

`save_rate` / `eng_rate` はパーセント値（小数3桁）。`posted` は JST。

## fetch モード（動画取得）の出力

```bash
node search.mjs --mode fetch --urls-file urls.txt --outdir ./media --out manifest.json
```

```json
{
  "ok": true, "mode": "fetch",
  "requested": 4, "succeeded": 4, "failed": 0,
  "outdir": "./media",
  "items": [
    { "video_id": "7678263728046902535",
      "url": "https://www.tiktok.com/@u/video/7678263728046902535",
      "ok": true, "via": "embed", "bytes": 15160499,
      "path": "./media/7678263728046902535.mp4",
      "error": null, "seconds": 12.8 }
  ],
  "note": "4/4 件すべて取得"
}
```

- `via` は `embed`（埋め込みページ経由）か `yt-dlp(N回目)`（フォールバック）
- **これは取得台帳である。** `failed` が 0 でない場合、それらを「0件」として集計しない。
  `note` に警告文が入るので、資料には「取得失敗 N 件」と明記すること
- 終了コード: 全件成功 `0` / 1件でも失敗 `3` / 引数不正 `2`

### 主なオプション

| オプション | 既定 | 意味 |
|---|---|---|
| `--urls-file` | — | 1行1URL のファイル |
| `--url` | — | URL をカンマ区切りで直接指定 |
| `--outdir` | `./media` | 保存先 |
| `--concurrency` | `3` | 同時実行数。**実測で 3 が最速** |
| `--max-retries` | `10` | yt-dlp フォールバックの最大試行 |
| `--no-fallback` | off | 埋め込み経路のみ（yt-dlp を使わない） |
