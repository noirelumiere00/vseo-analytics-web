/**
 * 側面分析レポート生成エンジン
 * マークダウン形式でビジネス視点の分析レポートを生成
 */

export interface FacetData {
  aspect: string;
  positive_percentage: number;
  negative_percentage: number;
}

export interface AnalysisReportData {
  keyword: string;
  facets: FacetData[];
  positiveWords: string[];
  negativeWords: string[];
  totalVideos: number;
  totalViews: number;
  totalEngagement: number;
  positivePercentage: number;
  negativePercentage: number;
}

/**
 * 側面分析レポートをマークダウン形式で生成
 */
export function generateFacetAnalysisReport(data: AnalysisReportData): string {
  const {
    keyword,
    facets,
    positiveWords,
    negativeWords,
    totalVideos,
    totalViews,
    totalEngagement,
    positivePercentage,
    negativePercentage,
  } = data;

  // 側面をポジティブ率でソート
  const sortedFacets = [...facets].sort(
    (a, b) => b.positive_percentage - a.positive_percentage
  );

  // 強み（ポジティブ率が高い）と弱み（ネガティブ率が高い）を抽出
  const strengths = sortedFacets
    .filter((f) => f.positive_percentage >= 70)
    .slice(0, 3);
  const weaknesses = sortedFacets
    .filter((f) => f.negative_percentage >= 30)
    .slice(0, 3);

  let report = `# 側面分析レポート\n\n`;
  report += `## 分析対象: ${keyword}\n\n`;
  report += `---\n\n`;

  // サマリーセクション
  report += `## 📊 分析サマリー\n\n`;
  report += `| 項目 | 数値 |\n`;
  report += `|------|------|\n`;
  report += `| 分析対象動画数 | ${totalVideos}本 |\n`;
  report += `| 総再生数 | ${formatNumber(totalViews)} |\n`;
  report += `| 総エンゲージメント | ${formatNumber(totalEngagement)} |\n`;
  report += `| ポジティブ率 | ${positivePercentage.toFixed(1)}% |\n`;
  report += `| ネガティブ率 | ${negativePercentage.toFixed(1)}% |\n\n`;

  // 側面分析結果
  report += `## 📈 側面分析結果\n\n`;
  sortedFacets.forEach((facet, index) => {
    const positiveBar = generateProgressBar(facet.positive_percentage);
    const negativeBar = generateProgressBar(facet.negative_percentage);

    report += `### ${index + 1}. **${facet.aspect}**\n`;
    report += `- **ポジティブ率**: ${facet.positive_percentage.toFixed(1)}% ${positiveBar}\n`;
    report += `- **ネガティブ率**: ${facet.negative_percentage.toFixed(1)}% ${negativeBar}\n\n`;
  });

  // ビジネス視点の分析
  report += `## 🎯 ビジネス視点の分析\n\n`;

  if (strengths.length > 0) {
    report += `### 強み（ポジティブ率が高い側面）\n`;
    strengths.forEach((strength, index) => {
      report += `${index + 1}. **${strength.aspect}** (${strength.positive_percentage.toFixed(1)}%) - `;
      report += getStrengthDescription(strength.aspect);
      report += `\n`;
    });
    report += `\n`;
  }

  if (weaknesses.length > 0) {
    report += `### 弱み（ネガティブ率が高い側面）\n`;
    weaknesses.forEach((weakness, index) => {
      report += `${index + 1}. **${weakness.aspect}** (${weakness.negative_percentage.toFixed(1)}% ネガティブ) - `;
      report += getWeaknessDescription(weakness.aspect);
      report += `\n`;
    });
    report += `\n`;
  }

  report += `### 改善機会\n`;
  weaknesses.forEach((weakness) => {
    report += `- **${weakness.aspect}**: ${getImprovementSuggestion(weakness.aspect)}\n`;
  });
  report += `\n`;

  // 頻出ワード分析
  report += `## 💬 頻出ワード分析\n\n`;

  report += `### ✅ ポジティブワード（上位10）\n`;
  const topPositiveWords = positiveWords.slice(0, 10);
  topPositiveWords.forEach((word, index) => {
    report += `${index + 1}. ${word}\n`;
  });
  report += `\n`;

  report += `### ❌ ネガティブワード（上位10）\n`;
  const topNegativeWords = negativeWords.slice(0, 10);
  topNegativeWords.forEach((word, index) => {
    report += `${index + 1}. ${word}\n`;
  });
  report += `\n`;

  // マーケティング提案
  report += `## 💡 マーケティング提案\n\n`;

  report += `### ターゲット層の分析\n`;
  if (strengths.length > 0) {
    const strengthAspects = strengths.map((s) => s.aspect).join("、");
    report += `- **主なポジティブ層**: ${strengthAspects}を重視するユーザー層\n`;
  }
  if (weaknesses.length > 0) {
    const weaknessAspects = weaknesses.map((w) => w.aspect).join("、");
    report += `- **懸念層**: ${weaknessAspects}を気にするユーザー層\n`;
  }
  report += `\n`;

  report += `### 推奨マーケティング施策\n`;
  if (strengths.length > 0) {
    report += `1. **強みの強調** - ${strengths.map((s) => s.aspect).join("、")}についてのキャンペーン\n`;
  }
  if (weaknesses.length > 0) {
    report += `2. **弱み対策** - ${weaknesses.map((w) => getMarketingSolution(w.aspect)).join("、")}\n`;
  }
  report += `3. **ユーザー体験の共有** - ポジティブな口コミを増幅\n`;
  report += `4. **継続的な改善** - ネガティブフィードバックへの対応\n\n`;

  // データソース
  report += `---\n\n`;
  report += `## 📋 データソース\n\n`;
  report += `- **分析対象動画数**: ${totalVideos}本\n`;
  report += `- **分析期間**: ${new Date().toLocaleDateString("ja-JP")}\n`;
  report += `- **分析方法**: TikTok上位表示動画のテキスト分析 + LLM による側面抽出\n`;
  report += `- **信頼度**: 中程度（サンプルサイズが限定的）\n`;

  return report;
}

