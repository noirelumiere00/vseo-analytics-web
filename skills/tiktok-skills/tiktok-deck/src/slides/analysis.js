// analysis.js — PART1（Q1〜Q5）の分析ページ
// 正式FMT準拠：比較する数値には必ず横棒を添え、右端には実例サムネイルを置く。
const T = require('../theme');
const D = require('../helpers/data');
const { val, num, PLACEHOLDER_DATA } = D;
const { fit, subSentences, splitSentences } = require('../helpers/text');
const { addSlide } = require('../components/slideBase');
const { addInsightBox, insightHeight, addExampleColumn } = require('../components/insightBox');
const { addBrandHeading, addBarMetric, addModule, addCard } = require('../components/metricCard');
const { addDataTable } = require('../components/comparisonTable');
const C = require('./common');
const { fitBox, linkTo } = require('../helpers/imageBox');

// 表が使える最大高さ（下の発見帯とフッターに触れない）
const TABLE_MAX = T.content.bottom - 1.55 - T.content.top;
/** そのページの発見帯が占める高さを引いた、表に使える高さ */
function tableRoom(bandText, bandOpts) {
  return T.content.bottom - insightHeight(bandText, bandOpts || {}) - 0.34 - T.content.top;
}

const { EX_W, MAIN_W, brandColor, clip, pctNum, img, ratioOf, exampleOf, pageSuffix, stats } = C;

const PART1 = 'PART 1 — 検索面の実態';
const EX_X = T.slide.w - T.margin.r - EX_W;
const EX_IMG_H = 4.55;

// 色は必ず colorOf(ブランド) で引く。ページ位置(offset)で引くと
// 同じ自社の実例が2枚目・3枚目で他社色になる（実際に p8/p9/p15 で発生）
/** 実例に出すブランド。全ページで先頭（自社）を使うと同じ写真が9ページ連続で出る。
 * 1ページ目は自社、以降はそのページの他社から実例を持つ最初のブランドを選ぶ */
function exampleBrand(chunk, ci) {
  const list = chunk || [];
  if (!list.length) return undefined;
  if (!ci) return list[0];
  const alt = list.slice(1).find((b) => (exampleOf(b) || {}).image);
  return alt || list[0];
}

function putExample(s, b, bandText, bandOpts, color) {
  const ex = exampleOf(b);
  // 下の結論帯が何インチ占めるかを先に出し、その罫線より上で実例列を終わらせる
  const bottom = T.content.bottom - 0.20;   // 発見帯は廃止済み。下端まで使う
  addExampleColumn(s, {
    x: EX_X, y: T.content.top, w: EX_W, imgH: EX_IMG_H,
    title: '実例', image: ex.image, caption: ex.caption, url: ex.url, bottom,
    brand: clip(val(b.brand_name), 22), color,      // どのブランドの実例かを明示
  });
}

// 凡例をリード文と同じ行に置くと重なる。表の直上に専用の行を取る。
const LEGEND_Y = T.content.top;
const Q1_TOP = T.content.top + 0.52;

function brandLegend(s, chunk, offset, groupX, groupW) {
  // 凡例は必ず対応する列グループの真上に置く（固定間隔だと2ブランド時に別列を指す）
  chunk.forEach((b, i) => {
    const lx = groupX !== undefined ? groupX + i * groupW : EX_X - 0.55 - (chunk.length - i) * 3.35;
    const lw = groupW !== undefined ? groupW - 0.26 : 3.05;
    s.addShape('rect', {
      x: lx, y: LEGEND_Y + 0.11, w: 0.16, h: 0.16,
      fill: { color: brandColor(colorOf(b)) }, line: { width: 0 },
    });
    s.addText(`${clip(val(b.brand_name), 22)} ${String(val(b.total_video_count)).split('（')[0]}本`, {
      x: lx + 0.26, y: LEGEND_Y - 0.02, w: lw, h: 0.40,
      fontFace: T.font.gothic, fontSize: T.size.caption, bold: true,
      color: T.color.text, valign: 'middle',
    });
  });
}

function insightOf(chunk, pick) {
  return chunk.map((b) => `${val(b.brand_name)}／${val(pick(b))}`).join('\n');
}

/** 各ブランドの所見から、上部に置く結論2行を作る。1社目＝大見出し、残り＝補足。 */
// 補足行に入る文字数の目安。幅14.1in・下限11.5pt で1行約88字、2行で約176字。
// 190 にしていたときは予算内と判定されたものが実際には枠から溢れていた
const SUB_BUDGET = 170;

