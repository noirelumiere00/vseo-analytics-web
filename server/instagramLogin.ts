/**
 * Instagram sessionid 自動取得スクリプト
 *
 * Puppeteerでログインし、sessionid Cookieを取得して .env に書き込む。
 *
 * 使い方:
 *   npx tsx server/instagramLogin.ts
 *
 * 環境変数:
 *   INSTAGRAM_USERNAME — Instagramのユーザー名またはメールアドレス
 *   INSTAGRAM_PASSWORD — Instagramのパスワード
 *
 * 取得成功すると .env に INSTAGRAM_SESSION_ID=xxx を追記/更新する。
 */

import "dotenv/config";
import puppeteer from "puppeteer-core";
import { findChromiumPath, buildChromiumArgs } from "./tiktokScraper";
import * as fs from "fs";
import * as path from "path";

async function extractSessionId(): Promise<string | null> {
  const username = process.env.INSTAGRAM_USERNAME || process.env.INSTAGRAM_ID;
  const password = process.env.INSTAGRAM_PASSWORD || process.env.INSTAGRAM_Pass;

  if (!username || !password) {
    console.error("Error: INSTAGRAM_USERNAME/INSTAGRAM_ID and INSTAGRAM_PASSWORD/INSTAGRAM_Pass must be set in .env");
    process.exit(1);
  }

  const chromiumPath = findChromiumPath();
  console.log(`[IG Login] Launching browser: ${chromiumPath}`);

  const browser = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: true,
    args: buildChromiumArgs(),
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    );

    // Instagram ログインページに移動
    console.log("[IG Login] Navigating to Instagram login...");
    await page.goto("https://www.instagram.com/accounts/login/", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Cookie バナーを閉じる（あれば）
    try {
      const cookieBtn = await page.$('button[tabindex="0"]');
      if (cookieBtn) {
        const text = await page.evaluate(el => el.textContent, cookieBtn);
        if (text && (text.includes("Allow") || text.includes("Accept") || text.includes("許可"))) {
          await cookieBtn.click();
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    } catch { /* no cookie banner */ }

    // ログインフォームを待機（Meta統合後はname="email"/name="pass"）
    await page.waitForSelector('input[name="email"], input[name="username"]', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 1000));

    // ユーザー名とパスワードを入力
    console.log("[IG Login] Entering credentials...");
    const usernameInput = await page.$('input[name="email"]') || await page.$('input[name="username"]');
    const passwordInput = await page.$('input[name="pass"]') || await page.$('input[name="password"]');

    if (!usernameInput || !passwordInput) {
      throw new Error("Login form not found");
    }

    await usernameInput.click({ clickCount: 3 });
    await usernameInput.type(username, { delay: 50 });
    await new Promise(r => setTimeout(r, 500));

    await passwordInput.click({ clickCount: 3 });
    await passwordInput.type(password, { delay: 50 });
    await new Promise(r => setTimeout(r, 500));

    // ログイン送信（Enterキーで確実に送信）
    console.log("[IG Login] Submitting login...");
    await page.keyboard.press("Enter");

    // ログイン完了を待機（sessionid Cookieが設定されるまで）
    console.log("[IG Login] Waiting for login to complete...");
    let sessionId: string | null = null;

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const cookies = await page.cookies("https://www.instagram.com");
      const sessionCookie = cookies.find(c => c.name === "sessionid");
      if (sessionCookie && sessionCookie.value) {
        sessionId = sessionCookie.value;
        console.log("[IG Login] sessionid obtained successfully!");
        break;
      }

      // エラーチェック
      const errorMsg = await page.evaluate(() => {
        const el = document.querySelector('[role="alert"]') || document.querySelector("#slfErrorAlert");
        return el?.textContent || null;
      });
      if (errorMsg) {
        console.error(`[IG Login] Login error: ${errorMsg}`);
        return null;
      }
    }

    if (!sessionId) {
      console.error("[IG Login] Timeout: sessionid not found after 60 seconds");

      // 2FA チェック
      const pageUrl = page.url();
      if (pageUrl.includes("challenge") || pageUrl.includes("two_factor")) {
        console.error("[IG Login] 2FA/Challenge detected. Please disable 2FA or complete the challenge manually.");
      }
      return null;
    }

    // "Save login info" ポップアップをスキップ（あれば）
    try {
      const notNowBtn = await page.$x('//button[contains(text(), "Not Now") or contains(text(), "後で")]');
      if (notNowBtn.length > 0) {
        await (notNowBtn[0] as any).click();
      }
    } catch { /* no popup */ }

    return sessionId;
  } finally {
    await browser.close();
  }
}

async function updateEnvFile(sessionId: string): Promise<void> {
  const envPath = path.resolve(process.cwd(), ".env");
  let content = "";

  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf-8");
  }

  const key = "INSTAGRAM_SESSION_ID";
  const newLine = `${key}=${sessionId}`;

  if (content.includes(`${key}=`)) {
    // 既存のセッションIDを更新
    content = content.replace(new RegExp(`^${key}=.*$`, "m"), newLine);
  } else {
    // 新規追加
    content = content.trimEnd() + "\n" + newLine + "\n";
  }

  fs.writeFileSync(envPath, content);
  console.log(`[IG Login] .env updated: ${key} = ${sessionId.slice(0, 8)}...`);
}

// メイン実行
(async () => {
  try {
    const sessionId = await extractSessionId();
    if (sessionId) {
      await updateEnvFile(sessionId);
      console.log("\nDone! Instagram sessionid has been saved to .env");
      console.log("You can now use searchInstagramHashtag in the report generator.");
    } else {
      console.error("\nFailed to extract sessionid. Check your credentials and try again.");
      process.exit(1);
    }
  } catch (e) {
    console.error("Fatal error:", e);
    process.exit(1);
  }
})();
