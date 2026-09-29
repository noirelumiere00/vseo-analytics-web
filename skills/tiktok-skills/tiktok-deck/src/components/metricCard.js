// metricCard.js — ブランドカード（横棒つきの数値）と、動画個別ページのモジュール
// 正式FMT：薄い枠のカード内に「ラベル … 大きな数値」＋その下に横棒。比較する2値を上下に置く。
const T = require('../theme');
const { isPlaceholderText } = require('../helpers/data');
const { fit } = require('../helpers/text');

/** ブランド見出し（■色＋ブランド名＋補足） */
function addBrandHeading(slide, { x, y, w, name, sub, color }) {
  slide.addShape('rect', { x, y: y + 0.10, w: 0.17, h: 0.17, fill: { color }, line: { width: 0 } });
  slide.addText(name, {
    x: x + 0.30, y, w: w - 0.30, h: 0.40,
    fontFace: T.font.gothic, fontSize: T.size.metricLabel + 3, bold: true, color: T.color.text, valign: 'middle',
  });
  if (sub) {
    slide.addText(sub, {
      x: x + 0.30, y: y + 0.46, w: w - 0.30, h: 0.34,
      fontFace: T.font.gothic, fontSize: T.size.caption, color: T.color.sub, valign: 'middle',
    });
  }
}

/** ラベル＋大きな数値＋横棒。ratio は 0〜1。 */
function addBarMetric(slide, { x, y, w, label, value, ratio, color, dim }) {
  // ラベルは 0.46in の箱に必ず収める。固定サイズだと母数付き（「…平均EG率（1本）」）で
  // 3行に折り返し、はみ出した3行目を直下の棒グラフが潰す
  const LABEL_W = w * 0.55;
  slide.addText(label, {
    x, y, w: LABEL_W, h: 0.46,
    fontFace: T.font.gothic,
    fontSize: fit(label, LABEL_W, 0.46, { base: T.size.metricLabel, min: 9.5, lineHeight: 1.25 }),
    color: T.color.sub, valign: 'middle',
  });
  const v = String(value);
  // 「12.3%」のような数値だけを大きく出す。説明文（該当なし等）は本文サイズで1行に収める。
  const isNumeric = /^[\d,.]+%?$/.test(v.trim());
  slide.addText(v, {
    x: x + w * 0.38, y: y - 0.06, w: w * 0.62, h: 0.60,
    fontFace: T.font.gothic,
    fontSize: (isPlaceholderText(v) || !isNumeric)
      ? fit(v, w * 0.62, 0.58, { base: T.size.bodySm, min: 9, lineHeight: 1.15 })
      : fit(v, w * 0.62, 0.60, { base: T.size.metricBig, min: 14, lineHeight: 1.05 }),
    bold: isNumeric,
    color: isPlaceholderText(v) ? T.color.placeholder : (dim || !isNumeric ? T.color.sub : color),
    align: 'right', valign: 'middle', wrap: !isNumeric,
  });
  const by = y + 0.62;
  slide.addShape('rect', { x, y: by, w, h: 0.10, fill: { color: T.color.track }, line: { width: 0 } });
  const r = Math.max(0, Math.min(1, ratio || 0));
  if (r > 0) {
    slide.addShape('rect', {
      x, y: by, w: Math.max(0.06, w * r), h: 0.10,
      fill: { color: dim ? T.color.subLight : color }, line: { width: 0 },
    });
  }
}

/** 動画個別ページのモジュール（■色＋見出し＋本文） */
function addModule(slide, { x, y, w, h, label, body, accent, labelAccent, bodySize }) {
  slide.addShape('rect', { x, y: y + 0.09, w: 0.14, h: 0.14, fill: { color: accent || T.color.text }, line: { width: 0 } });
  slide.addText(label, {
    x: x + 0.26, y, w: w - 0.26, h: 0.34,
    fontFace: T.font.gothic, fontSize: T.size.moduleLabel, bold: true,
    color: labelAccent || T.color.text, valign: 'middle',
  });
  const b = String(body);
  slide.addText(b, {
    x: x + 0.26, y: y + 0.40, w: w - 0.26, h: h - 0.40,
    fontFace: T.font.gothic,
    fontSize: bodySize || fit(b, w - 0.26, h - 0.40, { base: T.size.moduleBody, min: 9.5, lineHeight: 1.55 }),
    color: isPlaceholderText(b) ? T.color.placeholder : T.color.text,
    valign: 'top', lineSpacingMultiple: 1.42,
  });
}

/** 薄枠のカード */
function addCard(slide, { x, y, w, h }) {
  slide.addShape('rect', {
    x, y, w, h,
    fill: { color: T.color.cardBg }, line: { color: T.color.cardLine, width: 1 },
  });
}

/** ラベル／値の1行 */
function addKeyValueRow(slide, { x, y, wLabel, wValue, label, value, h, color }) {
  const rh = h || 0.46;
  slide.addText(label, {
    x, y, w: wLabel, h: rh,
    fontFace: T.font.gothic, fontSize: T.size.metricLabel, color: T.color.sub, valign: 'middle',
  });
  const v = String(value);
  slide.addText(v, {
    x: x + wLabel, y, w: wValue, h: rh,
    fontFace: T.font.gothic,
    fontSize: fit(v, wValue, rh, { base: T.size.table, min: 10, lineHeight: 1.2 }),
    bold: true, color: isPlaceholderText(v) ? T.color.placeholder : (color || T.color.text),
    valign: 'middle',
  });
}

module.exports = { addBrandHeading, addBarMetric, addModule, addCard, addKeyValueRow, addMetricCard: addCard };
