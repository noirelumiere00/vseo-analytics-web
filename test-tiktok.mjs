import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium-browser',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
});

const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

console.log('Navigating to TikTok search...');
await page.goto('https://www.tiktok.com/search?q=%E3%82%B8%E3%83%A3%E3%83%B3%E3%82%B0%E3%83%AA%E3%82%A2%E6%B2%96%E7%B8%84', {
  waitUntil: 'networkidle2',
  timeout: 30000
});

console.log('Page title:', await page.title());
console.log('Page URL:', page.url());

// Wait for content to load
await new Promise(r => setTimeout(r, 5000));

// Try to get video data from the page
const data = await page.evaluate(() => {
  // Try to find video elements
  const videoCards = document.querySelectorAll('[data-e2e="search_top-item"], [data-e2e="search-card-desc"], div[class*="DivItemContainer"], div[class*="DivVideoCard"]');
  console.log('Found video cards:', videoCards.length);
  
  // Also check for any video links
  const videoLinks = document.querySelectorAll('a[href*="/video/"]');
  
  return {
    videoCardsCount: videoCards.length,
    videoLinksCount: videoLinks.length,
    videoLinks: Array.from(videoLinks).slice(0, 5).map(a => ({
      href: a.href,
      text: a.textContent?.substring(0, 100)
    })),
    bodyText: document.body.innerText.substring(0, 2000)
  };
});

console.log('Video cards found:', data.videoCardsCount);
console.log('Video links found:', data.videoLinksCount);
console.log('Video links:', JSON.stringify(data.videoLinks, null, 2));
console.log('Body text preview:', data.bodyText.substring(0, 500));

await browser.close();