/**
 * プログレスバーを生成（テキスト形式）
 */
function generateProgressBar(percentage: number): string {
  const filled = Math.round(percentage / 10);
  const empty = 10 - filled;
  return `[${Array(filled).fill("█").join("")}${Array(empty).fill("░").join("")}]`;
}

/**
 * 数値をフォーマット（K, M単位）
 */
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M";
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toString();
}

/**
 * 強みの説明を取得
 */
function getStrengthDescription(aspect: string): string {
  const descriptions: Record<string, string> = {
    "外観・デザイン": "ビジュアルアピール力が強く、ユーザーの注目を集めている",
    "走行性能・乗り心地": "パフォーマンスに対する満足度が高い",
    "室内空間・快適性": "ファミリー層への訴求力がある",
    "安全性・信頼性": "最も評価が高く、ユーザーの信頼を獲得している",
    "燃費・経済性": "ランニングコストに対する評価が良好",
    "価格・コストパフォーマンス": "価格に対する満足度が高い",
    "機能・装備": "豊富な機能が好評",
    "ブランド力": "ブランドイメージが良好",
  };
  return descriptions[aspect] || "ユーザーから高い評価を得ている";
}

/**
 * 弱みの説明を取得
 */
function getWeaknessDescription(aspect: string): string {
  const descriptions: Record<string, string> = {
    "外観・デザイン": "デザインに対する懸念がある",
    "走行性能・乗り心地": "パフォーマンスに対する不満がある",
    "室内空間・快適性": "快適性に対する懸念がある",
    "安全性・信頼性": "信頼性に対する懸念がある",
    "燃費・経済性": "ランニングコストへの懸念がある",
    "価格・コストパフォーマンス": "価格に対する抵抗感がある",
    "機能・装備": "機能や装備に対する不満がある",
    "ブランド力": "ブランドイメージに課題がある",
  };
  return descriptions[aspect] || "改善の余地がある";
}

/**
 * 改善提案を取得
 */
function getImprovementSuggestion(aspect: string): string {
  const suggestions: Record<string, string> = {
    "外観・デザイン": "デザイン改善やリフレッシュを検討",
    "走行性能・乗り心地": "パフォーマンス向上の新技術を導入・アピール",
    "室内空間・快適性": "快適性向上の新機能を追加・強調",
    "安全性・信頼性": "安全装備の強化と信頼性の実績をアピール",
    "燃費・経済性": "燃費改善技術の導入と経済性をアピール",
    "価格・コストパフォーマンス": "価格戦略の見直しやキャンペーン実施",
    "機能・装備": "ユーザーが求める機能の追加",
    "ブランド力": "ブランドイメージの改善キャンペーン",
  };
  return suggestions[aspect] || "ユーザーフィードバックに基づく改善";
}

/**
 * マーケティング解決策を取得
 */
function getMarketingSolution(aspect: string): string {
  const solutions: Record<string, string> = {
    "外観・デザイン": "デザイン面でのポジティブメッセージング",
    "走行性能・乗り心地": "パフォーマンスの優位性を強調",
    "室内空間・快適性": "快適性の実績をアピール",
    "安全性・信頼性": "安全性の信頼性向上キャンペーン",
    "燃費・経済性": "燃費改善と経済性の訴求",
    "価格・コストパフォーマンス": "価格訴求の工夫と長期的価値の提示",
    "機能・装備": "機能の充実性をアピール",
    "ブランド力": "ブランドイメージ向上施策",
  };
  return solutions[aspect] || "ユーザー懸念への対応";
}
