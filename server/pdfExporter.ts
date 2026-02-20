import puppeteer, { type Browser, type Page } from "puppeteer";
import pLimit from "p-limit";

let browserInstance: Browser | null = null;
const limit = pLimit(3);

/**
 * Puppeteer ブラウザインスタンスを初期化（サーバー起動時に呼び出し）
 */
export async function initializeBrowser(): Promise<void> {
  if (browserInstance) {
    return;
  }

  try {
    const launchOptions: any = {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--font-render-hinting=none",
        "--disable-gpu",
      ],
    };

    // システム Chromium を使用（Docker/Linux 環境対応）
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    browserInstance = await puppeteer.launch(launchOptions);
    console.log("[PDF Exporter] Puppeteer browser initialized");
  } catch (error) {
    console.error("[PDF Exporter] Failed to initialize browser:", error);
    console.error("[PDF Exporter] Ensure Chromium is installed: apt-get install chromium-browser");
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
  }
}

/**
 * Puppeteer ブラウザインスタンスをシャットダウン
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
    console.log("[PDF Exporter] Puppeteer browser closed");
  }
}

/**
 * HTML スナップショットから PDF を生成（認証不要）
 * @param html - フロントエンドから送信された HTML
 * @param baseUrl - ベース URL（相対パスのリソース読み込み用）
 * @returns PDF バッファ
 */
