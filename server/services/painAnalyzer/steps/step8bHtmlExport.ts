/**
 * STEP 8b: HTML Export (27 スライド HTML生成)
 *
 * マークダウン出力 (step8) とは別に、完全にスタイル制御できるHTMLレポートを生成する。
 *
 * 特徴:
 * - 横長 (1920x1080 PPT比) / 縦長スクロール の2レイアウト切替
 * - プリセットテーマ5個 + カスタム3色ピッカーのテーマ切替
 * - 単一HTMLファイル (CSS/JS全てインライン) → ダウンロード即使用可
 * - 営業がブラウザで色・レイアウトを確認しながらクライアント提示
 *
 * 変更ポイント:
 * - CSS変数 (--primary, --sub, --accent) でテーマ切替
 * - data-layout属性 で横長/縦長切替
 * - JSで controls を動作させる（完全スタンドアロン）
 */
import type { KaiwaiCreative } from "../schemas";

// ================================================================
// Input Types
// ================================================================

export interface HtmlExportCommunity {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  layer?: "core" | "expansion";
  cultureCode?: { nicknames: string[]; hashtags: string[]; contentPatterns: string[] };
  estimatedPopulation?: number;
  populationFormula?: string;
  populationCalculation?: {
    steps: Array<{ label: string; value: number; source?: { title: string; url: string } }>;
    formula: string;
  };
  representativeUserProfiles?: Array<{
    username: string;
    profileUrl?: string;
    followerCount?: number;
    bio?: string;
    samplePostUrl?: string;
    samplePostText?: string;
    samplePostViews?: number;
  }>;
  personaDay?: { weekday: string; purchaseBehavior: string };
  officialGap?: { official: string; reality: string; insight: string };
  keywordCandidates?: Array<{
    keyword: string;
    tiktokViews: number;
    tiktokPostCount: number;
    tiktokAvgER: number;
    instagramPostCount: number;
    xPostCount: number;
    xTotalLikes: number;
    googleTrend: "rising" | "stable" | "declining";
    monthlySearchVolume: number;
    trend: "rising" | "stable" | "declining";
    selected: boolean;
    selectionRationale?: string;
    trendBackground?: string;
    competitorKeywords?: Array<{ keyword: string; reason: string }>;
    sources?: {
      tiktokSearchUrl?: string;
      instagramTagUrl?: string;
      xSearchUrl?: string;
      googleTrendsUrl?: string;
    };
  }>;
}

export interface HtmlExportSegment {
  id: string;
  name: string;
  icon: string;
  matchScore: number;
  primaryPain: string;
  appeals: string[];
  communityIds: string[];
}

export interface HtmlExportPain {
  pain: string;
  approved: boolean;
}

// ================================================================
// Theme Presets (5個)
// ================================================================

export interface ThemePreset {
  id: string;
  name: string;
  primary: string;   // メインカラー
  sub: string;       // サブ (テキスト)
  accent: string;    // アクセント (背景)
  bg: string;        // ベース背景
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: "orange",   name: "オレンジ (デフォルト)", primary: "#f46539", sub: "#323228", accent: "#adab9f", bg: "#ffffff" },
  { id: "blue",     name: "ブルー",                 primary: "#2563eb", sub: "#1e293b", accent: "#94a3b8", bg: "#ffffff" },
  { id: "pink",     name: "ピンク",                 primary: "#ec4899", sub: "#2d1b2e", accent: "#d8b4c8", bg: "#fefaf8" },
  { id: "green",    name: "グリーン",               primary: "#16a34a", sub: "#1f2937", accent: "#9ca3af", bg: "#ffffff" },
  { id: "monoblk",  name: "モノクロ黒",             primary: "#171717", sub: "#525252", accent: "#d4d4d4", bg: "#fafafa" },
];

export type LayoutMode = "horizontal" | "vertical";

// ================================================================
// Shared CSS (layout + typography + theme variables)
// ================================================================

function buildCss(): string {
  return `
    /* === CSS Reset === */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif; line-height: 1.5; color: var(--sub); background: var(--bg); }
    img { max-width: 100%; display: block; }
    a { color: var(--primary); text-decoration: none; }

    /* === Theme Variables (default: orange) === */
    :root {
      --primary: #f46539;
      --sub: #323228;
      --accent: #adab9f;
      --bg: #ffffff;
      --muted: #6b6b66;
      --line: rgba(50, 50, 40, 0.12);
      --surface: rgba(173, 171, 159, 0.08);
    }

    /* === App frame === */
    .app { min-height: 100vh; background: var(--bg); }
    .slides-container { max-width: 1920px; margin: 0 auto; padding: 0; }

    /* === Layout: Horizontal (1920x1080 PPT比) === */
    [data-layout="horizontal"] .slide {
      width: 1920px;
      height: 1080px;
      margin: 24px auto;
      padding: 80px 120px;
      page-break-after: always;
      break-after: page;
      overflow: hidden;
      position: relative;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
      border-radius: 2px;
      transform-origin: top center;
    }

    /* Shrink to fit viewport at horizontal mode */
    @media (max-width: 2000px) {
      [data-layout="horizontal"] .slide {
        transform: scale(min(1, calc((100vw - 48px) / 1920)));
        margin: calc(24px * min(1, calc((100vw - 48px) / 1920))) auto;
      }
    }

    /* === Layout: Vertical (スクロール可能な資料) === */
    [data-layout="vertical"] .slide {
      width: 100%;
      max-width: 960px;
      margin: 32px auto;
      padding: 48px 56px;
      min-height: auto;
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 4px;
      page-break-after: always;
      break-after: page;
    }

    /* === Typography === */
    h1.slide-title { font-size: 48px; font-weight: 800; color: var(--sub); margin-bottom: 16px; letter-spacing: -0.02em; }
    h2.slide-subtitle { font-size: 24px; font-weight: 500; color: var(--muted); margin-bottom: 40px; }
    h3.section-heading { font-size: 28px; font-weight: 700; color: var(--primary); margin-bottom: 20px; letter-spacing: -0.01em; }
    h4.sub-heading { font-size: 18px; font-weight: 700; color: var(--sub); margin-bottom: 12px; }
    p { font-size: 15px; color: var(--sub); line-height: 1.7; }
    .small { font-size: 12px; color: var(--muted); }
    .mono { font-family: 'JetBrains Mono', 'Roboto Mono', monospace; }

    [data-layout="vertical"] h1.slide-title { font-size: 32px; }
    [data-layout="vertical"] h2.slide-subtitle { font-size: 18px; margin-bottom: 24px; }
    [data-layout="vertical"] h3.section-heading { font-size: 22px; }
    [data-layout="vertical"] h4.sub-heading { font-size: 16px; }
    [data-layout="vertical"] .slide { font-size: 14px; }

    /* === Slide number === */
    .slide-number {
      position: absolute;
      top: 24px;
      right: 32px;
      font-family: 'Space Mono', monospace;
      font-size: 11px;
      color: var(--muted);
      letter-spacing: 0.2em;
    }
    [data-layout="vertical"] .slide-number {
      position: static;
      display: inline-block;
      margin-bottom: 16px;
      padding: 4px 10px;
      background: var(--surface);
      border-radius: 999px;
    }

    /* === Common components === */
    .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; }
    .badge.primary { background: var(--primary); color: #fff; }
    .badge.accent { background: var(--accent); color: var(--sub); }
    .badge.outline { border: 1.5px solid var(--primary); color: var(--primary); }

    .chip { display: inline-block; padding: 6px 12px; border-radius: 999px; background: var(--surface); color: var(--sub); font-size: 12px; margin: 2px; }
    .chip.primary { background: var(--primary); color: #fff; }

    .card { padding: 20px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); }
    .card.surface { background: var(--surface); border-color: transparent; }
    .card.highlight { border-left: 4px solid var(--primary); }

    /* === Table === */
    table.data { width: 100%; border-collapse: collapse; font-size: 13px; }
    table.data th { text-align: left; padding: 8px 10px; border-bottom: 2px solid var(--primary); color: var(--sub); font-weight: 700; }
    table.data td { padding: 8px 10px; border-bottom: 1px solid var(--line); }
    table.data tr.selected { background: var(--surface); font-weight: 700; }
    table.data td.num, table.data th.num { text-align: right; font-family: 'JetBrains Mono', monospace; }

    /* === Grid utilities === */
    .grid { display: grid; gap: 16px; }
    .grid-2 { grid-template-columns: repeat(2, 1fr); }
    .grid-3 { grid-template-columns: repeat(3, 1fr); }
    .grid-5 { grid-template-columns: repeat(5, 1fr); }
    .flex { display: flex; gap: 12px; }
    .flex-between { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .flex-wrap { display: flex; flex-wrap: wrap; gap: 8px; }

    /* === Source notation === */
    .source { font-size: 10px; color: var(--muted); margin-top: 8px; font-style: italic; }
    .source a { color: var(--muted); text-decoration: underline; }

    /* === Print === */
    @media print {
      .controls { display: none !important; }
      .slide { box-shadow: none; margin: 0; page-break-after: always; }
    }

    /* === Controls Bar === */
    .controls {
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--bg);
      border-bottom: 1px solid var(--line);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      box-shadow: 0 2px 4px rgba(0,0,0,0.04);
    }
    .controls-group { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .controls-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }
    .theme-presets { display: flex; gap: 6px; }
    .theme-preset {
      width: 28px; height: 28px; border-radius: 50%; cursor: pointer;
      border: 2px solid var(--line); transition: all 0.15s ease;
      display: flex; align-items: center; justify-content: center;
    }
    .theme-preset.active { border-color: var(--sub); transform: scale(1.1); }
    .theme-preset:hover { transform: scale(1.08); }
    .color-pickers { display: flex; gap: 6px; align-items: center; }
    .color-pickers input[type="color"] {
      width: 28px; height: 28px; border: 1px solid var(--line); border-radius: 6px;
      padding: 0; cursor: pointer; background: transparent;
    }
    .layout-toggle { display: flex; gap: 0; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
    .layout-toggle button {
      padding: 6px 12px; font-size: 12px; background: var(--bg); color: var(--muted); border: none; cursor: pointer;
    }
    .layout-toggle button.active { background: var(--primary); color: #fff; }
    .download-btn {
      padding: 8px 18px; background: var(--primary); color: #fff; border: none; border-radius: 6px;
      cursor: pointer; font-size: 13px; font-weight: 600; transition: opacity 0.15s;
    }
    .download-btn:hover { opacity: 0.88; }
    [data-layout="vertical"] .controls { padding: 10px 16px; }
  `;
}