/** 結論＝先頭ブランド、補足＝残りブランド。
 *  以前は残り2社を素で連結して 110字で機械カットしていたため、
 *  2社目は全文・3社目は1文だけ、という不均衡な切れ方をしていた（p5で3社目が1文）。
 *  ブランド数で予算を割り、各社を「完結した文」で同じだけ載せる。
 *  それでも入らない分は黙って捨てず QA に残す。 */
//
// 見出しは先頭ブランドの所見の「1文目」だけにする。所見全文を明朝33ptの見出しにしていたため、
// 長い所見は下限19ptでも収まらず、Qラベル・設問・補足行に重なって描かれた。2文目以降は補足行の先頭へ回す。
// 分割ページ（Q1-2 等）の2枚目以降は、全ページの先頭に再掲される自社ではなく、そのページで初めて出る
// 競合の所見を見出しにする。自社を見出しにしていたため Q1-1 と Q1-2 が同じ見出しになり、
// 2枚目以降の競合の所見は小さな補足行にしか載らなかった
function conclusionOf(chunk, pick, repeatedHead = false) {
  const shown = repeatedHead && chunk.length > 1 ? chunk.slice(1) : chunk;
  const lines = shown.map((b) => `${val(b.brand_name)}／${val(pick(b))}`).filter((t) => !/\[DATA NOT PROVIDED\]/.test(t));
  if (!lines.length) return { head: '', sub: '' };
  const first = splitSentences(lines[0]);
  const headRest = first.slice(1).join('').trim();
  const rest = [...(headRest ? [headRest] : []), ...lines.slice(1, 3)];
  const per = Math.floor(SUB_BUDGET / Math.max(1, rest.length));
  const cut = rest.map((t) => {
    const kept = subSentences(t, per);
    if (kept !== t) {
      stats.qaFixes.push(`補足行に入らず非掲載: "${t.slice(kept.length, kept.length + 30)}…"`);
    }
    return kept;
  });
  return { head: first[0].trim(), sub: cut.join('　') };
}

/** 分割ページの2枚目以降で、先頭ブランドが前のページからの再掲か（chunkWithOwn が自社を毎ページ先頭に置く） */
function headRepeated(chunk, ci, chunks) {
  return !!(ci > 0 && chunks && chunks[0] && chunk[0] && chunks[0][0] === chunk[0]);
}

/** そのブランドに割り当てられた色番号（ページを跨いでも同じ色にする） */
function colorOf(b) {
  const i = D.colorIndexOf(b);
  return i;
}

function bandH(n, per, cap) { return Math.min(cap, 0.44 + n * per); }

// ───────────────────────────────── Q1 誰が取り上げているか
const TIERS = [['nano', 'ナノ', '〜1万'], ['micro', 'マイクロ', '1〜10万'],
  ['middle', 'ミドル', '10〜100万'], ['mega', 'メガ', '100万〜'],
  ['unknown', '不明', 'フォロワー数未取得']];   // 0本なら行ごと出ないため常に持たせる

