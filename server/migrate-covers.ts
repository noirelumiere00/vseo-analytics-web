/**
 * 既存動画のサムネイル・アバターURLをローカル保存に変換するマイグレーション
 *
 * Usage: npx tsx server/migrate-covers.ts
 */

import { downloadAndSaveCover } from "./coverStorage";
import * as db from "./db";

async function migrate() {
  console.log("[Migrate] Starting cover URL migration...");

  // 全ジョブを取得
  const allJobs = await db.getAllJobs();
  console.log(`[Migrate] Found ${allJobs.length} jobs`);

  let thumbnailCount = 0;
  let avatarCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const job of allJobs) {
    const videos = await db.getVideosByJobId(job.id);

    for (const video of videos) {
      try {
        // サムネイル処理
        const thumb = video.thumbnailUrl;
        if (thumb && !thumb.startsWith("/covers/") && (
          thumb.includes("tiktokcdn.com") ||
          thumb.includes("cdninstagram.com") ||
          thumb.includes("fbcdn.net")
        )) {
          const localThumb = await downloadAndSaveCover(
            video.videoUrl || `video:${video.videoId}`,
            thumb
          );
          if (localThumb !== thumb) {
            await db.updateVideo(video.id, { thumbnailUrl: localThumb });
            thumbnailCount++;
          }
        } else {
          skipCount++;
        }

        // アバター処理
        const avatar = video.accountAvatarUrl;
        if (avatar && !avatar.startsWith("/covers/") && (
          avatar.includes("tiktokcdn.com") ||
          avatar.includes("cdninstagram.com") ||
          avatar.includes("fbcdn.net")
        )) {
          const localAvatar = await downloadAndSaveCover(
            `avatar:${video.accountId || "unknown"}`,
            avatar
          );
          if (localAvatar !== avatar) {
            await db.updateVideo(video.id, { accountAvatarUrl: localAvatar });
            avatarCount++;
          }
        }
      } catch (e) {
        errorCount++;
        console.warn(`[Migrate] Error for video ${video.id}:`, (e as Error).message);
      }
    }

    if (videos.length > 0) {
      console.log(`[Migrate] Job ${job.id}: processed ${videos.length} videos`);
    }
  }

  console.log(`[Migrate] Done!`);
  console.log(`  Thumbnails saved: ${thumbnailCount}`);
  console.log(`  Avatars saved: ${avatarCount}`);
  console.log(`  Skipped (already local): ${skipCount}`);
  console.log(`  Errors: ${errorCount}`);

  process.exit(0);
}

migrate().catch((e) => {
  console.error("[Migrate] Fatal error:", e);
  process.exit(1);
});
