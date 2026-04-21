/**
 * STEP 5: Segment Classification
 *
 * Uses X MCP user data + LLM to classify users into segments (layers).
 * Discovers communities ("界隈") from user behavior patterns.
 * Integrates TikTok/Instagram trend stats per discovered community.
 */
import pLimit from "p-limit";
import { getUserPosts, getUserLikedPosts, type XPost } from "../../../mcpClient";
import { searchTikTokBatch } from "../../../tiktokScraper";
import { invokeLLM } from "../../../_core/llm";
import {
  segmentClassificationSchema,
  SEGMENT_CLASSIFICATION_JSON_SCHEMA,
  type ProgressFn,
} from "../schemas";
import {
  SEGMENT_CLASSIFICATION_SYSTEM_PROMPT,
  buildSegmentClassificationPrompt,
} from "../prompts";

const userLimit = pLimit(2);

interface VerifiedPain {
  painId: string;
  pain: string;
  verificationScore: number;
  xPostCount: number;
  ttVideoCount: number;
  topEvidence: string[];
}

interface XPostData {
  postId: string;
  text: string;
  authorUsername: string;
  authorId: string;
  likeCount: number;
  retweetCount: number;
  painId: string;
  relevanceScore: number;
}

interface TTVideoData {
  videoId: string;
  desc: string;
  authorUniqueId: string;
  playCount: number;
  diggCount: number;
  painId: string;
  relevanceScore: number;
}

