/**
 * build-pptx.ts — 提案デックHTML（`out/proposal-combined-*.html` 等）を「本物の .pptx（PowerPoint）」に変換する。
 *
 * 各 .slide（1920×1080＝16:9）をヘッドレスChromeで撮影し、PowerPoint 16:9（13.333in×7.5in）の
 * スライドに**全面（フルブリード）画像**として配置する。スマホモック＋自社表をピクセル等価で再現。
 * → PowerPoint/Keynote/Googleスライドで開け、投影・PDF化・印刷できる。
 *
 * 使い方:
 *   npx tsx scripts/build-pptx.ts out/proposal-combined-FULL.html [--out <path.pptx>] [--scale 2]
 *
 * 注: スライドは画像なのでテキストは非編集（提案用途で現状のHTML/PNGと同じ見た目をそのまま .pptx 化）。
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

/** deck HTML を開いて各 .slide を PNG（Buffer）で撮影 */
async function captureSlides(htmlAbs: string, scale: number): Promise<Buffer[]> {
  const browser = await puppeteer.launch({
    executablePath: findChromiumPath(),
    headless: true,
    args: [...buildChromiumArgs(), "--window-size=1920,1080"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: scale });
    await page.goto("file://" + htmlAbs, { waitUntil: "networkidle0", timeout: 60_000 });
    // iframe srcdoc（スマホモック）の描画待ち
    await new Promise((r) => setTimeout(r, 1500));
    const slides = await page.$$(".slide");
    const shots: Buffer[] = [];
    for (const el of slides) {
      await el.scrollIntoView();
      await new Promise((r) => setTimeout(r, 400));
      const buf = (await el.screenshot({ type: "png" })) as Uint8Array;
      shots.push(Buffer.from(buf));
    }
    return shots;
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  let htmlPath: string | null = null;
  let outPath: string | null = null;
  let scale = 2;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--out") outPath = args[++i] ?? null;
    else if (a === "--scale") scale = Number(args[++i]) || 2;
    else if (!a.startsWith("--")) htmlPath = a;
  }
  if (!htmlPath) {
    console.error("使い方: npx tsx scripts/build-pptx.ts <deck.html> [--out <path.pptx>] [--scale 2]");
    process.exit(1);
  }

  const htmlAbs = path.resolve(process.cwd(), htmlPath);
  const pptxPath = outPath ?? htmlAbs.replace(/\.html$/, ".pptx");

  console.log(`\n=== PPTX 生成 ===`);
  console.log(`  入力デック: ${htmlAbs}`);
  console.log(`  各スライドを ${scale}x で撮影中…`);
  const shots = await captureSlides(htmlAbs, scale);
  console.log(`  撮影: ${shots.length} スライド`);
  if (shots.length === 0) {
    console.error("  ⚠ .slide が見つかりませんでした（deck HTML を確認）");
    process.exit(1);
  }

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "FHD", width: SLIDE_W_IN, height: SLIDE_H_IN });
  pptx.layout = "FHD";

  for (const buf of shots) {
    const slide = pptx.addSlide();
    slide.addImage({
      data: "data:image/png;base64," + buf.toString("base64"),
      x: 0,
      y: 0,
      w: SLIDE_W_IN,
      h: SLIDE_H_IN,
    });
  }

  await pptx.writeFile({ fileName: pptxPath });
  console.log(`\n  📊 PowerPoint（16:9・${shots.length}スライド）: ${pptxPath}\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\n[build-pptx] 失敗:", e instanceof Error ? e.message : e);
  process.exit(1);
});
