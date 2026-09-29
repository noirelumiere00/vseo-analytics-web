// comparisonTable.js — 罫線を最小にした一覧表。セルに横棒グラフを併記できる。
// 正式FMT：縦罫なし・ヘッダーの下に濃い罫・行間は広く・EG率のような比較値は数値＋細い横棒。
const T = require('../theme');
const { isPlaceholderText, stats } = require('../helpers/data');
const { estimateLines, fit, widthUnits } = require('../helpers/text');
const { linkTo } = require('../helpers/imageBox');

const LINE_H = 1.42;
const CELL_PAD = 0.22;
const MIN_CELL_FS = 9.5;     // 投影・印刷で読める下限。これ未満へは縮めない
const EMPH_RATIO = 1.6;      // 強調セル（棒付き・大字）が本文セルの何倍までか

/** 枠に入る分だけ残して省略する。字を潰さずに収めるための最後の手段 */
function truncateToBox(txt, wIn, hIn, sizePt) {
  if (estimateLines(txt, wIn, sizePt) * (sizePt * 1.3) / 72 <= hIn) return txt;
  const perLine = Math.max(1, Math.floor(widthUnits('あ') ? (wIn * 72) / (sizePt * 1.0) : 1));
  const lines = Math.max(1, Math.floor((hIn * 72) / (sizePt * 1.3)));
  const room = Math.max(6, perLine * lines - 1);
  let out = '';
  let u = 0;
  for (const ch of txt) {
    const w = widthUnits(ch);
    if (u + w > room) break;
    out += ch; u += w;
  }
  return out.length < txt.length ? out.replace(/[、。・\s]+$/, '') + '…' : txt;
}

function cellText(c) { return (c && typeof c === 'object') ? String(c.text) : String(c); }
function cellAlign(c) { return (c && typeof c === 'object' && c.align) || 'left'; }

function estimateRowHeight(row, colW, fontSize) {
  let maxLines = 1;
  row.forEach((c, i) => {
    // 行数の見積りは実描画より甘い（記号・数字の実寸が半角換算より広い）。
    // 甘いまま行高を決めると最終行が枠外へ出て、行区切りの罫線が文字を貫通する
    const usable = ((colW[i] || 1) - 0.18) * 0.93;
    maxLines = Math.max(maxLines, estimateLines(cellText(c), usable, fontSize));
  });
  return Math.max(0.44, (maxLines * fontSize * LINE_H) / 72 + CELL_PAD + 0.06);
}

/**
 * 手描きの表。cell は文字列、または
 *   {text, align, bold, big, sub, bar:{ratio, color}}
 */
