export const COOKIE_NAME = "app_session_id";

/** TikTokスクレイピング設定（プロキシなしでは SESSION_COUNT=3 が安定上限） */
export const SCRAPER_SESSION_COUNT = 3;
export const SCRAPER_VIDEOS_PER_SESSION = 60;
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

/**
 * 広告系ハッシュタグのフィルター
 * #PR, #ad, #sponsored 等の広告を示すハッシュタグを除外
 */
export const AD_HASHTAG_PATTERNS = [
  /^pr$/i,
  /^ad$/i,
  /^ads$/i,
  /^sponsored$/i,
  /^提供$/,
  /^タイアップ$/,
  /^プロモーション$/,
  /^promotion$/i,
  /^gifted$/i,
  /^supplied$/i,
  /^ambassador$/i,
  /^アンバサダー$/,
  /^案件$/,
  /^企業案件$/,
  /^パートナーシップ$/,
  /^partnership$/i,
  /^partner$/i,
  /^パートナー$/,
  /^コラボ$/,
  /^collab$/i,
  /^collaboration$/i,
  /^有償$/,
];

export function filterAdHashtags(hashtags: string[]): string[] {
  return hashtags.filter(tag => {
    const cleanTag = tag.replace(/^#/, '').trim();
    return !AD_HASHTAG_PATTERNS.some(pattern => pattern.test(cleanTag));
  });
}

/** トレンド発見機能の設定 */
export const TREND_MAX_KEYWORDS = 15;
export const TREND_MAX_HASHTAGS = 15;
export const TREND_VIDEOS_PER_QUERY = 20;

export function isPromotionVideo(hashtags: string[]): boolean {
  return hashtags.some(tag => {
    const cleanTag = tag.replace(/^#/, '').trim();
    return AD_HASHTAG_PATTERNS.some(pattern => pattern.test(cleanTag));
  });
}
