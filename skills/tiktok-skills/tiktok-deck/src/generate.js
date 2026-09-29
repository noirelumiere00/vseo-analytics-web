// generate.js — INPUT.md から TikTok競合調査PPTXを生成する
// v1.0.0: 正式FMT（TikTok SEARCH DEEP-DIVE）準拠。
//   ・20 × 11.25in ／ クリーム地 ／ 見出しは明朝、本文と数値はゴシック
//   ・比較する数値には横棒を添える
//   ・分析ページには必ず実例サムネイル（検索結果の実カバー画像）を置く
// 正本: FORMAT.md（構成） / DESIGN.md（見せ方） / BUILD_SPEC.md（実装） / CLAUDE.md（ルール）
const fs = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');

const T = require('./theme');
const { parse } = require('./helpers/inputParser');
const D = require('./helpers/data');
const { val, chunkBrands, chunkWithOwn } = D;
const { fit, subSentences, leadAndSub } = require('./helpers/text');
const { addSlide, addDivider, resetPages, setTotal, countSlide, pages, deckSize } = require('./components/slideBase');
const { fitBox } = require('./helpers/imageBox');
const { addInsightBox, insightHeight } = require('./components/insightBox');
const { addDataTable } = require('./components/comparisonTable');
const C = require('./slides/common');
const A = require('./slides/analysis');
const K = require('./slides/keywords');
const MN = require('./slides/mentions');
const V = require('./slides/videos');
const R = require('./slides/reviews');
const S = require('./slides/summary');
const PL = require('./slides/platforms');

// 案件データはスキル本体に置かない。--case で案件ディレクトリを受け取る
const { caseRoot } = require('./helpers/caseRoot');
const ROOT = caseRoot();
const OUT_DIR = path.join(ROOT, 'output');
const { stats, brandColor, clip, img, countMissing, pctNum, ratioOf } = C;

