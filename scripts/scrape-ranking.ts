/**
 * scrape-ranking.ts — TikTok キーワード検索の「表示順位（ランキング）」をスタンドアロンで取得する CLI。
 *
 *   DB も LLM も Web サーバーも不要。Puppeteer で 3シークレット検索を回し、
 *   各動画の表示順位（avgRank / dominanceScore / 出現回数）を算出して
 *   ランキング表を標準出力し、out/ に JSON / CSV を書き出す。
 *
 * 使い方:
 *   npx tsx scripts/scrape-ranking.ts "<キーワード>" [--sessions N] [--per-session M] [--own @acc1,@acc2]
 *
 * 例:
 *   npx tsx scripts/scrape-ranking.ts "ハリアー"
 *   npx tsx scripts/scrape-ranking.ts "#ジャングリア沖縄" --sessions 3 --per-session 30
 *   npx tsx scripts/scrape-ranking.ts "ハリアー" --own @harrier808   # 自社動画を赤枠ハイライト
 *
 * 出力: out/ranking-*.csv / *.json / *.html（HTML は iPhone風 TikTok UI。--own 指定で自社を赤枠表示）
 * Mac の自宅IPで実行すれば、日本の実際の表示順位が取れる。
 * PROXY_SERVER / PROXY_USERNAME / PROXY_PASSWORD を設定すればプロキシ経由でも動く。
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { SCRAPER_SESSION_COUNT, SCRAPER_VIDEOS_PER_SESSION } from "../shared/const";
import { searchTikTokTriple, type TikTokVideo } from "../server/tiktokScraper";
import { computeRankInfo } from "../server/ranking";
import { buildOwnMatcher } from "./lib/ownMatch";
import { renderFeedHtml, type FeedVideoVM } from "./lib/feedHtml";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let keyword = "";
  let sessions = SCRAPER_SESSION_COUNT;
  let perSession = SCRAPER_VIDEOS_PER_SESSION;
  let own: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--sessions") {
      sessions = parseInt(args[++i], 10);
    } else if (a === "--per-session") {
      perSession = parseInt(args[++i], 10);
    } else if (a === "--own") {
      own = (args[++i] ?? "").split(",").map(s => s.trim()).filter(Boolean);
    } else if (!a.startsWith("--") && !keyword) {
      keyword = a;
    }
  }
  return { keyword, sessions, perSession, own };
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function csvEscape(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function videoUrl(v: TikTokVideo): string {
  return `https://www.tiktok.com/@${v.author?.uniqueId ?? ""}/video/${v.id}`;
}

async function main() {
  const { keyword, sessions, perSession, own } = parseArgs(process.argv);

  if (!keyword) {
    console.error('使い方: npx tsx scripts/scrape-ranking.ts "<キーワード>" [--sessions N] [--per-session M] [--own @acc1,@acc2]');
    process.exit(1);
  }

  const ownMatcher = buildOwnMatcher(own);

  console.log(`\n=== TikTok 表示順位スクレイピング ===`);
  console.log(`キーワード : ${keyword}`);
  console.log(`セッション数: ${sessions} / 1セッションあたり取得: ${perSession}`);
  console.log(`プロキシ    : ${process.env.PROXY_SERVER ? process.env.PROXY_SERVER : "なし（直結）"}`);
  console.log(`自社指定    : ${ownMatcher.isEmpty ? "なし（ハイライトなし）" : own.join(", ")}\n`);

  const result = await searchTikTokTriple(
    keyword,
    perSession,
    sessions,
    (msg: string, pct: number) => console.log(`[${String(pct).padStart(3)}%] ${msg}`),
  );

  const numSessions = result.duplicateAnalysis.numSessions;
  const allVideos = result.duplicateAnalysis.allUniqueVideos;
  const videoById = new Map<string, TikTokVideo>(allVideos.map(v => [v.id, v]));

  const searchData = result.searches.map(s => ({
    sessionIndex: s.sessionIndex,
    videoIds: s.videos.map(v => v.id),
  }));
  const allVideoIds = allVideos.map(v => v.id);
  const rankInfo = computeRankInfo(searchData, allVideoIds, numSessions);

  if (allVideoIds.length === 0) {
    console.warn(
      "\n⚠ 動画が1件も取得できませんでした。" +
      "\n  非日本/データセンターIPだと TikTok にブロック（CAPTCHA/空応答）されることがあります。" +
      "\n  Mac の自宅IPで実行するか、PROXY_SERVER（日本の住宅用プロキシ）を設定してください。\n",
    );
  }

  // dominanceScore 降順（同点は avgRank 昇順 → 再生数降順）でランキング
  const ranked = [...allVideoIds].sort((a, b) => {
    const ra = rankInfo[a], rb = rankInfo[b];
    if (rb.dominanceScore !== ra.dominanceScore) return rb.dominanceScore - ra.dominanceScore;
    if (ra.avgRank !== rb.avgRank) return ra.avgRank - rb.avgRank;
    return (videoById.get(b)?.stats.playCount ?? 0) - (videoById.get(a)?.stats.playCount ?? 0);
  });

  // === 標準出力（ランキング表） ===
  console.log(`\n=== 表示順位ランキング（${numSessions}セッション / 重複率 ${result.duplicateAnalysis.overlapRate.toFixed(1)}%）===\n`);
  console.log("  #  Dom    出現  順位        再生数   いいね   作者                URL");
  console.log("  ".padEnd(100, "-"));
  ranked.forEach((id, i) => {
    const v = videoById.get(id);
    const r = rankInfo[id];
    if (!v) return;
    const ranksStr = r.ranks.map(x => (x === null ? "-" : x)).join("/");
    const row = [
      String(i + 1).padStart(3),
      r.dominanceScore.toFixed(1).padStart(5),
      `${r.appearanceCount}/${numSessions}`.padStart(5),
      ranksStr.padEnd(10),
      fmtNum(v.stats.playCount).padStart(7),
      fmtNum(v.stats.diggCount).padStart(7),
      `@${v.author?.uniqueId ?? ""}`.slice(0, 18).padEnd(18),
      videoUrl(v),
    ].join("  ") + (ownMatcher.isOwn(v) ? "  🔴自社" : "");
    console.log(row);
  });

  // === ファイル出力 ===
  const outDir = path.resolve(process.cwd(), "out");
  fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const safeKeyword = keyword.replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 40);
  const base = path.join(outDir, `ranking-${safeKeyword}-${ts}`);

  const rankedDetailed = ranked.map((id, i) => {
    const v = videoById.get(id)!;
    const r = rankInfo[id];
    return {
      position: i + 1,
      videoId: id,
      dominanceScore: r.dominanceScore,
      avgRank: r.avgRank,
      appearanceCount: r.appearanceCount,
      ranksPerSession: r.ranks,
      url: videoUrl(v),
      author: v.author?.uniqueId ?? "",
      desc: v.desc,
      isAd: v.isAd,
      playCount: v.stats.playCount,
      diggCount: v.stats.diggCount,
      commentCount: v.stats.commentCount,
      shareCount: v.stats.shareCount,
      collectCount: v.stats.collectCount,
      hashtags: v.hashtags,
      isOwn: ownMatcher.isOwn(v),
    };
  });

  fs.writeFileSync(
    `${base}.json`,
    JSON.stringify(
      {
        keyword,
        numSessions,
        perSession,
        overlapRate: result.duplicateAnalysis.overlapRate,
        proxy: process.env.PROXY_SERVER ? "enabled" : "direct",
        generatedAt: new Date().toISOString(),
        ranking: rankedDetailed,
      },
      null,
      2,
    ),
    "utf-8",
  );

  const header = "position,videoId,dominanceScore,avgRank,appearanceCount,ranksPerSession,playCount,diggCount,commentCount,shareCount,isAd,isOwn,author,url,desc";
  const rows = rankedDetailed.map(r =>
    [
      r.position,
      r.videoId,
      r.dominanceScore.toFixed(2),
      r.avgRank.toFixed(2),
      r.appearanceCount,
      r.ranksPerSession.map(x => (x === null ? "-" : x)).join("/"),
      r.playCount,
      r.diggCount,
      r.commentCount,
      r.shareCount,
      r.isAd,
      r.isOwn,
      r.author,
      r.url,
      r.desc,
    ].map(csvEscape).join(","),
  );
  fs.writeFileSync(`${base}.csv`, [header, ...rows].join("\n"), "utf-8");

  // === HTML（iPhone風 TikTok UI・自社は赤枠ハイライト） ===
  const feedVideos: FeedVideoVM[] = ranked.map((id, i) => {
    const v = videoById.get(id)!;
    return {
      rank: i + 1,
      videoId: id,
      url: videoUrl(v),
      coverUrl: v.coverUrl ?? "",
      authorUniqueId: v.author?.uniqueId ?? "",
      authorNickname: v.author?.nickname,
      desc: v.desc ?? "",
      playCount: v.stats?.playCount ?? 0,
      diggCount: v.stats?.diggCount ?? 0,
      isOwn: ownMatcher.isOwn(v),
    };
  });
  const ownRanks = feedVideos.filter(f => f.isOwn).map(f => f.rank);
  const html = renderFeedHtml({
    keyword,
    numSessions,
    generatedAt: new Date().toLocaleString("ja-JP"),
    videos: feedVideos,
    ownRanks,
  });
  fs.writeFileSync(`${base}.html`, html, "utf-8");

  if (!ownMatcher.isEmpty) {
    console.log(
      ownRanks.length > 0
        ? `\n🔴 自社動画 ${ownRanks.length} 件ヒット（順位: ${ownRanks.join(" / ")}）`
        : `\n自社動画は今回のランキングに見つかりませんでした`,
    );
  }
  console.log(`\n出力: ${base}.html  ← ブラウザで開くと iPhone風UIで表示${ownMatcher.isEmpty ? "" : "（自社=赤枠）"}`);
  console.log(`出力: ${base}.json`);
  console.log(`出力: ${base}.csv\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\n[scrape-ranking] 失敗:", e instanceof Error ? e.message : e);
  console.error(
    "\nヒント: 動画が取得できない場合、非日本/データセンターIPからの TikTok ブロックが原因のことが多いです。" +
    "\n  - Mac の自宅IPで実行する（推奨）" +
    "\n  - もしくは PROXY_SERVER（日本の住宅用プロキシ）を設定する" +
    "\n  - TLS 傍受プロキシ環境（社内/一部クラウド）では SCRAPER_IGNORE_CERT_ERRORS=true も併用",
  );
  process.exit(1);
});
