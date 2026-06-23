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

interface RowData { rank: string; account: string; url: string; thumb: string }
interface SlideData {
  platform: "tiktok" | "instagram";
  titleMain: string;
  titleSub: string;
  ownLine: string;
  ownHit: boolean;
  empty: boolean;
  rows: RowData[];
  mockPng: Buffer;
  mockW: number;
  mockH: number;
}

const FONT_JA = "Yu Gothic";
const FONT_EN = "Archivo";
const INK = "1A1A1A";
const MUTED = "6E6E68";
const FAINT = "9A988E";
const LINE = "E4E1D8";
const ACCENT = "C8472F";
const PAPER = "FAF9F6";

function pad2(n: number): string { return String(n).padStart(2, "0"); }

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
  var kl = node.querySelector('.kick .kl');
  var klt = kl ? kl.textContent.trim() : '';
  var platform = klt.indexOf('INSTAGRAM') === 0 ? 'instagram' : 'tiktok';
  var ttl = node.querySelector('.ttl');
  var sub = node.querySelector('.ttl-sub');
  var titleSub = sub ? sub.textContent.trim() : '';
  var titleMain = ttl ? ((ttl.childNodes[0] && ttl.childNodes[0].textContent) || ttl.textContent || '').trim() : '';
  var meta = node.querySelector('.meta');
  var ownLine = meta ? meta.textContent.trim() : '';
  var empty = !!node.querySelector('.empty');
  var rows = [].slice.call(node.querySelectorAll('.list .row')).map(function(li){
    var rk = li.querySelector('.rk');
    var b = li.querySelector('.who b');
    var a = li.querySelector('.who .url');
    var img = li.querySelector('.th img');
    return {
      rank: rk ? rk.textContent.trim() : '',
      account: b ? b.textContent.trim() : '',
      url: a ? a.getAttribute('href') : '',
      thumb: img ? img.getAttribute('src') : ''
    };
  });
  return { platform: platform, titleMain: titleMain, titleSub: titleSub, ownLine: ownLine, ownHit: rows.length > 0, empty: empty, rows: rows };
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