// ───────────────────────────────── 表紙
function slideCover(pptx, d, M) {
  const p = d.project;
  const s = pptx.addSlide();
  countSlide();
  s.background = { color: T.color.bg };
  s.addText(val(p.recipient), {
    x: T.margin.l, y: 0.70, w: 10.0, h: 0.52,
    fontFace: T.font.gothic, fontSize: 18, bold: true, color: T.color.text, valign: 'middle',
  });
  s.addText('CONFIDENTIAL', {
    x: T.slide.w - T.margin.r - 5.0, y: 0.70, w: 5.0, h: 0.52,
    fontFace: T.font.gothic, fontSize: 15, color: T.color.subLight,
    align: 'right', valign: 'middle', charSpacing: 2.4,
  });
  s.addShape('line', { x: T.margin.l, y: 1.34, w: T.content.w, h: 0, line: { color: T.color.rule, width: 1.1 } });

  s.addText('TIKTOK SEARCH DEEP-DIVE REPORT', {
    x: T.margin.l, y: 2.30, w: 12.0, h: 0.44,
    fontFace: T.font.gothic, fontSize: T.size.coverKicker, bold: true,
    color: T.brandColors[0], charSpacing: 3.2, valign: 'middle',
  });
  const names = d.clients.flatMap((c) => c.brands.map((b) => val(b.brand_name)));
  const brandLine = names.length > 3
    ? `${names.slice(0, 3).join(' × ')}　ほか${names.length - 3}ブランド（自社含む）`
    : names.join(' × ');
  s.addText(brandLine, {
    x: T.margin.l, y: 2.84, w: 12.2, h: 0.62,
    fontFace: T.font.mincho,
    fontSize: fit(brandLine, 12.2, 0.56, { base: T.size.coverSub, min: 13, lineHeight: 1.1 }),
    color: T.color.text, charSpacing: 1.4, valign: 'middle',
  });
  // 見出しは「｜」の後ろ（主題）だけを大きく出す。ブランドの列挙は上の行が担う。
  const rawTitle = val(p.project_title);
  const title = rawTitle.includes('｜') ? rawTitle.split('｜').pop().trim() : rawTitle;
  s.addText(title, {
    x: T.margin.l, y: 3.66, w: 11.4, h: 2.15,
    fontFace: T.font.mincho,
    fontSize: fit(title, 11.4, 2.30, { base: T.size.coverTitle, min: 32, lineHeight: 1.18 }),
    bold: true, color: T.color.text, valign: 'middle', lineSpacingMultiple: 1.15,
  });
  // 表紙で約束する工程は、実際にページがある工程だけにする
  const lead = (M && M.videoAnatomy === false)
    ? '「ブランド名」「カテゴリ名」で検索・言及されている動画を実データで全件解析し、'
      + '競合が実際に何をやっているか（誰が・どう語り・何が伸びているか）を明らかにする。'
    : '「ブランド名」「カテゴリ名」で検索・言及されている動画を実データ・実動画で解剖し、'
      + '競合が実際に何をやっているか（誰が・どう語り・何が伸びているか）を明らかにする。';
  s.addText(lead, {
    x: T.margin.l, y: 6.00, w: 10.2, h: 1.30,
    fontFace: T.font.gothic, fontSize: T.size.coverLead, color: T.color.sub,
    valign: 'top', lineSpacingMultiple: 1.55,
  });

  const shots = [];
  d.clients.forEach((c) => c.brands.forEach((b) => {
    const e = (b.q1 && b.q1.example) || {};
    const r = img(e.image_path);
    if (r) shots.push(r);
  }));
  if (shots[0]) s.addImage({ path: shots[0], ...fitBox(shots[0], 13.45, 2.45, 2.62, 4.66) });
  if (shots[1]) s.addImage({ path: shots[1], ...fitBox(shots[1], 16.22, 3.40, 2.62, 4.66) });

  let my = 8.10;
  const meta = [
    ['手法', 'TikTokでブランド名・カテゴリ名を検索（並び替え・フィルターなしのデフォルト表示順）→ 上位表示データを取得 → 全件を同一定義で定量解析'
      + ((M && M.videoAnatomy === false) ? '' : ' → 上位動画の本体を取得 → フレーム単位で構成解剖')],
    ['対象', d.clients.flatMap((c) => c.brands.map((b) => {
      // 自社と競合を区別しないと、見出しの「競合4ブランド」と数が合わないように見える
      const role = d.clients.map((cl) => `${val(cl.client_role)} ${val(cl.client_note)}`).join(' ');
      const head = String(val(b.brand_name)).split(/[ 　]/)[0];
      const own = head && role.includes(head);
      return `${val(b.brand_name)}${own ? '（自社）' : ''} ${String(val(b.total_video_count)).split('（')[0]}本`;
    })).join('／')],
  ];
  const kw = (d.keywords || []).map((k) => `${val(k.keyword)} ${val(k.total_count)}本`).join('／');
  if (kw) meta.push(['検索面', kw]);
  meta.forEach(([k, v]) => {
    s.addShape('line', { x: T.margin.l, y: my, w: 11.6, h: 0, line: { color: T.color.ruleThin, width: 0.9 } });
    s.addText(k, {
      x: T.margin.l, y: my + 0.12, w: 1.2, h: 0.62,
      fontFace: T.font.gothic, fontSize: T.size.coverMeta, bold: true, color: T.color.text, valign: 'top',
    });
    s.addText(v, {
      x: T.margin.l + 1.35, y: my + 0.12, w: 10.2, h: 0.66,
      fontFace: T.font.gothic,
      fontSize: fit(v, 10.2, 0.66, { base: T.size.coverMeta, min: 9.5, lineHeight: 1.42 }),
      color: T.color.sub, valign: 'top', lineSpacingMultiple: 1.35,
    });
    my += 0.82;
  });
  s.addText(val(p.producer), {
    x: T.slide.w - T.margin.r - 6.0, y: 9.62, w: 6.0, h: 0.44,
    fontFace: T.font.gothic, fontSize: 16, bold: true, color: T.color.text,
    align: 'right', valign: 'middle',
  });
  return s;
}

