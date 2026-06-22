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

- `--sessions 1` = 1回検索＝そのままの表示順位（既定は3。毎回上位に出る「安定度/勝ちパターン」を見たい時だけ `--sessions 3`）。
- `--own @acc1,@acc2`（または自社動画URL）を付けると、**生成HTMLで自社動画を赤枠＋「自社」バッジでハイライト**する。ユーザーが「自社動画も出して/ハイライトして」と言ったのに自社アカウント/URLが不明なら、**まず自社のTikTokアカウント名（@）を聞くこと**。
- 出力は `out/ranking-<キーワード>-<日時>` の **`.html`（iPhone風 TikTok UI。ブラウザで開く）**・`.csv`（Excel可）・`.json`。実行後は**上位10〜20件を表で要約**して提示し、**HTML を含む保存先パス**を伝える（「ブラウザで開くとスマホUIで見られる」と案内）。
- パッケージマネージャは pnpm ではなく **npm**（このユーザーは Mac の管理者権限が無い）。依存が未インストールなら先に `npm install --legacy-peer-deps`。
- 「Browser was not found」が出たら `npx puppeteer browsers install chrome` を一度実行してから再試行（Chromium 検出は `findChromiumPath` がクロスプラットフォーム対応済み）。
- 動画が 0 件のときは IP ブロックの可能性。Mac の自宅IPで動かしているか確認し、必要なら `PROXY_SERVER`（日本の住宅用プロキシ）を案内する。

詳しい手順は `docs/scrape-on-mac.md` を参照。

### Instagram（ハッシュタグの表示順位）

TikTok と同じ要領で、Instagram のハッシュタグ検索の表示順位も取れる（3列の IG 探索風 UI でHTML出力・自社は赤枠）。

実行コマンド:

```bash
INSTAGRAM_SESSION_ID=<sessionid> npx tsx scripts/scrape-ig-ranking.ts "<#ハッシュタグ>" [--max N] [--own @自社アカウント]
```

- **`INSTAGRAM_SESSION_ID` が必須**（ログイン済みブラウザの Instagram `sessionid` Cookie）。**環境変数で渡す**（`.env` に書いてもよいが**コミットしない**）。未指定でユーザーが順位取得を頼んだら、**まず「IG のセッションID（sessionid Cookie）を渡して」と聞くこと**。未設定の場合は `APIFY_API_TOKEN` があれば Apify フォールバックを試みる。
- `--own @acc1,@acc2`（または `instagram.com/<ユーザー名>` のプロフィールURL）で、**生成HTMLの自社投稿を赤枠＋「自社」バッジ**でハイライト。自社が不明なら**自社の IG ユーザー名（@）を聞く**。
- `--max`（既定 30）= 取得する上位件数。
- 出力は `out/ig-ranking-<タグ>-<日時>` の **`.html`（iPhone風 Instagram UI。ブラウザで開く）**・`.csv`（`isOwn` 列あり）・`.json`。実行後は**上位を表で要約**し、**HTML を含む保存先パス**を伝える。
- 0 件のときは `INSTAGRAM_SESSION_ID` の未設定/失効、または非日本/データセンターIPのブロックを疑う。**Mac の自宅IP**で実行する。
- npm ショートカット: `npm run scrape:ig -- "<#ハッシュタグ>" --own @自社`（`INSTAGRAM_SESSION_ID` は環境変数で）。
