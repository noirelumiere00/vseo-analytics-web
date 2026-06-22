/**
 * shoot-deck.ts — 提案デックHTMLの各 .slide を 1920×1080 PNG でスクショ（プレビュー用）。
 * 使い方: npx tsx scripts/shoot-deck.ts out/proposal-combined-*.html
 */
import * as path from "path";
import puppeteer from "puppeteer-core";
import { findChromiumPath, buildChromiumArgs } from "../server/tiktokScraper";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("使い方: npx tsx scripts/shoot-deck.ts <deck.html>");
    process.exit(1);
  }
  const abs = path.resolve(process.cwd(), file);
  const browser = await puppeteer.launch({
    executablePath: findChromiumPath(),
    headless: true,
    args: [...buildChromiumArgs(), "--window-size=1920,1080"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto("file://" + abs, { waitUntil: "networkidle0", timeout: 60_000 });
    // iframe srcdoc のレンダリング待ち
    await new Promise((r) => setTimeout(r, 1500));
    const slides = await page.$$(".slide");
    console.log(`slides: ${slides.length}`);
    const base = abs.replace(/\.html$/, "");
    for (let i = 0; i < slides.length; i++) {
      await slides[i].scrollIntoView();
      await new Promise((r) => setTimeout(r, 400));
      const out = `${base}-slide${i + 1}.png`;
      await slides[i].screenshot({ path: out });
      console.log("  →", out);
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
