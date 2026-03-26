import { drizzle } from "drizzle-orm/mysql2";
import { desc } from "drizzle-orm";
import * as schema from "../drizzle/schema";
import "dotenv/config";

const db = drizzle(process.env.DATABASE_URL as string);

async function main() {
  const reports = await db
    .select({ id: schema.campaignReports.id, positionReport: schema.campaignReports.positionReport, bigKeywordReport: schema.campaignReports.bigKeywordReport })
    .from(schema.campaignReports)
    .orderBy(desc(schema.campaignReports.id))
    .limit(3);

  for (const r of reports) {
    console.log("=== Report ID:", r.id, "===");
    const pos = r.positionReport || [];
    console.log("positionReport count:", pos.length);
    if (pos.length > 0) {
      const first = pos[0] as any;
      console.log("  first keyword:", first.keyword);
      console.log("  after_rank:", first.after_rank);
      console.log("  has videos field?", "videos" in first);
      if (first.videos) console.log("  videos count:", first.videos.length, "sample:", JSON.stringify(first.videos[0]));
    }
    const bk = (r.bigKeywordReport || []) as any[];
    console.log("bigKeywordReport count:", bk.length);
    if (bk.length > 0) {
      console.log("  first BK keyword:", bk[0].keyword);
      console.log("  has ownVideos field?", "ownVideos" in bk[0]);
      if (bk[0].ownVideos) console.log("  ownVideos count:", bk[0].ownVideos.length, "sample:", JSON.stringify(bk[0].ownVideos[0]));
    }
  }
  process.exit(0);
}
main();
