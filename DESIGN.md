# DESIGN.md — VSEO Analytics

> このファイルはAIエージェントが正確な日本語UIを生成するためのデザイン仕様書です。
> セクションヘッダーは英語、値の説明は日本語で記述しています。

---

## 1. Visual Theme & Atmosphere

- **デザイン方針**: iOS 26 Liquid Glass — 透過・フロスト・モノクロームの洗練されたミニマリズム
- **密度**: 情報密度が高い分析ダッシュボード。KPIカード、チャート、テーブルが密に配置される
- **キーワード**: Liquid Glass, Frosted Surface, Monochrome, 透明感, テック・ミニマル

---

## 2. Color Palette & Roles

### Primary（ブランドカラー — Monochrome Black）

- **Primary** (`#0a0a0a`): 漆黒。CTAボタン、見出し、アクセントバーに使用
- **Primary Foreground** (`#ffffff`): ボタン上テキスト

### Semantic（意味的な色）

- **Destructive / Ring** (`#D71921`): エラー、削除、危険な操作、フォーカスリング
- **Success**: Tailwind `green-600` (`#16A34A`) を使用
- **Warning**: Tailwind `amber-500` (`#F59E0B`) を使用

### Neutral（ニュートラル — Glass 系）

- **Foreground (Text Primary)** (`#171717`): 本文テキスト
- **Secondary Foreground** (`#525252`): セカンダリテキスト
- **Muted Foreground** (`#737373`): 補足テキスト、ラベル
- **Border** (`rgba(0, 0, 0, 0.08)`): 区切り線、入力枠
- **Background** (`#fafafa`): ページ背景
- **Card / Surface** (`rgba(255, 255, 255, 0.72)`): ガラスカード面（backdrop-filter blur付き）
- **Muted / Accent / Secondary** (`rgba(120, 120, 128, 0.08)`): セカンダリ背景
- **Input** (`rgba(0, 0, 0, 0.06)`): 入力欄の背景

### Chart Colors

| Token | Value | 用途 |
|-------|-------|------|
| chart-1 | `#0a0a0a` | 黒 — メイン系列 |
| chart-2 | `#D71921` | 赤 — セカンダリ |
| chart-3 | `#737373` | グレー |
| chart-4 | `#a3a3a3` | ライトグレー |
| chart-5 | `#d4d4d4` | 最ライト |

### Dark Mode

ダークモードは `.dark` クラスで切り替え。iOS 26 ダークグラス:
- Background: `#1a1a1a`, Foreground: `#e5e5e5`
- Card: `rgba(30, 30, 30, 0.72)` — ダークフロストガラス
- Primary: `#e5e5e5` (反転), Destructive: `#ff453a` (iOS赤)

---

## 3. Typography Rules

### 3.1 和文フォント

- **ゴシック体 (本文)**: Noto Sans JP — クリーンで読みやすい
- **フォールバック**: Zen Kaku Gothic New

### 3.2 欧文・等幅フォント

- **見出し**: Space Mono — テック・ミニマルな uppercase 見出し
- **データ表示**: JetBrains Mono — KPI値、テーブル数値

### 3.3 font-family 指定

```css
/* 本文 (body) */
font-family: "Noto Sans JP", "Zen Kaku Gothic New", sans-serif;

/* 見出し (h1, h2, h3) */
font-family: "Space Mono", "JetBrains Mono", monospace;
text-transform: uppercase;
letter-spacing: 0.08em;

/* データ表示 (.font-data) */
font-family: "JetBrains Mono", monospace;
font-feature-settings: "tnum";
```

### 3.4 文字サイズ・ウェイト階層

| Role | Font | Size | Weight | Line Height | Letter Spacing | 備考 |
|------|------|------|--------|-------------|----------------|------|
| Heading 1 | Space Mono | 1.25rem | 700 | 1.2 | 0.1em | UPPERCASE |
| Heading 2 | Space Mono | 1rem | 700 | 1.3 | 0.08em | UPPERCASE |
| Heading 3 | Space Mono | 0.875rem | 700 | 1.4 | 0.08em | UPPERCASE |
| Body | Noto Sans JP | 14px (md) / 16px (base) | 400 | — | — | 本文 |
| Caption | Noto Sans JP | 12px | 400 | — | — | 補足、注釈 |
| Data | JetBrains Mono | — | 400-600 | — | — | KPI・数値。tnum有効 |

### 3.5 OpenType 機能

```css
/* body に適用済み */
font-feature-settings: "palt", "cv02", "cv03", "cv04", "cv11";

/* データ表示 */
font-feature-settings: "tnum";
```

---

## 4. Component Stylings

### Buttons (shadcn/ui + CVA)

