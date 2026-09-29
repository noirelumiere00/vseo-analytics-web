// firstVisit.js — 初訪資料（本編8枚＋付録2枚以内）
//
// 2026-09 上長FBで作り直した。狙う感情は「この人たちは競合も市場も見てきている。役に立つ」。
//   P1 表紙 → P2 いま検索するとこう見える → P3 競合はこう発信している
//   → P4 競合がお金をかけて広げている訴求（成立するときだけ）→ P5 貴社に足りていない発信
//   → P6 いま伸びている型（お土産）→ P7 まずこの3本 → P8 次回 → 付録1 前提 → 付録2 数字
// 1枚＝実画像＋ワンフレーズ。数値・文言はすべて tools/build_first_visit.py が first_visit.json に
// 作ったものをそのまま置く（ここでは計算も言い換えもしない）。
const fs = require('fs');
const path = require('path');
const T = require('../theme');
const { fit, fitBalanced } = require('../helpers/text');
const { addDataTable } = require('../components/comparisonTable');
const { S, addStorySlide, addBadge, addThumb, addEmptySlot, resetStory, addStoryFooter } = require('../components/storySlide');
const { countSlide } = require('../components/slideBase');
const { caseRoot } = require('../helpers/caseRoot');

const ROOT = caseRoot();
const W = T.content.w;
const X0 = T.margin.l;
// 文字数の上限は Python 側（build_first_visit.py / preflight.py）と同じファイルを読む
const LIMITS = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'vocab', '_limits.json'), 'utf8')); } catch (e) { return { body_chars: 160 }; }
})();

const FV = { images: 0, missing: [], qa: [], page: 0, notes: [] };
function fvStats() { return FV; }

function brandColor(i) { return T.brandColors[(i || 0) % T.brandColors.length]; }

/** 案件ディレクトリ基準で画像を解決。無ければ記録して null（ダミーで埋めない） */
function cover(p, where) {
  if (!p) return null;
  const abs = path.isAbsolute(p) ? p : path.join(ROOT, p);
  if (!fs.existsSync(abs)) {
    FV.missing.push(`${p} ← ${where}`);
    return null;
  }
  FV.images += 1;
  return abs;
}

/** そのページで使った投稿をノートに残す（紙の資料を見ながら「…624491 を差し替え」と言えるように） */
function note(c) {
  if (!c || !c.video_id) return;
  FV.notes.push(`…${c.video_id.slice(-6)}　@${c.author || ''}　${c.axis || ''} ${c.rank ? c.rank + '位' : ''}　${c.video_id}　${c.url || ''}`);
}

function finishPage(s, pageNo, expect) {
  if (FV.notes.length) s.addNotes(`この頁の投稿（ラベルは labels.json・前日レビューは review/初訪_レビュー.html）\n${FV.notes.join('\n')}`);
  FV.notes = [];
  if (s._fvChars > (LIMITS.body_chars || 160)) {
    FV.qa.push(`FV文字量超過 p${pageNo}: 本文${s._fvChars}字/${LIMITS.body_chars || 160}`);
  }
  if (expect && expect.have < expect.want) {
    FV.qa.push(`FVカード不足 p${pageNo}: ${expect.have}/${expect.want}（${expect.why}）`);
  }
}

/** カバー＋（左上）順位バッジ＋（右上）PR/公式バッジ＋（下）再生数 */
function thumbCard(s, c, box, opt = {}) {
  const abs = cover(c && c.cover, opt.where || '?');
  const b = abs ? addThumb(s, abs, box, c.url) : null;
  if (!b) {
    addEmptySlot(s, box, '画像なし');
    return box;
  }
  note(c);
  if (c.media === 'photo') {
    // 写真カルーセルは1枚目しか見えない。動画と同じに見せない
    addBadge(s, { x: b.x + 0.08, y: b.y + b.h - 0.38, text: c.image_count ? `写真${c.image_count}枚` : '写真', fill: '55524C' });
  }
  if (opt.rank && c.rank) addBadge(s, { x: b.x + 0.08, y: b.y + 0.08, text: `${c.rank}位`, size: 12 });
  const badges = [];
  if (c.is_pr) badges.push(['PR', 'A24765']);
  if (c.poster === 'official') badges.push(['公式', '2F5397']);
  let bx = b.x + b.w - 0.08;
  badges.forEach(([t, col]) => {
    const w = 0.16 + t.length * 0.20;
    bx -= w;
    addBadge(s, { x: bx, y: b.y + 0.08, text: t, fill: col, w });
    bx -= 0.06;
  });
  if (opt.views !== false && c.views_label) {
    s.addText(`▶ ${c.views_label}`, {
      x: b.x, y: b.y + b.h + 0.04, w: b.w, h: 0.30,
      fontFace: T.font.gothic, fontSize: opt.viewsSize || 12, bold: true, color: T.color.text, valign: 'top',
    });
  }
  return b;
}

