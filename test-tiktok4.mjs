import puppeteer from 'puppeteer-core';

// Approach 1: モバイルUA + ログインモーダル回避
// Approach 2: TikTokの内部APIを直接叩く
// Approach 3: __UNIVERSAL_DATA_FOR_REHYDRATION__からSSRデータを取得
// Approach 4: ログインモーダルを閉じてスクロール

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium-browser',
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1920,1080',
    '--lang=ja-JP'
  ]
});

// ===== Approach 1: モバイルUA =====
console.log('\n===== Approach 1: モバイルUA =====');
const page1 = await browser.newPage();
await page1.setViewport({ width: 390, height: 844, isMobile: true });
await page1.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
await page1.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP,ja;q=0.9' });

await page1.goto('https://www.tiktok.com/search/video?q=%E3%82%B8%E3%83%A3%E3%83%B3%E3%82%B0%E3%83%AA%E3%82%A2%E6%B2%96%E7%B8%84', {
  waitUntil: 'domcontentloaded', timeout: 30000
});
await new Promise(r => setTimeout(r, 8000));
await page1.screenshot({ path: '/home/ubuntu/vseo-analytics-web/tiktok-mobile.png' });

const mobileData = await page1.evaluate(() => {
  const links = document.querySelectorAll('a[href*="/video/"]');
  return {
    count: links.length,
    links: Array.from(links).slice(0, 5).map(a => a.href),
    body: document.body.innerText.substring(0, 500)
  };
});
console.log('Mobile - Video links:', mobileData.count);
console.log('Mobile - Body:', mobileData.body.substring(0, 200));
await page1.close();

// ===== Approach 2: TikTok内部API直接呼び出し =====
console.log('\n===== Approach 2: TikTok内部API =====');
const page2 = await browser.newPage();
await page2.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

// まずTikTokにアクセスしてCookieを取得
await page2.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));

// 内部APIを叩く
const apiResult = await page2.evaluate(async () => {
  try {
    const response = await fetch('https://www.tiktok.com/api/search/general/full/?keyword=%E3%82%B8%E3%83%A3%E3%83%B3%E3%82%B0%E3%83%AA%E3%82%A2%E6%B2%96%E7%B8%84&offset=0&search_source=normal_search&WebIdLastTime=' + Math.floor(Date.now()/1000), {
      credentials: 'include'
    });
    const text = await response.text();
    return { status: response.status, body: text.substring(0, 3000) };
  } catch (e) {
    return { error: e.message };
  }
});
console.log('API Status:', apiResult.status || apiResult.error);
console.log('API Body:', (apiResult.body || '').substring(0, 500));
await page2.close();

// ===== Approach 3: SSRデータ取得 =====
console.log('\n===== Approach 3: SSRデータ取得 =====');
const page3 = await browser.newPage();
await page3.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

// requestInterceptionを有効にしてJSを無効化（SSRデータだけ取得）
await page3.setRequestInterception(true);
page3.on('request', (req) => {
  if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
    req.abort();
  } else {
    req.continue();
  }
});

await page3.goto('https://www.tiktok.com/search/video?q=%E3%82%B8%E3%83%A3%E3%83%B3%E3%82%B0%E3%83%AA%E3%82%A2%E6%B2%96%E7%B8%84', {
  waitUntil: 'domcontentloaded', timeout: 30000
});

const ssrData = await page3.evaluate(() => {
  const script = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
  if (script) {
    try {
      const data = JSON.parse(script.textContent);
      return { found: true, keys: Object.keys(data.__DEFAULT_SCOPE__ || {}), raw: script.textContent.substring(0, 5000) };
    } catch (e) {
      return { found: true, parseError: e.message, raw: script.textContent.substring(0, 2000) };
    }
  }
  // Also check for SIGI_STATE
  const scripts = document.querySelectorAll('script');
  let sigiFound = false;
  scripts.forEach(s => {
    if ((s.textContent || '').includes('SIGI_STATE')) sigiFound = true;
  });
  return { found: false, sigiFound };
});
console.log('SSR Data found:', ssrData.found);
if (ssrData.keys) console.log('SSR Keys:', ssrData.keys);
if (ssrData.raw) console.log('SSR Raw preview:', ssrData.raw.substring(0, 1000));
await page3.close();

// ===== Approach 4: ログインモーダルを閉じる =====
console.log('\n===== Approach 4: ログインモーダルを閉じる =====');
const page4 = await browser.newPage();
await page4.setViewport({ width: 1920, height: 1080 });
await page4.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
await page4.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP,ja;q=0.9' });

// ネットワークインターセプトで検索APIレスポンスをキャプチャ
const capturedApiData = [];
page4.on('response', async (response) => {
  const url = response.url();
  if (url.includes('/api/search') && url.includes('full')) {
    try {
      const text = await response.text();
      capturedApiData.push({ url: url.substring(0, 200), body: text });
      console.log(`[Captured API] ${url.substring(0, 100)} -> ${response.status()}`);
    } catch (e) {}
  }
});

await page4.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));

await page4.goto('https://www.tiktok.com/search/video?q=%E3%82%B8%E3%83%A3%E3%83%B3%E3%82%B0%E3%83%AA%E3%82%A2%E6%B2%96%E7%B8%84', {
  waitUntil: 'domcontentloaded', timeout: 30000
});
await new Promise(r => setTimeout(r, 8000));

// ログインモーダルを閉じる
try {
  const closeBtn = await page4.$('[data-e2e="modal-close-inner-button"], button[aria-label="Close"], div[role="dialog"] button');
  if (closeBtn) {
    await closeBtn.click();
    console.log('Closed login modal');
    await new Promise(r => setTimeout(r, 2000));
  }
  // ESCキーでも試す
  await page4.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 2000));
} catch (e) {
  console.log('No modal to close:', e.message);
}

// スクロールして動画を読み込む
for (let i = 0; i < 3; i++) {
  await page4.evaluate(() => window.scrollBy(0, 500));
  await new Promise(r => setTimeout(r, 2000));
}

await page4.screenshot({ path: '/home/ubuntu/vseo-analytics-web/tiktok-after-close.png' });

const afterCloseData = await page4.evaluate(() => {
  const links = document.querySelectorAll('a[href*="/video/"]');
  return {
    count: links.length,
    links: Array.from(links).slice(0, 10).map(a => a.href),
    body: document.body.innerText.substring(0, 500)
  };
});
console.log('After close - Video links:', afterCloseData.count);
if (afterCloseData.links.length > 0) {
  console.log('Video links:');
  afterCloseData.links.forEach((l, i) => console.log(`  ${i+1}. ${l}`));
}

console.log('\nCaptured API data:', capturedApiData.length);
capturedApiData.forEach((d, i) => {
  console.log(`\n--- Captured API ${i+1} ---`);
  console.log('Body preview:', d.body.substring(0, 1000));
});

await page4.close();
await browser.close();
