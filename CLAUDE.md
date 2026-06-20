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
npx tsx scripts/scrape-ranking.ts "<キーワード>" --sessions 1
```

- `--sessions 1` = 1回検索＝そのままの表示順位（既定は3。毎回上位に出る「安定度/勝ちパターン」を見たい時だけ `--sessions 3`）。
- 出力は `out/ranking-<キーワード>-<日時>.csv`（Excel可）と `.json`。実行後は**上位10〜20件を表で要約**して提示し、CSV/JSON の保存先パスも伝える。
- パッケージマネージャは pnpm ではなく **npm**（このユーザーは Mac の管理者権限が無い）。依存が未インストールなら先に `npm install --legacy-peer-deps`。
- 「Browser was not found」が出たら `npx puppeteer browsers install chrome` を一度実行してから再試行（Chromium 検出は `findChromiumPath` がクロスプラットフォーム対応済み）。
- 動画が 0 件のときは IP ブロックの可能性。Mac の自宅IPで動かしているか確認し、必要なら `PROXY_SERVER`（日本の住宅用プロキシ）を案内する。

詳しい手順は `docs/scrape-on-mac.md` を参照。
