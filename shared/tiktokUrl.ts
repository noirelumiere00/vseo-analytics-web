/**
 * TikTok URL / ID 解析ユーティリティ
 * URL・@付きID・プレーンID を統一的に処理
 */

/**
 * TikTokプロフィールURL/ID からユーザー名を抽出
 * 対応パターン:
 *   - https://www.tiktok.com/@username
 *   - https://tiktok.com/@username?lang=ja
 *   - @username
 *   - username (プレーンID)
 */
export function extractTikTokUsername(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // URL パターン
  const urlMatch = trimmed.match(/tiktok\.com\/@([a-zA-Z0-9_.]+)/);
  if (urlMatch) return urlMatch[1];

  // @付き
  if (trimmed.startsWith("@")) {
    const id = trimmed.slice(1).split(/[\s?#/]/)[0];
    return id || null;
  }

  // プレーンID（英数字・ドット・アンダースコアのみ）
  if (/^[a-zA-Z0-9_.]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * TikTok動画URLから動画IDを抽出
 * 対応パターン:
 *   - https://www.tiktok.com/@user/video/7340000000000000000
 *   - 7340000000000000000 (数字のみ)
 */
export function extractTikTokVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // URL パターン
  const urlMatch = trimmed.match(/\/video\/(\d+)/);
  if (urlMatch) return urlMatch[1];

  // 数字のみ（動画ID直打ち）
  if (/^\d{15,25}$/.test(trimmed)) return trimmed;

  return null;
}
