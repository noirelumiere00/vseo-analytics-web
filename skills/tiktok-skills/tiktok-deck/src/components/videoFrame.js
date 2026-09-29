// videoFrame.js — TikTok縦画像の配置。無い場合は [IMAGE NOT PROVIDED] 枠を残す。
const T = require('../theme');
const { resolve, containBox } = require('../helpers/image');
const { PLACEHOLDER_IMAGE } = require('../helpers/data');
const { fitBox } = require('../helpers/imageBox');

/**
 * 9:16 を保って枠内に contain 配置する。画像が無ければプレースホルダ矩形。
 * caption を渡すと画像下にキャプションを出す。
 */
function addVideoFrame(slide, { x, y, w, h, path: p, caption, ratio, plain }) {
  const abs = resolve(p);
  const box = containBox(x, y, w, h, ratio || 9 / 16);

  if (abs) {
    if (!plain) {
      slide.addShape('rect', {
        x: box.x, y: box.y, w: box.w, h: box.h,
        fill: { color: 'FFFFFF' }, line: { color: T.color.cardLine, width: 0.75 },
        shadow: { type: 'outer', blur: 6, offset: 1, angle: 90, color: '000000', opacity: 0.12 },
      });
    }
    slide.addImage({ path: abs, ...fitBox(abs, box.x, box.y, box.w, box.h) });
  } else {
    if (!plain) {
      slide.addShape('rect', {
        x: box.x, y: box.y, w: box.w, h: box.h,
        fill: { color: 'FBFBFB' },
        line: { color: T.color.cardLine, width: 1, dashType: 'dash' },
      });
    }
    slide.addText(PLACEHOLDER_IMAGE, {
      x: box.x, y: box.y + box.h / 2 - 0.2, w: box.w, h: 0.4,
      fontFace: T.font.jp, fontSize: T.size.caption,
      color: plain ? T.color.darkSub : T.color.placeholder, align: 'center',
    });
  }

  if (caption) {
    slide.addText(String(caption), {
      x, y: y + h + 0.04, w, h: 0.24,
      fontFace: T.font.jp, fontSize: T.size.caption, color: T.color.sub, align: 'center',
    });
  }
  return box;
}

module.exports = { addVideoFrame };
