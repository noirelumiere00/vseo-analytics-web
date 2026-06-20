/**
 * feedHtml.ts — 表示順位を「iPhoneモックの TikTok スマホUI」で描く自己完結HTMLを生成する純粋関数。
 *
 * - iPhoneフレーム（ダーク・角丸・Dynamic Island）の中に TikTok 検索結果風の2列グリッド。
 * - 各カード: 9:16カバー画像、左上に順位バッジ、左下に再生数（▶）、下に @handle。
 * - 自社動画は赤枠＋「自社」バッジ＋淡いglowでハイライト。
 * - サムネは <img src=coverUrl onerror=…>（Macの自宅IPで生成直後に開けば TikTok CDN が配信）。
 *   読めない場合はダーク背景＋情報のみのプレースホルダ。
 *
 * DB/サーバー非依存。`scripts/scrape-ranking.ts` から呼ばれる。
 */

export interface FeedVideoVM {
  rank: number;
  videoId: string;
  url: string;
  coverUrl: string;
  authorUniqueId: string;
  authorNickname?: string;
  desc: string;
  playCount: number;
  diggCount: number;
  isOwn: boolean;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n ?? 0);
}

/** アカウント名から決定的な色を作る（アバター代わりの円） */
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `hsl(${h} 65% 45%)`;
}

function renderCard(v: FeedVideoVM): string {
  const handle = esc(v.authorUniqueId);
  const initial = esc((v.authorUniqueId || "?").charAt(0).toUpperCase());
  const cover = esc(v.coverUrl);
  const ownClass = v.isOwn ? " own" : "";
  const ownBadge = v.isOwn ? '<span class="own-badge">自社</span>' : "";
  const img = cover
    ? `<img class="cover" src="${cover}" loading="lazy" referrerpolicy="no-referrer" alt="" onerror="this.remove()">`
    : "";
  return (
    `<a class="card${ownClass}" href="${esc(v.url)}" target="_blank" rel="noopener">` +
      `<div class="thumb">` +
        img +
        `<span class="rank">${v.rank}</span>` +
        ownBadge +
        `<span class="views"><svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>${fmtNum(v.playCount)}</span>` +
      `</div>` +
      `<div class="meta">` +
        `<p class="desc">${esc(v.desc) || "&nbsp;"}</p>` +
        `<div class="author"><span class="ava" style="background:${avatarColor(v.authorUniqueId)}">${initial}</span><span class="handle">@${handle}</span></div>` +
      `</div>` +
    `</a>`
  );
}

