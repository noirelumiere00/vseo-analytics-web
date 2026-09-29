// reviews.js — 口コミ章（調査条件／横断比較／自社深掘り／評価の出自／打ち手）
// 表・テキスト・対応矢印はすべてPowerPoint上で編集できる要素として配置する。
const T = require('../theme');
const D = require('../helpers/data');
const { val, num, PLACEHOLDER_DATA } = D;
const { fit } = require('../helpers/text');
const { addSlide } = require('../components/slideBase');
const { addDataTable } = require('../components/comparisonTable');
const { addInsightBox } = require('../components/insightBox');

const ACCENT = T.brandColors[0];
const PART = 'REVIEWS';

/** 自社名は INPUT の client_name から引く。レンダラに社名を書くと次案件で他社が自社色になる */
function ownNameOf(d) {
  const c = ((d || {}).clients || [])[0] || {};
  const n = String(val(c.client_name) || '').trim();
  return (n && !D.isPlaceholderText(n)) ? n : null;
}

function isOwnName(text, ownName) {
  if (!ownName) return false;
  return String(text || '').toLowerCase().includes(ownName.toLowerCase());
}

function isOwnBrand(brand, ownName) {
  return isOwnName((brand || {}).brand_name, ownName);
}

function paddedBrands(brands, count = 7) {
  // 実在ブランド数を超えて空行で水増しすると、余った行が [DATA NOT PROVIDED] で並ぶ。
  // 取得できたブランド数（最低3行）までに抑える。
  const real = (brands || []).length;
  const target = Math.min(count, Math.max(real, 3));
  const out = (brands || []).slice(0, target);
  while (out.length < target) out.push({});
  return out;
}

function countValue(value) {
  if (D.isMissing(value)) return null;
  const t = String(value).replace(/,/g, '');
  // 「C:35件、CE:7件、CO:7件（3種合計49件）」のような内訳付きは、先頭の35ではなく合計49を採る
  const total = t.match(/合計\s*(\d+(?:\.\d+)?)/);
  if (total) return Number(total[1]);
  const normalized = t.match(/\d+(?:\.\d+)?/);
  return normalized ? Number(normalized[0]) : null;
}

function summedCount(brands, key) {
  if (!brands.length) return PLACEHOLDER_DATA;
  const values = brands.map((brand) => countValue(brand[key]));
  if (values.some((value) => value === null)) return PLACEHOLDER_DATA;
  return `${values.reduce((sum, value) => sum + value, 0).toLocaleString('ja-JP')}件`;
}

function sourceTotal(brands) {
  const cosme = summedCount(brands, 'cosme_count');
  const lips = summedCount(brands, 'lips_count');
  if (cosme === PLACEHOLDER_DATA && lips === PLACEHOLDER_DATA) return PLACEHOLDER_DATA;
  return `@cosme ${cosme}／LIPS ${lips}`;
}

function countLabel(value) {
  const formatted = num(value);
  if (formatted === PLACEHOLDER_DATA || /件$/.test(formatted)) return formatted;
  return `${formatted}件`;
}

function patternText(patterns) {
  const values = (patterns || []).filter((item) => !D.isMissing(item));
  return (values.length ? values : [PLACEHOLDER_DATA]).map((item) => `・${val(item)}`).join('\n');
}

function topReasons(brand, key) {
  const rows = ((brand || {})[key] || []).slice(0, 3);
  while (rows.length < 3) rows.push({});
  return rows.map((item, index) => {
    const reason = val(item.reason);
    // 実在する理由が3件未満のブランドは、空行を [DATA NOT PROVIDED] ではなく「—」で示す（脚注と整合）
    if (D.isPlaceholderText(reason)) return `${index + 1}. —`;
    return `${index + 1}. ${reason}（${countLabel(item.mentions)}）`;
  }).join('\n');
}

