/**
 * TikTok Hashtag Discovery Collector
 *
 * 1. Search TikTok for the product name → get videos
 * 2. Extract hashtags from all videos → frequency map
 * 3. Filter noise, keep top 30
 * 4. Fetch post counts for top hashtags via /tag/ pages
 */
import { searchTikTokBatch, fetchTagVideoCountsBatch } from "../../../tiktokScraper";

export interface DiscoveredHashtag {
  tag: string;           // #なし
  frequency: number;     // 何本の動画で使われたか
  postCount: number | null; // /tag/ ページの投稿数
}

export interface CaptionKeyword {
  word: string;
  frequency: number;  // 何本の動画キャプションで出現したか
}

export interface TikTokHashtagDiscoveryResult {
  searchQueries: string[];
  totalVideosScraped: number;
  topHashtags: DiscoveredHashtag[];
  captionKeywords: CaptionKeyword[];  // キャプション頻出ワード
}

/** Noise tags to exclude from analysis */
const NOISE_TAGS = new Set([
  "fyp", "foryou", "foryoupage", "fypシ", "viral",
  "おすすめ", "おすすめにのりたい", "おすすめのりたい", "おすすめに乗りたい",
  "tiktok", "tiktokjapan", "japan",
  "fy", "trending", "trend", "バズりたい", "バズれ",
  // アド系・PR開示タグ
  "pr", "ad", "提供", "osina", "おしな", "案件",
  "gifted", "sponsored", "タイアップ", "promotion",
]);

/** キャプション頻出ワード抽出のノイズ除外 */
const CAPTION_NOISE = new Set([
  "の", "に", "は", "を", "が", "で", "と", "も", "な", "た", "だ", "て",
  "する", "した", "して", "です", "ます", "ない", "ある", "いる", "なる",
  "これ", "それ", "あれ", "この", "その", "こと", "もの", "ところ",
  "さん", "ちゃん", "くん", "です", "ました", "してる", "やってみた",
  "tiktok", "fyp", "おすすめ", "pr", "提供",
]);

/**
 * キャプションから2文字以上の日本語・英語ワードを抽出
 * ハッシュタグ部分は除外
 */
function extractCaptionWords(desc: string): string[] {
  // ハッシュタグ部分を除去
  const textOnly = desc.replace(/#[\w\u3000-\u9FFFぁ-ヶー]+/g, "").trim();
  // 日本語: カタカナ連続 or 漢字連続 or 漢字+ひらがな複合
  // 英語: 英数字連続
  const matches = textOnly.match(/[ァ-ヶー]{2,}|[一-龥々]{2,}[ぁ-ん]*|[a-zA-Z]{3,}/g) || [];
  return matches
    .map(w => w.toLowerCase())
    .filter(w => w.length >= 2 && !CAPTION_NOISE.has(w));
}

/**
 * Discover trending hashtags related to a product on TikTok
 */
export async function discoverTikTokHashtags(
  productName: string,
  onProgress?: (message: string) => void,
): Promise<TikTokHashtagDiscoveryResult> {
  const searchQueries = [productName];

  // Step 1: Search TikTok for videos
  onProgress?.(`TikTokで「${productName}」を検索中...`);
  console.log(`[TikTokDiscovery] Searching TikTok for "${productName}"`);

  const searchResults = await searchTikTokBatch(
    searchQueries.map(q => ({ query: q, type: "keyword" as const })),
    20,
  );

  // Step 2: Aggregate hashtags + caption words from all videos
  const freqMap = new Map<string, number>();
  const captionWordFreq = new Map<string, number>();
  let totalVideos = 0;

  for (const result of searchResults) {
    for (const video of result.videos) {
      totalVideos++;
      // Hashtag extraction
      const seen = new Set<string>(); // dedupe within one video
      for (const tag of video.hashtags) {
        const normalized = tag.toLowerCase().trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        freqMap.set(normalized, (freqMap.get(normalized) || 0) + 1);
      }
      // Caption keyword extraction
      const words = extractCaptionWords(video.desc || "");
      const seenWords = new Set<string>();
      for (const w of words) {
        if (seenWords.has(w)) continue;
        seenWords.add(w);
        captionWordFreq.set(w, (captionWordFreq.get(w) || 0) + 1);
      }
    }
  }

  console.log(`[TikTokDiscovery] Scraped ${totalVideos} videos, found ${freqMap.size} unique hashtags, ${captionWordFreq.size} caption words`);

  // Step 3: Filter noise and low-frequency tags
  const filtered = [...freqMap.entries()]
    .filter(([tag, freq]) => freq >= 2 && !NOISE_TAGS.has(tag))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

  // Caption keywords: 2回以上出現したワード、上位20個
  const topCaptionKeywords: CaptionKeyword[] = [...captionWordFreq.entries()]
    .filter(([, freq]) => freq >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word, frequency]) => ({ word, frequency }));

  if (filtered.length === 0) {
    console.log("[TikTokDiscovery] No hashtags passed filter");
    return { searchQueries, totalVideosScraped: totalVideos, topHashtags: [], captionKeywords: topCaptionKeywords };
  }

  // Step 4: Fetch post counts for top tags
  const topTagNames = filtered.map(([tag]) => tag);
  onProgress?.(`上位${topTagNames.length}個のハッシュタグ投稿数を取得中...`);
  console.log(`[TikTokDiscovery] Fetching post counts for ${topTagNames.length} tags`);

  const postCounts = await fetchTagVideoCountsBatch(
    topTagNames,
    (msg) => onProgress?.(msg),
  );

  // Step 5: Merge frequency + postCount
  const topHashtags: DiscoveredHashtag[] = filtered.map(([tag, frequency]) => ({
    tag,
    frequency,
    postCount: postCounts.get(tag) ?? null,
  }));

  console.log(`[TikTokDiscovery] Done — ${topHashtags.length} hashtags with ${postCounts.size} post counts`);

  return {
    searchQueries,
    totalVideosScraped: totalVideos,
    topHashtags,
    captionKeywords: topCaptionKeywords,
  };
}
