import puppeteer from "puppeteer";

// Puppeteerでプロキシを使う方法: --proxy-server引数
// 無料プロキシは不安定なので、複数試す

const JP_PROXIES = [
  // spys.oneから取得した日本のSOCKS5プロキシ
  "socks5://140.238.43.53:54322",
  // HTTPプロキシも試す
];

async function testProxyDirect() {
  console.log("=== テスト1: プロキシなしでTikTok検索API ===");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  
  try {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36");
    
    // まずTikTokにアクセスしてCookieを取得
    await page.goto("https://www.tiktok.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    
    // IPチェック
    const ipPage = await context.newPage();
    const ipResult = await ipPage.evaluate(async () => {
      try {
        const res = await fetch("https://ipinfo.io/json");
        return await res.json();
      } catch(e) { return { error: e.message }; }
    });
    console.log("ブラウザIP:", JSON.stringify(ipResult));
    await ipPage.close();
    
    // TikTok検索
    await page.goto("https://www.tiktok.com/search?q=%E3%82%AF%E3%82%A4%E3%83%83%E3%82%AF%E3%83%87%E3%82%A3%E3%83%8A%E3%83%BC", { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    
    const result = await page.evaluate(async () => {
      const url = `https://www.tiktok.com/api/search/general/full/?keyword=${encodeURIComponent("クイックディナー")}&offset=0&search_source=normal_search&WebIdLastTime=${Math.floor(Date.now()/1000)}&aid=1988&app_language=ja-JP&browser_language=ja-JP&priority_region=JP&region=JP`;
      try {
        const res = await fetch(url, { credentials: "include" });
        const json = await res.json();
        const videos = json.data?.filter(item => item.type === 1)?.map(item => ({
          desc: item.item?.desc?.substring(0, 50),
          author: item.item?.author?.nickname,
          region: item.item?.author?.region
        })) || [];
        return { status: res.status, videoCount: videos.length, videos: videos.slice(0, 5) };
      } catch(e) { return { error: e.message }; }
    });
    console.log("プロキシなし結果:", JSON.stringify(result, null, 2));
    
    await context.close();
  } finally {
    await browser.close();
  }
}

async function testWithProxy(proxyUrl) {
  console.log(`\n=== テスト2: プロキシ ${proxyUrl} ===`);
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      `--proxy-server=${proxyUrl}`
    ]
  });
  
  try {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36");
    
    // IPチェック
    try {
      await page.goto("https://ipinfo.io/json", { waitUntil: "domcontentloaded", timeout: 15000 });
      const ipText = await page.evaluate(() => document.body.innerText);
      const ipData = JSON.parse(ipText);
      console.log("プロキシ経由IP:", ipData.ip, ipData.country, ipData.city);
      
      if (ipData.country !== "JP") {
        console.log("日本のIPではないためスキップ");
        await browser.close();
        return;
      }
    } catch(e) {
      console.log("プロキシ接続失敗:", e.message);
      await browser.close();
      return;
    }
    
    // TikTokにアクセス
    await page.goto("https://www.tiktok.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    
    await page.goto("https://www.tiktok.com/search?q=%E3%82%AF%E3%82%A4%E3%83%83%E3%82%AF%E3%83%87%E3%82%A3%E3%83%8A%E3%83%BC", { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    
    const result = await page.evaluate(async () => {
      const url = `https://www.tiktok.com/api/search/general/full/?keyword=${encodeURIComponent("クイックディナー")}&offset=0&search_source=normal_search&WebIdLastTime=${Math.floor(Date.now()/1000)}&aid=1988&app_language=ja-JP&browser_language=ja-JP&priority_region=JP&region=JP`;
      try {
        const res = await fetch(url, { credentials: "include" });
        const json = await res.json();
        const videos = json.data?.filter(item => item.type === 1)?.map(item => ({
          desc: item.item?.desc?.substring(0, 50),
          author: item.item?.author?.nickname,
          region: item.item?.author?.region
        })) || [];
        return { status: res.status, videoCount: videos.length, videos: videos.slice(0, 5) };
      } catch(e) { return { error: e.message }; }
    });
    console.log("プロキシ経由結果:", JSON.stringify(result, null, 2));
    
    await context.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  await testProxyDirect();
  
  for (const proxy of JP_PROXIES) {
    await testWithProxy(proxy);
  }
}

main().catch(console.error);