function slideQ1(pptx, d, chunk, ci, chunks, footer, offset) {
  const s = addSlide(pptx, {
    ...(() => { const c = conclusionOf(chunk, (b) => (b.q1 || {}).insight, headRepeated(chunk, ci, chunks)); return { conclusion: c.head, conclusionSub: c.sub }; })(),
    qLabel: `Q1${chunks.length > 1 ? `-${ci + 1}` : ''}`,
    title: `誰が取り上げていて、フォロワー階層ごとの効果は？${pageSuffix(chunks, ci)}`,
    partTag: PART1, lead: 'インフルエンサー階層別パフォーマンス',
    accent: brandColor(colorOf(chunk[0] || brands[0] || {})), footerLeft: footer,
  });
  // ブランドが3社未満のページで列が間延びしないよう、1社あたりの幅に上限を置く
  const PER_MAX = (T.content.w - 3.10) / 3;
  const per = Math.min((T.content.w - 3.10) / chunk.length, PER_MAX);
  const Q1_W = 3.10 + per * chunk.length;
  brandLegend(s, chunk, offset, T.margin.l + 3.10, per);

  const head = [{ text: 'フォロワー階層' }];
  chunk.forEach(() => head.push({ text: '本数', align: 'right' },
    { text: '平均再生数', align: 'right' }, { text: '平均EG率' }));
  const colW = [3.10];
  chunk.forEach(() => colW.push(per * 0.20, per * 0.40, per * 0.40));

  // バーの満尺は全ブランド共通の最大値。ページごとに変えると分割ページ間で長さが比較できない
  const allEg = [];
  (d.brands || chunk).forEach((b) => TIERS.forEach(([k]) => {
    const t = ((b.q1 || {}).tiers || {})[k];
    allEg.push(t ? pctNum(t.avg_eg) : null);
  }));
  const maxEg = Math.max(...allEg.filter((v) => v !== null), 0.01);

  // 全ブランドで0本の階層は行ごと落とす（「不明」が全社0のまま席だけ取っていた）
  const universe = d.brands || chunk;
  const usedTiers = TIERS.filter(([k]) => universe.some((b) => {
    const t = ((b.q1 || {}).tiers || {})[k] || {};
    const n = parseInt(String(t.post_count).replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) && n > 0;
  }));
  const rows = usedTiers.map(([k, label, sub]) => {
    const cells = [{ text: `${label}（${sub}）`, bold: true }];
    chunk.forEach((b, bi) => {
      const t = ((b.q1 || {}).tiers || {})[k] || {};
      const cnt = num(t.post_count);
      const empty = String(cnt) === '0' || D.isPlaceholderText(String(cnt));
      cells.push({ text: cnt, align: 'right' });
      cells.push({ text: empty ? '—' : num(t.avg_views), align: 'right',
        color: empty ? T.color.subLight : T.color.text });
      if (empty) {
        // 母数0の階層に数値も棒も置かない（無いものを「欠損」と見せない）
        cells.push({ text: '—', color: T.color.subLight });
      } else {
        cells.push({
          text: val(t.avg_eg), big: true,
          bar: { ratio: ratioOf(pctNum(t.avg_eg), maxEg), color: brandColor(colorOf(b)) },
        });
      }
    });
    return cells;
  });
    const q1t0 = insightOf(chunk, (b) => (b.q1 || {}).insight);
  const q1o0 = { label: '発見', h: bandH(chunk.length, 0.36, 1.40) };
  const room1 = T.content.bottom - T.content.top - 0.30;   // 発見帯を廃止したぶん下端まで使う
  const r1 = addDataTable(s, {
    x: T.margin.l, y: Q1_TOP, w: Q1_W, head, rows, colW,
    rowH: Math.min(1.55, (room1 - 0.66) / Math.max(1, rows.length)), maxH: room1,
  });
  if (r1 && r1.dropped) stats.qaFixes.push(`Q1: ${r1.dropped}行が入りきらずスライド外（無言で落とさないこと）`);
  const q1t = q1t0;
  const q1o = q1o0;

  return s;
}

// ───────────────────────────────── Q2 PRかオーガニックか
/** PR の内訳（isAd／#PRタグ）。build_input_md の数値キー、無ければ pr_definition_note の文から読む。
 *  どちらも無ければ null（推測で書かない） */
function prBreakdown(q) {
  const qq = q || {};
  let ad = qq.pr_isad_count;
  let tg = qq.pr_tag_count;
  if (D.isMissing(ad) || D.isMissing(tg)) {
    const m = /isAd\s*(\d+)本[／/]#PRタグ\s*(\d+)本/.exec(String(qq.pr_definition_note || ''));
    if (!m) return null;
    [, ad, tg] = m;
  }
  const unk = parseInt(String(qq.pr_isad_unknown || '0'), 10) || 0;
  return `内訳：isAd ${ad}本／#PRタグ ${tg}本${unk ? `（isAd 未取得 ${unk}本）` : ''}`;
}