/** チップ（切り口・訴求の短い名前）。ラベル付き */
function chip(s, { x, y, w, label, text, color }) {
  s.addText(label, {
    x, y, w: 0.9, h: 0.40,
    fontFace: T.font.gothic, fontSize: 11, color: T.color.sub, valign: 'middle',
  });
  s.addShape('rect', { x: x + 0.92, y: y + 0.02, w: w - 0.92, h: 0.36, fill: { color: color || T.color.chipDark }, line: { width: 0 } });
  s.addText(text, {
    x: x + 0.92, y: y + 0.02, w: w - 0.92, h: 0.36,
    fontFace: T.font.gothic, fontSize: fit(text, w - 0.92, 0.36, { base: 15, min: 10, lineHeight: 1.0, quiet: true }),
    bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0,
  });
}

// ───────────────────────────────── P1 表紙
function slideCover(pptx, fv) {
  const p = fv.project;
  const s = pptx.addSlide();
  countSlide();
  s.background = { color: T.color.bg };
  s.addText(p.recipient || '', {
    x: X0, y: 0.70, w: 10.0, h: 0.52,
    fontFace: T.font.gothic, fontSize: 18, bold: true, color: T.color.text, valign: 'middle',
  });
  s.addText('CONFIDENTIAL', {
    x: T.slide.w - T.margin.r - 5.0, y: 0.70, w: 5.0, h: 0.52,
    fontFace: T.font.gothic, fontSize: 15, color: T.color.subLight, align: 'right', valign: 'middle', charSpacing: 2.4,
  });
  s.addShape('line', { x: X0, y: 1.34, w: W, h: 0, line: { color: T.color.rule, width: 1.1 } });
  s.addText('TIKTOK SEARCH — FIRST VISIT', {
    x: X0, y: 2.55, w: 11.0, h: 0.44,
    fontFace: T.font.gothic, fontSize: 15, bold: true, color: T.brandColors[0], charSpacing: 3.2, valign: 'middle',
  });
  const title = p.cover_title || '';
  s.addText(title, {
    x: X0, y: 3.15, w: 10.6, h: 3.2,
    fontFace: T.font.mincho, fontSize: fit(title, 10.6, 3.2, { base: 54, min: 32, lineHeight: 1.2 }),
    bold: true, color: T.color.text, valign: 'top', lineSpacingMultiple: 1.12,
  });
  const meta = [p.date_label, p.producer].filter(Boolean).join('　／　');
  s.addText(meta, {
    x: X0, y: 9.45, w: 10.6, h: 0.44,
    fontFace: T.font.gothic, fontSize: 15, color: T.color.sub, valign: 'middle',
  });
  // 右に関連確認済みのカバーを3枚（表紙の画像も本編と同じ関連ゲートを通したもの）
  const shots = (fv.cover_cards || []).slice(0, 3);
  const bw = 2.25; const bh = bw * 16 / 9;
  const right = T.slide.w - T.margin.r;
  shots.forEach((c, i) => {
    // 右端から並べる（左から置くと3枚目がスライド外へ出た）
    const x = right - (shots.length - i) * bw - (shots.length - 1 - i) * 0.22;
    const y = 2.40 + (i % 2) * 0.55;
    const abs = cover(c.cover, '表紙');
    if (abs) { addThumb(s, abs, { x, y, w: bw, h: bh }, c.url); note(c); }
  });
  return s;
}

