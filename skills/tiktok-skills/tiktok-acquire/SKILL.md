---
name: tiktok-acquire
description: TikTok の検索画面に実際に表示されている順番（検索表示順）と、その各投稿の再生数・いいね・コメント・シェア・保存数・保存率・投稿日・ハッシュタグ・音源・PR判定・投稿者フォロワー数を取得し、定型レポート（Markdown / CSV / JSON）にまとめる。「TikTokで◯◯を検索して」「TikTokの検索面を取得して」「◯◯のVSEOデータを取って」「TikTokの上位投稿を調べて」「検索順位を取得」「保存率を出して」等で発動する。実ブラウザ(Puppeteer)で TikTok 検索ページを開き、内部APIのレスポンスをネットワーク傍受して取得するため、公式APIや有料スクレイピングSaaSを使わず無料・回数制限なしで動く。ログイン情報は使わない。さらに fetch モードで**動画実体を確実に取得**できる（埋め込みページ経由・実測100%）。ハッシュタグ検索にも対応。単独で簡易レポートまで出せるが、提案資料まで作る場合は tiktok-intake（受付）→ 本スキル（取得）→ tiktok-analyze（計測）→ tiktok-deck（資料化）の順に繋ぐ。
---

# TikTok 検索面スクレイパ

TikTok の検索結果を、**実際に画面に出ている順番のまま**取得する。

## 何が取れて、何が取れないか

**取れる（重要）**

- **検索表示順そのもの** — 再生数順ではない。TikTok の検索アルゴリズムが決めた並び
- **保存数（`collectCount`）** — 保存率を出せる。VSEO で最も効く指標
- **`isAd`** — TikTok 配信側の**有料広告フラグ**。`#PR` 表記（投稿者によるステマ規制上の開示）とは別物で、
  `#PR` 付きのタイアップ投稿でも `false` になる（実サンプル: `#PR` 付き3本がすべて `isAd=false`）。
  **PR 判定を `isAd` だけで代用しない**。定型レポートは「`#PR`タグ または `isAd`」で数え、内訳を併記する。
  項目が取れなかった投稿は `null`（未取得）
- 再生 / いいね / コメント / シェア、投稿日時、尺、本文、ハッシュタグ、音源、投稿者のフォロワー数・認証バッジ
- `poi`（店舗名・住所）、動画の実ファイル URL

**取れない**

- 視聴維持率・離脱率・視聴者属性 → 投稿者本人の分析画面にしかない
- 動画内の字幕テキスト → 別途 ASR / 画像読み取りが必要

## 使い方

### 1. 初回だけ

```bash
cd scripts
npm install          # puppeteer-core だけ。Chromium はダウンロードしない（約44MB）
```

必要なもの: **Node.js 20 以上** と **Google Chrome**（Windows / macOS / Linux で自動検出。
見つからない場合だけ環境変数 `CHROMIUM_PATH` に実行ファイルのフルパスを設定する）。
Python は 3.10〜3.12（一式の共通要件）。検索と `tiktok_report.py` は標準ライブラリのみで、pip は不要。
Windows では `python3` の代わりに `py -3`（または `python`）で実行する。

fetch モード（動画の取得）だけは追加で次を使う:

- **yt-dlp**（埋め込み経路が失敗したときのフォールバック）。`install.sh` / `install.ps1` が
  `~/.claude/skills/.venv` に入れる。そこは PATH に無いが、`search.mjs` は PATH → `.venv/bin`
  （Windows は `.venv\Scripts`）の順に自動で探す。見つからなければフォールバックせず、理由付きの失敗として記録する
- **ffprobe**（ffmpeg 付属）。取得した動画に音声トラックがあるか（`has_audio`）と、yt-dlp の出力が
  本当に動画かを確かめる。無い環境では `has_audio: null`（未判定）になる

### 2. 定型レポートを出す（推奨・通常はこちら）

