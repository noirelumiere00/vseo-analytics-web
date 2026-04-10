export const COOKIE_NAME = "app_session_id";

/** TikTokスクレイピング設定（プロキシなしでは SESSION_COUNT=3 が安定上限） */
export const SCRAPER_SESSION_COUNT = 3;
export const SCRAPER_VIDEOS_PER_SESSION = 100;
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
/** セッション有効期限: 30日 */
export const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
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
export const TREND_MAX_KEYWORDS = 10;
export const TREND_MAX_HASHTAGS = 10;
export const TREND_VIDEOS_PER_QUERY = 20;

export function isPromotionVideo(hashtags: string[]): boolean {
  return hashtags.some(tag => {
    const cleanTag = tag.replace(/^#/, '').trim();
    return AD_HASHTAG_PATTERNS.some(pattern => pattern.test(cleanTag));
  });
}

// ============================
// SOV スロットマップ用 分類・ラベル
// ============================

export type VideoGenre = "recommend" | "howto" | "entertainment" | "negative" | "other";
export type TikTokLabel = "promotion" | "paid_partnership" | "aigc";

const GENRE_PATTERNS: { genre: VideoGenre; keywords: string[] }[] = [
  { genre: "negative", keywords: ["やめて", "注意", "危険", "失敗", "ダメ", "後悔", "最悪"] },
  { genre: "howto", keywords: ["方法", "やり方", "コツ", "解説", "塗り方", "使い方", "チュートリアル"] },
  { genre: "entertainment", keywords: ["やってみた", "検証", "チャレンジ", "vlog", "日常", "ルーティン"] },
  { genre: "recommend", keywords: ["おすすめ", "レビュー", "紹介", "比較", "ランキング", "買った", "良かった", "推し"] },
];

export function classifyVideoGenre(description: string, hashtags: string[]): VideoGenre {
  const text = (description + " " + hashtags.join(" ")).toLowerCase();
  for (const { genre, keywords } of GENRE_PATTERNS) {
    if (keywords.some(kw => text.includes(kw))) return genre;
  }
  return "other";
}

const PARTNERSHIP_HASHTAGS = ["タイアップ", "提供", "pr", "案件", "コラボ"];
const AIGC_HASHTAGS = ["ai生成", "ai", "aiアート", "aigc"];

export function detectVideoLabels(
  description: string,
  hashtags: string[],
  isAd?: boolean,
  aigcDescription?: string,
): TikTokLabel[] {
  const labels: TikTokLabel[] = [];
  const cleanTags = hashtags.map(t => t.replace(/^#/, "").trim().toLowerCase());

  // 1. Promotion vs Paid Partnership
  if (isAd != null) {
    if (isAd) {
      const hasPartnershipTag = cleanTags.some(t => PARTNERSHIP_HASHTAGS.includes(t));
      labels.push(hasPartnershipTag ? "paid_partnership" : "promotion");
    }
  } else {
    // Fallback for old snapshots without isAd
    if (isPromotionVideo(hashtags)) {
      labels.push("paid_partnership");
    }
  }

  // 2. AIGC
  if (aigcDescription && aigcDescription.length > 0) {
    labels.push("aigc");
  } else if (cleanTags.some(t => AIGC_HASHTAGS.includes(t))) {
    labels.push("aigc");
  }

  return labels;
}