// ───────────────────────────────── P2 いま検索するとこう見える
function slideNow(pptx, pg, ctx) {
  const s = addStorySlide(pptx, { kicker: '01　いま、検索するとこう見える', headline: pg.headline, sub: pg.sub, footer: ctx.footer });
  // 検索窓（絵文字は明朝・ゴシックに字形が無く豆腐になるため、虫眼鏡は図形で描く）
  const y0 = S.top + 0.05;
  s.addShape('roundRect', {
    x: X0, y: y0, w: 7.6, h: 0.62, rectRadius: 0.31,
    fill: { color: 'FFFFFF' }, line: { color: T.color.cardLine, width: 1 },
  });
  s.addShape('ellipse', { x: X0 + 0.30, y: y0 + 0.15, w: 0.26, h: 0.26, fill: { type: 'none' }, line: { color: T.color.sub, width: 1.6 } });
  s.addShape('line', { x: X0 + 0.52, y: y0 + 0.38, w: 0.12, h: 0.12, line: { color: T.color.sub, width: 1.6 } });
  s.addText(pg.query || '', {
    x: X0 + 0.80, y: y0, w: 6.6, h: 0.62,
    fontFace: T.font.gothic, fontSize: 19, bold: true, color: T.color.text, valign: 'middle',
  });
  s.addText(pg.caption || '', {
    x: X0 + 7.9, y: y0, w: W - 7.9, h: 0.62,
    fontFace: T.font.gothic, fontSize: 12, color: T.color.subLight, valign: 'middle',
  });
  const cards = (pg.cards || []).slice(0, 8);
  const n = Math.max(cards.length, 1);
  const gap = 0.22;
  const tw = Math.min(2.02, (W - (n - 1) * gap) / n);
  const th = tw * 16 / 9;
  const ty = y0 + 0.95;
  cards.forEach((c, i) => {
    thumbCard(s, c, { x: X0 + i * (tw + gap), y: ty, w: tw, h: th }, { rank: true, where: 'P2' });
  });
  // 投稿者の内訳を1本の帯で（文章にしない）
  const mix = (pg.poster_mix || []).filter((m) => m.count > 0);
  const total = mix.reduce((a, m) => a + m.count, 0);
  if (total) {
    const by = ty + th + 0.62;
    s.addText('表示されている投稿の内訳', {
      x: X0, y: by, w: 4.0, h: 0.36, fontFace: T.font.gothic, fontSize: 12, color: T.color.sub, valign: 'middle',
    });
    let bx = X0 + 4.0;
    const bwAll = W - 4.0;
    const cols = { 公式: '2F5397', クリエイター: 'A24765', 個人: '55524C', メディア: '9B978F' };
    mix.forEach((m) => {
      const w = bwAll * (m.count / total);
      s.addShape('rect', { x: bx, y: by + 0.02, w, h: 0.34, fill: { color: cols[m.id] || '9B978F' }, line: { color: T.color.bg, width: 1 } });
      if (w > 1.2) {
        s.addText(`${m.short || m.label} ${m.count}`, {
          x: bx, y: by + 0.02, w, h: 0.34, fontFace: T.font.gothic, fontSize: 11, bold: true, color: 'FFFFFF',
          align: 'center', valign: 'middle', margin: 0,
        });
      }
      bx += w;
    });
  }
  finishPage(s, ctx.page, { have: cards.length, want: 8, why: '関連・検索画面のカバーがある投稿が足りない' });
  return s;
}

