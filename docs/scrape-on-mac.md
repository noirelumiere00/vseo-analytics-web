# Mac（自宅IP）で TikTok 表示順位を取る

TikTok はデータセンター/非日本IPからの検索をブロック（CAPTCHA・空応答）しがちなので、
**収集は自宅IPの Mac で回す**のが最も確実です。DB も LLM も不要で、キーワードを与えると
表示順位ランキングが出る CLI を用意しています。

## 1. 準備（初回のみ）

```bash
# Node 20+ を用意（例: nvm install 20 / brew install node）
corepack enable                 # pnpm を使えるように
git clone <このリポジトリ>
cd vseo-analytics-web

pnpm install                    # 依存をインストール（postinstall で Chromium も入る）
npx puppeteer browsers install chrome   # 念のため Chromium を明示インストール
```

## 2. 表示順位を取る

```bash
# 基本
npx tsx scripts/scrape-ranking.ts "ハリアー"

# セッション数・取得件数を指定
npx tsx scripts/scrape-ranking.ts "#ジャングリア沖縄" --sessions 3 --per-session 30

# pnpm スクリプト経由でも可
pnpm scrape:ranking "ハリアー"

# 自社動画を赤枠でハイライト（@アカウント名 or 動画URL をカンマ区切りで）
npx tsx scripts/scrape-ranking.ts "ハリアー" --own @harrier808

# 複数キーワードを1回で（各KWごとに HTML/CSV/JSON を出力）
npx tsx scripts/scrape-ranking.ts "N高" "N高等学校" "#N高" "#N高等学校" --sessions 1 --own @acc1,@acc2

# 各 plain KW の #付き版を自動追加（→ N高 / N高等学校 / #N高 / #N高等学校 の4本）
npx tsx scripts/scrape-ranking.ts "N高" "N高等学校" --hashtag-variants --sessions 1
```

- **複数KW**を並べると、最後に**全キーワード横断のサマリー**（KWごとの件数・自社ヒット件数・自社順位・出力パス一覧）が出ます。「どの動画が何位か」「自社がどの順位か」が一覧で分かります。
- 標準出力に **dominanceScore 降順のランキング表**（順位 / 出現回数 / 各セッション順位 / 再生数 / いいね / 作者 / URL）が出ます。
- 次のファイルが `out/ranking-<キーワード>-<日時>.*` に書き出されます（`out/` は Git 管理外）:
  - **`.html`** … **iPhone風の TikTok スマホUI**で順位を表示（ブラウザで開く）。`--own` 指定時は**自社動画を赤枠＋「自社」バッジ**でハイライト。
  - `.csv` … Excel/スプレッドシートで開ける（`isOwn` 列あり）。
  - `.json` … 全データ。

### 自社動画ハイライト（`--own`）
- `--own @harrier808,@harrier_3` のように**自社アカウント名**を指定すると、そのアカウントの動画が全部「自社」扱い。
- 特定の動画だけなら**動画URL**を渡す（例: `--own https://www.tiktok.com/@harrier808/video/7607...`）。
- HTML を開くと、ランキング中の自社動画が**赤枠**で一目で分かる。コンソールにも「🔴 自社動画 N件ヒット（順位: …）」と出る。

### 順位の見方
- **ranks (順位/順位/…)**: 各シークレット検索での表示順位（1始まり、未出現は `-`）。
- **appearanceCount (出現)**: 何セッションに出たか（パーソナライズ排除後の「安定して上位に出る」指標）。
- **dominanceScore**: `Σ(1/順位) / セッション数 × 100`。高いほど上位に安定表示＝勝ちパターン。

## 2-IG. Instagram のハッシュタグ表示順位を取る

TikTok と同じ要領で、Instagram ハッシュタグ検索の表示順位も取れます（3列の IG 探索風 UI でHTML出力・自社は赤枠）。
セットアップ（`npm install --legacy-peer-deps` / `npx puppeteer browsers install chrome`）は TikTok と共通です。

