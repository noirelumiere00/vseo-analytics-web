/**
 * build-pptx.ts — 提案デックHTML（`out/proposal-*.html`）を「本物の .pptx（PowerPoint）」に変換する。
 *
 * 既定（ハイブリッド）: 各スライドの **左スマホモックだけ画像**として焼き込み、
 *   **右側（見出し＋自社のみ表：順位/アカウント/URL）は PowerPoint のネイティブ要素**
 *   （テキスト＋ハイパーリンク＋サムネ画像）として配置する → PowerPoint 上で文字編集・URLコピー可。
 * `--flat`: 旧挙動（各スライドを丸ごと1枚画像でフルブリード）。
 *
 * 使い方:
 *   npx tsx scripts/build-pptx.ts out/proposal-ALL.html [--out <path.pptx>] [--scale 2] [--flat]
 */
import * as path from "path";
import { createRequire } from "module";
import puppeteer from "puppeteer-core";
import { findChromiumPath, buildChromiumArgs } from "../server/tiktokScraper";

// pptxgenjs は CJS（`module.exports = PptxGenJS`）。ESM の default 取り込みだと
// 環境によって名前空間でラップされ "not a constructor" になるため createRequire で読む。
const require = createRequire(import.meta.url);
const PptxGenJS = require("pptxgenjs");

// PowerPoint 16:9（ワイド）= 13.333in × 7.5in（1920×1080 と同比）
const SLIDE_W_IN = 13.333;
const SLIDE_H_IN = 7.5;
const FONT = "Yu Gothic";

interface RowData { rank: string; account: string; url: string; thumb: string }
interface SlideData {
  platform: "tiktok" | "instagram";
  title: string;
  ownLine: string;
  ownHit: boolean;
  empty: boolean;
  emptyText: string;
  rows: RowData[];
  mockPng: Buffer;
  mockW: number;
  mockH: number;
}

