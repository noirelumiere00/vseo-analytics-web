# Project: VSEO Analytics Web

## Frontend Design Skill

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

### Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

### Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions. Focus on high-impact moments: one well-orchestrated page load with staggered reveals creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns.

## Tech Stack

- Frontend: React + TypeScript + Tailwind CSS 4 + shadcn/ui (Radix)
- Backend: Express + tRPC + Drizzle ORM
- Database: MySQL
- Build: Vite
- Animations: tw-animate-css + custom M3 keyframes in index.css

## Material Design 3 Tokens

M3 design tokens are defined in `client/src/index.css`:
- Elevation: `--md-elevation-0` through `--md-elevation-5`
- Easing: `--md-ease-standard`, `--md-ease-emphasized-decel`, etc.
- Duration: `--md-dur-short1` through `--md-dur-xlong2`
- State layers: `--md-state-hover`, `--md-state-focus`, `--md-state-pressed`
- Shape: `--md-shape-xs` through `--md-shape-full`

Use these tokens for all new animations and transitions.

## TikTok 表示順位スクレイピング（Mac でこの Claude に依頼する用）

ユーザーが「〇〇の順位を取って」「表示順位／ランキングを取って」等と頼んだら、**このリポジトリのある Mac 上で**次を実行して結果を返すこと。収集は**自宅IPの Mac でのみ安定**する（クラウド/CI のIPは TikTok にブロックされて動画 0 件になるため不可）。

実行コマンド（DB も LLM も不要のスタンドアロン CLI）:

```bash
npx tsx scripts/scrape-ranking.ts "<キーワード>" --sessions 1 [--own @自社アカウント]
```

- **キーワードは複数並べて1回で実行できる**（各KWごとに HTML/CSV/JSON を出力）。例: `npx tsx scripts/scrape-ranking.ts "N高" "N高等学校" "#N高" "#N高等学校" --sessions 1 --own @acc1,@acc2`。
- `--hashtag-variants` を付けると、各 plain KW の **#付き版を自動追加**（例: `"N高" "N高等学校" --hashtag-variants` → `N高 / N高等学校 / #N高 / #N高等学校` の4本）。TikTok は「KW検索」と「#検索」で並びが変わるので、両方見たい時に便利。
- 複数KW実行時は、最後に**全キーワード横断のサマリー**（KWごとの件数・自社ヒット件数・自社順位・出力パス一覧）を表示する。
- `--sessions 1` = 1回検索＝そのままの表示順位（既定は3。毎回上位に出る「安定度/勝ちパターン」を見たい時だけ `--sessions 3`）。
- `--own @acc1,@acc2`（または自社動画URL）を付けると、**生成HTMLで自社動画を赤枠＋「自社」バッジでハイライト**する。ユーザーが「自社動画も出して/ハイライトして」と言ったのに自社アカウント/URLが不明なら、**まず自社のTikTokアカウント名（@）を聞くこと**。
- 出力は `out/ranking-<キーワード>-<日時>` の **`.html`（iPhone風 TikTok UI。ブラウザで開く）**・`.csv`（Excel可）・`.json`。実行後は**上位10〜20件を表で要約**して提示し、**HTML を含む保存先パス**を伝える（「ブラウザで開くとスマホUIで見られる」と案内）。
- `--proposal`（`--pptx`）= **クライアント提案用の 16:9 デックHTML**（1920×1080・全KWを1ファイルに複数スライド）を `out/tiktok-proposal-<日時>.html` に追加出力。各スライドは**左=スマホモック（`feedHtml`/`igFeedHtml` の詳細モックを iframe で内包＝順位HTMLと同じ高品質UI・全順位・自社赤）／右=順位表（サムネ・順位・アカウント・URL）**。**表は自社投稿のみ**（自社0件のKWは「該当なし」表示）。**サムネは base64 埋め込みで自己完結**（CDN失効でも後から開いて表示・`--no-embed-thumbs` で無効化）。←→キーでページ送り、PPTXに画像として貼れる。
- **TikTokとIGを1つの統合デックにまとめたい時** = `npx tsx scripts/build-proposal.ts out/ranking-*.json out/ig-ranking-*.json`。既存の順位JSON（TikTok/IG混在可）から **1ファイルの統合提案デック** `out/proposal-combined-<日時>.html` を生成（各JSON＝1スライド・左=詳細モック／右=自社のみ表・サムネbase64）。TikTok JSON に `coverUrl` が無い旧データでも**同basenameの順位HTMLからサムネを自動補完**（＝再取得不要）。0件JSONはスキップ、同一KWの複数JSONは最新のみ採用。
- **本物の PowerPoint（.pptx）が欲しい時** = `npx tsx scripts/build-pptx.ts out/proposal-combined-*.html [--out <path.pptx>] [--scale 2]`（`npm run build:pptx -- …`）。提案デックHTMLの各スライド（1920×1080）を**ヘッドレスChromeで撮影 → 16:9（13.333in×7.5in）のスライドに全面画像として配置**した `.pptx` を出力（既定は同名 `.pptx`）。PowerPoint/Keynote/Googleスライドで開け、各スライドは現状のHTML/PNGとピクセル等価（モック＋自社表をそのまま）。スライドは画像なので**テキストは非編集**。`--scale 2` 既定で 3840×2160 の高精細。スマホモックは iframe で内包しているため撮影前に 1.5s 待つ（実装済み）。
- 単一デックHTMLを各スライドPNGに分割したいだけなら `npx tsx scripts/shoot-deck.ts <deck.html>`（`-slideN.png` を出力。`build-pptx.ts` と同じ撮影配管）。
- パッケージマネージャは pnpm ではなく **npm**（このユーザーは Mac の管理者権限が無い）。依存が未インストールなら先に `npm install --legacy-peer-deps`。
- 「Browser was not found」が出たら `npx puppeteer browsers install chrome` を一度実行してから再試行（Chromium 検出は `findChromiumPath` がクロスプラットフォーム対応済み）。
- 動画が 0 件のときは IP ブロックの可能性。Mac の自宅IPで動かしているか確認し、必要なら `PROXY_SERVER`（日本の住宅用プロキシ）を案内する。

