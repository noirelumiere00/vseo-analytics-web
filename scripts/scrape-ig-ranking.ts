/**
 * scrape-ig-ranking.ts — Instagram ハッシュタグ検索の「表示順位（ランキング）」をスタンドアロンで取得する CLI。
 *
 *   DB も LLM も Web サーバーも不要。`searchInstagramHashtag`（Puppeteer + INSTAGRAM_SESSION_ID、
 *   未設定時は Apify フォールバック）で #タグ の上位投稿を取得し、ランキング表を標準出力、
 *   out/ に JSON / CSV / HTML（iPhone風 IG 探索UI）を書き出す。
 *
 *   ハッシュタグは「複数」並べて1回で実行できる（各タグごとに HTML/CSV/JSON を出力）。
 *
 * 自社ハイライト（赤枠）:
 *   - `--own @user1,@user2` … 自社IGアカウント名（username 一致。プロフィールURLも可）。
 *   - `--own-reels <file>`   … 自社投稿URL一覧ファイル（1行1URL）。各 reel/p の shortcode を抽出し、
 *                              ランキング中の同 shortcode を自社扱い（＝スプシの自社投稿をそのまま判定）。
 *   どちらも併用可。isOwn = (username 一致) または (shortcode 一致)。
 *
 * 使い方:
 *   INSTAGRAM_SESSION_ID=<sessionid> npx tsx scripts/scrape-ig-ranking.ts "<#tag1>" ["<#tag2>" ...] [--max N] [--own @a,@b] [--own-reels <file>]
 *
 * 例:
 *   INSTAGRAM_SESSION_ID=... npx tsx scripts/scrape-ig-ranking.ts "#N高" "#N高等学校" --own-reels out/ig-own-reels.txt
 *
 * 出力: out/ig-ranking-*.html（iPhone風 IG UI。自社は赤枠）/ *.csv / *.json
 * IG はデータセンター/非日本IPだとセッションがあってもブロック（ログイン/チャレンジ転送）されることがある。
 * その場合は Mac の自宅IPで実行する。
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { searchInstagramHashtag, type InstagramHashtagPost } from "../server/instagramScraper";
import { renderIgFeedHtml, type IgPostVM } from "./lib/igFeedHtml";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let tags: string[] = [];
  let max = 30;
  let own: string[] = [];
  let ownReelsFile: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--max") {
      max = parseInt(args[++i], 10);
    } else if (a === "--own") {
      own = (args[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--own-reels") {
      ownReelsFile = args[++i] ?? null;
    } else if (!a.startsWith("--")) {
      tags.push(a);
    }
  }
  // 重複除去（順序維持）
  const seen = new Set<string>();
  tags = tags.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
  return { tags, max, own, ownReelsFile };
}

/** @handle / プロフィールURL / handle を Instagram の username に正規化（小文字化は scraper 側） */
function normalizeOwnAccount(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const m = s.match(/instagram\.com\/([^/?#]+)/i);
  if (m) {
    const seg = m[1];
    if (!/^(p|reel|reels|tv|explore|stories|accounts)$/i.test(seg)) {
      return seg.replace(/^@/, "");
    }
  }
  return s.replace(/^@/, "");
}

/** instagram.com/(reel|reels|p|tv)/<shortcode> から shortcode を取り出す */
function extractShortcode(url: string): string | null {
  const m = url.match(/instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/** --own-reels ファイル（1行1URL）から自社 shortcode 集合を作る */
function loadOwnShortcodes(file: string | null): Set<string> {
  const set = new Set<string>();
  if (!file) return set;
  if (!fs.existsSync(file)) {
    console.warn(`⚠ --own-reels のファイルが見つかりません: ${file}`);
    return set;
  }
  for (const line of fs.readFileSync(file, "utf-8").split(/\r?\n/)) {
    const sc = extractShortcode(line.trim());
    if (sc) set.add(sc);
  }
  return set;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n ?? 0);
}

function csvEscape(v: string | number | boolean): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface OwnHit {
  rank: number;
  username: string;
  shortcode: string;
  url: string;
}

interface RunResult {
  tag: string;
  method: string;
  total: number;
  ownHits: OwnHit[];
  htmlPath: string;
  csvPath: string;
  jsonPath: string;
}

async function runOne(
  rawTag: string,
  opts: { max: number; ownUsernames: string[]; ownShortcodes: Set<string>; outDir: string },
): Promise<RunResult> {
  const tag = rawTag.replace(/^#/, "").trim();
  console.log(`\n──────────────────────────────────────────`);
  console.log(`▶ ハッシュタグ: #${tag}`);
  console.log(`──────────────────────────────────────────`);

  const result = await searchInstagramHashtag(tag, opts.max, opts.ownUsernames);

  // username 一致（scraper 内蔵）に加え、shortcode 一致でも自社判定
  const posts = result.topPosts.map((p: InstagramHashtagPost) => ({
    ...p,
    isOwn: p.isOwn || opts.ownShortcodes.has(p.shortcode),
  }));
  const ownRanks = posts.filter((p) => p.isOwn).map((p) => p.position);

  if (posts.length === 0) {
    console.warn(
      `\n⚠ [#${tag}] 投稿が1件も取得できませんでした。` +
        "\n  INSTAGRAM_SESSION_ID の未設定/失効、または 非日本/データセンターIP のブロック（ログイン/チャレンジ転送）が原因のことがあります。" +
        "\n  Mac の自宅IPで、有効な sessionid を渡して実行してください。\n",
    );
  }

  // === 標準出力（ランキング表） ===
  console.log(`\n=== IG 表示順位「#${tag}」（method: ${result.method} / ${posts.length}件）===\n`);
  console.log("  #  種別      いいね   再生数   @ユーザー名             URL");
  console.log("  ".padEnd(100, "-"));
  for (const p of posts) {
    const row =
      [
        String(p.position).padStart(3),
        p.type.padEnd(8),
        fmtNum(p.likeCount).padStart(7),
        fmtNum(p.viewCount).padStart(7),
        `@${p.username || "?"}`.slice(0, 22).padEnd(22),
        p.postUrl,
      ].join("  ") + (p.isOwn ? "  🔴自社" : "");
    console.log(row);
  }

  // === ファイル出力 ===
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTag = tag.replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 40);
  const base = path.join(opts.outDir, `ig-ranking-${safeTag}-${ts}`);

  fs.writeFileSync(
    `${base}.json`,
    JSON.stringify(
      {
        hashtag: tag,
        method: result.method,
        total: posts.length,
        generatedAt: new Date().toISOString(),
        ownRanks,
        posts,
      },
      null,
      2,
    ),
    "utf-8",
  );

  const header = "position,shortcode,type,likeCount,commentCount,viewCount,isOwn,username,postUrl,caption";
  const rows = posts.map((p) =>
    [
      p.position,
      p.shortcode,
      p.type,
      p.likeCount,
      p.commentCount,
      p.viewCount,
      p.isOwn,
      p.username,
      p.postUrl,
      (p.caption ?? "").replace(/\s+/g, " ").slice(0, 200),
    ]
      .map(csvEscape)
      .join(","),
  );
  fs.writeFileSync(`${base}.csv`, [header, ...rows].join("\n"), "utf-8");

  // === HTML（iPhone風 IG UI・自社は赤枠） ===
  const vms: IgPostVM[] = posts.map((p) => ({
    rank: p.position,
    shortcode: p.shortcode,
    postUrl: p.postUrl,
    coverUrl: p.coverUrl ?? "",
    username: p.username ?? "",
    type: p.type,
    likeCount: p.likeCount ?? 0,
    commentCount: p.commentCount ?? 0,
    viewCount: p.viewCount ?? 0,
    isOwn: p.isOwn,
  }));
  const html = renderIgFeedHtml({
    hashtag: tag,
    generatedAt: new Date().toLocaleString("ja-JP"),
    posts: vms,
    ownRanks,
  });
  fs.writeFileSync(`${base}.html`, html, "utf-8");

  const ownHits: OwnHit[] = posts
    .filter((p) => p.isOwn)
    .map((p) => ({ rank: p.position, username: p.username, shortcode: p.shortcode, url: p.postUrl }));

  const ownSpecified = opts.ownUsernames.length > 0 || opts.ownShortcodes.size > 0;
  if (ownSpecified) {
    if (ownHits.length > 0) {
      console.log(`\n🔴 [#${tag}] 自社投稿 ${ownHits.length} 件ヒット`);
      for (const h of ownHits) {
        console.log(`   ${String(h.rank).padStart(3)}位  @${h.username || "?"}  ${h.url}`);
      }
    } else {
      console.log(`\n[#${tag}] 自社投稿は今回のランキングに見つかりませんでした`);
    }
  }
  console.log(`\n出力: ${base}.html  ← ブラウザで開くと iPhone風 IG UIで表示${ownSpecified ? "（自社=赤枠）" : ""}`);
  console.log(`出力: ${base}.json`);
  console.log(`出力: ${base}.csv`);

  return {
    tag,
    method: result.method,
    total: posts.length,
    ownHits,
    htmlPath: `${base}.html`,
    csvPath: `${base}.csv`,
    jsonPath: `${base}.json`,
  };
}

async function main() {
  const { tags, max, own, ownReelsFile } = parseArgs(process.argv);

  if (tags.length === 0) {
    console.error(
      '使い方: INSTAGRAM_SESSION_ID=<sessionid> npx tsx scripts/scrape-ig-ranking.ts "<#tag1>" ["<#tag2>" ...] [--max N] [--own @a,@b] [--own-reels <file>]',
    );
    process.exit(1);
  }

  const ownUsernames = own.map(normalizeOwnAccount).filter(Boolean);
  const ownShortcodes = loadOwnShortcodes(ownReelsFile);

  console.log(`\n=== Instagram 表示順位スクレイピング ===`);
  console.log(`ハッシュタグ: ${tags.map((t) => `#${t.replace(/^#/, "")}`).join("  /  ")}（${tags.length}件）`);
  console.log(`取得上限    : ${max} 件/タグ`);
  console.log(`セッション  : ${process.env.INSTAGRAM_SESSION_ID ? "設定あり（env）" : "未設定（Apifyフォールバック）"}`);
  console.log(`自社指定    : username ${ownUsernames.length}個 / shortcode ${ownShortcodes.size}個`);

  const outDir = path.resolve(process.cwd(), "out");
  fs.mkdirSync(outDir, { recursive: true });

  const results: RunResult[] = [];
  const failed: string[] = [];

  for (const tag of tags) {
    try {
      results.push(await runOne(tag, { max, ownUsernames, ownShortcodes, outDir }));
    } catch (e) {
      console.error(`\n[#${tag.replace(/^#/, "")}] 取得失敗:`, e instanceof Error ? e.message : e);
      failed.push(tag.replace(/^#/, ""));
    }
  }

  // === 全タグ横断サマリー ===
  console.log(`\n\n══════════════════════════════════════════`);
  console.log(`  全ハッシュタグ サマリー（${results.length}/${tags.length} 成功）`);
  console.log(`══════════════════════════════════════════`);
  if (results.length > 0) {
    console.log(`\n  タグ                 件数   自社ヒット  自社順位`);
    console.log("  " + "".padEnd(60, "-"));
    for (const r of results) {
      const ranksStr = r.ownHits.length > 0 ? r.ownHits.map((h) => `${h.rank}位`).join(" / ") : "—";
      console.log(
        "  " +
          `#${r.tag}`.slice(0, 18).padEnd(20) +
          String(r.total).padStart(4) +
          "   " +
          String(r.ownHits.length).padStart(4) + " 件" +
          "   " +
          ranksStr,
      );
    }
  }
  if (failed.length > 0) {
    console.log(`\n  ⚠ 取得失敗（0件/ブロックの可能性）: ${failed.map((t) => `#${t}`).join(" / ")}`);
    console.log(`    → Mac の自宅IPで、有効な INSTAGRAM_SESSION_ID を渡して実行してください。`);
  }

  console.log(`\n  出力ファイル（ブラウザで .html を開く）:`);
  for (const r of results) {
    console.log(`    [#${r.tag}]  ${r.htmlPath}`);
  }
  console.log("");

  process.exit(0);
}

main().catch((e) => {
  console.error("\n[scrape-ig-ranking] 失敗:", e instanceof Error ? e.message : e);
  console.error(
    "\nヒント: IG 投稿が取得できない場合:" +
      "\n  - INSTAGRAM_SESSION_ID（ログイン済みブラウザの sessionid Cookie）を env で渡す" +
      "\n  - 非日本/データセンターIPだとブロックされやすい → Mac の自宅IPで実行する" +
      "\n  - それでもダメなら APIFY_API_TOKEN を設定して Apify フォールバックを使う",
  );
  process.exit(1);
});