// ───────────────────────────────── 調査設計
function slideMethod(pptx, d, footer, M) {
  const m = M || {};
  const s = addSlide(pptx, {
    qLabel: '設計', title: '何を明らかにし、どう調べたか',
    partTag: 'METHOD',
    // 載せない章を「明らかにする」と書かない。初訪版で動画解剖を約束すると、
    // 資料の中に対応するページが無い＝その場で嘘になる
    lead: m.videoAnatomy === false
      ? '検索面の定量実態から、いま何が起きていて自社がどこにいないかを特定する（動画の構成解剖は次段階）。'
      : '検索面の定量実態と、実動画の構成分析を突き合わせて再現可能な型に落とす。',
    accent: brandColor(0), footerLeft: footer,
  });
  // 本編ページ・PART扉と同じ番号を持たせる（自動採番だとズレる）
  const qs = [
    ['Q1', '誰が取り上げていて、階層ごとの効果は？'],
    ['Q2', '伸びているのは、PRかオーガニックか？'],
    m.q3 === false ? null : ['Q3', 'どんな切り口（界隈）で語られているか？'],
    m.q4 === false ? null : ['Q4', 'どの商品が、どんな文脈で語られるか？'],
    m.q5 === false ? null : ['Q5', '最も伸びている動画は何か？'],
    ['Q6', '検索ワードの面で何が起きているか？'],
    m.videoAnatomy === false ? null : ['Q7', '上位動画はどんな構成か？'],
    m.videoAnatomy === false ? null : ['Q8', '動画の構成に共通パターンはあるか？'],
    // 他プラットフォーム章を載せるなら、設計ページにも掲げる。
    // 掲げていない章が本編に出てくると「調べる約束をしていないことをやった」形になる
    ...((m.platforms === false ? [] : (d.platforms || []))
      .map((pf, i) => [`他面${i + 1}`, `${val(pf.name)}ではどんな発信がされているか？`])),
    ['総括', m.videoAnatomy === false ? '次に何を確かめるか？' : '再現可能な勝ちパターンは何か？'],
  ].filter(Boolean);
  const steps = (m.videoAnatomy === false)
    ? ['TikTokでブランド名・カテゴリ名を検索', '上位表示データを取得（デフォルト表示順）',
      '全件を同一定義で定量解析', '検索ワード面の露出を集計', '自社の空白地帯を特定']
    : ['TikTokでブランド名・カテゴリ名を検索', '上位表示データを取得（デフォルト表示順）',
      '全件を同一定義で定量解析', '上位動画を選定', '実動画を取得', 'フレーム単位で構成解剖',
      ...((m.platforms === false || !(d.platforms || []).length) ? []
        : ['他プラットフォームの発信を検索して型を記述']),
      '横断分析', '勝ちパターン抽出'];
  const nb = d.clients.flatMap((c) => c.brands || []).length;
  const nk = (d.keywords || []).length;
  // 絞り込み条件をコードに焼き込むと、やっていない集計をやったと書くことになる。
  // 集計条件は INPUT の aggregation_note を正とする
  const agg = val((d.project || {}).aggregation_note);
  const note = '検索順位はTikTokアプリが実際に表示した順（デフォルト表示順）。取得時点のスナップショットであり、'
    + 'ログイン状態・地域・閲覧履歴により変動する。'
    + 'PRの判定はTikTokの広告フラグ(isAd)または #PR タグのいずれかで、広告該当性・景表法適合性は判定しない。'
    + (D.isPlaceholderText(agg) ? `ブランド${nb}軸＋市場${nk}ワードを同一手法で取得している。` : agg);
  const colW = (T.content.w - 1.4) / 2;
  // 行間を 0.62in 固定にしていたため、他面の行を1本足しただけで
  // 「前提」帯へ潜り込んだ（p2 で実際に91%重なった）。2列の多いほうに合わせて詰める
  const noteH = insightHeight(note, { h: 1.05 });
  const listTop = T.content.topPlain + 0.58;
  const listRoom = (T.content.bottom - noteH - 0.34) - listTop;
  const step = Math.min(0.62, listRoom / Math.max(qs.length, steps.length));
  const rowH = Math.min(0.48, step - 0.10);
  s.addText('明らかにすること', {
    x: T.margin.l, y: T.content.topPlain, w: colW, h: 0.38,
    fontFace: T.font.gothic, fontSize: T.size.moduleLabel, bold: true, color: brandColor(0),
  });
  qs.forEach(([qno, q], i) => {
    const y = listTop + i * step;
    s.addText(qno, {
      x: T.margin.l, y, w: 0.85, h: rowH,
      fontFace: T.font.gothic, fontSize: T.size.caption, bold: true, color: T.color.subLight, valign: 'middle',
    });
    s.addText(q, {
      x: T.margin.l + 0.90, y, w: colW - 0.90, h: rowH,
      fontFace: T.font.gothic, fontSize: T.size.table, color: T.color.text, valign: 'middle',
    });
    s.addShape('line', { x: T.margin.l, y: y + rowH + 0.04, w: colW, h: 0, line: { color: T.color.ruleThin, width: 0.75 } });
  });
  const rx = T.margin.l + colW + 1.4;
  s.addText('手法', {
    x: rx, y: T.content.topPlain, w: colW, h: 0.38,
    fontFace: T.font.gothic, fontSize: T.size.moduleLabel, bold: true, color: brandColor(0),
  });
  steps.forEach((st, i) => {
    const y = listTop + i * step;
    s.addText(String(i + 1).padStart(2, '0'), {
      x: rx, y, w: 0.70, h: rowH,
      fontFace: T.font.gothic, fontSize: T.size.caption, bold: true, color: brandColor(0), valign: 'middle',
    });
    s.addText(st, {
      x: rx + 0.74, y, w: colW - 0.74, h: rowH,
      fontFace: T.font.gothic, fontSize: T.size.bodySm, color: T.color.text, valign: 'middle',
    });
    s.addShape('line', { x: rx, y: y + rowH + 0.04, w: colW, h: 0, line: { color: T.color.ruleThin, width: 0.75 } });
  });
  addInsightBox(s, note, { label: '前提', h: 1.05 });
  return s;
}

