import puppeteer from 'puppeteer-core';

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

const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
await page.setExtraHTTPHeaders({
  'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7'
});

// Intercept network requests to capture TikTok API responses
const apiResponses = [];
page.on('response', async (response) => {
  const url = response.url();
  if (url.includes('/api/search') || url.includes('search/item') || url.includes('search/general')) {
    try {
      const text = await response.text();
      apiResponses.push({ url, status: response.status(), body: text.substring(0, 5000) });
      console.log(`[API] ${url.substring(0, 150)} -> ${response.status()}`);
    } catch (e) {
      console.log(`[API Error] ${url.substring(0, 100)}: ${e.message}`);
    }
  }
});

console.log('Step 1: Visiting TikTok homepage...');
await page.goto('https://www.tiktok.com/', {
  waitUntil: 'domcontentloaded',
  timeout: 30000
});
await new Promise(r => setTimeout(r, 3000));

console.log('Step 2: Navigating to search...');
await page.goto('https://www.tiktok.com/search/video?q=%E3%82%B8%E3%83%A3%E3%83%B3%E3%82%B0%E3%83%AA%E3%82%A2%E6%B2%96%E7%B8%84', {
  waitUntil: 'domcontentloaded',
  timeout: 30000
});

// Wait longer for JS to render
console.log('Step 3: Waiting for JS rendering...');
await new Promise(r => setTimeout(r, 10000));

// Scroll to trigger more loading
for (let i = 0; i < 5; i++) {
  await page.evaluate(() => window.scrollBy(0, 500));
  await new Promise(r => setTimeout(r, 2000));
}

// Take screenshot
await page.screenshot({ path: '/home/ubuntu/vseo-analytics-web/tiktok-search2.png', fullPage: false });

// Try to extract data from the rendered page
const data = await page.evaluate(() => {
  // Look for video links more broadly
  const allLinks = document.querySelectorAll('a');
  const videoLinks = [];
  allLinks.forEach(a => {
    if (a.href && a.href.includes('/video/')) {
      videoLinks.push({
        href: a.href,
        text: a.textContent?.substring(0, 200),
        parentText: a.parentElement?.textContent?.substring(0, 200)
      });
    }
  });

  // Look for __UNIVERSAL_DATA_FOR_REHYDRATION__
  const scripts = document.querySelectorAll('script');
  let universalData = null;
  scripts.forEach(s => {
    if (s.id === '__UNIVERSAL_DATA_FOR_REHYDRATION__') {
      universalData = s.textContent?.substring(0, 3000);
    }
  });

  // Look for any JSON data in scripts
  let jsonData = null;
  scripts.forEach(s => {
    const text = s.textContent || '';
    if (text.includes('ItemModule') || text.includes('videoData') || text.includes('searchResult')) {
      jsonData = text.substring(0, 2000);
    }
  });

  // Check for shadow DOM or iframe
  const iframes = document.querySelectorAll('iframe');
  
  return {
    videoLinksCount: videoLinks.length,
    videoLinks: videoLinks.slice(0, 15),
    hasUniversalData: !!universalData,
    universalDataPreview: universalData?.substring(0, 1000),
    hasJsonData: !!jsonData,
    jsonDataPreview: jsonData?.substring(0, 500),
    iframeCount: iframes.length,
    allLinksCount: allLinks.length,
    bodyLength: document.body.innerText.length,
    bodyText: document.body.innerText.substring(0, 500)
  };
});

console.log('\n=== Results ===');
console.log('All links:', data.allLinksCount);
console.log('Video links:', data.videoLinksCount);
console.log('Has universal data:', data.hasUniversalData);
console.log('Has JSON data:', data.hasJsonData);
console.log('Iframes:', data.iframeCount);

if (data.videoLinks.length > 0) {
  console.log('\nVideo links:');
  data.videoLinks.forEach((l, i) => console.log(`  ${i+1}. ${l.href}`));
}

if (data.universalDataPreview) {
  console.log('\nUniversal data preview:', data.universalDataPreview.substring(0, 500));
}

if (data.jsonDataPreview) {
  console.log('\nJSON data preview:', data.jsonDataPreview);
}

console.log('\nAPI responses captured:', apiResponses.length);
apiResponses.forEach((r, i) => {
  console.log(`\n--- API Response ${i+1} ---`);
  console.log('URL:', r.url.substring(0, 200));
  console.log('Status:', r.status);
  console.log('Body preview:', r.body.substring(0, 500));
});

console.log('\nBody text:', data.bodyText);

await browser.close();
