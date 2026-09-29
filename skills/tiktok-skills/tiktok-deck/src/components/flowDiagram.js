// flowDiagram.js — 勝ちパターンの構成フロー（図形＋矢印。画像化しない）
const T = require('../theme');
const { isPlaceholderText } = require('../helpers/data');
const { fit } = require('../helpers/text');

/** steps: [{label, text}] を横一列のフローで描く */
function addFlowDiagram(slide, { x, y, w, h, steps, accent }) {
  const n = steps.length;
  if (!n) return;
  const gap = 0.26;
  const boxW = (w - gap * (n - 1)) / n;
  steps.forEach((st, i) => {
    const bx = x + i * (boxW + gap);
    slide.addShape('rect', {
      x: bx, y, w: boxW, h,
      fill: { color: T.color.cardBg }, line: { color: accent || T.color.cardLine, width: 1 },
    });
    slide.addText(st.label, {
      x: bx + 0.1, y: y + 0.07, w: boxW - 0.2, h: 0.24,
      fontFace: T.font.jp, fontSize: T.size.caption, bold: true, color: accent || T.color.accent,
      align: 'center',
    });
    const body = String(st.text);
    slide.addText(body, {
      x: bx + 0.1, y: y + 0.32, w: boxW - 0.2, h: h - 0.42,
      fontFace: T.font.jp,
      fontSize: fit(body, boxW - 0.2, h - 0.42, { base: T.size.bodySm, min: T.size.bodyMin }),
      color: isPlaceholderText(body) ? T.color.placeholder : T.color.text,
      align: 'center', valign: 'top',
    });
    if (i < n - 1) {
      slide.addShape('rightArrow', {
        x: bx + boxW + 0.04, y: y + h / 2 - 0.09, w: gap - 0.08, h: 0.18,
        fill: { color: T.color.divider }, line: { width: 0 },
      });
    }
  });
}

module.exports = { addFlowDiagram };