export function renderFeedHtml(params: {
  keyword: string;
  numSessions: number;
  generatedAt: string;
  videos: FeedVideoVM[];
  ownRanks: number[];
}): string {
  const { keyword, numSessions, generatedAt, videos, ownRanks } = params;
  const cards = videos.map(renderCard).join("\n");
  const ownLine =
    ownRanks.length > 0
      ? `自社動画 <b>${ownRanks.length}</b> 件ヒット — 順位: <b>${ownRanks.join(" / ")}</b>`
      : `自社動画は今回のランキングに見つかりませんでした`;

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TikTok 表示順位 — ${esc(keyword)}</title>
<style>
  :root { --red:#ff3b30; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 16px 48px;
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
    background: radial-gradient(1200px 600px at 50% -10%, #2a2a32, #0e0e12 60%);
    color: #e9e9ee; display: flex; flex-direction: column; align-items: center; gap: 18px;
  }
  .summary { width: min(560px, 100%); text-align: center; }
  .summary h1 { font-size: 20px; margin: 0 0 6px; letter-spacing: .02em; }
  .summary .kw { color: #fff; }
  .summary p { margin: 4px 0; font-size: 13px; color: #b7b7c2; }
  .summary .own { color: #ffd4d1; }
  .legend { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#cfcfd8; margin-top:4px; }
  .legend .sw { width:14px; height:14px; border-radius:3px; border:2px solid var(--red); display:inline-block; }

  /* iPhone frame */
  .device {
    width: 390px; max-width: 100%; background: #0b0b0d; border-radius: 54px;
    padding: 12px; box-shadow: 0 30px 80px rgba(0,0,0,.6), inset 0 0 0 2px #2c2c33;
    position: relative;
  }
  .island {
    position: absolute; top: 22px; left: 50%; transform: translateX(-50%);
    width: 116px; height: 32px; background: #000; border-radius: 18px; z-index: 5;
  }
  .screen {
    background: #121214; border-radius: 44px; overflow: hidden; height: 760px;
    display: flex; flex-direction: column;
  }
  .statusbar { height: 50px; display:flex; align-items:flex-end; justify-content:space-between;
    padding: 0 28px 6px; font-size: 13px; font-weight: 600; color:#fff; }
  .statusbar .icons { letter-spacing: 2px; }

  /* TikTok top: back + search pill */
  .ttk-top { display:flex; align-items:center; gap:10px; padding: 6px 12px 8px; }
  .ttk-top .back { color:#fff; font-size:20px; line-height:1; }
  .ttk-top .searchpill {
    flex:1; background:#2a2a2e; border-radius:18px; height:34px; display:flex; align-items:center;
    gap:8px; padding:0 12px; color:#fff; font-size:14px; overflow:hidden;
  }
  .ttk-top .searchpill svg { opacity:.7; flex:none; }
  .ttk-top .searchpill .q { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ttk-top .cancel { color:#9a9aa2; font-size:13px; }

  .tabs { display:flex; gap:18px; padding: 2px 16px 0; font-size:14px; color:#8a8a92; border-bottom:1px solid #232327; }
  .tabs .t { padding:8px 0 10px; }
  .tabs .t.active { color:#fff; font-weight:700; position:relative; }
  .tabs .t.active::after { content:""; position:absolute; left:0; right:0; bottom:-1px; height:2px; background:#fff; border-radius:2px; }

  .feed { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; padding: 10px; }
  .grid { display:grid; grid-template-columns: 1fr 1fr; gap: 8px; }

  .card { display:block; color:inherit; text-decoration:none; border-radius:10px; overflow:hidden;
    background:#1a1a1e; }
  .thumb { position:relative; aspect-ratio: 9/16; background:
      linear-gradient(160deg,#2a2a30,#161619); overflow:hidden; }
  .thumb .cover { width:100%; height:100%; object-fit:cover; display:block; }
  .thumb .rank {
    position:absolute; top:6px; left:6px; min-width:20px; height:20px; padding:0 6px;
    background:rgba(0,0,0,.7); color:#fff; font-size:12px; font-weight:700; border-radius:10px;
    display:flex; align-items:center; justify-content:center;
  }
  .thumb .views {
    position:absolute; left:6px; bottom:6px; display:flex; align-items:center; gap:3px;
    color:#fff; font-size:12px; font-weight:600; text-shadow:0 1px 2px rgba(0,0,0,.8);
  }
  .meta { padding:6px 7px 9px; }
  .meta .desc {
    margin:0 0 6px; font-size:12px; line-height:1.35; color:#e6e6ec;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; min-height:16px;
  }
  .meta .author { display:flex; align-items:center; gap:6px; }
  .meta .ava { width:18px; height:18px; border-radius:50%; color:#fff; font-size:11px; font-weight:700;
    display:flex; align-items:center; justify-content:center; flex:none; }
  .meta .handle { font-size:12px; color:#b7b7c2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  /* Own video highlight */
  .card.own { outline:3px solid var(--red); outline-offset:-3px; box-shadow:0 0 0 1px var(--red), 0 6px 18px rgba(255,59,48,.35); }
  .card.own .own-badge {
    position:absolute; top:6px; right:6px; background:var(--red); color:#fff; font-size:11px;
    font-weight:700; padding:2px 7px; border-radius:10px; letter-spacing:.04em;
  }

  .foot { width:min(560px,100%); text-align:center; color:#7d7d88; font-size:11px; line-height:1.6; }
</style>
</head>
<body>
  <div class="summary">
    <h1>TikTok 表示順位 — <span class="kw">${esc(keyword)}</span></h1>
    <p>${videos.length} 件 / ${numSessions} セッション</p>
    <p class="own">${ownLine}</p>
    <span class="legend"><span class="sw"></span> 赤枠＝自社動画</span>
  </div>

  <div class="device">
    <div class="island"></div>
    <div class="screen">
      <div class="statusbar"><span>9:41</span><span class="icons">● ● ●</span></div>
      <div class="ttk-top">
        <span class="back">‹</span>
        <div class="searchpill">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="#fff"><path d="M10 4a6 6 0 104.47 10.03l4.25 4.25 1.41-1.41-4.25-4.25A6 6 0 0010 4zm0 2a4 4 0 110 8 4 4 0 010-8z"/></svg>
          <span class="q">${esc(keyword)}</span>
        </div>
        <span class="cancel">キャンセル</span>
      </div>
      <div class="tabs">
        <span class="t">トップ</span><span class="t active">動画</span><span class="t">ユーザー</span><span class="t">ハッシュタグ</span>
      </div>
      <div class="feed">
        <div class="grid">
${cards}
        </div>
      </div>
    </div>
  </div>

  <div class="foot">
    生成: ${esc(generatedAt)}<br>
    ※ TikTok のサムネイルURLは時間が経つと失効することがあります。表示されない枠は順位・統計のみ表示されます。
  </div>
</body>
</html>`;
}