```bash
cd scripts
python3 tiktok_report.py "メガ割" --max 30
python3 tiktok_report.py "日焼け止め" "韓国コスメ" "プチプラコスメ"   # 複数キーワード一括
python3 tiktok_report.py "新宿 カフェ" --type hashtag --out ./out
```

出力先（既定）: `~/Documents/Claude/Artifacts/tiktok-search/<YYYY-MM-DD>/<キーワード>.{md,csv,json}`
Markdown は標準出力にも出る。CSV は BOM 付き UTF-8 なので Excel でそのまま開ける。
`.json` は `search.mjs` の結果オブジェクトそのもの（`ok` / `type` / `diag` / `order_basis` / `videos`）で、
`tiktok-analyze/scripts/build_dataset.py` にそのまま渡せる。

- `--max` は正の整数か `all`（上限なし。数分かかる）。`--sessions` は受け付けない（順位が壊れるため。下記）
- 0件は自動で4回まで再試行する。ただし **CAPTCHA 検知・`TIKTOK_CDN_DENIED`・Chrome が無い等の環境の問題**は
  やり直しても変わらないので即座に止め、以降のキーワードも実行しない。それ以外の失敗は次のキーワードへ進む
- 失敗したキーワードは出力ファイルを作らず、最後に `errorCode` 付きで一覧を出して終了コード 1 で終わる。
  **『該当なし』ではなく『取得失敗』として扱い、0件として集計しない**

### 3. 動画を落とす（分析ソースを作る）

```bash
cd scripts
node search.mjs --mode fetch --urls-file urls.txt --run-dir <run-dir> --out manifest.json
node search.mjs --mode fetch --url "https://www.tiktok.com/@u/video/123" --run-dir <run-dir>
```

**動画ページ（`/@user/video/id`）を開く方式は使わない。** 初回HTMLに必要なデータが入るかが
確率事象で、実測の単発成功率は 22〜26%（yt-dlp も同じ壁に当たる）。
本モードは**埋め込みページ `/embed/v2/<id>`** を開く。第三者サイト埋め込み用で保護が軽く、
実測 12/12 + 独立検証 2/2 + 実案件 4/4 = **全て成功**。

- 署名URLは CDN が CORS を許さないため、page 内 fetch では取れない（実測 0/6）。
  CDP の Fetch ドメインで**プレイヤー自身のリクエスト**を捕まえ、Range を外して全長を受ける
- **署名の偽造も CAPTCHA 回避もしていない**（ブラウザが作った正規リクエストを読むだけ）
- 埋め込みが失敗したら自動で yt-dlp にフォールバック（`--no-fallback` で無効化）
- `--concurrency 3` が既定。**実測で並列3が最速**（1本 6.3秒）。待機を伸ばすほど悪化し、
  指数バックオフが最悪（1本 186秒）だった。失敗は「窓」でクラスタするため、
  同一URLを連打するよりキューを回すほうがよい
- 出力 JSON は **取得台帳**。`succeeded` / `failed` / 各URLの `error` を残す。
  **失敗を「0件」として集計しないこと**
- **`<run-dir>/media/acquire_log.jsonl` は1本終わるごとに書き足す**。途中で Chrome が落ちても、
  止められても、そこまでの分は台帳に残る（Chrome が落ちた後・Chrome が無い環境は yt-dlp だけで続ける）
- **再実行すると、台帳が `ok` で媒体も残っている投稿はスキップして続きから取る**。取り直すときは `--force`。
  今回の取り直しが失敗しても、以前の `ok` 行（ハッシュ付き）は消さない
- 写真投稿で一部の画像しか取れなかったもの（3枚中2枚など）は `ok` にせず、`status: failed` /
  `media_type: photo_partial` として残す（再実行や `acquire_media.py` が取り直す対象になる）
