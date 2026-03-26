import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";
import * as schema from "../drizzle/schema";
import "dotenv/config";

const db = drizzle(process.env.DATABASE_URL as string);

async function main() {
  const result = await db.select().from(schema.campaignReports).where(sql`campaignId = 4`).limit(1);
  const report = result[0];
  if (report) {
    const cross = report.crossPlatformData;
    console.log("crossPlatformData type:", typeof cross);
    console.log("Is string?", typeof cross === "string");
    if (typeof cross === "object" && cross != null) {
      console.log("trendsData count:", (cross as any).trendsData?.length);
      console.log("videoTimeline count:", (cross as any).videoTimeline?.length);
    } else if (typeof cross === "string") {
      console.log("NEEDS PARSING! First 200 chars:", (cross as string).slice(0, 200));
    }

    const ripple = report.rippleReport;
    console.log("\nrippleReport type:", typeof ripple);
    if (typeof ripple === "object" && ripple != null) {
      console.log("ripple tags:", Object.keys(ripple));
      for (const [tag, data] of Object.entries(ripple)) {
        const d = data as any;
        console.log(`  ${tag}: tp_count=${d.third_party_count}, tp_videos=${(d.third_party_videos || []).length}, views=${d.after_total_views || d.other_total_views || 0}`);
      }
    }
  } else {
    console.log("No report found");
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
