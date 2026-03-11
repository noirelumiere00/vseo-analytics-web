import { invokeLLM } from "./_core/llm";
import type { TikTokVideo } from "./tiktokScraper";
import { TREND_MAX_KEYWORDS, TREND_MAX_HASHTAGS } from "@shared/const";
import type { TrendDiscoveryJob } from "../drizzle/schema";

// 汎用ハッシュタグのブラックリスト（トレンド分析に無意味なタグ）
const BLACKLISTED_TAGS = new Set([
  "fyp", "foryou", "foryoupage", "viral", "trending", "trend",
  "おすすめ", "おすすめにのりたい", "バズりたい", "バズれ",
  "tiktok", "tiktoker", "tiktokjapan",
  "fy", "fypシ", "fypage", "fypdongggggggg",
  "xyzbca", "xyz", "xyzabc",
]);

type FlatVideo = NonNullable<TrendDiscoveryJob["scrapedVideos"]>[number];

/**
 * ペルソナ/界隈名 → 検索キーワード + ハッシュタグに拡張（LLM）
 */
export async function expandPersonaToQueries(
  persona: string,
): Promise<{ keywords: string[]; hashtags: string[] }> {
  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "あなたはTikTokのトレンドリサーチの専門家です。ユーザーが入力したペルソナや界隈名から、TikTokで検索すべきキーワードとハッシュタグを提案してください。",
      },
      {
        role: "user",
        content: `以下のペルソナ/界隈に関連するTikTok検索クエリを提案してください。

ペルソナ/界隈: "${persona}"

以下の条件で提案してください:
- keywords: このペルソナが興味を持つトピックの検索キーワード（日本語メイン、必要に応じて英語も可）を最大${TREND_MAX_KEYWORDS}個
- hashtags: 関連するハッシュタグ（#なし、日本語メイン）を最大${TREND_MAX_HASHTAGS}個
- 具体的で検索ボリュームがありそうなクエリを優先
- 汎用的すぎるもの（#fyp, #おすすめ 等）は除外`,
      },
    ],
    maxTokens: 2048,
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "persona_expansion",
        schema: {
          type: "object",
          properties: {
            keywords: {
              type: "array",
              items: { type: "string" },
              description: "検索キーワード配列",
            },
            hashtags: {
              type: "array",
              items: { type: "string" },
              description: "ハッシュタグ配列（#なし）",
            },
          },
          required: ["keywords", "hashtags"],
        },
      },
    },
  });

  const content = result.choices[0]?.message?.content;
  const text = typeof content === "string" ? content : "";
  const parsed = JSON.parse(text);

  return {
    keywords: (parsed.keywords || []).slice(0, TREND_MAX_KEYWORDS),
    hashtags: (parsed.hashtags || []).slice(0, TREND_MAX_HASHTAGS),
  };
}

/**
 * TikTokVideo → フラットJSON変換
 */
export function flattenTikTokVideo(
  video: TikTokVideo,
  query: string,
  queryType: "keyword" | "hashtag",
): FlatVideo {
  return {
    query,
    queryType,
    videoId: video.id,
    desc: video.desc,
    createTime: video.createTime,
    duration: video.duration,
    coverUrl: video.coverUrl,
    authorUniqueId: video.author.uniqueId,
    authorNickname: video.author.nickname,
    authorAvatarUrl: video.author.avatarUrl,
    followerCount: video.author.followerCount,
    playCount: video.stats.playCount,
    diggCount: video.stats.diggCount,
    commentCount: video.stats.commentCount,
    shareCount: video.stats.shareCount,
    collectCount: video.stats.collectCount,
    hashtags: video.hashtags,
    isAd: video.isAd,
  };
}

/**
 * 横断集計: 全クエリから集めた動画データを分析
 */