function addSectionHeading(slide, text, x, y, w, color = T.color.text) {
  slide.addShape('rect', {
    x, y: y + 0.08, w: 0.08, h: 0.28,
    fill: { color }, line: { width: 0 },
  });
  slide.addText(text, {
    x: x + 0.25, y, w: w - 0.25, h: 0.44,
    fontFace: T.font.gothic, fontSize: T.size.moduleLabel, bold: true,
    color, valign: 'middle',
  });
}

function slideSurvey(pptx, d, footer) {
  const reviews = d.reviews || {};
  const survey = reviews.survey || {};
  const brands = reviews.brands || [];
  const s = addSlide(pptx, {
    qLabel: 'R1', title: '口コミで見る、買った理由と離れた理由',
    partTag: PART, lead: '口コミの件数差と媒体差を前提に、購買継続と離脱の理由を読む。',
    accent: ACCENT, footerLeft: footer,
  });

  s.addText('調査条件', {
    x: T.margin.l, y: T.content.topPlain, w: T.content.w, h: 0.72,
    fontFace: T.font.mincho, fontSize: 30, bold: true, color: T.color.text, valign: 'middle',
  });
  const names = brands.map((brand) => brand.brand_name).filter((name) => !D.isMissing(name));
  // 取得方法は数百字あり、表のセルに入れると隣の列と重なる。表の外に独立して置く
  const rows = [[
    val(survey.media),
    names.length ? names.join('／') : PLACEHOLDER_DATA,
    sourceTotal(brands),
    summedCount(brands, 'reviews_read'),
  ]];
  const tblY = T.content.topPlain + 1.08;
  addDataTable(s, {
    x: T.margin.l, y: tblY, w: T.content.w,
    head: ['媒体', '対象商品', '総件数', '読了件数'],
    rows, colW: [3.05, 7.35, 4.05, 3.25],
    fontSize: T.size.bodySm, rowH: 1.55, maxH: 2.20,
  });
  const mY = tblY + 2.30;
  s.addText('取得方法', {
    x: T.margin.l, y: mY, w: T.content.w, h: 0.36,
    fontFace: T.font.gothic, fontSize: T.size.moduleLabel, bold: true, color: ACCENT,
  });
  const mText = val(survey.method);
  const bandH = 1.45;
  const mH = Math.max(0.9, T.content.bottom - bandH - 0.50 - (mY + 0.44));
  s.addText(mText, {
    x: T.margin.l, y: mY + 0.44, w: T.content.w, h: mH,
    fontFace: T.font.gothic,
    fontSize: fit(mText, T.content.w, mH, { base: T.size.bodySm, min: 9.5, lineHeight: 1.5 }),
    color: T.color.text, valign: 'top', lineSpacingMultiple: 1.45,
  });
  addInsightBox(s, val(survey.asymmetry_note), {
    label: '注意', h: bandH, maxH: 2.25, chipColor: ACCENT,
  });
  return s;
}

function slideReasonTable(pptx, d, footer, kind) {
  const reviews = d.reviews || {};
  const love = kind === 'love';
  const title = love ? '好きな理由をブランド横断で比べる' : '離脱した理由をブランド横断で比べる';
  const lead = love
    ? '各ブランドの読了口コミから、好意につながった理由の上位3件を比較。'
    : '各ブランドの読了口コミから、離脱につながった理由の上位3件を比較。';
  const s = addSlide(pptx, {
    qLabel: love ? 'R2' : 'R3', title, partTag: PART, lead,
    accent: ACCENT, footerLeft: footer,
  });
  const rows = paddedBrands(reviews.brands).map((brand) => {
    const own = !love && isOwnBrand(brand, ownNameOf(d));
    const color = own ? ACCENT : T.color.text;
    return [
      { text: val(brand.brand_name), bold: true, color },
      { text: num(brand.reviews_read), align: 'right', color },
      { text: topReasons(brand, kind), color, bold: own },
    ];
  });
  addDataTable(s, {
    x: T.margin.l, y: T.content.topPlain, w: T.content.w,
    head: ['ブランド', { text: '読了件数', align: 'right' }, `${love ? '好きな理由' : '離脱理由'}TOP3（理由・言及数）`],
    rows, colW: [3.20, 1.75, 12.75], fontSize: 12.5,
    maxH: T.content.bottom - T.content.topPlain - 1.80,
  });
  const patterns = ((reviews.cross || {})[love ? 'love_patterns' : 'churn_patterns']) || [];
  addInsightBox(s, patternText(patterns), {
    label: '共通の型', h: 1.35, maxH: 1.60, chipW: 1.55,
    chipColor: love ? T.color.chipDark : ACCENT,
  });
  return s;
}