**Primary (default)**
- Background: `var(--primary)` (#0a0a0a)
- Text: `var(--primary-foreground)` (#ffffff)
- Border Radius: `rounded-sm` (= `calc(var(--radius) - 4px)` = 12px)
- Hover: `bg-primary/90`

**Glass Button (.glass-btn)**
- Background: `rgba(255, 255, 255, 0.72)`
- Backdrop Filter: `blur(12px) saturate(150%)`
- Border: `0.5px solid rgba(0, 0, 0, 0.06)`
- Border Radius: 22px
- Inset highlight: `0 0.5px 0 0 rgba(255,255,255,0.6) inset`

### Cards (shadcn/ui + Liquid Glass)

- Background: `var(--card)` = `rgba(255, 255, 255, 0.72)` — フロストガラス
- Backdrop Filter: `blur(20px) saturate(180%)`
- Border: `0.5px solid var(--border)` — ヘアライン
- Border Radius: `var(--radius)` = 1rem (16px)
- Shadow: `0 0.5px 0 0 rgba(255,255,255,0.8) inset, 0 1px 3px rgba(0,0,0,0.06)`
- Hover: border darkens to `rgba(0,0,0,0.12)`, shadow lifts

### Stat Card (M3 accent bar reveal)

- カードホバーで上部に3pxのモノクロームグラデーションバーがスライドイン
- `background: linear-gradient(90deg, #0a0a0a, #404040)`

### Segment Control

- Background: `rgba(120, 120, 128, 0.08)`
- Active segment: `rgba(255, 255, 255, 0.9)` + `backdrop-filter: blur(10px)`
- Border Radius: 10px / 8px (items)

---

## 5. Layout Principles

### Spacing Scale

Tailwind CSS 4 のデフォルトスペーシング (4px base) を使用。

### Container

- Max Width: 1280px (`max-width: 1280px` at ≥1024px)
- Padding: 16px (mobile) → 24px (sm) → 32px (lg)

### Border Radius

- `--radius: 1rem` (16px)
- `rounded-sm`: 12px, `rounded-md`: 14px, `rounded-lg`: 16px, `rounded-xl`: 20px

---

## 6. Depth & Elevation

M3 dual-layer shadow system (Light mode):

| Level | 用途 |
|-------|------|
| 0 | デフォルト状態（ガラスカードは inset highlight + 微shadow あり） |
| 1 | ボタンactive |
| 2 | ボタンhover, sticky nav scrolled |
| 3 | Post card hover |
| 4 | モーダル |
| 5 | 最上位 |

---

## 7. Do's and Don'ts

### Do（推奨）

- `var(--primary)` / `var(--border)` 等の CSS トークンで色指定する
- 見出しには Space Mono (monospace, uppercase, letter-spacing: 0.08em) を使う
- 本文には Noto Sans JP を使う
- カードには `backdrop-filter: blur(20px)` で frosted glass 効果をつける
- M3 トークン (`--md-ease-*`, `--md-dur-*`) でアニメーションを定義する
- border-radius は大きめに (`--radius: 1rem`, glass aesthetic)
- `.glass-btn` / `.glass-surface` / `.segment-control` ユーティリティを活用する

### Don't（禁止）

- oklch() の朱色 (`oklch(0.45 0.18 25)` 等) を使わない — Liquid Glass に統一済み
- Shippori Mincho (明朝体) を見出しに使わない — Space Mono に統一済み
- Inter, Roboto, Arial などの汎用フォントを使わない
- 紫グラデーション、ネオンカラーなど「AIスロップ」的な配色を使わない
- `border-l-*` でカードやセクションに色付きの左ボーダーを付けない — AIテンプレートの典型パターン。色はテキスト・バッジ・アイコンなどインライン要素にのみ使用する
- カード背景にセマンティックカラー (`bg-green-50`, `bg-red-50`, `bg-amber-50` 等) を塗らない — カード背景は常に `bg-card` または `bg-muted`
- 静止状態のカードに `box-shadow` で重い影を付けない（inset highlight + 微shadow のみ）
- Tailwind の transition-all で雑にアニメーションしない（M3 easing/duration を使う）

---

## 8. Agent Prompt Guide

### クイックリファレンス

```
Primary Color: #0a0a0a                            — Monochrome Black
Destructive/Ring: #D71921                          — 赤アクセント
Text Color: #171717                                — Foreground
Background: #fafafa                                — Light
Card BG: rgba(255, 255, 255, 0.72)                 — Frosted Glass
Border: rgba(0, 0, 0, 0.08)                        — Hairline
Body Font: "Noto Sans JP", "Zen Kaku Gothic New", sans-serif
Heading Font: "Space Mono", "JetBrains Mono", monospace (UPPERCASE)
Data Font: "JetBrains Mono", monospace (tnum)
Radius: 1rem (16px, generous rounding)
Easing: var(--md-ease-emphasized-decel)
Duration: var(--md-dur-medium2) = 300ms
```
