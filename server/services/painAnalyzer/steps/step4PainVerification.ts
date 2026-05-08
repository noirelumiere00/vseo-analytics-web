/**
 * STEP 4: Pain Verification
 *
 * Uses X MCP + TikTok scraper to verify each pain hypothesis
 * against real social media data, then scores with LLM.
 */
import pLimit from "p-limit";
import { searchXPosts, type XPost } from "../../../mcpClient";
import { searchTikTokBatch } from "../../../tiktokScraper";
import { invokeLLM, parseLLMJson } from "../../../_core/llm";
import type { PainHypothesis, ProgressFn } from "../schemas";
import { VERIFICATION_SCORE_SYSTEM_PROMPT, buildVerificationScorePrompt } from "../prompts";

const searchLimit = pLimit(2);

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

export async function verifyPains(
  approvedPains: PainHypothesis[],
  onProgress?: ProgressFn,
): Promise<{
  xPosts: XPostData[];
  tiktokVideos: TTVideoData[];
  verifiedPains: VerifiedPain[];
}> {
  const allXPosts: XPostData[] = [];
  const allTTVideos: TTVideoData[] = [];
  const verifiedPains: VerifiedPain[] = [];

  const activePains = approvedPains.filter(p => p.approved);
  const totalPains = activePains.length;

  // Search X for each pain hypothesis
  await onProgress?.({ message: `X/TikTokでペインを検証中 (0/${totalPains})...`, percent: 52, phase: "verifying" });

  // Batch TikTok search queries
  const ttQueries = activePains.map(p => ({
    query: p.searchQuery,
    type: "keyword" as const,
  }));

  // Run X search and TikTok search in parallel
  const [xResults, ttResults] = await Promise.allSettled([
    // X search per pain
    Promise.all(activePains.map((pain, idx) =>
      searchLimit(async () => {
        const posts = await searchXPosts(pain.searchQuery, 30);
        return { painId: pain.id, posts };
      })
    )),
    // TikTok batch search
    searchTikTokBatch(ttQueries, 10, (msg, done, total) => {
      onProgress?.({ message: `TikTok検証中 (${done}/${total})...`, percent: 52 + Math.round((done / total) * 10), phase: "verifying" });
    }),
  ]);

  // Process X results
  if (xResults.status === "fulfilled") {
    for (const { painId, posts } of xResults.value) {
      for (const post of posts) {
        allXPosts.push({
          postId: post.id,
          text: post.text,
          authorUsername: post.authorUsername,
          authorId: post.authorId,
          likeCount: post.likeCount,
          retweetCount: post.retweetCount,
          painId,
          relevanceScore: 0, // Scored by LLM below
        });
      }
    }
  } else {
    console.warn("[PainAnalyzer/Step4] X search failed:", xResults.reason);
  }

  // Process TikTok results
  if (ttResults.status === "fulfilled") {
    for (const result of ttResults.value) {
      const pain = activePains.find(p => p.searchQuery === result.query);
      if (!pain) continue;
      for (const video of result.videos) {
        allTTVideos.push({
          videoId: video.id,
          desc: video.desc || "",
          authorUniqueId: video.author?.uniqueId || "",
          playCount: video.stats?.playCount || 0,
          diggCount: video.stats?.diggCount || 0,
          painId: pain.id,
          relevanceScore: 0,
        });
      }
    }
  } else {
    console.warn("[PainAnalyzer/Step4] TikTok search failed:", ttResults.reason);
  }

  // Score each pain with LLM
  await onProgress?.({ message: "ペイン検証スコアを算出中...", percent: 65, phase: "verifying" });

  for (let i = 0; i < activePains.length; i++) {
    const pain = activePains[i];
    const painXPosts = allXPosts.filter(p => p.painId === pain.id);
    const painTTVideos = allTTVideos.filter(v => v.painId === pain.id);

    const postsText = [
      ...painXPosts.slice(0, 10).map(p => `[X] @${p.authorUsername}: ${p.text.slice(0, 200)}`),
      ...painTTVideos.slice(0, 10).map(v => `[TikTok] @${v.authorUniqueId}: ${v.desc.slice(0, 200)} (${v.playCount.toLocaleString()}再生)`),
    ].join("\n");

    if (postsText.length > 0) {
      try {
        const result = await invokeLLM({
          messages: [
            { role: "system", content: VERIFICATION_SCORE_SYSTEM_PROMPT },
            { role: "user", content: buildVerificationScorePrompt(pain.pain, postsText) },
          ],
          maxTokens: 1024,
          responseFormat: { type: "json_object" },
        });

        const parsed = parseLLMJson(result) as any;

        verifiedPains.push({
          painId: pain.id,
          pain: pain.pain,
          verificationScore: Math.min(1, Math.max(0, parsed.verificationScore || 0)),
          xPostCount: painXPosts.length,
          ttVideoCount: painTTVideos.length,
          topEvidence: parsed.topEvidence || [],
        });
      } catch (e) {
        console.warn(`[PainAnalyzer/Step4] LLM scoring failed for ${pain.id}:`, e);
        verifiedPains.push({
          painId: pain.id,
          pain: pain.pain,
          verificationScore: painXPosts.length > 0 || painTTVideos.length > 0 ? 0.3 : 0,
          xPostCount: painXPosts.length,
          ttVideoCount: painTTVideos.length,
          topEvidence: [],
        });
      }
    } else {
      verifiedPains.push({
        painId: pain.id,
        pain: pain.pain,
        verificationScore: 0,
        xPostCount: 0,
        ttVideoCount: 0,
        topEvidence: [],
      });
    }
  }

  // Sort by verification score
  verifiedPains.sort((a, b) => b.verificationScore - a.verificationScore);

  return { xPosts: allXPosts, tiktokVideos: allTTVideos, verifiedPains };
}