// ================================================================
// Controls bar HTML
// ================================================================

function buildControlsBarHtml(): string {
  const themeButtons = THEME_PRESETS.map(t =>
    `<div class="theme-preset" data-theme-id="${t.id}" title="${t.name}"
       style="background: linear-gradient(135deg, ${t.primary} 0%, ${t.primary} 50%, ${t.accent} 50%, ${t.accent} 100%);"></div>`
  ).join("");

  return `
  <div class="controls">
    <div class="controls-group">
      <span class="controls-label">Theme</span>
      <div class="theme-presets">${themeButtons}</div>
      <div class="color-pickers">
        <input type="color" id="colorPrimary" value="#f46539" title="プライマリ" />
        <input type="color" id="colorSub"     value="#323228" title="サブ" />
        <input type="color" id="colorAccent"  value="#adab9f" title="アクセント" />
      </div>
    </div>
    <div class="controls-group">
      <span class="controls-label">Layout</span>
      <div class="layout-toggle">
        <button data-layout-btn="horizontal" class="active">📄 横長 (PPT)</button>
        <button data-layout-btn="vertical">📱 縦長</button>
      </div>
    </div>
    <div class="controls-group">
      <button class="download-btn" id="downloadBtn">⬇ HTML ダウンロード</button>
      <button class="download-btn" id="printBtn" style="background: var(--sub);">🖨 印刷 / PDF</button>
    </div>
  </div>`;
}

// ================================================================
// Controls JS (theme switching + layout toggle + download + print)
// ================================================================

function buildControlsJs(): string {
  // Serialize theme presets for client
  const presetsJson = JSON.stringify(THEME_PRESETS);

  return `
  <script>
    (function() {
      const PRESETS = ${presetsJson};
      const app = document.querySelector('.app');
      const root = document.documentElement;

      function applyTheme(primary, sub, accent, bg) {
        root.style.setProperty('--primary', primary);
        root.style.setProperty('--sub', sub);
        root.style.setProperty('--accent', accent);
        if (bg) root.style.setProperty('--bg', bg);
        document.getElementById('colorPrimary').value = primary;
        document.getElementById('colorSub').value = sub;
        document.getElementById('colorAccent').value = accent;
      }

      // --- Preset buttons ---
      document.querySelectorAll('.theme-preset').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.themeId;
          const preset = PRESETS.find(p => p.id === id);
          if (!preset) return;
          applyTheme(preset.primary, preset.sub, preset.accent, preset.bg);
          document.querySelectorAll('.theme-preset').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
      // Default active = first preset
      document.querySelector('.theme-preset[data-theme-id="orange"]')?.classList.add('active');

      // --- Custom color pickers (override preset) ---
      document.getElementById('colorPrimary').addEventListener('input', e => root.style.setProperty('--primary', e.target.value));
      document.getElementById('colorSub').addEventListener('input', e => root.style.setProperty('--sub', e.target.value));
      document.getElementById('colorAccent').addEventListener('input', e => root.style.setProperty('--accent', e.target.value));

      // --- Layout toggle ---
      document.querySelectorAll('[data-layout-btn]').forEach(btn => {
        btn.addEventListener('click', () => {
          const layout = btn.dataset.layoutBtn;
          app.setAttribute('data-layout', layout);
          document.querySelectorAll('[data-layout-btn]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });

      // --- Download HTML ---
      document.getElementById('downloadBtn').addEventListener('click', () => {
        const html = '<!DOCTYPE html>\\n' + document.documentElement.outerHTML;
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (document.title || 'kaiwai-proposal') + '.html';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });

      // --- Print / PDF ---
      document.getElementById('printBtn').addEventListener('click', () => window.print());
    })();
  </script>`;
}

// ================================================================
// HTML escape helper
// ================================================================