**`INSTAGRAM_SESSION_ID` が必須**です。ログイン済みのブラウザで instagram.com を開き、
開発者ツール → Application/ストレージ → Cookie → `sessionid` の値をコピーして環境変数で渡します。

```bash
# 基本（環境変数でセッションIDを渡す）
INSTAGRAM_SESSION_ID="<sessionidの値>" npx tsx scripts/scrape-ig-ranking.ts "#沖縄旅行"

# 件数指定＋自社をハイライト
INSTAGRAM_SESSION_ID="..." npx tsx scripts/scrape-ig-ranking.ts "#沖縄旅行" --max 30 --own @myshop

# npm スクリプト経由でも可
INSTAGRAM_SESSION_ID="..." npm run scrape:ig -- "#沖縄旅行" --own @myshop
```

- 先頭の `#` はあってもなくても可。`--own` は `@ユーザー名` か `instagram.com/<ユーザー名>` のプロフィールURLでOK（自社判定はユーザー名単位）。
- 出力は `out/ig-ranking-<タグ>-<日時>.*`（`out/` は Git 管理外）:
  - **`.html`** … **iPhone風の Instagram 探索UI**（3列正方形グリッド）で順位を表示。`--own` 指定時は**自社投稿を赤枠＋「自社」バッジ**でハイライト。
  - `.csv` … Excel/スプレッドシートで開ける（`isOwn` 列あり）。
  - `.json` … 全データ（取得方式 `puppeteer`/`apify` も記録）。
- **`INSTAGRAM_SESSION_ID` は秘密情報**。`.env` に書く場合もコミットしないでください（`.env` は Git 管理外）。
- 投稿が 0 件のときは sessionid の未設定/失効、または非日本/データセンターIPのブロックが主因です。**Mac の自宅IP**で実行してください（`INSTAGRAM_SESSION_ID` 未設定時は `APIFY_API_TOKEN` があれば Apify フォールバックを試みます）。

## 3. プロキシ経由にしたい場合（任意）

自宅IPで十分ですが、日本の住宅用プロキシを使うなら環境変数で:

```bash
PROXY_SERVER="http://brd.superproxy.io:22225" \
PROXY_USERNAME="..." PROXY_PASSWORD="..." \
npx tsx scripts/scrape-ranking.ts "ハリアー"
```

## 4. （任意）Web UI も Mac で使う

順位カードを Web 画面で見たい場合は MySQL を立てて Web アプリを起動します。
`scripts/dev-setup.sh` は **Linux(apt) 専用**なので、Mac では手動で:

```bash
brew install mysql && brew services start mysql
mysql -uroot -e "CREATE DATABASE IF NOT EXISTS vseo CHARACTER SET utf8mb4;"

# .env を用意（DATABASE_URL を上の MySQL に向ける / JWT_SECRET 等）
cp .env.example .env   # 値を編集

pnpm exec drizzle-kit migrate    # スキーマ適用
pnpm seed:dev-user               # ログイン用 dev ユーザー作成

# 順位だけモードで起動（LLM 鍵なしで順位カードまで出る）
RANKING_ONLY=true pnpm dev       # http://localhost:3000
```

> `RANKING_ONLY=true`（または `ANTHROPIC_API_KEY` 未設定）の場合、LLM のセンチメント/レポート/
> パターン分析はスキップされ、TikTok 収集＋表示順位だけで分析ジョブが「完了」になります。

## 補足: このコンテナ（Claude Code）/ 社内プロキシ環境で試す場合

TLS を傍受する egress プロキシ環境では Chromium が tiktok.com の証明書を弾く（`ERR_CERT_AUTHORITY_INVALID`）ことがあります。その場合は証明書エラーを無視するフラグを併用してください:

```bash
SCRAPER_IGNORE_CERT_ERRORS=true npx tsx scripts/scrape-ranking.ts "ハリアー"
```

ただし**非日本/データセンターIPでは TikTok にブロックされ動画が 0 件になりがち**です（配線確認用）。
実データは Mac の自宅IPで取得してください。
