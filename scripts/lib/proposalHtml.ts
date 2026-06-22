/**
 * proposalHtml.ts — クライアント提案用の「16:9 スライドデック」を生成する自己完結HTML。
 *
 * 1ファイルに複数スライド（KW/タグごと1枚）。各スライド 1920×1080（PPTX 16:9 等倍）:
 *   - 左: スマホモック。`feedHtml.ts` / `igFeedHtml.ts` の**詳細モック（variant:"embed"）**を
 *         iframe(srcdoc) で内包（CSS干渉を避けつつ高品質UIをそのまま流用）。
 *   - 右: 見出し＋順位表。表は**自社投稿のみ**（サムネ｜順位｜アカウント｜URL）。自社0件は「該当なし」。
 *   - 下: ブランド＋ページ番号。
 * 横スクロール+scroll-snap、←/→キー・前後ボタン・ドットでページ送り。
 *
 * サムネは呼び出し側で base64 化済み（deviceHtml 内・items.thumbUrl とも）→ HTMLは自己完結（リンク切れ無し）。
 */

export interface ProposalItem {
  rank: number;
  account: string;
  url: string;
  thumbUrl: string;
  isOwn: boolean;
}

export interface ProposalSlide {
  platform: "tiktok" | "instagram";
  title: string;
  ownRanks: number[];
  /** 左に内包する詳細スマホモック（renderFeedHtml/renderIgFeedHtml の variant:"embed" 出力） */
  deviceHtml: string;
  /** 右の表に出す行（自社のみ） */
  items: ProposalItem[];
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

/** srcdoc 属性に HTML を入れるためのエスケープ（& と " のみ。既存エンティティは二重符号化されて1回のデコードで復元） */
function escAttr(html: string): string {
  return html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function shortUrl(u: string): string {
  return esc(u.replace(/^https?:\/\/(www\.)?/, "").replace(/\?.*$/, "").replace(/\/$/, ""));
}

function renderTable(slide: ProposalSlide): string {
  const ownItems = slide.items.filter((it) => it.isOwn);
  if (ownItems.length === 0) {
    return (
      `<div class="empty">` +
      `<div class="empty-i">—</div>` +
      `<div class="empty-t">自社投稿は今回のランキングに該当なし</div>` +
      `<div class="empty-s">（左のランキングに自社の投稿は入っていません）</div>` +
      `</div>`
    );
  }
  const rows = ownItems
    .map((it) => {
      const thumb = it.thumbUrl
        ? `<img src="${esc(it.thumbUrl)}" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`
        : "";
      return (
        `<tr class="own">` +
        `<td class="c-thumb"><div class="th">${thumb}<span class="row-own">自社</span></div></td>` +
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
    `<div class="left"><div class="mock"><iframe scrolling="no" loading="lazy" srcdoc="${escAttr(slide.deviceHtml)}"></iframe></div></div>` +
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

  /* ---- left: 詳細モックを iframe で内包（device 実寸 418x838 を少し拡大して中央配置） ---- */
  .left{ display:flex; align-items:center; justify-content:center; }
  .mock{ width:418px; height:838px; transform:scale(1.07); transform-origin:center;
         border-radius:56px; box-shadow:0 44px 90px rgba(10,12,30,.36); }
  .mock iframe{ width:418px; height:838px; border:0; border-radius:56px; display:block; background:transparent; }

  /* ---- right: title + table ---- */
  .right{ display:flex; flex-direction:column; min-width:0; padding-top:6px; }
  .r-head{ flex:none; margin-bottom:14px; }
  .plat{ display:inline-block; font-size:13px; font-weight:800; letter-spacing:.04em; padding:5px 12px; border-radius:999px; color:#fff; }
  .plat.ig{ background:linear-gradient(45deg,var(--ig2),var(--ig3),var(--ig4)); }
  .plat.tt{ background:#000; }
  .r-head h1{ font-size:42px; font-weight:900; letter-spacing:.01em; margin:10px 0 8px; line-height:1.05; }
  .r-head h1 .sub{ font-size:23px; font-weight:700; color:var(--muted); }
  .own-pill{ display:inline-block; font-size:17px; padding:7px 15px; border-radius:11px; }
  .own-pill b{ font-size:19px; }
  .own-pill.hit{ background:rgba(255,45,75,.1); color:#c81e3a; border:1px solid rgba(255,45,75,.3); }
  .own-pill.miss{ background:#eef0f4; color:#6b6b78; }

  .table-wrap{ flex:1; min-height:0; overflow:auto; border:1px solid #e7e8ee; border-radius:16px; background:#fff;
               box-shadow:0 20px 40px rgba(20,22,40,.06); }
  .table-wrap::-webkit-scrollbar{ width:8px; } .table-wrap::-webkit-scrollbar-thumb{ background:#d6d8e0; border-radius:8px; }
  .rank-table{ width:100%; border-collapse:collapse; font-size:19px; }
  .rank-table thead th{ position:sticky; top:0; background:#fafbfc; z-index:2; text-align:left; font-size:13px; font-weight:800;
                        color:#8a8b96; letter-spacing:.05em; padding:14px 18px; border-bottom:2px solid #eceef3; }
  .rank-table td{ padding:12px 18px; border-bottom:1px solid #f1f2f6; vertical-align:middle; }
  .rank-table tbody tr:last-child td{ border-bottom:0; }
  .c-thumb{ width:76px; } .th{ position:relative; width:52px; height:68px; border-radius:9px; overflow:hidden; background:#eef0f4; }
  .th img{ width:100%; height:100%; object-fit:cover; }
  .th .row-own{ position:absolute; inset:auto 0 0 0; background:var(--red); color:#fff; font-size:9px; font-weight:800; text-align:center; padding:1px 0; }
  .c-rank{ width:74px; font-size:30px; font-weight:900; color:var(--red); }
  .c-acc{ font-weight:800; white-space:nowrap; font-size:20px; }
  .c-url{ max-width:560px; }
  .c-url a{ color:#3a6df0; text-decoration:none; font-size:16px; word-break:break-all; }
  tr.own td{ background:rgba(255,45,75,.06); }
  tr.own td:first-child{ box-shadow:inset 4px 0 0 var(--red); }

  .empty{ flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; color:#9a9ba6;
          border:1px dashed #d6d8e0; border-radius:16px; background:#fafbfc; }
  .empty .empty-i{ font-size:54px; line-height:1; color:#cfd2db; }
  .empty .empty-t{ font-size:24px; font-weight:800; color:#6b6b78; margin-top:10px; }
  .empty .empty-s{ font-size:15px; margin-top:6px; }

  .slide-foot{ position:absolute; left:72px; right:72px; bottom:24px; display:flex; justify-content:space-between;
               font-size:13px; color:#9a9ba6; }
  .slide-foot .brand{ font-weight:800; letter-spacing:.08em; }

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
