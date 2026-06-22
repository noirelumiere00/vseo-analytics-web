/**
 * proposalHtml.ts — クライアント提案用の「16:9 スライドデック」を生成する自己完結HTML。
 *
 * 1ファイルに複数スライド（タグ/キーワードごと1枚）。各スライド 1920×1080（PPTX 16:9 等倍）:
 *   - 左: スマホモック（platform 別。instagram=ライト / tiktok=ダーク）。3列カバーグリッド＋順位＋自社=赤枠。
 *   - 右: 見出し＋順位表（サムネ｜順位｜アカウント｜URL）。自社行は赤ハイライト。
 *   - 下: 生成日時＋ブランド。
 * 横スクロール+scroll-snap、←/→キー・前後ボタン・ドットでページ送り。
 *
 * すべて inline CSS/SVG（外部アセットなし）。既存 feedHtml/igFeedHtml は触らず、本ファイルで完結。
 */

export interface ProposalItem {
  rank: number;
  account: string;
  url: string;
  thumbUrl: string;
  isOwn: boolean;
  /** instagram のみ: reel/carousel/image/video。アイコン表示に使用 */
  type?: string;
}

export interface ProposalSlide {
  platform: "tiktok" | "instagram";
  title: string;
  subtitle?: string;
  ownRanks: number[];
  items: ProposalItem[];
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

function shortUrl(u: string): string {
  return esc(u.replace(/^https?:\/\/(www\.)?/, "").replace(/\?.*$/, "").replace(/\/$/, ""));
}

const REEL_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="#fff" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))"><path d="M8 5v14l11-7z"/></svg>';
const CAROUSEL_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#fff" stroke-width="2" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))"><rect x="7" y="3" width="14" height="14" rx="2.5"/><path d="M3 7v12a2 2 0 002 2h12"/></svg>';

function tileCorner(it: ProposalItem): string {
  if (it.isOwn) return '<span class="t-badge">自社</span>';
  if (it.type === "reel" || it.type === "video") return `<span class="t-corner">${REEL_SVG}</span>`;
  if (it.type === "carousel") return `<span class="t-corner">${CAROUSEL_SVG}</span>`;
  return "";
}

