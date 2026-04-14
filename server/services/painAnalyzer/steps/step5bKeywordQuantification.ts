/**
 * STEP 5b: Keyword Quantification
 *
 * Takes discovered communities (from STEP 5) and quantifies
 * each community's keywords using real TikTok + Instagram data.
 * Selects top 3 keywords per community by TikTok view count.
 */
import pLimit from "p-limit";
import { searchTikTokBatch } from "../../../tiktokScraper";
import { searchInstagramHashtag } from "../../../instagramScraper";
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
  trend: "rising" | "stable" | "declining";
  selected: boolean;
}

/**
 * Quantify community keywords with real TT/IG data.
 * Mutates communities in-place by adding keywordCandidates.
 */
export async function quantifyKeywords(
  communities: Community[],
  onProgress?: ProgressFn,
): Promise<Community[]> {
  await onProgress?.({ message: "キーワードをTikTok/Instagramで定量検証中...", percent: 78, phase: "segmenting" });

  // Collect all keywords from all communities for batch search
  const allQueries: Array<{ query: string; type: "keyword" | "hashtag"; communityId: string }> = [];
  for (const community of communities) {
    for (const keyword of community.keywords.slice(0, 5)) {
      allQueries.push({ query: keyword, type: "keyword", communityId: community.id });
    }
  }

  // TikTok batch search (max 25 keywords = 5 communities × 5 keywords)
  const ttQueries = allQueries.map(q => ({ query: q.query, type: q.type }));
  let ttResults: Array<{ query: string; type: string; videos: any[]; tagVideoCount?: number }> = [];

  try {
    ttResults = await searchTikTokBatch(ttQueries.slice(0, 25), 10, (msg, done, total) => {
      onProgress?.({
        message: `TikTokキーワード検証中 (${done}/${total})...`,
        percent: 78 + Math.round((done / total) * 5),
        phase: "segmenting",
      });
    });
  } catch (e) {
    console.warn("[PainAnalyzer/Step5b] TikTok batch search failed:", e);
  }

  // Instagram hashtag search (one per keyword, limited)
  await onProgress?.({ message: "Instagramハッシュタグを検証中...", percent: 83, phase: "segmenting" });

  const igResults = new Map<string, number>();
  const igQueries = allQueries.slice(0, 15); // Limit IG searches

  const igPromises = igQueries.map(q =>
    searchLimit(async () => {
      try {
        const result = await searchInstagramHashtag(q.query.replace(/^#/, ""), 10);
        return { keyword: q.query, postCount: result.totalFetched || 0 };
      } catch {
        return { keyword: q.query, postCount: 0 };
      }
    })
  );

  const igSettled = await Promise.allSettled(igPromises);
  for (const result of igSettled) {
    if (result.status === "fulfilled") {
      igResults.set(result.value.keyword, result.value.postCount);
    }
  }

  // Assemble keyword candidates per community
  for (const community of communities) {
    const candidates: KeywordCandidate[] = [];

    for (const keyword of community.keywords.slice(0, 5)) {
      const ttResult = ttResults.find(r => r.query === keyword);
      const videos = ttResult?.videos || [];

      // Calculate TikTok metrics
      const totalViews = videos.reduce((sum, v) => sum + (v.stats?.playCount || 0), 0);
      const totalEngagement = videos.reduce(
        (sum, v) => sum + (v.stats?.diggCount || 0) + (v.stats?.commentCount || 0) + (v.stats?.shareCount || 0),
        0,
      );
      const avgER = totalViews > 0 ? (totalEngagement / totalViews) * 100 : 0;
      const postCount = ttResult?.tagVideoCount || videos.length;

      // Determine trend from video recency
      const now = Date.now() / 1000;
      const recentVideos = videos.filter(v => v.createTime && (now - v.createTime) < 30 * 86400);
      const olderVideos = videos.filter(v => v.createTime && (now - v.createTime) >= 30 * 86400);
      let trend: "rising" | "stable" | "declining" = "stable";
      if (recentVideos.length > olderVideos.length * 1.5) trend = "rising";
      else if (recentVideos.length < olderVideos.length * 0.5 && olderVideos.length > 0) trend = "declining";

      candidates.push({
        keyword,
        tiktokViews: totalViews,
        tiktokPostCount: postCount,
        tiktokAvgER: Math.round(avgER * 100) / 100,
        instagramPostCount: igResults.get(keyword) || 0,
        trend,
        selected: false, // Will be set below
      });
    }

    // Select top 3 by TikTok views
    candidates.sort((a, b) => b.tiktokViews - a.tiktokViews);
    candidates.forEach((c, i) => { c.selected = i < 3; });

    community.keywordCandidates = candidates;
  }

  return communities;
}
