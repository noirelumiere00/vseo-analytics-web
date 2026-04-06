/**
 * サムネイル画像のローカル保存ユーティリティ
 * CDN URL（TikTok / Instagram）は数日で期限切れするため、
 * 初回取得時にローカルに保存して /covers/ から配信する。
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

const COVERS_DIR = path.resolve(
  import.meta.dirname,
  process.env.NODE_ENV === "development" ? "../../data/covers" : "../data/covers",
);

// 起動時にディレクトリ作成
fs.mkdirSync(COVERS_DIR, { recursive: true });

/**
 * videoUrl からファイル名を決定的に生成（CDN URLではなく動画URLでハッシュ）
 */
function coverFilename(videoUrl: string): string {
  const hash = crypto.createHash("sha256").update(videoUrl).digest("hex").slice(0, 16);
  return `${hash}.jpg`;
}

/**
 * ローカルに保存済みかチェック
 */
function isLocalCover(coverUrl: string | undefined | null): boolean {
  if (!coverUrl) return false;
  return coverUrl.startsWith("/covers/");
}

/**
 * 期限切れしうるCDN URLか判定
 */
function isExpirableCdnUrl(coverUrl: string | undefined | null): boolean {
  if (!coverUrl) return false;
  return (
    coverUrl.includes("tiktokcdn.com") ||
    coverUrl.includes("cdninstagram.com") ||
    coverUrl.includes("fbcdn.net")
  );
}

/**
 * CDN URLから画像をダウンロードしてローカルに保存し、ローカルパスを返す。
 * 既にローカル保存済みの場合はそのパスを返す。
 * 失敗時は元のcoverUrlをそのまま返す。
 */
export async function downloadAndSaveCover(
  videoUrl: string,
  cdnCoverUrl: string | undefined | null,
): Promise<string> {
  if (!cdnCoverUrl) return "";

  // 既にローカル保存済み
  const filename = coverFilename(videoUrl);
  const localPath = `/covers/${filename}`;
  const filePath = path.join(COVERS_DIR, filename);

  if (fs.existsSync(filePath)) {
    return localPath;
  }

  // ローカルURLの場合はそのまま返す
  if (isLocalCover(cdnCoverUrl)) {
    return cdnCoverUrl;
  }

  // YouTube（永続URL）はダウンロード不要
  if (
    cdnCoverUrl.includes("ytimg.com") ||
    cdnCoverUrl.includes("youtube.com") ||
    cdnCoverUrl.includes("googleusercontent.com")
  ) {
    return cdnCoverUrl;
  }

  // CDN URLからダウンロード
  try {
    const res = await fetch(cdnCoverUrl, {
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) {
      console.warn(`[CoverStorage] Download failed (${res.status}): ${cdnCoverUrl.slice(0, 100)}`);
      return cdnCoverUrl;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 100) {
      console.warn(`[CoverStorage] Image too small (${buffer.length}b), skipping`);
      return cdnCoverUrl;
    }

    fs.writeFileSync(filePath, buffer);
    console.log(`[CoverStorage] Saved ${filename} (${(buffer.length / 1024).toFixed(0)}KB)`);
    return localPath;
  } catch (e) {
    console.warn(`[CoverStorage] Download error for ${videoUrl}:`, (e as Error).message);
    return cdnCoverUrl;
  }
}

/**
 * ownVideoData 配列内の全coverUrlをローカル保存に置き換える。
 * 配列を直接書き換える（ミューテーション）。
 */
export async function localizeCovers(ownVideoData: any[]): Promise<void> {
  const tasks = ownVideoData.map(async (v) => {
    if (!v.videoUrl || !v.coverUrl) return;
    // 既にローカル or YouTube（永続）はスキップ
    if (isLocalCover(v.coverUrl)) return;
    if (!isExpirableCdnUrl(v.coverUrl) && v.coverUrl.startsWith("http")) return;
    v.coverUrl = await downloadAndSaveCover(v.videoUrl, v.coverUrl);
  });
  await Promise.allSettled(tasks);
}