/** PNG バッファから幅・高さ（px）を読む */
function pngSize(buf: Buffer): { w: number; h: number } {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function shortUrl(u: string): string {
  return u.replace(/^https?:\/\/(www\.)?/, "").replace(/\?.*$/, "").replace(/\/$/, "");
}

/** ブラウザ側で全 .slide の右パネルデータを抽出する式（**文字列**で渡す＝tsx の __name 注入を回避）。 */
const BROWSER_EXTRACT = `
[].slice.call(document.querySelectorAll('.slide')).map(function(node){
  function txt(sel){ var e=node.querySelector(sel); return e ? e.textContent.trim() : ''; }
  var platEl = node.querySelector('.plat');
  var platform = (platEl && platEl.classList.contains('ig')) ? 'instagram' : 'tiktok';
  var h1 = node.querySelector('.r-head h1');
  var title = ((h1 && h1.childNodes[0] && h1.childNodes[0].textContent) || (h1 && h1.textContent) || '').trim();
  var pill = node.querySelector('.own-pill');
  var ownLine = pill ? pill.textContent.trim() : '';
  var ownHit = pill ? pill.classList.contains('hit') : false;
  var empty = !!node.querySelector('.empty');
  var emptyText = empty ? (txt('.empty-t') || '自社投稿は今回のランキングに該当なし') : '';
  var rows = [].slice.call(node.querySelectorAll('.rank-table tbody tr')).map(function(tr){
    function g(s){ var e=tr.querySelector(s); return e ? e.textContent.trim() : ''; }
    var a = tr.querySelector('.c-url a');
    var img = tr.querySelector('.th img');
    return { rank: g('.c-rank'), account: g('.c-acc'), url: a ? a.getAttribute('href') : '', thumb: img ? img.getAttribute('src') : '' };
  });
  return { platform: platform, title: title, ownLine: ownLine, ownHit: ownHit, empty: empty, emptyText: emptyText, rows: rows };
})
`;

/** deck HTML を開いて各 .slide の「左モック画像」＋「右パネルのデータ」を取得（ハイブリッド用） */
async function captureHybrid(htmlAbs: string, scale: number): Promise<SlideData[]> {
  const browser = await puppeteer.launch({
    executablePath: findChromiumPath(),
    headless: true,
    args: [...buildChromiumArgs(), "--window-size=1920,1080"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: scale });
    await page.goto("file://" + htmlAbs, { waitUntil: "networkidle0", timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 1500)); // iframe srcdoc の描画待ち
    // 右パネルのデータ（全スライド分・順序は querySelectorAll と一致）
    const meta = (await page.evaluate(BROWSER_EXTRACT)) as Omit<SlideData, "mockPng" | "mockW" | "mockH">[];
    // 左モックだけ各スライドから撮影
    const slideEls = await page.$$(".slide");
    const out: SlideData[] = [];
    for (let i = 0; i < slideEls.length; i++) {
      await slideEls[i].scrollIntoView();
      await new Promise((r) => setTimeout(r, 350));
      const mock = await slideEls[i].$(".mock");
      if (!mock || !meta[i]) continue;
      const png = Buffer.from((await mock.screenshot({ type: "png" })) as Uint8Array);
      const { w, h } = pngSize(png);
      out.push({ ...meta[i], mockPng: png, mockW: w, mockH: h });
    }
    return out;
  } finally {
    await browser.close();
  }
}

/** 旧挙動: 各 .slide を丸ごと1枚画像で撮影 */
async function captureFlat(htmlAbs: string, scale: number): Promise<Buffer[]> {
  const browser = await puppeteer.launch({
    executablePath: findChromiumPath(),
    headless: true,
    args: [...buildChromiumArgs(), "--window-size=1920,1080"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: scale });
    await page.goto("file://" + htmlAbs, { waitUntil: "networkidle0", timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 1500));
    const slides = await page.$$(".slide");
    const shots: Buffer[] = [];
    for (const el of slides) {
      await el.scrollIntoView();
      await new Promise((r) => setTimeout(r, 400));
      shots.push(Buffer.from((await el.screenshot({ type: "png" })) as Uint8Array));
    }
    return shots;
  } finally {
    await browser.close();
  }
}

/** ハイブリッド: 左=モック画像／右=ネイティブ（編集可能テキスト＋サムネ画像） */
function buildHybridSlide(pptx: any, d: SlideData, idx: number, total: number) {
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  const igColor = "D62976";
  const ttColor = "111111";
  const accent = d.platform === "instagram" ? igColor : ttColor;
  // 上部アクセントバー
  slide.addText("", { x: 0, y: 0, w: SLIDE_W_IN, h: 0.12, fill: { color: accent } });

  // --- 左: スマホモック画像（縦長アスペクト維持・中央寄せ・ソフトシャドウ） ---
  const aspect = d.mockW / d.mockH; // ≈0.5
  const imgH = 6.4;
  const imgW = imgH * aspect;
  const imgX = 0.55;
  const imgY = (SLIDE_H_IN - imgH) / 2 + 0.05;
  slide.addImage({
    data: "data:image/png;base64," + d.mockPng.toString("base64"),
    x: imgX, y: imgY, w: imgW, h: imgH,
    shadow: { type: "outer", blur: 14, offset: 5, angle: 90, color: "8A8AA0", opacity: 0.45 },
  });

  // --- 右: ネイティブ要素 ---
  const x0 = imgX + imgW + 0.55;
  const rightW = SLIDE_W_IN - x0 - 0.5;

  // プラットフォーム pill
  slide.addText(d.platform === "instagram" ? "Instagram" : "TikTok", {
    x: x0, y: 0.5, w: 1.7, h: 0.36, fontFace: FONT, fontSize: 12, bold: true,
    color: "FFFFFF", align: "center", valign: "middle", fill: { color: accent },
  });
  // タイトル
  slide.addText(
    [
      { text: d.title, options: { bold: true, fontSize: 30, color: "15151C" } },
      { text: "   表示順位", options: { fontSize: 16, color: "8A8A96" } },
    ],
    { x: x0, y: 0.98, w: rightW, h: 0.7, fontFace: FONT, valign: "middle" },
  );
  // 自社ピル
  slide.addText(d.ownLine || (d.ownHit ? "" : "自社の該当なし"), {
    x: x0, y: 1.74, w: rightW, h: 0.42, fontFace: FONT, fontSize: 14, valign: "middle", align: "left",
    color: d.ownHit ? "C81E3A" : "6B6B78", fill: { color: d.ownHit ? "FBE6EA" : "EEF0F4" },
  });

  if (d.empty || d.rows.length === 0) {
    slide.addText(d.emptyText || "自社投稿は今回のランキングに該当なし", {
      x: x0, y: 2.7, w: rightW, h: 1.4, fontFace: FONT, fontSize: 16, bold: true,
      color: "8A8B96", align: "center", valign: "middle",
      fill: { color: "FAFBFC" }, line: { color: "D6D8E0", width: 1, dashType: "dash" },
    });
  } else {
    // 列ジオメトリ
    const cThumb = x0;
    const cRank = x0 + 0.7;
    const cAcc = x0 + 1.45;
    const cUrl = x0 + 3.35;
    const urlW = rightW - (cUrl - x0);
    // ヘッダ
    const hy = 2.42;
    const hOpt = { y: hy, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: "8A8B96", valign: "middle" as const };
    slide.addText("サムネ", { x: cThumb, w: 0.65, ...hOpt });
    slide.addText("順位", { x: cRank, w: 0.7, ...hOpt });
    slide.addText("アカウント", { x: cAcc, w: 1.85, ...hOpt });
    slide.addText("URL", { x: cUrl, w: urlW, ...hOpt });
    slide.addText("", { x: x0, y: 2.74, w: rightW, h: 0.02, fill: { color: "ECEEF3" } }); // 区切り線

    const startY = 2.84;
    const rowH = Math.min(0.74, (7.0 - startY) / d.rows.length);
    d.rows.forEach((r, i) => {
      const y = startY + i * rowH;
      if (r.thumb.startsWith("data:image")) {
        slide.addImage({ data: r.thumb, x: cThumb, y: y + 0.04, w: 0.5, h: rowH - 0.12 });
      }
      slide.addText(r.rank, { x: cRank, y, w: 0.7, h: rowH, fontFace: FONT, fontSize: 21, bold: true, color: "FF2D4B", valign: "middle" });
      slide.addText(r.account, { x: cAcc, y, w: 1.85, h: rowH, fontFace: FONT, fontSize: 14, bold: true, color: "15151C", valign: "middle" });
      slide.addText(shortUrl(r.url), {
        x: cUrl, y, w: urlW, h: rowH, fontFace: FONT, fontSize: 10.5, color: "3A6DF0", valign: "middle",
        hyperlink: { url: r.url }, breakLine: false,
      });
      slide.addText("", { x: x0, y: y + rowH - 0.012, w: rightW, h: 0.012, fill: { color: "F1F2F6" } });
    });
  }

  // フッタ
  slide.addText(
    [
      { text: "VSEO Analytics", options: { bold: true, color: "9A9BA6" } },
      { text: `     ${idx + 1} / ${total}`, options: { color: "9A9BA6" } },
    ],
    { x: 0.55, y: 7.04, w: 12, h: 0.3, fontFace: FONT, fontSize: 10, valign: "middle" },
  );
}

async function main() {
  const args = process.argv.slice(2);
  let htmlPath: string | null = null;
  let outPath: string | null = null;
  let scale = 2;
  let flat = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--out") outPath = args[++i] ?? null;
    else if (a === "--scale") scale = Number(args[++i]) || 2;
    else if (a === "--flat") flat = true;
    else if (!a.startsWith("--")) htmlPath = a;
  }
  if (!htmlPath) {
    console.error("使い方: npx tsx scripts/build-pptx.ts <deck.html> [--out <path.pptx>] [--scale 2] [--flat]");
    process.exit(1);
  }

  const htmlAbs = path.resolve(process.cwd(), htmlPath);
  const pptxPath = outPath ?? htmlAbs.replace(/\.html$/, ".pptx");

  console.log(`\n=== PPTX 生成（${flat ? "flat=丸ごと画像" : "hybrid=左モック画像/右ネイティブ編集可"}） ===`);
  console.log(`  入力デック: ${htmlAbs}`);

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "FHD", width: SLIDE_W_IN, height: SLIDE_H_IN });
  pptx.layout = "FHD";

  if (flat) {
    const shots = await captureFlat(htmlAbs, scale);
    console.log(`  撮影: ${shots.length} スライド（全面画像）`);
    if (shots.length === 0) { console.error("  ⚠ .slide が見つかりません"); process.exit(1); }
    for (const buf of shots) {
      pptx.addSlide().addImage({ data: "data:image/png;base64," + buf.toString("base64"), x: 0, y: 0, w: SLIDE_W_IN, h: SLIDE_H_IN });
    }
  } else {
    const data = await captureHybrid(htmlAbs, scale);
    console.log(`  抽出: ${data.length} スライド（左=モック画像 / 右=ネイティブ）`);
    if (data.length === 0) { console.error("  ⚠ .slide が見つかりません"); process.exit(1); }
    data.forEach((d, i) => {
      buildHybridSlide(pptx, d, i, data.length);
      console.log(`    slide ${i + 1}: ${d.title}  （表 ${d.rows.length} 行 / ${d.empty ? "該当なし" : "自社あり"}）`);
    });
  }

  await pptx.writeFile({ fileName: pptxPath });
  console.log(`\n  📊 PowerPoint（16:9）: ${pptxPath}\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\n[build-pptx] 失敗:", e instanceof Error ? e.message : e);
  process.exit(1);
});
