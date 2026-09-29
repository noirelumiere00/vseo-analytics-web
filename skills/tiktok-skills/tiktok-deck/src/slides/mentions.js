// mentions.js — 動画の中でキーワードが何回言われたか（tiktok-analyze の計測結果）
//
// このページの原則:
//   経路（本文・タグ・テロップ・音声）ごとに分母が違う。
//   音声は「話が無い投稿」と「まだ聞いていない投稿」を分母から外している。
//   外した本数を紙面に出さないと、出現率が実力より高く見える。
//   だから各行に分母と除外本数を必ず併記する。
const T = require('../theme');
const D = require('../helpers/data');
const { val } = D;
const { addSlide } = require('../components/slideBase');
const { addInsightBox, insightHeight } = require('../components/insightBox');
const { addDataTable } = require('../components/comparisonTable');
const C = require('./common');

const { brandColor } = C;
// 中扉の PART 2 と同じ文言にする。ここだけ別名にすると、
// 同じ章の中でページの帯だけが変わって別章に見える。
// PART 2（検索ワード）が無い資料では generate.js が別の帯を渡す（無い章の番号を名乗らない）
const PART = 'PART 2 — 検索ワードの露出実態';
const CHANNELS = ['caption', 'hashtag', 'ocr', 'asr'];

/** 「58.3%（対象外 18本を分母から除外）」から本数だけを取り出す */
function excludedOf(rate) {
  const m = /対象外\s*(\d+)\s*本/.exec(String(rate || ''));
  return m ? parseInt(m[1], 10) : 0;
}

/** 率の表記から括弧書きを外す（表では別列に分ける） */
function rateOnly(rate) {
  return String(val(rate)).replace(/（.*$/, '').trim();
}

function slideMentions(pptx, d, footer, partTag) {
  const m = d.mentions || {};
  // 未計測のページは作らない。開示は付録の「言及回数の計測」行が担う
  if (String(m.status || '').trim() !== 'measured') return [];
  const out = [];
  (m.axes || []).forEach((ax, i) => {
    const ch = ax.channels || {};
    const rows = CHANNELS.map((k) => {
      const ex = excludedOf(ch[`${k}_rate`]);
      return [
        { text: val(ch[`${k}_label`]), bold: true },
        val(ch[`${k}_gist`]),
        { text: val(ch[`${k}_valid`]), align: 'right' },
        // 分母から外した本数は「0本」ではなく「—」。0と書くと外していないように読める
        { text: ex ? `${ex}本` : '—', align: 'right' },
        { text: rateOnly(ch[`${k}_rate`]), align: 'right', bold: true },
        { text: val(ch[`${k}_avg`]), align: 'right' },
      ];
    });
    const s = addSlide(pptx, {
      qLabel: `言及${i + 1}`,
      title: `「${val(m.keyword)}」は動画の中でどう言われているか`,
      partTag: partTag || PART,
      lead: `${val(ax.label)}｜解析できた ${val(ax.videos_processed)} 本／`
        + `対象 ${val(ax.videos_in_file)} 本。`
        + `いずれかの経路で言及があったのは ${val(ax.videos_with_keyword)} 本（${val(ax.appearance_rate)}）。`,
      accent: brandColor(0), footerLeft: footer,
    });
    // coverage_note は tiktok-analyze が三値で書いた開示文。要約せず載せる
    const body = [
      val(m.coverage_note),
      '経路ごとに分母が異なる。除外した本数は0件ではなく、対象外または未計測。',
    ].filter((t) => t && !D.isPlaceholderText(t)).join('\n');
    const opt = { label: '調査範囲', h: 1.35, maxH: 2.60 };
    addDataTable(s, {
      x: T.margin.l, y: T.content.top, w: T.content.w,
      head: ['経路', '何を見たか', '分母', '分母から除外', '出現率', '1本あたり'],
      colW: [1.90, 5.40, 1.30, 1.90, 1.60, 1.80],
      rows,
      maxH: T.content.bottom - insightHeight(body, opt) - 0.34 - T.content.top,
    });
    if (body) addInsightBox(s, body, opt);
    out.push(s);
  });
  return out;
}

module.exports = { slideMentions, PART };