// ───────────────────────────────── 全ブランド横断サマリー
// INPUT の high_response_cluster は実体が「最頻クラスタ（本数構成比）」で、
// 反応の高さを表していない。クラスタ別 avg_eg の最大を取り直す（列名と中身の不一致対策）
function topEgCluster(b) {
  const cs = ((b.q3 || {}).clusters || [])
    .map((c) => ({ name: String(c.name || '').trim(), eg: pctNum(c.avg_eg), n: Number(c.post_count) }))
    .filter((c) => c.name && c.eg !== null);
  if (!cs.length) return val((b.q3 || {}).high_response_cluster);
  const top = cs.reduce((a, c) => (c.eg > a.eg ? c : a));
  const n = Number.isFinite(top.n) ? `${top.n}本・` : '';
  return `${top.name}（${n}平均EG${top.eg.toFixed(2)}%）`;
}

/** 各ブランドで取得しているクラスタ（＝本数上位タグ）の件数。全社で揃っている前提だが、
 *  揃っていなければ最大値を書いて過小申告にならないようにする */
function clusterPool(brands) {
  return Math.max(1, ...brands.map((b) => (((b.q3 || {}).clusters) || []).length));
}

function slideAllBrandSummary(pptx, d, brands, footer) {
  const crossText = val((d.cross || {}).pr_organic_insight);
  const hasCross = crossText && !/NOT PROVIDED/.test(crossText);
  const s = addSlide(pptx, {
    qLabel: '横断', title: '全ブランド横断サマリー',
    partTag: 'PART 1 — 検索面の実態',
    ...(hasCross ? leadAndSub(crossText) : {}),
    // 「7ブランド」を焼き込むと5社案件で嘘になる。件数はデータから出す。
    // 右端は「本数上位Nタグの中の最大」。Q3の掲載枚数とは無関係なので
    // 「掲載したクラスタの中で」と書くのは誤り（実際に取り違えていた）
    lead: `${brands.length}ブランドの本数・#PR比率・PR別／非PR別の平均EG率を1枚で突き合わせる。`
      + `右端は本数上位${clusterPool(brands)}タグの中で平均EGが最も高い切り口（全タグの最大ではない）。`,
    accent: brandColor(0), footerLeft: footer,
  });
  // 非PRの母数を出さないと、n=1の6.88%が7社中最長のバーになり「自然投稿が競合の3〜4倍強い」と読める
  const organicN = (b) => {
    const t = Number(String(val((b.q2 || {}).total_count)).replace(/[^0-9]/g, ''));
    const pr = Number(String(val((b.q2 || {}).pr_count)).replace(/[^0-9]/g, ''));
    return (Number.isFinite(t) && Number.isFinite(pr) && t >= pr) ? t - pr : null;
  };
  const head = ['ブランド', { text: '対象本数', align: 'right' }, { text: '#PR比率', align: 'right' },
    { text: 'PR平均EG率', align: 'right' }, { text: '非PR平均EG率（母数）' }, '最も反応が高い切り口'];
  const colW = [3.55, 1.70, 1.70, 2.30, 3.15, 5.30];
  const egs = brands.map((b) => pctNum((b.q2 || {}).organic_avg_eg));
  const maxEg = Math.max(...egs.filter((v) => v !== null), 0.01);
  const rows = brands.map((b, i) => [
    { text: clip(val(b.brand_name), 18), bold: true, color: brandColor(i) },
    { text: String(val(b.total_video_count)).split('（')[0], align: 'right' },
    { text: val((b.q2 || {}).pr_share), align: 'right' },
    { text: val((b.q2 || {}).pr_avg_eg), align: 'right' },
    { text: organicN(b) !== null
      ? `${val((b.q2 || {}).organic_avg_eg)}（${organicN(b)}本）`
      : val((b.q2 || {}).organic_avg_eg), bold: true,
    bar: { ratio: ratioOf(pctNum((b.q2 || {}).organic_avg_eg), maxEg), color: brandColor(i) } },
    clip(topEgCluster(b), 40),
  ]);
  const roomX = T.content.bottom - T.content.top - 0.20;
  addDataTable(s, { x: T.margin.l, y: T.content.top, w: T.content.w, head, rows, colW,
    rowH: Math.min(1.05, (roomX - 0.60) / Math.max(1, rows.length)), maxH: roomX });
  return s;
}

