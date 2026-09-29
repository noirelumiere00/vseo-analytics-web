// summary.js — 総括（勝ちパターン）／最終示唆／付録
// 正式FMT準拠：勝ちパターンは「巨大な薄い番号＋型名＋実例」を左、右に説明。行間に細罫。
const T = require('../theme');
const D = require('../helpers/data');
const { val } = D;
const { fit, estimateLines } = require('../helpers/text');
const { addSlide } = require('../components/slideBase');
const { addInsightBox } = require('../components/insightBox');
const C = require('./common');

const { brandColor, stats } = C;

/** 勝ちパターン（1ページ3型） */
function slidePatterns(pptx, patterns, footer) {
  // 3枚ずつ固定だと 7類型が 3/3/1 になり最終ページが大きく空く。ページ数を決めてから均等に割る
  const nPages = Math.max(1, Math.ceil(patterns.length / 4));   // 3枚割りだと最終ページが薄くなる
  const pages = [];
  let cursor = 0;
  for (let pi = 0; pi < nPages; pi += 1) {
    const take = Math.ceil((patterns.length - cursor) / (nPages - pi));
    pages.push(patterns.slice(cursor, cursor + take));
    cursor += take;
  }

  pages.forEach((page, pi) => {
    const s = addSlide(pptx, {
      qLabel: '総括',
      title: `実動画から見える「勝ちパターン」${patterns.length}類型${pages.length > 1 ? `（${pi + 1}/${pages.length}）` : ''}`,
      partTag: 'SUMMARY', lead: '構成の型 × 該当動画 × 成立条件',
      accent: brandColor(0), footerLeft: footer,
    });
    const top = T.content.topPlain + 0.25;
    const avail = T.content.bottom - top - 0.15;   // 本文領域を使い切る（下に空白を残さない）
    const rowH = avail / page.length;
    page.forEach((p, i) => {
      const y = top + i * rowH;
      const no = pages.slice(0, pi).reduce((a, p) => a + p.length, 0) + i + 1;
      // 巨大な薄い番号
      s.addText(String(no), {
        x: T.margin.l, y: y - 0.12, w: 1.30, h: 1.20,
        fontFace: T.font.en, fontSize: T.size.patternNo, bold: true,
        color: 'DAD5CA', align: 'left', valign: 'top',
      });
      // 型名＋実例
      s.addText(val(p.name), {
        x: T.margin.l + 1.45, y, w: 5.35, h: 0.58,
        fontFace: T.font.mincho,
        fontSize: fit(val(p.name), 5.35, 0.58, { base: T.size.patternName, min: 13, lineHeight: 1.15 }),
        bold: true, color: T.color.text, valign: 'middle',
      });
      const ex = val(p.example_videos);
      s.addText(`実例：${ex}`, {
        x: T.margin.l + 1.45, y: y + 0.62, w: 5.35, h: rowH - 0.85,
        fontFace: T.font.gothic,
        fontSize: fit(`実例：${ex}`, 5.35, rowH - 0.85, { base: T.size.captionSm, min: 8.5, lineHeight: 1.5 }),
        color: T.color.sub, valign: 'top', lineSpacingMultiple: 1.4,
      });
      // 右：流れ＋成立条件
      const rx = T.margin.l + 7.20;
      const rw = T.content.w - 7.20;
      const flow = [p.hook, p.development, p.killer_visual, p.product_proof, p.cta]
        .map(val).filter((x) => !D.isPlaceholderText(x)).join('　→　');
      const flowText = flow || D.PLACEHOLDER_DATA;
      const cond = `成立条件：${val(p.success_conditions)}　／　崩れる条件：${val(p.failure_conditions)}`;
      const innerH = rowH - 0.30;
      // 2つの箱を別々に置くと、上の行数が伸びたとき下の箱と重なる。
      // 1つの箱に流し込めば重なりは構造的に起こらない。
      const joined = `${flowText}\n${cond}`;
      const fsBody = fit(joined, rw, innerH, { base: T.size.bodySm, min: 8.5, lineHeight: 1.5 });
      s.addText(
        [
          { text: flowText, options: { color: T.color.text, bold: false, breakLine: true } },
          { text: cond, options: { color: T.color.text, bold: true } },
        ],
        {
          x: rx, y, w: rw, h: innerH,
          fontFace: T.font.gothic, fontSize: fsBody,
          valign: 'top', lineSpacingMultiple: 1.42,
        }
      );
      if (i < page.length - 1) {
        s.addShape('line', {
          x: T.margin.l, y: y + rowH - 0.14, w: T.content.w, h: 0,
          line: { color: T.color.ruleThin, width: 0.8 },
        });
      }
    });
  });
}

