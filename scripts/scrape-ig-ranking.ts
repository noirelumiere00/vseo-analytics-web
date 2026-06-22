/**
 * scrape-ig-ranking.ts — Instagram ハッシュタグ検索の「表示順位（ランキング）」をスタンドアロンで取得する CLI。
 *
 *   DB も LLM も Web サーバーも不要。Puppeteer で explore/tags/<hashtag> をスクレイプし、
 *   検索上位の投稿（リール/画像/カルーセル）の表示順位を取得して、
 *   ランキング表を標準出力し、out/ に HTML / CSV / JSON を書き出す。
 *
 * 使い方:
 *   INSTAGRAM_SESSION_ID=<sessionid> npx tsx scripts/scrape-ig-ranking.ts "<#ハッシュタグ>" [--max N] [--own @acc1,@acc2]
 *
 * 例:
 *   INSTAGRAM_SESSION_ID=... npx tsx scripts/scrape-ig-ranking.ts "#沖縄旅行"
 *   INSTAGRAM_SESSION_ID=... npx tsx scripts/scrape-ig-ranking.ts "沖縄旅行" --max 30 --own @myshop
 *
 * 出力: out/ig-ranking-*.html（iPhone風 Instagram UI。--own 指定で自社を赤枠表示）/ *.csv / *.json
 * Mac の自宅IPで実行すれば、日本の実際の表示順位が取れる。
 * INSTAGRAM_SESSION_ID（ログイン済みブラウザの sessionid Cookie）が必須。未設定時は Apify フォールバック。
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { searchInstagramHashtag, type InstagramHashtagPost } from "../server/instagramScraper";
import { renderIgFeedHtml, type IgPostVM } from "./lib/igFeedHtml";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let hashtag = "";
  let max = 30;
  let own: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--max") {
      max = parseInt(args[++i], 10);
    } else if (a === "--own") {
      own = (args[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (!a.startsWith("--") && !hashtag) {
      hashtag = a;
    }
  }
  return { hashtag, max, own };
}

/** @handle / プロフィールURL / handle を Instagram の username（@・小文字化は scraper 側）に正規化 */
function normalizeOwnAccount(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  // instagram.com/<username>/... のプロフィールURL → 先頭パスセグメントを username として抽出
  const m = s.match(/instagram\.com\/([^/?#]+)/i);
  if (m) {
    const seg = m[1];
    // 投稿/リール等の予約パスは username ではないので除外
    if (!/^(p|reel|reels|tv|explore|stories|accounts)$/i.test(seg)) {
      return seg.replace(/^@/, "");
    }
  }
  return s.replace(/^@/, "");
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

async function main() {
  const { hashtag, max, own } = parseArgs(process.argv);

  if (!hashtag) {
    console.error(
      '使い方: INSTAGRAM_SESSION_ID=<sessionid> npx tsx scripts/scrape-ig-ranking.ts "<#ハッシュタグ>" [--max N] [--own @acc1,@acc2]',
    );
    process.exit(1);
  }

  const tag = hashtag.replace(/^#/, "").trim();
  const ownAccounts = own.map(normalizeOwnAccount).filter(Boolean);

  console.log(`\n=== Instagram 表示順位スクレイピング ===`);
  console.log(`ハッシュタグ: #${tag}`);
  console.log(`最大取得件数: ${max}`);
  console.log(`セッション   : ${process.env.INSTAGRAM_SESSION_ID ? "INSTAGRAM_SESSION_ID あり" : "なし（Apify フォールバック）"}`);
  console.log(`自社指定     : ${ownAccounts.length === 0 ? "なし（ハイライトなし）" : ownAccounts.map((a) => "@" + a).join(", ")}\n`);

  const result = await searchInstagramHashtag(tag, max, ownAccounts);
  const posts: InstagramHashtagPost[] = result.topPosts;

  if (posts.length === 0) {
    console.warn(
      "\n⚠ 投稿が1件も取得できませんでした。" +
        "\n  - INSTAGRAM_SESSION_ID が未設定/失効していないか確認してください（ログイン済みブラウザの sessionid Cookie）。" +
        "\n  - 非日本/データセンターIPだと Instagram にブロックされることがあります。Mac の自宅IPで実行してください。\n",
    );
  }

  // === 標準出力（ランキング表） ===
  console.log(
    `\n=== 表示順位ランキング（#${tag} / ${posts.length}件 / 取得方式: ${result.method}）===\n`,
  );
  console.log("  #  種別      いいね   再生数   @ユーザー名             URL");
  console.log("  ".padEnd(100, "-"));
  posts.forEach((p) => {
    const row =
      [
        String(p.position).padStart(3),
        p.type.padEnd(8),
        fmtNum(p.likeCount).padStart(7),
        fmtNum(p.viewCount).padStart(7),
        `@${p.username}`.slice(0, 22).padEnd(22),
        p.postUrl,
      ].join("  ") + (p.isOwn ? "  🔴自社" : "");
    console.log(row);
  });

  // === ファイル出力 ===
  const outDir = path.resolve(process.cwd(), "out");
  fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTag = tag.replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 40);
  const base = path.join(outDir, `ig-ranking-${safeTag}-${ts}`);

  // JSON
  fs.writeFileSync(
    `${base}.json`,
    JSON.stringify(
      {
        hashtag: tag,
        method: result.method,
        totalFetched: result.totalFetched,
        ownRanks: result.ownRanks,
        generatedAt: new Date().toISOString(),
        posts,
      },
      null,
      2,
    ),
    "utf-8",
  );

  // CSV
  const header =
    "position,shortcode,type,likeCount,commentCount,viewCount,isOwn,username,postUrl,caption";
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
      p.caption,
    ]
      .map(csvEscape)
      .join(","),
  );
  fs.writeFileSync(`${base}.csv`, [header, ...rows].join("\n"), "utf-8");

  // HTML（iPhone風 Instagram UI・自社は赤枠ハイライト）
  const vms: IgPostVM[] = posts.map((p) => ({
    rank: p.position,
    shortcode: p.shortcode,
    postUrl: p.postUrl,
    coverUrl: p.coverUrl ?? "",
    username: p.username,
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
    ownRanks: result.ownRanks,
  });
  fs.writeFileSync(`${base}.html`, html, "utf-8");

  if (ownAccounts.length > 0) {
    console.log(
      result.ownRanks.length > 0
        ? `\n🔴 自社投稿 ${result.ownRanks.length} 件ヒット（順位: ${result.ownRanks.join(" / ")}）`
        : `\n自社投稿は今回のランキングに見つかりませんでした`,
    );
  }
  console.log(`\n出力: ${base}.html  ← ブラウザで開くと iPhone風 Instagram UIで表示${ownAccounts.length === 0 ? "" : "（自社=赤枠）"}`);
  console.log(`出力: ${base}.json`);
  console.log(`出力: ${base}.csv\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\n[scrape-ig-ranking] 失敗:", e instanceof Error ? e.message : e);
  console.error(
    "\nヒント: 投稿が取得できない場合の主因:" +
      "\n  - INSTAGRAM_SESSION_ID 未設定/失効（ログイン済みブラウザの sessionid Cookie を環境変数で渡す）" +
      "\n  - 非日本/データセンターIPからの Instagram ブロック → Mac の自宅IPで実行する（推奨）" +
      "\n  - TLS 傍受プロキシ環境では SCRAPER_IGNORE_CERT_ERRORS=true も併用",
  );
  process.exit(1);
});
