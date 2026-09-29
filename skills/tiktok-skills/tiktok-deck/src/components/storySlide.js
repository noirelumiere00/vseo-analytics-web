// storySlide.js — 初訪（ストーリー型）専用のスライド骨格
//
// 初訪は「画像＋ワンフレーズ」で読ませる資料（2026-09 上長FB）。
// 分析資料用の addSlide は Q番号・PARTタグ・lead注記（「検索上位のうち先頭10本。順位は…」）を
// 必ず出すため、上長が「この辺はいらない」と切った“器”がそのまま付いてくる。
// ここでは見出し・補足・フッターだけを持つ骨格を別に用意する。
const T = require('../theme');
const { fit, fitBalanced } = require('../helpers/text');
const { countSlide } = require('./slideBase');
const { fitBox, linkTo } = require('../helpers/imageBox');

const S = {
  kickerY: 0.62,
  headY: 0.98, headH: 1.10,
  subY: 2.10, subH: 0.50,
  ruleY: 2.78,
  top: 3.05,            // 本文（ビジュアル）領域の上端
  bottom: T.content.bottom,
};

let pageNo = 0;
let pageTotal = 0;
function resetStory(total) { pageNo = 0; pageTotal = total || 0; }

function addStoryFooter(s, left, dark) {
  pageNo += 1;
  const col = dark ? T.color.darkSub : T.color.subLight;
  if (left) {
    s.addText(left, {
      x: T.margin.l, y: T.footerY, w: T.content.w - 2.4, h: 0.34,
      fontFace: T.font.gothic, fontSize: T.size.footer, color: col, valign: 'middle',
    });
  }
  // preflight.py はこの「NN / NN」をフッターとして認識する（フッター衝突の判定に使う）
  s.addText(`${String(pageNo).padStart(2, '0')} / ${pageTotal || '--'}`, {
    x: T.slide.w - T.margin.r - 2.2, y: T.footerY, w: 2.2, h: 0.34,
    fontFace: T.font.gothic, fontSize: T.size.footer, bold: true, color: col,
    align: 'right', valign: 'middle',
  });
}

/**
 * 見出し（明朝・1文）＋補足（1〜2行）＋細罫＋フッターだけの骨格。
 * opts: {kicker, headline, sub, accent, footer}
 */
function addStorySlide(pptx, opts) {
  const s = pptx.addSlide();
  countSlide();
  s.background = { color: T.color.bg };
  const accent = opts.accent || T.brandColors[0];
  if (opts.kicker) {
    s.addText(opts.kicker, {
      x: T.margin.l, y: S.kickerY, w: 12.0, h: 0.36,
      fontFace: T.font.gothic, fontSize: 14, bold: true, color: accent,
      charSpacing: 1.2, valign: 'middle',
    });
  }
  if (opts.tag) {
    s.addText(opts.tag, {
      x: T.slide.w - T.margin.r - 5.0, y: S.kickerY, w: 5.0, h: 0.36,
      fontFace: T.font.gothic, fontSize: 12, color: T.color.subLight,
      align: 'right', valign: 'middle', charSpacing: 1.2,
    });
  }
  s.addText(opts.headline || '', {
    x: T.margin.l, y: S.headY, w: T.content.w, h: S.headH,
    fontFace: T.font.mincho,
    fontSize: fitBalanced(opts.headline || '', T.content.w, S.headH,
      { base: 40, min: 26, lineHeight: 1.15, minTail: 6 }),
    bold: true, color: T.color.text, valign: 'middle',
  });
  if (opts.sub) {
    s.addText(opts.sub, {
      x: T.margin.l, y: S.subY, w: T.content.w, h: S.subH,
      fontFace: T.font.gothic,
      fontSize: fit(opts.sub, T.content.w, S.subH, { base: 17, min: 12.5, lineHeight: 1.2 }),
      color: T.color.sub, valign: 'top',
    });
  }
  s.addShape('line', {
    x: T.margin.l, y: S.ruleY, w: T.content.w, h: 0, line: { color: T.color.rule, width: 1.1 },
  });
  addStoryFooter(s, opts.footer);
  // 本文の文字数を数える（FB「文字が多い」の再発防止）。短いラベル（順位・再生・PR 等の6字以下）は
  // 文章ではないので数えない。preflight.py と同じ数え方にする
  s._fvChars = [opts.headline, opts.sub].filter(Boolean).reduce((a, t) => a + (String(t).length > 6 ? String(t).length : 0), 0);
  const orig = s.addText.bind(s);
  s.addText = (t, o) => {
    const str = typeof t === 'string' ? t : (Array.isArray(t) ? t.map((x) => (x && x.text) || '').join('') : '');
    if (str.length > 6) s._fvChars += str.length;
    return orig(t, o);
  };
  return s;
}

/** 小さなバッジ（PR / 公式 / 順位）。画像の上に重ねる */
function addBadge(s, { x, y, text, fill, color, w, h, size }) {
  const bw = w || Math.max(0.46, 0.16 + String(text).length * 0.17);
  const bh = h || 0.30;
  s.addShape('rect', { x, y, w: bw, h: bh, fill: { color: fill || T.color.chipDark }, line: { width: 0 } });
  s.addText(String(text), {
    x, y, w: bw, h: bh,
    fontFace: T.font.gothic, fontSize: size || 11, bold: true, color: color || 'FFFFFF',
    align: 'center', valign: 'middle', margin: 0,
  });
  return bw;
}

/**
 * 9:16 の投稿カバーを枠に収めて置く（縦横比は実寸から）。リンク付き。
 * 画像が無ければ何も置かず null を返す（生成画像やダミーで埋めない）。
 */
function addThumb(s, absPath, box, url) {
  if (!absPath) return null;
  const b = fitBox(absPath, box.x, box.y, box.w, box.h);
  s.addImage({ path: absPath, ...b, ...linkTo(url) });
  // 細い枠。クリーム地に明るいカバーが溶けるのを防ぐ
  s.addShape('rect', { ...b, fill: { type: 'none' }, line: { color: T.color.cardLine, width: 0.75 } });
  return b;
}

/** 点線の空枠（「まだ無し」）。自社の投稿が無いことを“画で”見せる */
function addEmptySlot(s, box, text) {
  s.addShape('rect', {
    ...box, fill: { color: T.color.cardBg },
    line: { color: T.color.subLight, width: 1.25, dashType: 'dash' },
  });
  s.addText(text || 'まだ無し', {
    ...box, fontFace: T.font.gothic, fontSize: 16, bold: true, color: T.color.subLight,
    align: 'center', valign: 'middle',
  });
}

module.exports = { S, addStorySlide, addStoryFooter, addBadge, addThumb, addEmptySlot, resetStory };
