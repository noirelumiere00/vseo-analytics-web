/**
 * igFeedHtml.ts — Instagram ハッシュタグの表示順位を「iPhoneモックの IG 探索UI」で描く自己完結HTML。
 *
 * 実機 Instagram の explore/hashtag 画面（ライトモード）を再現:
 * - iPhoneフレーム（ダークベゼル）＋ 白画面。
 * - iOSステータスバー（黒・時刻/電波/Wi‑Fi/バッテリー）。
 * - IG ヘッダ（戻る ＋ 中央に #ハッシュタグ ＋ 共有/メニュー）。
 * - 横3列・正方形タイルのグリッド（IG explore 準拠）。タイル: 左上=順位、右上=種別(リール/カルーセル)
 *   or「自社」バッジ、下部=いいね/再生数＋@username。自社=赤枠。
 * - IG 下部ナビ（ホーム / 検索[選択] / 作成＋ / リール / プロフィール、ラベルなしアイコン）。
 * - ホームインジケータ。
 *
 * すべて inline CSS / inline SVG（外部アセットなし）。DB/サーバー非依存。
 */

export interface IgPostVM {
  rank: number;
  shortcode: string;
  postUrl: string;
  coverUrl: string;
  username: string;
  type: "reel" | "image" | "video" | "carousel";
  likeCount: number;
  commentCount: number;
  viewCount: number;
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

const REEL_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="#fff" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))"><path d="M8 5v14l11-7z"/></svg>';
const CAROUSEL_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" stroke-width="2" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))"><rect x="7" y="3" width="14" height="14" rx="2.5"/><path d="M3 7v12a2 2 0 002 2h12"/></svg>';

function renderTile(p: IgPostVM): string {
  const user = esc(p.username);
  const cover = esc(p.coverUrl);
  const ownClass = p.isOwn ? " own" : "";
  const isVideo = p.type === "reel" || p.type === "video";
  const cornerRight = p.isOwn
    ? '<span class="ig-badge own-badge">自社</span>'
    : p.type === "reel"
      ? `<span class="corner">${REEL_SVG}</span>`
      : p.type === "carousel"
        ? `<span class="corner">${CAROUSEL_SVG}</span>`
        : "";
  const metric = isVideo
    ? `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>${fmtNum(p.viewCount || p.likeCount)}`
    : `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 21s-7-4.6-9.5-9C1 9 2.5 5.5 6 5.5c2 0 3.2 1.2 4 2.3.8-1.1 2-2.3 4-2.3 3.5 0 5 3.5 3.5 6.5C19 16.4 12 21 12 21z"/></svg>${fmtNum(p.likeCount)}`;
  const img = cover
    ? `<img class="cover" src="${cover}" loading="lazy" referrerpolicy="no-referrer" alt="" onerror="this.remove()">`
    : "";
  return (
    `<a class="tile${ownClass}" href="${esc(p.postUrl)}" target="_blank" rel="noopener" title="@${user}">` +
      img +
      `<span class="rank">${p.rank}</span>` +
      cornerRight +
      `<div class="bottom"><span class="metric">${metric}</span><span class="user">@${user}</span></div>` +
    `</a>`
  );
}

