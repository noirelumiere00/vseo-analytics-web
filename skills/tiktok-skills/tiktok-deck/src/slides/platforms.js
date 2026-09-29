// platforms.js — 他プラットフォームの発信実態（X／Instagram／YouTube など）
// TikTok検索面の分析に、別の面での語られ方を1枚で並べるための汎用ページ。
// プラットフォーム名をコードに焼き込まない（INPUT の `# OTHER PLATFORMS` から読む）。
//
// このページの原則:
//   反応量（いいね・RT）が取得できないプラットフォームがある。
//   取れないものは coverage_note に「取れない」と書き、紙面にも出す。
//   数字が無いページは「型の記述」であって「比較」ではない、と明示する。
const T = require('../theme');
const D = require('../helpers/data');
const { val } = D;
const { addSlide } = require('../components/slideBase');
const { leadAndSub } = require('../helpers/text');
const { addInsightBox, insightHeight } = require('../components/insightBox');
const { addDataTable } = require('../components/comparisonTable');
const C = require('./common');

const { brandColor } = C;
// 中扉の番号は章の並びで変わるので generate.js が partTag で渡す。渡されないときの既定
const PART = 'PART — 他プラットフォームの発信実態';

/** 投稿URLを、辿れる情報を落とさずに短くする。
 *  https://x.com/foo/status/123 → @foo／123 */
function shortUrl(u) {
  const t = String(u).trim();
  if (!t || D.isPlaceholderText(t)) return t;
  const m = t.match(/^https?:\/\/(?:www\.|mobile\.)?[^/]+\/([^/]+)\/status(?:es)?\/(\d+)/);
  if (m) return `@${m[1]}／${m[2]}`;
  return t.replace(/^https?:\/\//, '');
}

/** 表に使える高さ（下の帯とフッターに触れない） */
function tableRoom(text, opts) {
  return T.content.bottom - insightHeight(text, opts || {}) - 0.34 - T.content.top;
}

/** 「型」の一覧ページ。実例URLはそのまま載せる（出典を辿れないと検証できない） */
function slidePlatform(pptx, p, pi, footer, partTag) {
  const name = val(p.name);
  const summary = val(p.summary);
  const s = addSlide(pptx, {
    qLabel: `他面${pi + 1}`,
    title: `${name}｜どんな発信がされているか`,
    partTag: partTag || PART,
    ...(D.isPlaceholderText(summary) ? {} : leadAndSub(summary)),
    lead: val(p.purpose),
    accent: brandColor(0), footerLeft: footer,
  });

  // 発見帯には、この面で言えることと「言えないこと」を必ず並べる
  const body = [val(p.insight), val(p.limits)]
    .filter((t) => t && !D.isPlaceholderText(t)).join('\n');
  const opt = { label: '発見', h: 1.35, maxH: 2.40 };

  // table() は {head, rows}。見出しはデータ側が持つので、そのまま使う
  const tt = p.postTypes || {};
  const types = tt.rows || [];
  if (!types.length) return null;
  const head = tt.head || ['発信の型', '何が投稿されているか', '実例（投稿URL）'];
  // 列数は表の見出しに合わせる。3列に固定していたため、4列の表で4列目の見出しがスライドの外
  // （右端33.85in）に置かれ、データの4列目は黙って捨てられていた。
  // 既定の3列の比率（型:中身:URL = 3.10:7.00:4.00）を保ち、4列目以降は残り幅を等分する
  const nCol = Math.max(3, head.length, ...types.map((r) => r.length));
  const baseW = [3.10, 7.00, 4.00];
  const extraW = nCol > 3 ? 2.40 : 0;
  const scale = (T.content.w - 0.20 - extraW * (nCol - 3)) / baseW.reduce((a, b) => a + b, 0);
  const colW = [...baseW.map((w) => w * Math.min(1, scale)), ...Array(nCol - 3).fill(extraW)];
  const rows = types.map((r) => Array.from({ length: nCol }, (_, i) => (
    // 3列目は実例URL。URLは省略記号で切ると辿れなくなる（＝出典として無効になる）。
    // ドメインと /status/ を落として「@アカウント／投稿ID」に畳み、全文を残す
    i === 2 ? { text: shortUrl(val(r[i])) } : val(r[i]))));
  addDataTable(s, {
    x: T.margin.l, y: T.content.top, w: T.content.w, head, rows, colW,
    maxH: tableRoom(body, opt),
  });

  if (body) addInsightBox(s, body, opt);
  return s;
}

/** 公式アカウントの有無と発信の型。「誰が出ていないか」が読みどころなので全社出す */
function slidePlatformAccounts(pptx, p, pi, footer, partTag) {
  const name = val(p.name);
  const at = p.accounts || {};
  const accounts = at.rows || [];
  if (!accounts.length) return null;
  const concl = val(p.accounts_conclusion);
  const s = addSlide(pptx, {
    qLabel: `他面${pi + 1}b`,
    title: `${name}｜各社の公式アカウント`,
    partTag: partTag || PART,
    ...(D.isPlaceholderText(concl) ? {} : leadAndSub(concl)),
    accent: brandColor(0), footerLeft: footer,
  });
  const body = [val(p.accounts_insight), val(p.coverage_note)]
    .filter((t) => t && !D.isPlaceholderText(t)).join('\n');
  const opt = { label: '調査範囲', h: 1.35, maxH: 2.60 };
  // こちらも列数は表に合わせる（3列固定だと4列目以降が黙って落ちる）
  const ahead = at.head || ['ブランド', '公式アカウント', '発信の型'];
  const aCol = Math.max(3, ahead.length, ...accounts.map((r) => r.length));
  const aBase = [2.80, 3.60, 7.70];
  const aExtra = aCol > 3 ? 2.40 : 0;
  const aScale = (T.content.w - 0.20 - aExtra * (aCol - 3)) / aBase.reduce((a, b) => a + b, 0);
  addDataTable(s, {
    x: T.margin.l, y: T.content.top, w: T.content.w,
    head: ahead,
    colW: [...aBase.map((w) => w * Math.min(1, aScale)), ...Array(aCol - 3).fill(aExtra)],
    rows: accounts.map((r) => Array.from({ length: aCol }, (_, i) => (
      i === 0 ? { text: val(r[0]), bold: true } : val(r[i])))),
    maxH: tableRoom(body, opt),
  });
  if (body) addInsightBox(s, body, opt);
  return s;
}

module.exports = { slidePlatform, slidePlatformAccounts, PART };
