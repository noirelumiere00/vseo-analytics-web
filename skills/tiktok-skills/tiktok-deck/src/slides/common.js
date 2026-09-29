// common.js — スライド生成で共有する寸法・色・小道具
// 正式FMT準拠：本体は左、右端に幅3.05inの「実例」列を必ず確保する。
const path = require('path');
const T = require('../theme');
const D = require('../helpers/data');
const { resolve } = require('../helpers/image');

const { caseRoot } = require('../helpers/caseRoot');
const ROOT = caseRoot();

// QA警告の配列は helpers/data と共有する。別配列にすると、そちら側へ積まれた警告
// （本文が下限ptでも収まらない・表セルを切り詰めた・KW表の行落ち）がログに出ず、
// 「警告ゼロ」を根拠に問題なしと判断してしまう
const stats = { slides: 0, missingData: 0, missingImage: 0, images: 0,
  missingImageList: [], undeclaredImages: [], qaFixes: D.stats.qaFixes };

const EX_W = 3.05;                          // 右端の実例列
const MAIN_W = T.content.w - EX_W - 0.55;   // 本体側

// 色は7色。剰余で回すと8社目が1色目（自社の赤）に戻り、他社が自社に見える
// （theme.js が避けたいと書いている事象そのもの）。8社目以降は識別色を持たない灰にし、QA に1行残す
// （フラグで1回にすると、試し組みの後に QA を巻き戻すため本番のログから消える）
function brandColor(i) {
  const n = T.brandColors.length;
  if (i < n) return T.brandColors[i];
  const msg = `ブランド・面が${n}を超えたため、${n + 1}番目以降は識別色の無い灰色で描いた（色で区別できない）`;
  if (!stats.qaFixes.includes(msg)) stats.qaFixes.push(msg);
  return T.color.bar;
}

// 絵文字は明朝・ゴシックに字形が無く、書き出すと豆腐（□）になる。表示名からは落とす。
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FFFD}]/gu;
// 数学用英数字記号（𝓡𝓲𝓷 等）は明朝・ゴシックに字形が無く、1文字だけ書体が飛ぶ。通常文字へ寄せる
function normalizeFancy(str) {
  return String(str).replace(/[\u{1D400}-\u{1D7FF}]/gu, (ch) => {
    const d = ch.normalize('NFKC');
    return /^[A-Za-z0-9]$/.test(d) ? d : ch;
  });
}

function clip(s, n) {
  const t = normalizeFancy(s).replace(EMOJI, '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  let cut = t.slice(0, n);
  // 括弧を開いたまま切ると「成分オタクちゃん【美容・スキンケ…」のように閉じない。開いた位置まで戻す
  const PAIRS = [['「', '」'], ['（', '）'], ['(', ')'], ['【', '】'], ['『', '』'], ['［', '］']];
  for (const [o, c] of PAIRS) {
    while (cut.split(o).length - 1 > cut.split(c).length - 1) {
      cut = cut.slice(0, cut.lastIndexOf(o)).trimEnd();
    }
  }
  return cut ? `${cut}…` : `${t.slice(0, n)}…`;
}

/** 「1.24%」→1.24。読めなければ null。 */
function pctNum(s) {
  const m = String(s).match(/-?[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}

/** 画像を解決する。無ければ欠損として数える（AI生成での穴埋めはしない）。 */
function img(p) {
  const r = resolve(p, ROOT);
  if (r) { stats.images += 1; return r; }
  stats.missingImage += 1;
  // 件数だけでは「どれが出ていないか」が分からず直しようがない。
  // 実際に出荷済みの資料で3枚が欠けたまま、誰も特定できなかった
  // 2種類を混ぜない。
  //   宣言があるのに実体が無い = 誰かがファイルを動かした。直さないと紙面が崩れる
  //   宣言そのものが無い       = その欄を使わない案件。ページは想定どおり組まれる
  // 混ぜて「重大」にすると、正常な案件が提出できなくなる
  const at = (new Error().stack || '').split('\n')[2] || '';
  const where = (at.match(/src\/(.+?:\d+)/) || [, '不明'])[1];
  if (D.isPlaceholderText(String(p)) || !p) {
    stats.undeclaredImages.push(where);
  } else {
    stats.missingImageList.push(`${p} ← ${where}`);
  }
  return null;
}

/** 最大値を1とする比率。棒グラフの長さに使う。 */
function ratioOf(v, max) {
  if (v === null || v === undefined || Number.isNaN(v) || !max || max <= 0) return 0;
  return Math.max(0, Math.min(1, v / max));
}

/** Q1の実例（そのブランドの再生TOP1）をサムネ＋キャプションにする */
function exampleOf(b) {
  const e = (b.q1 && b.q1.example) || {};
  const cap = `${D.name(e.creator)}\nフォロワー${D.val(e.followers)}／${D.val(e.views)}再生・EG${D.val(e.eg)}`;
  return { image: img(e.image_path), caption: cap, url: e.url };
}

function pageSuffix(chunks, i) {
  return chunks.length > 1 ? `（${i + 1}/${chunks.length}）` : '';
}

function countMissing(o) {
  const seen = new Set();
  (function walk(x) {
    if (x === null || x === undefined) return;
    if (typeof x === 'string') { if (x.includes(D.PLACEHOLDER_DATA)) stats.missingData += 1; return; }
    if (typeof x !== 'object' || seen.has(x)) return;
    seen.add(x);
    Object.values(x).forEach(walk);
  })(o);
}

module.exports = {
  ROOT, stats, EX_W, MAIN_W,
  brandColor, clip, pctNum, img, ratioOf, exampleOf, pageSuffix, countMissing,
};