function slideQ2(pptx, d, chunk, ci, chunks, footer, offset) {
  const s = addSlide(pptx, {
    ...(() => { const c = conclusionOf(chunk, (b) => (b.q2 || {}).insight, headRepeated(chunk, ci, chunks)); return { conclusion: c.head, conclusionSub: c.sub }; })(),
    qLabel: `Q2${chunks.length > 1 ? `-${ci + 1}` : ''}`,
    title: `伸びているのは、PR投稿かオーガニックか？${pageSuffix(chunks, ci)}`,
    partTag: PART1,
    // 「内訳は各ページに併記」は、実際に内訳を描けるときだけ書く（以前は描いていないのに書いていた）
    lead: `PRはisAdまたは#PRタグのいずれか${chunk.some((b) => prBreakdown(b.q2)) ? '（内訳は各ブランドに併記）' : ''}。`
      + '「#PR表記なし」はオーガニックを意味しない。',
    accent: brandColor(colorOf(chunk[0] || brands[0] || {})), footerLeft: footer,
  });
  const n = chunk.length;
  const gap = 0.42;
  const cw = (MAIN_W - gap * (n - 1)) / n;
  const cardY = T.content.top;
  const cardH = T.content.bottom - T.content.top - 0.20;

  const alls = [];
  // 満尺は全ブランド共通。ページごとに変えると(1/3)(2/3)(3/3)で同じ長さが別の値を指す
  (d.brands || chunk).forEach((b) => {
    alls.push(pctNum((b.q2 || {}).pr_avg_eg), pctNum((b.q2 || {}).organic_avg_eg));
  });
  const maxEg = Math.max(...alls.filter((v) => v !== null), 0.01);

  chunk.forEach((b, i) => {
    const x = T.margin.l + i * (cw + gap);
    const c = brandColor(colorOf(b));
    const q = b.q2 || {};
    addCard(s, { x, y: cardY, w: cw, h: cardH });
    addBrandHeading(s, {
      x: x + 0.40, y: cardY + 0.55, w: cw - 0.80, color: c,
      name: clip(val(b.brand_name), 20),
      sub: `PR（isAdまたは#PRタグ）　${val(q.pr_count)} / ${val(q.total_count)}本（${val(q.pr_share)}）`,
    });
    // 2定義の内訳。定義で比率が大きく変わる軸があるので、付録の約束どおり各ブランドに併記する
    const bd = prBreakdown(q);
    if (bd) {
      s.addText(bd, {
        x: x + 0.70, y: cardY + 1.40, w: cw - 1.10, h: 0.34,
        fontFace: T.font.gothic,
        fontSize: fit(bd, cw - 1.10, 0.34, { base: T.size.caption, min: 9.5, lineHeight: 1.1 }),
        color: T.color.sub, valign: 'middle',
      });
    }
    // 母数を出さないと、n=1 の平均と n=47 の平均が同じ体裁・同じ満尺で並んでしまう
    const prN = Number(String(val(q.pr_count)).replace(/[^0-9]/g, ''));
    const totN = Number(String(val(q.total_count)).replace(/[^0-9]/g, ''));
    // 「（47本）」だと括弧の途中で折り返して「（47／本）」に割れる。資料内で使っている n= に揃える
    const nOf = (v) => (Number.isFinite(v) && v > 0 ? `　n=${v}` : '');
    addBarMetric(s, {
      x: x + 0.40, y: cardY + 2.45, w: cw - 0.80, color: c, dim: true,
      label: `PR動画 平均EG率${nOf(prN)}`, value: val(q.pr_avg_eg),
      ratio: ratioOf(pctNum(q.pr_avg_eg), maxEg),
    });
    addBarMetric(s, {
      x: x + 0.40, y: cardY + 4.75, w: cw - 0.80, color: c,
      label: `#PR表記なし 平均EG率${nOf(totN - prN)}`, value: val(q.organic_avg_eg),
      ratio: ratioOf(pctNum(q.organic_avg_eg), maxEg),
    });
  });
  const q2t = insightOf(chunk, (b) => (b.q2 || {}).insight);
  const q2o = { label: '発見', h: bandH(chunk.length, 0.38, 1.45) };
  const ex2 = exampleBrand(chunk, ci);
  putExample(s, ex2, q2t, q2o, brandColor(colorOf(ex2 || {})));

  return s;
}