function renderPhone(slide: ProposalSlide): string {
  const ig = slide.platform === "instagram";
  const tag = esc(slide.title.replace(/^#/, ""));
  const tiles = slide.items
    .map((it) => {
      const img = it.thumbUrl
        ? `<img class="cover" src="${esc(it.thumbUrl)}" loading="lazy" referrerpolicy="no-referrer" alt="" onerror="this.style.display='none'">`
        : "";
      return (
        `<div class="tile${it.isOwn ? " own" : ""}">` +
        img +
        `<span class="t-rank">${it.rank}</span>` +
        tileCorner(it) +
        `<span class="t-user">@${esc(it.account)}</span>` +
        `</div>`
      );
    })
    .join("");

  const header = ig
    ? `<div class="p-head ig"><span class="back">‹</span><div class="h-title"><div class="h-lbl">ハッシュタグ</div><div class="h-tag">#${tag}</div></div><span class="more">⋯</span></div>`
    : `<div class="p-head tt"><span class="back">‹</span><div class="tt-search"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#aaa" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-3.6-3.6"/></svg><span>${esc(slide.title)}</span></div><span class="cancel">キャンセル</span></div>`;

  const nav = ig
    ? `<div class="p-nav ig"><span>⌂</span><span class="on">⌕</span><span>⊕</span><span>▷</span><span class="ava"></span></div>`
    : `<div class="p-nav tt"><span class="on">ホーム</span><span>フレンド</span><span class="plus">＋</span><span>受信</span><span>プロフ</span></div>`;

  return (
    `<div class="phone ${ig ? "ig" : "tt"}">` +
    `<div class="screen">` +
    `<div class="status"><span>9:41</span><span class="sg">●●●● <b>5G</b> ▮</span></div>` +
    header +
    `<div class="grid">${tiles}</div>` +
    nav +
    `<div class="home-ind"></div>` +
    `</div></div>`
  );
}

function renderTable(slide: ProposalSlide): string {
  const rows = slide.items
    .map((it) => {
      const thumb = it.thumbUrl
        ? `<img src="${esc(it.thumbUrl)}" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`
        : "";
      return (
        `<tr class="${it.isOwn ? "own" : ""}">` +
        `<td class="c-thumb"><div class="th">${thumb}${it.isOwn ? '<span class="row-own">自社</span>' : ""}</div></td>` +
        `<td class="c-rank">${it.rank}</td>` +
        `<td class="c-acc">@${esc(it.account)}</td>` +
        `<td class="c-url"><a href="${esc(it.url)}" target="_blank" rel="noopener">${shortUrl(it.url)}</a></td>` +
        `</tr>`
      );
    })
    .join("");
  return (
    `<table class="rank-table"><thead><tr>` +
    `<th class="c-thumb">サムネ</th><th class="c-rank">順位</th><th class="c-acc">アカウント</th><th class="c-url">URL</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>`
  );
}

function renderSlide(slide: ProposalSlide, idx: number, total: number): string {
  const ig = slide.platform === "instagram";
  const ownLine =
    slide.ownRanks.length > 0
      ? `自社 <b>${slide.ownRanks.length}</b> 件　順位 <b>${slide.ownRanks.join(" / ")}</b>`
      : `自社の該当なし`;
  const platLabel = ig ? "Instagram" : "TikTok";
  return (
    `<section class="slide" id="slide-${idx}">` +
    `<div class="left">${renderPhone(slide)}</div>` +
    `<div class="right">` +
    `<div class="r-head">` +
    `<div class="plat ${ig ? "ig" : "tt"}">${platLabel}</div>` +
    `<h1>${esc(slide.title)} <span class="sub">表示順位</span></h1>` +
    `<div class="own-pill ${slide.ownRanks.length ? "hit" : "miss"}">${ownLine}</div>` +
    `</div>` +
    `<div class="table-wrap">${renderTable(slide)}</div>` +
    `</div>` +
    `<div class="slide-foot"><span class="brand">VSEO Analytics</span><span class="pg">${idx + 1} / ${total}</span></div>` +
    `</section>`
  );
}

export function renderProposalDeck(params: {
  deckTitle: string;
  generatedAt: string;
  slides: ProposalSlide[];
  width?: number;
  height?: number;
}): string {
  const { deckTitle, generatedAt, slides } = params;
  const W = params.width ?? 1920;
  const H = params.height ?? 1080;
  const slidesHtml = slides.map((s, i) => renderSlide(s, i, slides.length)).join("\n");
  const dots = slides.map((_, i) => `<button class="dot" data-i="${i}"></button>`).join("");

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(deckTitle)} — 提案デック</title>
<style>
  :root{ --slide-w:${W}px; --slide-h:${H}px; --red:#ff2d4b; --ink:#15151c; --muted:#6b6b78;
         --ig1:#feda75; --ig2:#fa7e1e; --ig3:#d62976; --ig4:#962fbf; --ig5:#4f5bd5; }
  *{ box-sizing:border-box; margin:0; padding:0; }
  html,body{ background:#0c0c10; font-family:-apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif; color:var(--ink); }
  .deck{ display:flex; overflow-x:auto; scroll-snap-type:x mandatory; scroll-behavior:smooth; }
  .deck::-webkit-scrollbar{ height:0; }
  .slide{ position:relative; flex:0 0 var(--slide-w); width:var(--slide-w); height:var(--slide-h);
          scroll-snap-align:center; background:
            radial-gradient(1400px 700px at 12% -10%, #ffffff, #f4f5f8 55%, #eef0f4);
          display:grid; grid-template-columns:600px 1fr; gap:48px; padding:64px 72px 70px; overflow:hidden; }
  .slide::before{ content:""; position:absolute; inset:0 0 auto 0; height:10px;
          background:linear-gradient(90deg,var(--ig1),var(--ig2),var(--ig3),var(--ig4),var(--ig5)); }

  /* ---- left: phone ---- */
  .left{ display:flex; align-items:center; justify-content:center; }
  .phone{ width:430px; border-radius:54px; padding:13px;
          background:linear-gradient(#15151b,#06060a);
          box-shadow:0 40px 80px rgba(10,12,30,.34), inset 0 0 0 2px #2a2a33; }
  .phone .screen{ position:relative; border-radius:42px; overflow:hidden; height:830px; display:flex; flex-direction:column; }
  .phone.ig .screen{ background:#fff; color:#000; }
  .phone.tt .screen{ background:#000; color:#fff; }
  .screen .status{ display:flex; justify-content:space-between; align-items:center; padding:14px 26px 6px; font-size:14px; font-weight:700; }
  .phone.tt .status{ color:#fff; }
  .status .sg{ font-size:11px; letter-spacing:1px; }
  .status .sg b{ font-weight:700; }

  .p-head{ display:flex; align-items:center; gap:10px; padding:6px 14px 10px; flex:none; }
  .p-head.ig{ border-bottom:1px solid #efefef; }
  .p-head .back{ font-size:24px; line-height:1; }
  .p-head.ig .h-title{ flex:1; text-align:center; }
  .p-head.ig .h-lbl{ font-size:10px; color:#8a8a8a; }
  .p-head.ig .h-tag{ font-size:16px; font-weight:800; }
  .p-head.ig .more{ width:22px; text-align:center; font-size:20px; }
  .p-head.tt{ color:#fff; }
  .tt-search{ flex:1; display:flex; align-items:center; gap:7px; background:#1f1f24; border-radius:18px; padding:7px 12px; color:#ddd; font-size:13px; }
  .tt-search span{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .p-head.tt .cancel{ color:#ff385f; font-size:13px; font-weight:600; }

  .grid{ flex:1; display:grid; grid-template-columns:repeat(3,1fr); gap:2px; overflow:hidden; align-content:start; }
  .tile{ position:relative; aspect-ratio:9/15; overflow:hidden; }
  .phone.ig .tile{ aspect-ratio:1/1; background:#eee; }
  .phone.tt .tile{ background:#111; }
  .tile .cover{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .tile .t-rank{ position:absolute; top:5px; left:5px; z-index:3; min-width:17px; height:17px; padding:0 5px;
                 background:rgba(0,0,0,.62); color:#fff; font-size:11px; font-weight:800; border-radius:9px;
                 display:flex; align-items:center; justify-content:center; }
  .tile .t-corner{ position:absolute; top:5px; right:5px; z-index:3; line-height:0; }
  .tile .t-badge{ position:absolute; top:5px; right:5px; z-index:4; background:var(--red); color:#fff;
                  font-size:9px; font-weight:800; padding:2px 5px; border-radius:8px; }
  .tile .t-user{ position:absolute; left:0; right:0; bottom:0; z-index:2; padding:12px 6px 4px; font-size:9px; color:#fff;
                 white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                 background:linear-gradient(transparent,rgba(0,0,0,.6)); }
  .tile.own{ outline:3px solid var(--red); outline-offset:-3px; z-index:1;
             box-shadow:inset 0 0 0 1px var(--red), 0 0 12px rgba(255,45,75,.55); }

  .p-nav{ flex:none; display:flex; align-items:center; justify-content:space-around; padding:9px 12px; font-size:11px; }
  .p-nav.ig{ background:#fff; border-top:1px solid #dbdbdb; color:#000; font-size:17px; }
  .p-nav.ig .ava{ width:20px; height:20px; border-radius:50%; border:1.5px solid #000; display:inline-block; }
  .p-nav.tt{ background:#000; border-top:1px solid #161616; color:#9a9a9a; }
  .p-nav.tt .on{ color:#fff; } .p-nav.ig .on{ font-weight:800; }
  .p-nav.tt .plus{ color:#fff; background:linear-gradient(90deg,#25f4ee,#fe2c55); padding:1px 8px; border-radius:6px; font-weight:800; }
  .home-ind{ position:absolute; left:50%; transform:translateX(-50%); bottom:7px; width:120px; height:4px; border-radius:3px;
             background:rgba(0,0,0,.85); }
  .phone.tt .home-ind{ background:rgba(255,255,255,.85); }

  /* ---- right: title + table ---- */
  .right{ display:flex; flex-direction:column; min-width:0; padding-top:6px; }
  .r-head{ flex:none; margin-bottom:12px; }
  .plat{ display:inline-block; font-size:13px; font-weight:800; letter-spacing:.04em; padding:5px 12px; border-radius:999px; color:#fff; }
  .plat.ig{ background:linear-gradient(45deg,var(--ig2),var(--ig3),var(--ig4)); }
  .plat.tt{ background:#000; }
  .r-head h1{ font-size:40px; font-weight:900; letter-spacing:.01em; margin:10px 0 8px; line-height:1.05; }
  .r-head h1 .sub{ font-size:22px; font-weight:700; color:var(--muted); }
  .own-pill{ display:inline-block; font-size:16px; padding:6px 14px; border-radius:10px; }
  .own-pill b{ font-size:18px; }
  .own-pill.hit{ background:rgba(255,45,75,.1); color:#c81e3a; border:1px solid rgba(255,45,75,.3); }
  .own-pill.miss{ background:#eef0f4; color:#6b6b78; }

  .table-wrap{ flex:1; min-height:0; overflow:auto; border:1px solid #e7e8ee; border-radius:16px; background:#fff;
               box-shadow:0 20px 40px rgba(20,22,40,.06); }
  .table-wrap::-webkit-scrollbar{ width:8px; } .table-wrap::-webkit-scrollbar-thumb{ background:#d6d8e0; border-radius:8px; }
  .rank-table{ width:100%; border-collapse:collapse; font-size:15px; }
  .rank-table thead th{ position:sticky; top:0; background:#fafbfc; z-index:2; text-align:left; font-size:12px; font-weight:800;
                        color:#8a8b96; letter-spacing:.05em; padding:9px 16px; border-bottom:2px solid #eceef3; }
  .rank-table td{ padding:4px 16px; border-bottom:1px solid #f1f2f6; vertical-align:middle; }
  .rank-table tbody tr:last-child td{ border-bottom:0; }
  .c-thumb{ width:50px; } .th{ position:relative; width:30px; height:40px; border-radius:6px; overflow:hidden; background:#eef0f4; }
  .th img{ width:100%; height:100%; object-fit:cover; }
  .th .row-own{ position:absolute; inset:auto 0 0 0; background:var(--red); color:#fff; font-size:7px; font-weight:800; text-align:center; padding:1px 0; }
  .c-rank{ width:54px; font-size:18px; font-weight:900; color:var(--ink); }
  .c-acc{ font-weight:700; white-space:nowrap; }
  .c-url{ max-width:520px; }
  .c-url a{ color:#3a6df0; text-decoration:none; font-size:14px; word-break:break-all; }
  .c-url a:hover{ text-decoration:underline; }
  tr.own td{ background:rgba(255,45,75,.06); }
  tr.own .c-rank{ color:var(--red); }
  tr.own td:first-child{ box-shadow:inset 4px 0 0 var(--red); }

  .slide-foot{ position:absolute; left:72px; right:72px; bottom:24px; display:flex; justify-content:space-between;
               font-size:13px; color:#9a9ba6; }
  .slide-foot .brand{ font-weight:800; letter-spacing:.08em; }

  /* deck nav */
  .navbar{ position:fixed; left:50%; bottom:18px; transform:translateX(-50%); z-index:50; display:flex; align-items:center; gap:14px;
           background:rgba(12,12,18,.82); backdrop-filter:blur(8px); padding:9px 16px; border-radius:999px; color:#fff; }
  .navbar button{ background:none; border:0; color:#fff; cursor:pointer; font-size:16px; }
  .navbar .dots{ display:flex; gap:7px; } .navbar .dot{ width:9px; height:9px; border-radius:50%; background:#5a5a66; padding:0; }
  .navbar .dot.on{ background:#fff; }
  .hint{ position:fixed; top:14px; left:50%; transform:translateX(-50%); z-index:50; color:#8a8a96; font-size:12px; }
  @media print{ .navbar,.hint{ display:none; } .deck{ display:block; } .slide{ page-break-after:always; } }
</style>
</head>
<body>
  <div class="hint">← → でスライド切替（1920×1080・PPTXに貼り付け可）</div>
  <div class="deck" id="deck">
${slidesHtml}
  </div>
  <div class="navbar">
    <button id="prev">‹</button>
    <div class="dots">${dots}</div>
    <button id="next">›</button>
  </div>
  <div style="position:fixed;right:14px;bottom:16px;color:#6b6b78;font-size:11px;z-index:50">生成: ${esc(generatedAt)}</div>
<script>
  const deck=document.getElementById('deck');
  const slides=[...document.querySelectorAll('.slide')];
  const dots=[...document.querySelectorAll('.dot')];
  let cur=0;
  function go(i){ cur=Math.max(0,Math.min(slides.length-1,i)); slides[cur].scrollIntoView({behavior:'smooth',inline:'center'});
    dots.forEach((d,k)=>d.classList.toggle('on',k===cur)); }
  document.getElementById('prev').onclick=()=>go(cur-1);
  document.getElementById('next').onclick=()=>go(cur+1);
  dots.forEach(d=>d.onclick=()=>go(+d.dataset.i));
  addEventListener('keydown',e=>{ if(e.key==='ArrowRight')go(cur+1); if(e.key==='ArrowLeft')go(cur-1); });
  go(0);
</script>
</body>
</html>`;
}
