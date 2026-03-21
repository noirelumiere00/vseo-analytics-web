import puppeteer from "puppeteer-core";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium-browser",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
  await page.setExtraHTTPHeaders({ "Accept-Language": "ja-JP,ja;q=0.9" });

  const capturedItems: Array<{ id: string; createTime: number }> = [];

  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("/api/post/item_list/")) {
      const status = response.status();
      const headers = response.headers();
      console.log(`[post/item_list] status: ${status}, content-type: ${headers["content-type"]}, content-encoding: ${headers["content-encoding"]}`);
      try {
        const buf = await response.buffer();
        console.log(`[post/item_list] buffer size: ${buf.length}`);
        const text = buf.toString("utf-8");
        if (text.length < 500) {
          console.log(`[post/item_list] body: ${text}`);
        } else {
          const json = JSON.parse(text);
          console.log(`[post/item_list] keys: ${Object.keys(json)}, itemList: ${(json.itemList || []).length}`);
          for (const item of json.itemList || []) {
            if (item.id && item.createTime) {
              capturedItems.push({ id: item.id, createTime: item.createTime });
            }
          }
        }
      } catch (e: any) {
        console.log(`[post/item_list] error: ${e.message}`);
      }
    }
  });

  await page.goto("https://www.tiktok.com/@usj_official", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 3000));
  }

  // DOM fallback: video要素を探す
  const domResult = await page.evaluate(() => {
    // 方法1: data-e2e属性
    const postItems = document.querySelectorAll('[data-e2e="user-post-item"]');
    // 方法2: aタグから/video/IDを抽出
    const allLinks = Array.from(document.querySelectorAll('a[href*="/video/"]'));
    const videoLinks = allLinks.map(a => {
      const href = a.getAttribute("href") || "";
      const match = href.match(/\/video\/(\d+)/);
      return match ? match[1] : null;
    }).filter(Boolean);
    // 方法3: div[class*="DivItemContainer"]
    const divItems = document.querySelectorAll('[class*="DivItemContainer"]');

    return {
      postItemCount: postItems.length,
      videoLinkCount: videoLinks.length,
      videoLinks: [...new Set(videoLinks)].slice(0, 5),
      divItemCount: divItems.length,
      bodyHeight: document.body.scrollHeight,
    };
  });

  const ssr = await page.evaluate(() => {
    const el = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
    if (!el || !el.textContent) return null;
    const parsed = JSON.parse(el.textContent);
    const ud = parsed.__DEFAULT_SCOPE__?.["webapp.user-detail"];
    return {
      nickname: ud?.userInfo?.user?.nickname,
      followerCount: ud?.userInfo?.stats?.followerCount,
      videoCount: ud?.userInfo?.stats?.videoCount,
    };
  });

  console.log("\n=== Final ===");
  console.log("SSR:", JSON.stringify(ssr));
  console.log("DOM:", JSON.stringify(domResult));
  console.log("API items:", capturedItems.length);

  await browser.close();
})();