// ───────────────────────────────── Q3 界隈
function slideQ3(pptx, d, brands, footer, ci, chunks, offset = 0) {
  const s = addSlide(pptx, {
    ...(() => { const c = conclusionOf(brands, (b) => (b.q3 || {}).insight, headRepeated(brands, ci, chunks)); return { conclusion: c.head, conclusionSub: c.sub }; })(),
    qLabel: `Q3${chunks && chunks.length > 1 ? `-${ci + 1}` : ''}`,
    title: `どんな切り口・界隈で語られているか？${chunks ? pageSuffix(chunks, ci) : ''}`,
    // 中身は頻出ハッシュタグ（本文の分類ではない）。「内容タイプ」と呼ぶと分類したように読める
    partTag: PART1, lead: '頻出ハッシュタグ別の集計（ブランド名・PR表記・汎用タグは除く）。各ブランドの上位3タグを掲載。',
    accent: brandColor(colorOf(brands[0] || {})), footerLeft: footer,
  });
  const head = ['ブランド', 'ハッシュタグ', { text: '本数', align: 'right' },
    { text: '平均再生数', align: 'right' }, { text: '平均EG率' }, { text: '平均保存率', align: 'right' }];
  const colW = [3.30, 3.20, 1.15, 2.15, 2.60, 1.85];

  const all = [];
  const PER_BRAND = 3;   // ページ間で掲載基準を揃える
  // バーの満尺は全ブランド共通（分割ページ間で長さを比較できるように）
  (d.brands || brands).forEach((b) => ((b.q3 || {}).clusters || []).slice(0, PER_BRAND)
    .forEach((c) => all.push(pctNum(c.avg_eg))));
  const maxEg = Math.max(...all.filter((v) => v !== null), 0.01);

  const rows = [];
  let dropped = 0;
  brands.forEach((b, bi) => {
    const cl = (b.q3 || {}).clusters || [];
    dropped += Math.max(0, cl.length - PER_BRAND);
    cl.slice(0, PER_BRAND).forEach((c, i) => {
      rows.push([
        { text: i === 0 ? clip(val(b.brand_name), 22) : '', bold: i === 0 },
        val(c.name), { text: num(c.post_count), align: 'right' },
        { text: num(c.avg_views), align: 'right' },
        { text: val(c.avg_eg), bold: true, bar: { ratio: ratioOf(pctNum(c.avg_eg), maxEg), color: brandColor(colorOf(b)) } },
        { text: val(c.avg_save_rate), align: 'right' },
      ]);
    });
  });
  if (dropped) stats.qaFixes.push(`Q3: 各ブランド上位${PER_BRAND}クラスタのみ掲載（計${dropped}件は非掲載）`);
  const q3t = insightOf(brands, (b) => (b.q3 || {}).insight);
  const q3o = { label: '発見', h: 1.60 };
  const r = addDataTable(s, {
    x: T.margin.l, y: T.content.top, w: MAIN_W, head, rows, colW, maxH: T.content.bottom - T.content.top - 0.30,
  });
  if (r && r.dropped) stats.qaFixes.push(`Q3: ${r.dropped}行が入りきらずスライド外`);
  const ex3 = exampleBrand(brands, ci);
  putExample(s, ex3, q3t, q3o, brandColor(colorOf(ex3 || {})));

  return s;
}