// ───────────────────────────────── P3 競合はこう発信している
function slideCompetitors(pptx, pg, ctx) {
  const s = addStorySlide(pptx, { kicker: '02　競合はこう発信している', headline: pg.headline, sub: pg.sub, footer: ctx.footer });
  const cols = pg.columns || [];
  const n = Math.max(cols.length, 1);
  const gap = 0.45;
  const cw = (W - (n - 1) * gap) / n;
  cols.forEach((c, i) => {
    const x = X0 + i * (cw + gap);
    const color = brandColor(c.color_index);
    s.addShape('rect', { x, y: S.top + 0.05, w: 0.20, h: 0.42, fill: { color }, line: { width: 0 } });
    s.addText(c.brand, {
      x: x + 0.32, y: S.top, w: cw - 0.32, h: 0.52,
      fontFace: T.font.gothic, fontSize: fit(c.brand, cw - 0.32, 0.52, { base: 20, min: 13, lineHeight: 1.0, quiet: true }),
      bold: true, color: T.color.text, valign: 'middle',
    });
    const thumbs = (c.cards || []).slice(0, 2);
    const tgap = 0.18;
    const tw = Math.min(2.55, (cw - tgap) / 2);
    const th = tw * 16 / 9;
    const ty = S.top + 0.72;
    thumbs.forEach((t, j) => thumbCard(s, t, { x: x + j * (tw + tgap), y: ty, w: tw, h: th }, { where: `P3 ${c.brand}` }));
    let cy = ty + th + 0.48;
    if (c.angle) {
      chip(s, { x, y: cy, w: Math.min(cw, 4.6), label: '切り口', text: c.angle.short || c.angle.label, color });
      s.addText(`${c.n}本中${c.angle.count}本`, {
        x: x + Math.min(cw, 4.6) + 0.12, y: cy, w: Math.max(0.8, cw - Math.min(cw, 4.6) - 0.12), h: 0.40,
        fontFace: T.font.gothic, fontSize: 12, color: T.color.sub, valign: 'middle',
      });
      cy += 0.52;
    }
    if (c.appeal) {
      chip(s, { x, y: cy, w: Math.min(cw, 4.6), label: '訴求', text: c.appeal.short || c.appeal.label, color: T.color.chipDark });
      s.addText(`${c.n}本中${c.appeal.count}本`, {
        x: x + Math.min(cw, 4.6) + 0.12, y: cy, w: Math.max(0.8, cw - Math.min(cw, 4.6) - 0.12), h: 0.40,
        fontFace: T.font.gothic, fontSize: 12, color: T.color.sub, valign: 'middle',
      });
      cy += 0.52;
    }
    const line = c.note || (c.scattered ? '切り口はばらけている' : null);
    if (line) {
      s.addText(line, {
        x, y: cy, w: cw, h: 0.40,
        fontFace: T.font.gothic, fontSize: 13, color: T.color.sub, valign: 'middle',
      });
      cy += 0.46;
    }
    if (c.paid_line) {
      s.addText(c.paid_line, {
        x, y: cy + 0.04, w: cw, h: 0.40,
        fontFace: T.font.gothic, fontSize: fit(c.paid_line, cw, 0.40, { base: 13, min: 10, lineHeight: 1.1, quiet: true }),
        bold: true, color: 'A24765', valign: 'middle',
      });
    }
  });
  finishPage(s, ctx.page, { have: cols.length, want: 2, why: '比べられる競合が1社' });
  return s;
}

// ───────────────────────────────── P4 競合がお金をかけて広げている訴求
function slidePaid(pptx, pg, ctx) {
  const s = addStorySlide(pptx, { kicker: '03　競合がお金をかけて広げている訴求', headline: pg.headline, sub: pg.sub, footer: ctx.footer });
  const cards = (pg.cards || []).slice(0, 4);
  const n = Math.max(cards.length, 1);
  const gap = 0.5;
  const cw = Math.min(4.0, (W - (n - 1) * gap) / n);
  const startX = X0 + (W - (n * cw + (n - 1) * gap)) / 2;
  const th = Math.min(5.0, cw * 16 / 9 * 0.82);
  const tw = th * 9 / 16;
  cards.forEach((c, i) => {
    const x = startX + i * (cw + gap);
    const color = brandColor(c.color_index);
    const b = thumbCard(s, c, { x: x + (cw - tw) / 2, y: S.top + 0.10, w: tw, h: th }, { where: `P4 ${c.brand}`, views: false });
    let y = b.y + b.h + 0.18;
    s.addShape('rect', { x, y: y + 0.08, w: 0.16, h: 0.26, fill: { color }, line: { width: 0 } });
    s.addText(`${c.brand}　${c.badge || ''}`, {
      x: x + 0.26, y, w: cw - 0.26, h: 0.42,
      fontFace: T.font.gothic, fontSize: 13, bold: true, color: T.color.text, valign: 'middle',
    });
    y += 0.46;
    s.addText(c.appeal_label || '', {
      x, y, w: cw, h: 0.62,
      fontFace: T.font.mincho, fontSize: fit(c.appeal_label || '', cw, 0.62, { base: 24, min: 15, lineHeight: 1.1, quiet: true }),
      bold: true, color: T.color.text, valign: 'middle',
    });
    s.addText(`▶ ${c.views_label || '—'}`, {
      x, y: y + 0.64, w: cw, h: 0.32, fontFace: T.font.gothic, fontSize: 12, color: T.color.sub, valign: 'middle',
    });
  });
  finishPage(s, ctx.page, { have: cards.length, want: 3, why: 'PR・公式の関連投稿でカバーのあるもの' });
  return s;
}

