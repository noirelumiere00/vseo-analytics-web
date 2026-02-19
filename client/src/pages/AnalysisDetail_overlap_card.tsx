// 重複度分析カードの共通点抽出ロジック
export function extractCommonPatterns(appearedInAll3Videos: any[]) {
  if (!appearedInAll3Videos || appearedInAll3Videos.length === 0) return null;

  const videos = appearedInAll3Videos.slice(0, 3);
  
  // ハッシュタグの集計
  const allHashtags = new Map<string, number>();
  videos.forEach(v => {
    v.hashtags?.forEach((tag: string) => {
      allHashtags.set(tag, (allHashtags.get(tag) || 0) + 1);
    });
  });
  
  // 統計情報
  const avgDuration = videos.reduce((sum, v) => sum + (v.duration || 0), 0) / videos.length;
  const avgFollowers = videos.reduce((sum, v) => sum + (v.author?.followerCount || 0), 0) / videos.length;
  const avgViewCount = videos.reduce((sum, v) => sum + (v.stats?.playCount || 0), 0) / videos.length;
  
  // トップハッシュタグ
  const topHashtags = Array.from(allHashtags.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag]) => tag);
  
  return {
    avgDuration: Math.round(avgDuration),
    avgFollowers: Math.round(avgFollowers / 10000),
    avgViewCount: Math.round(avgViewCount),
    topHashtags
  };
}

// 重複率計算の説明
export const overlapRateExplanation = `
重複率 = (3回全出現 + 2回出現) / 全ユニーク動画数 × 100

この指標は、TikTokのアルゴリズムがどれだけ一貫した検索結果を返しているかを示します。
高い重複率 = アルゴリズムが安定した上位動画を返している
低い重複率 = パーソナライズの影響が大きい
`;
