/**
 * proposalHtml.ts — クライアント提案用の「16:9 スライドデック」を生成する自己完結HTML。
 *
 * デザイン: スイス・エディトリアル（人が組んだミニマル）。紙 #FAF9F6 / 墨 #1A1A1A / 朱を一点。
 * 装飾（グラデ・影・角丸カード・塗りピル・虹バー）は使わず、余白・極細罫・大きな通し番号・
 * 英大文字キッカーで構成する。欧文は Archivo（Latin 可変フォントを base64 埋め込み・自己完結）、
 * 和文は端末の上質ゴシック。
 *
 * 1ファイルに複数スライド（KW/タグごと1枚）。各スライド 1920×1080（PPTX 16:9 等倍）:
 *   - 上: キッカー（左=PLATFORM ／ 右=通し番号 01–08）＋全幅の極細罫。
 *   - 左: スマホモック（`feedHtml.ts`/`igFeedHtml.ts` の詳細モックを iframe で内包・影なし）。
 *   - 右: 大見出し（KW）＋自社サマリ＋罫線区切りのリスト（自社のみ。順位は朱）。
 *   - 下: ブランド／ページ。
 * サムネは呼び出し側で base64 化済み → HTML は自己完結（リンク切れ無し）。
 */
import * as fs from "fs";

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

// Archivo（Latin 可変フォント）を base64 で読み込み（取得不可なら system grotesque にフォールバック）
let FONT_FACE = "";
try {
  const b64 = fs.readFileSync(new URL("../assets/archivo-latin-var.woff2", import.meta.url)).toString("base64");
  FONT_FACE = `@font-face{font-family:'Archivo';font-style:normal;font-weight:100 900;font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
} catch {
  /* fallback to system stack */
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

/** srcdoc 属性に HTML を入れるためのエスケープ（& と " のみ） */
function escAttr(html: string): string {
  return html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function shortUrl(u: string): string {
  return esc(u.replace(/^https?:\/\/(www\.)?/, "").replace(/\?.*$/, "").replace(/\/$/, ""));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 右カラムのリスト（自社のみ・罫線区切り・順位は朱） */
function renderList(slide: ProposalSlide): string {
  const ownItems = slide.items.filter((it) => it.isOwn);
  if (ownItems.length === 0) {
    return `<div class="empty">— 自社の該当なし</div>`;
  }
  return (
    `<ul class="list">` +
    ownItems
      .map((it) => {
        const thumb = it.thumbUrl
          ? `<img src="${esc(it.thumbUrl)}" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">`
          : "";
        return (
          `<li class="row">` +
          `<span class="rk">${it.rank}</span>` +
          `<span class="th">${thumb}</span>` +
          `<span class="who"><b>@${esc(it.account)}</b>` +
          `<a class="url" href="${esc(it.url)}" target="_blank" rel="noopener">${shortUrl(it.url)}</a></span>` +
          `</li>`
        );
      })
      .join("") +
    `</ul>`
  );
}