function reasonDetailText(items, reviewsRead) {
  const list = (items || []).length ? items : [{}];
  return list.map((item, index) => (
    `${String(index + 1).padStart(2, '0')}　${val(item.reason)}　${countLabel(item.mentions)} / ${countLabel(reviewsRead)}`
  )).join('\n');
}

function slideOwnDetail(pptx, d, footer) {
  const brands = ((d.reviews || {}).brands || []);
  const own = brands.find((b) => isOwnBrand(b, ownNameOf(d))) || brands[0] || {};
  const name = val(own.brand_name);
  const s = addSlide(pptx, {
    qLabel: 'R4', title: `${name}の口コミを深掘りする`, partTag: PART,
    lead: '好意と離脱を同じ読了母数で見比べ、実際の言葉で解像度を上げる。',
    accent: ACCENT, footerLeft: footer,
  });
  const gap = 0.55;
  const colW = (T.content.w - gap) / 2;
  const leftX = T.margin.l;
  const rightX = leftX + colW + gap;
  const cardY = T.content.topPlain + 0.50;
  const cardH = 2.65;

  addSectionHeading(s, '好きな理由', leftX, T.content.topPlain, colW, ACCENT);
  addSectionHeading(s, '離脱した理由', rightX, T.content.topPlain, colW, T.color.text);
  [[leftX, own.love, 'FAF3F5', ACCENT], [rightX, own.churn, T.color.cardBg, T.color.text]].forEach(([x, list, fill, color]) => {
    s.addShape('rect', {
      x, y: cardY, w: colW, h: cardH,
      fill: { color: fill }, line: { color: T.color.cardLine, width: 1 },
    });
    const body = reasonDetailText(list, own.reviews_read);
    s.addText(body, {
      x: x + 0.34, y: cardY + 0.24, w: colW - 0.68, h: cardH - 0.48,
      fontFace: T.font.gothic,
      fontSize: fit(body, colW - 0.68, cardH - 0.48, { base: T.size.bodySm, min: 9, lineHeight: 1.55 }),
      bold: color === ACCENT, color, valign: 'top', lineSpacingMultiple: 1.45,
    });
  });

  const quotes = (own.quotes || []).slice(0, 4);
  if (!quotes.length) quotes.push({});
  addSectionHeading(s, '逐語引用（最大4件）', T.margin.l, cardY + cardH + 0.32, T.content.w, ACCENT);
  const quoteTop = cardY + cardH + 0.88;
  const quoteGapX = 0.45;
  const quoteGapY = 0.22;
  const quoteW = (T.content.w - quoteGapX) / 2;
  const quoteH = (T.content.bottom - quoteTop - quoteGapY) / 2;
  quotes.forEach((quote, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = T.margin.l + col * (quoteW + quoteGapX);
    const y = quoteTop + row * (quoteH + quoteGapY);
    s.addShape('rect', {
      x, y, w: quoteW, h: quoteH,
      fill: { color: T.color.cardBg }, line: { color: T.color.cardLine, width: 1 },
    });
    const body = `「${val(quote.quote)}」`;
    s.addText(body, {
      x: x + 0.28, y: y + 0.18, w: quoteW - 0.56, h: quoteH - 0.62,
      fontFace: T.font.gothic,
      fontSize: fit(body, quoteW - 0.56, quoteH - 0.62, { base: 12.5, min: 8.5, lineHeight: 1.45 }),
      color: D.isMissing(quote.quote) ? T.color.placeholder : T.color.text,
      valign: 'top', lineSpacingMultiple: 1.35,
    });
    const url = val(quote.source_url);
    const urlOptions = {
      x: x + 0.28, y: y + quoteH - 0.40, w: quoteW - 0.56, h: 0.24,
      fontFace: T.font.gothic, fontSize: 8.5,
      color: D.isPlaceholderText(url) ? T.color.placeholder : T.color.sub,
      valign: 'middle', breakLine: false,
    };
    if (/^https?:\/\//i.test(url)) urlOptions.hyperlink = { url };
    s.addText(url, urlOptions);
  });
  return s;
}

function slideRatingOrigins(pptx, d, footer) {
  const reviews = d.reviews || {};
  const s = addSlide(pptx, {
    qLabel: 'R5', title: '評価点は、どの母集団から生まれたか', partTag: PART,
    lead: '評価点だけでなく、件数とサンプル・PR比率を並べて評価の出自を確認する。',
    accent: ACCENT, footerLeft: footer,
  });
  const rows = paddedBrands(reviews.brands).map((brand) => {
    const own = isOwnBrand(brand, ownNameOf(d));
    const color = own ? ACCENT : T.color.text;
    return [
      { text: val(brand.brand_name), bold: true, color },
      { text: val(brand.cosme_rating), align: 'right', bold: own, color },
      { text: num(brand.cosme_count), align: 'right', color },
      { text: val(brand.lips_rating), align: 'right', bold: own, color },
      { text: num(brand.lips_count), align: 'right', color },
      { text: val(brand.lips_pr_ratio), align: 'right', color },
    ];
  });
  // 媒体名は INPUT の REVIEWS > SURVEY で差し替えられる（既定は美容案件の @cosme / LIPS）。
  // 食品・日用品など他ジャンルでは media_a_label / media_b_label に「楽天」「Yahoo!」等を入れる。
  const survey = (d.reviews || {}).survey || {};
  const mediaA = D.isPlaceholderText(val(survey.media_a_label)) ? '@cosme' : val(survey.media_a_label);
  const mediaB = D.isPlaceholderText(val(survey.media_b_label)) ? 'LIPS' : val(survey.media_b_label);
  const colC = D.isPlaceholderText(val(survey.media_c_label)) ? `${mediaB} PR比率` : val(survey.media_c_label);
  addDataTable(s, {
    x: T.margin.l, y: T.content.topPlain, w: T.content.w,
    head: ['ブランド', { text: `${mediaA}評価`, align: 'right' }, { text: `${mediaA}件数`, align: 'right' },
      { text: `${mediaB}評価`, align: 'right' }, { text: `${mediaB}件数`, align: 'right' },
      { text: colC, align: 'right' }],
    rows, colW: [4.15, 2.55, 2.55, 2.55, 2.55, 3.35],
    fontSize: 12.5, maxH: T.content.bottom - T.content.topPlain - 1.70,
  });
  // 案件固有の実測可否はレンダラに書かない（他案件の資料にその事実が混入する）。
  // INPUT の REVIEWS > SURVEY > scale_note があればそれを出し、無ければ尺度の違いだけを述べる
  const scaleNote = val(((d.reviews || {}).survey || {}).scale_note);
  addInsightBox(s,
    D.isPlaceholderText(scaleNote)
      ? '媒体ごとに評価尺度・投稿者構成・レビュー件数が異なるため、評価点の単純比較はできない（@cosmeは7点満点、LIPSは5点満点）。各媒体のPR・サンプル比率の実測可否は媒体ごとに異なる。'
      : scaleNote,
    { label: '注記', h: 1.25, maxH: 1.50, chipColor: ACCENT });
  return s;
}

function slideActions(pptx, d, footer) {
  const reviews = d.reviews || {};
  const actions = (reviews.actions || []).slice(0, 5);
  while (actions.length < 3) actions.push({});
  const s = addSlide(pptx, {
    qLabel: 'R6', title: '口コミの離脱理由を、具体的な打ち手へ変える', partTag: PART,
    lead: '左の離脱理由と、右の対応施策を一対一で接続する。',
    accent: ACCENT, footerLeft: footer,
  });
  const leftX = T.margin.l;
  const leftW = 5.70;
  const arrowW = 1.30;
  const rightX = leftX + leftW + arrowW;
  const rightW = T.content.w - leftW - arrowW;
  addSectionHeading(s, '離脱理由', leftX, T.content.topPlain, leftW, ACCENT);
  addSectionHeading(s, '対応する打ち手', rightX, T.content.topPlain, rightW, T.color.text);

  const top = T.content.topPlain + 0.58;
  const gap = 0.18;
  const rowH = Math.min(2.15, (T.content.bottom - top - gap * (actions.length - 1)) / actions.length);
  actions.forEach((item, index) => {
    const y = top + index * (rowH + gap);
    s.addShape('rect', {
      x: leftX, y, w: leftW, h: rowH,
      fill: { color: 'FAF3F5' }, line: { color: ACCENT, width: 1.1 },
    });
    s.addShape('rect', {
      x: rightX, y, w: rightW, h: rowH,
      fill: { color: T.color.cardBg }, line: { color: T.color.cardLine, width: 1 },
    });
    const churn = val(item.churn);
    const action = val(item.action);
    s.addText(churn, {
      x: leftX + 0.38, y: y + 0.18, w: leftW - 0.76, h: rowH - 0.36,
      fontFace: T.font.gothic,
      fontSize: fit(churn, leftW - 0.76, rowH - 0.36, { base: T.size.bodySm, min: 9, lineHeight: 1.45 }),
      bold: true, color: D.isPlaceholderText(churn) ? T.color.placeholder : ACCENT,
      valign: 'middle', lineSpacingMultiple: 1.35,
    });
    s.addText(action, {
      x: rightX + 0.38, y: y + 0.18, w: rightW - 0.76, h: rowH - 0.36,
      fontFace: T.font.gothic,
      fontSize: fit(action, rightW - 0.76, rowH - 0.36, { base: T.size.bodySm, min: 9, lineHeight: 1.45 }),
      color: D.isPlaceholderText(action) ? T.color.placeholder : T.color.text,
      valign: 'middle', lineSpacingMultiple: 1.35,
    });
    s.addShape('line', {
      x: leftX + leftW + 0.18, y: y + rowH / 2,
      w: arrowW - 0.36, h: 0,
      line: { color: ACCENT, width: 1.6, endArrowType: 'triangle' },
    });
  });
  return s;
}

/** 口コミ章の6枚を、R1〜R6の順で追加する。 */
function addReviewSlides(pptx, d, footer) {
  // レガシー経路（INPUT に PAGE Rx が無い案件）でも社名固定を使わない
  slideSurvey(pptx, d, footer);
  slideReasonTable(pptx, d, footer, 'love');
  slideReasonTable(pptx, d, footer, 'churn');
  slideOwnDetail(pptx, d, footer);
  slideRatingOrigins(pptx, d, footer);
  slideActions(pptx, d, footer);
}

module.exports = { addReviewSlides };

/* ─────────────────────────────────────────────────────────────
   データ駆動の汎用ページ。
   INPUT の `## PAGE R1` 等をそのまま1枚に描く。
   ページの増減が INPUT の編集だけで済むので、章の構成が変わっても
   スライド関数を書き足さずに追随できる。
   ───────────────────────────────────────────────────────────── */
function slideReviewPage(pptx, page, footer, ownName) {
  const s = addSlide(pptx, {
    qLabel: val(page.label),
    title: val(page.title),
    ...(page.conclusion ? { conclusion: val(page.conclusion), conclusionSub: page.lead ? val(page.lead) : undefined } : {}),
    partTag: PART, accent: ACCENT, footerLeft: footer,
  });

  const hasNote = !!(page.note && String(page.note).trim());
  const noteH = hasNote ? 1.05 : 0;
  const top = page.conclusion ? T.content.top : T.content.topPlain;
  const bottom = T.content.bottom - noteH - (hasNote ? 0.30 : 0);
  let y = top;

  if (page.table && page.table.head && page.table.rows && page.table.rows.length) {
    const cols = page.table.head.length;
    // 1列目（ブランド名・項目名）を広めに、残りは等分
    const first = Math.min(4.20, Math.max(2.40, T.content.w / cols * 1.5));
    const rest = (T.content.w - first) / Math.max(1, cols - 1);
    const colW = [first, ...Array(cols - 1).fill(rest)];
    const head = page.table.head.map((h, i) => (i === 0 ? h : { text: h, align: 'left' }));
    const rows = page.table.rows.map((r) => r.map((c, i) => {
      const own = isOwnName(r[0], ownName);
      return i === 0
        ? { text: val(c), bold: true, color: own ? ACCENT : T.color.text }
        : { text: val(c), color: own ? ACCENT : T.color.text };
    }));
    const r = addDataTable(s, {
      x: T.margin.l, y, w: T.content.w, head, rows, colW,
      fontSize: cols >= 6 ? 11 : T.size.bodySm,
      maxH: bottom - y,
    });
    y += (r ? r.height : 0) + 0.34;
  }

  const blocks = (page.blocks || []).filter((b) => b && (b.heading || b.body));
  // 表で埋まってブロックが入らないときは黙って捨てず、続きページへ送る
  if (blocks.length && y >= bottom - 1.10) {
    if (hasNote) addInsightBox(s, val(page.note), { label: '注記', h: 1.05, maxH: 1.35, chipColor: ACCENT });
    return { slide: s, overflow: blocks };
  }
  if (blocks.length) {
    const gap = 0.50;
    const perRow = blocks.length >= 4 ? 2 : blocks.length;
    const bw = (T.content.w - gap * (perRow - 1)) / perRow;
    const rowsN = Math.ceil(blocks.length / perRow);
    const bh = Math.max(1.10, (bottom - y - gap * (rowsN - 1)) / rowsN);
    blocks.forEach((b, i) => {
      const cx = T.margin.l + (i % perRow) * (bw + gap);
      const cy = y + Math.floor(i / perRow) * (bh + gap);
      if (b.heading) {
        s.addText(val(b.heading), {
          x: cx, y: cy, w: bw, h: 0.38,
          fontFace: T.font.gothic, fontSize: T.size.moduleLabel, bold: true, color: ACCENT,
        });
      }
      const body = val(b.body);
      const byy = cy + (b.heading ? 0.44 : 0);
      const bhh = bh - (b.heading ? 0.44 : 0);
      s.addText(body, {
        x: cx, y: byy, w: bw, h: bhh,
        fontFace: T.font.gothic,
        fontSize: fit(body, bw, bhh, { base: T.size.bodySm, min: 9, lineHeight: 1.5 }),
        color: T.color.text, valign: 'top', lineSpacingMultiple: 1.45,
      });
    });
  }

  if (hasNote) addInsightBox(s, val(page.note), { label: '注記', h: 1.05, maxH: 1.35, chipColor: ACCENT });
  return { slide: s, overflow: [] };
}

/** ページ1枚ぶんを描く。入り切らないブロックは「（続き）」の次ページへ送る。 */
function addReviewPage(pptx, page, footer, ownName) {
  const first = slideReviewPage(pptx, page, footer, ownName);
  let rest = first.overflow || [];
  let guard = 0;
  while (rest.length && guard < 4) {
    guard += 1;
    const cont = slideReviewPage(pptx, {
      label: `${val(page.label)}（続き）`,
      title: val(page.title),
      blocks: rest,
    }, footer, ownName);
    rest = cont.overflow || [];
  }
}

module.exports.slideReviewPage = slideReviewPage;
module.exports.addReviewPage = addReviewPage;
