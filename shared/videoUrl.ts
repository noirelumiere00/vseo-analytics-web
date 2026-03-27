/**
 * マルチプラットフォーム動画URL判定ユーティリティ
 * TikTok / YouTube / Instagram のURLからプラットフォームと動画IDを抽出
 */

export type VideoPlatform = "tiktok" | "youtube" | "instagram";

/**
 * URLからプラットフォームを自動判定
 */
export function detectPlatform(url: string): VideoPlatform | null {
  const u = url.trim().toLowerCase();
  if (u.includes("tiktok.com")) return "tiktok";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("instagram.com")) return "instagram";
  return null;
}

/**
 * URLからプラットフォームと動画IDを抽出
 */
export function extractVideoId(url: string): { platform: VideoPlatform; id: string } | null {
  const trimmed = url.trim();

  // TikTok: /video/1234567890
  const tiktokMatch = trimmed.match(/tiktok\.com\/@[\w.]+\/video\/(\d+)/);
  if (tiktokMatch) return { platform: "tiktok", id: tiktokMatch[1] };

  // YouTube: watch?v=ID, shorts/ID, youtu.be/ID
  const ytMatch = trimmed.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (ytMatch) return { platform: "youtube", id: ytMatch[1] };

  // Instagram: /reel/CODE or /p/CODE
  const igMatch = trimmed.match(/instagram\.com\/(?:reel|p)\/([\w-]+)/);
  if (igMatch) return { platform: "instagram", id: igMatch[1] };

  return null;
}

/**
 * プラットフォーム表示ラベル
 */
export function platformLabel(platform: VideoPlatform): string {
  switch (platform) {
    case "tiktok": return "TikTok";
    case "youtube": return "YouTube";
    case "instagram": return "Instagram";
  }
}