/** 最終示唆 KEEP / IMPROVE / TRY */
function slideFinal(pptx, d, footer, M) {
  const c = d.cross || {};
  // 資料に解剖ページを載せたかどうかで判定する。データに動画があっても、
  // 初訪版では1枚も出していないので「実動画の構成分析から」とは書けない
  const anatomyShown = (M && M.videoAnatomy === false)
    ? false
    : (d.clients || []).flatMap((x) => (x.brands || []))
      .reduce((n2, b) => n2 + ((b.videos || []).length), 0) > 0;
  const s = addSlide(pptx, {
    qLabel: '示唆', title: 'KEEP / IMPROVE / TRY',
    partTag: 'NEXT ACTION',
    // 動画を解剖していない案件で「実動画の構成分析から」と書くと、やっていないことを
    // やったと書くことになる。解剖本数から文言を決める
    lead: anatomyShown
      ? '検索面の実態と実動画の構成分析から導いた次アクション。'
      : '検索面の実態から導いた次アクション（実動画の構成解剖は本資料の範囲外）。',
    accent: brandColor(0), footerLeft: footer,
  });
  // 章立てに依存する箇条書きは、その章を載せた資料にだけ出す。
  //   「[deep] …」= 提案版のみ / 「[quick] …」= 初回訪問版のみ / 印なし＝両方
  // 初訪版に「実見した24コマの範囲では…」が残り、そのコマが1枚も無い資料になっていた
  // 印は案件側（authored.md）が書くので、ステータス名を変えても効き続けるよう
  // 別名で突き合わせる。ここを素の名前比較にしていたため、モード名を
  // deep→具体提案 に変えた時点で [deep] の項目が黙って全部消えた
  const MARKER_ALIAS = {
    deep: ['deep', 'full', '具体提案'],
    quick: ['quick', '初訪', '初回訪問'],
    構成提案: ['構成提案', '構成'],
    競合差再提案: ['競合差再提案', '競合差', '再提案'],
    レポート: ['レポート', 'report'],
  };
  const modeName = (M && M.name) || '具体提案';
  const modeNames = String(modeName).split(/[＋+,、]/).map((x) => x.trim());
  const markerRe = /^\s*\[([^\]]+)\]\s*/;
  const hit = (marker) => {
    const names = MARKER_ALIAS[marker] || [marker];
    return modeNames.some((n) => names.includes(n));
  };
  const forMode = (list) => (list || [])
    .map((t) => String(t))
    .filter((t) => {
      const m = t.match(markerRe);
      if (!m) return true;
      // 知らない印を黙って落とすと、書いた文が理由不明で消える
      if (!MARKER_ALIAS[m[1]]) {
        D.stats.qaFixes.push(`未知のモード印 [${m[1]}] があります: "${t.slice(0, 28)}…"`);
        return true;
      }
      return hit(m[1]);
    })
    .map((t) => t.replace(markerRe, ''));
  const rows = [
    { label: 'KEEP', list: D.padList(forMode(c.keep), 1), color: '4B7A5C' },
    { label: 'IMPROVE', list: D.padList(forMode(c.improve), 1), color: '9A6B33' },
    { label: 'TRY', list: D.padList(forMode(c.try), 1), color: brandColor(0) },
  ];
  const fm = val(c.final_message);
  const fmH = 1.45;
  const top = T.content.topPlain;
  const gap = 0.24;
  const avail = (T.content.bottom - fmH - 0.62) - top - gap * 2;   // 結論帯との間に余白を残す
  const bw = T.content.w - 2.30;
  const need = rows.map((r) => Math.max(2, estimateLines(r.list.join('\n'), bw, T.size.bodySm)));
  const total = need.reduce((a, b) => a + b, 0);
  const heights = need.map((x) => avail * (x / total));
  let acc = top;
  rows.forEach((r, i) => {
    const h = heights[i];
    s.addShape('rect', { x: T.margin.l, y: acc, w: 0.07, h, fill: { color: r.color }, line: { width: 0 } });
    s.addText(r.label, {
      x: T.margin.l + 0.30, y: acc, w: 1.85, h: 0.50,
      fontFace: T.font.gothic, fontSize: T.size.moduleLabel + 1, bold: true,
      color: r.color, charSpacing: 1.2, valign: 'middle',
    });
    const body = r.list.map((t) => `・${t}`).join('\n');
    s.addText(body, {
      x: T.margin.l + 2.30, y: acc - 0.04, w: bw, h: h,
      fontFace: T.font.gothic,
      fontSize: fit(body, bw, h - 0.10, { base: T.size.bodySm, min: 9, lineHeight: 1.55 }),
      color: D.isPlaceholderText(r.list[0]) ? T.color.placeholder : T.color.text,
      valign: 'top', lineSpacingMultiple: 1.48,
    });
    acc += h + gap;
  });
  addInsightBox(s, fm, { label: '結論', h: fmH });
  return s;
}

