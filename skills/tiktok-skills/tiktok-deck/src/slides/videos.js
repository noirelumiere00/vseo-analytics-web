// videos.js — PART2（動画個別の構成解剖）と横断分析
// 正式FMT準拠：左に9:16のサムネイル1枚、右に2列×3行のモジュール、下に「本質1行」。
// 再生数は白チップ、EG率はブランド色ベタのチップで右上に置く。
const T = require('../theme');
const D = require('../helpers/data');
const { val, num, PLACEHOLDER_DATA } = D;
const { fit, fitBalanced } = require('../helpers/text');
const { addSlide } = require('../components/slideBase');
const { addInsightBox, addAccentChip, insightHeight } = require('../components/insightBox');
const { addModule } = require('../components/metricCard');
const { addDataTable } = require('../components/comparisonTable');
const C = require('./common');
const { fitBox, linkTo, addLinkedImage } = require('../helpers/imageBox');

// 表が使える最大高さ（下の発見帯とフッターに触れない）
const TABLE_MAX = T.content.bottom - 1.55 - T.content.topPlain;
// 一覧ページは帯が1行で済むので、表にもう少し高さを渡す
const LIST_MAX = T.content.bottom - 1.15 - T.content.topPlain;

const { brandColor, clip, img, stats } = C;
// 中扉の番号は章の並びで変わるので generate.js が partTag で渡す。渡されないときの既定
const PART2 = 'PART 3 — 動画の構成解剖';

const IMG_X = T.margin.l;
const IMG_Y = T.content.top;                 // 結論見出しの下から始める
const IMG_W = 3.50;
const IMG_H = T.content.bottom - T.content.top - 0.10;   // 下端の帯を廃した分まで使う
const COL1_X = 5.10;
const COL2_X = 12.20;
const COL_W = 6.55;
// 3行のモジュール。下端の帯を廃した分を使い切る
const ROW_H_GAP = 0.26;
const ROW_H = (T.content.bottom - T.content.top - ROW_H_GAP * 2) / 3;
const ROW_Y = [T.content.top, T.content.top + ROW_H + ROW_H_GAP, T.content.top + (ROW_H + ROW_H_GAP) * 2];

// 本文は素材の通し番号（00〜10）で参照する。範囲は必ず INPUT の frames_range（実フレーム番号）
// から出す。00始まりと決め打ちで計算すると、01始まりの投稿（写真カルーセル等）で
// 存在しない番号を宣言してしまう（本文が正しいのに注記が嘘をつく）
function frameNote(v) {
  const n = Number(String((v || {}).frames_seen || '').replace(/[^0-9]/g, ''));
  if (!Number.isFinite(n) || n < 2) return '';
  const range = String((v || {}).frames_range || '').trim();
  if (!range) return `　※本文中のコマ番号は、この投稿から抽出した全${n}コマの通し番号。`;
  return `　※本文中の${range}は、この投稿から抽出した全${n}コマの通し番号。`;
}

/** コマ番号バッジに出す番号。実フレーム番号（sb_frames）があればそれを使う */
function frameBadges(v, count) {
  const list = String((v || {}).sb_frames || '').split('/').map((x) => x.trim()).filter(Boolean);
  if (list.length === count) return list;
  return Array.from({ length: count }, (_, i) => String(i + 1));
}

