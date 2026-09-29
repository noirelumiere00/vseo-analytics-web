// text.js — 文字量に応じたフォント段階縮小（DESIGN.md §9：詰め込まない）
const T = require('../theme');
const { stats } = require('./data');

/** 全角=1.0 / 半角=0.55 として文字幅の総量を返す */
function widthUnits(s) {
  let u = 0;
  for (const ch of String(s)) u += /[\x00-\x7F]/.test(ch) ? 0.55 : 1;
  return u;
}

/** 明示改行を考慮して、指定フォントサイズでの行数を見積もる */
function estimateLines(text, boxWIn, sizePt) {
  const usablePt = Math.max(1, (boxWIn - 0.16) * 72);
  const perLine = Math.max(1, usablePt / sizePt); // 全角換算で1行に入る量
  return String(text)
    .split('\n')
    .reduce((acc, line) => acc + Math.max(1, Math.ceil(widthUnits(line) / perLine)), 0);
}

// PowerPoint の lineSpacingMultiple は「フォント固有の行高」に対する倍率。
// ヒラギノ角ゴ/明朝の行高は約1.30em なので、実際の行送り = フォントサイズ × 倍率 × 1.30。
// これを掛け忘れると必要な高さを約3割少なく見積もり、本文が箱を突き抜ける。
const JP_LINE = 1.30;

/** 指定サイズ・倍率でその本文が占める高さ（インチ） */
function blockHeight(text, boxWIn, sizePt, spacing = 1.0) {
  return (estimateLines(text, boxWIn, sizePt) * sizePt * spacing * JP_LINE) / 72;
}

/**
 * ボックスに収まる最大のフォントサイズを返す（行数ベース）。
 * 下限でも収まらない場合は QA ログへ記録する（無言で潰さない）。
 */
function fit(text, boxWIn, boxHIn, opts = {}) {
  const base = opts.base || T.size.body;
  const min = opts.min || T.size.bodyMin;
  const lh = (opts.lineHeight || 1.55) * JP_LINE;
  const hPt = boxHIn * 72;
  for (let size = base; size >= min; size -= 0.5) {
    if (estimateLines(text, boxWIn, size) * size * lh <= hPt) return size;
  }
  // 呼び出し側がこの後 truncateToBox で確実に切り詰める場合は警告しない。
  // 「収まらない可能性」を出すと、実際には溢れていないものが不具合として並ぶ
  if (!opts.quiet) {
    stats.qaFixes.push(
      `本文が下限${min}ptでも収まらない可能性: "${String(text).replace(/\n/g, ' ').slice(0, 30)}…"`
    );
  }
  return min;
}

/** 箇条書き用に prefix を付けた文字列にする */
function bullets(list, mark = '・') {
  return (list || []).map((v) => `${mark}${v}`).join('\n');
}


// 括弧の対応表。開いたまま切ると「…（いずれも isAd と #PRタグ の和集合。」のような
// 閉じない文が紙面に出る（p13 で実際に出た）
const OPENERS = '（(「『【〈《［[｛{';
const CLOSERS = '）)」』】〉》］]｝}';

/** 括弧の外にある「。」だけを文末とみなして分割する */
function splitSentences(t) {
  const out = [];
  let buf = '';
  let depth = 0;
  for (const ch of t) {
    buf += ch;
    if (OPENERS.includes(ch)) depth += 1;
    else if (CLOSERS.includes(ch)) depth = Math.max(0, depth - 1);
    else if (ch === '。' && depth === 0) { out.push(buf); buf = ''; }
  }
  if (buf) out.push(buf);
  return out;
}

/** 結論の補足行。予算内に収まる「最後の完結した文」で切る（語尾が欠けないように）。
 *  括弧の内側の「。」では切らない。切ると但し書きが半分だけ残って意味が反転する
 *  （あるブランドの 48.3% で「isAdは0本」が消え「投稿の半分が広告」に読めた）。
 *  1文目だけで予算を超える場合も、文を途中で切らずにそのまま返す。
 *  入り切らない分は呼び出し側がフォントで吸収する */
function subSentences(text, budget = 120) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (t.length <= budget) return t;
  const parts = splitSentences(t);
  let out = '';
  for (const p of parts) {
    if (out && (out + p).length > budget) break;
    out += p;
  }
  return out || parts[0];
}


/** fit と同じだが、最終行が数文字だけの「孤立行」になるサイズを避ける（見出し用） */
function fitBalanced(text, boxWIn, boxHIn, opts = {}) {
  const base = opts.base || T.size.body;
  const min = opts.min || T.size.bodyMin;
  const minTail = opts.minTail || 5;
  const lh = (opts.lineHeight || 1.55) * JP_LINE;
  const hPt = boxHIn * 72;
  const total = widthUnits(text);
  // 見積りは実描画より約8%甘い（記号・数字の実寸が半角換算より広い）。見出しは安全側で計算する
  const safety = opts.safety || 0.92;
  let firstFit = null;
  for (let size = base; size >= min; size -= 0.5) {
    const perLine = Math.max(1, ((boxWIn - 0.16) * 72 * safety) / size);
    const lines = Math.max(1, Math.ceil(total / perLine));
    if (lines * size * lh > hPt) continue;
    if (firstFit === null) firstFit = size;
    if (lines <= 1) return size;
    const tail = total - perLine * (lines - 1);
    if (tail >= minTail) return size;          // 最終行に十分な文字が残る
  }
  return firstFit !== null ? firstFit : min;
}


/** 1本の文章を「結論（1文目）＋補足（残り全部）」に分ける。
 *  括弧の内側の「。」では切らない。素の split('。') だと
 *  「（…和集合。あるブランドの…）」のような但し書きが途中で割れる。
 *  補足はここでは詰めない。実際に入る量への切り詰めと、その記録は
 *  slideBase 側の1か所だけで行う（カット地点が散ると記録漏れが出る） */
function leadAndSub(text) {
  const t = String(text || '').trim();
  if (!t) return {};
  const parts = splitSentences(t);
  return { conclusion: parts[0], conclusionSub: parts.slice(1).join('') || undefined };
}

module.exports = { fit, bullets, estimateLines, widthUnits, blockHeight, JP_LINE, subSentences, fitBalanced, splitSentences, leadAndSub};