export async function classifySegments(
  productName: string,
  verifiedPains: VerifiedPain[],
  xPosts: XPostData[],
  tiktokVideos: TTVideoData[],
  onProgress?: ProgressFn,
  s1Summary?: string,
  s3Summary?: string,
): Promise<{
  communities: Array<{
    id: string;
    name: string;
    description: string;
    keywords: string[];
    representativeUsers: string[];
    size: "large" | "medium" | "small";
    layer?: "core" | "expansion";
    cultureCode?: { nicknames: string[]; hashtags: string[]; contentPatterns: string[] };
    estimatedPopulation?: number;
    populationFormula?: string;
    populationCalculation?: {
      steps: Array<{ label: string; value: number; source?: { title: string; url: string } }>;
      formula: string;
    };
    representativeUserProfiles?: Array<{
      username: string; profileUrl?: string; followerCount?: number;
      bio?: string; samplePostUrl?: string; samplePostText?: string; samplePostViews?: number;
    }>;
    personaDay?: { weekday: string; purchaseBehavior: string };
    officialGap?: { official: string; reality: string; insight: string };
    keywordCandidates?: Array<{
      keyword: string; tiktokViews: number; tiktokPostCount: number;
      tiktokAvgER: number; instagramPostCount: number;
      trend: "rising" | "stable" | "declining"; selected: boolean;
    }>;
  }>;
  segments: Array<{
    id: string;
    name: string;
    icon: string;
    matchScore: number;
    primaryPain: string;
    appeals: string[];
    communityIds: string[];
    trendStats?: {
      avgER: number;
      topHashtags: string[];
      postCount: number;
      avgViews: number;
    };
  }>;
}> {
  await onProgress?.({ message: "ユーザー行動データを収集中...", percent: 70, phase: "segmenting" });

  // Get unique authors from X posts (top 50 by engagement)
  const authorMap = new Map<string, { userId: string; username: string; totalEngagement: number }>();
  for (const post of xPosts) {
    const existing = authorMap.get(post.authorId);
    const engagement = post.likeCount + post.retweetCount;
    if (!existing || existing.totalEngagement < engagement) {
      authorMap.set(post.authorId, {
        userId: post.authorId,
        username: post.authorUsername,
        totalEngagement: engagement,
      });
    }
  }

  const topAuthors = Array.from(authorMap.values())
    .sort((a, b) => b.totalEngagement - a.totalEngagement)
    .slice(0, 50);

  // Fetch user posts and likes for top authors (sample for classification)
  const userPostsSample: string[] = [];
  if (topAuthors.length > 0) {
    const sampleSize = Math.min(20, topAuthors.length);
    const sampleAuthors = topAuthors.slice(0, sampleSize);

    const userResults = await Promise.allSettled(
      sampleAuthors.map(author =>
        userLimit(async () => {
          const [posts, liked] = await Promise.allSettled([
            getUserPosts(author.userId, 20),
            getUserLikedPosts(author.userId, 20),
          ]);
          const postsData = posts.status === "fulfilled" ? posts.value : [];
          const likedData = liked.status === "fulfilled" ? liked.value : [];
          return { username: author.username, posts: postsData, liked: likedData };
        })
      )
    );

    for (const result of userResults) {
      if (result.status === "fulfilled") {
        const { username, posts, liked } = result.value;
        if (posts.length > 0) {
          userPostsSample.push(
            `@${username} の投稿:\n${posts.slice(0, 5).map(p => `  - ${p.text.slice(0, 150)}`).join("\n")}`
          );
        }
        if (liked.length > 0) {
          userPostsSample.push(
            `@${username} がいいねした投稿:\n${liked.slice(0, 3).map(p => `  - ${p.text.slice(0, 150)}`).join("\n")}`
          );
        }
      }
    }
  }

  await onProgress?.({ message: "セグメントをAIが分類中...", percent: 75, phase: "segmenting" });

  // Format sample data for LLM with URLs (so LLM can output representativeUserProfiles)
  const xPostsSample = xPosts
    .sort((a, b) => b.likeCount - a.likeCount)
    .slice(0, 30)
    .map(p => `@${p.authorUsername} [url: https://x.com/${p.authorUsername}/status/${p.postId}]: ${p.text.slice(0, 200)} (${p.likeCount}いいね)`)
    .join("\n");

  const ttVideosSample = tiktokVideos
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, 20)
    .map(v => `@${v.authorUniqueId} [url: https://www.tiktok.com/@${v.authorUniqueId}/video/${v.videoId}]: ${v.desc.slice(0, 200)} (${v.playCount.toLocaleString()}再生)`)
    .join("\n");

  const enrichedXSample = userPostsSample.length > 0
    ? `${xPostsSample}\n\n--- ユーザー行動サンプル ---\n${userPostsSample.slice(0, 10).join("\n\n")}`
    : xPostsSample;

  // LLM classification
  const result = await invokeLLM({
    messages: [
      { role: "system", content: SEGMENT_CLASSIFICATION_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildSegmentClassificationPrompt(
          productName,
          verifiedPains.filter(p => p.verificationScore >= 0.3),
          enrichedXSample.slice(0, 4000),
          ttVideosSample.slice(0, 2000),
          s1Summary,
          s3Summary,
        ),
      },
    ],
    maxTokens: 8192,
    responseFormat: {
      type: "json_schema",
      json_schema: SEGMENT_CLASSIFICATION_JSON_SCHEMA,
    },
  });

  const text = typeof result.choices[0]?.message?.content === "string"
    ? result.choices[0].message.content
    : "";
  const parsed = JSON.parse(text);
  const validated = segmentClassificationSchema.safeParse(parsed);

  if (!validated.success) {
    console.error("[PainAnalyzer/Step5] Segment validation failed:", validated.error);
    // Fallback: construct minimal segments from verified pains
    return {
      communities: [],
      segments: verifiedPains.slice(0, 4).map((p, i) => ({
        id: `seg_${i + 1}`,
        name: `セグメント${i + 1}`,
        icon: ["🎯", "💼", "🏠", "🏃"][i] || "📊",
        matchScore: p.verificationScore,
        primaryPain: p.pain,
        appeals: [],
        communityIds: [],
      })),
    };
  }

  const segmentData = validated.data;

  // Enrich segments with TikTok trend stats per community
  await onProgress?.({ message: "トレンド統計を収集中...", percent: 80, phase: "segmenting" });

  try {
    const communityQueries = segmentData.communities
      .flatMap(c => c.keywords.slice(0, 2).map(k => ({ query: k, type: "keyword" as const })))
      .slice(0, 10);

    if (communityQueries.length > 0) {
      const trendResults = await searchTikTokBatch(communityQueries, 5);

      for (const segment of segmentData.segments) {
        const relatedCommunities = segmentData.communities.filter(c =>
          segment.communityIds.includes(c.id)
        );
        const relatedKeywords = relatedCommunities.flatMap(c => c.keywords);
        const relatedVideos = trendResults
          .filter(r => relatedKeywords.some(k => r.query.includes(k)))
          .flatMap(r => r.videos);

        if (relatedVideos.length > 0) {
          const totalViews = relatedVideos.reduce((sum, v) => sum + (v.stats?.playCount || 0), 0);
          const totalEngagement = relatedVideos.reduce(
            (sum, v) => sum + (v.stats?.diggCount || 0) + (v.stats?.commentCount || 0) + (v.stats?.shareCount || 0),
            0,
          );
          const avgViews = Math.round(totalViews / relatedVideos.length);
          const avgER = totalViews > 0 ? (totalEngagement / totalViews) * 100 : 0;

          const hashtagCounts = new Map<string, number>();
          for (const v of relatedVideos) {
            for (const tag of v.hashtags || []) {
              hashtagCounts.set(tag, (hashtagCounts.get(tag) || 0) + 1);
            }
          }
          const topHashtags = Array.from(hashtagCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([tag]) => tag);

          segment.trendStats = {
            avgER: Math.round(avgER * 100) / 100,
            topHashtags,
            postCount: relatedVideos.length,
            avgViews,
          };
        }
      }
    }
  } catch (e) {
    console.warn("[PainAnalyzer/Step5] Trend stats enrichment failed:", e);
  }

  return segmentData;
}
