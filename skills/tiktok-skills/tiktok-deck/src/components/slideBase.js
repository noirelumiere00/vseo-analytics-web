// slideBase.js — 全スライド共通の骨格（正式FMT準拠）
// ヘッダー：Qラベル（ゴシック太・ブランド色）＋見出し（明朝）／右上にPARTタグ／下に細い黒罫
const T = require('../theme');
const { fit, fitBalanced, subSentences, estimateLines } = require('../helpers/text');
const { stats } = require('../helpers/data');

// 補足行に実際に入る文字数。幅14.1in・下限11.5pt で1行約88字、2行で約176字。
// ここを 110 に固定していたため、呼び出し側が予算内に収めた文が
// この段でもう一度切られ、逆接の前半だけが残っていた
// （p5 が「◯◯社／実質162本で5社最多。」で終わり、最下位である事実が消えた）
const SUB_MAX = 170;

let pageCounter = 0;
let deckCount = 0;   // 表紙も含む実スライド数
let totalPages = 0;
function resetPages() { pageCounter = 0; deckCount = 0; }
function setTotal(n) { totalPages = n; }

function addFooter(s, footerLeft, dark) {
  pageCounter = deckCount;   // 表紙を1と数えた物理位置。最終ページ＝総数になる
  const col = dark ? T.color.darkSub : T.color.subLight;
  if (footerLeft) {
    s.addText(String(footerLeft).toUpperCase(), {
      x: T.margin.l, y: T.footerY, w: T.content.w - 2.2, h: 0.34,
      fontFace: T.font.gothic, fontSize: T.size.footer, color: col,
      charSpacing: 1.6, valign: 'middle',
    });
  }
  s.addText(`${String(pageCounter).padStart(2, '0')} / ${totalPages || '--'}`, {
    x: T.slide.w - T.margin.r - 2.2, y: T.footerY, w: 2.2, h: 0.34,
    fontFace: T.font.gothic, fontSize: T.size.footer, bold: true, color: col,
    align: 'right', valign: 'middle',
  });
}

/** 標準スライド。opts: {qLabel, title, partTag, lead, accent, footerLeft} */
function addSlide(pptx, opts = {}) {
  const s = pptx.addSlide();
  deckCount += 1;
  s.background = { color: T.color.bg };
  const H = T.header;
  const accent = opts.accent || T.brandColors[0];

  if (opts.qLabel) {
    s.addText(opts.qLabel, {
      x: H.qX, y: H.qY, w: H.qW, h: H.qH,
      fontFace: T.font.gothic,
      fontSize: fit(opts.qLabel, H.qW, 0.5, { base: T.size.qLabel, min: 13, lineHeight: 1.05 }),
      bold: true, color: accent, align: 'left', valign: 'middle', wrap: false,
    });
  }
  if (opts.title) {
    // Q番号が長い（KW-1b 等）とチップ幅1.55inを超えて設問に食い込む。実長ぶんだけ右へ送る
    const x = opts.qLabel ? Math.max(H.titleX, H.qX + H.qW) : H.qX;
    const w = (opts.qLabel ? H.titleX + H.titleW : T.content.w + T.margin.l - H.tagW) - x;
    // 結論を大見出しにする版では、Qタイトルは小さめのゴシックで上に置く
    const small = !!opts.conclusion;
    s.addText(opts.title, {
      // 小見出し時はQ番号チップと上下中心を揃える（既定だと設問だけ約11px浮く）
      x, y: small ? H.qY + (H.qH - 0.42) / 2 : H.titleY, w, h: small ? 0.42 : H.titleH,
      fontFace: small ? T.font.gothic : T.font.mincho,
      fontSize: small
        ? fit(opts.title, w, 0.42, { base: 15, min: 12, lineHeight: 1.1 })
        : fit(opts.title, w, H.titleH, { base: T.size.slideTitle, min: 17, lineHeight: 1.15 }),
      bold: true, color: small ? T.color.sub : T.color.text, align: 'left', valign: 'middle',
    });
  }
  // 結論（明朝の大見出し）＋補足行。納品版のレイアウトに合わせる
  let subLines = 1;
  if (opts.conclusion) {
    const cw = T.content.w;
    const ch = 1.02;
    s.addText(opts.conclusion, {
      x: H.qX, y: H.titleY + 0.64, w: cw, h: ch,
      fontFace: T.font.mincho,
      fontSize: fitBalanced(opts.conclusion, cw, ch, { base: 33, min: 19, lineHeight: 1.18, minTail: 6 }),
      bold: true, color: T.color.text, align: 'left', valign: 'middle',
    });
    if (opts.conclusionSub) {
      // 文字数での機械カットは語尾を落とす。枠に入る「最後の完結した文」で切る。
      // 切ったら必ず記録する。ここに記録が無かったせいで、呼び出し側の QA ログが
      // 「非掲載ゼロ」を報告しているのに紙面では文が落ちている状態を作っていた
      const subFull = String(opts.conclusionSub);
      const subText = subSentences(subFull, SUB_MAX);
      if (subText !== subFull) {
        stats.qaFixes.push(`補足行に入らず非掲載（${opts.qLabel || opts.title || '?'}）: `
          + `"${subFull.slice(subText.length, subText.length + 34)}…"`);
      }
      // 1行固定にしていたため、括弧付きの但し書きが下限フォントでも収まらなかった。
      // 但し書きを削るのではなく2行まで許して、その分だけ以降を下げる
      subLines = Math.min(2, estimateLines(subText, cw, 12.5));
      const subH = 0.40 + (subLines - 1) * 0.30;
      s.addText(subText, {
        x: H.qX, y: H.titleY + 0.64 + ch + 0.04, w: cw, h: subH,
        fontFace: T.font.gothic,
        fontSize: fit(subText, cw, subH, { base: 15, min: 11.5, lineHeight: 1.2 }),
        color: T.color.sub, align: 'left', valign: 'top',
      });
    }
  }
  if (opts.partTag) {
    s.addText(opts.partTag, {
      x: T.slide.w - T.margin.r - H.tagW, y: H.titleY, w: H.tagW, h: H.titleH,
      fontFace: T.font.gothic, fontSize: T.size.partTag, color: T.color.subLight,
      align: 'right', valign: 'middle', charSpacing: 1.4,
    });
  }
  const shift = opts.conclusion
    ? (opts.conclusionSub ? 1.58 + (subLines - 1) * 0.30 : 1.14) : 0;
  s.addShape('line', {
    x: H.qX, y: H.ruleY + shift, w: T.content.w, h: 0,
    line: { color: T.color.rule, width: 1.1 },
  });
  if (opts.lead) {
    s.addText(opts.lead, {
      x: H.qX, y: H.leadY + shift, w: T.content.w - 6.0, h: H.leadH,
      fontFace: T.font.gothic,
      fontSize: fit(opts.lead, T.content.w - 6.0, H.leadH, { base: T.size.lead, min: 11, lineHeight: 1.2 }),
      color: T.color.sub, align: 'left', valign: 'middle',
    });
  }
  if (opts.countPage !== false) addFooter(s, opts.footerLeft);
  return s;
}

