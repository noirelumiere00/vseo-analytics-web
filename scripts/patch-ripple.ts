/**
 * Campaign 4 のリップルデータを検索ベースで再取得し、
 * 最新measurementスナップショットとレポートを直接更新するスクリプト
 */
import "dotenv/config";
import puppeteer from "puppeteer-core";
import { searchInIncognitoContext, parseVideoData, type TikTokVideo } from "../server/tiktokScraper";
import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";

interface NormalizedVideo {
  video_id: string;
  video_url: string;
  creator_username: string;
  description: string;
  hashtags: string[];
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  search_rank: number;
  created_at: string;
}

function normalizeVideo(v: TikTokVideo, rank: number): NormalizedVideo {
  return {
    video_id: v.id,
    video_url: `https://www.tiktok.com/@${v.author.uniqueId}/video/${v.id}`,
    creator_username: v.author.uniqueId,
    description: v.desc,
    hashtags: v.hashtags || [],
    view_count: v.stats.playCount || 0,
    like_count: v.stats.diggCount || 0,
    comment_count: v.stats.commentCount || 0,
    share_count: v.stats.shareCount || 0,
    search_rank: rank,
    created_at: new Date(v.createTime * 1000).toISOString(),
  };
}

const CAMPAIGN_ID = 4;

async function main() {
  const db = drizzle(process.env.DATABASE_URL as string);

  // Get campaign info
  const campaigns = await db.execute(sql`SELECT id, name, keywords, ownAccountIds, ownVideoIds FROM campaigns WHERE id = ${CAMPAIGN_ID}`);
  const campaign = (campaigns[0] as any[])[0];
  if (!campaign) { console.error("Campaign not found"); process.exit(1); }
  console.log("Campaign:", campaign.name);

  const keywords: string[] = typeof campaign.keywords === "string" ? JSON.parse(campaign.keywords) : (campaign.keywords || []);
  const ownAccountIds: string[] = typeof campaign.ownAccountIds === "string" ? JSON.parse(campaign.ownAccountIds) : (campaign.ownAccountIds || []);
  const ownVideoIds: string[] = typeof campaign.ownVideoIds === "string" ? JSON.parse(campaign.ownVideoIds) : (campaign.ownVideoIds || []);

  // Get own video data for author filtering
  const ownVidRows = await db.execute(sql`SELECT ownVideoData FROM campaigns WHERE id = ${CAMPAIGN_ID}`);
  const ownVidData: Array<{ videoId: string; authorUniqueId: string }> = (() => {
    const raw = (ownVidRows[0] as any[])[0]?.ownVideoData;
    if (!raw) return [];
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  })();

  // Build own account set
  const allOwnAccounts = new Set(ownAccountIds.map(id => id.toLowerCase()));
  const allOwnVideoIds = new Set(ownVideoIds);
  for (const v of ownVidData) {
    if (v.authorUniqueId) allOwnAccounts.add(v.authorUniqueId.toLowerCase());
    if (v.videoId) allOwnVideoIds.add(v.videoId);
  }
  console.log("Own accounts:", [...allOwnAccounts]);

  // CPKW（施策キーワード）で検索（#付き/なしで結果が異なるため除去しない）
  const hashtags = [...new Set(keywords.map(kw => kw.trim()).filter(Boolean))];
  console.log("Keywords to search:", hashtags);

  // Launch browser
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium-browser",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
    ],
  });

  const rippleEffect: Record<string, any> = {};

  try {
    for (let i = 0; i < hashtags.length; i++) {
      const tag = hashtags[i];
      console.log(`\n[${i + 1}/${hashtags.length}] Searching: "${tag}"...`);

      try {
        const result = await searchInIncognitoContext(
          browser,
          tag,
          60,
          i,
          (msg) => console.log(`  ${msg}`),
        );

        const allNormalized = result.videos.map((v, idx) => normalizeVideo(v, idx + 1));
        console.log(`  Found ${allNormalized.length} videos`);

        // Filter out own videos
        const thirdParty = allNormalized.filter(v =>
          !allOwnAccounts.has(v.creator_username.toLowerCase()) &&
          !allOwnVideoIds.has(v.video_id)
        );
        console.log(`  Third party: ${thirdParty.length} (excluded ${allNormalized.length - thirdParty.length} own)`);

        const top60 = thirdParty
          .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
          .slice(0, 60);

        rippleEffect[tag] = {
          total_post_count: allNormalized.length,
          other_post_count: thirdParty.length,
          other_total_views: thirdParty.reduce((s, v) => s + (v.view_count || 0), 0),
          other_avg_views: thirdParty.length > 0
            ? Math.round(thirdParty.reduce((s, v) => s + (v.view_count || 0), 0) / thirdParty.length)
            : 0,
          third_party_videos: top60.map(v => ({
            video_url: v.video_url, creator: v.creator_username,
            views: v.view_count, likes: v.like_count,
            description: v.description, hashtags: v.hashtags,
            posted_at: v.created_at,
            search_rank: v.search_rank,
          })),
        };

        console.log(`  Total views: ${rippleEffect[tag].other_total_views.toLocaleString()}`);

        if (i < hashtags.length - 1) {
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
        }
      } catch (err) {
        console.error(`  Error: ${err}`);
        rippleEffect[tag] = {
          total_post_count: 0, other_post_count: 0,
          other_total_views: 0, other_avg_views: 0,
          third_party_videos: [],
        };
      }
    }
  } finally {
    await browser.close();
  }

  console.log("\n=== Results ===");
  for (const [tag, data] of Object.entries(rippleEffect)) {
    console.log(`${tag}: ${data.other_post_count} third-party, ${data.other_total_views.toLocaleString()} views`);
  }

  // Update latest measurement snapshot
  console.log("\nUpdating snapshot 12 rippleEffect...");
  await db.execute(sql`UPDATE campaign_snapshots SET rippleEffect = ${JSON.stringify(rippleEffect)} WHERE id = 12`);

  // Update campaign report rippleReport
  console.log("Updating campaign report rippleReport...");
  // Build the rippleReport format that generateCampaignReport would create
  const rippleReport: Record<string, any> = {};
  for (const [tag, after] of Object.entries(rippleEffect)) {
    rippleReport[tag] = {
      before_posts: 0,
      after_posts: after.other_post_count,
      posts_change: after.other_post_count,
      posts_change_pct: null,
      before_total_views: 0,
      after_total_views: after.other_total_views,
      third_party_videos: after.third_party_videos,
      third_party_count: after.third_party_videos.length,
    };
  }
  await db.execute(sql`UPDATE campaign_reports SET rippleReport = ${JSON.stringify(rippleReport)} WHERE campaignId = ${CAMPAIGN_ID}`);

  console.log("\nDone! Ripple data updated.");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
