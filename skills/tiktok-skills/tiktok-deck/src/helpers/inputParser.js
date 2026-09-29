// inputParser.js — INPUT.md を構造化データへ変換する
// INPUT_TEMPLATE.md の見出し階層を前提とし、存在しないセクションは欠損として扱う（落ちない）。
const fs = require('fs');

const PLACEHOLDER_DATA = '[DATA NOT PROVIDED]';

/** HTMLコメントを除去する */
function stripComments(md) {
  return md.replace(/<!--[\s\S]*?-->/g, '');
}

/** 見出しツリーを作る。各ノード = {level, title, lines, children} */
function buildTree(md) {
  const root = { level: 0, title: '__root__', lines: [], children: [] };
  const stack = [root];
  for (const raw of stripComments(md).split(/\r?\n/)) {
    const m = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (m) {
      const node = { level: m[1].length, title: m[2].trim(), lines: [], children: [] };
      while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    } else {
      stack[stack.length - 1].lines.push(raw);
    }
  }
  return root;
}

/** ノード直下の `- key: value` を辞書化する */
function kv(node) {
  const out = {};
  if (!node) return out;
  for (const line of node.lines) {
    const m = /^\s*-\s+([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** ノード直下の箇条書き（`1. x` / `- x`）を配列化する。キー付き行は除く */
function items(node) {
  const out = [];
  if (!node) return out;
  for (const line of node.lines) {
    let m = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (!m) m = /^\s*-\s+(.*)$/.exec(line);
    if (!m) continue;
    const v = m[1].trim();
    if (/^[A-Za-z0-9_]+\s*:/.test(v)) continue; // key: value 形式は除外
    if (v) out.push(v);
  }
  return out;
}

/**
 * ノード直下の Markdown 表を {head, rows} にする。
 * 表をそのまま書けると、行数の増減で構造を作り直さずに済む。
 * （KEYWORD CROSS SUMMARY を表で書いて空表になった事故の再発防止）
 */
function table(node) {
  if (!node) return null;
  const rows = [];
  for (const line of node.lines) {
    const t = line.trim();
    if (!t.startsWith('|') || !t.endsWith('|')) continue;
    const cells = t.slice(1, -1).split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;   // 区切り行
    rows.push(cells);
  }
  if (!rows.length) return null;
  return { head: rows[0], rows: rows.slice(1) };
}

/** 子ノードを見出しの前方一致で1件取得（大文字小文字無視） */
function child(node, prefix) {
  if (!node) return null;
  const p = prefix.toLowerCase();
  return node.children.find((c) => c.title.toLowerCase().startsWith(p)) || null;
}

/** 子ノードを見出しの前方一致で全件取得 */
function children(node, prefix) {
  if (!node) return [];
  const p = prefix.toLowerCase();
  return node.children.filter((c) => c.title.toLowerCase().startsWith(p));
}

function parseTiers(q1node) {
  const tiers = {};
  for (const key of ['Nano', 'Micro', 'Middle', 'Mega', 'Unknown']) {
    tiers[key.toLowerCase()] = kv(child(q1node, key));
  }
  return tiers;
}

// VIDEO ANALYSIS 配下では `###### VIDEO 01` と `###### Images` `###### Hook` … が
// 同じ見出しレベルで並ぶ（INPUT_TEMPLATE.md の構造）。そのため親子ではなく
// 「次の VIDEO 見出しが来るまで」を1本分としてまとめる。
function groupVideoNodes(vaNode, head = 'VIDEO') {
  const groups = [];
  if (!vaNode) return groups;
  const re = new RegExp(`^${head}\\b`, 'i');
  let cur = null;
  for (const n of vaNode.children) {
    if (re.test(n.title)) {
      cur = { head: n, parts: [] };
      groups.push(cur);
    } else if (cur) {
      cur.parts.push(n);
    }
  }
  return groups;
}

function part(group, prefix) {
  const p = prefix.toLowerCase();
  return group.parts.find((n) => n.title.toLowerCase().startsWith(p)) || null;
}

function parseVideo(group) {
  const base = kv(group.head);
  const img = kv(part(group, 'Images'));
  return {
    video_id: base.video_id || group.head.title.replace(/\s+/g, '_'),
    ...base,
    images: {
      main: img.main_image_path,
      hook: img.hook_image_path,
      killer: img.killer_image_path,
      product: img.product_image_path,
    },
    storyboard: kv(part(group, 'Storyboard')),
    hook: kv(part(group, 'Hook')),
    visual: kv(part(group, 'Visual')),
    text: kv(part(group, 'Text')),
    spec: kv(part(group, 'Price')),
    exposure: kv(part(group, 'Product Exposure')),
    cta: kv(part(group, 'CTA')),
    hypothesis: kv(part(group, 'Hypothesis')),
    essence: kv(part(group, 'One Line')),
  };
}

function parseBrand(node) {
  const b = kv(node);
  const q1 = child(node, 'Q1 Influencer');
  const q3 = child(node, 'Q3');
  const q4 = child(node, 'Q4');
  const q5 = child(node, 'Q5');
  const va = child(node, 'VIDEO ANALYSIS');

  const clusters = children(q3, 'Cluster').map((c) => kv(c));
  const topVideos = children(q5, 'TOP VIDEO').map((c) => kv(c));
  const videos = groupVideoNodes(va).map(parseVideo);
  const listNode = child(node, 'VIDEO LIST');
  const videoList = children(listNode, 'LIST').map((c) => kv(c));

  return {
    brand_id: b.brand_id || node.title,
    brand_name: b.brand_name,
    company_name: b.company_name,
    search_keyword: b.search_keyword,
    total_video_count: b.total_video_count,
    acquisition_note: b.acquisition_note,
    q1: { tiers: parseTiers(q1), example: kv(child(node, 'Q1 Example')), ...kv(child(node, 'Q1 Insight')) },
    q2: kv(child(node, 'Q2')),
    q3: { clusters, ...kv(q3), ...kv(child(node, 'Q3 Findings')) },
    q4: {
      hashtags: items(child(q4, 'Frequent Hashtags')),
      products: items(child(q4, 'Frequent Products')),
      ...kv(q4),
      ...kv(child(node, 'Q4 Findings')),
    },
    q5: { topVideos, ...kv(q5), ...kv(child(node, 'Q5 Insight')) },
    videos,
    videoList,
    videoListMeta: kv(child(node, 'VIDEO LIST')),
  };
}

function parseKeyword(node) {
  const base = kv(node);
  const headNode = child(node, 'Head 20') || child(node, 'Head 10') || child(node, 'Head');
  const findings = kv(child(node, 'Findings'));
  return {
    ...base,
    head: children(headNode, 'HEAD').map((c) => kv(c)),
    composition: kv(child(node, 'Head Composition')),
    saveTop: children(child(node, 'Save Top'), 'SAVE').map((c) => kv(c)),
    // Q5（ブランド軸）と同じ「再生◯以上に限定」の下限をこちらにも表示するため
    saveTopMeta: kv(child(node, 'Save Top')),
    egTop: children(child(node, 'EG Top'), 'EG').map((c) => kv(c)),
    clusters: children(child(node, 'Clusters'), 'Cluster').map((c) => kv(c)),
    brandExposure: children(child(node, 'Brand Exposure'), 'EXPOSURE').map((c) => kv(c)),
    hashtags: items(child(node, 'Hashtags')),
    findings,
  };
}

/** `value | count` のような行を、最後の区切り文字で2項目に分ける */
function pipePair(line, leftKey, rightKey) {
  const text = String(line || '').trim();
  const pos = text.lastIndexOf('|');
  if (pos < 0) return { [leftKey]: text, [rightKey]: undefined };
  return {
    [leftKey]: text.slice(0, pos).trim(),
    [rightKey]: text.slice(pos + 1).trim(),
  };
}

/** `- key: a | b | c` を箇条書き表示用の配列にする */
function inlineList(value) {
  if (value === undefined || value === null || String(value).trim() === '') return [];
  return String(value).split(/\s*(?:\||；|;)\s*/).map((v) => v.trim()).filter(Boolean);
}

function parseReviewBrand(node) {
  const base = kv(node);
  return {
    ...base,
    brand_id: base.brand_id || node.title,
    love: items(child(node, 'Love')).map((line) => pipePair(line, 'reason', 'mentions')),
    churn: items(child(node, 'Churn')).map((line) => pipePair(line, 'reason', 'mentions')),
    quotes: items(child(node, 'Quotes')).map((line) => pipePair(line, 'quote', 'source_url')),
  };
}

function parseReviews(node) {
  if (!node) return null;
  const brandsRoot = child(node, 'BRAND REVIEWS');
  const cross = kv(child(node, 'CROSS'));
  return {
    survey: kv(child(node, 'SURVEY')),
    brands: children(brandsRoot, 'BRAND').map(parseReviewBrand),
    cross: {
      ...cross,
      love_patterns: inlineList(cross.love_patterns),
      churn_patterns: inlineList(cross.churn_patterns),
    },
    actions: items(child(node, 'ACTIONS')).map((line) => pipePair(line, 'churn', 'action')),
  };
}

function parseCrossAnalysis(node, clientName) {
  if (!node) return null;
  const c = children(node, 'CLIENT')[0] || node;
  const patternsRoot = child(c, 'Winning Patterns');
  const patterns = children(patternsRoot, 'Pattern').map((p) => ({ ...kv(p), _title: p.title }));
  const finalRoot = child(c, 'Final Recommendations');
  return {
    overview: kv(child(c, 'Brand Video Overview')),
    pr_organic_insight: kv(child(c, 'PR vs Organic'))['pr_organic_insight'],
    video_cross_conclusion: kv(child(c, 'PR vs Organic'))['video_cross_conclusion'],
    hook_cross_analysis: kv(child(c, 'Hook Cross'))['hook_cross_analysis'],
    visual_cross_analysis: kv(child(c, 'Visual Cross'))['visual_cross_analysis'],
    highEg: items(child(c, 'High EG')),
    lowEg: items(child(c, 'Low EG')),
    patterns,
    final_message: kv(child(c, 'Final Message'))['final_message'],
    final_message: kv(child(c, 'Final Message'))['final_message'],
    keep: items(child(finalRoot, 'KEEP')),
    improve: items(child(finalRoot, 'IMPROVE')),
    try: items(child(finalRoot, 'TRY')),
  };
}

function parse(mdPath) {
  const md = fs.readFileSync(mdPath, 'utf8');
  const root = buildTree(md);

  const project = kv(child(root, 'PROJECT'));
  const settings = kv(child(root, 'GLOBAL SETTINGS'));
  const tierDef = kv(child(root, 'FOLLOWER TIER'));

  const clientsRoot = child(root, 'CLIENTS');
  const clients = children(clientsRoot, 'CLIENT').map((cn) => {
    const basic = kv(child(cn, 'Basic'));
    const brandsRoot = child(cn, 'Brands');
    const brands = children(brandsRoot, 'BRAND').map(parseBrand);
    return { ...basic, client_id: basic.client_id || cn.title, brands };
  });

  // 02-analyze の計測結果（動画の中で何回言われたか）。
  // セクションが無い＝未計測。null にせず status を持たせて、
  // 「測っていない」を「0回」と読ませない（付録に必ず出す）
  const mentionsRoot = child(root, 'MEASURED MENTIONS');
  const mentions = {
    ...(mentionsRoot ? kv(mentionsRoot) : { status: 'absent' }),
    axes: children(mentionsRoot, 'MENTION AXIS').map((n) => ({
      ...kv(n),
      channels: kv(child(n, 'Channels')),
    })),
  };

  const kwRoot = child(root, 'KEYWORD AXES');
  const keywords = children(kwRoot, 'KEYWORD').map(parseKeyword);
  // 検索ワード面の上位投稿を1本ずつ解剖したページ（ブランド軸の VIDEO ANALYSIS と同じ形）
  const kwVideoRoot = child(root, 'KEYWORD VIDEO ANALYSIS');
  const keywordVideos = children(kwVideoRoot, 'KWAXIS').flatMap((ax) =>
    groupVideoNodes(ax, 'KWVIDEO').map((g) => ({ ...parseVideo(g), axis_name: ax.title.replace(/^KWAXIS\s*/, '') })));
  const kwSummaryRoot = child(root, 'KEYWORD CROSS SUMMARY');
  const keywordSummary = {
    rows: children(kwSummaryRoot, 'KW SUMMARY').map((c) => kv(c)),
    ...kv(kwSummaryRoot),
    ...kv(child(kwSummaryRoot, 'Whitespace')),
  };

  // 他プラットフォーム（X / Instagram / YouTube …）。名前はデータ側が決める
  const platRoot = child(root, 'OTHER PLATFORMS');
  const platforms = children(platRoot, 'PLATFORM').map((n) => ({
    ...kv(n),
    postTypes: table(child(n, 'Post Types')),
    accounts: table(child(n, 'Official Accounts')),
  }));

  const cross = parseCrossAnalysis(child(root, 'CROSS ANALYSIS'));
  const crossClient = kv(child(root, 'CROSS CLIENT SUMMARY'));
  // 初訪モードのモジュール群。`## MODULE 1-1` の見出し＋kv＋表で1枚を作る
  const quickRoot = child(root, 'QUICK MODULES');
  const quickModules = children(quickRoot, 'MODULE').map((m) => ({
    ...kv(m),
    id: (m.title.replace(/^MODULE\s*/i, '') || '').trim(),
    table: table(child(m, 'Table')),
    bars: table(child(m, 'Bars')),
    cards: children(m, 'Card').map((c) => kv(c)),
  }));
  const reviewsNode = child(root, 'REVIEWS');
  const reviews = parseReviews(reviewsNode);
  // 口コミ章を持たない案件（# REVIEWS が無い）では reviews が null になる。
  // そこへ pages を代入するとクラッシュするので、章の有無で分岐する
  if (reviews) reviews.pages = children(reviewsNode, 'PAGE').map((p) => ({
    ...kv(p),
    label: (p.title.replace(/^PAGE\s*/i, '') || '').trim(),
    table: table(child(p, 'Table')),
    blocks: children(p, 'Block').map((b) => kv(b)),
  }));

  return {
    project,
    settings: {
      // 許可リスト方式にすると、新しく足した設定が黙って捨てられる
      // （q5_basis_label がここで消え、レンダラが既定の「再生数TOP1」を出し続けた）
      ...settings,
      cross_client_comparison: String(settings.cross_client_comparison).toLowerCase() === 'true',
      max_brands_per_comparison_slide: parseInt(settings.max_brands_per_comparison_slide, 10) || 3,
      individual_video_page_per_video:
        String(settings.individual_video_page_per_video).toLowerCase() !== 'false',
      allow_generated_images: String(settings.allow_generated_images).toLowerCase() === 'true',
      video_list_top_n: settings.video_list_top_n,
      // 初訪モード（QUICK MODULES を1枚1モジュールで描く）と深掘りモードの切り替え
      deck_mode: String(settings.deck_mode || 'deep').trim().toLowerCase() === 'quick' ? 'quick' : 'deep',
    },
    tierDef,
    clients,
    keywords,
    keywordVideos,
    keywordSummary,
    platforms,
    cross,
    crossClient,
    reviews,
    quickModules,
    mentions,
  };
}

module.exports = { parse, PLACEHOLDER_DATA, table };
