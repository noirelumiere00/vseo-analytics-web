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
  "diag": { "pagesFetched": 3, "captchaDetected": false, "cdnDenied": false,
            "cdnDeniedReference": null, "gridFound": true, "ssrCount": 0,
            "videosFound": 42, "apiNonZeroStatus": [], "stop_reason": "capped", "sessionsRun": 1 },
  "error": null,
  "errorCode": null,
  "stop_reason": "capped",
  "order_basis": "search_display_order",
  "order_basis_note": "TikTok の検索結果に出てきた順そのもの。順位として使える"
}
```

- `videos` の**配列順が検索表示順**。これが本スキルの中核。ソートし直すと意味が失われる
- `type`: `keyword` / `hashtag` / `keyword(fallback)`（ハッシュタグ検索が0件でキーワード検索に切り替えた。単一セッションのみ）
- `order_basis`: `search_display_order`（`--sessions 1`。順位として使える）/ `frequency_then_playcount`（`--sessions >1`。順位として使えない）
- `diag.captchaDetected` が `true` のときは取得が信用できない。再試行せず人に委ねる。
  URL・タイトルに含まれる検索語そのもの（『顔認証』『#verified』等）では判定しない
- `diag.cdnDenied` / `cdnDeniedReference`: CDN（Akamai）の Access Denied と問い合わせ番号
- `diag.apiNonZeroStatus`: 内部APIが返した 0 以外の `status_code`（あれば 0件でも `TRULY_EMPTY` にしない）
- `fetched_at`（UTC の ISO 時刻）/ `fetched_on`（実行したPCのローカル日付 YYYY-MM-DD）: 取得した日時。初訪資料の「取得日」はこれを使う（ファイルの更新日時はコピーで変わるので使わない）
- `stop_reason`（`diag.stop_reason` にも同じ値）: 走査の終わり方。`exhausted`＝has_more=false が上限回数続いた（この検索で取れる全件＝下限値）/
  `no_new`＝新規0が上限回数続いた / `capped`＝`--max`・ページ数・スクロール回数の上限で止めた（母数未確定）/
  `unknown`＝それ以外（例外で中断、複数セッションで終わり方がばらばら等）。tiktok-deck の付録が読む
- `diag.partial: true` / `diag.partialError`: 途中の例外で打ち切った部分結果。表示順の先頭としては正しいが網羅ではない（通常は項目自体が無い）
- `ok: false` のときは `error` と `errorCode` に理由が入る。**取得失敗を「0件」として集計しない**
  - `TIKTOK_CDN_DENIED`: 出口IPが CDN に拒否された。待っても解けない
  - `TIKTOK_BOT_WALL`: captcha 実検知 / 内部API応答0回 / API が `status_code≠0` を返した
  - `TIKTOK_TRULY_EMPTY`: API は正常応答（`status_code` 0）だが0件。1回だけでは「該当なし」と確定しない
  - `TIKTOK_EXCEPTION`: 例外（Chrome が無い等。`error` に理由）
- 終了コード: 1件以上 `0` / 0件・失敗 `2` / `--query` が空 `1`（いずれも stdout は JSON 1個だけ）

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
| `hashtags` | string[] | ハッシュタグ（`#` なし）。TikTok の正規化名（textExtra）と本文中の `#`/`＃` タグの和集合。大小文字違いは1つにまとめ、先に出た表記を残す |
| `missingFields` | string[] | API に無かった項目（`stats.playCount` / `author.followerCount` / `isAd` 等）。`stats.*` は後方互換で 0 のまま出すので、「本当に0」と「未取得」はここで区別する（`followerCount` / `isAd` は未取得なら `null`）。通常は `[]` |

### author

| フィールド | 内容 |
|---|---|
| `uniqueId` | @ID |
| `nickname` | 表示名 |
| `followerCount` | フォロワー数。取れなかったときは `null`（未取得）。`0` は TikTok が 0 と返したときだけ |
| `heartCount` | 総いいね数 |
| `videoCount` | 投稿本数 |
| `verified` | 認証バッジ |
| `secUid` | 内部ID（ユーザーの投稿一覧取得に必要） |
| `signature` | プロフィール文 |
| `avatarUrl` | 投稿者アイコンの URL（大きいサイズ優先） |

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
| `isAd` | **TikTok 配信側の有料広告フラグ**（`true` / `false` / 未取得は `null`）。`#PR` 表記（投稿者の開示）とは別物で、`#PR` 付きタイアップでも `false` になる。PR 判定を `isAd` だけで代用しない |
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

重複はコメントID（無ければ本文＋投稿者）で除く。別ユーザーの同じ短文（『欲しい』等）は別々に数える。

## CSV の列

`tiktok_report.py` が出力する CSV は次の順。BOM 付き UTF-8。

```
rank, uniqueId, nickname, follower, verified, play, digg, comment, share, collect,
save_rate, eng_rate, posted, days_ago, is_ad, duration, media, lang, poi, music,
hashtags, desc, url, pr_tag, pr_any, duration_source
```

`save_rate` / `eng_rate` はパーセント値（小数3桁）。再生 0・未取得で率が定義できないときは空欄。`posted` は JST。
`is_ad` / `follower` は空欄＝未取得。`pr_tag` は `#PR` タグ（正規化後の完全一致）、`pr_any` は `pr_tag` または `is_ad`。
`duration_source` は `video` か `music_fallback`（写真投稿の `duration` は音源の長さで、投稿の尺ではない）。
末尾3列は追加分（既存列の順は変えていない）。