詳しい手順は `docs/scrape-on-mac.md` を参照。

### Instagram（ハッシュタグの表示順位）

TikTok と同じ要領で、Instagram のハッシュタグ検索の表示順位も取れる（3列の IG 探索風 UI でHTML出力・自社は赤枠）。

実行コマンド:

```bash
INSTAGRAM_SESSION_ID=<sessionid> npx tsx scripts/scrape-ig-ranking.ts "<#tag1>" ["<#tag2>" ...] [--max N] [--own @自社アカウント] [--own-reels <file>]
```

- **ハッシュタグは複数並べて1回で実行できる**（各タグごとに HTML/CSV/JSON＋最後に全タグ横断サマリー）。例: `... "#N高" "#N高等学校" --own-reels out/ig-own-reels.txt`。
- **`INSTAGRAM_SESSION_ID` が必須**（ログイン済みブラウザの Instagram `sessionid` Cookie）。**環境変数で渡す**（`.env` に書いてもよいが**コミットしない**）。未指定でユーザーが順位取得を頼んだら、**まず「IG のセッションID（sessionid Cookie）を渡して」と聞くこと**。未設定の場合は `APIFY_API_TOKEN` があれば Apify フォールバックを試みる。**IG はセッション付きならクラウド（このコンテナ）からでも取れることが多い**（TikTok と違いブロックされにくい。ダメなら Mac 自宅IP）。
- `--own @acc1,@acc2`（または `instagram.com/<ユーザー名>` のプロフィールURL）で、**自社IGアカウント名（username 一致）**をハイライト。自社が不明なら**自社の IG ユーザー名（@）を聞く**。
- `--own-reels <file>`（1行1URL）= **自社投稿URL一覧から reel/p の shortcode を抽出し、ランキング中の同 shortcode を自社扱い**。スプシの投稿リスト（reel URL に @ が無くても）をそのまま自社判定に使える。`--own` と併用可（isOwn = username 一致 or shortcode 一致）。**N高の自社IG投稿217件は `data/ig-own-reels.txt` にリポジトリ同梱済み**（`--own-reels data/ig-own-reels.txt`）。
- `--max`（既定 30）= 取得する上位件数。
- `--reels-only`（`--reels`）= **リール（縦型動画）だけに絞って再ランキング**。IG のハッシュタグ「トップ」グリッドは画像/カルーセルが多く、リール投稿（自社が全部リールのケース等）が埋もれるため、リール同士の順位を見たい時に使う。多めに集めてから type∈{reel, video} で抽出し 1..N に振り直す（IG は product_type 欠落時にリールを `video` と分類するため video も含める）。出力ファイル名は `-reels` 付き。
- **件数をもっと増やしたい時** = `IG_MAX_SCROLLS=30`（環境変数。既定10）でスクロールを深くし、母数を増やす（例: `IG_MAX_SCROLLS=30 ... --reels-only --max 40`）。母数が増えるとリール件数・自社ヒットも増える（IG の最近フィードが尽きると頭打ち＝それが実上限）。深くするほど時間とブロックリスクは上がる。
- `--proposal`（`--pptx`）= **クライアント提案用の 16:9 デックHTML**（1920×1080・全タグを1ファイルに複数スライド）を `out/ig-proposal-<日時>.html` に追加出力（TikTok と共通の `scripts/lib/proposalHtml.ts`）。左=スマホモック（全順位・自社赤）／右=順位表（サムネ・順位・アカウント・URL）。**表は自社投稿のみ**（自社0件は「該当なし」）。**サムネは base64 埋め込み自己完結**（`--no-embed-thumbs` で無効化）。
- 出力は `out/ig-ranking-<タグ>-<日時>` の **`.html`（iPhone風 Instagram UI。ブラウザで開く）**・`.csv`（`isOwn` 列あり）・`.json`。実行後は**上位を表で要約**し、**HTML を含む保存先パス**を伝える。
- 0 件のときは `INSTAGRAM_SESSION_ID` の未設定/失効、または非日本/データセンターIPのブロックを疑う。**Mac の自宅IP**で実行する。
- npm ショートカット: `npm run scrape:ig -- "<#ハッシュタグ>" --own @自社`（`INSTAGRAM_SESSION_ID` は環境変数で）。
