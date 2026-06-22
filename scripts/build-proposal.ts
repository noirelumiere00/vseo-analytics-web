/**
 * build-proposal.ts — 既存の順位 JSON から「クライアント提案用 16:9 デック（1ファイル）」を組み立てる。
 *
 * TikTok（`out/ranking-*.json`）と Instagram（`out/ig-ranking-*.json`）の JSON を複数渡すと、
 * 各ファイル＝1スライド（左=詳細スマホモック／右=自社のみ表）として **1つの統合デック** を出力する。
 * サムネは取得して base64 埋め込み（リンク切れ無し・自己完結）。
 *
 * 使い方:
 *   npx tsx scripts/build-proposal.ts out/ranking-*.json out/ig-ranking-*.json [--out <path>] [--no-embed-thumbs]
 *
 * 例（Mac で TikTok と IG を両方スクレイプ後）:
 *   npx tsx scripts/build-proposal.ts out/ranking-N高-*.json out/ranking-_N高-*.json out/ig-ranking-*.json
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { renderFeedHtml, type FeedVideoVM } from "./lib/feedHtml";
import { renderIgFeedHtml, type IgPostVM } from "./lib/igFeedHtml";
import { renderProposalDeck, type ProposalSlide, type ProposalItem } from "./lib/proposalHtml";
import { fetchThumbMap, applyThumbMap } from "./lib/embedThumbs";

interface Parsed {
  platform: "tiktok" | "instagram";
  title: string;
  ownRanks: number[];
  /** 全順位ぶんの cover URL（device 用） */
  covers: string[];
  /** 詳細モックを描く関数（cover→base64 適用後に呼ぶ） */
  renderDevice: (map: Map<string, string>) => string;
  /** 自社のみの表アイテム（cover→base64 適用後に確定） */
  buildItems: (map: Map<string, string>) => ProposalItem[];
}