/** 動画1本の構成解剖ページ */
function slideVideoDetail(pptx, b, v, bi, vi, footer, labelBase, partTag) {
  const accent = brandColor(bi);
  const title = `${clip(val(b.brand_name), 22)}　|　${clip(D.name(v.creator), 26)}`;
  // 結論（本質1行）は上。その下に投稿本文の引用を補足として置く
  const ess0 = val((v.essence || {}).one_line_essence);
  const cap = `「${clip(D.name(v.title), 46)}」${frameNote(v)}`;
  const s = addSlide(pptx, {
    qLabel: labelBase ? `${labelBase}-${vi + 1}` : `Q7-${vi + 1}`, title,
    ...(D.isPlaceholderText(ess0) ? {} : { conclusion: ess0, conclusionSub: cap }),
    partTag: partTag || PART2, accent, footerLeft: footer,
  });
  // 指標チップは本文領域の右上へ。結論の大見出し・補足行のどちらとも重ならない位置
  const chipY = T.content.top - 0.62;
  addAccentChip(s, {
    x: T.slide.w - T.margin.r - 4.20, y: chipY, w: 2.55, h: 0.52,
    text: `${num(v.views)} 再生`, color: accent, invert: true,
  });
  addAccentChip(s, {
    x: T.slide.w - T.margin.r - 1.55, y: chipY, w: 1.55, h: 0.52,
    text: `EG ${val(v.eg)}`, color: accent,
  });

  // 左の大サムネイル
  const imgs = v.images || {};
  const sb = v.storyboard || {};
  const pick = img(imgs.main) || img(sb.sb1_path) || img(imgs.killer) || img(imgs.hook);
  if (pick) {
    // 1枚目はクリックで投稿へ飛べるようにする
    addLinkedImage(s, pick, fitBox(pick, IMG_X, IMG_Y, IMG_W, IMG_H, 'left'), v.url, T);
  } else {
    s.addShape('rect', {
      x: IMG_X, y: IMG_Y, w: IMG_W, h: IMG_H,
      fill: { color: T.color.cardBg }, line: { color: T.color.cardLine, width: 1 },
    });
    s.addText('[IMAGE NOT PROVIDED]', {
      x: IMG_X, y: IMG_Y, w: IMG_W, h: IMG_H,
      fontFace: T.font.gothic, fontSize: T.size.caption, color: T.color.placeholder,
      align: 'center', valign: 'middle',
    });
  }

  // 右の6モジュール（左列3・右列3）
  const mods = [
    ['フック(0-3秒)', (v.hook || {}).hook_0_3_sec, false],
    ['テロップ', [(v.text || {}).text_density, (v.text || {}).text_speed,
      (v.text || {}).text_color, (v.text || {}).text_note]
      .map(val).filter((x) => !D.isPlaceholderText(x)).join('／') || PLACEHOLDER_DATA, false],
    ['商品識別', [(v.exposure || {}).brand_exposure, (v.exposure || {}).product_exposure]
      .map(val).filter((x) => !D.isPlaceholderText(x)).join('／') || PLACEHOLDER_DATA, false],
    ['視覚演出・キラー演出', (v.visual || {}).visual_killer, false],
    ['価格・スペック訴求', [(v.spec || {}).price, (v.spec || {}).volume, (v.spec || {}).ingredient,
      (v.spec || {}).purchase_route]
      .map(val).filter((x) => !D.isPlaceholderText(x)).join('／') || PLACEHOLDER_DATA, false],
    ['勝因仮説', (v.hypothesis || {}).success_or_failure_hypothesis, true],
  ];
  // 枠ごとに fit させると、同じページの6枠で本文の大小がバラつく（実測で最大3割差）。
  // 一番きつい枠に全体を合わせて1サイズに固定する
  const bodies = mods.map((m) => val(m[1]));
  const modFs = Math.min(...bodies.map((b) =>
    fit(b, COL_W - 0.26, ROW_H - 0.40, { base: T.size.moduleBody, min: 9.5, lineHeight: 1.55 })));
  mods.forEach((m, i) => {
    const x = i < 3 ? COL1_X : COL2_X;
    const y = ROW_Y[i % 3];
    addModule(s, {
      x, y, w: COL_W, h: ROW_H,
      label: m[0], body: bodies[i], accent, bodySize: modFs,
      labelAccent: m[2] ? accent : T.color.text,
    });
  });

  return s;
}

