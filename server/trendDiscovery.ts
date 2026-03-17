import { invokeLLM } from "./_core/llm";
import type { TikTokVideo } from "./tiktokScraper";
import { TREND_MAX_KEYWORDS, TREND_MAX_HASHTAGS } from "@shared/const";
import type { TrendDiscoveryJob } from "../drizzle/schema";

// 汎用ハッシュタグのブラックリスト（トレンド分析に無意味なタグ）
const BLACKLISTED_TAGS = new Set([
  "fyp", "foryou", "foryoupage", "viral", "trending", "trend",
  "おすすめ", "おすすめにのりたい", "バズりたい", "バズれ",
  "tiktok", "tiktoker", "tiktokjapan",
  "fy", "fypシ", "fypage", "fypdongggggggg",
  "xyzbca", "xyz", "xyzabc",
  "pr", "ad", "広告", "プロモーション", "sponsored",
  "タイアップ", "提供", "案件",
]);

type FlatVideo = NonNullable<TrendDiscoveryJob["scrapedVideos"]>[number];

/**
 * ペルソナ/界隈名 → 検索キーワード + ハッシュタグに拡張（LLM）
 */
export async function expandPersonaToQueries(
  persona: string,
): Promise<{ keywords: string[]; hashtags: string[] }> {
  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          `あなたはTikTokのトレンドリサーチの専門家です。ユーザーが入力したペルソナや界隈名から、TikTokで検索すべきキーワードとハッシュタグを提案してください。

重要ルール:
- 西暦年を使う場合は必ず「${new Date().getFullYear()}」（今年）を使うこと。過去の年（${new Date().getFullYear() - 1}年以前）は使わないこと
- 「おすすめ」「人気」「ランキング」等の一般的な修飾語はキーワードとして有効なので積極的に使ってよい
- 製品の機能・用途・比較・課題解決・選び方・トレンド等、多角的な検索クエリを生成すること`,
      },
      {
        role: "user",
        content: `以下のペルソナ/界隈に関連するTikTok検索クエリを提案してください。

ペルソナ/界隈: "${persona}"

以下の条件で提案してください:
- keywords: このペルソナが興味を持つトピックの検索キーワード（日本語メイン、必要に応じて英語も可）を最大${TREND_MAX_KEYWORDS}個
- hashtags: 関連するハッシュタグ（#なし、日本語メイン）を最大${TREND_MAX_HASHTAGS}個
- 具体的で検索ボリュームがありそうなクエリを優先
- 汎用的すぎるもの（#fyp 等）は除外。ただし「おすすめ」「人気」等はOK
- 西暦を使う場合は今年（${new Date().getFullYear()}年）のみ使用可`,
      },
    ],
    maxTokens: 2048,
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "persona_expansion",
        schema: {
          type: "object",
          properties: {
            keywords: {
              type: "array",
              items: { type: "string" },
              description: "検索キーワード配列",
            },
            hashtags: {
              type: "array",
              items: { type: "string" },
              description: "ハッシュタグ配列（#なし）",
            },
          },
          required: ["keywords", "hashtags"],
        },
      },
    },
  });

  const content = result.choices[0]?.message?.content;
  const text = typeof content === "string" ? content : "";
  const parsed = JSON.parse(text);

  return {
    keywords: (parsed.keywords || []).slice(0, TREND_MAX_KEYWORDS),
    hashtags: (parsed.hashtags || []).slice(0, TREND_MAX_HASHTAGS),
  };
}

/**
 * TikTokVideo → フラットJSON変換
 */
export function flattenTikTokVideo(
  video: TikTokVideo,
  query: string,
  queryType: "keyword" | "hashtag",
): FlatVideo {
  return {
    query,
    queryType,
    videoId: video.id,
    desc: video.desc,
    createTime: video.createTime,
    duration: video.duration,
    coverUrl: video.coverUrl,
    authorUniqueId: video.author.uniqueId,
    authorNickname: video.author.nickname,
    authorAvatarUrl: video.author.avatarUrl,
    followerCount: video.author.followerCount,
    playCount: video.stats.playCount,
    diggCount: video.stats.diggCount,
    commentCount: video.stats.commentCount,
    shareCount: video.stats.shareCount,
    collectCount: video.stats.collectCount,
    hashtags: video.hashtags,
    isAd: video.isAd,
  };
}

// ---- 統計ヘルパー ----

interface DescriptiveStats {
  min: number; max: number; mean: number; median: number; stdDev: number; p25: number; p75: number;
}