// ───────────────────────────────── 資料モード
// 初回訪問(quick)と提案(full)で同じデータから別の資料を出す。
// 章を足し引きするだけにして、ページの中身は共通のままにする
// （初訪用に別レンダラを作ると、直した内容が片方に反映されず食い違う）
// 営業ステータスごとに、どの章を載せるか。
// 章の中身は共通のまま、足し引きだけで作り分ける
// （ステータス別に別レンダラを作ると、直した内容が片方に反映されず食い違う）。
//
// 「レポート」は施策前後の比較データが要る。FMT は単発スナップショットしか
// 持たないので、黙って現状資料を出さずエラーで止める（偽の効果測定を作らない）。
const MODES = {
  初訪: {
    label: '初回訪問', suffix: '_初訪', alias: ['quick', '初回', '初回訪問'],
    q3: false, q4: false, q5: false, allBrandSummary: true,
    kwSaves: false, kwVideos: false, videoAnatomy: false,
    mentions: true,
    reviews: false, patterns: false, platforms: false,
  },
  具体提案: {
    label: '具体提案', suffix: '', alias: ['deep', 'full', '提案'],
    q3: true, q4: true, q5: true, allBrandSummary: true,
    kwSaves: true, kwVideos: true, videoAnatomy: true,
    mentions: true,
    reviews: true, patterns: true, platforms: true,
  },
  構成提案: {
    // 動画の作り方を決める資料。定量は最小限にして構成解剖に寄せる
    label: '構成提案', suffix: '_構成', alias: ['構成'],
    q3: false, q4: false, q5: true, allBrandSummary: false,
    kwSaves: false, kwVideos: true, videoAnatomy: true,
    mentions: true,
    reviews: false, patterns: true, platforms: false,
  },
  競合差再提案: {
    // 競合との差だけを見る。動画解剖は入れず、定量比較に寄せる
    label: '競合差再提案', suffix: '_競合差', alias: ['競合差', '再提案'],
    q3: true, q4: true, q5: true, allBrandSummary: true,
    kwSaves: true, kwVideos: false, videoAnatomy: false,
    mentions: true,
    reviews: true, patterns: false, platforms: true,
  },
  レポート: {
    label: 'レポート', suffix: '_レポート', alias: ['report', '効果測定'],
    requiresBaseline: true,
    q3: true, q4: true, q5: true, allBrandSummary: true,
    kwSaves: true, kwVideos: false, videoAnatomy: false,
    mentions: true,
    reviews: false, patterns: false, platforms: false,
  },
};

/** 別名（quick / deep 等）を正式なステータス名に寄せる */
function canonicalMode(name) {
  if (MODES[name]) return name;
  for (const [k, v] of Object.entries(MODES)) {
    if ((v.alias || []).includes(name)) return k;
  }
  return null;
}

/** 複数ステータスを1資料に統合する。章は和集合を取る */
function mergeModes(names) {
  const base = { label: names.join('＋'), suffix: '_' + names.join('') };
  const keys = ['q3', 'q4', 'q5', 'allBrandSummary', 'kwSaves', 'kwVideos', 'mentions',
    'videoAnatomy', 'reviews', 'patterns', 'platforms'];
  keys.forEach((k) => { base[k] = names.some((n) => MODES[n][k]); });
  base.requiresBaseline = names.some((n) => MODES[n].requiresBaseline);
  return base;
}

function resolveMode(d) {
  const i = process.argv.indexOf('--mode');
  const cli = i >= 0 ? process.argv[i + 1] : null;
  const raw = String(cli || process.env.DECK_MODE
    || val((d.settings || {}).deck_mode) || '具体提案').trim();
  // 「初訪,競合差再提案」のように複数指定できる
  const parts = raw.split(/[,、＋+]/).map((x) => x.trim()).filter(Boolean);
  const names = parts.map((p) => {
    const c = canonicalMode(p);
    if (!c) {
      // 黙って既定へ落とすと、初訪のつもりで全ページが出る
      throw new Error(`未知の資料モード: ${p}\n`
        + `  使えるのは ${Object.keys(MODES).join(' / ')}`
        + `（別名: quick=初訪, deep=具体提案）`);
    }
    return c;
  });
  const m = names.length === 1
    ? { name: names[0], ...MODES[names[0]] }
    : { name: names.join('＋'), ...mergeModes(names) };
  if (m.requiresBaseline) {
    const bl = val((d.project || {}).baseline_period);
    if (!bl || D.isPlaceholderText(bl)) {
      throw new Error('レポート資料には施策前の基準データが要ります。\n'
        + '  PROJECT に baseline_period が無いため生成を止めました。\n'
        + '  基準が無いまま出すと、後から取った値を施策前と偽ることになります。');
    }
  }
  return m;
}