// ───────────────────────────────── P5 貴社に足りていない発信
function slideGap(pptx, pg, ctx) {
  const s = addStorySlide(pptx, { kicker: `04　${ctx.client}に足りていない発信`, headline: pg.headline, sub: pg.sub, footer: ctx.footer });
  const rows = (pg.rows || []).slice(0, 3);
  const n = Math.max(rows.length, 1);
  const gap = 0.55;
  const cw = (W - (n - 1) * gap) / n;
  rows.forEach((r, i) => {
    const x = X0 + i * (cw + gap);
    s.addText(r.label, {
      x, y: S.top, w: cw, h: 0.62,
      fontFace: T.font.mincho, fontSize: fit(r.label, cw, 0.62, { base: 26, min: 16, lineHeight: 1.1, quiet: true }),
      bold: true, color: T.color.text, valign: 'middle',
    });
    const tgap = 0.30;
    const tw = Math.min(2.45, (cw - tgap) / 2);
    const th = tw * 16 / 9;
    const ty = S.top + 1.12;
    // 左＝競合（または市場）の実例、右＝貴社の枠
    const lc = r.left || {};
    s.addText(lc.caption || '', {
      x, y: ty - 0.42, w: tw, h: 0.36, fontFace: T.font.gothic, fontSize: 12, bold: true,
      color: brandColor(lc.color_index), valign: 'middle',
    });
    thumbCard(s, lc, { x, y: ty, w: tw, h: th }, { where: `P5 ${r.label}` });
    const rx = x + tw + tgap;
    s.addText(pg.right_label || ctx.client, {
      x: rx, y: ty - 0.42, w: tw, h: 0.36, fontFace: T.font.gothic, fontSize: 12, bold: true,
      color: T.color.text, valign: 'middle',
    });
    if (r.right && r.right.cover) {
      thumbCard(s, r.right, { x: rx, y: ty, w: tw, h: th }, { where: `P5 ${ctx.client}` });
    } else {
      addEmptySlot(s, { x: rx, y: ty, w: tw, h: th }, r.right_text || 'まだ無し');
    }
    if (r.evidence) {
      s.addText(r.evidence, {
        x, y: ty + th + 0.42, w: cw, h: 0.40,
        fontFace: T.font.gothic, fontSize: fit(r.evidence, cw, 0.40, { base: 13, min: 10, lineHeight: 1.1, quiet: true }),
        color: T.color.sub, valign: 'middle',
      });
    }
  });
  if (!rows.length) {
    // 型の空白は言えないが、公式アカウントの不在は言える場合（数字だけを大きく）
    s.addText('0本', {
      x: X0, y: S.top + 1.2, w: W, h: 2.6, fontFace: T.font.en, fontSize: 150, bold: true,
      color: T.brandColors[0], align: 'center', valign: 'middle',
    });
    s.addText(`「${pg.query || ''}」上位30本のうち、${ctx.client}公式アカウントの投稿`, {
      x: X0, y: S.top + 4.0, w: W, h: 0.6, fontFace: T.font.gothic, fontSize: 18, color: T.color.sub, align: 'center', valign: 'middle',
    });
  }
  finishPage(s, ctx.page, pg.mode === 'official' ? null : { have: rows.length, want: 3, why: '言える空白の型が少ない' });
  return s;
}

