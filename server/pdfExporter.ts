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

      await page.addStyleTag({
        content: `
          @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
        `,
      });

      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: 30000,
      });

      if (options?.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, { timeout: 10000 });
      }

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