/** 付録：定義と調査条件。
 *  全資料に同じ文を印字するので、実装と違うこと・案件ごとに確かめていないことは書かない
 *  （「動画IDで重複排除」「算出値と一致することを確認済み」「内訳を併記」が実装と食い違っていた） */
function slideAppendix(pptx, d, footer, M) {
  const p = d.project;
  // 内訳（isAd／#PRタグ）を描くのは Q2 のページだけ。Q2 を載せない資料で「併記している」と書かない
  const q2Shown = !M || M.q1q2 !== false;
  const rows = [
    // 略号と表記の凡例。これが無いと「CE 4.4／CO 3.4」がどの品種の数字か読み手に閉じない
    ...(val(p.term_legend) && !D.isPlaceholderText(val(p.term_legend))
      ? [['略号・表記', val(p.term_legend)]] : []),
    ['EG率の定義', '（いいね＋コメント＋シェア＋保存）÷ 再生数。取得時点の各数値から算出。'],
    ['保存率の定義', '保存数 ÷ 再生数。「後で見返す／買う候補にする」意思の代理指標として、EG率とは分けて見る。'],
    ['対象期間', val(p.research_period)],
    // tiktok-analyze を回したか回していないかは、紙面から読めない。
    // 書かないと「言及は無かった」と読まれる余地が残るので必ず出す
    ['言及回数の計測', (() => {
      const m = d.mentions || {};
      if (String(m.status).trim() === 'ran_but_empty') {
        // 走らせたが0本、を「計測済み」と言わない
        return '言及回数の計測は実行したが、集計できた動画が0本だった。'
          + '言及回数は0回ではなく未計測。' + val(m.coverage_note);
      }
      if (String(m.status).trim() === 'measured') {
        return `動画の中での言及回数を計測している（本文・ハッシュタグ・テロップ・音声の4経路）。`
          + `${val(m.coverage_note)}`;
      }
      return '動画の中での言及回数（テロップ・音声で何回言われたか）は計測していない。'
        + '本資料でその種の回数に言及していないのはそのため。0回ではなく未計測。';
    })()],
    ['並び順', 'TikTokアプリが実際に表示した順（検索画面のデフォルト表示順）。その並び順をそのまま検索順位として扱う。'],
    ['#PRの判定', 'TikTokの広告フラグ(isAd)と、ハッシュタグ #PR・#PR案件・#タイアップ・#広告（大文字・小文字を区別しない完全一致）のいずれかが立っているものをPRとして数える。'
      + (q2Shown ? 'どちらの定義かで比率が変わる軸があるため、Q2 の各ブランドに内訳（isAd◯本／#PRタグ◯本）を併記している。' : '')
      + '広告該当性・景表法適合性は判定しない。「PR表記なし」はオーガニックを意味しない。'],
    ['取得方法', (() => {
      const nb = (d.clients || []).flatMap((c) => c.brands || []).length;
      const nk = (d.keywords || []).length;
      return `実ブラウザ（Puppeteer＋Chrome）でTikTokの検索画面を開き、画面が読み込んだ内部APIの応答をそのまま記録した。`
        + `ブランド${nb}軸＋市場${nk}ワードを同一手法で揃えている。`
        // 実装は軸の中だけ重複を除く（build_input_md.py load_axis）。軸をまたぐ重複は除かない
        + '各検索軸の中では動画IDで重複を除いている（同じ動画が複数の軸に出た場合は、それぞれの軸で数える）。'
        + 'ログイン情報は使用していない。';
    })()],
    // 集計条件は案件によって違う。かなフィルタ・除外理由をコードに焼き込むと
    // 別案件で「やっていない絞り込みをやった」と書くことになる（実際に起きた）
    ...(val(p.aggregation_note) && !D.isPlaceholderText(val(p.aggregation_note))
      ? [['集計の条件', val(p.aggregation_note)]] : []),
    ['本数の比較について', (() => {
      // 各ブランドは別々の検索軸で取得しているため、実数はデータから引く（他案件の値を焼き込まない）
      const bs = (d.clients || []).flatMap((c) => c.brands || []);
      const line = bs.map((b) => `${val(b.brand_name)} ${val(b.total_video_count)}`).join('／');
      // 終わり方はログごとに違う。ここで一括りにすると付録が事実と食い違う
      // （has_more=false で終わった軸まで「上限到達」と書いていた）。
      // 分類は acquisition_note（データ側）の文言に任せ、紙面には軸名を並べるだけにする
      const kindOf = (b) => {
        const t = String(b.acquisition_note || '');
        if (/has_more=false/.test(t)) return '検索が終端を返して終了';
        if (/同じ結果が返り続けた/.test(t)) return '同じ結果が返り続けたため打ち切り';
        if (/記録されていない/.test(t)) return '取得の終わり方が未記録';
        if (/上限/.test(t)) return '取得上限に到達';
        return null;
      };
      const groups = new Map();
      bs.forEach((b) => {
        const k = kindOf(b);
        if (!k) return;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(val(b.brand_name));
      });
      return 'ブランドごとに別の検索軸で取得しているため、共通母集団に対する該当率としては比較できない。'
        + `実質本数は ${line}。`
        + [...groups].map(([k, names]) => `${names.join('・')}＝${k}`).join('／')
        + (groups.size ? '。' : '')
        + '検索が終端を返した軸でも、検索が返す件数そのものが投稿総数とは限らないため'
        + '下限値として読む。それ以外は面の総数が確定していない。'
        + 'いずれも単発取得のスナップショットである。';
    })()],
    ['サムネイル', '各ページの実例画像は、添えたキャプションの投稿の実際のカバー画像（構成解剖のページは動画から抜いたコマ）。AI生成による補完は行っていない。'],
    // 他プラットフォーム章を載せたときは、その章の取得条件も付録に入れる。
    // 付録が TikTok の条件しか保証していないと、X章だけ範囲外の記述になる
    ...((d.platforms || []).filter((pf) => val(pf.coverage_note)
      && !D.isPlaceholderText(val(pf.coverage_note)))
      .map((pf) => [`${val(pf.name)}の調査条件`, val(pf.coverage_note)])),
    ['免責', '表示順はログイン状態・地域・閲覧履歴・取得時刻で変動する。取得時点のスナップショット。'],
  ];
  const labelW = 3.10;
  const bodyW = T.content.w - labelW - 0.30;
  // 行を上から積むだけだと、行を1本足した分がそのまま下へ溢れてフッターに重なる
  // （実際に「略号・表記」を追加して免責行がフッターと衝突した）。
  // 使える高さを先に確定させ、その予算に収まる文字サイズと行間を選ぶ
  const avail = T.content.bottom - T.content.topPlain;
  const GAP_BASE = 0.18;
  const plan = (fs, gap) => {
    const hs = rows.map((r) => 0.20 + (estimateLines(r[1], bodyW, fs) * fs * 1.58) / 72);
    return { fs, gap, hs, total: hs.reduce((a, b) => a + b, 0) + gap * rows.length };
  };
  let lay = plan(T.size.bodySm, GAP_BASE);
  for (let fs = T.size.bodySm; lay.total > avail && fs >= 8.5; fs -= 0.5) {
    lay = plan(fs, GAP_BASE);
    if (lay.total > avail) lay = plan(fs, 0.10);
  }

  // 下限の文字サイズでも収まらないなら、縮め続けずにページを分ける。
  // 以前は溢れたまま1枚に描き、QAログに警告を出すだけだった。
  // 警告はどのゲートも読んでいなかったので、収まらない資料がそのまま出ていた
  const pagesOfRows = [];
  {
    let cur = [];
    let used = 0;
    rows.forEach((r, i) => {
      const need = lay.hs[i] + lay.gap;
      if (cur.length && used + need > avail) {
        pagesOfRows.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(i);
      used += need;
    });
    if (cur.length) pagesOfRows.push(cur);
  }
  if (pagesOfRows.length > 1) {
    stats.qaFixes.push(
      `付録の定義表を ${pagesOfRows.length} ページに分割（${rows.length}行・${lay.fs}pt）`);
  }

  const made = [];
  pagesOfRows.forEach((idxs, pi) => {
    const s = addSlide(pptx, {
      qLabel: pagesOfRows.length > 1 ? `付録${pi + 1}` : '付録',
      title: pi === 0 ? '定義と調査条件' : '定義と調査条件（続き）',
      partTag: 'APPENDIX',
      lead: pi === 0 ? '数値の読み方と、この調査が保証する範囲。' : '前ページの続き。',
      accent: brandColor(0), footerLeft: footer,
    });
    let y = T.content.topPlain;
    idxs.forEach((i, k) => {
      const r = rows[i];
      const h = lay.hs[i];
      s.addText(r[0], {
        x: T.margin.l, y, w: labelW, h,
        fontFace: T.font.gothic, fontSize: Math.min(T.size.caption, lay.fs), bold: true, color: T.color.sub, valign: 'top',
      });
      s.addText(r[1], {
        x: T.margin.l + labelW, y, w: bodyW, h,
        fontFace: T.font.gothic, fontSize: lay.fs,
        color: D.isPlaceholderText(r[1]) ? T.color.placeholder : T.color.text,
        valign: 'top', lineSpacingMultiple: 1.45,
      });
      y += h;
      // 最終行の下に罫線を引くと、フッター上へ線だけが残る
      if (k < idxs.length - 1) {
        s.addShape('line', { x: T.margin.l, y: y + 0.04, w: T.content.w, h: 0, line: { color: T.color.ruleThin, width: 0.75 } });
      }
      y += lay.gap;
    });
    made.push(s);
  });
  return made[0];
}

module.exports = { slidePatterns, slideFinal, slideAppendix };
