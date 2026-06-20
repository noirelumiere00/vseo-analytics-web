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
```

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
