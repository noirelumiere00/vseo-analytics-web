export const COOKIE_NAME = "app_session_id";
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
];

export function filterAdHashtags(hashtags: string[]): string[] {
  return hashtags.filter(tag => {
    const cleanTag = tag.replace(/^#/, '').trim();
    return !AD_HASHTAG_PATTERNS.some(pattern => pattern.test(cleanTag));
  });
}
