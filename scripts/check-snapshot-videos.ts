import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";
import * as schema from "../drizzle/schema";
import "dotenv/config";

const db = drizzle(process.env.DATABASE_URL as string);

async function main() {
  // キャンペーン7の情報取得
  const [campaign] = await db.select().from(schema.campaigns).where(sql`id = 7`).limit(1);
  if (!campaign) { console.log("Campaign 7 not found"); process.exit(1); }
  console.log("Campaign:", campaign.name);
  console.log("Keywords:", campaign.keywords);
  console.log("BigKeywords:", (campaign as any).bigKeywords);
  console.log("MeasurementSnapshotId:", campaign.measurementSnapshotId);

  if (!campaign.measurementSnapshotId) { console.log("No measurement snapshot"); process.exit(0); }

  // スナップショット取得
  const [snap] = await db.select().from(schema.campaignSnapshots).where(sql`id = ${campaign.measurementSnapshotId}`).limit(1);
  if (!snap) { console.log("Snapshot not found"); process.exit(1); }

  // 施策KWの検索結果を確認
  const sr = snap.searchResults as any;
  if (sr) {
    console.log("\n=== searchResults (施策KW) ===");
    for (const [kw, data] of Object.entries(sr) as any[]) {
      const ownVideos = data.own_videos || [];
      console.log(`\nKW: "${kw}"`);
      console.log(`  own_videos count: ${ownVideos.length}`);
      for (const v of ownVideos) {
        console.log(`    rank ${v.search_rank}: @${v.creator_username} - ${(v.description || "").slice(0, 30)} (views: ${v.view_count})`);
      }
    }
  }

  // ビッグKWの検索結果を確認
  const bk = (snap as any).bigKeywordResults as any;
  if (bk) {
    console.log("\n=== bigKeywordResults (ビッグKW) ===");
    for (const [kw, data] of Object.entries(bk) as any[]) {
      const ownVideos = data.ownVideosInTop30 || [];
      console.log(`\nKW: "${kw}"`);
      console.log(`  ownVideosInTop30 count: ${ownVideos.length}`);
      for (const v of ownVideos) {
        console.log(`    rank ${v.rank}: videoId=${v.videoId} (views: ${v.viewCount})`);
      }
    }
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