/** PART中扉：黒地・輪郭だけの巨大数字・明朝の大見出し・右下にQ一覧 */
function addDivider(pptx, { partNo, partIndex, name, desc, items, footerLeft }) {
  const s = pptx.addSlide();
  deckCount += 1;
  s.background = { color: T.color.dark };
  s.addText(`PART ${partIndex}`, {
    x: 1.15, y: 0.95, w: 6.0, h: 0.40,
    fontFace: T.font.gothic, fontSize: T.size.partLabel, bold: true,
    color: T.color.darkSub, charSpacing: 4,
  });
  // 輪郭だけの巨大数字
  s.addText(String(partIndex), {
    x: 1.05, y: 1.45, w: 4.0, h: 3.4,
    fontFace: T.font.en, fontSize: 300, bold: true,
    color: T.color.dark, outline: { size: 1.1, color: '4A4B50' },
    align: 'left', valign: 'middle',
  });
  s.addText(name, {
    x: 1.15, y: 7.10, w: 9.6, h: 1.10,
    fontFace: T.font.mincho, fontSize: T.size.partTitle, bold: true,
    color: T.color.darkText, valign: 'middle',
  });
  if (desc) {
    s.addText(desc, {
      x: 1.15, y: 8.35, w: 9.6, h: 1.45,
      fontFace: T.font.gothic,
      fontSize: fit(desc, 9.6, 1.45, { base: T.size.partDesc, min: 11 }),
      color: T.color.darkSub, valign: 'top', lineSpacingMultiple: 1.5,
    });
  }
  // 右下のQ一覧
  const ix = 13.30; const iw = T.slide.w - T.margin.r - ix;
  const list = (items || []).slice(0, 6);
  const rowH = Math.min(0.95, 3.9 / Math.max(1, list.length));
  let y = 6.35;
  list.forEach((it) => {
    s.addShape('line', { x: ix, y, w: iw, h: 0, line: { color: T.color.darkRule, width: 0.75 } });
    s.addText(it.q, {
      x: ix, y: y + 0.10, w: 1.05, h: rowH - 0.16,
      fontFace: T.font.gothic, fontSize: T.size.partIndexQ, bold: true, color: T.color.darkSub, valign: 'top',
    });
    s.addText(it.text, {
      x: ix + 1.10, y: y + 0.08, w: iw - 1.10, h: rowH - 0.14,
      fontFace: T.font.gothic,
      fontSize: fit(it.text, iw - 1.10, rowH - 0.14, { base: T.size.partIndexText, min: 10, lineHeight: 1.25 }),
      color: T.color.darkText, valign: 'top', lineSpacingMultiple: 1.2,
    });
    y += rowH;
  });
  s.addShape('line', { x: ix, y, w: iw, h: 0, line: { color: T.color.darkRule, width: 0.75 } });
  addFooter(s, footerLeft, true);
  return s;
}

function countSlide() { deckCount += 1; }
module.exports = { addSlide, addDivider, resetPages, setTotal, countSlide,
  pages: () => pageCounter, deckSize: () => deckCount };