export function renderIgFeedHtml(params: {
  hashtag: string;
  generatedAt: string;
  posts: IgPostVM[];
  ownRanks: number[];
}): string {
  const { hashtag, generatedAt, posts, ownRanks } = params;
  const tag = hashtag.replace(/^#/, "");
  const tiles = posts.map(renderTile).join("\n");
  const ownLine =
    ownRanks.length > 0
      ? `自社投稿 <b>${ownRanks.length}</b> 件ヒット — 順位: <b>${ownRanks.join(" / ")}</b>`
      : `自社投稿は今回のランキングに見つかりませんでした`;

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Instagram 表示順位 — #${esc(tag)}</title>
<style>
  :root { --red:#ed4956; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 34px 16px 52px;
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
    background: radial-gradient(1200px 620px at 50% -8%, #2b2b34, #0c0c10 62%);
    color: #e9e9ee; display: flex; flex-direction: column; align-items: center; gap: 18px;
  }
  .summary { width: min(560px,100%); text-align:center; }
  .summary h1 { font-size:20px; margin:0 0 6px; letter-spacing:.02em; }
  .summary .kw {
    background:linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5);
    -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; font-weight:800;
  }
  .summary p { margin:4px 0; font-size:13px; color:#b7b7c2; }
  .summary .own { color:#ffd4d1; }
  .legend { display:inline-flex; align-items:center; gap:5px; font-size:12px; color:#cfcfd8; margin-top:4px; }
  .legend .sw { width:13px; height:13px; border-radius:3px; border:2px solid var(--red); display:inline-block; }

  /* iPhone frame */
  .device { position:relative; width:392px; max-width:100%;
    background:linear-gradient(#1a1a1f,#0a0a0d); border-radius:58px; padding:13px;
    box-shadow:0 36px 90px rgba(0,0,0,.62), inset 0 0 0 2px #34343c, inset 0 0 0 6px #0a0a0d; }
  .device .btn { position:absolute; background:#1c1c22; border-radius:3px; }
  .device .silent { left:-3px; top:120px; width:3px; height:28px; }
  .device .volup  { left:-3px; top:168px; width:3px; height:52px; }
  .device .voldn  { left:-3px; top:232px; width:3px; height:52px; }
  .device .power  { right:-3px; top:188px; width:3px; height:84px; }

  /* IG = ライトモード */
  .screen { position:relative; background:#fff; color:#000; border-radius:46px; overflow:hidden;
    height:812px; display:flex; flex-direction:column; }
  .island { position:absolute; top:11px; left:50%; transform:translateX(-50%);
    width:118px; height:33px; background:#000; border-radius:18px; z-index:20; }

  .statusbar { height:52px; display:flex; align-items:center; justify-content:space-between; padding:0 30px; color:#000; flex:none; }
  .statusbar .time { font-size:15px; font-weight:600; }
  .statusbar .sys { display:flex; align-items:center; gap:7px; }

  .ig-top { display:flex; align-items:center; gap:8px; padding:6px 14px 10px; flex:none; border-bottom:1px solid #efefef; }
  .ig-top .back { font-size:24px; line-height:1; color:#000; }
  .ig-top .title { flex:1; text-align:center; }
  .ig-top .title .lbl { font-size:11px; color:#737373; }
  .ig-top .title .tag { font-size:16px; font-weight:700; }
  .ig-top .more { width:24px; text-align:center; font-size:20px; color:#000; }

  .feed { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:0; background:#fff; scrollbar-width:none; }
  .feed::-webkit-scrollbar { display:none; }
  .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:2px; }
  .tile { position:relative; display:block; aspect-ratio:1/1; overflow:hidden; background:#efefef; text-decoration:none; color:inherit; }
  .tile .cover { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .tile .rank { position:absolute; top:5px; left:5px; min-width:18px; height:18px; padding:0 5px; z-index:3;
    background:rgba(0,0,0,.6); color:#fff; font-size:11px; font-weight:700; border-radius:9px;
    display:flex; align-items:center; justify-content:center; }
  .tile .corner { position:absolute; top:5px; right:5px; z-index:3; line-height:0; }
  .tile .ig-badge { position:absolute; top:5px; right:5px; z-index:3; font-size:10px; font-weight:700; padding:2px 6px; border-radius:9px; }
  .tile .own-badge { background:var(--red); color:#fff; }
  .tile .bottom { position:absolute; left:0; right:0; bottom:0; z-index:2; padding:16px 6px 5px;
    display:flex; align-items:center; justify-content:space-between; gap:5px;
    background:linear-gradient(transparent, rgba(0,0,0,.55)); }
  .tile .metric { display:flex; align-items:center; gap:3px; color:#fff; font-size:11px; font-weight:600; flex:none; }
  .tile .user { font-size:10px; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; opacity:.95; }
  .tile.own { outline:3px solid var(--red); outline-offset:-3px; box-shadow:inset 0 0 0 1px var(--red), 0 0 14px rgba(237,73,86,.5); z-index:1; }

  /* IG bottom nav（ラベルなし・黒アイコン） */
  .nav { flex:none; display:flex; align-items:center; justify-content:space-around;
    background:#fff; border-top:1px solid #dbdbdb; padding:11px 14px; }
  .nav .i { color:#000; line-height:0; }
  .nav .i.dim { color:#000; opacity:.92; }
  .nav .ava { width:25px; height:25px; border-radius:50%; border:1.5px solid #000; }

  .home-indicator { flex:none; display:flex; justify-content:center; padding:7px 0 9px; background:#fff; }
  .home-indicator i { width:134px; height:5px; border-radius:3px; background:#000; display:block; }

  .foot { width:min(560px,100%); text-align:center; color:#7d7d88; font-size:11px; line-height:1.6; }
</style>
</head>
<body>
  <div class="summary">
    <h1>Instagram 表示順位 — <span class="kw">#${esc(tag)}</span></h1>
    <p>${posts.length} 件</p>
    <p class="own">${ownLine}</p>
    <span class="legend"><span class="sw"></span> 赤枠＝自社投稿</span>
  </div>

  <div class="device">
    <span class="btn silent"></span><span class="btn volup"></span><span class="btn voldn"></span><span class="btn power"></span>
    <div class="screen">
      <div class="island"></div>

      <div class="statusbar">
        <span class="time">9:41</span>
        <span class="sys">
          <svg width="18" height="12" viewBox="0 0 18 12" fill="#000"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="6" width="3" height="6" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
          <svg width="17" height="12" viewBox="0 0 17 12" fill="#000"><path d="M8.5 2C5.6 2 3 3.1 1 4.9l1.5 1.6C4.1 5 6.2 4 8.5 4s4.4 1 6 2.5L16 4.9C14 3.1 11.4 2 8.5 2zm0 4c-1.8 0-3.4.7-4.6 1.8L5.4 9.4c.8-.8 1.9-1.3 3.1-1.3s2.3.5 3.1 1.3l1.5-1.6C11.9 6.7 10.3 6 8.5 6zm0 4c-.8 0-1.5.3-2 .9l2 2.1 2-2.1c-.5-.6-1.2-.9-2-.9z"/></svg>
          <svg width="27" height="13" viewBox="0 0 27 13"><rect x="0.5" y="0.5" width="22" height="12" rx="3.5" fill="none" stroke="#000" stroke-opacity=".45"/><rect x="2" y="2" width="17" height="9" rx="2" fill="#000"/><rect x="24" y="4" width="2" height="5" rx="1" fill="#000" fill-opacity=".45"/></svg>
        </span>
      </div>

      <div class="ig-top">
        <span class="back">‹</span>
        <div class="title"><div class="lbl">ハッシュタグ</div><div class="tag">#${esc(tag)}</div></div>
        <span class="more">⋯</span>
      </div>

      <div class="feed">
        <div class="grid">
${tiles}
        </div>
      </div>

      <div class="nav">
        <!-- home -->
        <span class="i"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg></span>
        <!-- search (active) -->
        <span class="i"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></span>
        <!-- create -->
        <span class="i"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/></svg></span>
        <!-- reels -->
        <span class="i"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M3 8h18M8.5 3l2.5 5M14 3l2.5 5"/><path d="M11 11l4 2.5-4 2.5z" fill="currentColor"/></svg></span>
        <!-- profile -->
        <span class="i"><span class="ava"></span></span>
      </div>

      <div class="home-indicator"><i></i></div>
    </div>
  </div>

  <div class="foot">
    生成: ${esc(generatedAt)}<br>
    ※ Instagram のサムネイルURLは時間が経つと失効することがあります。表示されない枠は順位・指標のみ表示されます。
  </div>
</body>
</html>`;
}
