// theme.js — デザイントークン
// v1.0.0: 正式FMT（TikTok SEARCH DEEP-DIVE）に準拠。
// キャンバス20×11.25in／クリーム地／見出し明朝／ブランド色は2色を使い分ける。
// 色は正式FMTのレンダリングから実測した値（背景F6F4EF・本文17181C・赤A24765・青2F5397）。
const T = {
  slide: { w: 20.0, h: 11.25 },
  margin: { l: 1.15, r: 1.15 },

  color: {
    bg: 'F6F4EF',            // クリームの地
    text: '17181C',          // 本文・見出し
    sub: '6E6B66',           // ラベル・補足
    subLight: '9B978F',      // フッター・凡例
    rule: '17181C',          // ヘッダー下の罫
    ruleThin: 'D9D5CC',      // 表・区切りの細罫
    cardLine: 'DDD9D1',
    cardBg: 'FAF8F4',
    track: 'E4DFD4',         // 横棒グラフの下地
    bar: '55524C',           // ブランド識別と無関係な棒（検索ワード面の投稿など）
    chipDark: '17181C',      // 「発見」「結論」の黒チップ
    placeholder: 'A5A19A',
    dark: '17181C',          // PART中扉の背景
    darkText: 'FFFFFF',
    darkSub: '8E8B85',
    darkRule: '3A3B3F',
    imageBack: '111215',
  },

  // ブランド色。1ブランド目=赤、2ブランド目=青。以降は同系で足す。
  // 7社ぶん用意する。6色だと7社目が自社(1色目)に回り込み、自社のページと見分けがつかなくなる
  brandColors: ['A24765', '2F5397', '4B7A5C', '9A6B33', '6A4C7C', '2F6F7A', '6F7B2E'],

  font: {
    // 見出し・結論は明朝、本文と数値はゴシック（正式FMTと同じ使い分け）
    mincho: 'Hiragino Mincho ProN',
    gothic: 'Hiragino Kaku Gothic ProN',
    en: 'Helvetica Neue',
  },

  size: {
    coverKicker: 15,     // TIKTOK SEARCH DEEP-DIVE REPORT
    coverSub: 20,        // ブランド名
    coverTitle: 60,      // 大見出し（明朝）
    coverLead: 15,
    coverMeta: 13,
    partLabel: 15,       // PART 1
    partNumber: 400,     // 輪郭の巨大数字（図形で描くため参考値）
    partTitle: 46,       // 中扉の明朝大見出し
    partDesc: 15,
    partIndexQ: 13,
    partIndexText: 14,
    qLabel: 27,          // Q1（ゴシック太・ブランド色）
    slideTitle: 27,      // 見出し（明朝）
    partTag: 13,         // 右上 PART 1 — 検索面の実態
    lead: 15,
    tableHead: 13,
    table: 15,
    tableBig: 19,        // 表内の強調数値
    band: 15,            // 発見・結論の本文
    bandLabel: 13,
    moduleLabel: 14,
    moduleBody: 13.5,
    caption: 12,
    captionSm: 11,
    metricBig: 34,       // 0.93% のような大きな数値
    metricLabel: 14,
    chip: 15,            // 再生数・EG率チップ
    patternNo: 60,       // 勝ちパターンの巨大番号
    patternName: 20,
    footer: 13,
    bodySm: 13,
    bodyMin: 10,
  },

  header: {
    qX: 1.15, qY: 0.60, qW: 1.55, qH: 0.60,
    titleX: 2.62, titleY: 0.58, titleW: 12.60, titleH: 0.64,
    tagW: 4.40,              // 右上のPARTタグ
    ruleY: 1.30,
    leadY: 1.46, leadH: 0.38,
  },

  footerY: 10.52,
};

T.content = {
  x: T.margin.l,
  w: T.slide.w - T.margin.l - T.margin.r,   // 17.70
  top: 3.52,   // 結論の大見出し＋補足1行のぶん下げる（納品版準拠）
  topPlain: 2.20,   // 結論の大見出しを持たないページ（一覧・章扉・R章）用
  bottom: 10.20,                            // フッターの上
};

module.exports = T;
