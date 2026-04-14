/**
 * STEP 5b: Keyword Quantification (5データソースクロス検証)
 *
 * Takes discovered communities (from STEP 5) and quantifies
 * each community's keywords using 5 real data sources:
 *   1. TikTok検索 (再生数/投稿数/ER)
 *   2. Instagram検索 (ハッシュタグ投稿数)
 *   3. X検索 (投稿数/エンゲージメント)
 *   4. Google Trends (トレンド傾向)
 *   5. Google Ads Keyword Planner (月間検索ボリューム)
 *
 * Selects top 3 keywords per community by composite score.
 */
import pLimit from "p-limit";
import { searchTikTokBatch, fetchTagVideoCountsBatch } from "../../../tiktokScraper";
import { searchInstagramHashtag } from "../../../instagramScraper";
import { searchXPosts } from "../../../mcpClient";
import { fetchGoogleTrends } from "../../../googleTrends";
import { fetchKeywordVolume } from "../../../googleAds";
import type { ProgressFn } from "../schemas";

const searchLimit = pLimit(2);

interface Community {
  id: string;
  name: string;
  keywords: string[];
  [key: string]: any;
}

interface KeywordCandidate {
  keyword: string;
  tiktokViews: number;
  tiktokPostCount: number;
  tiktokAvgER: number;
  instagramPostCount: number;
  xPostCount: number;
  xTotalLikes: number;
  googleTrend: "rising" | "stable" | "declining";
  googleTrendScore: number;
  monthlySearchVolume: number;
  competition: string;
  trend: "rising" | "stable" | "declining";
  selected: boolean;
}

/**
 * Quantify community keywords with 5 real data sources.
 * Mutates communities in-place by adding keywordCandidates.
 */
