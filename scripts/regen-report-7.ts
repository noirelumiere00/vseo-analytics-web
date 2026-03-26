import "dotenv/config";
import * as db from "../server/db";
import { generateCampaignReport } from "../server/campaignReport";

async function main() {
  console.log("Fetching campaign 7...");
  const campaign = await db.getCampaignById(7);
  if (!campaign) { console.error("Campaign 7 not found"); process.exit(1); }
  console.log("Campaign:", campaign.name);
  console.log("  measurementSnapshotId:", campaign.measurementSnapshotId);
  console.log("  baselineSnapshotId:", campaign.baselineSnapshotId);

  if (!campaign.measurementSnapshotId) { console.error("No measurement snapshot"); process.exit(1); }

  const baseline = campaign.baselineSnapshotId
    ? await db.getCampaignSnapshotById(campaign.baselineSnapshotId)
    : null;
  const measurement = await db.getCampaignSnapshotById(campaign.measurementSnapshotId);
  if (!measurement) { console.error("Measurement snapshot not found"); process.exit(1); }

  console.log("Generating report...");
  const reportData = await generateCampaignReport(campaign, baseline, measurement);

  // videosフィールドが入ったか確認
  const pos = reportData.positionReport || [];
  console.log(`positionReport: ${pos.length} keywords`);
  for (const p of pos) {
    console.log(`  ${p.keyword}: rank=${p.after_rank}, videos=${p.videos?.length || 0}`);
    for (const v of p.videos || []) {
      console.log(`    rank ${v.search_rank}: @${v.username} - ${v.description.slice(0, 30)}`);
    }
  }
  const bk = reportData.bigKeywordReport || [];
  console.log(`bigKeywordReport: ${bk.length} keywords`);
  for (const b of bk as any[]) {
    console.log(`  ${b.keyword}: bestRank=${b.after.bestRank}, ownVideos=${b.ownVideos?.length || 0}`);
  }

  console.log("\nSaving report...");
  await db.upsertCampaignReport(reportData);
  await db.updateCampaign(7, { status: "report_ready" });
  console.log("Done! Report regenerated for campaign 7.");
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