// ───────────────────────────────── P6 いま伸びている型（お土産）
function slideWinning(pptx, pg, ctx) {
  const s = addStorySlide(pptx, { kicker: '05　いま伸びている型', headline: pg.headline, sub: pg.sub, footer: ctx.footer, tag: 'お土産' });
  const cards = (pg.cards || []).slice(0, 3);
  const n = Math.max(cards.length, 1);
  const gap = 0.5;
  const cw = (W - (n - 1) * gap) / n;
  cards.forEach((c, i) => {
    const x = X0 + i * (cw + gap);
    // 型が1〜2つのときは画像を大きくする（3列用の寸法のままだと紙面の半分以上が空く）
    const tw = n === 1 ? 3.6 : Math.min(2.75, cw * 0.47);
    const th = tw * 16 / 9;
    thumbCard(s, c.example || {}, { x, y: S.top + 0.12, w: tw, h: th }, { where: `P6 ${c.label}` });
    const tx = x + tw + 0.30;
    const txw = cw - tw - 0.30;
    s.addText(String(i + 1).padStart(2, '0'), {
      x: tx, y: S.top + 0.05, w: txw, h: 0.50, fontFace: T.font.en, fontSize: 22, bold: true, color: T.brandColors[0], valign: 'middle',
    });
    s.addText(c.label, {
      x: tx, y: S.top + 0.60, w: txw, h: 1.10,
      fontFace: T.font.mincho, fontSize: fit(c.label, txw, 1.10, { base: 26, min: 16, lineHeight: 1.15, quiet: true }),
      bold: true, color: T.color.text, valign: 'top',
    });
    s.addText(c.phrase || '', {
      x: tx, y: S.top + 1.75, w: txw, h: 1.10,
      fontFace: T.font.gothic, fontSize: fit(c.phrase || '', txw, 1.10, { base: 16, min: 11, lineHeight: 1.4, quiet: true }),
      color: T.color.text, valign: 'top', lineSpacingMultiple: 1.3,
    });
    if (c.lift_label) {
      s.addText(c.lift_label, {
        x: tx, y: S.top + 3.05, w: txw, h: 0.95,
        fontFace: T.font.gothic, fontSize: 40, bold: true, color: T.brandColors[0], valign: 'middle',
      });
    }
    s.addText(c.evidence || '', {
      x: tx, y: S.top + 4.02, w: txw, h: 0.80,
      fontFace: T.font.gothic, fontSize: fit(c.evidence || '', txw, 0.80, { base: 13, min: 10, lineHeight: 1.3, quiet: true }),
      color: T.color.sub, valign: 'top',
    });
  });
  finishPage(s, ctx.page, { have: cards.length, want: 3, why: pg.winners ? '伸びている型が少ない' : 'まだ勝ち型が無い' });
  return s;
}