function addDataTable(slide, { x, y, w, head, rows, colW: colW0, fontSize, rowH, headFontSize, maxH }) {
  // 列幅の合計は必ず表幅に一致させる。合わないと右端が枠外（実例列の下）へ流れる
  const sum = (colW0 || []).reduce((a, b) => a + b, 0);
  const colW = (sum > 0 && Math.abs(sum - w) > 0.01)
    ? colW0.map((c) => (c * w) / sum) : colW0;
  const fs = fontSize || T.size.table;
  const hfs = headFontSize || T.size.tableHead;
  let cx = x;
  head.forEach((c, i) => {
    slide.addText(cellText(c), {
      x: cx, y, w: colW[i], h: 0.40,
      fontFace: T.font.gothic, fontSize: hfs, color: T.color.sub,
      align: cellAlign(c), valign: 'middle',
    });
    cx += colW[i];
  });
  slide.addShape('line', {
    x, y: y + 0.46, w, h: 0, line: { color: T.color.rule, width: 1.0 },
  });

  let ry = y + 0.60;
  const drawn = [];
  let hadMissing = false;
  // 入り切らないときは行を落とさず、全行が収まる高さまで詰める（無言の欠落を作らない）
  const noteH = 0.32;
  // rowH は下限として扱う。固定値にすると内容の多い行が溢れ、行区切りの罫線が文字を貫通する
  const natural = rows.map((row) => Math.max(rowH || 0, estimateRowHeight(row, colW, fs)));
  const total = natural.reduce((a, b) => a + b, 0);
  // 1行の最小高。10ptの1行（約0.18in）＋上下の余白。ここを 0.40 に固定していたため
  // あと数分の1インチ足りずに Head 10 の下2行が落ちていた
  const ROW_FLOOR = 0.32;
  // 丸め誤差の許容。これが無いと 3.5399999999999996 > 3.5399999999999987 で
  // ちょうど収まるはずの最終行が落ちる（Head 10 が 9 行になっていた実害）
  const EPS = 1e-6;

  /** reserve だけ下を空けたときに、何行描けて行高はいくつになるかを返す */
  function solve(reserve) {
    const room = (maxH || Infinity) - (ry - y) - reserve;
    const sq = (Number.isFinite(room) && total > room && rows.length)
      ? Math.max(ROW_FLOOR, room / rows.length) : null;
    let cy = ry;
    let n = 0;
    for (const nat of natural) {
      const h = sq ? Math.min(nat, sq) : nat;
      if (Number.isFinite(room) && cy + h > y + (ry - y) + room + EPS) break;
      cy += h;
      n += 1;
    }
    return { sq, n, room };
  }
  // 「—は取得データに値が無い項目。」の注記は表の直下に出る。その高さを見込まずに
  // 表を組むと、列を1本足しただけで下の帯へ潜る（ある案件の p45-47 で発生）
  const willShowMissing = rows.some((row) => row.some((c) => {
    const o2 = (c && typeof c === 'object') ? c : { text: c };
    return isPlaceholderText(String(o2.text));
  }));
  const missH = willShowMissing ? 0.32 : 0;
  // 落とす行が無ければ行落ち注記は要らない。先に引くと、その 0.32in のせいで
  // 行が落ち、落ちたから注記が要る、という自己成就になる
  let plan = solve(missH);
  if (plan.n < rows.length) plan = solve(missH + noteH);
  const squeeze = plan.sq;
  const limit = maxH ? y + (ry - y) + plan.room : Infinity;

  // 列ごとに1つのフォントサイズへ揃える。行単位で fit させると同じ列で大小がバラつく
  const colFs = (colW || []).map((cwv, ci) => {
    let m = fs;
    rows.forEach((row, ri) => {
      const o = (row[ci] && typeof row[ci] === 'object') ? row[ci] : { text: row[ci] };
      if (o.big || (o.bar && typeof o.bar.ratio === 'number')) return;
      const t = isPlaceholderText(String(o.text)) ? '—' : String(o.text);
      const hh = (squeeze ? Math.min(natural[ri], squeeze) : natural[ri]) - 0.02;
      // ここは「列で揃える基準サイズ」を決める中間計算。実際の下限は MIN_CELL_FS で、
      // 収まらなければ後段の truncateToBox が実害として報告する。
      // この段で警告を出すと、最終的に収まった行まで警告に並んで本物が埋もれる
      m = Math.min(m, fit(t, cwv - 0.18, hh, { base: fs, min: 10, lineHeight: 1.3, quiet: true }));
    });
    return m;
  });

  rows.forEach((row, ri) => {
    const h = squeeze ? Math.min(natural[ri], squeeze) : natural[ri];
    if (ry + h > limit + EPS) return;    // 溢れる行は描かず、呼び出し側に残数を返す
    drawn.push(ri);
    let px = x;
    // 行内に棒付きセルがあるときは、行の全セルを同じ高さ基準にして数値の目線を揃える
    const rowHasBar = row.some((c) => c && typeof c === 'object' && c.bar && typeof c.bar.ratio === 'number');
    const cellH = h - (rowHasBar ? 0.22 : 0);
    // 強調セルの上限を決めるため、先に本文セルが実際に取るサイズを出しておく。
    // これを省くと本文が5pt・EG率が15ptのような4倍差になる（p19/p21/p62/p86で発生）
    const bodyFs = row.map((c, i) => {
      const o = (c && typeof c === 'object') ? c : { text: c };
      if (o.big || (o.bar && typeof o.bar.ratio === 'number')) return null;
      const cs = colFs[i] !== undefined ? colFs[i] : fs;
      return Math.min(cs, fit(String(o.text), colW[i] - 0.18, h - 0.14, { base: cs, min: MIN_CELL_FS, lineHeight: 1.3, quiet: true }));
    }).filter((v) => v !== null);
    const rowBodyFs = bodyFs.length ? Math.min(...bodyFs) : fs;
    row.forEach((c, i) => {
      const o = (c && typeof c === 'object') ? c : { text: c };
      let txt = String(o.text);
      if (isPlaceholderText(txt)) { txt = '—'; hadMissing = true; }   // 表内は記号。注記で正式表記を出す
      const cw = colW[i];
      const hasBar = !!(o.bar && typeof o.bar.ratio === 'number');
      const tH = cellH;
      // 列単位のサイズは下限に張り付くことがあり、そのまま置くと本文が行から溢れて
      // 隣の行や列見出しに重なる。この1セルが実際に収まるサイズまで individually 落とす
      const colSize = colFs[i] !== undefined ? colFs[i] : fs;
      let cellSize = (o.big || hasBar)
        ? colSize
        : Math.min(colSize, fit(txt, cw - 0.18, h - 0.14, { base: colSize, min: MIN_CELL_FS, lineHeight: 1.3, quiet: true }));
      // MIN_CELL_FS でも収まらない長文は、縮めるのでなく落として省略記号にする。
      // 読めない字で全文を出すより、読める字で要点を出すほうが提出物として正しい
      if (!o.big && !hasBar) {
        const kept = truncateToBox(txt, cw - 0.18, h - 0.14, cellSize);
        // 黙って切ると、打ち手の結論だけが消えたページが検知されないまま提出される
        if (kept !== txt) {
          stats.qaFixes.push(`表セルを${txt.length - kept.length + 1}字分切り詰めた: "${txt.slice(0, 24)}…"`);
        }
        txt = kept;
      }
      slide.addText(txt, {
        x: px, y: ry, w: cw - 0.18, h: tH,
        fontFace: T.font.gothic,
        fontSize: o.big ? Math.min(T.size.tableBig, rowBodyFs * EMPH_RATIO)
          : hasBar ? Math.min(fs, rowBodyFs * EMPH_RATIO)   // 棒付き＝短い数値。本文と離しすぎない
          : cellSize,
        bold: !!o.bold || !!o.big,
        color: txt === '—' ? T.color.placeholder : (o.color || T.color.text),
        align: o.align || 'left', valign: 'middle',
        // 元投稿URLがあるセルはハイパーリンク＋下線を張る。表の行から直接開けないと
        // 「どの投稿の話か」を読み手が自分で検索し直す羽目になる
        ...(o.url ? { ...linkTo(o.url), underline: true } : {}),
      });
      if (o.sub) {
        slide.addText(o.sub, {
          x: px + 0.02, y: ry, w: cw - 0.18, h: tH,
          fontFace: T.font.gothic, fontSize: T.size.captionSm, color: T.color.sub,
          align: o.align || 'left', valign: 'middle',
        });
      }
      if (hasBar) {
        // テキストボックスの既定インセット分ずらして、数値の左端とバーの左端を揃える
        const bx = px + 0.10;
        const bw = Math.min(cw - 0.40, 1.95);
        // 数値の直下に置く。高さは「実際に使ったフォントサイズ」から出す。
        // 固定値だと行高が小さい表でバーが次の行へ落ちる
        const numFs = Math.min(o.big ? T.size.tableBig : fs, rowBodyFs * EMPH_RATIO);
        const numH = Math.min(cellH, (numFs * 1.35) / 72);
        const BH = 0.085;
        // どんな行高でも行の内側に収める
        const by = Math.min(ry + (cellH - numH) / 2 + numH + 0.05, ry + h - BH - 0.05);
        slide.addShape('rect', {
          x: bx, y: by, w: bw, h: BH,
          fill: { color: T.color.track }, line: { width: 0 },
        });
        const r = Math.max(0, Math.min(1, o.bar.ratio));
        if (r > 0) {
          slide.addShape('rect', {
            x: bx, y: by, w: Math.max(0.05, bw * r), h: BH,
            fill: { color: o.bar.color || T.brandColors[0] }, line: { width: 0 },
          });
        }
      }
      px += cw;
    });
    ry += h;
    if (ri < rows.length - 1 && ry + (rowH || 0.5) <= limit) {
      slide.addShape('line', {
        x, y: ry - 0.06, w, h: 0, line: { color: T.color.ruleThin, width: 0.75 },
      });
    }
  });
  slide.addShape('line', { x, y: ry, w, h: 0, line: { color: T.color.rule, width: 1.0 } });
  if (hadMissing) {
    slide.addText('—は取得データに値が無い項目。', {
      x, y: ry + 0.06, w, h: 0.26,
      fontFace: T.font.gothic, fontSize: T.size.captionSm, color: T.color.subLight, valign: 'top',
    });
    ry += 0.32;
  }
  return { height: ry - y, drawn: drawn.length, dropped: rows.length - drawn.length, hadMissing };
}

/** ページ分割（行数が多いとき） */
function paginateRows(head, rows, colW, fontSize, capacityIn) {
  const headH = 0.60;
  const pages = [];
  let cur = []; let h = headH;
  for (const r of rows) {
    const rh = estimateRowHeight(r.cells || r, colW, fontSize);
    if (cur.length && h + rh > capacityIn) { pages.push(cur); cur = []; h = headH; }
    cur.push(r); h += rh;
  }
  if (cur.length) pages.push(cur);
  return pages;
}

module.exports = { addDataTable, addComparisonTable: addDataTable, estimateRowHeight, paginateRows };
