// data.js — 欠損判定と表記統一（CLAUDE.md §6：入力にない数値は補完しない）
const PLACEHOLDER_DATA = '[DATA NOT PROVIDED]';
const PLACEHOLDER_IMAGE = '[IMAGE NOT PROVIDED]';

const stats = {
  missingData: 0,
  missingImages: 0,
  imagesUsed: 0,
  hypotheses: 0,
  qaFixes: [],
};

/** スライドに Markdown の強調記号を出さない（** がそのまま印字される事故を防ぐ） */
function stripMarkdown(t) {
  return String(t)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1');
}

function isMissing(v) {
  if (v === undefined || v === null) return true;
  const s = String(v).trim();
  return s === '' || s === PLACEHOLDER_DATA || s === PLACEHOLDER_IMAGE;
}

// 素材の連番ファイル名（00.jpg／frame00）は社内の作業名でクライアントには意味がない。
// 資料上の呼び方（「00のコマ」）へ寄せる。1箇所でも出ると提出物として体裁を欠く
function scrubAssetNames(s) {
  return s
    .replace(/^画面\s*[:：]\s*/, '')            // テンプレの項目名の消し残し
    .replace(/最終フレーム/g, '最終コマ')
    .replace(/フレーム\s*(\d{2})/g, '$1のコマ')
    .replace(/frame\s*(\d{2})/gi, '$1のコマ')
    .replace(/(\d{2})\.jpe?g/gi, '$1のコマ')
    .replace(/最終(\d{2})コマ/g, '最終コマ（$1）')
    .replace(/最終コマ（(\d{2})のコマ/g, '最終コマ（$1')   // 「最終コマ（10のコマ…」の重複を畳む
    .replace(/のコマ[\s]*の/g, 'のコマの')
    .replace(/のコマ[\s]*＝/g, 'のコマ＝');
}

// ブランドの色は必ずこの1本で引く。ページ内の並び順で引くと、同じブランドが
// ページごとに色を変えたり、別ブランドが同色になったりする
function colorIndexOf(b) {
  return b && typeof b.colorIndex === 'number' ? b.colorIndex : 0;
}

/** 値を返す。欠損なら [DATA NOT PROVIDED] を返し、欠損数を数える */
function val(v) {
  if (isMissing(v)) {
    stats.missingData += 1;
    return PLACEHOLDER_DATA;
  }
  return stripMarkdown(scrubAssetNames(String(v).trim()));
}

/** 数値は桁区切り。数値化できなければそのまま（欠損はプレースホルダ） */
function num(v) {
  if (isMissing(v)) {
    stats.missingData += 1;
    return PLACEHOLDER_DATA;
  }
  const s = String(v).trim().replace(/,/g, '');
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s).toLocaleString('ja-JP');
  return String(v).trim();
}

/** EG率は小数第2位で統一 */
function eg(v) {
  if (isMissing(v)) {
    stats.missingData += 1;
    return PLACEHOLDER_DATA;
  }
  const s = String(v).trim().replace('%', '');
  if (/^-?\d+(\.\d+)?$/.test(s)) return `${Number(s).toFixed(2)}%`;
  return String(v).trim();
}

/** 仮説文。事実と区別するため接頭辞を付ける（CLAUDE.md §6） */
function hypothesis(v) {
  if (isMissing(v)) {
    stats.missingData += 1;
    return PLACEHOLDER_DATA;
  }
  stats.hypotheses += 1;
  const s = String(v).trim();
  return /^勝因仮説|^仮説/.test(s) ? s : `勝因仮説：${s}`;
}

/** 配列を欠損込みで最低 n 件に整える */
function padList(list, n) {
  const out = (list || []).slice(0, Math.max(n, (list || []).length));
  while (out.length < n) out.push(PLACEHOLDER_DATA);
  return out;
}

function isPlaceholderText(s) {
  return s === PLACEHOLDER_DATA || s === PLACEHOLDER_IMAGE;
}

/** ブランドを1ページあたり最大 max 件に分割する（CLAUDE.md §5） */
function chunkBrands(brands, max) {
  const size = Math.max(1, max || 3);
  const out = [];
  for (let i = 0; i < brands.length; i += size) out.push(brands.slice(i, i + size));
  return out;
}

/**
 * 自社を毎ページの先頭に固定し、競合を (max-1) 社ずつ並べる。
 * 比較対象の自社が常に画面にあるほうが読み手の負担が小さく、
 * 「1社だけ残って右3分の2が空く」ページも構造的に発生しない。
 */
function chunkWithOwn(brands, max = 3, isOwn = () => false) {
  const list = brands || [];
  const own = list.find(isOwn);
  if (!own || list.length <= max) return chunkBrands(list, max);
  const others = list.filter((b) => b !== own);
  const per = Math.max(1, max - 1);
  const out = [];
  for (let i = 0; i < others.length; i += per) out.push([own, ...others.slice(i, i + per)]);
  return out;
}

module.exports = { colorIndexOf, stripMarkdown,
  PLACEHOLDER_DATA, PLACEHOLDER_IMAGE,
  stats, isMissing, val, num, eg, hypothesis, padList, isPlaceholderText, chunkBrands, chunkWithOwn };
