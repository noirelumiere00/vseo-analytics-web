/**
 * Instagram sessionid 自動取得スクリプト
 *
 * Puppeteerでログインし、sessionid Cookieを取得して .env に書き込む。
 * 認証情報はファイルに保存せず、実行時に対話入力で取得する。
 *
 * 使い方:
 *   npx tsx server/instagramLogin.ts
 */

import "dotenv/config";
import puppeteer from "puppeteer-core";
import { findChromiumPath, buildChromiumArgs } from "./tiktokScraper";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

/** ターミナルから対話入力を取得（パスワードは非表示） */
function prompt(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (hidden && process.stdin.isTTY) {
      // パスワード入力時はエコーバックを無効化
      process.stdout.write(question);
      const stdin = process.openStdin();
      process.stdin.on("data", (char) => {
        const str = char.toString();
        if (str === "\n" || str === "\r" || str === "\r\n") return;
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(question + "*".repeat(str.length));
      });
      rl.question("", (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

async function extractSessionId(): Promise<string | null> {
  console.log("=== Instagram Session ID 取得ツール ===\n");
  console.log("※ 認証情報はメモリ上のみで使用し、ファイルには保存しません。\n");

  const username = await prompt("Instagram ユーザー名/メール: ");
  const password = await prompt("Instagram パスワード: ");

  if (!username || !password) {
    console.error("Error: ユーザー名とパスワードの両方が必要です。");
    process.exit(1);
  }

  const chromiumPath = findChromiumPath();
  console.log(`\n[IG Login] Launching browser: ${chromiumPath}`);

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

    // ログインフォームを待機
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

    // ログイン送信
    console.log("[IG Login] Submitting login...");
    await page.keyboard.press("Enter");

    // ログイン完了を待機
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
      const pageUrl = page.url();
      if (pageUrl.includes("challenge") || pageUrl.includes("two_factor")) {
        console.error("[IG Login] 2FA/Challenge detected. Please disable 2FA or complete the challenge manually.");
      }
      return null;
    }

    // "Save login info" ポップアップをスキップ
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

  // コメントアウトされた行も置換対象
  const commentedPattern = new RegExp(`^#\\s*${key}=.*$`, "m");
  const activePattern = new RegExp(`^${key}=.*$`, "m");

  if (activePattern.test(content)) {
    content = content.replace(activePattern, newLine);
  } else if (commentedPattern.test(content)) {
    content = content.replace(commentedPattern, newLine);
  } else {
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