// ───────────────────────────────── main
function main() {
  const inputPath = path.join(ROOT, 'INPUT.md');
  if (!fs.existsSync(inputPath)) {
    throw new Error(`INPUT.md がありません: ${inputPath}\n`
      + '  案件ディレクトリを --case で渡してください。例:\n'
      + '    node src/generate.js --case ../案件_XXX --mode 初訪\n'
      + '  先に build_input_md.py と merge_authored.py を同じ --case で実行しておくこと');
  }
  const d = parse(inputPath);
  countMissing(d);
  const M = resolveMode(d);

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'FMT', width: T.slide.w, height: T.slide.h });
  pptx.layout = 'FMT';

  const brands = d.clients.flatMap((c) => c.brands);
  d.brands = brands;   // 各Qのバー満尺を「全ブランド共通の最大値」に固定するため（ページ間で長さを比較可能に）
  // 先頭2社だけ並べると7ブランド比較の資料が「2社案件」に見える。自社×競合数で表す
  // 社名の既定値をコードに置かない。INPUT に client_name が無ければ先頭ブランドを自社として扱う
  const ownKey = String(val((d.clients[0] || {}).client_name) || '').trim();
  const ownName = val(((ownKey
    ? brands.find((b) => String(b.brand_name || '').toLowerCase().includes(ownKey.toLowerCase()))
    : null) || brands[0] || {}).brand_name);
  const footer = brands.length > 2
    ? `TIKTOK SEARCH DEEP-DIVE — ${ownName} × 競合${brands.length - 1}ブランド`
    : `TIKTOK SEARCH DEEP-DIVE — ${brands.map((b) => val(b.brand_name)).slice(0, 2).join(' × ')}`;
  // ブランドごとに色を固定する。ページ単位でずらすと、同じ社が別ページで別色になり
  // 7社目が自社の色に回り込む（p6で比較ブランドが自社の色になっていた）
  brands.forEach((b, i) => { b.colorIndex = i; });
  const isOwnBrand = (b) => (ownKey
    ? String(b.brand_name || '').toLowerCase().includes(ownKey.toLowerCase())
    : b === brands[0]);
  const chunks = chunkWithOwn(brands, (d.settings && d.settings.max_brands_per_comparison_slide) || 3, isOwnBrand);
  const kws = d.keywords || [];
  const analyzed = [];
  brands.forEach((b, bi) => (b.videos || []).forEach((v) => analyzed.push({ b, v, bi })));
  const patterns = (d.cross || {}).patterns || [];

  // ページ総数は手計算だと構成を変えるたびにズレる。
  // 一度そのまま組み立てて実数を数え、その値でフッターを入れて本番を組み直す。
  const buildAll = (deck) => {
    slideCover(deck, d, M);
    slideMethod(deck, d, footer, M);

    addDivider(deck, {
      partIndex: 1, name: '検索面の実態',
      // 説明文も載せるページから組む。固定文にすると初訪版で
      // 「クラスタ・商品別・最上位動画を明らかにする」と書いたページが1枚も無くなる
      desc: '各ブランドの検索結果を全件解析し、'
        + ['フォロワー階層別のパフォーマンス', 'PRとオーガニックの効果差',
          M.q3 ? '語られ方のクラスタ' : null,
          M.q4 ? '商品別の取り上げられ方' : null,
          M.q5 ? '最上位動画' : null].filter(Boolean).join('・')
        + 'を明らかにする。',
      items: [
        { q: 'Q1', text: '誰が取り上げていて、階層ごとの効果は？' },
        { q: 'Q2', text: '伸びているのは、PRかオーガニックか？' },
        M.q3 ? { q: 'Q3', text: 'どんな切り口（界隈）で語られているか？' } : null,
        M.q4 ? { q: 'Q4', text: 'どの商品が、どんな文脈で語られるか？' } : null,
        M.q5 ? { q: 'Q5', text: '最も伸びている動画は何か？' } : null,
      ].filter(Boolean),
      footerLeft: footer,
    });
    chunks.forEach((ch, ci) => A.slideQ1(deck, d, ch, ci, chunks, footer, ci * 3));
    chunks.forEach((ch, ci) => A.slideQ2(deck, d, ch, ci, chunks, footer, ci * 3));
    if (M.q3) chunks.forEach((ch, ci) => A.slideQ3(deck, d, ch, footer, ci, chunks, ci * 3));
    if (M.q4) chunks.forEach((ch, ci) => A.slideQ4(deck, d, ch, ci, chunks, footer, ci * 3));
    if (M.q5) A.slideQ5(deck, d, brands, footer);
    if (M.allBrandSummary) slideAllBrandSummary(deck, d, brands, footer);

    if (kws.length) {
      addDivider(deck, {
        partIndex: 2, name: '検索ワードの露出実態',
        desc: 'ブランド名ではなくカテゴリ名で検索したときに、どんな動画が上位に出て、何が保存されているかを見る。'
          + '自社が出ていない面（空白地帯）を特定する。',
        items: kws.map((k, i) => ({ q: `Q6-${i + 1}`, text: `「${val(k.keyword)}」の上位と保存` })),
        footerLeft: footer,
      });
      kws.forEach((k, ki) => {
        K.slideKwHead(deck, k, ki, footer);
        if (M.kwSaves) K.slideKwSaves(deck, k, ki, footer, d);
      });
      K.slideKwSummary(deck, d, footer);
    }
    // 02-analyze を回した案件だけ、動画の中での言及回数を1枚出す。
    // 回していない場合は付録の「言及回数の計測」行が未計測であることを述べる
    if (M.mentions !== false) MN.slideMentions(deck, d, footer);
    {
      // 検索ワード面の上位投稿を1本ずつ解剖（ブランド軸の Q7 と同じ2ページ構成）
      const kwv = M.kwVideos ? (d.keywordVideos || []) : [];
      kwv.forEach((v, i) => {
        const pseudo = { brand_name: `「${val(v.axis_name)}」` };
        V.slideVideoDetail(deck, pseudo, v, 0, i, footer, 'KW');
        V.slideVideoStoryboard(deck, pseudo, v, 0, i, footer, 'KW');
      });
    }

    // 口コミ章（⑥）は競合差（PART1/2）の直後・動画構成（PART3=方向性②/実行案③）の前に置く。
    // 章の流れ:「現状把握①＋競合差 → 市場の空白地帯 → クチコミ → 方向性②＋実行案③ → 締め」。
    if (M.reviews && d.reviews) {
      const rp = (d.reviews.pages || []).filter((p) => p && p.label);
      // `## PAGE Rx` があればそれを正としてページ順に描く（章の構成は INPUT 側で決める）
      if (rp.length) rp.forEach((page) => R.addReviewPage(deck, page, footer, ownName));
      else R.addReviewSlides(deck, d, footer);
    }

    // 動画を1本も解剖していない案件（初訪モード等）では PART 3 ごと出さない。
    // 出すと「一覧」「Q7」「Q8」が全欠損のページとして並ぶ
    if (M.videoAnatomy && analyzed.length) {
    addDivider(deck, {
      partIndex: 3, name: '実際に動画を確認する',
      desc: `各ブランドの実績上位から選んだ動画を、フレーム単位で構成解剖する。`
        + (() => {
          // 「取得できた◯本」と書くと、取得の限界で本数が決まったように読める。
          // 実際は取得成功10本から6本を選定していた（p22で誤読を招いた）
          const got = parseInt(String(val((d.project || {}).media_acquired)).replace(/[^0-9]/g, ''), 10);
          // 静止画カルーセルはコマ送りが無く、この解剖の対象にできない。
          // 書かないと「選ばれなかった＝良くなかった」と読まれる
          const excl = 'なお静止画カルーセルの投稿はコマ送りが無いため、本章の構成解剖の対象外である'
            + '（各面の写真比率は Part 2 の各ページに記載）。';
          return Number.isFinite(got) && got > analyzed.length
            ? `検索上位の候補を一覧で示したうえで、動画実体を取得できた ${got} 本から選んだ ${analyzed.length} 本を1本ずつ解剖する。${excl}`
            : `検索上位の候補を一覧で示したうえで、動画実体まで取得できた ${analyzed.length} 本を1本ずつ解剖する。${excl}`;
        })(),
      items: [
        { q: '一覧', text: '構成解剖の対象にした動画' },
        { q: 'Q7', text: '動画ごとの構成解剖' },
        { q: 'Q8', text: '動画構成から見える共通パターン' },
        { q: '総括', text: '実動画から見える勝ちパターン' },
      ],
      footerLeft: footer,
    });
    const topN = parseInt(val((d.settings || {}).video_list_top_n), 10) || 4;
    chunks.forEach((ch, ci) => V.slideVideoTable(deck, ch, footer, topN, ci, chunks.length, analyzed.length));
    analyzed.forEach((a, i) => {
      V.slideVideoDetail(deck, a.b, a.v, a.bi, i, footer);
      V.slideVideoStoryboard(deck, a.b, a.v, a.bi, i, footer);   // 5コマの構成ページを続けて置く
    });
    V.slideQ8(deck, d, footer);
    }

    // 他プラットフォーム章。TikTok以外の面での語られ方を提案版だけに足す
    const plats = M.platforms === false ? [] : (d.platforms || []);
    if (plats.length) {
      addDivider(deck, {
        partIndex: 4, name: '他プラットフォームの発信実態',
        desc: 'TikTok検索面の外で、同じブランドがどう語られているかを見る。'
          + '面ごとに取得できる指標が違うため、反応量ではなく「発信の型」と「誰が発信しているか」で並べる。',
        items: plats.map((pf, i) => ({ q: `他面${i + 1}`, text: `${val(pf.name)}での発信の型` })),
        footerLeft: footer,
      });
      plats.forEach((pf, i) => {
        PL.slidePlatform(deck, pf, i, footer);
        PL.slidePlatformAccounts(deck, pf, i, footer);
      });
    }

    if (M.patterns && patterns.length) S.slidePatterns(deck, patterns, footer);
    S.slideFinal(deck, d, footer, M);
    S.slideAppendix(deck, d, footer);
  };

  const PptxCtor = pptx.constructor;
  const probe = new PptxCtor();
  probe.defineLayout({ name: 'FMT', width: T.slide.w, height: T.slide.h });
  probe.layout = 'FMT';
  setTotal(0);
  resetPages();
  // 試し組みの集計を本番に持ち込まないよう、前後で退避・復元する
  const snap = { images: stats.images, missingImage: stats.missingImage,
    missingData: stats.missingData, qa: stats.qaFixes.length,
    missingList: stats.missingImageList.length,
    undeclared: stats.undeclaredImages.length };
  buildAll(probe);
  const total = deckSize();
  stats.images = snap.images;
  stats.missingImage = snap.missingImage;
  stats.missingData = snap.missingData;
  stats.qaFixes.length = snap.qa;
  // 試し組みで拾った欠落を本番の一覧に持ち込まない
  stats.missingImageList.length = snap.missingList;
  stats.undeclaredImages.length = snap.undeclared;

  setTotal(total);
  resetPages();
  buildAll(pptx);

  stats.slides = deckSize();
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `TikTok_Competitive_Research${M.suffix}.pptx`);
  return pptx.writeFile({ fileName: out }).then(() => {
    const log = [
      '# generation_log',
      '',
      `- 生成: ${stats.slides} スライド（20 × 11.25 in）／資料モード: ${M.name}（${M.label}）`,
      `- ブランド: ${brands.length} / 検索ワード: ${kws.length} / 構成解剖した動画: ${M.videoAnatomy ? analyzed.length : 0}`,
      `- 使用画像: ${stats.images} 枚`,
      `- 宣言があるのに実体が無い画像: ${(stats.missingImageList || []).length}`,
      `- 画像欄そのものが無い箇所: ${(stats.undeclaredImages || []).length}`
        + `（その欄を使わない案件では正常）`,
      ...((stats.missingImageList || []).length
        ? ['', '### 宣言があるのに実体が無い画像（要修正）',
           ...[...new Set(stats.missingImageList)].map((p) => `  - ${p}`)]
        : []),
      ...((stats.undeclaredImages || []).length
        ? ['', '### 画像欄そのものが無い箇所（参考）',
           ...[...new Set(stats.undeclaredImages)].map((p) => `  - ${p}`)]
        : []),
      `- INPUT.md全体の [DATA NOT PROVIDED]: ${stats.missingData} 箇所（スライド上に出るのはその一部）`,
      '',
      '## QA fixes',
      ...(stats.qaFixes.length ? stats.qaFixes.map((x) => `  - ${x}`) : ['  - なし']),
      '',
    ].join('\n');
    fs.writeFileSync(path.join(OUT_DIR, `generation_log${M.suffix}.md`), log);
    console.log(`スライド ${stats.slides}枚 / ブランド ${brands.length} / 動画 ${analyzed.length}`);
    console.log(`使用画像 ${stats.images} / 未解決画像 ${stats.missingImage} / INPUT全体の欠損 ${stats.missingData}`);
    console.log(`QA警告 ${stats.qaFixes.length}件（generation_log${M.suffix}.md 参照）`);
    console.log(`→ ${out}`);
  });
}

main();