// ───────────────────────────────── P7 まずこの3本
function slidePlans(pptx, pg, ctx) {
  const s = addStorySlide(pptx, { kicker: '06　まずこの3本', headline: pg.headline, sub: pg.sub, footer: ctx.footer, tag: '提案（仮説）' });
  const items = (pg.items || []).slice(0, 3);
  const n = Math.max(items.length, 1);
  const gap = 0.5;
  const cw = (W - (n - 1) * gap) / n;
  items.forEach((it, i) => {
    const x = X0 + i * (cw + gap);
    s.addShape('rect', { x, y: S.top + 0.05, w: cw, h: 6.95, fill: { color: T.color.cardBg }, line: { color: T.color.cardLine, width: 1 } });
    s.addText(String(i + 1).padStart(2, '0'), {
      x: x + 0.30, y: S.top + 0.25, w: 1.5, h: 0.70, fontFace: T.font.en, fontSize: 34, bold: true, color: T.brandColors[0], valign: 'middle',
    });
    // 「…で見せ／る」のように1〜2字だけ次の行へ落ちると読めない。最終行が短くならない大きさを選ぶ
    s.addText(it.title, {
      x: x + 0.30, y: S.top + 1.05, w: cw - 0.60, h: 1.25,
      fontFace: T.font.mincho, fontSize: fitBalanced(it.title, cw - 0.60, 1.25, { base: 24, min: 15, lineHeight: 1.2, minTail: 5 }),
      bold: true, color: T.color.text, valign: 'top',
    });
    let cy = S.top + 2.45;
    if (it.angle_short) { chip(s, { x: x + 0.30, y: cy, w: Math.min(3.6, cw - 0.6), label: '切り口', text: it.angle_short, color: T.brandColors[0] }); cy += 0.50; }
    if (it.appeal_short) { chip(s, { x: x + 0.30, y: cy, w: Math.min(3.6, cw - 0.6), label: '訴求', text: it.appeal_short }); cy += 0.50; }
    const ref = it.reference;
    if (ref) {
      const th = Math.min(3.35, S.top + 6.8 - (cy + 0.45));
      const tw = th * 9 / 16;
      s.addText('参考', { x: x + 0.30, y: cy + 0.05, w: 1.0, h: 0.32, fontFace: T.font.gothic, fontSize: 11, color: T.color.sub, valign: 'middle' });
      thumbCard(s, ref, { x: x + 0.30, y: cy + 0.40, w: tw, h: th }, { where: `P7 ${it.title}` });
      if (it.reason) {
        s.addText(it.reason, {
          x: x + 0.30 + tw + 0.25, y: cy + 0.40, w: cw - 0.85 - tw, h: th,
          fontFace: T.font.gothic, fontSize: fit(it.reason, cw - 0.85 - tw, th, { base: 13, min: 10, lineHeight: 1.4, quiet: true }),
          color: T.color.sub, valign: 'bottom',
        });
      }
    }
  });
  finishPage(s, ctx.page, { have: items.length, want: 3, why: '型の候補が少ない' });
  return s;
}

// ───────────────────────────────── P8 次回
function slideNext(pptx, pg, ctx) {
  const s = addStorySlide(pptx, { kicker: '07　次回', headline: pg.headline, sub: pg.sub, footer: ctx.footer });
  const colW = (W - 1.0) / 2;
  const blocks = [['次回お持ちするもの', pg.bring || [], T.brandColors[0]], ['教えていただきたいこと', pg.ask || [], T.color.text]];
  blocks.forEach(([title, list, color], bi) => {
    const x = X0 + bi * (colW + 1.0);
    s.addText(title, { x, y: S.top + 0.10, w: colW, h: 0.46, fontFace: T.font.gothic, fontSize: 15, bold: true, color, valign: 'middle' });
    s.addShape('line', { x, y: S.top + 0.62, w: colW, h: 0, line: { color: T.color.ruleThin, width: 1 } });
    list.slice(0, 3).forEach((t, i) => {
      const y = S.top + 0.85 + i * 1.25;
      s.addText(String(i + 1).padStart(2, '0'), { x, y, w: 0.9, h: 0.9, fontFace: T.font.en, fontSize: 26, bold: true, color, valign: 'middle' });
      s.addText(t, {
        x: x + 1.0, y, w: colW - 1.0, h: 0.9,
        fontFace: T.font.gothic, fontSize: fit(t, colW - 1.0, 0.9, { base: 21, min: 14, lineHeight: 1.25, quiet: true }),
        bold: bi === 0, color: T.color.text, valign: 'middle',
      });
    });
  });
  if (pg.service) {
    const y = T.content.bottom - 1.15;
    s.addShape('rect', { x: X0, y, w: W, h: 0.95, fill: { color: T.color.dark }, line: { width: 0 } });
    s.addText(pg.service, {
      x: X0 + 0.5, y, w: W - 1.0, h: 0.95,
      fontFace: T.font.mincho, fontSize: fit(pg.service, W - 1.0, 0.95, { base: 22, min: 14, lineHeight: 1.2, quiet: true }),
      bold: true, color: 'FFFFFF', valign: 'middle',
    });
  }
  finishPage(s, ctx.page, null);
  return s;
}