- 短縮URL（`vt.tiktok.com/...`）はリダイレクト先から動画IDを解決する。解決できなければ仮の番号は振らず
  `invalid_input` の失敗にする。同じ投稿の別表記URLは1本にまとめる（`duplicate_urls` に記録）

**所要時間とタイムアウト**: 1本あたり数秒〜十数秒（写真投稿やフォールバックはもっと長い）。
Claude Code の Bash は既定2分で打ち切られ、打ち切られた時点までの分しか取れない。
**約40URLを超えるときは `run_in_background` で実行するか、タイムアウトを十分長くする**（または40URLずつに分ける）。
打ち切られても台帳は処理済みの分まで残る（SIGTERM/SIGINT なら manifest も `interrupted` 付き・終了コード 143/130 で出る。
強制終了（SIGKILL）では manifest は出ないが台帳は残る）ので、同じコマンドを再実行すれば続きから取れる。

その後の変換:

```bash
ffmpeg -i media/<id>.mp4 -vf fps=0.5 -q:v 3 frames/f_%03d.jpg   # コマ画像（Claudeが読める）
ffmpeg -i media/<id>.mp4 -vn -acodec libmp3lame -ar 16000 -ac 1 audio.mp3
```

文字起こしは faster-whisper。**モデルは `small` 以上を使う**。`tiny` は日本語が崩れて実用にならない
（実測: tiny は「ネニー 固まびを描きする」、small は「年に100万美容課金する」）。

## 実行の前提（他PCでも同じ）

- **TikTok へのログインは不要**。Cookie もユーザープロファイルも使わない（`userDataDir` を渡していない＝毎回まっさらな匿名ブラウザ）。
  ログイン済みプロファイルを使うとアカウント単位でブロックされる危険があるため、意図的にそうしている。
- **既定は headless。Chrome の画面は開かない**（`headful: false` → `headless: true`）。
  他PCで画面が開くなら、それは `--headful` が付いているか、このスキルではなくブラウザ操作ツール（Claude in Chrome 等）が使われている。
- 必要なのは Chrome/Chromium の実行ファイルだけ。見つからなければ `CHROMIUM_PATH` を設定する。
- **通るかどうかは出口IP次第で、端末の設定では決まらない。**
  会社の Cloudflare Zero Trust(WARP) 経由の場合、出口IPは他の利用者と共有される。
  引いたIPのレピュテーション次第で TikTok 側(Akamai)に拒否されることがあり、
  **同じ端末・同じ設定でも通る時と通らない時がある**（実測：同一組織の2台で結果が割れ、
  数十分後に再試行したら拒否されていた側が通った）。
  0件のときは端末設定を疑う前に `errorCode` を見ること。`TIKTOK_CDN_DENIED` なら設定は無関係。

---

### 4. 生データだけ欲しいとき

```bash
cd scripts
node search.mjs --query "メガ割" --type keyword --max 30
node search.mjs --query "新宿"   --type hashtag  --max 10   # タグが空振りしたら keyword に自動フォールバック
node search.mjs --query "日焼け止め" --max 30 --out ./raw.json
node search.mjs --mode comments --url "https://www.tiktok.com/@user/video/123" --max-comments 50
node search.mjs --query "メガ割" --headful                   # ブラウザを表示（デバッグ用）
```

標準出力に JSON、標準エラーに進捗ログ。フィールド一覧は `references/output-fields.md`。

`--max all` は掘り切るまで数分かかり、Bash の既定タイムアウト（2分）を超えうる。
**`run_in_background` で実行するか、タイムアウトを長くする**。途中で例外が起きた・止められた場合は、
それまでに傍受した分を `diag.partial: true` 付きで返す（表示順の先頭としては正しいが網羅ではない）。

## レポートの構成（この3部で固定する）

ユーザーから「TikTok で◯◯を検索して」と言われたら、生の一覧を並べるのではなく
必ずこの形式で返す。毎回同じ体裁にすることで、案件をまたいだ比較ができる。

