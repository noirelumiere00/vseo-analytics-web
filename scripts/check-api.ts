import "dotenv/config";
import { getDb } from "../server/db";
import { campaignReports } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) { console.log("No DB"); process.exit(1); }

  const [r] = await db
    .select({ crossPlatformData: campaignReports.crossPlatformData, baselineDate: campaignReports.baselineDate, measurementDate: campaignReports.measurementDate })
    .from(campaignReports)
    .where(eq(campaignReports.campaignId, 4));

  const cp = r.crossPlatformData as any;
  console.log("Has crossPlatformData:", Boolean(cp));
  console.log("Keys:", cp ? Object.keys(cp) : "null");
  console.log("Has keywordSearchVolumes:", Boolean(cp?.keywordSearchVolumes));
  console.log("Count:", cp?.keywordSearchVolumes?.length ?? 0);
  console.log("baselineDate:", r.baselineDate);
  console.log("measurementDate:", r.measurementDate);

  if (cp?.keywordSearchVolumes) {
    for (const kw of cp.keywordSearchVolumes) {
      console.log(`\n  Keyword: ${kw.keyword}`);
      console.log(`  Avg Monthly: ${kw.avgMonthlySearches}`);
      console.log(`  Monthly data points: ${kw.monthlyVolumes?.length}`);
    }
  }

  process.exit(0);
}

main().catch(console.error);