// ───────────────────────────────── Q4 商品・タグ
function slideQ4(pptx, d, chunk, ci, chunks, footer, offset) {
  const s = addSlide(pptx, {
    ...(() => { const c = conclusionOf(chunk, (b) => (b.q4 || {}).insight, headRepeated(chunk, ci, chunks)); return { conclusion: c.head, conclusionSub: c.sub }; })(),
    qLabel: `Q4${chunks.length > 1 ? `-${ci + 1}` : ''}`,
    title: `どの商品が、どんな文脈で語られているか？${pageSuffix(chunks, ci)}`,
    partTag: PART1, lead: '頻出ハッシュタグと、名前が出ている商品。',
    accent: brandColor(colorOf(chunk[0] || brands[0] || {})), footerLeft: footer,
  });
  const n = chunk.length;
  const gap = 0.50;
  const cw = (MAIN_W - gap * (n - 1)) / n;
  // 先に発見帯の高さを出し、その上端までにモジュールを収める（溢れて帯と重ならないように）
  const q4tPre = insightOf(chunk, (b) => (b.q4 || {}).insight);
  const q4oPre = { label: '発見', h: bandH(chunk.length, 0.38, 1.45) };
  const bandTop4 = T.content.bottom - 0.20;   // 発見帯を廃止
  const modTop = T.content.top + 0.66;
  const room4 = bandTop4 - modTop - 0.42;                 // 2モジュール分＋間隔
  const tagH = Math.max(1.50, Math.min(2.60, room4 * 0.55));
  const skuH = Math.max(1.20, room4 - tagH);
  const LINE = (T.size.bodySm * 1.5 * 1.30) / 72;         // 1行の実高さ
  const tagN = Math.min(5, Math.max(3, Math.floor((tagH - 0.55) / LINE)));
  const skuN = Math.min(4, Math.max(2, Math.floor((skuH - 0.55) / LINE)));
  // 3列で同じ文字サイズにする（項目数の差で列ごとに大きさが変わると横比較しづらい）
  const lineOf = (v) => (typeof v === 'string' ? v.replace(/[：:]\s*/, '\u3000') : `${val(v.tag || v.name)}\u3000${val(v.count)}`);
  const sizeFor = (pick, n, boxH) => Math.min(...chunk.map((b) => {
    const arr = (b.q4 || {})[pick] || [];
    const body = [...arr.slice(0, n).map(lineOf), ...(arr.length > n ? [`ほか${arr.length - n}件`] : [])].join('\n');
    return fit(body || PLACEHOLDER_DATA, cw - 0.26, boxH - 0.40, { base: T.size.moduleBody, min: 11.5, lineHeight: 1.55 });
  }));
  const tagSize = sizeFor('hashtags', tagN, tagH);
  const skuSize = sizeFor('products', skuN, skuH);

  chunk.forEach((b, i) => {
    const x = T.margin.l + i * (cw + gap);
    const c = brandColor(colorOf(b));
    addBrandHeading(s, { x, y: T.content.top, w: cw, name: clip(val(b.brand_name), 20), color: c });
    const allTags = (b.q4 || {}).hashtags || [];
    const allSku = (b.q4 || {}).products || [];
    const line = (v) => (typeof v === 'string' ? v.replace(/[：:]\s*/, '\u3000') : `${val(v.tag || v.name)}\u3000${val(v.count)}`);
    const more = (arr, k) => (arr.length > k ? [`ほか${arr.length - k}件`] : []);
    const tags = [...allTags.slice(0, tagN).map(line), ...more(allTags, tagN)].join('\n');
    addModule(s, {
      x, y: modTop, w: cw, h: tagH,
      // build_input_md は「そのタグを付けた動画数」で数える（同じ動画が同じタグを2回持つ
      // 投稿があり、延べ出現数だと動画数と食い違う）。見出しを「出現数」にすると
      // 表示値と名前が一致しない（#daiso が 32 と表示され、出現数は 34 だった）
      label: '頻出ハッシュタグ（付けた動画数。ブランド名・PR表記は除く）', body: tags || PLACEHOLDER_DATA, accent: c, bodySize: tagSize,
    });
    const sku = [...allSku.slice(0, skuN).map(line), ...more(allSku, skuN)].join('\n');
    addModule(s, {
      x, y: modTop + tagH + 0.42, w: cw, h: skuH,
      label: '名前が出ている商品（本文中の言及数）', body: sku || PLACEHOLDER_DATA, accent: c, bodySize: skuSize,
    });
  });
  const q4t = q4tPre;
  const q4o = q4oPre;
  const ex4 = exampleBrand(chunk, ci);
  putExample(s, ex4, q4t, q4o, brandColor(colorOf(ex4 || {})));

  return s;
}