/** ハイブリッド: 左=モック画像／右=ネイティブ（スイス・エディトリアル／編集可能テキスト＋サムネ画像） */
function buildHybridSlide(pptx: any, d: SlideData, idx: number, total: number) {
  const slide = pptx.addSlide();
  slide.background = { color: PAPER };
  const PLAT = d.platform === "instagram" ? "INSTAGRAM" : "TIKTOK";
  const MX = 0.72; // 左右マージン
  const hair = (x: number, y: number, w: number) => slide.addText("", { x, y, w, h: 0.011, fill: { color: LINE } });

  // --- キッカー（左ラベル ／ 右 通し番号）＋ 罫 ---
  slide.addText(`${PLAT}  ·  表示順位`, {
    x: MX, y: 0.5, w: 7, h: 0.3, fontFace: FONT_JA, fontSize: 11, bold: true, color: INK, charSpacing: 2.4, valign: "middle",
  });
  slide.addText(
    [
      { text: pad2(idx + 1), options: { fontSize: 40, bold: true, color: INK } },
      { text: ` / ${pad2(total)}`, options: { fontSize: 15, color: FAINT } },
    ],
    { x: SLIDE_W_IN - MX - 3, y: 0.34, w: 3, h: 0.6, fontFace: FONT_EN, align: "right", valign: "middle" },
  );
  hair(MX, 1.0, SLIDE_W_IN - 2 * MX);

  // --- 左: スマホモック画像（影なし・縦長アスペクト維持） ---
  const aspect = d.mockW / d.mockH; // ≈0.5
  const imgH = 5.55;
  const imgW = imgH * aspect;
  const imgX = MX;
  const imgY = 1.45;
  slide.addImage({ data: "data:image/png;base64," + d.mockPng.toString("base64"), x: imgX, y: imgY, w: imgW, h: imgH });

  // --- 右: ネイティブ ---
  const x0 = imgX + imgW + 0.7;
  const rightW = SLIDE_W_IN - x0 - MX;

  slide.addText(d.titleMain, { x: x0, y: 1.2, w: rightW, h: 0.95, fontFace: FONT_JA, fontSize: 42, bold: true, color: INK, valign: "top" });
  slide.addText(d.titleSub || "表示順位", { x: x0, y: 2.12, w: rightW, h: 0.3, fontFace: FONT_JA, fontSize: 13, color: MUTED });

  // 自社サマリ（件数のみ朱）
  const ownNum = (d.ownLine.match(/自社\s*(\d+)/) || [])[1];
  const ranks = (d.ownLine.match(/順位\s*(.+)$/) || [])[1] || "";
  if (ownNum && Number(ownNum) > 0) {
    slide.addText(
      [
        { text: "自社 ", options: { color: MUTED } },
        { text: ownNum, options: { color: ACCENT, bold: true, fontSize: 14 } },
        { text: " 件   順位 ", options: { color: MUTED } },
        { text: ranks, options: { color: INK } },
      ],
      { x: x0, y: 2.55, w: rightW, h: 0.3, fontFace: FONT_JA, fontSize: 12.5, valign: "middle" },
    );
  } else {
    slide.addText("自社の該当なし", { x: x0, y: 2.55, w: rightW, h: 0.3, fontFace: FONT_JA, fontSize: 12.5, color: MUTED, valign: "middle" });
  }
  hair(x0, 2.98, rightW);

  if (d.empty || d.rows.length === 0) {
    slide.addText("— 自社の該当なし", { x: x0, y: 3.2, w: rightW, h: 0.4, fontFace: FONT_JA, fontSize: 14, color: FAINT });
  } else {
    const startY = 3.12;
    const rowH = Math.min(0.6, (6.95 - startY) / d.rows.length);
    d.rows.forEach((r, i) => {
      const y = startY + i * rowH;
      // 順位（朱）
      slide.addText(r.rank, { x: x0, y, w: 0.82, h: rowH, fontFace: FONT_EN, fontSize: 23, bold: true, color: ACCENT, valign: "middle" });
      // サムネ
      if (r.thumb.startsWith("data:image")) {
        slide.addImage({ data: r.thumb, x: x0 + 0.9, y: y + 0.06, w: 0.4, h: rowH - 0.16 });
      }
      // アカウント＋URL（2段）
      const cx = x0 + 1.45;
      const cw = rightW - 1.45;
      slide.addText(r.account, { x: cx, y: y + 0.02, w: cw, h: rowH * 0.55, fontFace: FONT_EN, fontSize: 14, bold: true, color: INK, valign: "bottom" });
      slide.addText(shortUrl(r.url), {
        x: cx, y: y + rowH * 0.5, w: cw, h: rowH * 0.5, fontFace: FONT_EN, fontSize: 9, color: FAINT, valign: "top",
        hyperlink: { url: r.url }, breakLine: false,
      });
      if (i < d.rows.length - 1) hair(x0, y + rowH - 0.006, rightW);
    });
  }

  // --- フッタ ---
  hair(MX, 7.0, SLIDE_W_IN - 2 * MX);
  slide.addText("VSEO ANALYTICS", { x: MX, y: 7.08, w: 5, h: 0.28, fontFace: FONT_EN, fontSize: 9, bold: true, color: FAINT, charSpacing: 2, valign: "middle" });
  slide.addText(`${PLAT}  ·  ${d.titleMain}`, { x: SLIDE_W_IN - MX - 7, y: 7.08, w: 7, h: 0.28, fontFace: FONT_JA, fontSize: 9, color: FAINT, charSpacing: 1.5, align: "right", valign: "middle" });
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
      console.log(`    slide ${i + 1}: ${d.titleMain}  （表 ${d.rows.length} 行 / ${d.empty ? "該当なし" : "自社あり"}）`);
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