export async function generatePdfFromSnapshot(
  html: string,
  baseUrl: string
): Promise<Buffer> {
  if (!browserInstance) {
    throw new Error("Browser not initialized. Call initializeBrowser() first.");
  }

  return limit(async () => {
    let page: Page | null = null;

    try {
      page = await browserInstance!.newPage();
      if (!page) throw new Error("Failed to create page");
      await page.setViewport({ width: 1200, height: 1600 });

      // <base href> を注入して相対パスを解決
      const finalHtml = html.replace(
        '<head>',
        `<head><base href="${baseUrl}">`
      );

      console.log(`[PDF Exporter] Setting HTML content with base URL: ${baseUrl}`);
      await page.setContent(finalHtml, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      console.log(`[PDF Exporter] HTML content set successfully`);

      // アニメーション完了待機
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // プリント用スタイルを注入
      await page.addStyleTag({
        content: getPrintStyles(),
      });

      // 画面用CSS（@media screen）を強制適用して背景色を保持
      if (page) {
        await page.emulateMediaType('screen');
      }

      const pdfBuffer = await page.pdf({
        format: "A4",
        margin: {
          top: "1cm",
          right: "1cm",
          bottom: "1cm",
          left: "1cm",
        },
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: `
          <div style="font-size: 12px; width: 100%; text-align: center; padding: 10px;">
            TikTok VSEO分析レポート
          </div>
        `,
        footerTemplate: `
          <div style="font-size: 12px; width: 100%; text-align: right; padding: 10px;">
            <span class="pageNumber"></span> / <span class="totalPages"></span>
          </div>
        `,
      });

      console.log(`[PDF Exporter] PDF generated from snapshot successfully`);
      return Buffer.from(pdfBuffer);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[PDF Exporter] Error generating PDF from snapshot:`, errorMessage);
      throw error;
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
  });
}

/**
 * PDF生成用のスタイルを注入（アコーディオン全開・改ページ制御）
 */
function getPrintStyles(): string {
  return `
    @media print {
      [data-state="closed"] > [role="region"],
      .accordion-content,
      [data-radix-collapsible-content] {
        display: block !important;
        height: auto !important;
        overflow: visible !important;
        visibility: visible !important;
        opacity: 1 !important;
      }

      [data-radix-collection-item] svg,
      .accordion-icon {
        display: none !important;
      }

      .video-card,
      .analysis-section,
      [role="region"] {
        page-break-inside: avoid;
      }

      @page {
        margin: 1cm;
        size: A4;
      }

      body {
        background: white;
        color: black;
      }

      [class*="bg-"],
      [class*="gradient"] {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      body::before {
        content: "TikTok VSEO分析レポート";
        display: block;
        font-size: 20px;
        font-weight: bold;
        margin-bottom: 20px;
        page-break-after: avoid;
      }
    }

    body {
      font-family: 'Noto Sans JP', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }
  `;
}

/**
 * HTML ページを PDF に変換
 */
export async function generatePdfFromUrl(
  url: string,
  options?: {
    width?: number;
    height?: number;
    waitForSelector?: string;
    waitForTimeout?: number;
    sessionCookie?: string; // セッション Cookie を注入するためのオプション
    authToken?: string; // Authorization ヘッダー用トークン
  }
): Promise<Buffer> {
  if (!browserInstance) {
    throw new Error("Browser not initialized. Call initializeBrowser() first.");
  }

  return limit(async () => {
    let page: Page | null = null;

    try {
      page = await browserInstance!.newPage();

      await page.setViewport({
        width: options?.width || 1200,
        height: options?.height || 1600,
      });

      // 認証情報を全方位で注入（ページ遷移前）
      if (options?.sessionCookie) {
        const targetUrl = new URL(url);
        console.log(`[PDF Exporter] Attempting to inject auth for domain: ${targetUrl.hostname}`);
        console.log(`[PDF Exporter] Session cookie value: ${options.sessionCookie.substring(0, 20)}...`);

        // 1. Cookie を注入
        try {
          let domain = targetUrl.hostname;
          // localhost の場合はドメイン指定を調整
          if (domain === 'localhost' || domain === '127.0.0.1') {
            domain = 'localhost';
          }

          await page.setCookie({
            name: 'app_session_id',
            value: options.sessionCookie,
            domain: domain,
            path: '/',
            httpOnly: false, // Puppeteer では httpOnly を false にしないと設定できない場合がある
            secure: targetUrl.protocol === 'https:',
          });
          console.log(`[PDF Exporter] Cookie injected successfully for domain: ${domain}`);
        } catch (e) {
          console.warn(`[PDF Exporter] Cookie injection failed:`, e);
        }

        // 2. Authorization ヘッダーを設定
        try {
          await page.setExtraHTTPHeaders({
            'Authorization': `Bearer ${options.sessionCookie}`,
            'Cookie': `app_session_id=${options.sessionCookie}`,
          });
          console.log(`[PDF Exporter] HTTP headers set with Authorization token`);
        } catch (e) {
          console.warn(`[PDF Exporter] HTTP headers setting failed:`, e);
        }

        // 3. LocalStorage に強制セット
        try {
          await page.evaluateOnNewDocument((token) => {
            localStorage.setItem('app_session_id', token);
            localStorage.setItem('token', token);
            sessionStorage.setItem('app_session_id', token);
            sessionStorage.setItem('token', token);
          }, options.sessionCookie);
          console.log(`[PDF Exporter] LocalStorage and SessionStorage set`);
        } catch (e) {
          console.warn(`[PDF Exporter] LocalStorage setting failed:`, e);
        }
      }

      await page.addStyleTag({
        content: `
          @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
        `,
      });

      console.log(`[PDF Exporter] Navigating to URL: ${url}`);
      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });
      console.log(`[PDF Exporter] Page loaded successfully`);

      if (options?.waitForSelector) {
        console.log(`[PDF Exporter] Waiting for selector: ${options.waitForSelector}`);
        await page.waitForSelector(options.waitForSelector, { timeout: 10000 }).catch(() => {
          console.warn(`[PDF Exporter] Selector '${options.waitForSelector}' not found, continuing anyway`);
        });
        console.log(`[PDF Exporter] Selector found or timeout reached`);
      }

      // アニメーション完了待機（アコーディオンの開き切り待機）
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (options?.waitForTimeout) {
        await new Promise((resolve) => setTimeout(resolve, options.waitForTimeout));
      }

      await page.addStyleTag({
        content: getPrintStyles(),
      });

      const pdfBuffer = await page.pdf({
        format: "A4",
        margin: {
          top: "1cm",
          right: "1cm",
          bottom: "1cm",
          left: "1cm",
        },
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: `
          <div style="font-size: 12px; width: 100%; text-align: center; padding: 10px;">
            TikTok VSEO分析レポート
          </div>
        `,
        footerTemplate: `
          <div style="font-size: 12px; width: 100%; text-align: right; padding: 10px;">
            <span class="pageNumber"></span> / <span class="totalPages"></span>
          </div>
        `,
      });

      return Buffer.from(pdfBuffer);
    } finally {
      if (page) {
        await page.close();
      }
    }
  });
}

/**
 * 複数のURL から PDF を一括生成
 */
export async function generatePdfsFromUrls(urls: string[]): Promise<Buffer[]> {
  return Promise.all(urls.map((url) => generatePdfFromUrl(url)));
}