// ───────────────────────────────── Q5 最も伸びている動画（サムネ横並び）
function slideQ5(pptx, d, brands, footer) {
  const s = addSlide(pptx, {
    ...(() => { const c = conclusionOf(brands, (b) => (b.q5 || {}).q5_insight); return { conclusion: c.head, conclusionSub: c.sub }; })(),
    qLabel: 'Q5', title: (val((d.settings || {}).q5_basis_label) && !D.isPlaceholderText(val((d.settings || {}).q5_basis_label)))
      ? `各ブランドの${val((d.settings || {}).q5_basis_label)}は何か？`
      : '最も伸びている動画は何か？',
    partTag: PART1,
    // 抽出基準をレンダラに決め打ちすると、保存率で選んだ表を「再生数TOP1」と偽って出す。
    // 基準は INPUT の settings.q5_basis_label から受け取る
    lead: (() => {
      const basis = val((d.settings || {}).q5_basis_label);
      // 率で選んだときの分母下限はデータ側が持つ。書かないと 63再生の 7.94% が
      // 110万再生の 1.58% と並ぶ。除外本数はこのページに載る全社の合計を出す
      // （先頭1社の値を書くと、全体の除外数と読み違える）
      const nums = brands.map((b) => ({
        lim: parseInt(String(val((b.q5 || {}).rate_rank_min_views)).replace(/[^0-9]/g, ''), 10),
        drop: parseInt(String(val((b.q5 || {}).rate_rank_dropped)).replace(/[^0-9]/g, ''), 10),
      })).filter((x) => Number.isFinite(x.lim));
      const rn = nums.length
        ? `率の順位は再生${nums[0].lim.toLocaleString()}以上に限定（分母が小さいと率が跳ねるため。`
          + `${brands.length}社計${nums.reduce((a, x) => a + (Number.isFinite(x.drop) ? x.drop : 0), 0)}本を対象外）。`
        : null;
      const head = (basis && !D.isPlaceholderText(basis))
        ? `各ブランドの${basis}。`
        : '各ブランドの再生数TOP1。再生数トップとEG率トップは一致しない前提で見る。';
      return rn ? `${head}${rn}` : head;
    })(),
    accent: brandColor(0), footerLeft: footer,
  });
  const n = brands.length;
  const gap = 0.42;
  const cw = (T.content.w - gap * (n - 1)) / n;
  // 下の発見帯の高さを先に確定し、カード全体（画像＋メタ4行）がその上で終わるようにする
  const q5t = insightOf(brands, (b) => (b.q5 || {}).q5_insight);
  const q5o = { label: '発見', h: 1.55, maxH: 3.20 };
  const bandTop = T.content.bottom - 0.20;   // 発見帯を廃止
  const META_H = 2.20;                                  // ブランド名・投稿者・指標3行
  const imgH = Math.max(2.60, Math.min(4.05, bandTop - T.content.top - META_H));
  const iw = Math.min(cw, (imgH * 9) / 16);

  brands.forEach((b, i) => {
    const x = T.margin.l + i * (cw + gap);
    const c = brandColor(i);
    const v = ((b.q5 || {}).topVideos || [])[0] || {};
    const p = img(v.image_path);
    const ix = x + (cw - iw) / 2;
    if (p) {
      s.addImage({ path: p, ...fitBox(p, ix, T.content.top, iw, imgH), ...linkTo(v.url) });
    } else {
      s.addShape('rect', {
        x: ix, y: T.content.top, w: iw, h: imgH,
        fill: { color: T.color.cardBg }, line: { color: T.color.cardLine, width: 1 },
      });
      s.addText('[IMAGE NOT PROVIDED]', {
        x: ix, y: T.content.top, w: iw, h: imgH,
        fontFace: T.font.gothic, fontSize: T.size.captionSm, color: T.color.placeholder,
        align: 'center', valign: 'middle',
      });
    }
    let y = T.content.top + imgH + 0.24;
    s.addShape('rect', { x, y: y + 0.09, w: 0.15, h: 0.15, fill: { color: c }, line: { width: 0 } });
    s.addText(clip(val(b.brand_name), 18), {
      x: x + 0.26, y, w: cw - 0.26, h: 0.36,
      fontFace: T.font.gothic, fontSize: T.size.caption, bold: true, color: T.color.text, valign: 'middle',
    });
    y += 0.42;
    s.addText(clip(D.name(v.creator), 16), {
      x, y, w: cw, h: 0.34,
      fontFace: T.font.gothic, fontSize: T.size.bodySm, bold: true, color: T.color.text, valign: 'middle',
    });
    y += 0.36;
    // 媒体（動画／写真カルーセル）を出す。書かないと静止画の投稿が
    // 「動画」として読まれ、次章の構成解剖の対象だと誤解される
    const md = val(v.media);
    const mdTxt = D.isPlaceholderText(md) ? '' : `／${md}`;
    const lines = `${num(v.views)}再生・EG${val(v.eg)}\n保存${num(v.saves)}（${val(v.save_rate)}）／#PR ${val(v.is_pr)}${mdTxt}\n${clip(val(v.content_summary), 26)}`;
    s.addText(lines, {
      x, y, w: cw, h: 1.00,
      fontFace: T.font.gothic,
      fontSize: fit(lines, cw, 1.00, { base: T.size.captionSm, min: 8.5, lineHeight: 1.45 }),
      color: T.color.sub, valign: 'top', lineSpacingMultiple: 1.32,
    });
  });

  return s;
}

module.exports = { slideQ1, slideQ2, slideQ3, slideQ4, slideQ5 };