export async function quantifyKeywords(
  communities: Community[],
  onProgress?: ProgressFn,
): Promise<Community[]> {
  // Collect all keywords
  const allKeywords: string[] = [];
  for (const community of communities) {
    for (const keyword of community.keywords.slice(0, 5)) {
      if (!allKeywords.includes(keyword)) allKeywords.push(keyword);
    }
  }

  console.log(`[Step5b] Quantifying ${allKeywords.length} keywords across 5 data sources`);

  // ── 1. TikTok Search (batch) ──
  await onProgress?.({ message: "TikTokキーワード検証中...", percent: 78, phase: "segmenting" });

  const ttQueries = allKeywords.map(q => ({ query: q, type: "keyword" as const }));
  let ttResults: Array<{ query: string; type: string; videos: any[]; tagVideoCount?: number }> = [];

  try {
    ttResults = await searchTikTokBatch(ttQueries.slice(0, 25), 10, (msg, done, total) => {
      onProgress?.({
        message: `TikTokキーワード検証中 (${done}/${total})...`,
        percent: 78 + Math.round((done / total) * 3),
        phase: "segmenting",
      });
    });
  } catch (e) {
    console.warn("[Step5b] TikTok batch search failed:", e);
  }

  // TikTok hashtag post counts (lightweight, no video scraping)
  let tagCounts = new Map<string, number>();
  try {
    tagCounts = await fetchTagVideoCountsBatch(
      allKeywords.map(k => k.replace(/^#/, "")),
    );
  } catch (e) {
    console.warn("[Step5b] TikTok tag count fetch failed:", e);
  }

  // ── 2. Instagram Search ──
  await onProgress?.({ message: "Instagramハッシュタグ検証中...", percent: 81, phase: "segmenting" });

  const igResults = new Map<string, number>();
  const igPromises = allKeywords.slice(0, 15).map(keyword =>
    searchLimit(async () => {
      try {
        const result = await searchInstagramHashtag(keyword.replace(/^#/, ""), 10);
        return { keyword, postCount: result.totalFetched || 0 };
      } catch {
        return { keyword, postCount: -1 }; // -1 = failed (distinguish from 0)
      }
    })
  );

  const igSettled = await Promise.allSettled(igPromises);
  for (const result of igSettled) {
    if (result.status === "fulfilled") {
      igResults.set(result.value.keyword, result.value.postCount);
    }
  }

  // ── 3. X (Twitter) Search ──
  await onProgress?.({ message: "X投稿を検索中...", percent: 83, phase: "segmenting" });

  const xResults = new Map<string, { postCount: number; totalLikes: number }>();
  const xPromises = allKeywords.slice(0, 20).map(keyword =>
    searchLimit(async () => {
      try {
        const posts = await searchXPosts(keyword, 30);
        const totalLikes = posts.reduce((sum, p) => sum + p.likeCount, 0);
        return { keyword, postCount: posts.length, totalLikes };
      } catch {
        return { keyword, postCount: 0, totalLikes: 0 };
      }
    })
  );

  const xSettled = await Promise.allSettled(xPromises);
  for (const result of xSettled) {
    if (result.status === "fulfilled") {
      xResults.set(result.value.keyword, {
        postCount: result.value.postCount,
        totalLikes: result.value.totalLikes,
      });
    }
  }

  // ── 4. Google Trends ──
  await onProgress?.({ message: "Google Trendsを取得中...", percent: 85, phase: "segmenting" });

  const gtResults = new Map<string, { trend: "rising" | "stable" | "declining"; score: number }>();
  const now = new Date();
  const threeMonthsAgo = new Date(now.getTime() - 90 * 86400000);

  for (const keyword of allKeywords.slice(0, 10)) {
    try {
      const data = await fetchGoogleTrends(keyword, threeMonthsAgo, now, "JP");
      if (data.length >= 2) {
        const firstHalf = data.slice(0, Math.floor(data.length / 2));
        const secondHalf = data.slice(Math.floor(data.length / 2));
        const avgFirst = firstHalf.reduce((s, d) => s + d.value, 0) / firstHalf.length;
        const avgSecond = secondHalf.reduce((s, d) => s + d.value, 0) / secondHalf.length;
        const latestScore = data[data.length - 1]?.value || 0;

        let trend: "rising" | "stable" | "declining" = "stable";
        if (avgSecond > avgFirst * 1.3) trend = "rising";
        else if (avgSecond < avgFirst * 0.7) trend = "declining";

        gtResults.set(keyword, { trend, score: latestScore });
      }
    } catch (e) {
      console.warn(`[Step5b] Google Trends failed for "${keyword}":`, e);
    }
  }

  // ── 5. Google Ads Keyword Planner ──
  await onProgress?.({ message: "検索ボリュームを取得中...", percent: 87, phase: "segmenting" });

  const adsResults = new Map<string, { volume: number; competition: string }>();
  try {
    const adsData = await fetchKeywordVolume(allKeywords.slice(0, 20));
    for (const kw of adsData) {
      adsResults.set(kw.keyword, {
        volume: kw.avgMonthlySearches,
        competition: kw.competition,
      });
    }
  } catch (e) {
    console.warn("[Step5b] Google Ads Keyword Planner failed:", e);
  }

  // ── Assemble per community ──
  await onProgress?.({ message: "データを統合中...", percent: 88, phase: "segmenting" });

  for (const community of communities) {
    const candidates: KeywordCandidate[] = [];

    for (const keyword of community.keywords.slice(0, 5)) {
      const ttResult = ttResults.find(r => r.query === keyword);
      const videos = ttResult?.videos || [];

      // TikTok metrics
      const totalViews = videos.reduce((sum, v) => sum + (v.stats?.playCount || 0), 0);
      const totalEngagement = videos.reduce(
        (sum, v) => sum + (v.stats?.diggCount || 0) + (v.stats?.commentCount || 0) + (v.stats?.shareCount || 0),
        0,
      );
      const avgER = totalViews > 0 ? (totalEngagement / totalViews) * 100 : 0;
      const ttPostCount = tagCounts.get(keyword.replace(/^#/, "")) || ttResult?.tagVideoCount || videos.length;

      // Instagram
      const igCount = igResults.get(keyword) ?? 0;

      // X
      const xData = xResults.get(keyword) || { postCount: 0, totalLikes: 0 };

      // Google Trends
      const gtData = gtResults.get(keyword) || { trend: "stable" as const, score: 0 };

      // Google Ads
      const adsData = adsResults.get(keyword) || { volume: 0, competition: "UNSPECIFIED" };

      // Composite trend: prefer Google Trends, fallback to TT video recency
      let trend = gtData.trend;
      if (!gtResults.has(keyword)) {
        const nowTs = Date.now() / 1000;
        const recent = videos.filter(v => v.createTime && (nowTs - v.createTime) < 30 * 86400);
        const older = videos.filter(v => v.createTime && (nowTs - v.createTime) >= 30 * 86400);
        if (recent.length > older.length * 1.5) trend = "rising";
        else if (recent.length < older.length * 0.5 && older.length > 0) trend = "declining";
      }

      candidates.push({
        keyword,
        tiktokViews: totalViews,
        tiktokPostCount: ttPostCount,
        tiktokAvgER: Math.round(avgER * 100) / 100,
        instagramPostCount: igCount >= 0 ? igCount : 0,
        xPostCount: xData.postCount,
        xTotalLikes: xData.totalLikes,
        googleTrend: gtData.trend,
        googleTrendScore: gtData.score,
        monthlySearchVolume: adsData.volume,
        competition: adsData.competition,
        trend,
        selected: false,
      });
    }

    // Select top 3 by composite score (TT views + search volume weighted)
    candidates.sort((a, b) => {
      const scoreA = a.tiktokViews + (a.monthlySearchVolume * 1000) + (a.xTotalLikes * 100);
      const scoreB = b.tiktokViews + (b.monthlySearchVolume * 1000) + (b.xTotalLikes * 100);
      return scoreB - scoreA;
    });
    candidates.forEach((c, i) => { c.selected = i < 3; });

    community.keywordCandidates = candidates;
  }

  console.log(`[Step5b] Quantification complete for ${communities.length} communities`);
  return communities;
}
