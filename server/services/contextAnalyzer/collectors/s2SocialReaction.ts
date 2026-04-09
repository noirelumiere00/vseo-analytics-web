/**
 * S2 Collector — Social Reaction (TikTok/Instagram from VSEO existing DB)
 *
 * Queries the existing MySQL database for videos matching the product name
 * in descriptions or hashtags.
 */
import { getDb } from "../../../db";
import { videos, analysisJobs } from "../../../../drizzle/schema";
import { sql, like, or, desc, eq } from "drizzle-orm";
import type { S2RawData } from "../schemas";

const MAX_VIDEOS_PER_PLATFORM = 50;

/**
 * Collect S2 data: query existing VSEO DB for TikTok video data
 */
export async function collectS2(productName: string): Promise<S2RawData> {
  const db = await getDb();
  if (!db) {
    console.warn("[S2] Database not available");
    return emptyResult();
  }

  const searchPattern = `%${productName}%`;

  let tiktokVideos: Array<{
    videoUrl: string;
    description: string;
    hashtags: string[];
    viewCount: number;
    likeCount: number;
    commentCount: number;
    shareCount: number;
    authorUsername: string;
  }> = [];

  try {
    // Search videos table for matching descriptions
    const rows = await db
      .select({
        tiktokVideoId: videos.tiktokVideoId,
        description: videos.description,
        viewCount: videos.viewCount,
        likeCount: videos.likeCount,
        commentCount: videos.commentCount,
        shareCount: videos.shareCount,
        authorUsername: videos.authorUsername,
        hashtags: videos.hashtags,
      })
      .from(videos)
      .where(like(videos.description, searchPattern))
      .orderBy(desc(videos.viewCount))
      .limit(MAX_VIDEOS_PER_PLATFORM);

    tiktokVideos = rows.map(r => ({
      videoUrl: r.tiktokVideoId ? `https://www.tiktok.com/video/${r.tiktokVideoId}` : "",
      description: r.description || "",
      hashtags: (r.hashtags as string[] || []),
      viewCount: r.viewCount || 0,
      likeCount: r.likeCount || 0,
      commentCount: r.commentCount || 0,
      shareCount: r.shareCount || 0,
      authorUsername: r.authorUsername || "",
    }));
  } catch (e) {
    console.warn("[S2] TikTok query error:", e);
  }

  // Also search by keyword in analysisJobs to find related jobs
  try {
    const relatedJobs = await db
      .select({ id: analysisJobs.id, keyword: analysisJobs.keyword })
      .from(analysisJobs)
      .where(like(analysisJobs.keyword, searchPattern))
      .orderBy(desc(analysisJobs.createdAt))
      .limit(10);

    if (relatedJobs.length > 0) {
      const jobIds = relatedJobs.map(j => j.id);
      // Fetch videos from these related analysis jobs
      const jobVideos = await db
        .select({
          tiktokVideoId: videos.tiktokVideoId,
          description: videos.description,
          viewCount: videos.viewCount,
          likeCount: videos.likeCount,
          commentCount: videos.commentCount,
          shareCount: videos.shareCount,
          authorUsername: videos.authorUsername,
          hashtags: videos.hashtags,
        })
        .from(videos)
        .where(sql`${videos.jobId} IN (${sql.join(jobIds.map(id => sql`${id}`), sql`, `)})`)
        .orderBy(desc(videos.viewCount))
        .limit(MAX_VIDEOS_PER_PLATFORM);

      for (const r of jobVideos) {
        const url = r.tiktokVideoId ? `https://www.tiktok.com/video/${r.tiktokVideoId}` : "";
        if (url && !tiktokVideos.find(v => v.videoUrl === url)) {
          tiktokVideos.push({
            videoUrl: url,
            description: r.description || "",
            hashtags: (r.hashtags as string[] || []),
            viewCount: r.viewCount || 0,
            likeCount: r.likeCount || 0,
            commentCount: r.commentCount || 0,
            shareCount: r.shareCount || 0,
            authorUsername: r.authorUsername || "",
          });
        }
      }
    }
  } catch (e) {
    console.warn("[S2] Related jobs query error:", e);
  }

  // Deduplicate and limit
  const seenUrls = new Set<string>();
  const uniqueTiktok = tiktokVideos.filter(v => {
    if (!v.videoUrl || seenUrls.has(v.videoUrl)) return false;
    seenUrls.add(v.videoUrl);
    return true;
  }).slice(0, MAX_VIDEOS_PER_PLATFORM);

  return {
    tiktok: {
      videos: uniqueTiktok,
      totalCount: uniqueTiktok.length,
    },
    instagram: {
      videos: [], // Instagram data populated from campaign data if available
      totalCount: 0,
    },
  };
}

function emptyResult(): S2RawData {
  return {
    tiktok: { videos: [], totalCount: 0 },
    instagram: { videos: [], totalCount: 0 },
  };
}
