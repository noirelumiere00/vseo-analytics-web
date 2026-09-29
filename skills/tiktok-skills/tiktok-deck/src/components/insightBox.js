// insightBox.js — 下部の結論帯（黒チップ＋本文）と、ブランド色チップ
// 正式FMT：細い罫の下に「発見」「結論」の黒い小チップ、右に本文（明朝でなくゴシック）。
const T = require('../theme');
const { isPlaceholderText } = require('../helpers/data');
const { fit, blockHeight } = require('../helpers/text');
// 明朝・ゴシックに字形が無い絵文字は書き出すと豆腐になるため、キャプションからも落とす
const EMOJI_CAP = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}\u{FFFD}]/gu;
const { fitBox, linkTo } = require('../helpers/imageBox');

/** その本文を置いたとき、結論帯が占める高さ（罫線を含まない） */
function insightHeight(text, opts = {}) {
  const w = opts.w !== undefined ? opts.w : T.content.w;
  const chipW = opts.chipW || 1.15;
  const need = 0.34 + blockHeight(String(text), w - chipW - 0.42, T.size.band, 1.45);
  return Math.min(opts.maxH || 3.40, Math.max(opts.h || 1.05, need));
}

/** 下部の結論帯。label は黒チップ、本文はその右。 */
function addInsightBox(slide, text, opts = {}) {
  const label = opts.label || '発見';
  const x = opts.x !== undefined ? opts.x : T.margin.l;
  const w = opts.w !== undefined ? opts.w : T.content.w;
  // 本文の行数から必要な高さを出し、指定値と大きい方を採る（溢れさせない）
  const chipW0 = opts.chipW || 1.15;
  const need = 0.34 + blockHeight(String(text), w - chipW0 - 0.42, T.size.band, 1.45);
  const h = Math.min(opts.maxH || 3.40, Math.max(opts.h || 1.05, need));
  const y = opts.y !== undefined ? opts.y : (T.content.bottom - h);
  const body = String(text);

  if (opts.rule !== false) {
    slide.addShape('line', {
      x, y: y - 0.16, w, h: 0, line: { color: T.color.ruleThin, width: 0.9 },
    });
  }
  const chipW = chipW0;
  slide.addShape('rect', {
    x, y: y + 0.04, w: chipW, h: 0.40,
    fill: { color: opts.chipColor || T.color.chipDark }, line: { width: 0 },
  });
  slide.addText(label, {
    x, y: y + 0.04, w: chipW, h: 0.40,
    fontFace: T.font.gothic, fontSize: T.size.bandLabel, bold: true, color: 'FFFFFF',
    align: 'center', valign: 'middle', charSpacing: 1,
  });
  const bx = x + chipW + 0.42;
  const bw = w - chipW - 0.42;
  slide.addText(body, {
    x: bx, y, w: bw, h,
    fontFace: T.font.gothic,
    fontSize: fit(body, bw, h - 0.12, { base: T.size.band, min: 9, lineHeight: 1.45 }),
    color: isPlaceholderText(body) ? T.color.placeholder : T.color.text,
    valign: 'top', lineSpacingMultiple: 1.45,
  });
}

/** ブランド色ベタのチップ（EG率・本質1行のラベルなど） */
function addAccentChip(slide, { x, y, w, h, text, color, invert }) {
  slide.addShape('rect', {
    x, y, w, h,
    fill: { color: invert ? T.color.cardBg : color },
    line: invert ? { color: T.color.cardLine, width: 1 } : { width: 0 },
  });
  slide.addText(text, {
    x, y, w, h,
    fontFace: T.font.gothic, fontSize: T.size.chip, bold: true,
    color: invert ? T.color.text : 'FFFFFF',
    align: 'center', valign: 'middle',
  });
}

/** 右端の「実例」列：見出し＋9:16画像＋キャプション */
function addExampleColumn(slide, { x, y, w, imgH, title, image, caption, missingText, bottom, brand, color, url }) {
  // 下端が指定されたら、画像とキャプションをその内側に必ず収める
  if (bottom) {
    const capH0 = caption ? 1.05 : 0;
    const room = bottom - (y + (brand ? 0.68 : 0.42)) - capH0 - 0.16;
    if (room > 0.8 && room < imgH) imgH = room;
  }
  slide.addText(title || '実例', {
    x, y, w, h: 0.34,
    fontFace: T.font.gothic, fontSize: T.size.moduleLabel, bold: true, color: T.color.text,
  });
  if (brand) {
    if (color) {
      slide.addShape('rect', { x, y: y + 0.36, w: 0.14, h: 0.20, fill: { color }, line: { width: 0 } });
    }
    slide.addText(brand, {
      x: x + (color ? 0.22 : 0), y: y + 0.32, w: w - (color ? 0.22 : 0), h: 0.28,
      fontFace: T.font.gothic, fontSize: T.size.captionSm, bold: true,
      color: color || T.color.sub, valign: 'middle',
    });
  }
  const iy = y + (brand ? 0.68 : 0.42);
  const iw = Math.min(w, (imgH * 9) / 16);
  if (image) {
    slide.addImage({ path: image, ...fitBox(image, x, iy, iw, imgH, 'left'), ...linkTo(url) });
  } else {
    slide.addShape('rect', {
      x, y: iy, w: iw, h: imgH,
      fill: { color: T.color.cardBg }, line: { color: T.color.cardLine, width: 1 },
    });
    slide.addText(missingText || '[IMAGE NOT PROVIDED]', {
      x, y: iy, w: iw, h: imgH,
      fontFace: T.font.gothic, fontSize: T.size.captionSm, color: T.color.placeholder,
      align: 'center', valign: 'middle',
    });
  }
  if (caption) {
    caption = String(caption).replace(EMOJI_CAP, '');
    const capY = iy + imgH + 0.14;
    const capH = bottom ? Math.max(0.55, Math.min(1.05, bottom - capY - 0.08)) : 1.05;
    slide.addText(caption, {
      x, y: capY, w, h: capH,
      fontFace: T.font.gothic,
      fontSize: fit(caption, w, capH, { base: T.size.caption, min: 8, lineHeight: 1.42 }),
      color: T.color.text, valign: 'top', lineSpacingMultiple: 1.3,
    });
  }
}

/** 補助：薄い下地の帯（実例の並びなど） */
function addExampleStrip(slide, { x, y, w, h, label, body }) {
  slide.addShape('rect', { x, y, w, h, fill: { color: T.color.cardBg }, line: { color: T.color.cardLine, width: 1 } });
  slide.addText(label, {
    x: x + 0.24, y: y + 0.10, w: 1.8, h: 0.32,
    fontFace: T.font.gothic, fontSize: T.size.bandLabel, bold: true, color: T.color.sub,
  });
  slide.addText(String(body), {
    x: x + 2.10, y: y + 0.08, w: w - 2.34, h: h - 0.18,
    fontFace: T.font.gothic,
    fontSize: fit(String(body), w - 2.34, h - 0.18, { base: T.size.bodySm, min: 9.5, lineHeight: 1.5 }),
    color: isPlaceholderText(String(body)) ? T.color.placeholder : T.color.text,
    valign: 'middle', lineSpacingMultiple: 1.35,
  });
}

module.exports = { addInsightBox, insightHeight, addAccentChip, addExampleColumn, addExampleStrip };