function descriptiveStats(values: number[]): DescriptiveStats {
  if (values.length === 0) return { min: 0, max: 0, mean: 0, median: 0, stdDev: 0, p25: 0, p75: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const percentile = (p: number) => {
    const idx = (p / 100) * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  return {
    min: round2(sorted[0]),
    max: round2(sorted[n - 1]),
    mean: round2(mean),
    median: round2(percentile(50)),
    stdDev: round2(Math.sqrt(variance)),
    p25: round2(percentile(25)),
    p75: round2(percentile(75)),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function percentileRanks(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return values.map(v => {
    const below = sorted.filter(s => s < v).length;
    return below / sorted.length;
  });
}

type FollowerTier = "nano" | "micro" | "mid" | "macro" | "mega";
function followerTier(count: number): FollowerTier {
  if (count < 10_000) return "nano";
  if (count < 100_000) return "micro";
  if (count < 500_000) return "mid";
  if (count < 1_000_000) return "macro";
  return "mega";
}

/**
 * uniqueVideos から統計データを計算
 */
function computeStatistics(
  uniqueVideos: FlatVideo[],
  completedAt: Date,
  tagVideoCountMap?: Map<string, number>,
  trendMetaKeywords?: Array<{ videoId: string; authorUniqueId: string; keywords: string[] }>,
) {
  const completedTs = completedAt.getTime() / 1000;

  // 基本計算: ER, 各rate, daysSincePosted, normalizedPlays
  const enriched = uniqueVideos.map(v => {
    const total = v.diggCount + v.commentCount + v.shareCount + v.collectCount;
    const er = v.playCount > 0 ? (total / v.playCount) * 100 : 0;
    const likeRate = v.playCount > 0 ? (v.diggCount / v.playCount) * 100 : 0;
    const saveRate = v.playCount > 0 ? (v.collectCount / v.playCount) * 100 : 0;
    const commentRate = v.playCount > 0 ? (v.commentCount / v.playCount) * 100 : 0;
    const shareRate = v.playCount > 0 ? (v.shareCount / v.playCount) * 100 : 0;
    const daysSincePosted = Math.max(1, (completedTs - v.createTime) / 86400);
    const normalizedPlays = v.playCount / daysSincePosted;
    return { ...v, er, likeRate, saveRate, commentRate, shareRate, daysSincePosted, normalizedPlays };
  });

  const totalVideos = enriched.length;
  const adCount = enriched.filter(v => v.isAd).length;
  const createTimes = enriched.map(v => v.createTime);

  // 1. エンゲージメント基本統計
  const engagementStats = {
    playCount: descriptiveStats(enriched.map(v => v.playCount)),
    er: descriptiveStats(enriched.map(v => v.er)),
    likeRate: descriptiveStats(enriched.map(v => v.likeRate)),
    saveRate: descriptiveStats(enriched.map(v => v.saveRate)),
    commentRate: descriptiveStats(enriched.map(v => v.commentRate)),
    shareRate: descriptiveStats(enriched.map(v => v.shareRate)),
  };

  // min/max に該当する動画の参照リンク
  const findExtreme = (key: keyof typeof enriched[0], dir: "max" | "min") => {
    if (enriched.length === 0) return undefined;
    const sorted = [...enriched].sort((a, b) =>
      dir === "max" ? (b[key] as number) - (a[key] as number) : (a[key] as number) - (b[key] as number)
    );
    // authorUniqueId が空の動画はリンクできないのでスキップ
    const v = sorted.find(item => item.videoId && item.authorUniqueId);
    if (!v) return undefined;
    return { videoId: v.videoId, authorUniqueId: v.authorUniqueId };
  };
  const extremeVideos = {
    playCount: { max: findExtreme("playCount", "max"), min: findExtreme("playCount", "min") },
    er: { max: findExtreme("er", "max"), min: findExtreme("er", "min") },
    likeRate: { max: findExtreme("likeRate", "max"), min: findExtreme("likeRate", "min") },
    saveRate: { max: findExtreme("saveRate", "max"), min: findExtreme("saveRate", "min") },
    commentRate: { max: findExtreme("commentRate", "max"), min: findExtreme("commentRate", "min") },
    shareRate: { max: findExtreme("shareRate", "max"), min: findExtreme("shareRate", "min") },
  };

  // パーセンタイルランク for trending判定
  const npRanks = percentileRanks(enriched.map(v => v.normalizedPlays));
  const erRanks = percentileRanks(enriched.map(v => v.er));
  const compositeScores = enriched.map((_, i) => npRanks[i] * 0.5 + erRanks[i] * 0.5);

  // 7. パフォーマンス分類
  const indexed = enriched.map((v, i) => ({ ...v, score: compositeScores[i] }));
  indexed.sort((a, b) => b.score - a.score);
  const top20idx = Math.ceil(totalVideos * 0.2);
  const bot20idx = Math.floor(totalVideos * 0.8);

  const trendingVids = indexed.slice(0, top20idx);
  const averageVids = indexed.slice(top20idx, bot20idx);
  const underVids = indexed.slice(bot20idx);

  const classBucket = (vids: typeof indexed) => ({
    count: vids.length,
    avgER: round2(vids.reduce((s, v) => s + v.er, 0) / (vids.length || 1)),
    avgPlayCount: Math.round(vids.reduce((s, v) => s + v.playCount, 0) / (vids.length || 1)),
    avgNormalizedPlays: Math.round(vids.reduce((s, v) => s + v.normalizedPlays, 0) / (vids.length || 1)),
    topTags: topTagsFromVideos(vids, 5),
  });

  const performanceClassification = {
    trending: classBucket(trendingVids),
    average: classBucket(averageVids),
    underperforming: classBucket(underVids),
  };

  // 2. フォロワー×ER散布図
  const medianER = engagementStats.er.median;
  const followerValues = enriched.map(v => v.followerCount).sort((a, b) => a - b);
  const medianFollower = followerValues.length > 0
    ? followerValues[Math.floor(followerValues.length / 2)]
    : 0;

  // 200点にサンプリング（均等間隔）
  const step = Math.max(1, Math.floor(enriched.length / 200));
  const sampled = enriched.filter((_, i) => i % step === 0).slice(0, 200);

  const followerErScatter = sampled.map(v => ({
    followerCount: v.followerCount,
    er: round2(v.er),
    playCount: v.playCount,
    tier: followerTier(v.followerCount),
    isHighPerformer: v.er > medianER && v.followerCount < medianFollower,
    daysSincePosted: round2(v.daysSincePosted),
  }));

  // ティア別サマリー
  const tierGroups = new Map<string, number[]>();
  for (const v of enriched) {
    const t = followerTier(v.followerCount);
    if (!tierGroups.has(t)) tierGroups.set(t, []);
    tierGroups.get(t)!.push(v.er);
  }
  const tierOrder: FollowerTier[] = ["nano", "micro", "mid", "macro", "mega"];
  const followerTierSummary = tierOrder
    .filter(t => tierGroups.has(t))
    .map(t => {
      const ers = tierGroups.get(t)!;
      const stats = descriptiveStats(ers);
      return { tier: t, count: ers.length, avgER: stats.mean, medianER: stats.median };
    });

  // 3. ハッシュタグ別パフォーマンス
  const tagPerf = new Map<string, { ers: number[]; plays: number[]; normalizedPlays: number[] }>();
  for (const v of enriched) {
    for (const tag of v.hashtags) {
      const lt = tag.toLowerCase();
      if (BLACKLISTED_TAGS.has(lt)) continue;
      if (!tagPerf.has(tag)) tagPerf.set(tag, { ers: [], plays: [], normalizedPlays: [] });
      const tp = tagPerf.get(tag)!;
      tp.ers.push(v.er);
      tp.plays.push(v.playCount);
      tp.normalizedPlays.push(v.normalizedPlays);
    }
  }
  const globalMedianER = medianER;
  const hashtagPerformance = Array.from(tagPerf.entries())
    .filter(([, v]) => v.ers.length >= 2)
    .map(([tag, v]) => {
      const erStats = descriptiveStats(v.ers);
      const totalPostCount = tagVideoCountMap?.get(tag);
      return {
        tag,
        videoCount: v.ers.length,
        avgER: erStats.mean,
        medianER: erStats.median,
        avgPlayCount: Math.round(v.plays.reduce((s, p) => s + p, 0) / v.plays.length),
        avgNormalizedPlays: Math.round(v.normalizedPlays.reduce((s, p) => s + p, 0) / v.normalizedPlays.length),
        isUnderrated: erStats.mean > globalMedianER * 1.5 && v.ers.length < 10,
        ...(totalPostCount != null && { totalPostCount }),
      };
    })
    .sort((a, b) => b.videoCount - a.videoCount)
    .slice(0, 20);

  // 4. 動画長×エンゲージメント (6バンド)
  const durationRanges = [
    { label: "~15秒", min: 0, max: 15 },
    { label: "16-30秒", min: 16, max: 30 },
    { label: "31-60秒", min: 31, max: 60 },
    { label: "61-90秒", min: 61, max: 90 },
    { label: "91-180秒", min: 91, max: 180 },
    { label: "180秒~", min: 181, max: Infinity },
  ];
  const durationBands = durationRanges.map(r => {
    const vids = enriched.filter(v => v.duration >= r.min && v.duration <= r.max);
    if (vids.length === 0) return null;
    const erStats = descriptiveStats(vids.map(v => v.er));
    return {
      label: r.label,
      videoCount: vids.length,
      avgER: erStats.mean,
      medianER: erStats.median,
      avgPlayCount: Math.round(vids.reduce((s, v) => s + v.playCount, 0) / vids.length),
      isOptimal: false, // set below
    };
  }).filter((b): b is NonNullable<typeof b> => b !== null);
  // 最適バンド = medianER最高
  if (durationBands.length > 0) {
    const maxMedianER = Math.max(...durationBands.map(b => b.medianER));
    for (const b of durationBands) {
      if (b.medianER === maxMedianER) b.isOptimal = true;
    }
  }

  // 5. 投稿タイミングヒートマップ (JST = UTC+9)
  const timeGrid = new Map<string, { count: number; totalER: number; totalPlays: number }>();
  for (const v of enriched) {
    const d = new Date((v.createTime + 9 * 3600) * 1000); // JST
    const day = d.getUTCDay();
    const hour = d.getUTCHours();
    const key = `${day}-${hour}`;
    if (!timeGrid.has(key)) timeGrid.set(key, { count: 0, totalER: 0, totalPlays: 0 });
    const cell = timeGrid.get(key)!;
    cell.count++;
    cell.totalER += v.er;
    cell.totalPlays += v.playCount;
  }
  const postingTimeGrid = Array.from(timeGrid.entries()).map(([key, cell]) => {
    const [day, hour] = key.split("-").map(Number);
    return {
      day, hour,
      videoCount: cell.count,
      avgER: round2(cell.totalER / cell.count),
      avgPlayCount: Math.round(cell.totalPlays / cell.count),
    };
  });
  const bestTimeSlots = [...postingTimeGrid]
    .filter(c => c.videoCount >= 2)
    .sort((a, b) => b.avgER - a.avgER)
    .slice(0, 5)
    .map(c => ({ day: c.day, hour: c.hour, avgER: c.avgER, videoCount: c.videoCount }));

  // 6. 再生数分布（対数バケット）
  const buckets = [
    { label: "~1K", min: 0, max: 1_000 },
    { label: "1K-10K", min: 1_000, max: 10_000 },
    { label: "10K-100K", min: 10_000, max: 100_000 },
    { label: "100K-1M", min: 100_000, max: 1_000_000 },
    { label: "1M-10M", min: 1_000_000, max: 10_000_000 },
    { label: "10M~", min: 10_000_000, max: Infinity },
  ];
  const playCountDistribution = buckets.map(b => {
    const vids = enriched.filter(v => v.playCount >= b.min && v.playCount < b.max);
    return {
      label: b.label,
      count: vids.length,
      percentage: round2((vids.length / totalVideos) * 100),
      avgER: vids.length > 0 ? round2(vids.reduce((s, v) => s + v.er, 0) / vids.length) : 0,
    };
  }).filter(b => b.count > 0);

  // 8. クエリ別鮮度分析
  const queryGroups = new Map<string, typeof enriched>();
  for (const v of enriched) {
    if (!queryGroups.has(v.query)) queryGroups.set(v.query, []);
    queryGroups.get(v.query)!.push(v);
  }

  const queryFreshness = Array.from(queryGroups.entries()).map(([query, vids]) => {
    const within2w = vids.filter(v => v.daysSincePosted <= 14).length;
    const within1m = vids.filter(v => v.daysSincePosted > 14 && v.daysSincePosted <= 30).length;
    const within2m = vids.filter(v => v.daysSincePosted > 30 && v.daysSincePosted <= 60).length;
    const within3m = vids.filter(v => v.daysSincePosted > 60 && v.daysSincePosted <= 90).length;
    const within6m = vids.filter(v => v.daysSincePosted > 90 && v.daysSincePosted <= 180).length;
    const older = vids.filter(v => v.daysSincePosted > 180).length;

    const totalVids = vids.length;
    const freshnessScore = round2(((within2w + within1m + within2m) / totalVids) * 100);

    const sortedDays = vids.map(v => v.daysSincePosted).sort((a, b) => a - b);
    const mid = Math.floor(sortedDays.length / 2);
    const medianAgeDays = round2(
      sortedDays.length % 2 === 0
        ? (sortedDays[mid - 1] + sortedDays[mid]) / 2
        : sortedDays[mid]
    );

    const avgER = round2(vids.reduce((s, v) => s + v.er, 0) / totalVids);
    const avgPlayCount = Math.round(vids.reduce((s, v) => s + v.playCount, 0) / totalVids);

    return {
      query,
      totalVideos: totalVids,
      buckets: { within2w, within1m, within2m, within3m, within6m, older },
      freshnessScore,
      medianAgeDays,
      avgER,
      avgPlayCount,
    };
  }).sort((a, b) => b.freshnessScore - a.freshnessScore);

  // 9. PR/Ad動画インサイト
  const adVideos = enriched.filter(v => v.isAd);
  let adInsight: {
    adRate: number;
    adCount: number;
    organicCount: number;
    perQuery: Array<{ query: string; adCount: number; totalCount: number; adRate: number }>;
    topAdHashtags: Array<{ tag: string; count: number; avgER: number; avgPlayCount: number }>;
    comparison: {
      ad: { avgER: number; avgPlayCount: number; medianAgeDays: number };
      organic: { avgER: number; avgPlayCount: number; medianAgeDays: number };
    };
  } | undefined;

  if (adVideos.length >= 2) {
    const organicVideos = enriched.filter(v => !v.isAd);
    const adRate = round2((adVideos.length / totalVideos) * 100);

    // クエリ別PR率
    const perQuery = Array.from(queryGroups.entries()).map(([query, vids]) => {
      const qAd = vids.filter(v => v.isAd).length;
      return { query, adCount: qAd, totalCount: vids.length, adRate: round2((qAd / vids.length) * 100) };
    }).filter(q => q.adCount > 0).sort((a, b) => b.adRate - a.adRate);

    // PR動画の頻出ハッシュタグ
    const adTagPerf = new Map<string, { count: number; totalER: number; totalPlays: number }>();
    for (const v of adVideos) {
      for (const tag of v.hashtags) {
        const lt = tag.toLowerCase();
        if (BLACKLISTED_TAGS.has(lt)) continue;
        if (!adTagPerf.has(tag)) adTagPerf.set(tag, { count: 0, totalER: 0, totalPlays: 0 });
        const tp = adTagPerf.get(tag)!;
        tp.count++;
        tp.totalER += v.er;
        tp.totalPlays += v.playCount;
      }
    }
    const topAdHashtags = Array.from(adTagPerf.entries())
      .filter(([, v]) => v.count >= 2)
      .map(([tag, v]) => ({
        tag,
        count: v.count,
        avgER: round2(v.totalER / v.count),
        avgPlayCount: Math.round(v.totalPlays / v.count),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // PR vs オーガニック比較
    const median = (arr: number[]) => {
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length === 0 ? 0 : s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
    };
    const comparison = {
      ad: {
        avgER: round2(adVideos.reduce((s, v) => s + v.er, 0) / adVideos.length),
        avgPlayCount: Math.round(adVideos.reduce((s, v) => s + v.playCount, 0) / adVideos.length),
        medianAgeDays: round2(median(adVideos.map(v => v.daysSincePosted))),
      },
      organic: {
        avgER: round2(organicVideos.reduce((s, v) => s + v.er, 0) / (organicVideos.length || 1)),
        avgPlayCount: Math.round(organicVideos.reduce((s, v) => s + v.playCount, 0) / (organicVideos.length || 1)),
        medianAgeDays: round2(median(organicVideos.map(v => v.daysSincePosted))),
      },
    };

    adInsight = {
      adRate,
      adCount: adVideos.length,
      organicCount: organicVideos.length,
      perQuery,
      topAdHashtags,
      comparison,
    };
  }

  // 10. TikTok SEOメタキーワード分析 + 共起クラスタリング
  let seoMetaKeywords: {
    videos: Array<{ videoId: string; authorUniqueId: string; keywords: string[] }>;
    keywordRanking: Array<{ keyword: string; count: number; videoIds: string[] }>;
    keywordClusters?: Array<{
      label: string;
      keywords: string[];
      videoCount: number;
      totalMentions: number;
    }>;
  } | undefined;

  if (trendMetaKeywords && trendMetaKeywords.length > 0) {
    // キーワードフレーズの頻出集計
    const kwCounts = new Map<string, { count: number; videoIds: Set<string> }>();
    for (const entry of trendMetaKeywords) {
      for (const kw of entry.keywords) {
        if (!kwCounts.has(kw)) kwCounts.set(kw, { count: 0, videoIds: new Set() });
        const c = kwCounts.get(kw)!;
        c.count++;
        c.videoIds.add(entry.videoId);
      }
    }
    const keywordRanking = Array.from(kwCounts.entries())
      .map(([keyword, v]) => ({ keyword, count: v.count, videoIds: Array.from(v.videoIds) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);

    // 共起クラスタリング (Union-Find)
    const coMatrix = new Map<string, Map<string, number>>();
    for (const entry of trendMetaKeywords) {
      const kws = entry.keywords;
      for (let i = 0; i < kws.length; i++) {
        for (let j = i + 1; j < kws.length; j++) {
          const a = kws[i], b = kws[j];
          if (!coMatrix.has(a)) coMatrix.set(a, new Map());
          if (!coMatrix.has(b)) coMatrix.set(b, new Map());
          coMatrix.get(a)!.set(b, (coMatrix.get(a)!.get(b) ?? 0) + 1);
          coMatrix.get(b)!.set(a, (coMatrix.get(b)!.get(a) ?? 0) + 1);
        }
      }
    }

    const parent = new Map<string, string>();
    const allKws = Array.from(kwCounts.keys());
    for (const k of allKws) parent.set(k, k);
    function find(x: string): string {
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
      return parent.get(x)!;
    }
    function union(x: string, y: string) { parent.set(find(x), find(y)); }

    const COOC_THRESHOLD = 2;
    for (const [a, neighbors] of coMatrix) {
      for (const [b, count] of neighbors) {
        if (count >= COOC_THRESHOLD) union(a, b);
      }
    }

    const clusterMap = new Map<string, string[]>();
    for (const kw of allKws) {
      const root = find(kw);
      if (!clusterMap.has(root)) clusterMap.set(root, []);
      clusterMap.get(root)!.push(kw);
    }

    const keywordClusters = Array.from(clusterMap.values())
      .filter(members => members.length >= 2)
      .map(members => {
        const sorted = members.sort((a, b) =>
          (kwCounts.get(b)?.count ?? 0) - (kwCounts.get(a)?.count ?? 0)
        );
        const clusterVideoIds = new Set<string>();
        for (const kw of members) {
          for (const vid of kwCounts.get(kw)?.videoIds ?? []) clusterVideoIds.add(vid);
        }
        return {
          label: sorted[0],
          keywords: sorted,
          videoCount: clusterVideoIds.size,
          totalMentions: members.reduce((s, kw) => s + (kwCounts.get(kw)?.count ?? 0), 0),
        };
      })
      .sort((a, b) => b.videoCount - a.videoCount || b.totalMentions - a.totalMentions)
      .slice(0, 10);

    seoMetaKeywords = {
      videos: trendMetaKeywords,
      keywordRanking,
      keywordClusters: keywordClusters.length > 0 ? keywordClusters : undefined,
    };
  }

  return {
    totalVideos,
    adCount,
    dateRange: { min: Math.min(...createTimes), max: Math.max(...createTimes) },
    engagementStats,
    extremeVideos,
    followerErScatter,
    followerTierSummary,
    hashtagPerformance,
    durationBands,
    postingTimeGrid,
    bestTimeSlots,
    playCountDistribution,
    performanceClassification,
    queryFreshness,
    adInsight,
    seoMetaKeywords,
  };
}

/** 動画リストからトップタグを抽出 */
function topTagsFromVideos(videos: { hashtags: string[] }[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const v of videos) {
    for (const tag of v.hashtags) {
      if (BLACKLISTED_TAGS.has(tag.toLowerCase())) continue;
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag);
}

/**
 * 横断集計: 全クエリから集めた動画データを分析
 */
export function computeCrossAnalysis(
  videos: FlatVideo[],
  completedAt?: Date,
  tagVideoCountMap?: Map<string, number>,
  trendMetaKeywords?: Array<{ videoId: string; authorUniqueId: string; keywords: string[] }>,
): NonNullable<TrendDiscoveryJob["crossAnalysis"]> {
  // 動画をvideoIdで重複排除（最初の出現を優先）
  const uniqueMap = new Map<string, FlatVideo>();
  const videoQueries = new Map<string, Set<string>>(); // videoId → クエリ集合

  for (const v of videos) {
    if (!uniqueMap.has(v.videoId)) {
      uniqueMap.set(v.videoId, v);
    }
    if (!videoQueries.has(v.videoId)) {
      videoQueries.set(v.videoId, new Set());
    }
    videoQueries.get(v.videoId)!.add(v.query);
  }

  const uniqueVideos = Array.from(uniqueMap.values());

  // --- トレンドハッシュタグ集計 ---
  const tagStats = new Map<string, { videoIds: Set<string>; queries: Set<string>; totalER: number; count: number; displayTag: string }>();

  for (const v of uniqueVideos) {
    const er = v.playCount > 0
      ? ((v.diggCount + v.commentCount + v.shareCount + v.collectCount) / v.playCount) * 100
      : 0;

    for (const tag of v.hashtags) {
      const lowerTag = tag.toLowerCase();
      if (BLACKLISTED_TAGS.has(lowerTag)) continue;

      if (!tagStats.has(lowerTag)) {
        tagStats.set(lowerTag, { videoIds: new Set(), queries: new Set(), totalER: 0, count: 0, displayTag: tag });
      }
      const stat = tagStats.get(lowerTag)!;
      stat.videoIds.add(v.videoId);
      stat.queries.add(v.query);
      stat.totalER += er;
      stat.count++;
    }
  }

  const trendingHashtags = Array.from(tagStats.entries())
    .map(([, stat]) => ({
      tag: stat.displayTag,
      videoCount: stat.videoIds.size,
      queryCount: stat.queries.size,
      avgER: stat.count > 0 ? Math.round((stat.totalER / stat.count) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.videoCount - a.videoCount || b.queryCount - a.queryCount)
    .slice(0, 50);

  // --- トップ動画（各指標上位の和集合） ---
  const enrichedAll = uniqueVideos.map(v => {
    const er = v.playCount > 0
      ? ((v.diggCount + v.commentCount + v.shareCount + v.collectCount) / v.playCount) * 100
      : 0;
    return {
      videoId: v.videoId,
      desc: v.desc,
      authorUniqueId: v.authorUniqueId,
      authorNickname: v.authorNickname,
      playCount: v.playCount,
      diggCount: v.diggCount,
      commentCount: v.commentCount,
      shareCount: v.shareCount,
      collectCount: v.collectCount,
      er: Math.round(er * 100) / 100,
      coverUrl: v.coverUrl,
      hashtags: v.hashtags,
    };
  });
  // 各指標の上位20を和集合で取得（重複排除）
  const topVideoIds = new Set<string>();
  const sortKeys = ["er", "playCount", "diggCount", "commentCount", "shareCount", "collectCount"] as const;
  for (const key of sortKeys) {
    const sorted = [...enrichedAll].sort((a, b) => (b[key] as number) - (a[key] as number));
    for (const v of sorted.slice(0, 40)) topVideoIds.add(v.videoId);
  }
  const topVideos = enrichedAll
    .filter(v => topVideoIds.has(v.videoId))
    .sort((a, b) => b.er - a.er);

  // --- 共起タグペア ---
  const pairCounts = new Map<string, number>();
  for (const v of uniqueVideos) {
    const filteredTags = v.hashtags.filter(t => !BLACKLISTED_TAGS.has(t.toLowerCase()));
    for (let i = 0; i < filteredTags.length; i++) {
      for (let j = i + 1; j < filteredTags.length; j++) {
        const pair = [filteredTags[i], filteredTags[j]].sort().join("|||");
        pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
      }
    }
  }

  const coOccurringTags = Array.from(pairCounts.entries())
    .map(([pair, count]) => {
      const [tagA, tagB] = pair.split("|||");
      return { tagA, tagB, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  // --- キークリエイター（複数クエリに出現する投稿者） ---
  const creatorMap = new Map<string, {
    nickname: string;
    avatarUrl: string;
    followerCount: number;
    videoIds: Set<string>;
    queries: Set<string>;
    totalPlays: number;
  }>();

  for (const v of uniqueVideos) {
    if (!v.authorUniqueId) continue;
    if (!creatorMap.has(v.authorUniqueId)) {
      creatorMap.set(v.authorUniqueId, {
        nickname: v.authorNickname,
        avatarUrl: v.authorAvatarUrl,
        followerCount: v.followerCount,
        videoIds: new Set(),
        queries: new Set(),
        totalPlays: 0,
      });
    }
    const c = creatorMap.get(v.authorUniqueId)!;
    c.videoIds.add(v.videoId);
    c.queries.add(v.query);
    c.totalPlays += v.playCount;
    // フォロワー数は最大値を採用
    if (v.followerCount > c.followerCount) c.followerCount = v.followerCount;
  }

  const keyCreators = Array.from(creatorMap.entries())
    .filter(([, c]) => c.queries.size >= 2 || c.videoIds.size >= 2)
    .map(([uniqueId, c]) => ({
      uniqueId,
      nickname: c.nickname,
      avatarUrl: c.avatarUrl,
      followerCount: c.followerCount,
      videoCount: c.videoIds.size,
      queryCount: c.queries.size,
      totalPlays: c.totalPlays,
    }))
    .sort((a, b) => b.queryCount - a.queryCount || b.totalPlays - a.totalPlays)
    .slice(0, 40);

  // 統計分析
  const statistics = computeStatistics(uniqueVideos, completedAt ?? new Date(), tagVideoCountMap, trendMetaKeywords);

  return {
    trendingHashtags,
    topVideos,
    coOccurringTags,
    keyCreators,
    statistics,
    summary: "", // LLMサマリーは別途生成
  };
}

/**
 * レポートセクション型
 */
export interface TrendReportSection {
  id: string;
  title: string;
  icon: string; // lucide icon name
  content: string; // Markdown (後方互換 + fallback)
  bullets?: string[]; // 箇条書きポイント（3-5個）
  dataHighlights?: string[]; // 数値ハイライト（例: "ER中央値: 5.2%"）
  recommendation?: string; // 1行の推奨アクション
}

/** セクション定義マップ */
const SECTION_DEFS: { id: string; title: string; icon: string }[] = [
  { id: "overview", title: "トレンド概況", icon: "TrendingUp" },
  { id: "hashtag_strategy", title: "ハッシュタグ戦略", icon: "Hash" },
  { id: "content_insights", title: "コンテンツ傾向分析", icon: "Play" },
  { id: "creator_analysis", title: "クリエイター動向", icon: "Users" },
  { id: "action_plan", title: "推奨アクションプラン", icon: "Sparkles" },
];

/**
 * LLMでトレンドレポートを1回のJSON生成で作成
 */
export async function generateTrendSummary(
  persona: string,
  crossAnalysis: NonNullable<TrendDiscoveryJob["crossAnalysis"]>,
): Promise<{ summary: string; report: TrendReportSection[] }> {
  const topTags = crossAnalysis.trendingHashtags.slice(0, 15)
    .map(t => `#${t.tag} (${t.videoCount}動画, ${t.queryCount}クエリ横断, ER ${t.avgER}%)`)
    .join("\n");

  const topVids = crossAnalysis.topVideos.slice(0, 10)
    .map(v => `@${v.authorUniqueId}: ${v.desc.slice(0, 60)}... (再生${v.playCount}, ER ${v.er}%)`)
    .join("\n");

  const topPairs = crossAnalysis.coOccurringTags.slice(0, 10)
    .map(p => `#${p.tagA} + #${p.tagB} (${p.count}回)`)
    .join("\n");

  const stats = crossAnalysis.statistics as any;
  const statsContext = stats ? `
## エンゲージメント統計
- 平均ER: ${stats.engagementStats?.er?.mean ?? "N/A"}%, 中央値: ${stats.engagementStats?.er?.median ?? "N/A"}%
- 平均再生数: ${stats.engagementStats?.playCount?.mean ?? "N/A"}
- いいね率: ${stats.engagementStats?.likeRate?.mean ?? "N/A"}%, 保存率: ${stats.engagementStats?.saveRate?.mean ?? "N/A"}%

## 動画長別パフォーマンス
${stats.durationBands?.map((d: any) => `${d.label}: ${d.videoCount}本, ER ${d.avgER}%, 再生 ${d.avgPlayCount}`).join("\n") ?? "N/A"}

## 投稿時間帯
ベストタイム: ${stats.bestTimeSlots?.slice(0, 3).map((s: any) => `${["日","月","火","水","木","金","土"][s.day]}曜${s.hour}時(ER ${s.avgER}%)`).join(", ") ?? "N/A"}` : "";

  const creatorsContext = crossAnalysis.keyCreators.slice(0, 5)
    .map(c => `@${c.uniqueId} (${c.videoCount}動画, ${c.queryCount}クエリ横断, フォロワー${c.followerCount})`)
    .join("\n");

  const systemPrompt = `あなたはTikTokマーケティングの専門家です。「${persona}」界隈のトレンドデータを分析しています。

【絶対ルール】
- 固有名詞（具体的なタグ名 #xxx・クリエイター名 @xxx・動画テーマ）を必ず含めること。一般論・抽象表現は禁止。
- データの数値を引用して根拠を示すこと（例: 「#xxx はER 8.2%で全体中央値の1.6倍」）。
- 各bulletsは1-2文で、実務で即使える粒度の具体性。
- dataHighlightsは「ラベル: 値」形式の重要数値。
- recommendationは即実行可能な具体的アクション1行。`;

  const userPrompt = `以下のデータを分析し、5セクションの構造化レポートをJSON形式で生成してください。

## トレンドハッシュタグ TOP15
${topTags}

## 高ER動画 TOP10
${topVids}

## 頻出タグ組み合わせ TOP10
${topPairs}

## キークリエイター
${creatorsContext}
${statsContext}

---

以下の5セクションを生成してください。各セクションは bullets (3-5個)、dataHighlights (2-4個)、recommendation (1行) を含みます。

1. **overview** (トレンド概況): 今何が盛り上がっているか、主要なトレンドの方向性
2. **hashtag_strategy** (ハッシュタグ戦略): 鉄板タグ・穴場タグ・効果的な組み合わせパターン
3. **content_insights** (コンテンツ傾向): 伸びている動画の共通点・最適な動画尺・投稿タイミング
4. **creator_analysis** (クリエイター動向): 注目クリエイターの特徴・参考にすべきポイント
5. **action_plan** (アクションプラン): 即実行施策・企画案・タグ設計・投稿戦略・差別化ポイント`;

  const result = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    maxTokens: 4096,
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "trend_report",
        strict: true,
        schema: {
          type: "object",
          properties: {
            sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  bullets: { type: "array", items: { type: "string" } },
                  dataHighlights: { type: "array", items: { type: "string" } },
                  recommendation: { type: "string" },
                },
                required: ["id", "bullets", "dataHighlights", "recommendation"],
                additionalProperties: false,
              },
            },
          },
          required: ["sections"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = result.choices[0]?.message?.content;
  const text = typeof content === "string" ? content : "";

  // セクション定義マップ
  const defMap = new Map(SECTION_DEFS.map(d => [d.id, d]));

  let report: TrendReportSection[] = [];

  try {
    const parsed = JSON.parse(text) as {
      sections: Array<{ id: string; bullets: string[]; dataHighlights: string[]; recommendation: string }>;
    };

    report = parsed.sections
      .map(s => {
        const def = defMap.get(s.id);
        if (!def) return null;
        return {
          id: s.id,
          title: def.title,
          icon: def.icon,
          bullets: s.bullets,
          dataHighlights: s.dataHighlights,
          recommendation: s.recommendation,
          content: s.bullets.map(b => "- " + b).join("\n"), // 後方互換Markdown
        };
      })
      .filter((s): s is TrendReportSection => s !== null);
  } catch {
    // JSONパース失敗時: テキストをそのまま fallback
    report = [{
      id: "overview",
      title: "トレンド概況",
      icon: "TrendingUp",
      content: text,
    }];
  }

  // 後方互換: summary は全セクションを連結したMarkdown
  const summary = report.map(s => `## ${s.title}\n\n${s.content}`).join("\n\n---\n\n");

  return { summary, report };
}
