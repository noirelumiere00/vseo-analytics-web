/**
 * STEP 8: Genspark Markdown Export
 *
 * Assembles all pipeline data into a 27-slide Genspark-ready markdown prompt.
 * Template slides (1-6, 26) are fixed. Data slides (7-25, 27) use pipeline output.
 */
import type { KaiwaiCreative } from "../schemas";

interface Community {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  layer?: "core" | "expansion";
  cultureCode?: { nicknames: string[]; hashtags: string[]; contentPatterns: string[] };
  estimatedPopulation?: number;
  populationFormula?: string;
  officialGap?: { official: string; reality: string; insight: string };
  keywordCandidates?: Array<{
    keyword: string; tiktokViews: number; tiktokPostCount: number;
    tiktokAvgER: number; instagramPostCount: number;
    trend: "rising" | "stable" | "declining"; selected: boolean;
  }>;
}

interface Segment {
  id: string;
  name: string;
  icon: string;
  matchScore: number;
  primaryPain: string;
  appeals: string[];
  communityIds: string[];
}

interface PainHypothesis {
  pain: string;
  approved: boolean;
}

export function generateGensparkMarkdown(
  productName: string,
  communities: Community[],
  segments: Segment[],
  creatives: KaiwaiCreative[],
  painHypotheses: PainHypothesis[],
): string {
  const coreCommunities = communities.filter(c => c.layer === "core");
  const expansionCommunities = communities.filter(c => c.layer === "expansion");

  // If no layer info, split 3+2
  const core = coreCommunities.length > 0 ? coreCommunities : communities.slice(0, 3);
  const expansion = expansionCommunities.length > 0 ? expansionCommunities : communities.slice(3, 5);
  const allCommunities = [...core, ...expansion];

  const md: string[] = [];

  // ── Slide 1: 表紙 ──
  md.push(`## Slide 1: 表紙
- **タイトル**: 「界隈起点」TikTokプロモーション戦略のご提案
- **サブタイトル**: ${productName} × ${allCommunities.length}界隈 × ${creatives.length}のクリエイティブで攻略する市場
- **ビジュアル**: 指定3色（オレンジ・グレー・ベージュ）を用いた、ポップでトレンド感のある幾何学シェイプデザイン。
`);

  // ── Slide 2-6: 概念説明 (テンプレ固定) ──
  md.push(`## Slide 2: 【概念1】マーケティングの変革
- **内容**: デモグラ（属性）から界隈（熱量）へのシフト。
- **図解**: ピラミッド型から、ポップな人物アイコンが集まる「界隈（バブル）」への変化図。
`);

  md.push(`## Slide 3: 【概念2】界隈の構造
- **内容**: 境界線がなく重なり合い、人が回遊する構造。
- **図解**: 重なり合うオレンジ・ベージュの円と、その間を行き来する人物イラスト。
`);

  md.push(`## Slide 4: 【概念3】消費のメカニズム
- **内容**: 「熱量×共感」による界隈伝播消費。
- **図解**: 中心からオレンジ色の波紋が広がる様子。
`);

  md.push(`## Slide 5: 【概念4】SEESASモデルと加速メカニズム
- **内容**: 界隈起点の消費行動モデル「SEESAS」。
- **図解**: 以下の6段階がスパイラル状（渦）に回転しながら拡大していくインフォグラフィックス。
  1. **Sympathy**（共感）
  2. **Enthusiasm**（熱狂）
  3. **Expression**（発信）
  4. **Spread**（拡散）
  5. **Action**（行動）
  6. **Sustainability**（定着）
- **加速ロジック**: 「界隈内の熱量が高まるほど回転速度が上がり、遠心力で他界隈へ飛び火する」
`);

  md.push(`## Slide 6: 【概念5】企業参入の4原則
- **内容**: カテゴライズしない、リスペクト、ポジティブ、活用シーン提案。
- **図解**: 4つのパネルとアイコン（オレンジ枠を使用）。
`);

  // ── Slide 7: 5界隈概要 ──
  md.push(`## Slide 7: Targeting - 攻略すべき${allCommunities.length}つの界隈
- **戦略概要**: 「熱狂を生むコア層」から「トレンドを作る拡大層」へ波及させる2段構え。
  - **Core Layer**: ${core.map(c => c.name).join(" + ")}
  - **Expansion Layer**: ${expansion.map(c => c.name).join(" + ")}
`);

  // ── Slide 8-12: 界隈プロフィール ──
  allCommunities.forEach((community, idx) => {
    const slideNum = 8 + idx;
    const layerLabel = community.layer === "expansion" ? "拡大層" : "コア層";

    md.push(`## Slide ${slideNum}: Target Profile - ${community.name}（${layerLabel}）
- **界隈詳細**: ${community.description}
- **推定人数**: **${community.estimatedPopulation?.toLocaleString() || "推定中"}人**
  - **計算式・根拠**: ${community.populationFormula || "SNS投稿数から推計"}
- **文化コード**:
  - 呼び名: ${community.cultureCode?.nicknames?.join(", ") || "調査中"}
  - ハッシュタグ: ${community.cultureCode?.hashtags?.map(h => `#${h}`).join(" ") || "調査中"}
  - 投稿構図: ${community.cultureCode?.contentPatterns?.join(", ") || "調査中"}
- **公式とのGAP**:
  - 想定: ${community.officialGap?.official || "公式の用途"}
  - 実態: ${community.officialGap?.reality || "ユーザーの使い方"}
  - インサイト: ${community.officialGap?.insight || "ズレから見える機会"}
- **ビジュアル**: [Image Prompt: Photorealistic, Real Japanese person typical of ${community.name} fashion/style, high quality portrait, orange #f46539 background accent]
`);
  });

  // ── Slide 13: ホットワードマップ ──
  const allKeywords = allCommunities.flatMap(c =>
    (c.keywordCandidates || []).filter(k => k.selected).map(k => k.keyword)
  );
  md.push(`## Slide 13: Analysis - 界隈ホットワードマップ
- **内容**: ${allCommunities.length}界隈のキーワード（文脈ワードのみ）を配置したワードクラウド。
- **キーワード**: ${allKeywords.join(", ") || communities.flatMap(c => c.keywords.slice(0, 3)).join(", ")}
- **デザイン**: 指定オレンジ、グレー、ベージュのみの配色。
`);

  // ── Slide 14-18: キラーワード選抜テーブル ──
  allCommunities.forEach((community, idx) => {
    const slideNum = 14 + idx;
    const candidates = community.keywordCandidates || [];

    let table = `| No | 候補ワード | TikTok再生数 | TikTok投稿数 | ER% | IGハッシュタグ | トレンド | 判定 |\n`;
    table += `|:---:|:---|:---|:---|:---|:---|:---|:---:|\n`;

    candidates.forEach((c, i) => {
      const viewsStr = c.tiktokViews >= 10000
        ? `${(c.tiktokViews / 10000).toFixed(1)}万回`
        : `${c.tiktokViews.toLocaleString()}回`;
      const trendLabel = c.trend === "rising" ? "上昇" : c.trend === "declining" ? "減少" : "維持";
      const selectedLabel = c.selected ? "**採用**" : "不採用";
      const bold = c.selected ? "**" : "";

      table += `| ${i + 1} | ${bold}${c.keyword}${bold} | ${bold}${viewsStr}${bold} | ${c.tiktokPostCount.toLocaleString()}件 | ${c.tiktokAvgER}% | ${c.instagramPostCount.toLocaleString()}件 | ${trendLabel} | ${selectedLabel} |\n`;
    });

    md.push(`## Slide ${slideNum}: Selection - ${community.name} キラーワード選抜
${table}
- **Source**: TikTok検索結果 / Instagram検索結果（VSEO Analytics実測データ）
`);
  });

  // ── Slide 19-20: 課題仮説 + 右脳左脳 ──
  const approvedPains = painHypotheses.filter(p => p.approved);
  md.push(`## Slide 19: Planning - 課題仮説とトリガー
- **検証済みペイン**:
${approvedPains.slice(0, 5).map((p, i) => `  ${i + 1}. ${p.pain}`).join("\n")}
- **図解**: 「界隈のPain」と「企業のTrigger」の接続図。
`);

  md.push(`## Slide 20: Strategy - 右脳・左脳アプローチ（定義）
- **コンセプト**: 「感性（右脳）」と「論理（左脳）」の両面からアプローチし、取りこぼしを防ぐ。
- **右脳的アプローチ（Emotional）**: 直感的、「好き」「憧れ」「雰囲気」に訴求。SEESASのSympathy/Enthusiasm対応。
- **左脳的アプローチ（Logical）**: 論理的、「機能」「成分」「コスパ」に訴求。SEESASのAction/Sustainability対応。
- **Visual**: 脳のイラスト（右脳＝カラフル・ポップ、左脳＝幾何学・グレー）。
`);

  // ── Slide 21-25: クリエイティブ案 (6案/界隈) ──
  allCommunities.forEach((community, idx) => {
    const slideNum = 21 + idx;
    const communityCreatives = creatives.filter(c => c.communityId === community.id);

    // Group by keyword
    const keywordGroups = new Map<string, KaiwaiCreative[]>();
    for (const creative of communityCreatives) {
      const group = keywordGroups.get(creative.keyword) || [];
      group.push(creative);
      keywordGroups.set(creative.keyword, group);
    }

    let creativeContent = "";
    for (const [keyword, kwCreatives] of keywordGroups) {
      const rightBrain = kwCreatives.find(c => c.axis === "right-brain");
      const leftBrain = kwCreatives.find(c => c.axis === "left-brain");

      creativeContent += `- **キーワード: ${keyword}**\n`;
      if (rightBrain) {
        creativeContent += `  - 【右脳案】${rightBrain.headline}\n`;
        creativeContent += `    - 投稿文: 「${rightBrain.body}」\n`;
        creativeContent += `    - Visual: [Image Prompt: Full screen TikTok interface showing ${rightBrain.visualConcept}, TikTok UI overlay. No hands visible.]\n`;
      }
      if (leftBrain) {
        creativeContent += `  - 【左脳案】${leftBrain.headline}\n`;
        creativeContent += `    - 投稿文: 「${leftBrain.body}」\n`;
        creativeContent += `    - Visual: [Image Prompt: Full screen TikTok interface showing ${leftBrain.visualConcept}, text overlay, TikTok UI overlay. No hands visible.]\n`;
      }
    }

    md.push(`## Slide ${slideNum}: Creative - ${community.name} ${communityCreatives.length}つの訴求メッセージ
${creativeContent}
`);
  });

  // ── Slide 26: Why TikTok ──
  md.push(`## Slide 26: Meaning - なぜTikTokをコア媒体とするのか
- **根拠1 レコメンドアルゴリズムの強力さ**:
  > 「TikTokは、フォロー関係を超えてコンテンツが拡散される『レコメンドアルゴリズム（インタレストグラフ）』が非常に強力です。これにより、新製品や新しいトレンドが短期間で爆発的に広がる土壌があります。ローンチ期において、まず市場に『${productName}という新しいムーブメントが起きている』という状況を創り出す上で、TikTokは最も効果的なプラットフォームです。」
- **根拠2 フリークエンシー5回の戦略的意義**:
  > 「TikTokの文化は、単なる視聴ではなく『参加』にあります。ユーザーがトレンドに参加するためには、その音源やフォーマットに複数回接触し、『自分もやってみたい』と感じる心理的なハードルを越える必要があります。フリークエンシー5回という目標は、ターゲットに『これは広告ではなく、自分が参加すべきトレンドだ』と認識させ、UGCという自発的な熱狂を生み出させるために不可欠な戦略的投資です。」
`);

  // ── Slide 27: KPI & Budget ──
  let budgetTable = `| Layer | 界隈 | 推定人数(UU) | FQ | 単価 | 予算 |\n`;
  budgetTable += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  let totalBudget = 0;
  for (const community of allCommunities) {
    const pop = community.estimatedPopulation || 0;
    const budget = pop * 5 * 2; // FQ5 × 2円
    totalBudget += budget;
    const layerLabel = community.layer === "expansion" ? "Expansion" : "Core";
    budgetTable += `| **${layerLabel}** | ${community.name} | ${pop.toLocaleString()}人 | 5回 | 2円 | **${budget.toLocaleString()}円** |\n`;
  }

  md.push(`## Slide 27: KPI & Budget Simulation
${budgetTable}
- **合計予算**: **${totalBudget.toLocaleString()}円**
`);

  return md.join("\n");
}