function renderSlide(slide: ProposalSlide, idx: number, total: number): string {
  const plat = slide.platform === "instagram" ? "INSTAGRAM" : "TIKTOK";
  // タイトルを「主見出し（…副題）」に分割（例: N高（キーワード検索・リール））
  const m = slide.title.match(/^(.*?)（(.+)）$/);
  const titleMain = esc(m ? m[1] : slide.title);
  const titleSub = esc(m ? m[2] : "表示順位");
  const ownLine =
    slide.ownRanks.length > 0
      ? `自社 <span class="amp">${slide.ownRanks.length}</span> 件　順位 <span class="rks">${slide.ownRanks.join(" · ")}</span>`
      : `自社の該当なし`;
  return (
    `<section class="slide" id="slide-${idx}">` +
    `<header class="kick"><span class="kl">${plat} <span class="dot">·</span> 表示順位</span>` +
    `<span class="kn">${pad2(idx + 1)}<i>/${pad2(total)}</i></span></header>` +
    `<div class="rule"></div>` +
    `<div class="body">` +
    `<div class="left"><div class="mock"><iframe scrolling="no" loading="lazy" srcdoc="${escAttr(slide.deviceHtml)}"></iframe></div></div>` +
    `<div class="right">` +
    `<h1 class="ttl">${titleMain}<span class="ttl-sub">${titleSub}</span></h1>` +
    `<div class="meta">${ownLine}</div>` +
    renderList(slide) +
    `</div>` +
    `</div>` +
    `<footer class="foot"><span class="brand">VSEO ANALYTICS</span>` +
    `<span class="fp">${plat} <i>·</i> ${titleMain}</span></footer>` +
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
<title>${esc(deckTitle)}</title>
<style>
  ${FONT_FACE}
  :root{ --paper:#FAF9F6; --ink:#1A1A1A; --muted:#6E6E68; --faint:#9A988E; --line:#E4E1D8; --accent:#C8472F;
         --w:${W}px; --h:${H}px;
         --sans:'Archivo',"Hiragino Kaku Gothic ProN","Yu Gothic Medium","Noto Sans JP",sans-serif; }
  *{ box-sizing:border-box; margin:0; padding:0; }
  html,body{ background:#26251f; font-family:var(--sans); color:var(--ink); -webkit-font-smoothing:antialiased; }

  .deck{ display:flex; overflow-x:auto; scroll-snap-type:x mandatory; scroll-behavior:smooth; }
  .deck::-webkit-scrollbar{ height:0; }

  .slide{ position:relative; flex:0 0 var(--w); width:var(--w); height:var(--h); scroll-snap-align:center;
          background:var(--paper); display:flex; flex-direction:column; padding:74px 104px 60px; overflow:hidden; }

  /* キッカー */
  .kick{ display:flex; justify-content:space-between; align-items:flex-end; }
  .kl{ font-size:16px; font-weight:600; letter-spacing:.22em; color:var(--ink); text-transform:uppercase; }
  .kl .dot{ color:var(--faint); margin:0 .35em; }
  .kn{ font-size:58px; font-weight:600; letter-spacing:-.02em; color:var(--ink); line-height:.8; font-feature-settings:"tnum" 1; }
  .kn i{ font-style:normal; font-size:22px; font-weight:500; color:var(--faint); letter-spacing:0; margin-left:.1em; }
  .rule{ height:1px; background:var(--line); margin:20px 0 0; }

  /* 本文 2カラム */
  .body{ flex:1; min-height:0; display:grid; grid-template-columns:430px 1fr; gap:90px; padding-top:42px; }
  .left{ display:flex; align-items:center; justify-content:flex-start; }
  .mock{ width:392px; height:786px; overflow:hidden; }
  .mock iframe{ width:418px; height:838px; transform:scale(.9378); transform-origin:top left; border:0; display:block; background:transparent; }

  .right{ display:flex; flex-direction:column; min-width:0; }
  .ttl{ font-weight:700; font-size:78px; line-height:.96; letter-spacing:-.015em; color:var(--ink); }
  .ttl-sub{ display:block; font-size:22px; font-weight:500; letter-spacing:.02em; color:var(--muted); margin-top:18px; }
  .meta{ font-size:19px; color:var(--muted); margin:26px 0 6px; padding-bottom:22px; border-bottom:1px solid var(--line); }
  .meta .amp{ color:var(--accent); font-weight:700; font-size:21px; }
  .meta .rks{ color:var(--ink); font-feature-settings:"tnum" 1; }

  .list{ list-style:none; margin-top:4px; overflow:auto; }
  .list::-webkit-scrollbar{ width:0; }
  .row{ display:flex; align-items:center; gap:26px; padding:20px 2px; border-bottom:1px solid var(--line); }
  .row:last-child{ border-bottom:0; }
  .rk{ flex:none; width:78px; font-size:40px; font-weight:600; color:var(--accent); letter-spacing:-.02em;
       font-feature-settings:"tnum" 1; text-align:left; }
  .th{ flex:none; width:50px; height:64px; overflow:hidden; background:#ecebe4; border:1px solid var(--line); }
  .th img{ width:100%; height:100%; object-fit:cover; }
  .who{ display:flex; flex-direction:column; min-width:0; gap:4px; }
  .who b{ font-size:21px; font-weight:600; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .who .url{ font-size:13px; color:var(--faint); text-decoration:none; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .who .url:hover{ color:var(--muted); }

  .empty{ margin-top:30px; font-size:20px; color:var(--faint); padding-top:30px; border-top:1px solid var(--line); }

  /* フッタ */
  .foot{ display:flex; justify-content:space-between; align-items:center; padding-top:18px;
         border-top:1px solid var(--line); font-size:12px; letter-spacing:.16em; text-transform:uppercase; color:var(--faint); }
  .foot .brand{ font-weight:600; color:var(--muted); }
  .foot .fp i{ font-style:normal; margin:0 .4em; }

  /* 最小ナビ */
  .nav{ position:fixed; left:50%; bottom:20px; transform:translateX(-50%); z-index:50; display:flex; align-items:center; gap:16px;
        background:rgba(250,249,246,.9); border:1px solid var(--line); padding:8px 16px; }
  .nav button{ background:none; border:0; color:var(--ink); cursor:pointer; font-size:16px; line-height:1; }
  .nav .dots{ display:flex; gap:8px; } .nav .dot{ width:7px; height:7px; border-radius:50%; background:#cfccc2; padding:0; }
  .nav .dot.on{ background:var(--ink); }
  .hint{ position:fixed; top:16px; left:50%; transform:translateX(-50%); z-index:50; color:#8c8a80; font-size:11px; letter-spacing:.12em; text-transform:uppercase; }
  @media print{ .nav,.hint{ display:none; } .deck{ display:block; } .slide{ page-break-after:always; } }
</style>
</head>
<body>
  <div class="hint">← → でスライド切替</div>
  <div class="deck" id="deck">
${slidesHtml}
  </div>
  <div class="nav">
    <button id="prev">‹</button>
    <div class="dots">${dots}</div>
    <button id="next">›</button>
  </div>
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
