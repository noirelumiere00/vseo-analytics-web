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

// Set language headers
await page.setExtraHTTPHeaders({
  'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7'
});

// First visit TikTok to get cookies
console.log('Step 1: Visiting TikTok homepage...');
await page.goto('https://www.tiktok.com/', {
  waitUntil: 'domcontentloaded',
  timeout: 30000
});
await new Promise(r => setTimeout(r, 3000));

// Now search
console.log('Step 2: Navigating to search...');
await page.goto('https://www.tiktok.com/search/video?q=%E3%82%B8%E3%83%A3%E3%83%B3%E3%82%B0%E3%83%AA%E3%82%A2%E6%B2%96%E7%B8%84', {
  waitUntil: 'domcontentloaded',
  timeout: 30000
});

console.log('Page title:', await page.title());
console.log('Page URL:', page.url());

// Wait and scroll to trigger lazy loading
console.log('Step 3: Waiting for content...');
await new Promise(r => setTimeout(r, 5000));

// Scroll down to load more content
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.scrollBy(0, 800));
  await new Promise(r => setTimeout(r, 2000));
}

// Take a screenshot for debugging
await page.screenshot({ path: '/home/ubuntu/vseo-analytics-web/tiktok-search.png', fullPage: false });
console.log('Screenshot saved to tiktok-search.png');

// Try multiple selectors
const data = await page.evaluate(() => {
  // Method 1: Look for video links
  const videoLinks = document.querySelectorAll('a[href*="/video/"]');
  
  // Method 2: Look for user links
  const userLinks = document.querySelectorAll('a[href*="/@"]');
  
  // Method 3: Look for any data attributes
  const searchItems = document.querySelectorAll('[data-e2e*="search"]');
  
  // Method 4: Look for video containers by various class patterns
  const allDivs = document.querySelectorAll('div');
  const videoContainers = [];
  allDivs.forEach(div => {
    const cls = div.className || '';
    if (cls.includes('Video') || cls.includes('video') || cls.includes('Item') || cls.includes('Card')) {
      if (div.querySelector('a[href*="/video/"]')) {
        videoContainers.push({
          className: cls.substring(0, 100),
          text: div.textContent?.substring(0, 200)
        });
      }
    }
  });

  // Method 5: Try to intercept __NEXT_DATA__ or SIGI_STATE
  const scripts = document.querySelectorAll('script');
  let sigiState = null;
  let nextData = null;
  scripts.forEach(s => {
    const text = s.textContent || '';
    if (text.includes('SIGI_STATE') || text.includes('__UNIVERSAL_DATA_FOR_REHYDRATION__')) {
      sigiState = text.substring(0, 500);
    }
    if (s.id === '__NEXT_DATA__') {
      nextData = text.substring(0, 500);
    }
  });

  return {
    videoLinksCount: videoLinks.length,
    videoLinks: Array.from(videoLinks).slice(0, 10).map(a => ({
      href: a.href,
      text: a.textContent?.substring(0, 100)
    })),
    userLinksCount: userLinks.length,
    userLinks: Array.from(userLinks).slice(0, 10).map(a => ({
      href: a.href,
      text: a.textContent?.substring(0, 50)
    })),
    searchItemsCount: searchItems.length,
    videoContainersCount: videoContainers.length,
    videoContainers: videoContainers.slice(0, 3),
    hasSigiState: !!sigiState,
    sigiStatePreview: sigiState?.substring(0, 300),
    hasNextData: !!nextData,
    bodyTextLength: document.body.innerText.length,
    bodyText: document.body.innerText.substring(0, 1000)
  };
});

console.log('\n=== Results ===');
console.log('Video links:', data.videoLinksCount);
console.log('User links:', data.userLinksCount);
console.log('Search items:', data.searchItemsCount);
console.log('Video containers:', data.videoContainersCount);
console.log('Has SIGI_STATE:', data.hasSigiState);
console.log('Has __NEXT_DATA__:', data.hasNextData);
console.log('\nVideo links:', JSON.stringify(data.videoLinks, null, 2));
console.log('\nUser links:', JSON.stringify(data.userLinks.slice(0, 5), null, 2));
if (data.videoContainers.length > 0) {
  console.log('\nVideo containers:', JSON.stringify(data.videoContainers, null, 2));
}
if (data.sigiStatePreview) {
  console.log('\nSIGI_STATE preview:', data.sigiStatePreview);
}
console.log('\nBody text:', data.bodyText.substring(0, 500));

await browser.close();
