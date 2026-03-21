import googleTrends from "google-trends-api";

export interface TrendDataPoint {
  date: string; // YYYY-MM-DD
  value: number; // 0-100 relative interest
}

export interface DailyVideoStats {
  date: string; // YYYY-MM-DD
  postCount: number;
  totalViews: number;
}

export interface CorrelationResult {
  trendsData: TrendDataPoint[];
  videoStats: DailyVideoStats[];
  correlationPostCount: number | null;
  correlationViews: number | null;
}

/**
 * Google Trends interestOverTime を取得して日次データに変換
 */
export async function fetchGoogleTrends(
  keyword: string,
  startTime: Date,
  endTime: Date,
  geo: string = "JP",
): Promise<TrendDataPoint[]> {
  const raw = await googleTrends.interestOverTime({
    keyword,
    startTime,
    endTime,
    geo,
  });

  const parsed = JSON.parse(raw);
  const timeline = parsed?.default?.timelineData;
  if (!Array.isArray(timeline)) return [];

  return timeline.map((point: any) => ({
    date: new Date(Number(point.time) * 1000).toISOString().split("T")[0],
    value: point.value?.[0] ?? 0,
  }));
}

/**
 * 動画リストを日別に集計（投稿数 & 再生数合計）
 */
export function aggregateVideosByDay(
  videos: Array<{ postedAt: Date | string | null; viewCount: number | bigint | null }>,
): DailyVideoStats[] {
  const map = new Map<string, { postCount: number; totalViews: number }>();

  for (const v of videos) {
    if (!v.postedAt) continue;
    const date = new Date(v.postedAt).toISOString().split("T")[0];
    const existing = map.get(date) || { postCount: 0, totalViews: 0 };
    existing.postCount += 1;
    existing.totalViews += Number(v.viewCount || 0);
    map.set(date, existing);
  }

  return Array.from(map.entries())
    .map(([date, stats]) => ({ date, ...stats }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * ピアソン相関係数を計算
 * 対応する日付のデータのみ使用
 */
export function pearsonCorrelation(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 3) return null;

  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denom = Math.sqrt(denomX * denomY);
  if (denom === 0) return null;

  return Math.round((numerator / denom) * 1000) / 1000;
}

/**
 * Google Trends と TikTok日別データを結合して相関を計算
 */
export function computeSearchCorrelation(
  trendsData: TrendDataPoint[],
  videoStats: DailyVideoStats[],
): CorrelationResult {
  // 共通日付を見つける
  const trendMap = new Map(trendsData.map((t) => [t.date, t.value]));
  const videoMap = new Map(videoStats.map((v) => [v.date, v]));

  const commonDates = [...trendMap.keys()].filter((d) => videoMap.has(d)).sort();

  let correlationPostCount: number | null = null;
  let correlationViews: number | null = null;

  if (commonDates.length >= 3) {
    const trendValues = commonDates.map((d) => trendMap.get(d)!);
    const postCounts = commonDates.map((d) => videoMap.get(d)!.postCount);
    const viewCounts = commonDates.map((d) => videoMap.get(d)!.totalViews);

    correlationPostCount = pearsonCorrelation(trendValues, postCounts);
    correlationViews = pearsonCorrelation(trendValues, viewCounts);
  }

  return {
    trendsData,
    videoStats,
    correlationPostCount,
    correlationViews,
  };
}
