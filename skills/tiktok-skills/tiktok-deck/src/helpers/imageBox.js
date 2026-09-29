// imageBox.js — 画像の実寸を読み、枠内に縦横比を保って収める箱を返す。
// pptxgenjs の sizing:'contain' は書き出し結果に反映されなかったため、こちらで座標を決める。
// 縦横比を壊さない（tools/preflight.py が「縦横比」として検査する）。
const fs = require('fs');

const cache = new Map();

/** PNG / JPEG のヘッダから実寸を取る。読めなければ null。 */
function imageSize(p) {
  if (cache.has(p)) return cache.get(p);
  let r = null;
  try {
    const b = fs.readFileSync(p);
    if (b.length > 24 && b.toString('ascii', 1, 4) === 'PNG') {
      r = { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    } else if (b[0] === 0xFF && b[1] === 0xD8) {
      let i = 2;
      while (i < b.length - 9) {
        if (b[i] !== 0xFF) { i += 1; continue; }
        const m = b[i + 1];
        // SOF0-SOF15（DHT/DAC/RST/SOS は除く）に実寸が入る
        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
          r = { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
          break;
        }
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
  } catch (e) { r = null; }
  cache.set(p, r);
  return r;
}

/**
 * 枠 (x,y,w,h) の中に、実寸の縦横比のまま最大で収まる箱を返す。
 * align: 'center'（既定）/ 'left' / 'top'
 */
function fitBox(p, x, y, w, h, align = 'center') {
  const s = imageSize(p);
  if (!s || !s.w || !s.h) return { x, y, w, h };
  const scale = Math.min(w / s.w, h / s.h);
  const iw = s.w * scale;
  const ih = s.h * scale;
  const ix = align === 'left' ? x : x + (w - iw) / 2;
  const iy = align === 'top' ? y : y + (h - ih) / 2;
  return { x: ix, y: iy, w: iw, h: ih };
}

/**
 * 画像に投稿へのリンクを張るための共通オプション。
 * URL が無ければ何も足さない（壊れたリンクを作らない）。
 */
function linkTo(url) {
  // pptxgenjs は画像リンクの Target を XML エスケープせずに rels へ書く。
  // ブラウザからコピーした TikTok URL（?is_from_webapp=1&sender_device=pc）の & だけで PPTX が壊れるので、
  // TikTok の URL は ? 以降を落とし、それでも XML に危ない字が残る URL にはリンクを張らない
  let x;
  try {
    x = new URL(String(url || '').trim());
  } catch (e) {
    return {};
  }
  if (!/^https?:$/.test(x.protocol)) return {};
  if (/(^|\.)tiktok\.com$/i.test(x.hostname)) { x.search = ''; x.hash = ''; }
  const u = x.href;
  if (/["'<>&\s]/.test(u)) return {};
  return { hyperlink: { url: u, tooltip: '投稿を開く' } };
}

/**
 * 画像にリンクを張り、押せることが分かる小さな印を右下に置く。
 * 印が無いと、紙で見た人にリンクの存在が伝わらない。
 */
function addLinkedImage(slide, path, box, url, T) {
  slide.addImage({ path, ...box, ...linkTo(url) });
  const u = String(url || '').trim();
  if (!/^https?:\/\//.test(u)) return;
  const w = 0.92; const h = 0.26;
  // 画像の中に置くと投稿自身のテロップやCTAに被る（実際に「保存しておくとあとで
  // 見返せるよ」が読めなくなった）。画像の外・右上の空き帯へ出す
  const x = box.x + box.w - w;
  const y = box.y - h - 0.08;
  // PowerPoint はリンク文字を既定色（紫）で塗るため、色は文字側で明示する。
  // 半透明の黒地に紫だと読めない
  slide.addShape('roundRect', {
    x, y, w, h, rectRadius: 0.05,
    fill: { color: 'FFFFFF' }, line: { color: '3C3C3C', width: 0.75 },
    hyperlink: { url: u, tooltip: '投稿を開く' },
  });
  slide.addText([{ text: '▶ 投稿を開く', options: { color: '1A1A1A', hyperlink: { url: u, tooltip: '投稿を開く' } } }], {
    x, y, w, h,
    fontFace: (T && T.font && T.font.gothic) || 'Hiragino Kaku Gothic ProN',
    fontSize: 8.5, bold: true, align: 'center', valign: 'middle',
  });
}

module.exports = { imageSize, fitBox, linkTo, addLinkedImage };
