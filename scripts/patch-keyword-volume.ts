/**
 * 既存キャンペーンレポートに Google Ads キーワード検索ボリュームを追加するスクリプト
 *
 * 使い方:
 *   npx tsx scripts/patch-keyword-volume.ts           # 全キャンペーン対象
 *   npx tsx scripts/patch-keyword-volume.ts 4          # キャンペーンID=4のみ
 *   npx tsx scripts/patch-keyword-volume.ts 4 7 12     # 複数キャンペーン指定
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { campaignReports, campaigns } from "../drizzle/schema";
import { eq, isNotNull } from "drizzle-orm";
import { fetchKeywordVolume } from "../server/googleAds";

async function main() {
  const db = await getDb();
  if (!db) {
    console.log("❌ DB接続できません。DATABASE_URLを確認してください。");
    process.exit(1);
  }

  // コマンドライン引数からキャンペーンIDを取得（なければ全件）
  const targetIds = process.argv.slice(2).map(Number).filter((n) => n > 0);

  // 対象キャンペーンを取得
  const allCampaigns = await db
    .select({ id: campaigns.id, name: campaigns.name, keywords: campaigns.keywords })
    .from(campaigns)
    .where(isNotNull(campaigns.keywords));

  const targetCampaigns = targetIds.length > 0
    ? allCampaigns.filter((c) => targetIds.includes(c.id))
    : allCampaigns;

  if (targetCampaigns.length === 0) {
    console.log("対象キャンペーンがありません。");
    process.exit(0);
  }

  console.log(`\n📊 ${targetCampaigns.length}件のキャンペーンを処理します\n`);

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const camp of targetCampaigns) {
    const kws = (camp.keywords as string[]) || [];
    if (kws.length === 0) {
      console.log(`⏭️  [${camp.id}] ${camp.name} — キーワードなし、スキップ`);
      skipped++;
      continue;
    }

    // レポートを取得
    const [report] = await db
      .select({ id: campaignReports.id, crossPlatformData: campaignReports.crossPlatformData })
      .from(campaignReports)
      .where(eq(campaignReports.campaignId, camp.id));

    if (!report) {
      console.log(`⏭️  [${camp.id}] ${camp.name} — レポートなし、スキップ`);
      skipped++;
      continue;
    }

    try {
      console.log(`🔍 [${camp.id}] ${camp.name} — キーワード: ${kws.join(", ")}`);
      const volumes = await fetchKeywordVolume(kws);

      if (volumes.length === 0) {
        console.log(`   → 検索ボリュームデータなし`);
        skipped++;
        continue;
      }

      const cp = (report.crossPlatformData || {}) as any;
      cp.keywordSearchVolumes = volumes;

      await db
        .update(campaignReports)
        .set({ crossPlatformData: cp })
        .where(eq(campaignReports.id, report.id));

      console.log(`   ✅ ${volumes.length}件のキーワードデータを保存`);
      success++;
    } catch (err: any) {
      console.error(`   ❌ エラー: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n完了: ✅ ${success}件成功 / ⏭️ ${skipped}件スキップ / ❌ ${failed}件失敗\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