1. **サマリー** — 再生中央値 / 保存率中央値 / ENG率中央値 / PR投稿数 / 直近7日の投稿数 / フォロワー1万未満の入賞数 / 複数枠アカウント数
2. **検索表示順** — 順位・アカウント・フォロワー・再生・いいね・保存・保存率・ENG率・投稿日・経過日数・PR・尺・形式・本文
3. **検索面の構造** — 投稿日分布 / ハッシュタグ TOP10 / 複数枠を取ったアカウント / フォロワー1万未満の入賞 / 保存率 TOP3

**必ず添える注記**: 並び順は再生数順ではなく TikTok の検索アルゴリズム順である。
表示順はログイン状態・地域・時刻で変わるため、**取得時点のスナップショット**として扱う。
（`tiktok_report.py` はこの注記と、ハッシュタグ→キーワードのフォールバック・部分結果の警告をヘッダーに自動で入れる）

## 読み解きのコツ

- **順位と再生数が一致しないのが正常**。710万再生が6位、5万再生が1位というのは普通に起きる。
  これは「再生数を積めば上位に出る」わけではないことの直接の証拠になる
- **保存率**（保存 ÷ 再生）が購買検討の代理指標。1% を超えると強い
- **フォロワー1万未満の入賞数**が「新規参入の余地」を示す。ここが多い検索面は狙い目
- **同一アカウントの複数入賞**はマルチ入賞戦略が効いている証拠
- **投稿日の分布**が偏っていれば、その検索面は鮮度で回っている（＝タイミング勝負）

## ②へ渡すときの契約

`--mode fetch` には必ず `--run-dir <run-dir>` を付ける。媒体は `<run-dir>/media/` に置かれ、
**`<run-dir>/media/acquire_log.jsonl` が①→②の契約ファイル**になる。
`--outdir` は run-dir の外へ単発で落とすとき専用で、②へ渡す取得では使わない
（置き場所がずれて分析側が対象0件で静かに通過する）。
台帳の `path` / `photo_paths` / `audio_path` は常に**絶対パス**で記録する（`--run-dir` は相対で渡してよい）。
行の形式は `references/output-fields.md` の「acquire_log.jsonl の行」。

取得後は `tiktok-analyze/scripts/stamp_acquire_log.py --run-dir <run-dir>` を実行して
媒体のハッシュを台帳に付ける。これが無いと資料の証拠画像を照合できない。

## 制約と注意

- **表示順は非ログイン状態のもの**。営業個人のログイン状態で取った Excel とは条件が違う。
  施策前後を比較するときは、**前後とも同じ方式で取る**こと。方式を混ぜると比較が壊れる
- **1回の取得で 13〜22件単位で返る**。`--max` は返却時の切り出し数であって取得単位ではない
- **`--max all` で上限なし取得**（実測148〜150件）。`--max` に数値を入れるとその件数で切る。
  かつて76件前後で頭打ちだったのは `hasMoreFalseLimit` 等が固定値だったためで、
  上限なし指定時は `maxPages 60 / maxScroll 80 / noNew 12 / hasMoreFalse 10` まで緩める
- **さらに増やすなら `--sessions 2`**。別セッションの取得結果を和集合にする（実測 150→168件）。
  ただし表示順はセッションごとに違うので、順位を語る資料には単一セッションの結果を使う
  （`--sessions >1` の結果は `order_basis: frequency_then_playcount`。ハッシュタグ→キーワードの
  自動フォールバックも単一セッションのときだけ行う）
- **CAPTCHA を回避しない**。`diag.captchaDetected` が true なら止めて人に委ねる
- 大量取得や連続実行で検知される場合は `PROXY_SERVER` 環境変数で住宅プロキシを経由させる。
  **TLS証明書の検証は既定で有効**。社内プロキシの自己署名CAで失敗する場合は、
  CA を OS の信頼ストアに入れること。どうしても外すなら `PROXY_INSECURE=true` を明示する
  （通信内容が第三者に読まれうる状態になり、起動時に警告が出る）
