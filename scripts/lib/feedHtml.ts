/**
 * feedHtml.ts — 表示順位を「iPhoneモックの TikTok スマホUI」で描く自己完結HTMLを生成する純粋関数。
 *
 * 実機リサーチを踏まえ、iPhone / TikTok 検索画面のUIを作り込み:
 * - iPhoneフレーム（角丸・Dynamic Island・側面ボタン・内側ベゼル・影）。
 * - iOSステータスバー（時刻 / 電波 / Wi‑Fi / バッテリーを inline SVG）。
 * - TikTok 検索ヘッダ（戻る＋検索フィールド[虫眼鏡＋クエリ＋✕]＋赤キャンセル）。
 * - 横スクロール風タブ（「トップ」選択 / ユーザー / 動画 / サウンド / LIVE / ハッシュタグ）。
 * - 横3列・端まで敷き詰めのカバーグリッド（左上=順位 / 左下=再生数▶ / 下=@handle）。
 *   自社=赤枠＋「自社」バッジ＋glow、広告=「広告」バッジ。
 * - TikTok 下部ナビ（ホーム / フレンド / ＋作成[赤×シアン] / 受信トレイ / プロフィール）。
 * - ホームインジケータ。
 *
 * すべて inline CSS / inline SVG（外部アセットなし・自己完結）。DB/サーバー非依存。
 * サムネは <img src=coverUrl onerror=…>（Macの自宅IPで生成直後に開けば TikTok CDN が配信）。
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
  isAd?: boolean;
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

function renderCard(v: FeedVideoVM): string {
  const handle = esc(v.authorUniqueId);
  const cover = esc(v.coverUrl);
  const ownClass = v.isOwn ? " own" : "";
  const badge = v.isOwn
    ? '<span class="badge own-badge">自社</span>'
    : v.isAd
      ? '<span class="badge ad-badge">広告</span>'
      : "";
  const img = cover
    ? `<img class="cover" src="${cover}" loading="lazy" referrerpolicy="no-referrer" alt="" onerror="this.remove()">`
    : "";
  return (
    `<a class="card${ownClass}" href="${esc(v.url)}" target="_blank" rel="noopener" title="@${handle}">` +
      img +
      `<span class="rank">${v.rank}</span>` +
      badge +
      `<div class="bottom">` +
        `<span class="views"><svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>${fmtNum(v.playCount)}</span>` +
        `<span class="handle">@${handle}</span>` +
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
  :root { --red:#fe2c55; --cyan:#25f4ee; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 34px 16px 52px;
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
    background: radial-gradient(1200px 620px at 50% -8%, #2b2b34, #0c0c10 62%);
    color: #e9e9ee; display: flex; flex-direction: column; align-items: center; gap: 18px;
  }
  .summary { width: min(560px, 100%); text-align: center; }
  .summary h1 { font-size: 20px; margin: 0 0 6px; letter-spacing: .02em; }
  .summary .kw { color: #fff; }
  .summary p { margin: 4px 0; font-size: 13px; color: #b7b7c2; }
  .summary .own { color: #ffd4d1; }
  .legend { display:inline-flex; align-items:center; gap:14px; font-size:12px; color:#cfcfd8; margin-top:4px; }
  .legend span { display:inline-flex; align-items:center; gap:5px; }
  .legend .sw { width:13px; height:13px; border-radius:3px; display:inline-block; }
  .legend .sw.red { border:2px solid var(--red); }
  .legend .sw.ad { background:#3a3a42; }

  /* ===== iPhone frame ===== */
  .device {
    position: relative; width: 392px; max-width: 100%;
    background: linear-gradient(#1a1a1f, #0a0a0d); border-radius: 58px;
    padding: 13px; box-shadow: 0 36px 90px rgba(0,0,0,.62), inset 0 0 0 2px #34343c, inset 0 0 0 6px #0a0a0d;
  }
  /* 側面ボタン */
  .device .btn { position:absolute; background:#1c1c22; border-radius:3px; }
  .device .silent { left:-3px; top:120px; width:3px; height:28px; }
  .device .volup  { left:-3px; top:168px; width:3px; height:52px; }
  .device .voldn  { left:-3px; top:232px; width:3px; height:52px; }
  .device .power  { right:-3px; top:188px; width:3px; height:84px; }

  .screen { position: relative; background: #000; border-radius: 46px; overflow: hidden;
    height: 812px; display: flex; flex-direction: column; }
  .island { position: absolute; top: 11px; left: 50%; transform: translateX(-50%);
    width: 118px; height: 33px; background: #000; border-radius: 18px; z-index: 20; }

  /* ===== iOS status bar ===== */
  .statusbar { height: 52px; display:flex; align-items:center; justify-content:space-between;
    padding: 0 30px; color:#fff; flex:none; }
  .statusbar .time { font-size:15px; font-weight:600; letter-spacing:.2px; }
  .statusbar .sys { display:flex; align-items:center; gap:7px; }

  /* ===== TikTok search header ===== */
  .ttk-top { display:flex; align-items:center; gap:10px; padding: 4px 12px 8px; flex:none; }
  .ttk-top .back { color:#fff; font-size:24px; line-height:1; margin-right:2px; }
  .ttk-top .searchpill {
    flex:1; background:#1f1f24; border-radius:9px; height:36px; display:flex; align-items:center;
    gap:8px; padding:0 10px; color:#fff; font-size:14px; overflow:hidden;
  }
  .ttk-top .searchpill .q { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ttk-top .searchpill .clear { width:16px; height:16px; border-radius:50%; background:#55555c; color:#1f1f24;
    font-size:11px; display:flex; align-items:center; justify-content:center; flex:none; }
  .ttk-top .cancel { color:#fff; font-size:14px; }

  /* ===== tabs (横スクロール風) ===== */
  .tabs { display:flex; gap:22px; padding: 2px 14px 0; font-size:14px; color:#8a8a92;
    border-bottom:1px solid #1b1b1f; overflow-x:auto; white-space:nowrap; flex:none; scrollbar-width:none; }
  .tabs::-webkit-scrollbar { display:none; }
  .tabs .t { padding:9px 0 11px; flex:none; }
  .tabs .t.active { color:#fff; font-weight:700; position:relative; }
  .tabs .t.active::after { content:""; position:absolute; left:0; right:0; bottom:-1px; height:2px; background:#fff; border-radius:2px; }

  /* ===== feed grid (横3列・端まで) ===== */
  .feed { flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:0; background:#000; scrollbar-width:none; }
  .feed::-webkit-scrollbar { display:none; }
  .grid { display:grid; grid-template-columns: repeat(3, 1fr); gap: 1.5px; }
  .card { position:relative; display:block; aspect-ratio: 9/16; overflow:hidden;
    background: linear-gradient(160deg,#26262c,#131316); color:inherit; text-decoration:none; }
  .card .cover { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .card .rank { position:absolute; top:5px; left:5px; min-width:18px; height:18px; padding:0 5px; z-index:3;
    background:rgba(0,0,0,.55); color:#fff; font-size:11px; font-weight:700; border-radius:9px;
    display:flex; align-items:center; justify-content:center; }
  .card .badge { position:absolute; top:5px; right:5px; z-index:3; font-size:10px; font-weight:700;
    padding:2px 6px; border-radius:9px; letter-spacing:.04em; }
  .card .own-badge { background:var(--red); color:#fff; }
  .card .ad-badge { background:rgba(0,0,0,.6); color:#dcdce2; font-weight:600; }
  .card .bottom { position:absolute; left:0; right:0; bottom:0; z-index:2; padding:18px 6px 5px;
    display:flex; align-items:center; justify-content:space-between; gap:5px;
    background:linear-gradient(transparent, rgba(0,0,0,.78)); }
  .card .views { display:flex; align-items:center; gap:2px; color:#fff; font-size:12px; font-weight:600;
    flex:none; text-shadow:0 1px 2px rgba(0,0,0,.7); }
  .card .handle { font-size:10px; color:#eaeaf0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    text-shadow:0 1px 2px rgba(0,0,0,.7); }
  .card.own { outline:3px solid var(--red); outline-offset:-3px;
    box-shadow:inset 0 0 0 1px var(--red), 0 0 14px rgba(254,44,85,.55); z-index:1; }

  /* ===== TikTok bottom nav ===== */
  .nav { flex:none; display:flex; align-items:center; justify-content:space-around;
    background:#0a0a0a; border-top:1px solid #1d1d20; padding:8px 6px 4px; }
  .nav .item { display:flex; flex-direction:column; align-items:center; gap:3px; color:#b6b6bd; font-size:9px; }
  .nav .item svg { display:block; }
  .nav .item.home { color:#fff; }
  .add { position:relative; width:44px; height:27px; }
  .add::before, .add::after { content:""; position:absolute; top:0; width:44px; height:27px; border-radius:9px; }
  .add::before { left:-5px; background:var(--cyan); }
  .add::after  { left:5px;  background:var(--red); }
  .add .box { position:absolute; inset:0; background:#fff; border-radius:9px; z-index:2;
    display:flex; align-items:center; justify-content:center; color:#000; font-size:20px; font-weight:800; line-height:1; }

  .home-indicator { flex:none; display:flex; justify-content:center; padding:8px 0 9px; background:#0a0a0a; }
  .home-indicator i { width:134px; height:5px; border-radius:3px; background:#fff; display:block; }

  .foot { width:min(560px,100%); text-align:center; color:#7d7d88; font-size:11px; line-height:1.6; }
</style>
</head>
<body>
  <div class="summary">
    <h1>TikTok 表示順位 — <span class="kw">${esc(keyword)}</span></h1>
    <p>${videos.length} 件 / ${numSessions} セッション</p>
    <p class="own">${ownLine}</p>
    <span class="legend"><span><span class="sw red"></span> 自社動画</span><span><span class="sw ad"></span> 広告</span></span>
  </div>

  <div class="device">
    <span class="btn silent"></span><span class="btn volup"></span><span class="btn voldn"></span><span class="btn power"></span>
    <div class="screen">
      <div class="island"></div>

      <div class="statusbar">
        <span class="time">9:41</span>
        <span class="sys">
          <!-- cellular -->
          <svg width="18" height="12" viewBox="0 0 18 12" fill="#fff"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="6" width="3" height="6" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
          <!-- wifi -->
          <svg width="17" height="12" viewBox="0 0 17 12" fill="#fff"><path d="M8.5 2C5.6 2 3 3.1 1 4.9l1.5 1.6C4.1 5 6.2 4 8.5 4s4.4 1 6 2.5L16 4.9C14 3.1 11.4 2 8.5 2zm0 4c-1.8 0-3.4.7-4.6 1.8L5.4 9.4c.8-.8 1.9-1.3 3.1-1.3s2.3.5 3.1 1.3l1.5-1.6C11.9 6.7 10.3 6 8.5 6zm0 4c-.8 0-1.5.3-2 .9l2 2.1 2-2.1c-.5-.6-1.2-.9-2-.9z"/></svg>
          <!-- battery -->
          <svg width="27" height="13" viewBox="0 0 27 13"><rect x="0.5" y="0.5" width="22" height="12" rx="3.5" fill="none" stroke="#fff" stroke-opacity=".5"/><rect x="2" y="2" width="17" height="9" rx="2" fill="#fff"/><rect x="24" y="4" width="2" height="5" rx="1" fill="#fff" fill-opacity=".5"/></svg>
        </span>
      </div>

      <div class="ttk-top">
        <span class="back">‹</span>
        <div class="searchpill">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="#9a9aa2"><path d="M10 4a6 6 0 104.47 10.03l4.25 4.25 1.41-1.41-4.25-4.25A6 6 0 0010 4zm0 2a4 4 0 110 8 4 4 0 010-8z"/></svg>
          <span class="q">${esc(keyword)}</span>
          <span class="clear">✕</span>
        </div>
        <span class="cancel">キャンセル</span>
      </div>

      <div class="tabs">
        <span class="t active">トップ</span><span class="t">ユーザー</span><span class="t">動画</span><span class="t">サウンド</span><span class="t">LIVE</span><span class="t">ハッシュタグ</span>
      </div>

      <div class="feed">
        <div class="grid">
${cards}
        </div>
      </div>

      <div class="nav">
        <div class="item home">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l9 8h-3v9h-4v-6h-4v6H6v-9H3z"/></svg>
          ホーム
        </div>
        <div class="item">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm7 0a3 3 0 100-6 3 3 0 000 6zM9 12.5c-3 0-6 1.5-6 4.2V20h12v-3.3c0-2.7-3-4.2-6-4.2zm7 .2c-.5 0-1 .05-1.5.14 1.3.9 2 2.1 2 3.86V20h5v-3.1c0-2.4-2.7-4.2-5.5-4.2z"/></svg>
          フレンド
        </div>
        <div class="add"><span class="box">+</span></div>
        <div class="item">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 7l8 6 8-6"/></svg>
          受信トレイ
        </div>
        <div class="item">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.3 3.6-5.5 8-5.5s8 2.2 8 5.5z"/></svg>
          プロフィール
        </div>
      </div>

      <div class="home-indicator"><i></i></div>
    </div>
  </div>

  <div class="foot">
    生成: ${esc(generatedAt)}<br>
    ※ TikTok のサムネイルURLは時間が経つと失効することがあります。表示されない枠は順位・再生数のみ表示されます。
  </div>
</body>
</html>`;
}