function parseJson(file: string): Parsed | null {
  let json: any;
  try {
    json = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    console.warn(`⚠ JSON 読み込み失敗: ${file}`);
    return null;
  }

  // Instagram: { hashtag, posts:[...], ownRanks }
  if (Array.isArray(json.posts)) {
    const tag: string = json.hashtag ?? path.basename(file);
    const posts = json.posts as any[];
    const covers = posts.map((p) => p.coverUrl ?? "").filter(Boolean);
    const ownRanks: number[] = json.ownRanks ?? posts.filter((p) => p.isOwn).map((p) => p.position);
    return {
      platform: "instagram",
      title: `#${String(tag).replace(/^#/, "")}`,
      ownRanks,
      covers,
      renderDevice: (map) => {
        const vms: IgPostVM[] = posts.map((p) => ({
          rank: p.position,
          shortcode: p.shortcode ?? "",
          postUrl: p.postUrl ?? "",
          coverUrl: applyThumbMap(p.coverUrl ?? "", map),
          username: p.username ?? "",
          type: p.type ?? "image",
          likeCount: p.likeCount ?? 0,
          commentCount: p.commentCount ?? 0,
          viewCount: p.viewCount ?? 0,
          isOwn: !!p.isOwn,
        }));
        return renderIgFeedHtml({
          hashtag: String(tag).replace(/^#/, ""),
          generatedAt: new Date().toLocaleString("ja-JP"),
          posts: vms,
          ownRanks,
          variant: "embed",
        });
      },
      buildItems: (map) =>
        posts
          .filter((p) => p.isOwn)
          .map((p) => ({
            rank: p.position,
            account: p.username ?? "",
            url: p.postUrl ?? "",
            thumbUrl: applyThumbMap(p.coverUrl ?? "", map),
            isOwn: true,
          })),
    };
  }

  // TikTok: { keyword, numSessions, ranking:[...] }
  if (Array.isArray(json.ranking)) {
    const keyword: string = json.keyword ?? path.basename(file);
    const numSessions: number = json.numSessions ?? 1;
    const rk = json.ranking as any[];
    const covers = rk.map((v) => v.coverUrl ?? "").filter(Boolean);
    const ownRanks: number[] = rk.filter((v) => v.isOwn).map((v) => v.position);
    return {
      platform: "tiktok",
      title: keyword,
      ownRanks,
      covers,
      renderDevice: (map) => {
        const vms: FeedVideoVM[] = rk.map((v) => ({
          rank: v.position,
          videoId: v.videoId ?? "",
          url: v.url ?? "",
          coverUrl: applyThumbMap(v.coverUrl ?? "", map),
          authorUniqueId: v.author ?? "",
          authorNickname: v.authorNickname ?? "",
          desc: "",
          playCount: v.playCount ?? 0,
          diggCount: v.diggCount ?? 0,
          isAd: !!v.isAd,
          isOwn: !!v.isOwn,
        }));
        return renderFeedHtml({
          keyword,
          numSessions,
          generatedAt: new Date().toLocaleString("ja-JP"),
          videos: vms,
          ownRanks,
          variant: "embed",
        });
      },
      buildItems: (map) =>
        rk
          .filter((v) => v.isOwn)
          .map((v) => ({
            rank: v.position,
            account: v.author ?? "",
            url: v.url ?? "",
            thumbUrl: applyThumbMap(v.coverUrl ?? "", map),
            isOwn: true,
          })),
    };
  }

  console.warn(`⚠ 形式不明（posts も ranking も無い）: ${file}`);
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const files: string[] = [];
  let outPath: string | null = null;
  let noEmbed = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--out") outPath = args[++i] ?? null;
    else if (a === "--no-embed-thumbs") noEmbed = true;
    else if (!a.startsWith("--")) files.push(a);
  }

  if (files.length === 0) {
    console.error(
      "使い方: npx tsx scripts/build-proposal.ts out/ranking-*.json out/ig-ranking-*.json [--out <path>] [--no-embed-thumbs]",
    );
    process.exit(1);
  }

  const parsed = files.map(parseJson).filter((p): p is Parsed => p !== null);
  if (parsed.length === 0) {
    console.error("有効な JSON がありませんでした。");
    process.exit(1);
  }

  console.log(`\n=== 提案デック生成（統合） ===`);
  for (const p of parsed) {
    console.log(`  [${p.platform === "tiktok" ? "TikTok" : "IG"}] ${p.title}  （自社 ${p.ownRanks.length} 件）`);
  }

  // 全スライドの cover URL を集めて base64 化（device + 表で共用）
  let map = new Map<string, string>();
  if (!noEmbed) {
    const allCovers = parsed.flatMap((p) => p.covers);
    console.log(`\n  サムネをbase64埋め込み中…（${new Set(allCovers).size} 枚・リンク切れ対策）`);
    map = await fetchThumbMap(allCovers);
    console.log(`  サムネ埋め込み: ${map.size}/${new Set(allCovers.filter((u) => /^https?:/.test(u))).size} 成功`);
  }

  const slides: ProposalSlide[] = parsed.map((p) => ({
    platform: p.platform,
    title: p.title,
    ownRanks: p.ownRanks,
    deviceHtml: p.renderDevice(map),
    items: p.buildItems(map),
  }));

  const outDir = path.resolve(process.cwd(), "out");
  fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const deckPath = outPath ?? path.join(outDir, `proposal-combined-${ts}.html`);
  const deck = renderProposalDeck({
    deckTitle: "VSEO 表示順位 提案",
    generatedAt: new Date().toLocaleString("ja-JP"),
    slides,
  });
  fs.writeFileSync(deckPath, deck, "utf-8");
  console.log(`\n  📊 統合提案デック（1920×1080・${slides.length}スライド）: ${deckPath}\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\n[build-proposal] 失敗:", e instanceof Error ? e.message : e);
  process.exit(1);
});
