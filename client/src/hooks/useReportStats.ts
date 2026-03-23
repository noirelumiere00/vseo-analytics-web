import { useMemo } from "react";
import { filterAdHashtags } from "@shared/const";

function getTopWords(words: string[], limit: number = 12): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const w of words) { counts.set(w, (counts.get(w) || 0) + 1); }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

export function useReportStats(data: any) {
  return useMemo(() => {
    if (!data?.videos || data.videos.length === 0) return null;

    const videos = data.videos;
    const totalVideos = videos.length;
    const totalViews = videos.reduce((sum: number, v: any) => sum + (Number(v.viewCount) || 0), 0);
    const totalEngagement = videos.reduce((sum: number, v: any) =>
      sum + (Number(v.likeCount) || 0) + (Number(v.commentCount) || 0) + (Number(v.shareCount) || 0), 0
    );

    // センチメント集計
    const sentimentCounts = {
      positive: videos.filter((v: any) => v.sentiment === "positive").length,
      neutral: videos.filter((v: any) => v.sentiment === "neutral").length,
      negative: videos.filter((v: any) => v.sentiment === "negative").length,
    };

    const sentimentPercentages = {
      positive: totalVideos > 0 ? ((sentimentCounts.positive / totalVideos) * 100).toFixed(1) : "0",
      neutral: totalVideos > 0 ? ((sentimentCounts.neutral / totalVideos) * 100).toFixed(1) : "0",
      negative: totalVideos > 0 ? ((sentimentCounts.negative / totalVideos) * 100).toFixed(1) : "0",
    };

    // ポジネガのみの比率
    const posVideos = videos.filter((v: any) => v.sentiment === "positive");
    const negVideos = videos.filter((v: any) => v.sentiment === "negative");
    const posNegTotal = posVideos.length + negVideos.length;

    const posNegRatio = {
      positive: posNegTotal > 0 ? ((posVideos.length / posNegTotal) * 100).toFixed(1) : "0",
      negative: posNegTotal > 0 ? ((negVideos.length / posNegTotal) * 100).toFixed(1) : "0",
    };

    // 再生数シェア
    const posViews = posVideos.reduce((sum: number, v: any) => sum + (Number(v.viewCount) || 0), 0);
    const negViews = negVideos.reduce((sum: number, v: any) => sum + (Number(v.viewCount) || 0), 0);
    const posNegViewsTotal = posViews + negViews;

    const viewsShare = {
      positive: posNegViewsTotal > 0 ? ((posViews / posNegViewsTotal) * 100).toFixed(1) : "0",
      negative: posNegViewsTotal > 0 ? ((negViews / posNegViewsTotal) * 100).toFixed(1) : "0",
      positiveTotal: posViews,
      negativeTotal: negViews,
    };

    // エンゲージメントシェア
    const posEngagement = posVideos.reduce((sum: number, v: any) =>
      sum + (Number(v.likeCount) || 0) + (Number(v.commentCount) || 0) + (Number(v.shareCount) || 0), 0
    );
    const negEngagement = negVideos.reduce((sum: number, v: any) =>
      sum + (Number(v.likeCount) || 0) + (Number(v.commentCount) || 0) + (Number(v.shareCount) || 0), 0
    );
    const posNegEngagementTotal = posEngagement + negEngagement;

    const engagementShare = {
      positive: posNegEngagementTotal > 0 ? ((posEngagement / posNegEngagementTotal) * 100).toFixed(1) : "0",
      negative: posNegEngagementTotal > 0 ? ((negEngagement / posNegEngagementTotal) * 100).toFixed(1) : "0",
      positiveTotal: posEngagement,
      negativeTotal: negEngagement,
    };

    // エンゲージメント内訳（Pos/Neg別、いいね/コメント/シェア/保存）
    const posLikes    = posVideos.reduce((s: number, v: any) => s + (Number(v.likeCount)    || 0), 0);
    const negLikes    = negVideos.reduce((s: number, v: any) => s + (Number(v.likeCount)    || 0), 0);
    const posComments = posVideos.reduce((s: number, v: any) => s + (Number(v.commentCount) || 0), 0);
    const negComments = negVideos.reduce((s: number, v: any) => s + (Number(v.commentCount) || 0), 0);
    const posShares   = posVideos.reduce((s: number, v: any) => s + (Number(v.shareCount)   || 0), 0);
    const negShares   = negVideos.reduce((s: number, v: any) => s + (Number(v.shareCount)   || 0), 0);
    const posSaves    = posVideos.reduce((s: number, v: any) => s + (Number(v.saveCount)    || 0), 0);
    const negSaves    = negVideos.reduce((s: number, v: any) => s + (Number(v.saveCount)    || 0), 0);
    const engBreakdown = {
      likes:    { pos: posLikes,    neg: negLikes,    total: posLikes    + negLikes    },
      comments: { pos: posComments, neg: negComments, total: posComments + negComments },
      shares:   { pos: posShares,   neg: negShares,   total: posShares   + negShares   },
      saves:    { pos: posSaves,    neg: negSaves,    total: posSaves    + negSaves    },
    };

    const neuVideos = videos.filter((v: any) => v.sentiment === "neutral");

    // 平均動画時間（Pos/Neg/Neutral別）
    const calcAvgDuration = (vids: any[]) => {
      const valid = vids.filter((v: any) => v.duration != null && (v.duration as number) > 0);
      return valid.length > 0
        ? valid.reduce((s: number, v: any) => s + (v.duration as number), 0) / valid.length
        : 0;
    };
    const avgDurationPos = calcAvgDuration(posVideos);
    const avgDurationNeg = calcAvgDuration(negVideos);
    const avgDurationNeu = calcAvgDuration(neuVideos);

    // 1本あたりの平均再生数（Pos/Neg）
    const avgViewsPos = posVideos.length > 0 ? posViews / posVideos.length : 0;
    const avgViewsNeg = negVideos.length > 0 ? negViews / negVideos.length : 0;

    // 1本あたりの平均ER%（Pos/Neg）
    const calcER = (v: any) => {
      const views = Number(v.viewCount) || 0;
      if (views === 0) return 0;
      return ((Number(v.likeCount)||0) + (Number(v.commentCount)||0) + (Number(v.shareCount)||0) + (Number(v.saveCount)||0)) / views * 100;
    };
    const avgERPos = posVideos.length > 0 ? posVideos.reduce((s: number, v: any) => s + calcER(v), 0) / posVideos.length : 0;
    const avgERNeg = negVideos.length > 0 ? negVideos.reduce((s: number, v: any) => s + calcER(v), 0) / negVideos.length : 0;

    // 頻出キーワード（Positive/Negative別）
    const positiveKeywords: string[] = [];
    const negativeKeywords: string[] = [];
    videos.forEach((v: any) => {
      if (v.keywords && Array.isArray(v.keywords)) {
        if (v.sentiment === "positive") positiveKeywords.push(...v.keywords);
        if (v.sentiment === "negative") negativeKeywords.push(...v.keywords);
      }
    });

    // 3way比率（Neutral込み・全体ベース）
    const neuViews = neuVideos.reduce((sum: number, v: any) => sum + (Number(v.viewCount) || 0), 0);
    const neuEngagement = neuVideos.reduce((sum: number, v: any) =>
      sum + (Number(v.likeCount)||0) + (Number(v.commentCount)||0) + (Number(v.shareCount)||0), 0
    );
    const threeWay = {
      posts: {
        positive: totalVideos > 0 ? ((sentimentCounts.positive / totalVideos) * 100).toFixed(1) : "0",
        neutral:  totalVideos > 0 ? ((sentimentCounts.neutral  / totalVideos) * 100).toFixed(1) : "0",
        negative: totalVideos > 0 ? ((sentimentCounts.negative / totalVideos) * 100).toFixed(1) : "0",
      },
      views: {
        positive: totalViews > 0 ? ((posViews    / totalViews) * 100).toFixed(1) : "0",
        neutral:  totalViews > 0 ? ((neuViews    / totalViews) * 100).toFixed(1) : "0",
        negative: totalViews > 0 ? ((negViews    / totalViews) * 100).toFixed(1) : "0",
      },
      engagement: {
        positive: totalEngagement > 0 ? ((posEngagement / totalEngagement) * 100).toFixed(1) : "0",
        neutral:  totalEngagement > 0 ? ((neuEngagement / totalEngagement) * 100).toFixed(1) : "0",
        negative: totalEngagement > 0 ? ((negEngagement / totalEngagement) * 100).toFixed(1) : "0",
      },
    };

    // Pos/Neg別 ハッシュタグ Top5
    const positiveHashtags: string[] = [];
    const negativeHashtags: string[] = [];
    videos.forEach((v: any) => {
      if (v.hashtags && Array.isArray(v.hashtags)) {
        if (v.sentiment === "positive") positiveHashtags.push(...filterAdHashtags(v.hashtags));
        if (v.sentiment === "negative") negativeHashtags.push(...filterAdHashtags(v.hashtags));
      }
    });
    const topHashtagsPos = getTopWords(positiveHashtags, 5);
    const topHashtagsNeg = getTopWords(negativeHashtags, 5);

    // 自動インサイト文
    const dominantSentiment =
      sentimentCounts.positive >= sentimentCounts.negative &&
      sentimentCounts.positive >= sentimentCounts.neutral
        ? "positive"
        : sentimentCounts.negative >= sentimentCounts.positive &&
          sentimentCounts.negative >= sentimentCounts.neutral
        ? "negative"
        : "neutral";

    const sentimentLabel = { positive: "Positive（ポジティブ）", negative: "Negative（ネガティブ）", neutral: "Neutral（中立）" }[dominantSentiment];
    const dominantPct = sentimentPercentages[dominantSentiment];

    let insightLines: string[] = [];
    insightLines.push(
      `全${totalVideos}本中、${sentimentLabel} が ${dominantPct}% と最多を占めています。`
    );

    if (avgERPos > 0 && avgERNeg > 0) {
      const erDiff = Math.abs(avgERPos - avgERNeg);
      if (erDiff > 0.1) {
        const higherLabel = avgERPos > avgERNeg ? "Positive" : "Negative";
        const higherVal   = avgERPos > avgERNeg ? avgERPos   : avgERNeg;
        const lowerVal    = avgERPos > avgERNeg ? avgERNeg   : avgERPos;
        insightLines.push(
          `エンゲージメント率は ${higherLabel} 動画が ${higherVal.toFixed(2)}% と、${avgERPos > avgERNeg ? "Negative" : "Positive"} (${lowerVal.toFixed(2)}%) より高く、コンテンツの質と反応が連動しています。`
        );
      } else {
        insightLines.push("Positive・Negative 間でエンゲージメント率に大きな差はありません。");
      }
    }

    const keyword = (data?.job?.keyword || "").toLowerCase();
    const meaningfulHashtags = topHashtagsPos.filter((h: { word: string }) => h.word.toLowerCase() !== keyword).slice(0, 3);
    if (meaningfulHashtags.length > 0) {
      insightLines.push(
        `Positive 動画で頻出のハッシュタグは「#${meaningfulHashtags.map((h: { word: string }) => h.word).join("」「#")}」など。併用することで露出拡大が見込めます。`
      );
    }

    const autoInsight = insightLines.join(" ");

    return {
      totalVideos,
      totalViews,
      totalEngagement,
      sentimentCounts,
      sentimentPercentages,
      posNegRatio,
      viewsShare,
      engagementShare,
      positiveWords: getTopWords(positiveKeywords, 12),
      negativeWords: getTopWords(negativeKeywords, 12),
      posNegTotal,
      avgViewsPos,
      avgViewsNeg,
      avgERPos,
      avgERNeg,
      engBreakdown,
      avgDurationPos,
      avgDurationNeg,
      avgDurationNeu,

      topHashtagsPos,
      topHashtagsNeg,
      threeWay,
      autoInsight,
    };
  }, [data]);
}
