// keywords.js — PART1.5（検索ワードの露出実態）
// 正式FMT準拠：左に上位表、右レールに実例サムネ、下に「発見」帯。
const T = require('../theme');
const D = require('../helpers/data');
const { val, num } = D;
const { fit, leadAndSub } = require('../helpers/text');
const { addSlide } = require('../components/slideBase');
const { addInsightBox, insightHeight, addExampleColumn } = require('../components/insightBox');
const { addDataTable } = require('../components/comparisonTable');
const C = require('./common');

// 表が使える最大高さ（下の発見帯とフッターに触れない）
const TABLE_MAX = T.content.bottom - 1.55 - T.content.top;
/** そのページの発見帯の実高さを引いた、表に使える高さ */
function tableRoom(text, opts) {
  return T.content.bottom - insightHeight(text, opts || {}) - 0.34 - T.content.top;
}

const { EX_W, MAIN_W, brandColor, clip, pctNum, img, ratioOf } = C;
const PARTK = 'PART 2 — 検索ワードの露出実態';   // 中扉の PART 2 と揃える
const EX_X = T.slide.w - T.margin.r - EX_W;

// 表の1セルに入れるのはキャプション全文ではなく、タグを落とした先頭の実文だけ。
// ハッシュタグの途中で切れると打ち間違いに見えるので、タグは丸ごと落とす
function captionGist(cap) {
  const t = String(D.val(cap));
  if (D.isPlaceholderText(t)) return t;
  // タグを丸ごと落として実文だけ残す。先頭からタグが並ぶ投稿もあるため
  // 「最初の#まで」ではなく全タグを除去する
  const body = t.replace(/[#＃][^\s#＃]+/g, ' ').replace(/\s+/g, ' ').trim();
  return body || t;
}

/** ワード別：上位10本の一覧＋実例 */
function slideKwHead(pptx, kw, ki, footer) {
  const s = addSlide(pptx, {
    qLabel: `Q6-${ki + 1}`,
    title: `「${val(kw.keyword)}」で上位に出ているのは何か？`,
    ...(() => {
      const hi = val((kw.findings || {}).head_insight);
      if (D.isPlaceholderText(hi)) return {};
      return leadAndSub(hi);
    })(),
    partTag: PARTK,
    lead: (() => {
      const rk = (kw.head || []).slice(0, 10).map((h) => parseInt(String(val(h.rank)).replace(/[^0-9]/g, ''), 10));
      const gap = rk.some((v, i) => i > 0 && v !== rk[i - 1] + 1);
      return `検索上位のうち先頭${(kw.head || []).length}本。順位は検索結果そのものの順位${gap ? 'で、海外投稿を除いたため飛びが出る' : '（この面では飛びなし）'}。母数 ${val(kw.total_count)}本。投稿者名がリンクです。`;
    })(),
    accent: brandColor(ki), footerLeft: footer,
  });
  // 内容タイプはキーワード軸では未分類（ブランド軸のみ実施）。空列を出さない
  const head = [{ text: '順位', align: 'right' }, '投稿者', '投稿の中身', '階層',
    { text: '再生数', align: 'right' }, { text: 'EG率' },
    { text: '保存率', align: 'right' }, '#PR'];
  // #PR列が0.75inだと「なし」が2行に割れる。棒付きで余裕のあるEG率列から0.40inを回す
  // （中身列から取ると投稿本文の切り詰めが増える）
  const colW = [0.80, 2.80, 3.30, 1.30, 1.85, 1.75, 1.15, 1.15];   // 合計14.10＝MAIN_W
  const rows0 = (kw.head || []).slice(0, 10);
  const maxEg = Math.max(...rows0.map((h) => pctNum(h.eg)).filter((v) => v !== null), 0.01);
  const rows = rows0.map((h) => [
    { text: val(h.rank), align: 'right' },
    { text: clip(val(h.creator), 13), url: h.url }, clip(captionGist(h.caption), 22), val(h.tier),
    { text: num(h.views), align: 'right' },
    // バーはブランド識別色を使わない（赤＝自社の色が他社投稿のバーに出て意味が入れ替わる）
    { text: val(h.eg), bold: true, bar: { ratio: ratioOf(pctNum(h.eg), maxEg), color: T.color.bar } },
    { text: val(h.save_rate), align: 'right' },
    val(h.is_pr),
  ]);
  const comp = kw.composition || {};
  // 「分類対象外」のような処理都合の値は発見欄に出さない（クライアント面に作業事情を露出させない）
  const mix = val(comp.cluster_mix);
  const showMix = !D.isPlaceholderText(mix) && !/対象外|未分類|未実施/.test(String(mix));
  // 媒体の内訳は全面で出す。1面（写真1.6%）だけ書いて他面（20〜25%）で黙ると、
  // 「どんな動画か」という見出しの下に写真投稿が並ぶ状態を読み手が見抜けない
  const mm = val(comp.media_mix);
  const body = [
    showMix ? `内容タイプ（この面の全${(kw.head || []).length ? val(kw.total_count) : '—'}本）：${mix}` : null,
    `投稿者階層：${val(comp.tier_mix)}／#PR：${val(comp.pr_count)}`,
    D.isPlaceholderText(mm) ? null : `媒体：${mm}`,
    val(comp.insight),
  ].filter(Boolean).join('\n');
  const opt = { label: '発見', h: 1.35, maxH: 2.20 };
  const rk = addDataTable(s, {
    x: T.margin.l, y: T.content.top, w: MAIN_W, head, rows, colW, maxH: tableRoom(body, opt),
  });
  if (rk && rk.dropped) {
    D.stats.qaFixes.push(`${val(kw.keyword)}: ${rk.dropped}行が入りきらずスライド外`);
    // 黙って落とさない。宣言した本数と掲載本数の差を紙面に書く
    s.addText(`※このページに入り切らなかった ${rk.dropped} 本は非掲載（順位は取得時の表示順）。`, {
      x: T.margin.l, y: T.content.top + (rk.height || 0) + 0.06, w: MAIN_W, h: 0.26,
      fontFace: T.font.gothic, fontSize: T.size.captionSm, color: T.color.subLight,
      valign: 'top',
    });
  }
  const top = rows0[0] || {};
  addExampleColumn(s, {
    x: EX_X, y: T.content.top, w: EX_W, imgH: 4.55, title: '上位の実例',
    image: img(top.image_path),
    caption: `${val(top.creator)}\n検索${val(top.rank)}位／${val(top.views)}再生・EG${val(top.eg)}\n保存率${val(top.save_rate)}`,
    url: top.url,
    bottom: T.content.bottom - insightHeight(body, opt) - 0.24,
  });
  addInsightBox(s, body, opt);
  return s;
}

/** ワード別：保存を集めた型とブランド露出 */
function slideKwSaves(pptx, kw, ki, footer, d) {
  const f0 = kw.findings || {};
  const sp = val(f0.save_pattern);
  const hasSp = sp && !/NOT PROVIDED/.test(sp);
  const s = addSlide(pptx, {
    qLabel: `Q6-${ki + 1}b`,
    // 「動画」と決め打つと、上位が写真カルーセルの面で見出し自体が嘘になる
    title: `「${val(kw.keyword)}」で保存率が高いのはどんな投稿か？`,
    partTag: PARTK,
    ...(hasSp ? leadAndSub(sp) : {}),
    lead: (() => {
      const meta = kw.saveTopMeta || {};
      const lim = val(meta.rate_rank_min_views);
      const dropped = val(meta.rate_rank_dropped);
      const floorNote = D.isPlaceholderText(lim) ? ''
        : `率の順位は再生${lim}以上に限定（${dropped}本を対象外）。`;
      return `保存率の上位5本と、この面に出ているブランド。${floorNote}投稿者名がリンクです。`;
    })(),
    accent: brandColor(ki), footerLeft: footer,
  });
  const f = f0;
  // 内容タイプはキーワード軸では未分類。列を出さず、順位は「保存数の順位」と明示する
  // 抽出は保存率降順。見出しを「保存数順」にすると並び順が嘘になる
  // 媒体列を出す。写真カルーセルが上位を占める面があり、
  // 列が無いと「動画の話」として読まれる
  const head = [{ text: '表示順', align: 'right' }, '投稿者', '投稿の中身', '媒体',
    { text: '再生数', align: 'right' }, { text: '保存数', align: 'right' },
    { text: '保存率' }, { text: 'EG率', align: 'right' }, '#PR'];
  // #PR列は上位表（slideKwHead）と同じ1.15inにする。片方だけ広げると
  // 同じ「なし／あり」が面によって1行と2行に分かれる
  const colW = [1.15, 2.50, 2.60, 0.90, 1.85, 1.55, 1.70, 1.40, 1.15];   // 合計14.80＝MAIN_W
  const rows0 = (kw.saveTop || []).slice(0, 5);
  const maxSr = Math.max(...rows0.map((v) => pctNum(v.save_rate)).filter((v) => v !== null), 0.01);
  const rows = rows0.map((v) => [
    { text: val(v.rank), align: 'right' }, { text: clip(val(v.creator), 12), url: v.url }, clip(captionGist(v.caption), 18),
    val(v.media),
    { text: num(v.views), align: 'right' }, { text: num(v.saves), align: 'right' },
    { text: val(v.save_rate), bold: true, bar: { ratio: ratioOf(pctNum(v.save_rate), maxSr), color: brandColor(ki) } },
    { text: val(v.eg), align: 'right' }, val(v.is_pr),
  ]);
  const sopt = { label: '発見', h: 1.30, maxH: 2.20 };
  const stext = val(f.save_pattern);
  const rs = addDataTable(s, {
    x: T.margin.l, y: T.content.top, w: MAIN_W, head, rows, colW, maxH: tableRoom(stext, sopt),
  });
  if (rs && rs.dropped) D.stats.qaFixes.push(`${val(kw.keyword)}(保存): ${rs.dropped}行が入りきらずスライド外`);
  const afterTable = T.content.top + (rs ? rs.height : 3.60) + 0.30;
  const top = rows0[0] || {};
  addExampleColumn(s, {
    // 「保存TOP1」だと本文の保存率1位（別投稿）と同じラベルになり、0.51%と1.40%が矛盾して見える
    x: EX_X, y: T.content.top, w: EX_W, imgH: 4.55, title: '保存率1位',
    image: img(top.image_path), url: top.url,
    caption: `${val(top.creator)}\n保存${val(top.saves)}（${val(top.save_rate)}）\nEG${val(top.eg)}／#PR ${val(top.is_pr)}`,
    bottom: T.content.bottom - 0.20,
  });
  // ブランド別の本数。自社が0本でも必ず末尾に出す（3面で扱いを揃え、不在を明示する）
  // 社名の既定値をコードに置かない（無い案件で前の案件の社名が別の資料に出る）
  const own = String(D.val(((d.clients || [])[0] || {}).client_name) || '').trim()
    || String(D.val((((d.clients || [])[0] || {}).brands || [])[0] || {}).brand_name || '').trim();
  // 上位5件で切ると面ごとに欠けるブランドが変わり、3面で扱いが揃わない。全社を本数降順で出す
  const known = (((d.clients || [])[0] || {}).brands || []).map((b) => val(b.brand_name));
  const got = new Map((kw.brandExposure || []).map((x) => [val(x.brand), val(x.count)]));
  const exp = known.map((b) => ({ b, c: got.has(b) ? got.get(b) : '0' }))
    .sort((p1, p2) => (parseInt(p2.c, 10) || 0) - (parseInt(p1.c, 10) || 0));
  if (!exp.some((x) => String(x.b).includes(own))) exp.push({ b: own, c: '0' });
  // 1ブランド1行だと5社で5行になり、行間1.5では9ptでも枠に入らない（フッターへ潜る）。
  // 横並びにすれば同じ情報が1〜2行で収まり、順位の比較もしやすい
  const be = exp.map((x) => `${x.b} ${x.c}本`).join('　／　');
  s.addText('この面のブランド別本数（自社を含む）', {
    x: T.margin.l, y: afterTable, w: MAIN_W, h: 0.36,
    fontFace: T.font.gothic, fontSize: T.size.moduleLabel, bold: true, color: brandColor(ki),
  });
  // 固定フォントだと5行が枠を超えてフッターに重なる。高さに合わせて縮める
  const beText = be || D.PLACEHOLDER_DATA;
  const beH = Math.max(0.8, T.content.bottom - 0.30 - (afterTable + 0.42));
  s.addText(beText, {
    x: T.margin.l, y: afterTable + 0.42, w: MAIN_W, h: beH,
    fontFace: T.font.gothic,
    fontSize: fit(beText, MAIN_W, beH, { base: T.size.bodySm, min: 9, lineHeight: 1.5 }),
    color: T.color.text, valign: 'top', lineSpacingMultiple: 1.5,
  });
  return s;
}

/** 3ワード横断 */
function slideKwSummary(pptx, d, footer) {
  const ws0 = val((d.keywordSummary || {}).whitespace);
  const s = addSlide(pptx, {
    qLabel: 'Q6総括', title: '検索ワード横断｜どの面を、どの型で取りにいくか',
    ...(D.isPlaceholderText(ws0) ? {} : (() => {
      return leadAndSub(ws0);
    })()),
    partTag: PARTK, lead: '本数の少なさだけを空白と呼ばない。反応（保存率・#PR率）と併せて判断する。',
    accent: brandColor(0), footerLeft: footer,
  });
  const rows0 = (d.keywordSummary || {}).rows || [];
  // EG率は3面とも未計測。取得できている指標だけで組む（空列を作らない）
  // 見出しに統計量を焼き込まない。案件ごとに avg_save_rate が平均か中央値か違うため、
  // データ側の save_rate_basis を見出しにする（案件によって平均か中央値かが違う）。
  // 焼き込んでいたせいで「中央値」の列と本文の「平均」が同一ページで矛盾した
  const basis = (() => {
    const b = val((rows0[0] || {}).save_rate_basis);
    return D.isPlaceholderText(b) ? '' : String(b).trim();
  })();
  const head = ['検索ワード', '取得本数', { text: '#PR率', align: 'right' },
    { text: `保存率${basis}` },
    '保存を集めていた型', { text: '自社露出', align: 'right' }];
  const colW = [3.05, 3.40, 1.45, 2.95, 5.55, 1.30];
  const maxSv = Math.max(...rows0.map((r) => pctNum(r.avg_save_rate)).filter((v) => v !== null), 0.01);
  const rows = rows0.map((r, i) => [
    val(r.keyword), val(r.total_count), { text: val(r.pr_share), align: 'right' },
    { text: val(r.avg_save_rate), bold: true,
      bar: { ratio: ratioOf(pctNum(r.avg_save_rate), maxSv), color: brandColor(i) } },
    val(r.save_type), { text: val(r.own_exposure), align: 'right' },
  ]);
  const rsum = addDataTable(s, {
    x: T.margin.l, y: T.content.top, w: T.content.w, head, rows, colW,
    maxH: T.content.bottom - T.content.top - 2.60,
  });
  const afterSum = T.content.top + (rsum ? rsum.height : 3.30) + 0.30;

  const save = (d.keywords || []).map((k) => `${val(k.keyword)}：${val((k.findings || {}).save_pattern)}`).join('\n');
  s.addText('保存を集める型', {
    x: T.margin.l, y: afterSum, w: T.content.w, h: 0.36,
    fontFace: T.font.gothic, fontSize: T.size.moduleLabel, bold: true, color: brandColor(0),
  });
  const saveH = Math.max(0.8, T.content.bottom - 0.25 - (afterSum + 0.42));
  s.addText(save, {
    x: T.margin.l, y: afterSum + 0.42, w: T.content.w, h: saveH,
    fontSize: fit(save, T.content.w, saveH, { base: T.size.bodySm, min: 8.5, lineHeight: 1.5 }),
    fontFace: T.font.gothic, color: T.color.text,
    valign: 'top', lineSpacingMultiple: 1.5,
  });
  return s;
}

module.exports = { slideKwHead, slideKwSaves, slideKwSummary };