function esc(s: string | undefined | null): string {
  if (s === undefined || s === null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ================================================================
// Slide 1-6: Title + Concept slides
// ================================================================

function renderSlide1(productName: string, totalCommunities: number, totalCreatives: number): string {
  return `
  <section class="slide" data-slide="1">
    <span class="slide-number">01 / 27</span>
    <div style="display: flex; flex-direction: column; justify-content: center; height: 100%;">
      <div class="badge primary" style="align-self: flex-start; margin-bottom: 48px;">界隈マーケティング提案</div>
      <h1 class="slide-title" style="font-size: 72px; line-height: 1.1;">
        「界隈起点」<br/>
        TikTokプロモーション<br/>
        戦略のご提案
      </h1>
      <h2 class="slide-subtitle" style="margin-top: 32px; font-size: 28px;">
        ${esc(productName)} × ${totalCommunities}界隈 × ${totalCreatives}のクリエイティブで攻略する市場
      </h2>
      <div style="margin-top: 64px; display: flex; gap: 32px; align-items: center;">
        <div style="height: 4px; width: 96px; background: var(--primary);"></div>
        <span class="small mono" style="font-size: 14px; letter-spacing: 0.15em;">VSEO ANALYTICS × KAIWAI MARKETING</span>
      </div>
    </div>
  </section>`;
}

function renderSlide2(): string {
  return `
  <section class="slide" data-slide="2">
    <span class="slide-number">02 / 27</span>
    <h1 class="slide-title">【概念1】マーケティングの変革</h1>
    <h2 class="slide-subtitle">デモグラ(属性)から界隈(熱量)へのシフト</h2>
    <div class="grid grid-2" style="margin-top: 48px;">
      <div class="card surface" style="padding: 32px;">
        <h4 class="sub-heading" style="color: var(--muted);">BEFORE — 大衆の時代</h4>
        <p style="margin-top: 12px;">年齢・性別・所得などの「属性」で市場を切り分け、マス広告で一斉にリーチする構造。</p>
        <div style="margin-top: 24px; font-size: 15px; color: var(--muted);">
          🎯 属性 → 年齢・性別・居住地
        </div>
      </div>
      <div class="card highlight" style="padding: 32px;">
        <h4 class="sub-heading">AFTER — 個の時代</h4>
        <p style="margin-top: 12px;">「好き」や興味関心で自発的に集まる生活者の集まり＝界隈から消費が生まれ、界隈から界隈へ伝播する。</p>
        <div style="margin-top: 24px; font-size: 15px; color: var(--primary); font-weight: 700;">
          🔥 熱量 → 「好き」でつながる界隈
        </div>
      </div>
    </div>
    <div style="margin-top: 48px; padding: 24px; background: var(--surface); border-radius: 8px;">
      <h4 class="sub-heading">📊 定量データ (博報堂・SHIBUYA109 lab.)</h4>
      <div class="grid grid-3" style="margin-top: 16px;">
        <div><span class="mono" style="font-size: 32px; color: var(--primary); font-weight: 800;">45.8%</span><p class="small">「界隈」認知率 (全体)</p></div>
        <div><span class="mono" style="font-size: 32px; color: var(--primary); font-weight: 800;">80.6%</span><p class="small">女性10代の認知率</p></div>
        <div><span class="mono" style="font-size: 32px; color: var(--primary); font-weight: 800;">56.3%</span><p class="small">女性10代の界隈起点購買経験</p></div>
      </div>
      <div class="source">Source: 博報堂・SHIBUYA109 lab. Future Evangelist Report vol.3 界隈消費</div>
    </div>
  </section>`;
}

function renderSlide3(): string {
  return `
  <section class="slide" data-slide="3">
    <span class="slide-number">03 / 27</span>
    <h1 class="slide-title">【概念2】界隈の構造</h1>
    <h2 class="slide-subtitle">境界線がなく重なり合い、人が回遊する構造</h2>
    <div class="grid grid-2" style="margin-top: 48px; gap: 32px;">
      <div>
        <h4 class="sub-heading">界隈の特徴</h4>
        <ul style="list-style: none; margin-top: 16px;">
          <li style="padding: 8px 0; border-bottom: 1px solid var(--line);">✓ 「好き」や興味関心を軸にしたゆるい集まり</li>
          <li style="padding: 8px 0; border-bottom: 1px solid var(--line);">✓ 一人が複数の界隈に所属し回遊する</li>
          <li style="padding: 8px 0; border-bottom: 1px solid var(--line);">✓ 明確な境界線がなく、界隈同士が重なり合う</li>
          <li style="padding: 8px 0; border-bottom: 1px solid var(--line);">✓ リーダー中心ではなく、相互作用で成り立つ</li>
          <li style="padding: 8px 0;">✓ 大界隈の中に中小界隈が入れ子状に存在</li>
        </ul>
      </div>
      <div>
        <h4 class="sub-heading">界隈の7分類 (モチベーション別)</h4>
        <div class="flex-wrap" style="margin-top: 16px;">
          <span class="chip primary">情報交換系</span>
          <span class="chip">趣味系</span>
          <span class="chip">推し活・オタ活系</span>
          <span class="chip">世界観系</span>
          <span class="chip">連帯系</span>
          <span class="chip">「あるある」系</span>
          <span class="chip">ネタ系</span>
        </div>
        <p class="small" style="margin-top: 16px;">
          発見した各界隈は、どの分類に属するかで訴求アプローチが異なる。例: 情報交換系は専門性・信ぴょう性、世界観系はビジュアル・トーンの整合性が重要。
        </p>
      </div>
    </div>
  </section>`;
}

function renderSlide4(): string {
  return `
  <section class="slide" data-slide="4">
    <span class="slide-number">04 / 27</span>
    <h1 class="slide-title">【概念3】消費のメカニズム</h1>
    <h2 class="slide-subtitle">「熱量 × 共感」による2段階の消費伝播</h2>
    <div class="grid grid-2" style="margin-top: 48px; gap: 32px;">
      <div class="card highlight" style="padding: 32px;">
        <div class="badge primary">STEP 1</div>
        <h3 class="section-heading" style="margin-top: 12px;">界隈内消費</h3>
        <p>界隈の内部で評判が回り、界隈内の多数に購入が広がる</p>
        <h4 class="sub-heading" style="margin-top: 24px;">成立条件</h4>
        <ul style="list-style: none;">
          <li style="padding: 6px 0;">• 界隈内部の熱量が高い</li>
          <li style="padding: 6px 0;">• 共感性が強い</li>
          <li style="padding: 6px 0;">• 個別具体的なニーズに刺さる</li>
        </ul>
      </div>
      <div class="card" style="padding: 32px; border: 2px solid var(--primary);">
        <div class="badge outline">STEP 2</div>
        <h3 class="section-heading" style="margin-top: 12px;">界隈伝播消費</h3>
        <p>ある界隈で流行したものが、重なりのある別の界隈にも波及する</p>
        <h4 class="sub-heading" style="margin-top: 24px;">成立条件</h4>
        <ul style="list-style: none;">
          <li style="padding: 6px 0;">• 受け手の界隈から活用可能である</li>
          <li style="padding: 6px 0;">• 元の界隈に信頼や好意がある</li>
          <li style="padding: 6px 0;">• 界隈の重なり・回遊経路が存在する</li>
        </ul>
      </div>
    </div>
    <div style="margin-top: 32px; padding: 20px; background: var(--surface); border-radius: 8px;">
      <p><strong>本戦略のポイント:</strong> Core Layer (A-C) で界隈内消費を起こし、Expansion Layer (D-E) で伝播消費を狙う2段構え。</p>
    </div>
  </section>`;
}

function renderSlide5(): string {
  return `
  <section class="slide" data-slide="5">
    <span class="slide-number">05 / 27</span>
    <h1 class="slide-title">【概念4】SEESASモデルと加速メカニズム</h1>
    <h2 class="slide-subtitle">界隈起点の消費行動モデル</h2>
    <div class="grid" style="grid-template-columns: repeat(6, 1fr); gap: 12px; margin-top: 48px;">
      <div class="card" style="padding: 20px; text-align: center;"><div style="font-size: 32px; margin-bottom: 8px;">💭</div><h4 class="sub-heading" style="font-size: 14px;">Sympathy</h4><p class="small">共感 — 「いいな」</p></div>
      <div class="card" style="padding: 20px; text-align: center;"><div style="font-size: 32px; margin-bottom: 8px;">🔥</div><h4 class="sub-heading" style="font-size: 14px;">Enthusiasm</h4><p class="small">熱狂 — 「最高」</p></div>
      <div class="card" style="padding: 20px; text-align: center;"><div style="font-size: 32px; margin-bottom: 8px;">📣</div><h4 class="sub-heading" style="font-size: 14px;">Expression</h4><p class="small">発信 — 投稿する</p></div>
      <div class="card" style="padding: 20px; text-align: center;"><div style="font-size: 32px; margin-bottom: 8px;">🌊</div><h4 class="sub-heading" style="font-size: 14px;">Spread</h4><p class="small">拡散 — 界隈内へ</p></div>
      <div class="card" style="padding: 20px; text-align: center;"><div style="font-size: 32px; margin-bottom: 8px;">🛒</div><h4 class="sub-heading" style="font-size: 14px;">Action</h4><p class="small">行動 — 購買</p></div>
      <div class="card highlight" style="padding: 20px; text-align: center;"><div style="font-size: 32px; margin-bottom: 8px;">♾️</div><h4 class="sub-heading" style="font-size: 14px;">Sustainability</h4><p class="small">定着 — リピート</p></div>
    </div>
    <div class="grid grid-2" style="margin-top: 40px; gap: 24px;">
      <div class="card surface" style="padding: 24px;">
        <h4 class="sub-heading">🎨 右脳アプローチ</h4>
        <p style="margin-top: 8px;">Sympathy / Enthusiasm を加速。話口調・感情訴求・雰囲気ビジュアル。</p>
      </div>
      <div class="card surface" style="padding: 24px;">
        <h4 class="sub-heading">🧠 左脳アプローチ</h4>
        <p style="margin-top: 8px;">Action / Sustainability を加速。説明口調・機能訴求・比較データ。</p>
      </div>
    </div>
    <div class="source">加速ロジック: 界隈内の熱量が高まるほど回転速度が上がり、遠心力で他界隈へ飛び火する</div>
  </section>`;
}

function renderSlide6(): string {
  return `
  <section class="slide" data-slide="6">
    <span class="slide-number">06 / 27</span>
    <h1 class="slide-title">【概念5】企業参入の4原則</h1>
    <h2 class="slide-subtitle">界隈にアプローチする際の絶対ルール</h2>
    <div class="grid grid-2" style="margin-top: 48px; gap: 24px;">
      <div class="card highlight" style="padding: 32px;">
        <div class="badge primary">原則 01</div>
        <h3 class="section-heading" style="margin-top: 12px; font-size: 22px;">カテゴライズしない</h3>
        <p style="margin-top: 8px;">「〇〇界隈向け」ではなく「〇〇好きの人へ」のトーンで。勝手にラベル化しない。</p>
      </div>
      <div class="card highlight" style="padding: 32px;">
        <div class="badge primary">原則 02</div>
        <h3 class="section-heading" style="margin-top: 12px; font-size: 22px;">リスペクトを忘れない</h3>
        <p style="margin-top: 8px;">界隈の価値観や姿勢への敬意が伝わる設計。表面的コラボより、理解の深さ。</p>
      </div>
      <div class="card highlight" style="padding: 32px;">
        <div class="badge primary">原則 03</div>
        <h3 class="section-heading" style="margin-top: 12px; font-size: 22px;">ポジティブ文脈で発信</h3>
        <p style="margin-top: 8px;">優越感ではなく「一緒に楽しめる」表現。利他的共有が広がりを生む。</p>
      </div>
      <div class="card highlight" style="padding: 32px;">
        <div class="badge primary">原則 04</div>
        <h3 class="section-heading" style="margin-top: 12px; font-size: 22px;">活用シーンを提案</h3>
        <p style="margin-top: 8px;">商品説明ではなく「界隈の活動の中でどう使うと嬉しいか」の解像度を上げる。</p>
      </div>
    </div>
    <div style="margin-top: 32px; padding: 20px; background: var(--surface); border-radius: 8px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
      <strong>プロセス:</strong>
      <span class="chip primary">見つける</span> →
      <span class="chip primary">学ぶ</span> →
      <span class="chip primary">盛り上げる</span> →
      <span class="chip primary">広がる</span>
    </div>
  </section>`;
}

// ================================================================
// Slide 7: 5界隈ターゲティング
// ================================================================

function renderSlide7(communities: HtmlExportCommunity[]): string {
  const coreCommunities = communities.filter(c => c.layer === "core");
  const expansionCommunities = communities.filter(c => c.layer === "expansion");
  const core = coreCommunities.length > 0 ? coreCommunities : communities.slice(0, 3);
  const expansion = expansionCommunities.length > 0 ? expansionCommunities : communities.slice(3, 5);

  const renderCommunityCard = (c: HtmlExportCommunity, layer: "core" | "expansion") => {
    const layerLabel = layer === "core" ? "Core Layer" : "Expansion Layer";
    const layerColor = layer === "core" ? "primary" : "outline";
    return `
      <div class="card ${layer === "core" ? "highlight" : ""}" style="padding: 24px;">
        <div class="badge ${layerColor}">${layerLabel}</div>
        <h3 class="section-heading" style="margin-top: 12px; font-size: 22px;">${esc(c.name)}</h3>
        <p class="small" style="margin-top: 8px;">${esc(c.description || "")}</p>
        ${c.estimatedPopulation ? `<div style="margin-top: 16px; font-family: 'JetBrains Mono', monospace;">
          <span class="mono" style="font-size: 24px; color: var(--primary); font-weight: 800;">${c.estimatedPopulation.toLocaleString()}</span>
          <span class="small">人</span>
        </div>` : ""}
        ${c.cultureCode?.nicknames && c.cultureCode.nicknames.length > 0 ? `
          <div class="flex-wrap" style="margin-top: 12px;">
            ${c.cultureCode.nicknames.slice(0, 3).map(n => `<span class="chip">${esc(n)}</span>`).join("")}
          </div>` : ""}
      </div>`;
  };

  return `
  <section class="slide" data-slide="7">
    <span class="slide-number">07 / 27</span>
    <h1 class="slide-title">Targeting — 攻略すべき${communities.length}つの界隈</h1>
    <h2 class="slide-subtitle">「熱狂を生むコア層」から「トレンドを作る拡大層」へ波及させる2段構え</h2>
    <div style="margin-top: 32px;">
      <div class="flex-between" style="margin-bottom: 16px;">
        <h3 class="section-heading" style="margin: 0;">Core Layer</h3>
        <span class="small">界隈内消費を起こすコア層 (${core.length}界隈)</span>
      </div>
      <div class="grid grid-3">
        ${core.map(c => renderCommunityCard(c, "core")).join("")}
      </div>
    </div>
    <div style="margin-top: 32px;">
      <div class="flex-between" style="margin-bottom: 16px;">
        <h3 class="section-heading" style="margin: 0;">Expansion Layer</h3>
        <span class="small">界隈伝播消費で取り込む拡大層 (${expansion.length}界隈)</span>
      </div>
      <div class="grid grid-2">
        ${expansion.map(c => renderCommunityCard(c, "expansion")).join("")}
      </div>
    </div>
  </section>`;
}

// ================================================================
// Slide 8-12: Community Profiles (1 per community)
// ================================================================

function renderCommunityProfile(c: HtmlExportCommunity, slideNum: number, totalSlides: number): string {
  const layerLabel = c.layer === "expansion" ? "拡大層" : "コア層";
  const calcSteps = c.populationCalculation?.steps || [];
  const reps = c.representativeUserProfiles || [];

  return `
  <section class="slide" data-slide="${slideNum}">
    <span class="slide-number">${String(slideNum).padStart(2, "0")} / ${totalSlides}</span>
    <div class="flex-between" style="margin-bottom: 8px;">
      <span class="badge ${c.layer === "core" ? "primary" : "outline"}">${layerLabel}</span>
      <span class="small mono">COMMUNITY ${slideNum - 7}/5</span>
    </div>
    <h1 class="slide-title">${esc(c.name)}</h1>
    <h2 class="slide-subtitle">${esc(c.description || "")}</h2>

    <div class="grid grid-2" style="gap: 32px; margin-top: 32px;">
      <!-- Left column: Population + Calculation -->
      <div>
        <h4 class="sub-heading">👥 推定人数</h4>
        ${c.estimatedPopulation ? `
          <div style="padding: 16px; background: var(--surface); border-radius: 8px; margin-top: 12px;">
            <span class="mono" style="font-size: 40px; color: var(--primary); font-weight: 800;">${c.estimatedPopulation.toLocaleString()}</span>
            <span style="font-size: 18px; color: var(--sub);"> 人</span>
            ${c.populationFormula ? `<p class="small mono" style="margin-top: 8px;">${esc(c.populationFormula)}</p>` : ""}
          </div>
        ` : `<p class="small">算出データなし</p>`}

        ${calcSteps.length > 0 ? `
          <h4 class="sub-heading" style="margin-top: 24px;">計算根拠</h4>
          <table class="data" style="margin-top: 8px;">
            ${calcSteps.map((s, i) => `
              <tr>
                <td style="width: 40px; color: var(--muted);">${i + 1}</td>
                <td>${esc(s.label)}</td>
                <td class="num">${s.value.toLocaleString()}</td>
                <td>${s.source ? `<a href="${esc(s.source.url)}" target="_blank" class="small">${esc(s.source.title)}</a>` : ""}</td>
              </tr>
            `).join("")}
            ${c.populationCalculation?.formula ? `<tr><td colspan="4" class="small mono" style="padding-top: 12px;">${esc(c.populationCalculation.formula)}</td></tr>` : ""}
          </table>
        ` : ""}

        ${c.officialGap ? `
          <h4 class="sub-heading" style="margin-top: 24px;">公式とのGAP</h4>
          <div style="margin-top: 12px; padding: 16px; background: var(--surface); border-radius: 8px;">
            <div style="margin-bottom: 8px;"><span class="small" style="color: var(--muted);">想定:</span> ${esc(c.officialGap.official)}</div>
            <div style="margin-bottom: 8px;"><span class="small" style="color: var(--primary); font-weight: 700;">実態:</span> ${esc(c.officialGap.reality)}</div>
            <div class="small" style="font-style: italic; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line);">💡 ${esc(c.officialGap.insight)}</div>
          </div>
        ` : ""}
      </div>

      <!-- Right column: Culture + Personas -->
      <div>
        ${c.cultureCode ? `
          <h4 class="sub-heading">🎨 文化コード</h4>
          <div style="margin-top: 12px;">
            ${c.cultureCode.nicknames?.length ? `
              <div style="margin-bottom: 12px;">
                <span class="small" style="color: var(--muted);">呼び名:</span>
                <div class="flex-wrap" style="margin-top: 4px;">${c.cultureCode.nicknames.map(n => `<span class="chip primary">${esc(n)}</span>`).join("")}</div>
              </div>` : ""}
            ${c.cultureCode.hashtags?.length ? `
              <div style="margin-bottom: 12px;">
                <span class="small" style="color: var(--muted);">ハッシュタグ:</span>
                <div class="flex-wrap" style="margin-top: 4px;">${c.cultureCode.hashtags.slice(0, 8).map(h => `<span class="chip">#${esc(h)}</span>`).join("")}</div>
              </div>` : ""}
            ${c.cultureCode.contentPatterns?.length ? `
              <div><span class="small" style="color: var(--muted);">投稿構図:</span>
                <p style="margin-top: 4px;">${c.cultureCode.contentPatterns.map(p => esc(p)).join(" / ")}</p>
              </div>` : ""}
          </div>
        ` : ""}

        ${reps.length > 0 ? `
          <h4 class="sub-heading" style="margin-top: 24px;">👤 代表ユーザー</h4>
          <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 12px;">
            ${reps.slice(0, 3).map(u => `
              <div class="card" style="padding: 12px;">
                <div class="flex-between">
                  <div>
                    ${u.profileUrl ? `<a href="${esc(u.profileUrl)}" target="_blank" style="font-weight: 700;">@${esc(u.username)}</a>` : `<strong>@${esc(u.username)}</strong>`}
                    ${u.followerCount ? `<span class="small mono" style="margin-left: 8px;">${u.followerCount.toLocaleString()} followers</span>` : ""}
                  </div>
                </div>
                ${u.bio ? `<p class="small" style="margin-top: 4px;">${esc(u.bio)}</p>` : ""}
                ${u.samplePostText ? `<div style="margin-top: 8px; padding: 8px; background: var(--surface); border-radius: 4px; font-size: 11px;">
                  ${esc(u.samplePostText.slice(0, 100))}${u.samplePostText.length > 100 ? "…" : ""}
                  ${u.samplePostViews ? `<div class="small mono" style="margin-top: 4px;">▶ ${u.samplePostViews.toLocaleString()}</div>` : ""}
                </div>` : ""}
              </div>
            `).join("")}
          </div>
        ` : ""}

        ${c.personaDay ? `
          <h4 class="sub-heading" style="margin-top: 24px;">📆 ペルソナの1日</h4>
          <div style="margin-top: 8px; padding: 12px; background: var(--surface); border-radius: 6px;">
            <div><span class="small" style="color: var(--muted);">平日:</span> ${esc(c.personaDay.weekday)}</div>
            <div style="margin-top: 8px;"><span class="small" style="color: var(--muted);">購買行動:</span> ${esc(c.personaDay.purchaseBehavior)}</div>
          </div>
        ` : ""}
      </div>
    </div>
  </section>`;
}

function renderSlides8to12(communities: HtmlExportCommunity[]): string {
  const coreCommunities = communities.filter(c => c.layer === "core");
  const expansionCommunities = communities.filter(c => c.layer === "expansion");
  const core = coreCommunities.length > 0 ? coreCommunities : communities.slice(0, 3);
  const expansion = expansionCommunities.length > 0 ? expansionCommunities : communities.slice(3, 5);
  const allOrdered = [...core, ...expansion];
  return allOrdered.map((c, i) => renderCommunityProfile(c, 8 + i, 27)).join("");
}

// ================================================================
// Slide 13: Hot Word Map
// ================================================================

function renderSlide13(communities: HtmlExportCommunity[]): string {
  // Collect all selected keywords per community with sizing info
  const allWords: Array<{ word: string; community: string; size: number; selected: boolean }> = [];
  for (const c of communities) {
    const candidates = c.keywordCandidates || [];
    const selectedKws = candidates.filter(k => k.selected);
    const maxViews = Math.max(...candidates.map(k => k.tiktokViews || 0), 1);
    for (const kw of candidates.slice(0, 5)) {
      allWords.push({
        word: kw.keyword,
        community: c.name,
        size: Math.max(14, Math.min(36, 14 + (kw.tiktokViews / maxViews) * 22)),
        selected: kw.selected,
      });
    }
  }

  // Render as visual word cloud
  const wordsHtml = allWords.map(w => {
    const color = w.selected ? "var(--primary)" : "var(--muted)";
    const weight = w.selected ? "800" : "500";
    return `<span style="font-size: ${w.size}px; color: ${color}; font-weight: ${weight}; padding: 4px 12px; display: inline-block; white-space: nowrap;" title="${esc(w.community)}">${esc(w.word)}</span>`;
  }).join(" ");

  return `
  <section class="slide" data-slide="13">
    <span class="slide-number">13 / 27</span>
    <h1 class="slide-title">Analysis — 界隈ホットワードマップ</h1>
    <h2 class="slide-subtitle">${communities.length}界隈から抽出したキーワード (文脈ワードのみ)</h2>
    <div style="margin-top: 48px; padding: 48px; background: var(--surface); border-radius: 12px; text-align: center; line-height: 2.4;">
      ${wordsHtml}
    </div>
    <div style="margin-top: 24px; display: flex; gap: 24px; align-items: center;">
      <span class="small"><span style="display: inline-block; width: 12px; height: 12px; background: var(--primary); border-radius: 50%; vertical-align: middle; margin-right: 6px;"></span>採用キーワード (上位3)</span>
      <span class="small"><span style="display: inline-block; width: 12px; height: 12px; background: var(--muted); border-radius: 50%; vertical-align: middle; margin-right: 6px;"></span>候補キーワード</span>
      <span class="small" style="margin-left: auto;">サイズ = TikTok再生数スケール</span>
    </div>
    <div class="source">Source: TikTok / Instagram / X 検索実測データ (VSEO Analytics)</div>
  </section>`;
}

// ================================================================
// Slide 14-18: Keyword Selection Tables (per community)
// ================================================================

function renderKeywordSelectionSlide(c: HtmlExportCommunity, slideNum: number): string {
  const candidates = c.keywordCandidates || [];
  if (candidates.length === 0) {
    return `
    <section class="slide" data-slide="${slideNum}">
      <span class="slide-number">${String(slideNum).padStart(2, "0")} / 27</span>
      <h1 class="slide-title">Selection — ${esc(c.name)} キラーワード選抜</h1>
      <p class="small" style="margin-top: 40px;">(データ未取得)</p>
    </section>`;
  }

  const formatNum = (n: number) => {
    if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
    return n.toLocaleString();
  };

  const trendLabel = (t: "rising" | "stable" | "declining") => {
    if (t === "rising") return `<span style="color: #16a34a; font-weight: 700;">↑ 上昇</span>`;
    if (t === "declining") return `<span style="color: #dc2626;">↓ 下降</span>`;
    return `<span style="color: var(--muted);">→ 維持</span>`;
  };

  const selectedCandidates = candidates.filter(k => k.selected);
  const rationaleBlocks = selectedCandidates.map(kw => `
    <div class="card highlight" style="padding: 16px; margin-bottom: 12px;">
      <div class="flex-between" style="margin-bottom: 8px;">
        <strong style="font-size: 16px;">${esc(kw.keyword)}</strong>
        <span class="badge primary">採用</span>
      </div>
      ${kw.selectionRationale ? `<p class="small" style="color: var(--sub);">📌 <strong>選抜理由:</strong> ${esc(kw.selectionRationale)}</p>` : ""}
      ${kw.trendBackground ? `<p class="small" style="color: var(--muted); margin-top: 6px;">📈 <strong>トレンド背景:</strong> ${esc(kw.trendBackground)}</p>` : ""}
      ${kw.sources ? `<div class="small" style="margin-top: 8px;">
        <a href="${esc(kw.sources.tiktokSearchUrl || "#")}" target="_blank">TT検索</a> |
        <a href="${esc(kw.sources.instagramTagUrl || "#")}" target="_blank">IG検索</a> |
        <a href="${esc(kw.sources.xSearchUrl || "#")}" target="_blank">X検索</a> |
        <a href="${esc(kw.sources.googleTrendsUrl || "#")}" target="_blank">Google Trends</a>
      </div>` : ""}
    </div>
  `).join("");

  return `
  <section class="slide" data-slide="${slideNum}">
    <span class="slide-number">${String(slideNum).padStart(2, "0")} / 27</span>
    <h1 class="slide-title">Selection — ${esc(c.name)}</h1>
    <h2 class="slide-subtitle">キラーワード選抜 (5候補から上位3を実測データで選抜)</h2>

    <div class="grid grid-2" style="margin-top: 24px; gap: 24px;">
      <div>
        <table class="data">
          <thead>
            <tr>
              <th>#</th>
              <th>ワード</th>
              <th class="num">TT再生</th>
              <th class="num">TT投稿</th>
              <th class="num">ER%</th>
              <th class="num">IG投稿</th>
              <th class="num">検索Vol</th>
              <th>Trend</th>
              <th>判定</th>
            </tr>
          </thead>
          <tbody>
            ${candidates.map((kw, i) => `
              <tr class="${kw.selected ? "selected" : ""}">
                <td>${i + 1}</td>
                <td>${esc(kw.keyword)}</td>
                <td class="num">${formatNum(kw.tiktokViews || 0)}</td>
                <td class="num">${(kw.tiktokPostCount || 0).toLocaleString()}</td>
                <td class="num">${kw.tiktokAvgER || 0}%</td>
                <td class="num">${(kw.instagramPostCount || 0).toLocaleString()}</td>
                <td class="num">${(kw.monthlySearchVolume || 0).toLocaleString()}</td>
                <td>${trendLabel(kw.googleTrend || kw.trend)}</td>
                <td>${kw.selected ? `<span class="badge primary">採用</span>` : `<span class="small" style="color: var(--muted);">-</span>`}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div class="source">Source: TikTok検索 / Instagram検索 / X検索 / Google Trends / Google Ads Keyword Planner (VSEO Analytics実測)</div>
      </div>
      <div>
        <h4 class="sub-heading">💡 選抜理由 (${selectedCandidates.length}件)</h4>
        <div style="margin-top: 12px; max-height: 500px; overflow-y: auto;">
          ${rationaleBlocks || `<p class="small">選抜理由の生成データなし</p>`}
        </div>
      </div>
    </div>
  </section>`;
}

function renderSlides14to18(communities: HtmlExportCommunity[]): string {
  const coreCommunities = communities.filter(c => c.layer === "core");
  const expansionCommunities = communities.filter(c => c.layer === "expansion");
  const core = coreCommunities.length > 0 ? coreCommunities : communities.slice(0, 3);
  const expansion = expansionCommunities.length > 0 ? expansionCommunities : communities.slice(3, 5);
  const allOrdered = [...core, ...expansion];
  return allOrdered.map((c, i) => renderKeywordSelectionSlide(c, 14 + i)).join("");
}

// ================================================================
// Slide 19-20: Pain Hypothesis + Right/Left Brain
// ================================================================

function renderSlide19(painHypotheses: HtmlExportPain[], segments: HtmlExportSegment[]): string {
  const approvedPains = painHypotheses.filter(p => p.approved).slice(0, 6);
  return `
  <section class="slide" data-slide="19">
    <span class="slide-number">19 / 27</span>
    <h1 class="slide-title">Planning — 課題仮説とトリガー</h1>
    <h2 class="slide-subtitle">界隈のPain と 企業のTrigger の接続</h2>

    <div class="grid grid-2" style="margin-top: 40px; gap: 32px;">
      <div>
        <h3 class="section-heading" style="font-size: 22px;">📍 検証済みペイン</h3>
        <div style="margin-top: 16px;">
          ${approvedPains.map((p, i) => `
            <div class="card" style="padding: 14px; margin-bottom: 10px;">
              <div class="flex" style="align-items: flex-start;">
                <span class="mono" style="color: var(--primary); font-weight: 700; min-width: 32px;">P${i + 1}</span>
                <span>${esc(p.pain)}</span>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
      <div>
        <h3 class="section-heading" style="font-size: 22px;">🎯 セグメント別トリガー</h3>
        <div style="margin-top: 16px;">
          ${segments.slice(0, 5).map(s => `
            <div class="card highlight" style="padding: 14px; margin-bottom: 10px;">
              <div class="flex" style="align-items: center;">
                <span style="font-size: 24px; margin-right: 10px;">${esc(s.icon || "🎯")}</span>
                <div>
                  <strong>${esc(s.name)}</strong>
                  <p class="small" style="margin-top: 4px;">${esc(s.primaryPain)}</p>
                </div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  </section>`;
}

function renderSlide20(): string {
  return `
  <section class="slide" data-slide="20">
    <span class="slide-number">20 / 27</span>
    <h1 class="slide-title">Strategy — 右脳・左脳アプローチ</h1>
    <h2 class="slide-subtitle">感性と論理の両面から取りこぼしを防ぐ</h2>

    <div class="grid grid-2" style="margin-top: 48px; gap: 32px;">
      <div class="card highlight" style="padding: 40px; background: linear-gradient(135deg, var(--surface) 0%, transparent 100%);">
        <div style="font-size: 64px;">🎨</div>
        <div class="badge primary" style="margin-top: 12px;">右脳アプローチ / Emotional</div>
        <h3 class="section-heading" style="margin-top: 16px;">感性・直感に訴求</h3>
        <ul style="list-style: none; margin-top: 16px;">
          <li style="padding: 6px 0;">✓ 話口調（〜だよね、まじで、てか）</li>
          <li style="padding: 6px 0;">✓ 「好き」「憧れ」「雰囲気」</li>
          <li style="padding: 6px 0;">✓ Warm lighting / 生活感</li>
          <li style="padding: 6px 0;">✓ SEESAS: Sympathy / Enthusiasm</li>
        </ul>
      </div>
      <div class="card" style="padding: 40px; border: 2px solid var(--sub);">
        <div style="font-size: 64px;">🧠</div>
        <div class="badge" style="margin-top: 12px; background: var(--sub); color: #fff;">左脳アプローチ / Logical</div>
        <h3 class="section-heading" style="margin-top: 16px; color: var(--sub);">機能・論理に訴求</h3>
        <ul style="list-style: none; margin-top: 16px;">
          <li style="padding: 6px 0;">✓ 説明口調（〜の理由、比較、事実）</li>
          <li style="padding: 6px 0;">✓ 「機能」「成分」「コスパ」「数字」</li>
          <li style="padding: 6px 0;">✓ Text overlay / 比較表 / データ</li>
          <li style="padding: 6px 0;">✓ SEESAS: Action / Sustainability</li>
        </ul>
      </div>
    </div>
  </section>`;
}

// ================================================================
// Slide 21-25: Creative Proposals (1 slide per community, 6 creatives)
// ================================================================

function renderCreativeSlide(c: HtmlExportCommunity, creatives: KaiwaiCreative[], slideNum: number): string {
  const communityCreatives = creatives.filter(cr => cr.communityId === c.id);

  // Group by keyword: for each keyword, render right-brain + left-brain pair
  const byKeyword = new Map<string, KaiwaiCreative[]>();
  for (const cr of communityCreatives) {
    if (!byKeyword.has(cr.keyword)) byKeyword.set(cr.keyword, []);
    byKeyword.get(cr.keyword)!.push(cr);
  }

  const keywordBlocks = Array.from(byKeyword.entries()).slice(0, 3).map(([keyword, pair]) => {
    const right = pair.find(p => p.axis === "right-brain");
    const left = pair.find(p => p.axis === "left-brain");

    const renderCreative = (cr: KaiwaiCreative | undefined, kind: "right" | "left") => {
      if (!cr) return `<div class="card" style="padding: 16px; opacity: 0.3;"><p class="small">(生成データなし)</p></div>`;
      const label = kind === "right" ? "🎨 右脳案" : "🧠 左脳案";
      const accentStyle = kind === "right" ? "border-left: 4px solid var(--primary);" : "border-left: 4px solid var(--sub);";
      return `
        <div class="card" style="padding: 16px; ${accentStyle}">
          <div class="flex-between" style="margin-bottom: 8px;">
            <strong style="font-size: 13px;">${label}</strong>
            <span class="small mono">${esc(cr.languageStyle?.tone || "")}</span>
          </div>
          <p style="font-weight: 700; font-size: 15px; margin-bottom: 6px;">${esc(cr.headline || "")}</p>
          <p class="small" style="color: var(--sub); margin-bottom: 10px;">${esc(cr.body || "").slice(0, 140)}${(cr.body || "").length > 140 ? "…" : ""}</p>
          ${cr.visualConcept ? `<div class="small" style="background: var(--surface); padding: 6px 10px; border-radius: 4px; margin-bottom: 8px;">🎬 ${esc(cr.visualConcept)}</div>` : ""}
          ${cr.productionBrief ? `<details style="margin-top: 8px;">
            <summary class="small" style="cursor: pointer; color: var(--primary); font-weight: 600;">撮影ブリーフ (${cr.productionBrief.durationSec}秒)</summary>
            <div class="small" style="margin-top: 6px; padding: 8px; background: var(--surface); border-radius: 4px;">
              ${(cr.productionBrief.cuts || []).map(cut => `<div style="margin-bottom: 4px;"><span class="mono">${esc(cut.sec)}</span> ${esc(cut.shot)}${cut.overlay ? ` — <em>"${esc(cut.overlay)}"</em>` : ""}</div>`).join("")}
              ${cr.productionBrief.bgmMood ? `<div style="margin-top: 6px;">🎵 ${esc(cr.productionBrief.bgmMood)}</div>` : ""}
              ${cr.productionBrief.ctaOnScreen ? `<div style="margin-top: 4px;">📣 ${esc(cr.productionBrief.ctaOnScreen)}</div>` : ""}
            </div>
          </details>` : ""}
          ${cr.imagePrompt ? `<details style="margin-top: 6px;">
            <summary class="small" style="cursor: pointer; color: var(--muted);">Image Prompt (EN)</summary>
            <p class="small" style="margin-top: 4px; padding: 6px; background: var(--surface); border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 10px; line-height: 1.4;">${esc(cr.imagePrompt)}</p>
          </details>` : ""}
        </div>`;
    };

    return `
      <div style="margin-bottom: 16px;">
        <div style="padding: 8px 14px; background: var(--primary); color: #fff; border-radius: 6px 6px 0 0; display: inline-block; font-weight: 700; font-size: 14px;">
          キーワード: ${esc(keyword)}
        </div>
        <div class="grid grid-2" style="gap: 12px; margin-top: 0;">
          ${renderCreative(right, "right")}
          ${renderCreative(left, "left")}
        </div>
      </div>`;
  }).join("");

  return `
  <section class="slide" data-slide="${slideNum}">
    <span class="slide-number">${String(slideNum).padStart(2, "0")} / 27</span>
    <h1 class="slide-title">Creative — ${esc(c.name)}</h1>
    <h2 class="slide-subtitle">${communityCreatives.length}の訴求メッセージ (3キーワード × 右脳/左脳)</h2>
    <div style="margin-top: 24px;">
      ${keywordBlocks || `<p class="small">クリエイティブ生成データなし</p>`}
    </div>
    <div class="source">※ 画像は「スマホを持つ手」を描写せず、TikTokのUI (ハート/コメント等) が表示された画面そのもの (Screen Only)</div>
  </section>`;
}

function renderSlides21to25(communities: HtmlExportCommunity[], creatives: KaiwaiCreative[]): string {
  const coreCommunities = communities.filter(c => c.layer === "core");
  const expansionCommunities = communities.filter(c => c.layer === "expansion");
  const core = coreCommunities.length > 0 ? coreCommunities : communities.slice(0, 3);
  const expansion = expansionCommunities.length > 0 ? expansionCommunities : communities.slice(3, 5);
  const allOrdered = [...core, ...expansion];
  return allOrdered.map((c, i) => renderCreativeSlide(c, creatives, 21 + i)).join("");
}

// ================================================================
// Slide 26: Why TikTok
// ================================================================

function renderSlide26(productName: string): string {
  return `
  <section class="slide" data-slide="26">
    <span class="slide-number">26 / 27</span>
    <h1 class="slide-title">Meaning — なぜTikTokをコア媒体とするのか</h1>
    <h2 class="slide-subtitle">レコメンドアルゴリズム × フリークエンシー5回の戦略的意義</h2>

    <div class="grid grid-2" style="margin-top: 40px; gap: 32px;">
      <div class="card highlight" style="padding: 32px;">
        <div class="badge primary">根拠 01</div>
        <h3 class="section-heading" style="margin-top: 12px; font-size: 22px;">レコメンドアルゴリズムの強力さ</h3>
        <p style="margin-top: 12px; font-size: 14px; line-height: 1.8;">
          TikTokは、フォロー関係を超えてコンテンツが拡散される「レコメンドアルゴリズム (インタレストグラフ)」が非常に強力です。これにより、新製品や新しいトレンドが短期間で爆発的に広がる土壌があります。
        </p>
        <p style="margin-top: 12px; font-size: 14px; font-weight: 700; color: var(--primary);">
          ローンチ期において、市場に「${esc(productName)}という新しいムーブメントが起きている」という状況を創り出す上で、TikTokは最も効果的なプラットフォームです。
        </p>
      </div>
      <div class="card highlight" style="padding: 32px;">
        <div class="badge primary">根拠 02</div>
        <h3 class="section-heading" style="margin-top: 12px; font-size: 22px;">フリークエンシー5回の戦略的意義</h3>
        <p style="margin-top: 12px; font-size: 14px; line-height: 1.8;">
          TikTokの文化は、単なる視聴ではなく「参加」にあります。ユーザーがトレンドに参加するためには、その音源やフォーマットに複数回接触し、「自分もやってみたい」と感じる心理的なハードルを越える必要があります。
        </p>
        <p style="margin-top: 12px; font-size: 14px; font-weight: 700; color: var(--primary);">
          フリークエンシー5回という目標は、ターゲットに「これは広告ではなく、自分が参加すべきトレンドだ」と認識させ、UGCという自発的な熱狂を生み出させるために不可欠な戦略的投資です。
        </p>
      </div>
    </div>

    <div style="margin-top: 32px; display: flex; gap: 24px; justify-content: center; flex-wrap: wrap;">
      <div class="card surface" style="padding: 20px 32px; text-align: center;">
        <div class="mono" style="font-size: 32px; color: var(--primary); font-weight: 800;">4,200万</div>
        <p class="small">国内MAU (月間アクティブユーザー)</p>
      </div>
      <div class="card surface" style="padding: 20px 32px; text-align: center;">
        <div class="mono" style="font-size: 32px; color: var(--primary); font-weight: 800;">36歳</div>
        <p class="small">TikTok平均年齢</p>
      </div>
      <div class="card surface" style="padding: 20px 32px; text-align: center;">
        <div class="mono" style="font-size: 32px; color: var(--primary); font-weight: 800;">FQ5</div>
        <p class="small">参加トリガー発火の閾値</p>
      </div>
    </div>
  </section>`;
}

// ================================================================
// Slide 27: KPI & Budget Simulation
// ================================================================

function renderSlide27(communities: HtmlExportCommunity[]): string {
  const coreCommunities = communities.filter(c => c.layer === "core");
  const expansionCommunities = communities.filter(c => c.layer === "expansion");
  const core = coreCommunities.length > 0 ? coreCommunities : communities.slice(0, 3);
  const expansion = expansionCommunities.length > 0 ? expansionCommunities : communities.slice(3, 5);
  const allOrdered = [...core, ...expansion];

  let totalBudget = 0;
  let totalUU = 0;

  const rows = allOrdered.map(c => {
    const layer = c.layer === "expansion" ? "Expansion" : "Core";
    const pop = c.estimatedPopulation || 0;
    const fq = 5;
    const cpe = 2;
    const budget = pop * fq * cpe;
    totalBudget += budget;
    totalUU += pop;
    return `
      <tr>
        <td><span class="badge ${layer === "Core" ? "primary" : "outline"}">${layer}</span></td>
        <td><strong>${esc(c.name)}</strong></td>
        <td class="num">${pop.toLocaleString()}</td>
        <td class="num">${fq}回</td>
        <td class="num">${cpe}円</td>
        <td class="num"><strong>${budget.toLocaleString()}円</strong></td>
      </tr>`;
  }).join("");

  return `
  <section class="slide" data-slide="27">
    <span class="slide-number">27 / 27</span>
    <h1 class="slide-title">KPI & Budget Simulation</h1>
    <h2 class="slide-subtitle">界隈人数 × FQ5 × 単価2円ベースの初期シミュレーション</h2>

    <div style="margin-top: 40px;">
      <table class="data">
        <thead>
          <tr>
            <th>Layer</th>
            <th>界隈</th>
            <th class="num">推定人数 (UU)</th>
            <th class="num">FQ</th>
            <th class="num">単価 (CPE)</th>
            <th class="num">予算</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr style="border-top: 3px solid var(--primary);">
            <td colspan="2"><strong>合計</strong></td>
            <td class="num"><strong>${totalUU.toLocaleString()}</strong></td>
            <td class="num">×5</td>
            <td class="num">×2</td>
            <td class="num" style="color: var(--primary); font-size: 18px;"><strong>${totalBudget.toLocaleString()}円</strong></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="grid grid-3" style="margin-top: 32px; gap: 16px;">
      <div class="card surface" style="padding: 20px; text-align: center;">
        <p class="small" style="color: var(--muted);">合計 推定リーチ</p>
        <div class="mono" style="font-size: 28px; color: var(--primary); font-weight: 800; margin-top: 4px;">${totalUU.toLocaleString()}人</div>
      </div>
      <div class="card surface" style="padding: 20px; text-align: center;">
        <p class="small" style="color: var(--muted);">合計 エンゲージメント</p>
        <div class="mono" style="font-size: 28px; color: var(--primary); font-weight: 800; margin-top: 4px;">${(totalUU * 5).toLocaleString()}回</div>
      </div>
      <div class="card highlight" style="padding: 20px; text-align: center;">
        <p class="small" style="color: var(--muted);">合計 予算</p>
        <div class="mono" style="font-size: 28px; color: var(--primary); font-weight: 800; margin-top: 4px;">${totalBudget.toLocaleString()}円</div>
      </div>
    </div>
    <div class="source" style="margin-top: 16px;">※ 数値はVSEO Analytics実測データに基づく推計。実施期には実際の配信パフォーマンスに応じて最適化します。</div>
  </section>`;
}

// ================================================================
// Main Entry: generateHtmlReport
// ================================================================

export function generateHtmlReport(
  productName: string,
  communities: HtmlExportCommunity[],
  segments: HtmlExportSegment[],
  creatives: KaiwaiCreative[],
  painHypotheses: HtmlExportPain[],
): string {
  const totalCommunities = communities.length;
  const totalCreatives = creatives.length;
  const title = `${productName} — 界隈マーケティング提案書`;

  const slides = [
    renderSlide1(productName, totalCommunities, totalCreatives),
    renderSlide2(),
    renderSlide3(),
    renderSlide4(),
    renderSlide5(),
    renderSlide6(),
    renderSlide7(communities),
    renderSlides8to12(communities),
    renderSlide13(communities),
    renderSlides14to18(communities),
    renderSlide19(painHypotheses, segments),
    renderSlide20(),
    renderSlides21to25(communities, creatives),
    renderSlide26(productName),
    renderSlide27(communities),
  ].join("\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="generator" content="VSEO Analytics Pain Analyzer">
<title>${esc(title)}</title>
<style>${buildCss()}</style>
</head>
<body>
<div class="app" data-layout="horizontal">
  ${buildControlsBarHtml()}
  <div class="slides-container">
${slides}
  </div>
</div>
${buildControlsJs()}
</body>
</html>`;
}
