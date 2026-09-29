// image.js — 画像解決（BUILD_SPEC.md §3-§5）。生成画像による穴埋めは行わない。
const fs = require('fs');
const path = require('path');
const { isMissing, stats } = require('./data');

const { caseRoot } = require('./caseRoot');
const ROOT = caseRoot();

/** 相対パスをプロジェクトルート基準で解決し、実在するときだけ返す */
function resolve(p) {
  if (isMissing(p)) {
    stats.missingImages += 1;
    // 件数だけでは「どれが出ていないか」が分からず、直しようがない。
    // 実際に出荷済みの資料で3枚が欠けたまま、誰も特定できない状態だった
    stats.missingImageList = stats.missingImageList || [];
    stats.missingImageList.push('（パス未宣言）');
    return null;
  }
  const abs = path.isAbsolute(p) ? p : path.join(ROOT, p);
  if (!fs.existsSync(abs)) {
    stats.missingImages += 1;
    stats.missingImageList = stats.missingImageList || [];
    stats.missingImageList.push(p);
    return null;
  }
  stats.imagesUsed += 1;
  return abs;
}

/** 9:16 を保ったまま枠に収める（contain）。枠内で中央寄せした矩形を返す */
function containBox(x, y, w, h, ratio = 9 / 16) {
  let dw = w;
  let dh = dw / ratio;
  if (dh > h) {
    dh = h;
    dw = dh * ratio;
  }
  return { x: x + (w - dw) / 2, y: y + (h - dh) / 2, w: dw, h: dh };
}

module.exports = { resolve, containBox, ROOT };