// ───────────────────────────────── 付録（最大2枚）
function slideAppendixPremise(pptx, ap, ctx) {
  const s = addStorySlide(pptx, { kicker: '付録1', headline: '調査の前提', sub: '', footer: ctx.footer, accent: T.color.sub });
  const rows = (ap.premise || []);
  const labelW = 3.0;
  const bodyW = W - labelW - 0.3;
  const room = T.content.bottom - (S.top + 0.1);
  const per = Math.min(0.95, room / Math.max(rows.length, 1));
  rows.forEach(([k, v], i) => {
    const y = S.top + 0.1 + i * per;
    s.addShape('line', { x: X0, y, w: W, h: 0, line: { color: T.color.ruleThin, width: 0.8 } });
    s.addText(k, { x: X0, y: y + 0.06, w: labelW, h: per - 0.1, fontFace: T.font.gothic, fontSize: 13, bold: true, color: T.color.text, valign: 'top' });
    s.addText(v, {
      x: X0 + labelW + 0.3, y: y + 0.06, w: bodyW, h: per - 0.1,
      fontFace: T.font.gothic, fontSize: fit(v, bodyW, per - 0.1, { base: 13, min: 9.5, lineHeight: 1.35 }),
      color: T.color.sub, valign: 'top', lineSpacingMultiple: 1.25,
    });
  });
  return s;
}

function slideAppendixNumbers(pptx, ap, ctx) {
  const s = addStorySlide(pptx, { kicker: '付録2', headline: '数字の一覧', sub: '', footer: ctx.footer, accent: T.color.sub });
  const t = ap.table || { head: [], rows: [] };
  const colW = t.col_w || t.head.map(() => W / Math.max(t.head.length, 1));
  const y = S.top + 0.1;
  const r = addDataTable(s, { x: X0, y, w: W, head: t.head, rows: t.rows, colW, fontSize: 13, maxH: 3.2 });
  const m = ap.matrix;
  if (m && m.rows && m.rows.length) {
    const my = y + ((r && r.height) || 2.6) + 0.45;
    s.addText(m.title || '', { x: X0, y: my, w: W, h: 0.36, fontFace: T.font.gothic, fontSize: 13, bold: true, color: T.color.text, valign: 'middle' });
    addDataTable(s, {
      x: X0, y: my + 0.42, w: W, head: m.head, rows: m.rows,
      colW: m.col_w || m.head.map(() => W / m.head.length), fontSize: 12,
      maxH: T.content.bottom - (my + 0.42) - 0.05,
    });
  }
  return s;
}

const RENDER = {
  now: slideNow, competitors: slideCompetitors, paid: slidePaid, gap: slideGap,
  winning: slideWinning, plans: slidePlans, next: slideNext,
};

/** 初訪の全ページを組む。返り値は枚数 */
function buildFirstVisit(pptx, fv) {
  const order = (fv.order || []).filter((k) => fv.pages[k] && RENDER[k]);
  const hasAppendix = fv.appendix && (fv.appendix.premise || fv.appendix.table);
  const total = 1 + order.length + (hasAppendix ? 2 : 0);
  resetStory(total);
  const ctx = { footer: fv.project.footer || '', client: fv.project.client_short || fv.project.client, page: 1 };
  const cs = slideCover(pptx, fv);
  if (FV.notes.length) { cs.addNotes(`表紙の投稿\n${FV.notes.join('\n')}`); FV.notes = []; }
  // 表紙はページ番号を出さないが、数には入れる（本編の番号＝物理位置にそろえる）
  addStoryFooterSkip();
  order.forEach((k) => {
    ctx.page += 1;
    const pg = { ...fv.pages[k], query: fv.project.query };
    RENDER[k](pptx, pg, ctx);
  });
  if (hasAppendix) {
    slideAppendixPremise(pptx, fv.appendix, ctx);
    slideAppendixNumbers(pptx, fv.appendix, ctx);
  }
  return total;
}

// 表紙の分だけ番号を進める（表紙にはフッターを描かない）
function addStoryFooterSkip() {
  const dummy = { addText: () => {} };
  addStoryFooter(dummy, null);
}

module.exports = { buildFirstVisit, fvStats };