/** 分析した動画の一覧（各ブランド上位N本） */
function slideVideoTable(pptx, brands, footer, topN, ci, total, deckAnalyzed, opts = {}) {
  const s = addSlide(pptx, {
    qLabel: '一覧', title: `検索上位の実績と、構成解剖の対象${total > 1 ? `（${ci + 1}/${total}）` : ''}`,
    partTag: opts.partTag || PART2,
    // 面の数・解剖対象の選び方を固定文で書かない。「カテゴリ3面」「保存率が最も高い1本」と焼き込んでいたため、
    // 2ワードの案件や別の基準で選んだ案件でも同じ文が出ていた（選び方は video_manifest.json に記録が無い）
    // リード枠は1行（下限11ptで約75字）。長いと「収まらない可能性」になる
    lead: `ブランド名検索${opts.hasKw ? '（カテゴリ検索とは別条件）' : ''}の上位${topN}本ずつ。`
      + 'Q7の解剖対象は別に選ぶため、この順位と一致しないことがある。投稿者名がリンク。',
    accent: brandColor(0), footerLeft: footer,
  });
  // 同じ投稿者が同条件で複数本ある（ユンスの1・2位など）と行が見分けられない。
  // 投稿の中身を一言入れて識別できるようにする
  // 「内容タイプ」は全行が処理都合の値（未分類）になることがある。
  // 中身の無い列をクライアント面に残すと、作業事情をそのまま見せることになるので落とす
  const hasCluster = brands.some((b) => (b.videoList || []).slice(0, topN)
    .some((v) => { const t = val(v.cluster); return t && !D.isPlaceholderText(t) && !/未分類|対象外|未実施/.test(String(t)); }));
  // 媒体列を必ず出す。静止画カルーセルはコマ送りが無く構成解剖の対象にできないので、
  // この表では「なぜ解剖されなかったか」を決める列になる
  const head = ['ブランド', { text: '順位', align: 'right' }, '投稿者', '投稿の中身', '媒体',
    { text: '再生数', align: 'right' }, { text: 'EG率', align: 'right' },
    { text: '保存率', align: 'right' }, '#PR',
    ...(hasCluster ? ['内容タイプ'] : [])];
  // 左に代表サムネ1枚（FMTのQ6一覧と同じ型）、右に表
  const LIST_IMG_W = 3.35;
  const LIST_X = T.margin.l + LIST_IMG_W + 0.60;
  const LIST_W = T.slide.w - T.margin.r - LIST_X;
  // EG率・保存率が1.00inだと「2.06」「%」が2行に割れ、#PR 0.80inだと「なし」が縦に割れる。
  // 中身列と内容タイプ列から回して1行に収める
  // 内容タイプ列を落としたぶんは「投稿の中身」に回す（本文がいちばん識別に効く）
  const colW = hasCluster
    ? [2.05, 0.60, 2.20, 2.10, 0.85, 1.55, 1.25, 1.25, 1.10, 1.80]
    : [2.05, 0.60, 2.30, 3.55, 0.85, 1.55, 1.25, 1.25, 1.10];
  const rows = [];
  let dropped = 0;
  brands.forEach((b, bi) => {
    const list = b.videoList || [];
    dropped += Math.max(0, list.length - topN);
    list.slice(0, topN).forEach((v, i) => {
      rows.push([
        { text: i === 0 ? clip(val(b.brand_name), 20) : '', bold: i === 0,
          // ページ内の並び順でなくブランドで色を引く。順で引くと別ブランドが同色になる
          color: i === 0 ? brandColor(D.colorIndexOf(b)) : T.color.text },
        { text: val(v.search_rank), align: 'right' },
        { text: clip(D.name(v.creator), 12), url: v.url }, clip(D.name(v.topic), hasCluster ? 16 : 28),
        val(v.media),
        { text: val(v.views), align: 'right' }, { text: val(v.eg), align: 'right' },
        { text: val(v.save_rate), align: 'right' }, val(v.is_pr),
        ...(hasCluster ? [clip(val(v.cluster), 12)] : []),
      ]);
    });
  });
  const hero = (brands[0].videoList || [])[0] || {};
  const hp = img(hero.thumb_path);
  // サムネが無いページで左に空き枠を残さない。表を全幅に寄せる
  const tblX = hp ? LIST_X : T.margin.l;
  const tblW = hp ? LIST_W : T.content.w;
  if (hp) {
    s.addImage({ path: hp, ...fitBox(hp, T.margin.l, T.content.topPlain, LIST_IMG_W, (LIST_IMG_W * 16) / 9, 'left'), ...linkTo(hero.url) });
    // 高さを固定すると下の注記帯に食い込む（実際に61%重なった）。
    // 画像下端から注記帯の上端までを予算にして、その中に収める
    const capY = T.content.topPlain + (LIST_IMG_W * 16) / 9 + 0.18;
    const capH = Math.max(0.42, LIST_MAX + T.content.topPlain - capY - 0.10);
    const capText = `${clip(D.name(hero.creator), 14)}\n${num(hero.views)}再生・EG${val(hero.eg)}／保存率${val(hero.save_rate)}`;
    s.addText(capText, {
      x: T.margin.l, y: capY, w: LIST_IMG_W, h: capH,
      fontFace: T.font.gothic,
      fontSize: fit(capText, LIST_IMG_W, capH, { base: T.size.captionSm, min: 8, lineHeight: 1.35 }),
      color: T.color.sub, valign: 'top', lineSpacingMultiple: 1.35,
    });
  }
  // 行高を固定するとページ下部が大きく空く。行数に応じて本文領域を使い切る
  const listRowH = Math.max(0.52, Math.min(0.92, (LIST_MAX - 0.55) / Math.max(1, rows.length)));
  const r = addDataTable(s, { x: tblX, y: T.content.topPlain, w: tblW, head, rows, colW, rowH: listRowH, maxH: LIST_MAX });
  if (r && r.dropped) stats.qaFixes.push(`動画一覧: ${r.dropped}行が入りきらずスライド外`);
  if (dropped) stats.qaFixes.push(`動画一覧: ${dropped}本をスライド外に送った（本数は明記）`);
  // 「掲載行数」と「実際に動画を落とした本数」と「ブランドの実質本数」は別物。混ぜない。
  // さらに自社は比較の基準として全ページに再掲されるため、ページ別の本数を足すと
  // 自社ぶんが重複する（7+5+4=16 と読めてしまうが実数は12）。解剖本数はデッキ全体の実数を出す
  const universe = brands.reduce((a, b) => a + (Number(String(b.total_video_count).replace(/[^0-9]/g, '')) || 0), 0);
  const ownRepeated = total > 1 && brands.length > 1;
  const note = `このページの${brands.length}ブランド${ownRepeated ? `（先頭の${clip(val(brands[0].brand_name), 12)}は比較の基準として全${total}ページに再掲）` : ''}`
    + `は実質 ${universe} 本が母数。`
    + `そのうち検索上位 ${topN} 本ずつ・計 ${rows.length} 行をこの表に掲載している（残りは集計には含むが非掲載）。`
    // 解剖対象は掲載した上位N本の部分集合ではない（実際に12本中5本が表の外）。
    // 「この N 本のうち」と書くと嘘になるので、母数側から取ったと明示する
    + (deckAnalyzed > 0
      ? `次章（Q7）では、全ブランドを通じて解剖対象に選んだ ${deckAnalyzed} 本を1本ずつ解剖する（掲載した上位${topN}本の中に限らない。ページ別の本数ではなく全体の実数）。`
      : `このページのブランドからは動画実体を取得できておらず、次章（Q7）の構成解剖の対象外。`)
    // 媒体列が「なぜ解剖されなかったか」を説明する列であることを、表と同じページに書く
    + (rows.some((r0) => /写真/.test(String((r0[4] && r0[4].text) || r0[4] || '')))
      ? `媒体が「写真」の投稿は静止画カルーセルでコマ送りが無く、構成解剖の対象にできない。`
      : '');
  addInsightBox(s, note, { label: '掲載範囲', h: 0.72, maxH: 1.05 });
  return s;
}