export function computeCrossAnalysis(videos: FlatVideo[]): NonNullable<TrendDiscoveryJob["crossAnalysis"]> {
  // 動画をvideoIdで重複排除（最初の出現を優先）
  const uniqueMap = new Map<string, FlatVideo>();
  const videoQueries = new Map<string, Set<string>>(); // videoId → クエリ集合

  for (const v of videos) {
    if (!uniqueMap.has(v.videoId)) {
      uniqueMap.set(v.videoId, v);
    }
    if (!videoQueries.has(v.videoId)) {
      videoQueries.set(v.videoId, new Set());
    }
    videoQueries.get(v.videoId)!.add(v.query);
  }

  const uniqueVideos = Array.from(uniqueMap.values());

  // --- トレンドハッシュタグ集計 ---
  const tagStats = new Map<string, { videoIds: Set<string>; queries: Set<string>; totalER: number; count: number }>();

  for (const v of uniqueVideos) {
    const er = v.playCount > 0
      ? ((v.diggCount + v.commentCount + v.shareCount + v.collectCount) / v.playCount) * 100
      : 0;

    for (const tag of v.hashtags) {
      const lowerTag = tag.toLowerCase();
      if (BLACKLISTED_TAGS.has(lowerTag)) continue;

      if (!tagStats.has(tag)) {
        tagStats.set(tag, { videoIds: new Set(), queries: new Set(), totalER: 0, count: 0 });
      }
      const stat = tagStats.get(tag)!;
      stat.videoIds.add(v.videoId);
      stat.queries.add(v.query);
      stat.totalER += er;
      stat.count++;
    }
  }

  const trendingHashtags = Array.from(tagStats.entries())
    .map(([tag, stat]) => ({
      tag,
      videoCount: stat.videoIds.size,
      queryCount: stat.queries.size,
      avgER: stat.count > 0 ? Math.round((stat.totalER / stat.count) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.videoCount - a.videoCount || b.queryCount - a.queryCount)
    .slice(0, 50);

  // --- トップ動画（ER順） ---
  const topVideos = uniqueVideos
    .map(v => {
      const er = v.playCount > 0
        ? ((v.diggCount + v.commentCount + v.shareCount + v.collectCount) / v.playCount) * 100
        : 0;
      return {
        videoId: v.videoId,
        desc: v.desc,
        authorUniqueId: v.authorUniqueId,
        authorNickname: v.authorNickname,
        playCount: v.playCount,
        er: Math.round(er * 100) / 100,
        coverUrl: v.coverUrl,
        hashtags: v.hashtags,
      };
    })
    .sort((a, b) => b.er - a.er)
    .slice(0, 30);

  // --- 共起タグペア ---
  const pairCounts = new Map<string, number>();
  for (const v of uniqueVideos) {
    const filteredTags = v.hashtags.filter(t => !BLACKLISTED_TAGS.has(t.toLowerCase()));
    for (let i = 0; i < filteredTags.length; i++) {
      for (let j = i + 1; j < filteredTags.length; j++) {
        const pair = [filteredTags[i], filteredTags[j]].sort().join("|||");
        pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
      }
    }
  }

  const coOccurringTags = Array.from(pairCounts.entries())
    .map(([pair, count]) => {
      const [tagA, tagB] = pair.split("|||");
      return { tagA, tagB, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  // --- キークリエイター（複数クエリに出現する投稿者） ---
  const creatorMap = new Map<string, {
    nickname: string;
    avatarUrl: string;
    followerCount: number;
    videoIds: Set<string>;
    queries: Set<string>;
    totalPlays: number;
  }>();

  for (const v of uniqueVideos) {
    if (!v.authorUniqueId) continue;
    if (!creatorMap.has(v.authorUniqueId)) {
      creatorMap.set(v.authorUniqueId, {
        nickname: v.authorNickname,
        avatarUrl: v.authorAvatarUrl,
        followerCount: v.followerCount,
        videoIds: new Set(),
        queries: new Set(),
        totalPlays: 0,
      });
    }
    const c = creatorMap.get(v.authorUniqueId)!;
    c.videoIds.add(v.videoId);
    c.queries.add(v.query);
    c.totalPlays += v.playCount;
    // フォロワー数は最大値を採用
    if (v.followerCount > c.followerCount) c.followerCount = v.followerCount;
  }

  const keyCreators = Array.from(creatorMap.entries())
    .filter(([, c]) => c.queries.size >= 2 || c.videoIds.size >= 2)
    .map(([uniqueId, c]) => ({
      uniqueId,
      nickname: c.nickname,
      avatarUrl: c.avatarUrl,
      followerCount: c.followerCount,
      videoCount: c.videoIds.size,
      queryCount: c.queries.size,
      totalPlays: c.totalPlays,
    }))
    .sort((a, b) => b.queryCount - a.queryCount || b.totalPlays - a.totalPlays)
    .slice(0, 20);

  return {
    trendingHashtags,
    topVideos,
    coOccurringTags,
    keyCreators,
    summary: "", // LLMサマリーは別途生成
  };
}

/**
 * LLMでトレンドサマリーを生成
 */
export async function generateTrendSummary(
  persona: string,
  crossAnalysis: NonNullable<TrendDiscoveryJob["crossAnalysis"]>,
): Promise<string> {
  const topTags = crossAnalysis.trendingHashtags.slice(0, 15)
    .map(t => `#${t.tag} (${t.videoCount}動画, ${t.queryCount}クエリ横断, ER ${t.avgER}%)`)
    .join("\n");

  const topVids = crossAnalysis.topVideos.slice(0, 10)
    .map(v => `@${v.authorUniqueId}: ${v.desc.slice(0, 60)}... (再生${v.playCount}, ER ${v.er}%)`)
    .join("\n");

  const topPairs = crossAnalysis.coOccurringTags.slice(0, 10)
    .map(p => `#${p.tagA} + #${p.tagB} (${p.count}回)`)
    .join("\n");

  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "あなたはTikTokマーケティングの専門家です。トレンドデータを分析し、実用的なインサイトを提供してください。",
      },
      {
        role: "user",
        content: `以下のTikTokトレンド分析結果を基に、「${persona}」界隈のトレンドサマリーをMarkdown形式で生成してください。

## トレンドハッシュタグ TOP15
${topTags}

## エンゲージメント率が高い動画 TOP10
${topVids}

## 頻出タグ組み合わせ TOP10
${topPairs}

## キークリエイター
${crossAnalysis.keyCreators.slice(0, 5).map(c => `@${c.uniqueId} (${c.videoCount}動画, ${c.queryCount}クエリ横断)`).join("\n")}

以下の構成でサマリーを作成してください:
1. **全体トレンド概要**（2-3文）
2. **注目すべきハッシュタグ戦略**（3-5個の具体的な推奨）
3. **コンテンツの傾向**（どんなコンテンツが伸びているか）
4. **推奨アクション**（この界隈で動画を作る場合の具体的なアドバイス3つ）`,
      },
    ],
    maxTokens: 2048,
  });

  const content = result.choices[0]?.message?.content;
  return typeof content === "string" ? content : "";
}