`tiktok_report.py` の `.json` は `search.mjs` の結果オブジェクト（上記トップレベル）をそのまま保存する。
（以前は `videos` 配列だけで、`build_dataset.py` に渡すと order_basis の確認で落ちていた。
古い配列形式のファイルは取り直すこと）

## fetch モード（動画取得）の出力

```bash
node search.mjs --mode fetch --urls-file urls.txt --run-dir <run-dir> --out manifest.json
```

```json
{
  "ok": true, "mode": "fetch",
  "requested": 4, "succeeded": 4, "failed": 0,
  "outdir": "/abs/path/<run-dir>/media",
  "acquire_log": "/abs/path/<run-dir>/media/acquire_log.jsonl",
  "duplicate_urls": [],
  "items": [
    { "video_id": "7678263728046902535",
      "url": "https://www.tiktok.com/@u/video/7678263728046902535",
      "ok": true, "via": "embed", "kind": "video", "bytes": 15160499,
      "path": "/abs/path/<run-dir>/media/7678263728046902535.mp4",
      "image_count": null, "image_count_expected": null,
      "audio_path": null, "audio_bytes": 0, "files": null, "partial": false,
      "error": null, "seconds": 12.8 },
    { "video_id": "7600000000000000001", "ok": true, "via": "embed", "kind": "photo",
      "path": "/abs/path/<run-dir>/media/7600000000000000001_photos",
      "image_count": 3, "image_count_expected": 3,
      "audio_path": "/abs/path/<run-dir>/media/7600000000000000001_photo_audio.m4a",
      "files": [ { "order": 1, "path": ".../7600000000000000001_photos/01.jpg", "bytes": 81234 } ] }
  ],
  "by_kind": { "video": 3, "photo": 1 },
  "note": "4/4 件すべて取得"
}
```

- パスはすべて**絶対パス**（`--run-dir` / `--outdir` を相対で渡しても絶対化する）
- `via`: `embed`（埋め込みページ経由）/ `yt-dlp(N回目)`（フォールバック）/ `ledger(取得済み)`（台帳が ok で媒体もあるのでスキップ）
- `kind`: `video` / `photo` / `photo_partial`（写真の一部しか取れなかった失敗。`ok: false`）
- `requested` は動画IDで重複を除いた本数。同じ投稿の別表記URLは `duplicate_urls` に `{url, video_id, same_as}` で残す
- 動画IDを特定できない URL（解決できない短縮URL）は `video_id: null` / `status: "invalid_input"` の失敗になり、台帳には書かない
- `kept_previous_ok: true`: 今回の取り直しは失敗したが、以前の ok 行（媒体あり）を台帳に残した
- `browser_error`: Chrome を起動できなかった理由（このときは yt-dlp だけで取得する）
- `interrupted`: `SIGTERM` / `SIGINT` / `SIGHUP` で中断した（`ok: false`。処理済み分だけが入る）
- **これは取得台帳である。** `failed` が 0 でない場合、それらを「0件」として集計しない。
  `note` に警告文が入るので、資料には「取得失敗 N 件」と明記すること
- 終了コード: 全件成功 `0` / 1件でも失敗 `3` / 引数不正 `2` / 中断 `143`（SIGTERM）・`130`（SIGINT）

### acquire_log.jsonl の行（①→② の契約）

`<run-dir>/media/acquire_log.jsonl`。1本終わるごとに書き足す（同じ `video_id` は新しい結果で置き換え、
ただし以前の `ok` 行で媒体が残っているものは失敗で上書きしない）。`stamp_acquire_log.py` が
`media_hashes` / `acquisition_sha256` を付け足す。

```json
{"video_id":"…","status":"ok","media_type":"video","path":"/abs/…/<id>.mp4","has_audio":true,"bytes":123,"method":"search.mjs:fetch(embed)","url":"…"}
{"video_id":"…","status":"ok","media_type":"photo","photo_paths":["/abs/…/<id>_photos/01.jpg"],"photo_count":3,"photo_count_expected":3,"audio_path":"/abs/…/<id>_photo_audio.m4a","has_audio":true,"voice_channel":"not_applicable","voice_channel_reason":"…","bytes":123,"method":"search.mjs:fetch(embed)","url":"…"}
{"video_id":"…","status":"failed","media_type":"photo_partial","photo_paths":["…/01.jpg","…/02.jpg"],"photo_count":2,"photo_count_expected":3,"audio_path":null,"error":"写真 2/3 枚のみ取得（photo_partial）","method":"search.mjs:fetch","url":"…"}
{"video_id":"…","status":"failed","error":"embed: … / yt-dlp: …","method":"search.mjs:fetch","url":"…"}
```

- `has_audio`: 動画は ffprobe の判定（ffprobe が無ければ `null`）。写真は BGM を取れたか
- `voice_channel: not_applicable`（写真）は取得側の記録。ASR を走らせるかは分析側が決める

### 主なオプション

| オプション | 既定 | 意味 |
|---|---|---|
| `--urls-file` | — | 1行1URL のファイル |
| `--url` | — | URL をカンマ区切りで直接指定 |
| `--run-dir` | — | 案件フォルダ。`<run-dir>/media` に保存し台帳を書く。**②へ渡す取得では必ずこれを使う** |
| `--outdir` | `./media` | run-dir の外へ単発で落とすとき専用の保存先 |
| `--concurrency` | `3` | 同時実行数。**実測で 3 が最速** |
| `--max-retries` | `10` | yt-dlp フォールバックの最大試行（削除・非公開など恒久的な失敗は1回で止める） |
| `--no-fallback` | off | 埋め込み経路のみ（yt-dlp を使わない） |
| `--force` | off | 台帳で取得済み（ok・媒体あり）の投稿も取り直す |