/** Q8 横断の構成分析 */
function slideQ8(pptx, d, footer, partTag) {
  const c = d.cross || {};
  const s = addSlide(pptx, {
    qLabel: 'Q8', title: '動画の構成から見える共通パターン',
    partTag: partTag || PART2, lead: 'フック・視覚演出・最終コマと保存率を横断で突き合わせる。',
    accent: brandColor(0), footerLeft: footer,
  });
  const gap = 0.55;
  const cw = (T.content.w - gap) / 2;
  // 2×2 のブロックを本文領域いっぱいに配分する（固定高だと下半分が空く）
  // 結論はこのページの本文（CTA・視覚演出・最終コマ・保存率）から導いたものを使う
  const concl8 = val((d.cross || {}).video_cross_conclusion || (d.cross || {}).pr_organic_insight);
  // modH に下限を置いたまま帯だけ伸ばすと、2段目のモジュールが帯へ潜る（p37で発生）。
  // 帯とモジュールで高さを取り合い、モジュールが読めなくなる手前で帯のほうを抑える
  const AVAIL8 = (T.content.bottom - 0.40) - T.content.topPlain - 0.50;
  let bandH8 = insightHeight(concl8, { label: '横断結論', h: 1.55 });
  let modH = (AVAIL8 - bandH8) / 2;
  if (modH < 2.85) {
    modH = 2.85;
    bandH8 = Math.max(1.10, AVAIL8 - modH * 2);
  }
  // 見出しは中身に合わせる。本調査の主指標は保存率で、この4ブロックはいずれも保存率の話
  const items = [
    // 見出しと中身が食い違っていた（CTAの型と書いて hook_cross_analysis を出していた）
    ['冒頭の型', c.hook_cross_analysis, T.content.topPlain, T.margin.l],
    ['視覚演出の型', c.visual_cross_analysis, T.content.topPlain, T.margin.l + cw + gap],
    ['最終コマと保存率', (c.highEg || []).map((x) => `・${x}`).join('\n'), T.content.topPlain + modH + 0.50, T.margin.l],
    ['保存率を説明しなかった要因', (c.lowEg || []).map((x) => `・${x}`).join('\n'), T.content.topPlain + modH + 0.50, T.margin.l + cw + gap],
  ];
  // 各ブロックが別々に自動縮小すると同一ページで級数が4段階に割れる。最小値に揃える
  const bodySizes = items.map(([, body]) => fit(val(body), cw - 0.26, modH - 0.40,
    { base: T.size.moduleBody, min: 9.5, lineHeight: 1.55 }));
  const uniform = Math.min(...bodySizes);
  items.forEach(([label, body, y, x], i) => {
    addModule(s, {
      x, y, w: cw, h: modH, label, body: val(body), bodySize: uniform,
      accent: i === 3 ? T.color.sub : brandColor(0),
    });
  });
  addInsightBox(s, concl8, { label: '横断結論', h: 1.55, maxH: bandH8 });
  return s;
}

