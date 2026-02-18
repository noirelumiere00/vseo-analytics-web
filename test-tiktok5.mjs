import puppeteer from 'puppeteer-core';
import fs from 'fs';

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium-browser',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1920,1080']
});

const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP,ja;q=0.9' });

// Step 1: Visit TikTok to get cookies
console.log('Getting cookies...');
await page.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 5000));

// Step 2: Call internal API
console.log('Calling search API...');
const result = await page.evaluate(async () => {
  const keyword = encodeURIComponent('ジャングリア沖縄');
  const url = `https://www.tiktok.com/api/search/general/full/?keyword=${keyword}&offset=0&search_source=normal_search&WebIdLastTime=${Math.floor(Date.now()/1000)}&aid=1988&app_language=ja-JP&app_name=tiktok_web&browser_language=ja-JP&browser_name=Mozilla&browser_online=true&browser_platform=Win32&browser_version=121.0.0.0&channel=tiktok_web&cookie_enabled=true&device_platform=web_pc&focus_state=true&from_page=search&history_len=3&is_fullscreen=false&is_page_visible=true&os=windows&priority_region=JP&region=JP&screen_height=1080&screen_width=1920&webcast_language=ja-JP`;
  
  try {
    const response = await fetch(url, { credentials: 'include' });
    const json = await response.json();
    return { status: response.status, data: json };
  } catch (e) {
    return { error: e.message };
  }
});

if (result.error) {
  console.log('Error:', result.error);
} else {
  console.log('Status:', result.status);
  console.log('Status code:', result.data.status_code);
  
  // Save full response for analysis
  fs.writeFileSync('/home/ubuntu/vseo-analytics-web/tiktok-api-response.json', JSON.stringify(result.data, null, 2));
  console.log('Full response saved to tiktok-api-response.json');
  
  if (result.data.data) {
    console.log('\nTotal items:', result.data.data.length);
    
    result.data.data.forEach((item, i) => {
      if (item.type === 1 && item.item) {
        const v = item.item;
        const stats = v.stats || {};
        const author = v.author || {};
        console.log(`\n--- Video ${i+1} ---`);
        console.log(`ID: ${v.id}`);
        console.log(`Desc: ${(v.desc || '').substring(0, 100)}`);
        console.log(`Duration: ${v.video?.duration}s`);
        console.log(`Author: ${author.uniqueId} (${author.nickname})`);
        console.log(`Followers: ${author.followerCount || 'N/A'}`);
        console.log(`Views: ${stats.playCount}`);
        console.log(`Likes: ${stats.diggCount}`);
        console.log(`Comments: ${stats.commentCount}`);
        console.log(`Shares: ${stats.shareCount}`);
        console.log(`Saves: ${stats.collectCount}`);
        console.log(`Cover: ${v.video?.cover?.substring(0, 80)}`);
        console.log(`Play URL: ${v.video?.playAddr?.substring(0, 80)}`);
      }
    });
  }
}

await browser.close();