- **AWS/ECS など データセンター IP から実行すると結果が変わりうる**。
  レート制限・CAPTCHA が出やすいため、オフィス／自宅回線での実行を前提とする
- 公開投稿でも自由な再配布を意味しない。社外資料には必要最小限の引用と元投稿リンクに留める

## 既知の落とし穴

| 症状 | 原因 | 対処 |
|---|---|---|
| `Cannot find package 'puppeteer-core'` | `npm install` していない、または別ディレクトリから実行 | `scripts/` で `npm install` |
| Chrome が見つからない | 標準以外の場所にある | `CHROMIUM_PATH` にフルパスを設定 |
| 出力 JSON が途中で切れる | **`process.exit()` が stdout を flush する前に終了**（2026-08 に修正済み） | 本スキル同梱版なら修正済み。古い版を使っている場合は `--out` でファイル受け取りに切り替える |
| `timeout: command not found` | macOS に `timeout` が無い | 使わない |
| 0件＋`TIKTOK_CDN_DENIED` | **TikTok の CDN がこの出口IPを拒否**（Akamai の Access Denied）。`diag.cdnDeniedReference` に問い合わせ番号が入る | 待っても解けない。**別の回線から実行**するか時間を置く。出口IPは共有なので、同じ端末でも通る時と通らない時がある。**UA偽装・IPローテーションでの回避はしない** |
| 0件で返る | ボット確認が解けていない / キーワードに該当なし | まず `errorCode` を見る。**同じ条件（`--sessions 1` のまま）で時間を置いて再実行**する（`tiktok_report.py` は自動で4回再試行する）。`--sessions >1` は件数の網羅用で、結果は検索表示順ではない（`order_basis: frequency_then_playcount`）ので**順位を語る資料には使えない**。それでも0なら `--type` を keyword↔hashtag で入れ替える。`TIKTOK_TRULY_EMPTY` も1回だけでは「該当なし」と確定しない。**`--headful` はここでは使わない**（下記） |
| fetch が途中で止まる／Bash がタイムアウトする | URL が多く、既定2分を超えた | `run_in_background` で実行するかタイムアウトを延ばす。台帳は1本ごとに書かれているので、同じコマンドを再実行すれば取得済みをスキップして続きから取る |
| fetch のフォールバックが `yt-dlp が見つかりません` | yt-dlp が PATH にも `~/.claude/skills/.venv` にも無い | `install.sh` / `install.ps1` を実行するか、yt-dlp を PATH に入れる |
| Chrome の画面が開いてしまう | `--headful` を付けている | 既定は headless（画面は開かない）。`--headful` は**人が画面を見て CAPTCHA の有無を確かめる時だけ**の最終手段。自動実行で付けると、可視ブラウザでの自動操作として検知されやすくなり、かえってブロックを招く |

## このスキルの担当範囲

取得と簡易レポートまで。**計測（登場率・勝ちパターン）と提案資料の生成は担当しない。**

| やること | 担当 |
|---|---|
| 検索表示順・指標の取得、動画／写真の実体取得 | 本スキル |
| データセット化・キーワード登場率・上位下位差分 | `tiktok-analyze` |
| 章立て（初訪／具体提案／構成提案／レポート／競合差再提案）とpptx出力 | `tiktok-deck` |
| 営業からのヒアリングと作る資料の選択 | `tiktok-intake` |

## RapidAPI 等の TikTok API は使わないこと

`tiktok-api23` などの検索エンドポイントは **`status_code: 0`（成功）を返しながら
`item_list: []`（0件）を返す**。日本語・英語・一般名詞・固有名詞の 4 キーワードで
全滅を実測済み。「0件＝該当なし」と誤読する事故になるため、検索面の取得には使わない。