module.exports = { slideVideoDetail, slideVideoTable, slideQ8 };

// ───────────────────────────────── 動画の5コマ構成（FMTの型を保ったまま追加）
const SB_Y = T.content.top + 0.10;
// 画像・キャプション・罫線・解説文を一本の予算から割り付ける。
// 個別に定数を置くと片方だけ直したときに重なる（実際に罫線と解説文が画像へ食い込んだ）
const SB_CAP_H = 0.95;                       // コマ見出し（2行折り返しまで許容）
const SB_FLOW_H = 1.42;                      // 構成の解説文
const SB_H = T.content.bottom - SB_Y - SB_CAP_H - SB_FLOW_H - 0.51;
const SB_CAP_Y = SB_Y + SB_H + 0.18;         // 画像の直下
const SB_RULE_Y = SB_CAP_Y + SB_CAP_H + 0.17;
const SB_FLOW_Y = SB_RULE_Y + 0.16;

/** 5コマのサムネイルで「どう始まり、どう終わるか」を1枚で見せる */
function slideVideoStoryboard(pptx, b, v, bi, vi, footer, labelBase, partTag) {
  const accent = brandColor(bi);
  const sb = v.storyboard || {};
  // 定義の無いコマ枠は「未解決画像」に数えない（2コマ投稿を欠損扱いにしないため）
  const shots = [1, 2, 3, 4, 5]
    .filter((j) => sb[`sb${j}_path`])
    .map((j) => ({ path: img(sb[`sb${j}_path`]), label: val(sb[`sb${j}_label`]) }))
    .filter((x) => x.path);
  if (shots.length < 2) return null;          // 画像2枚の投稿もそのまま2コマで見せる（水増ししない）

  // 5コマ未満のときの説明。以前は「この投稿は4コマで全部（[DATA NOT PROVIDED]）」と出ていた。
  // 尺は INPUT に無く欠損が紙面に漏れ、15秒の動画から4コマ抜いただけなのに投稿全体が4コマのように読めた。
  // 「全部」と言えるのは静止画カルーセルだけ。動画は「抽出したコマから N コマ（全 X 秒）」と書く
  const dur = parseFloat(String(v.duration_sec || '').replace(/[^0-9.]/g, ''));
  const durTxt = Number.isFinite(dur) && dur > 0 ? `（全${dur}秒の動画から抽出）` : '';
  const shotNote = shots.length >= 5
    ? '5コマで見る「どう始まり、何を見せ、どう終わるか」。'
    : (/写真/.test(String(v.media || ''))
      ? `静止画カルーセルの${shots.length}枚を並べている。`
      : `抽出したコマから${shots.length}コマを並べている${durTxt}。`);
  const s = addSlide(pptx, {
    qLabel: labelBase ? `${labelBase}-${vi + 1}b` : `Q7-${vi + 1}b`,
    title: `${clip(val(b.brand_name), 22)}　|　${clip(D.name(v.creator), 26)}　構成`,
    partTag: partTag || PART2,
    // 結論（本質1行）を上に。従来のリード文は補足として結論の下へ回す
    ...(D.isPlaceholderText(val((v.essence || {}).one_line_essence))
      ? { lead: shotNote + frameNote(v) }
      : { conclusion: val((v.essence || {}).one_line_essence),
          conclusionSub: shotNote + frameNote(v) }),
    accent, footerLeft: footer,
  });

  const badges = frameBadges(v, shots.length);
  const gap = 0.42;
  const fw = (T.content.w - gap * (shots.length - 1)) / shots.length;
  // 枠幅をそのまま渡す。fitBox が縦横比を保って中央寄せするので、
  // 縦型は従来どおり、横長の画像投稿は枠幅を使い切る
  const iw = fw;
  shots.forEach((sh, i) => {
    const x = T.margin.l + i * (fw + gap);
    const ix = x;
    if (i === 0) addLinkedImage(s, sh.path, fitBox(sh.path, ix, SB_Y, iw, SB_H), v.url, T);
    else s.addImage({ path: sh.path, ...fitBox(sh.path, ix, SB_Y, iw, SB_H) });
    // コマ番号。本文と同じ通し番号を出す（1〜5の連番だと本文の「08のコマ」と突き合わせられない）
    s.addShape('rect', { x: ix, y: SB_Y - 0.42, w: 0.52, h: 0.34, fill: { color: accent }, line: { width: 0 } });
    s.addText(badges[i], {
      x: ix, y: SB_Y - 0.42, w: 0.52, h: 0.34,
      fontFace: T.font.gothic, fontSize: T.size.captionSm, bold: true, color: 'FFFFFF',
      align: 'center', valign: 'middle',
    });
    // その コマが何を訴えているか
    s.addText(sh.label, {
      x, y: SB_CAP_Y, w: fw, h: SB_CAP_H,
      fontFace: T.font.gothic,
      // fit だと末尾1〜2文字だけが2行目に落ちる（「…を対／比」）。行末を揃える方を使う
      fontSize: fitBalanced(sh.label, fw, SB_CAP_H, { base: T.size.caption, min: 8.5, lineHeight: 1.4 }),
      bold: true, color: T.color.text, align: 'center', valign: 'top', lineSpacingMultiple: 1.3,
    });
    if (i < shots.length - 1) {
      s.addText('→', {
        x: x + fw, y: SB_Y + SB_H / 2 - 0.22, w: gap, h: 0.44,
        fontFace: T.font.gothic, fontSize: 15, color: T.color.subLight,
        align: 'center', valign: 'middle',
      });
    }
  });

  // 構成の要点と本質1行
  const flow = [(v.hook || {}).hook_0_3_sec, (v.visual || {}).visual_killer, (v.cta || {}).cta]
    .map(val).filter((x) => !D.isPlaceholderText(x)).join('　→　');
  s.addShape('line', { x: T.margin.l, y: SB_RULE_Y, w: T.content.w, h: 0, line: { color: T.color.ruleThin, width: 0.9 } });
  s.addText(flow || PLACEHOLDER_DATA, {
    x: T.margin.l, y: SB_FLOW_Y, w: T.content.w, h: SB_FLOW_H,
    fontFace: T.font.gothic,
    // 下限10.5ptだと4行の解説が枠に収まらず、下端がフッターまで20pxに迫る。
    // 他の本文と同じ9.5ptまで許容して枠内に収める
    fontSize: fit(flow, T.content.w, SB_FLOW_H, { base: T.size.bodySm, min: 9.5, lineHeight: 1.5 }),
    color: T.color.text, valign: 'top', lineSpacingMultiple: 1.42,
  });
  return s;
}

module.exports.slideVideoStoryboard = slideVideoStoryboard;
