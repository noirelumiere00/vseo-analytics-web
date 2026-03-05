import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ArrowLeft, Play, Eye, Heart, MessageCircle, Share2, Bookmark, Users, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle, Search, Repeat, Star, Download, GitCompare } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { trpc } from "@/lib/trpc";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { FacetAnalysis } from "@/components/FacetAnalysis";
import { ReportSection, MicroAnalysisSection } from '@/components/ReportSection';
import { filterAdHashtags } from "@shared/const";
import PostingTimeHeatmap from "@/components/PostingTimeHeatmap";
import DurationAnalysis from "@/components/DurationAnalysis";
import AccountAnalysis from "@/components/AccountAnalysis";
import HashtagStrategy from "@/components/HashtagStrategy";

export default function AnalysisDetail() {
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const jobId = parseInt(params.id || "0");
  const [videoSortKey, setVideoSortKey] = useState<"dominance" | "views" | "engagementRate" | "sentiment">("dominance");
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  const [selectedCompareId, setSelectedCompareId] = useState<number | null>(null);

  const { data: jobList } = trpc.analysis.list.useQuery(undefined, {
    enabled: user !== undefined,
  });

  // user が undefined の場合は query を無効化
  const { data, isLoading, refetch } = trpc.analysis.getById.useQuery(
    { jobId },
    { enabled: user !== undefined && jobId > 0 }
  );

  const { data: progressData, refetch: refetchProgress } = trpc.analysis.getProgress.useQuery(
    { jobId },
    { 
      enabled: user !== undefined && jobId > 0,
      refetchInterval: (query) => {
        return query.state.data?.status === "processing" ? 2000 : false;
      }
    }
  );

  const executeAnalysis = trpc.analysis.execute.useMutation({
    onSuccess: (result) => {
      toast.success(result.message || "分析を開始しました");
      refetch();
      refetchProgress();
    },
    onError: (error) => {
      // エラーコードと詳細メッセージを表示
      const errorMessage = error.data?.code 
        ? `[${error.data.code}] ${error.message}`
        : error.message;
      console.error("[Analysis Error]", error);
      toast.error(errorMessage, { duration: 5000 });
    },
  });

  // PDF機能は仮組環境では停止
  // const exportPdf = trpc.analysis.exportPdf.useMutation({...});
  // const exportPdfPuppeteer = trpc.analysis.exportPdfPuppeteer.useMutation({...});
  // const exportPdfSnapshot = trpc.analysis.exportPdfSnapshot.useMutation({...});

  // PDF機能は仮組環境では停止
  // const handleExportPdfSnapshot = useCallback(async () => {
  //   try {
  //     const closedAccordions = document.querySelectorAll('button[aria-expanded="false"]');
  //     console.log(`[PDF Export] Found ${closedAccordions.length} closed accordions`);
  //     
  //     closedAccordions.forEach((button) => {
  //       (button as HTMLElement).click();
  //     });
  //     
  //     await new Promise((resolve) => setTimeout(resolve, 500));
  //     console.log('[PDF Export] Accordions expanded, waiting for animation...');
  //     
  //     // Lazy Load を無効化（Puppeteer が画像読み込み完了を永遠に待つのを防ぐ）
  //     document.querySelectorAll('img').forEach((img) => {
  //       img.removeAttribute('loading');
  //     });
  //     console.log('[PDF Export] Lazy loading disabled for all images');
  //     
  //     // 開発環境のプレビューバナーを一時的に非表示にする
  //     const bannerText = 'This page is not live and cannot be shared directly';
  //     const elements = Array.from(document.querySelectorAll('div, p, span, a'));
  //     const bannerElements = elements.filter((el) => el.textContent && el.textContent.includes(bannerText));
  //     console.log(`[PDF Export] Found ${bannerElements.length} banner elements`);
  //     
  //     const originalDisplays = bannerElements.map((el) => (el as HTMLElement).style.display);
  //     bannerElements.forEach((el) => {
  //       (el as HTMLElement).style.display = 'none';
  //     });
  //     console.log('[PDF Export] Preview banner hidden');
  //     
  //     const html = document.documentElement.outerHTML;
  //     const baseUrl = window.location.origin;
  //     console.log('[PDF Export] HTML snapshot captured with all accordions open');
  //     
  //     bannerElements.forEach((el, i) => {
  //       (el as HTMLElement).style.display = originalDisplays[i];
  //     });
  //     console.log('[PDF Export] Preview banner restored');
  //     
  //     exportPdfSnapshot.mutate({ html, baseUrl });
  //   } catch (error) {
  //     console.error("[PDF Export] Error during accordion expansion:", error);
  //     toast.error("PDF生成中にエラーが発生しました");
  //   } finally {
  //     // エラー時もバナーを元に戻す
  //     const bannerText = 'This page is not live and cannot be shared directly';
  //     const elements = Array.from(document.querySelectorAll('div, p, span, a'));
  //     const bannerElements = elements.filter((el) => el.textContent && el.textContent.includes(bannerText));
  //     bannerElements.forEach((el) => {
  //       (el as HTMLElement).style.display = '';
  //     });
  //   }
  // }, [exportPdfSnapshot]);

  useEffect(() => {
    if (progressData?.status === "completed") {
      refetch();
    }
  }, [progressData?.status, refetch]);

  // 自動的に分析を開始（pending状態の場合）
  useEffect(() => {
    if (data?.job.status === "pending" && !executeAnalysis.isPending) {
      executeAnalysis.mutate({ jobId });
    }
  }, [data?.job.status, jobId]);


  // レポート統計を計算 - MUST be before any early returns
  const reportStats = useMemo(() => {
    if (!data?.videos || data.videos.length === 0) return null;

    const videos = data.videos;
    const totalVideos = videos.length;
    const totalViews = videos.reduce((sum, v) => sum + (Number(v.viewCount) || 0), 0);
    const totalEngagement = videos.reduce((sum, v) => 
      sum + (Number(v.likeCount) || 0) + (Number(v.commentCount) || 0) + (Number(v.shareCount) || 0), 0
    );

    // センチメント集計
    const sentimentCounts = {
      positive: videos.filter(v => v.sentiment === "positive").length,
      neutral: videos.filter(v => v.sentiment === "neutral").length,
      negative: videos.filter(v => v.sentiment === "negative").length,
    };

    const sentimentPercentages = {
      positive: totalVideos > 0 ? ((sentimentCounts.positive / totalVideos) * 100).toFixed(1) : "0",
      neutral: totalVideos > 0 ? ((sentimentCounts.neutral / totalVideos) * 100).toFixed(1) : "0",
      negative: totalVideos > 0 ? ((sentimentCounts.negative / totalVideos) * 100).toFixed(1) : "0",
    };

    // ポジネガのみの比率
    const posVideos = videos.filter(v => v.sentiment === "positive");
    const negVideos = videos.filter(v => v.sentiment === "negative");
    const posNegTotal = posVideos.length + negVideos.length;
    
    const posNegRatio = {
      positive: posNegTotal > 0 ? ((posVideos.length / posNegTotal) * 100).toFixed(1) : "0",
      negative: posNegTotal > 0 ? ((negVideos.length / posNegTotal) * 100).toFixed(1) : "0",
    };

    // 再生数シェア
    const posViews = posVideos.reduce((sum, v) => sum + (Number(v.viewCount) || 0), 0);
    const negViews = negVideos.reduce((sum, v) => sum + (Number(v.viewCount) || 0), 0);
    const posNegViewsTotal = posViews + negViews;
    
    const viewsShare = {
      positive: posNegViewsTotal > 0 ? ((posViews / posNegViewsTotal) * 100).toFixed(1) : "0",
      negative: posNegViewsTotal > 0 ? ((negViews / posNegViewsTotal) * 100).toFixed(1) : "0",
      positiveTotal: posViews,
      negativeTotal: negViews,
    };

    // エンゲージメントシェア
    const posEngagement = posVideos.reduce((sum, v) =>
      sum + (Number(v.likeCount) || 0) + (Number(v.commentCount) || 0) + (Number(v.shareCount) || 0), 0
    );
    const negEngagement = negVideos.reduce((sum, v) =>
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
    const posLikes    = posVideos.reduce((s, v) => s + (Number(v.likeCount)    || 0), 0);
    const negLikes    = negVideos.reduce((s, v) => s + (Number(v.likeCount)    || 0), 0);
    const posComments = posVideos.reduce((s, v) => s + (Number(v.commentCount) || 0), 0);
    const negComments = negVideos.reduce((s, v) => s + (Number(v.commentCount) || 0), 0);
    const posShares   = posVideos.reduce((s, v) => s + (Number(v.shareCount)   || 0), 0);
    const negShares   = negVideos.reduce((s, v) => s + (Number(v.shareCount)   || 0), 0);
    const posSaves    = posVideos.reduce((s, v) => s + (Number(v.saveCount)    || 0), 0);
    const negSaves    = negVideos.reduce((s, v) => s + (Number(v.saveCount)    || 0), 0);
    const engBreakdown = {
      likes:    { pos: posLikes,    neg: negLikes,    total: posLikes    + negLikes    },
      comments: { pos: posComments, neg: negComments, total: posComments + negComments },
      shares:   { pos: posShares,   neg: negShares,   total: posShares   + negShares   },
      saves:    { pos: posSaves,    neg: negSaves,    total: posSaves    + negSaves    },
    };

    const neuVideos = videos.filter(v => v.sentiment === "neutral");

    // 平均動画時間（Pos/Neg/Neutral別）
    const calcAvgDuration = (vids: typeof videos) => {
      const valid = vids.filter(v => v.duration != null && (v.duration as number) > 0);
      return valid.length > 0
        ? valid.reduce((s, v) => s + (v.duration as number), 0) / valid.length
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
    const avgERPos = posVideos.length > 0 ? posVideos.reduce((s, v) => s + calcER(v), 0) / posVideos.length : 0;
    const avgERNeg = negVideos.length > 0 ? negVideos.reduce((s, v) => s + calcER(v), 0) / negVideos.length : 0;

    // 頻出キーワード（Positive/Negative別）
    const positiveKeywords: string[] = [];
    const negativeKeywords: string[] = [];
    videos.forEach(v => {
      if (v.keywords && Array.isArray(v.keywords)) {
        if (v.sentiment === "positive") positiveKeywords.push(...v.keywords);
        if (v.sentiment === "negative") negativeKeywords.push(...v.keywords);
      }
    });

    const getTopWords = (words: string[], limit: number = 12): { word: string; count: number }[] => {
      const counts = new Map<string, number>();
      for (const w of words) { counts.set(w, (counts.get(w) || 0) + 1); }
      return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([word, count]) => ({ word, count }));
    };

    // 3way比率（Neutral込み・全体ベース）
    const neuViews = neuVideos.reduce((sum, v) => sum + (Number(v.viewCount) || 0), 0);
    const neuEngagement = neuVideos.reduce((sum, v) =>
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
    videos.forEach(v => {
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
    const meaningfulHashtags = topHashtagsPos.filter(h => h.word.toLowerCase() !== keyword).slice(0, 3);
    if (meaningfulHashtags.length > 0) {
      insightLines.push(
        `Positive 動画で頻出のハッシュタグは「#${meaningfulHashtags.map(h => h.word).join("」「#")}」など。併用することで露出拡大が見込めます。`
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

  // セッション数とappearanceCountMapを取得
  const numSessions = (data?.tripleSearch as any)?.numSessions ?? data?.tripleSearch?.searches?.length ?? 3;
  const appearanceCountMap: Record<number, string[]> = (data?.tripleSearch?.duplicateAnalysis as any)?.appearanceCountMap ?? {};

  // 動画をカテゴリ別に分類（出現回数別） - MUST be before any early returns
  const categorizedVideos = useMemo(() => {
    if (!data?.tripleSearch || !data?.videos?.length) return null;
    const result: Record<number, any[]> = {};
    for (let c = numSessions; c >= 1; c--) {
      const ids = appearanceCountMap[c] ?? [];
      result[c] = data.videos.filter(v => ids.includes(v.videoId));
    }
    return result;
  }, [data, numSessions, appearanceCountMap]);

  // エンゲージメント率（いいね+コメント+シェア+保存 / 再生数）
  const getEngagementRate = useCallback((video: any) => {
    const views = video.viewCount || 0;
    if (views === 0) return 0;
    return ((video.likeCount || 0) + (video.commentCount || 0) + (video.shareCount || 0) + (video.saveCount || 0)) / views * 100;
  }, []);

  // グループ別統計（出現回数別）
  const groupStats = useMemo(() => {
    if (!categorizedVideos) return null;
    const calc = (vids: any[]) => {
      if (vids.length === 0) return { count: 0, avgViews: 0, avgEngagementRate: 0, avgScore: 0 };
      const avgViews = vids.reduce((s: number, v: any) => s + (v.viewCount || 0), 0) / vids.length;
      const avgEngagementRate = vids.reduce((s: number, v: any) => s + getEngagementRate(v), 0) / vids.length;
      const scoredVids = vids.filter((v: any) => v.score);
      const avgScore = scoredVids.length > 0
        ? scoredVids.reduce((s: number, v: any) => s + (v.score?.overallScore || 0), 0) / scoredVids.length
        : 0;
      return { count: vids.length, avgViews, avgEngagementRate, avgScore };
    };
    const result: Record<number, ReturnType<typeof calc>> = {};
    for (let c = numSessions; c >= 1; c--) {
      result[c] = calc(categorizedVideos[c] ?? []);
    }
    return result;
  }, [categorizedVideos, getEngagementRate, numSessions]);

  // ソート済み動画リスト
  const sortedCategorizedVideos = useMemo(() => {
    if (!categorizedVideos) return null;
    const rankInfo = (data?.tripleSearch as any)?.rankInfo ?? {};
    const sentimentOrder: Record<string, number> = { positive: 0, neutral: 1, negative: 2 };
    const sort = (arr: any[]) => [...arr].sort((a, b) => {
      if (videoSortKey === "views") return (b.viewCount || 0) - (a.viewCount || 0);
      if (videoSortKey === "engagementRate") return getEngagementRate(b) - getEngagementRate(a);
      if (videoSortKey === "sentiment") {
        const sa = sentimentOrder[a.sentiment ?? ""] ?? 3;
        const sb = sentimentOrder[b.sentiment ?? ""] ?? 3;
        if (sa !== sb) return sa - sb;
        return (b.viewCount || 0) - (a.viewCount || 0); // 同センチメント内は再生数順
      }
      // dominance: 順位重み付きスコア（高いほど安定して上位表示）
      return (rankInfo[b.videoId]?.dominanceScore ?? 0) - (rankInfo[a.videoId]?.dominanceScore ?? 0);
    });
    const result: Record<number, any[]> = {};
    for (let c = numSessions; c >= 1; c--) {
      result[c] = sort(categorizedVideos[c] ?? []);
    }
    return result;
  }, [categorizedVideos, videoSortKey, data?.tripleSearch, getEngagementRate, numSessions]);

  // 全件用ソート済み動画リスト
  const sortedVideos = useMemo(() => {
    if (!data?.videos) return [];
    const rankInfo = (data?.tripleSearch as any)?.rankInfo ?? {};
    const sentimentOrder: Record<string, number> = { positive: 0, neutral: 1, negative: 2 };
    return [...data.videos].sort((a, b) => {
      if (videoSortKey === "views") return ((b as any).viewCount || 0) - ((a as any).viewCount || 0);
      if (videoSortKey === "engagementRate") return getEngagementRate(b) - getEngagementRate(a);
      if (videoSortKey === "sentiment") {
        const sa = sentimentOrder[(a as any).sentiment ?? ""] ?? 3;
        const sb = sentimentOrder[(b as any).sentiment ?? ""] ?? 3;
        if (sa !== sb) return sa - sb;
        return ((b as any).viewCount || 0) - ((a as any).viewCount || 0);
      }
      return (rankInfo[(b as any).videoId]?.dominanceScore ?? 0) - (rankInfo[(a as any).videoId]?.dominanceScore ?? 0);
    });
  }, [data?.videos, videoSortKey, data?.tripleSearch, getEngagementRate]);

  // Helper functions as callbacks - MUST be before any early returns
  const getSentimentBadge = useCallback((sentiment: string | null) => {
    if (!sentiment) return <Badge variant="outline">未分析</Badge>;
    switch (sentiment) {
      case "positive":
        return <Badge className="bg-green-500"><TrendingUp className="h-3 w-3 mr-1" />Positive</Badge>;
      case "negative":
        return <Badge className="bg-red-500"><TrendingDown className="h-3 w-3 mr-1" />Negative</Badge>;
      case "neutral":
        return <Badge className="bg-gray-500"><Minus className="h-3 w-3 mr-1" />Neutral</Badge>;
      default:
        return <Badge variant="outline">{sentiment}</Badge>;
    }
  }, []);

  const getAppearanceBadge = useCallback((videoId: string) => {
    if (!data?.tripleSearch) return null;
    const rankInfoItem = (data.tripleSearch as any).rankInfo?.[videoId];
    const count = rankInfoItem?.appearanceCount ?? 0;
    if (count >= numSessions) {
      return <Badge className="bg-yellow-500 text-black"><Star className="h-3 w-3 mr-1" />{numSessions}回出現</Badge>;
    }
    if (count >= 2) {
      return <Badge className="bg-blue-500"><Repeat className="h-3 w-3 mr-1" />{count}回出現</Badge>;
    }
    return <Badge variant="outline">1回のみ</Badge>;
  }, [data?.tripleSearch, numSessions]);

  const formatNumber = useCallback((num: number | bigint | null | undefined) => {
    if (num === null || num === undefined) return "0";
    const n = typeof num === "bigint" ? Number(num) : num;
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toLocaleString();
  }, []);

  // === Early returns AFTER all hooks ===
  // マークダウンレポートセクション
  const renderMarkdownReport = () => {
    if (!data || !data.report?.keyInsights) {
      return null;
    }

    // keyInsights がマークダウン形式のレポートを含むと仮定
    // 実際のレポートが別フィールドに保存されている場合は調整が必要
    return (
      <div className="mt-8 p-6 bg-white rounded-lg border border-gray-200">
        <h2 className="text-2xl font-bold mb-6">📊 詳細分析レポート</h2>
        <div className="prose prose-sm max-w-none">
          <pre className="whitespace-pre-wrap">{JSON.stringify(data.report.keyInsights, null, 2)}</pre>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">分析ジョブが見つかりません</p>
          <Button onClick={() => setLocation("/")}>ホームに戻る</Button>
        </div>
      </div>
    );
  }

  const { job, videos, tripleSearch } = data;
  


  return (
    <div className="min-h-screen bg-background">
      <div className="container py-12">
        <div className="max-w-7xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold">
                <span className="gradient-text">分析結果</span>
              </h1>
              <p className="text-muted-foreground mt-2">
                {job.keyword ? `キーワード: ${job.keyword}` : "手動URL分析"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {job.status === "completed" && (
                <Button
                  variant="outline"
                  onClick={() => { setSelectedCompareId(null); setCompareDialogOpen(true); }}
                  className="border-primary/50 text-primary hover:bg-primary/10"
                >
                  <GitCompare className="h-4 w-4 mr-2" />
                  比較
                </Button>
              )}
              <Button variant="outline" onClick={() => setLocation("/")}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                履歴に戻る
              </Button>
            </div>
          </div>

          {/* 比較レポート選択 Dialog */}
          <Dialog open={compareDialogOpen} onOpenChange={setCompareDialogOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <GitCompare className="h-5 w-5 text-primary" />
                  比較するレポートを選択
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {(jobList ?? [])
                  .filter((j) => j.id !== jobId && j.status === "completed")
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                  .map((j) => {
                    const isSelected = selectedCompareId === j.id;
                    const date = new Date(j.createdAt);
                    const dateStr = `${date.getFullYear()}/${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
                    return (
                      <button
                        key={j.id}
                        onClick={() => setSelectedCompareId(isSelected ? null : j.id)}
                        className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40 hover:bg-muted/40"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-sm truncate">
                            {j.keyword ? j.keyword.replace(/^#+/, "") : "手動URL分析"}
                          </span>
                          {isSelected && (
                            <Badge className="bg-primary text-white text-[10px] shrink-0">選択中</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{dateStr}</div>
                      </button>
                    );
                  })}
                {(jobList ?? []).filter((j) => j.id !== jobId && j.status === "completed").length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    比較できる完了済みレポートがありません
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => setCompareDialogOpen(false)}>
                  キャンセル
                </Button>
                <Button
                  disabled={!selectedCompareId}
                  onClick={() => {
                    if (selectedCompareId) {
                      setCompareDialogOpen(false);
                      setLocation(`/compare?a=${jobId}&b=${selectedCompareId}`);
                    }
                  }}
                  className="gradient-primary text-white"
                >
                  <GitCompare className="h-4 w-4 mr-2" />
                  比較する
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Status Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <CardTitle className="flex items-center gap-2">
                    ステータス
                    {job.status === "completed" && <span className="text-green-600">✓</span>}
                    {job.status === "processing" && <Loader2 className="h-5 w-5 animate-spin text-blue-600" />}
                  </CardTitle>
                  <CardDescription>
                    {job.status === "completed" && "分析が完了しました"}
                    {job.status === "processing" && (progressData?.currentStep || "分析を実行中です...")}
                    {job.status === "failed" && (progressData?.currentStep ? progressData.currentStep : "分析に失敗しました。再実行してください。")}
                    {job.status === "pending" && "分析を自動的に開始します..."}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  {(job.status === "failed" || job.status === "completed") && (
                    <Button 
                      className="gradient-primary text-white"
                      onClick={() => executeAnalysis.mutate({ jobId })}
                      disabled={executeAnalysis.isPending}
                    >
                      {executeAnalysis.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          実行中...
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-4 w-4" />
                          再実行
                        </>
                      )}
                    </Button>
                  )}
                  {job.status === "completed" && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        const link = document.createElement("a");
                        link.href = `/api/export-csv?jobId=${jobId}`;
                        // Use tRPC query to get CSV
                        fetch(`/api/trpc/analysis.exportCsv?input=${encodeURIComponent(JSON.stringify({ jobId }))}`, { credentials: "include" })
                          .then(r => r.json())
                          .then(res => {
                            const csvData = res?.result?.data?.csv;
                            const filename = res?.result?.data?.filename || `analysis_${jobId}.csv`;
                            if (csvData) {
                              const bom = "\uFEFF";
                              const blob = new Blob([bom + csvData], { type: "text/csv;charset=utf-8" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = filename;
                              a.click();
                              URL.revokeObjectURL(url);
                              toast.success("CSVをダウンロードしました");
                            }
                          })
                          .catch(() => toast.error("CSVエクスポートに失敗しました"));
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      CSV
                    </Button>
                  )}
                  {/* PDF機能は仮組環境では停止 */}
                  {/* {job.status === "completed" && (
                    <>
                      <Button 
                        variant="outline"
                        onClick={() => exportPdf.mutate({ jobId })}
                        disabled={exportPdf.isPending}
                      >
                        {exportPdf.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            生成中...
                          </>
                        ) : (
                          <>
                            <Download className="mr-2 h-4 w-4" />
                            PDF (表形式)
                          </>
                        )}
                      </Button>
                      <Button 
                        variant="outline"
                        onClick={handleExportPdfSnapshot}
                        disabled={exportPdfSnapshot.isPending}
                        className="bg-blue-50 hover:bg-blue-100"
                      >
                        {exportPdfSnapshot.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            生成中...
                          </>
                        ) : (
                          <>
                            <Download className="mr-2 h-4 w-4" />
                            PDF (全開)
                          </>
                        )}
                      </Button>
                    </>
                  ) */}
                </div>
              </div>
            </CardHeader>
            {(job.status === "processing" || (progressData && (progressData as any).failedVideos?.length > 0)) && progressData && (
              <CardContent>
                <div className="space-y-2">
                  {job.status === "processing" && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span>進捗状況</span>
                        <span className="font-medium">{Math.max(0, progressData.progress)}%</span>
                      </div>
                      <Progress value={Math.max(0, progressData.progress)} className="h-2" />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{progressData.currentStep}</span>
                        <span>{progressData.completedVideos}/{progressData.totalVideos}本完了</span>
                      </div>
                    </>
                  )}
                  {(progressData as any).failedVideos?.length > 0 && (
                    <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200">
                      <div className="flex items-center gap-1 text-sm font-medium text-red-700 mb-1">
                        <AlertTriangle className="h-4 w-4" />
                        {(progressData as any).failedVideos.length}本の動画で処理に失敗
                      </div>
                      <div className="space-y-1">
                        {(progressData as any).failedVideos.slice(0, 5).map((fv: any, i: number) => (
                          <div key={i} className="text-xs text-red-600 truncate">
                            ID: {fv.tiktokVideoId} - {fv.error}
                          </div>
                        ))}
                        {(progressData as any).failedVideos.length > 5 && (
                          <div className="text-xs text-red-500">他{(progressData as any).failedVideos.length - 5}件...</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            )}
          </Card>

          {/* Triple Search Overlap Analysis - 1枚カード統合 */}
          {tripleSearch && job.status === "completed" && (
            <Card className="border-2 border-blue-300">
              <CardHeader>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <Search className="h-6 w-6 text-blue-500" />
                  重複度分析
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* 検索結果サマリー */}
                <div className={`grid gap-3 max-w-2xl mx-auto`} style={{ gridTemplateColumns: `repeat(${Math.min(tripleSearch.searches.length, 5)}, 1fr)` }}>
                  {tripleSearch.searches.map((search: any, i: number) => (
                    <div key={i} className="text-center p-3 bg-muted rounded-lg">
                      <div className="text-sm font-medium mb-1">アカウント {i + 1}</div>
                      <div className="text-2xl font-bold">{search.totalFetched}</div>
                      <div className="text-xs text-muted-foreground">件取得</div>
                    </div>
                  ))}
                </div>

                {/* 重複度分析結果（動的: numSessions回→1回） */}
                <div className={`grid gap-3 max-w-2xl mx-auto`} style={{ gridTemplateColumns: `repeat(${Math.min(numSessions, 5)}, 1fr)` }}>
                  {Array.from({ length: numSessions }, (_, i) => {
                    const count = numSessions - i;
                    const ids = appearanceCountMap[count] ?? [];
                    const isAll = count === numSessions;
                    const isOne = count === 1;
                    const bg = isAll ? "bg-yellow-50 border-2 border-yellow-400" : isOne ? "bg-gray-50 border border-gray-200" : "bg-blue-50 border border-blue-200";
                    const textColor = isAll ? "text-yellow-600" : isOne ? "text-gray-500" : "text-blue-600";
                    const Icon = isAll ? Star : isOne ? Search : Repeat;
                    const label = isAll ? `${count}回全出現` : count === 1 ? "1回のみ" : `${count}回出現`;
                    const sublabel = isAll ? "(勝ちパターン)" : isOne ? "(パーソナライズ)" : "(準勝ち)";
                    return (
                      <div key={count} className={`text-center p-3 rounded-lg ${bg}`}>
                        <Icon className={`h-5 w-5 mx-auto mb-1 ${isAll ? "text-yellow-500" : isOne ? "text-gray-400" : "text-blue-500"}`} />
                        <div className={`text-2xl font-bold ${textColor}`}>{ids.length}</div>
                        <div className="text-xs text-muted-foreground mt-1">{label}<br/>{sublabel}</div>
                      </div>
                    );
                  })}
                </div>

                {/* グループ別統計比較 */}
                {groupStats && (
                  <div className="w-full">
                    <div className="text-sm font-semibold text-muted-foreground py-2">グループ別統計比較</div>
                    <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${Math.min(numSessions, 5)}, 1fr)` }}>
                      {Array.from({ length: numSessions }, (_, i) => {
                        const count = numSessions - i;
                        const stats = groupStats[count];
                        if (!stats) return null;
                        const isAll = count === numSessions;
                        const isOne = count === 1;
                        const bg = isAll ? "bg-yellow-50" : isOne ? "bg-gray-50" : "bg-blue-50";
                        const border = isAll ? "border-yellow-300" : isOne ? "border-gray-200" : "border-blue-200";
                        const text = isAll ? "text-yellow-700" : isOne ? "text-gray-600" : "text-blue-700";
                        const label = isAll ? `${count}回出現` : count === 1 ? "1回のみ" : `${count}回出現`;
                        return (
                          <div key={count} className={`p-3 rounded-lg border ${bg} ${border}`}>
                            <div className={`text-xs font-bold mb-2 ${text}`}>{label}（{stats.count}件）</div>
                            <div className="space-y-1.5 text-xs">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">平均再生数</span>
                                <span className="font-semibold">{formatNumber(Math.round(stats.avgViews))}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">平均ER%</span>
                                <span className="font-semibold">{stats.avgEngagementRate.toFixed(2)}%</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">平均スコア</span>
                                <span className="font-semibold">{stats.avgScore.toFixed(0)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 重複率サマリー + LLM共通点分析 */}
                <div className="p-4 bg-blue-50 border-l-4 border-blue-400 rounded space-y-3">
                  <p className="text-sm">
                    <strong>重複率 {tripleSearch.duplicateAnalysis.overlapRate.toFixed(1)}%</strong> - 
                    {tripleSearch.duplicateAnalysis.overlapRate >= 80 
                      ? "非常に高い重複率です。TikTokのアルゴリズムがこのキーワードに対して一貫した検索結果を返しており、上位表示動画は安定しています。"
                      : tripleSearch.duplicateAnalysis.overlapRate >= 50
                      ? "中程度の重複率です。一部の動画はアルゴリズムにより安定的に上位表示されていますが、パーソナライズの影響も見られます。"
                      : "低い重複率です。パーソナライズの影響が大きく、ユーザーごとに異なる検索結果が表示される傾向があります。"
                    }
                  </p>

                  {/* LLM共通点分析 - アコーディオン */}
                  {tripleSearch.commonalityAnalysis && (
                    <Accordion type="single" collapsible className="w-full">
                      <AccordionItem value="commonality" className="border-blue-200">
                        <AccordionTrigger className="text-sm font-semibold text-blue-800 hover:no-underline py-2">
                          <span className="flex items-center gap-2">
                            <Star className="h-4 w-4 text-blue-500" />
                            勝ちパターン動画の共通点分析
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-4 pt-2">
                            {/* 総括 */}
                            <div className="p-3 bg-white rounded-lg border border-blue-100">
                              <p className="text-sm font-medium text-slate-800">
                                {tripleSearch.commonalityAnalysis.summary}
                              </p>
                            </div>

                            {/* 分析項目 */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div className="p-3 bg-slate-50 rounded-lg">
                                <div className="text-xs font-semibold text-blue-700 mb-1">🎣 共通キーフック</div>
                                <p className="text-sm text-foreground">{tripleSearch.commonalityAnalysis.keyHook}</p>
                              </div>
                              <div className="p-3 bg-slate-50 rounded-lg">
                                <div className="text-xs font-semibold text-blue-700 mb-1">📋 コンテンツ傾向</div>
                                <p className="text-sm text-foreground">{tripleSearch.commonalityAnalysis.contentTrend}</p>
                              </div>
                              <div className="p-3 bg-slate-50 rounded-lg">
                                <div className="text-xs font-semibold text-blue-700 mb-1">🎬 フォーマット特徴</div>
                                <p className="text-sm text-foreground">{tripleSearch.commonalityAnalysis.formatFeatures}</p>
                              </div>
                              <div className="p-3 bg-slate-50 rounded-lg">
                                <div className="text-xs font-semibold text-blue-700 mb-1"># ハッシュタグ戦略</div>
                                <p className="text-sm text-foreground">{tripleSearch.commonalityAnalysis.hashtagStrategy}</p>
                              </div>
                            </div>

                            {/* VSEO攻略ポイント */}
                            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                              <div className="text-xs font-semibold text-blue-700 mb-1">💡 VSEO攻略ポイント</div>
                              <p className="text-sm text-blue-900 font-medium">{tripleSearch.commonalityAnalysis.vseoTips}</p>
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Report Section */}
          {reportStats && job.status === "completed" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">📊 分析レポート</CardTitle>
              </CardHeader>
              <CardContent className="space-y-8">
                {/* サマリー情報 */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">サマリー情報</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-slate-50 border border-slate-300 rounded-lg">
                      <div className="text-3xl font-bold text-black">{reportStats.totalVideos}</div>
                      <div className="text-xs text-black mt-2">総動画数</div>
                    </div>
                    <div className="text-center p-4 bg-slate-50 border border-slate-300 rounded-lg">
                      <div className="text-3xl font-bold text-black">{formatNumber(reportStats.totalViews)}</div>
                      <div className="text-xs text-black mt-2">総再生数</div>
                    </div>
                    <div className="text-center p-4 bg-slate-50 border border-slate-300 rounded-lg">
                      <div className="text-3xl font-bold text-black">{formatNumber(data?.videos?.reduce((s, v) => s + (v.likeCount || 0), 0) || 0)}</div>
                      <div className="text-xs text-black mt-2">いいね数</div>
                    </div>
                    <div className="text-center p-4 bg-slate-50 border border-slate-300 rounded-lg">
                      <div className="text-3xl font-bold text-black">{formatNumber(data?.videos?.reduce((s, v) => s + (v.commentCount || 0), 0) || 0)}</div>
                      <div className="text-xs text-black mt-2">コメント数</div>
                    </div>
                    <div className="text-center p-4 bg-slate-50 border border-slate-300 rounded-lg">
                      <div className="text-3xl font-bold text-black">{formatNumber(data?.videos?.reduce((s, v) => s + (v.shareCount || 0), 0) || 0)}</div>
                      <div className="text-xs text-black mt-2">シェア数</div>
                    </div>
                    <div className="text-center p-4 bg-slate-50 border border-slate-300 rounded-lg">
                      <div className="text-3xl font-bold text-black">{formatNumber(data?.videos?.reduce((s, v) => s + (v.saveCount || 0), 0) || 0)}</div>
                      <div className="text-xs text-black mt-2">保存数</div>
                    </div>
                  </div>
                </div>

                {/* センチメント構成比 ― ドーナツ + 統計カード */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">センチメント構成比</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                    {/* ドーナツチャート */}
                    <div className="relative">
                      <ResponsiveContainer width="100%" height={260}>
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Positive', value: reportStats.sentimentCounts.positive },
                              { name: 'Neutral',  value: reportStats.sentimentCounts.neutral  },
                              { name: 'Negative', value: reportStats.sentimentCounts.negative },
                            ]}
                            cx="50%" cy="50%"
                            innerRadius={72} outerRadius={108}
                            startAngle={90} endAngle={-270}
                            paddingAngle={2}
                            animationBegin={0} animationDuration={900}
                            labelLine={false}
                            dataKey="value"
                          >
                            <Cell fill="#10b981" />
                            <Cell fill="#9ca3af" />
                            <Cell fill="#ef4444" />
                          </Pie>
                          <Tooltip formatter={(v: number) => [`${v}本`, ""]} />
                        </PieChart>
                      </ResponsiveContainer>
                      {/* 中心ラベル */}
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center">
                          <div className="text-3xl font-bold leading-none">
                            {reportStats.sentimentCounts.positive >= reportStats.sentimentCounts.negative
                              ? reportStats.sentimentPercentages.positive
                              : reportStats.sentimentPercentages.negative}%
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {reportStats.sentimentCounts.positive >= reportStats.sentimentCounts.negative ? "Positive" : "Negative"}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 3センチメント統計カード */}
                    <div className="space-y-3">
                      {([
                        {
                          label: "Positive", count: reportStats.sentimentCounts.positive,
                          pct: reportStats.sentimentPercentages.positive,
                          border: "border-green-200", bg: "bg-green-50",
                          numCls: "text-green-700", pctCls: "text-green-400",
                          bar: "bg-green-500",
                        },
                        {
                          label: "Neutral", count: reportStats.sentimentCounts.neutral,
                          pct: reportStats.sentimentPercentages.neutral,
                          border: "border-gray-200", bg: "bg-gray-50",
                          numCls: "text-gray-600", pctCls: "text-gray-400",
                          bar: "bg-gray-400",
                        },
                        {
                          label: "Negative", count: reportStats.sentimentCounts.negative,
                          pct: reportStats.sentimentPercentages.negative,
                          border: "border-red-200", bg: "bg-red-50",
                          numCls: "text-red-700", pctCls: "text-red-400",
                          bar: "bg-red-500",
                        },
                      ] as const).map(row => (
                        <div key={row.label} className={`p-4 rounded-xl border ${row.border} ${row.bg}`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className={`text-xs font-bold uppercase tracking-wider ${row.numCls}`}>{row.label}</span>
                            <span className={`text-2xl font-black ${row.pctCls}`}>{row.pct}%</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-xl font-bold ${row.numCls}`}>{row.count}<span className="text-xs font-normal ml-1">本</span></span>
                            <div className="flex-1 h-2 bg-white/60 rounded-full overflow-hidden">
                              <div className={`h-full ${row.bar} rounded-full transition-all duration-700`} style={{ width: `${row.pct}%` }} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 自動インサイト */}
                <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
                  <h3 className="text-sm font-semibold text-blue-700 mb-1 flex items-center gap-1">
                    <Star className="h-4 w-4" /> 自動インサイト
                  </h3>
                  <p className="text-sm text-blue-900 leading-relaxed">{data?.report?.autoInsight || reportStats.autoInsight}</p>
                </div>

                {/* インパクト分析（常時表示） */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">📊 インパクト分析</h3>
                  {/* 3way シェア */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {([
                      { title: "投稿数シェア",             data: reportStats.threeWay.posts       },
                      { title: "総再生数シェア",           data: reportStats.threeWay.views       },
                      { title: "総エンゲージメントシェア", data: reportStats.threeWay.engagement  },
                    ] as const).map(({ title, data }) => (
                      <div key={title} className="p-4 border rounded-lg">
                        <h4 className="font-semibold mb-3 text-xs text-muted-foreground uppercase tracking-wide">{title}</h4>
                        <div className="space-y-3">
                          {([
                            { label: "Positive", pct: data.positive, barCls: "bg-green-500", bgCls: "bg-green-100", icon: <TrendingUp className="h-3.5 w-3.5 text-green-500" /> },
                            { label: "Neutral",  pct: data.neutral,  barCls: "bg-gray-400",  bgCls: "bg-gray-100",  icon: <Minus className="h-3.5 w-3.5 text-gray-400" /> },
                            { label: "Negative", pct: data.negative, barCls: "bg-red-500",   bgCls: "bg-red-100",   icon: <TrendingDown className="h-3.5 w-3.5 text-red-500" /> },
                          ] as const).map(row => (
                            <div key={row.label}>
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-xs flex items-center gap-1">{row.icon}{row.label}</span>
                                <span className="font-bold text-xs">{row.pct}%</span>
                              </div>
                              <Progress value={Number(row.pct)} className={`h-1.5 ${row.bgCls} [&>div]:${row.barCls}`} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* 平均指標 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <div className="p-4 border rounded-lg">
                      <h4 className="font-semibold mb-3 text-xs text-muted-foreground uppercase tracking-wide">平均再生数（1本あたり）</h4>
                      <div className="space-y-3">
                        {([
                          { label: "Positive", val: reportStats.avgViewsPos, icon: <TrendingUp className="h-3.5 w-3.5 text-green-500" />, cls: "bg-green-500", bgCls: "bg-green-100" },
                          { label: "Negative", val: reportStats.avgViewsNeg, icon: <TrendingDown className="h-3.5 w-3.5 text-red-500" />, cls: "bg-red-500",   bgCls: "bg-red-100"   },
                        ] as const).map(row => (
                          <div key={row.label}>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs flex items-center gap-1">{row.icon}{row.label}</span>
                              <span className="font-bold text-xs">{formatNumber(Math.round(row.val))}</span>
                            </div>
                            <Progress
                              value={(reportStats.avgViewsPos + reportStats.avgViewsNeg) > 0
                                ? (row.val / (reportStats.avgViewsPos + reportStats.avgViewsNeg)) * 100 : 0}
                              className={`h-1.5 ${row.bgCls} [&>div]:${row.cls}`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="p-4 border rounded-lg">
                      <h4 className="font-semibold mb-3 text-xs text-muted-foreground uppercase tracking-wide">平均ER%（1本あたり）</h4>
                      <div className="space-y-3">
                        {([
                          { label: "Positive", val: reportStats.avgERPos, icon: <TrendingUp className="h-3.5 w-3.5 text-green-500" />, cls: "bg-green-500", bgCls: "bg-green-100" },
                          { label: "Negative", val: reportStats.avgERNeg, icon: <TrendingDown className="h-3.5 w-3.5 text-red-500" />, cls: "bg-red-500",   bgCls: "bg-red-100"   },
                        ] as const).map(row => (
                          <div key={row.label}>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs flex items-center gap-1">{row.icon}{row.label}</span>
                              <span className="font-bold text-xs">{row.val.toFixed(2)}%</span>
                            </div>
                            <Progress
                              value={(reportStats.avgERPos + reportStats.avgERNeg) > 0
                                ? (row.val / (reportStats.avgERPos + reportStats.avgERNeg)) * 100 : 0}
                              className={`h-1.5 ${row.bgCls} [&>div]:${row.cls}`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 詳細分析アコーディオン */}
                <Accordion type="multiple" className="space-y-2">

                  {/* 動画マクロ分析（側面分析・頻出ワード感情マップ） */}
                  {data && data.report && (
                    <AccordionItem value="aspects" className="border rounded-xl">
                      <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/40 font-semibold text-sm">
                        動画マクロ分析
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4">
                        <ReportSection
                          keyword={data.job?.keyword || ""}
                          date={new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })}
                          videoCount={data.videos?.length || 0}
                          platform="TikTok"
                          aspects={(data.report?.facets || []).map((f: any) => ({
                            name: f.aspect || f.name || "",
                            pos: f.positive_percentage || f.pos || 0,
                            neg: f.negative_percentage || f.neg || 0,
                            desc: f.description || f.desc || ""
                          }))}
                          proposals={[]}
                          sentimentData={{
                            positive: reportStats.sentimentCounts.positive || 0,
                            negative: reportStats.sentimentCounts.negative || 0,
                            neutral: reportStats.sentimentCounts.neutral || 0,
                          }}
                          positiveWords={reportStats.positiveWords}
                          negativeWords={reportStats.negativeWords}
                          emotionWords={(data.report as any)?.emotionWords ?? undefined}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {/* 動画ミクロ分析（マーケティング施策提案） */}
                  {data && data.report && (
                    <AccordionItem value="micro-analysis" className="border rounded-xl">
                      <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/40 font-semibold text-sm">
                        動画ミクロ分析
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4 pt-2">
                        <MicroAnalysisSection
                          proposals={(data.report?.keyInsights as Array<{ category: string; title: string; description: string; analysis?: string; strategicAdvice?: string; sourceVideoIds?: string[] }> || []).map(insight => {
                            // 新カテゴリ (avoid/caution/leverage) + 旧カテゴリ後方互換 (risk/urgent/positive)
                            const cat = insight.category;
                            const priority =
                              cat === "avoid" || cat === "risk" ? "回避" :
                              cat === "caution" || cat === "urgent" ? "注意" : "活用";
                            const icon =
                              cat === "avoid" || cat === "risk" ? "🚫" :
                              cat === "caution" || cat === "urgent" ? "⚠️" : "✅";
                            return {
                              area: insight.title,
                              action: insight.description,
                              priority: priority as "回避" | "注意" | "活用",
                              icon,
                              analysis: insight.analysis,
                              strategicAdvice: insight.strategicAdvice,
                              sourceVideoIds: insight.sourceVideoIds,
                            };
                          })}
                          videos={(data.videos || [])
                            .slice()
                            .sort((a: any, b: any) => (b.viewCount || 0) - (a.viewCount || 0))
                            .slice(0, 15)
                            .map((v: any) => ({ videoId: v.videoId, accountId: v.accountId, title: v.title }))}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {/* エンゲージメント詳細 */}
                  <AccordionItem value="engagement-detail" className="border rounded-xl">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/40 font-semibold text-sm">
                      ❤️ エンゲージメント詳細（内訳 / 平均動画時間 / ハッシュタグ）
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
                      {/* エンゲージメント内訳 */}
                      <div className="space-y-3 pt-2">
                        {([
                          { label: "いいね",   icon: "❤️", key: "likes"    },
                          { label: "コメント", icon: "💬", key: "comments" },
                          { label: "シェア",   icon: "🔁", key: "shares"   },
                          { label: "保存",     icon: "🔖", key: "saves"    },
                        ] as const).map(({ label, icon, key }) => {
                          const d = reportStats.engBreakdown[key];
                          const posShare = d.total > 0 ? (d.pos / d.total) * 100 : 0;
                          return (
                            <div key={key} className="p-3 border rounded-lg">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium">{icon} {label}</span>
                                <span className="text-xs text-muted-foreground">合計 {formatNumber(d.total)}</span>
                              </div>
                              <div className="flex h-2.5 rounded-full overflow-hidden">
                                <div style={{ width: `${posShare}%` }} className="bg-green-500 transition-all duration-700" title={`Positive: ${formatNumber(d.pos)}`} />
                                <div style={{ width: `${100 - posShare}%` }} className="bg-red-400 transition-all duration-700" title={`Negative: ${formatNumber(d.neg)}`} />
                              </div>
                              <div className="flex justify-between text-xs mt-1.5 text-muted-foreground">
                                <span className="text-green-600 font-medium">Pos {formatNumber(d.pos)}</span>
                                <span className="text-red-500 font-medium">Neg {formatNumber(d.neg)}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {/* 平均動画時間 */}
                      <div className="p-4 border rounded-lg mt-4">
                        <h4 className="font-semibold mb-3 text-xs text-muted-foreground uppercase tracking-wide">平均動画時間（秒）</h4>
                        {(() => {
                          const maxDur = Math.max(reportStats.avgDurationPos, reportStats.avgDurationNeg, reportStats.avgDurationNeu, 1);
                          return (
                            <div className="space-y-3">
                              {([
                                { label: "Positive", val: reportStats.avgDurationPos, color: "bg-green-500" },
                                { label: "Neutral",  val: reportStats.avgDurationNeu, color: "bg-gray-400"  },
                                { label: "Negative", val: reportStats.avgDurationNeg, color: "bg-red-400"   },
                              ] as const).map(({ label, val, color }) => (
                                <div key={label}>
                                  <div className="flex justify-between items-center mb-1">
                                    <span className="text-xs">{label}</span>
                                    <span className="font-bold text-xs">{val > 0 ? `${Math.round(val)}秒` : "—"}</span>
                                  </div>
                                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                                    <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${(val / maxDur) * 100}%` }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                      {/* ハッシュタグ Top5 */}
                      {(reportStats.topHashtagsPos.length > 0 || reportStats.topHashtagsNeg.length > 0) && (
                        <div className="mt-4">
                          <h4 className="font-semibold mb-3 text-xs text-muted-foreground uppercase tracking-wide"># ハッシュタグ Top5（Positive / Negative）</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-3 border rounded-lg border-green-200 bg-green-50/50">
                              <p className="text-xs font-semibold text-green-700 mb-2">Positive</p>
                              <ol className="space-y-1.5">
                                {reportStats.topHashtagsPos.map((item, i) => (
                                  <li key={item.word} className="flex items-center justify-between text-sm">
                                    <span className="flex items-center gap-1">
                                      <span className="text-xs text-muted-foreground w-4">{i + 1}.</span>
                                      <span className="font-medium text-green-800">#{item.word}</span>
                                    </span>
                                    <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">{item.count}</Badge>
                                  </li>
                                ))}
                              </ol>
                            </div>
                            <div className="p-3 border rounded-lg border-red-200 bg-red-50/50">
                              <p className="text-xs font-semibold text-red-700 mb-2">Negative</p>
                              <ol className="space-y-1.5">
                                {reportStats.topHashtagsNeg.map((item, i) => (
                                  <li key={item.word} className="flex items-center justify-between text-sm">
                                    <span className="flex items-center gap-1">
                                      <span className="text-xs text-muted-foreground w-4">{i + 1}.</span>
                                      <span className="font-medium text-red-800">#{item.word}</span>
                                    </span>
                                    <Badge variant="secondary" className="text-xs bg-red-100 text-red-700">{item.count}</Badge>
                                  </li>
                                ))}
                              </ol>
                            </div>
                          </div>
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>

                  {/* 投稿最適化インサイト */}
                  {data?.videos && data.videos.length > 0 && (
                    <AccordionItem value="posting-duration-hashtag" className="border rounded-xl">
                      <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/40 font-semibold text-sm">
                        投稿最適化インサイト
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4">
                        <Tabs defaultValue="heatmap" className="w-full">
                          <TabsList className="w-full">
                            <TabsTrigger value="heatmap" className="flex-1 text-xs">投稿ヒートマップ</TabsTrigger>
                            <TabsTrigger value="duration" className="flex-1 text-xs">動画尺 x ER</TabsTrigger>
                            {(data.report as any)?.hashtagStrategy && (
                              <TabsTrigger value="hashtag" className="flex-1 text-xs">ハッシュタグ戦略</TabsTrigger>
                            )}
                          </TabsList>
                          <TabsContent value="heatmap" className="mt-4">
                            <PostingTimeHeatmap videos={data.videos as any} />
                          </TabsContent>
                          <TabsContent value="duration" className="mt-4">
                            <DurationAnalysis videos={data.videos as any} />
                          </TabsContent>
                          {(data.report as any)?.hashtagStrategy && (
                            <TabsContent value="hashtag" className="mt-4">
                              <HashtagStrategy data={(data.report as any).hashtagStrategy} />
                            </TabsContent>
                          )}
                        </Tabs>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {/* アカウント横断分析 */}
                  {data?.videos && data.videos.length > 0 && (
                    <AccordionItem value="account-analysis" className="border rounded-xl">
                      <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/40 font-semibold text-sm">
                        アカウント別分析
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4">
                        <AccountAnalysis videos={data.videos as any} />
                      </AccordionContent>
                    </AccordionItem>
                  )}

                </Accordion>

              </CardContent>
            </Card>
          )}

          {/* Videos Section - Tabbed by Appearance Count */}
          {videos.length > 0 && job.status === "completed" ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  分析対象動画 ({videos.length}件)
                </CardTitle>
                <CardDescription>
                  {tripleSearch 
                    ? `${numSessions}シークレットブラウザ検索での出現回数別に分類` 
                    : "収集された動画の詳細分析結果"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* ソートコントロール */}
                <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b">
                  <span className="text-xs text-muted-foreground font-medium">並び順:</span>
                  {[
                    { key: "dominance", label: "安定順位順" },
                    { key: "views", label: "再生数順" },
                    { key: "engagementRate", label: "ER率順" },
                    { key: "sentiment", label: "ポジネガ順" },
                  ].map(({ key, label }) => (
                    <Button
                      key={key}
                      size="sm"
                      variant={videoSortKey === key ? "default" : "outline"}
                      className="text-xs h-7"
                      onClick={() => setVideoSortKey(key as typeof videoSortKey)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>

                {sortedCategorizedVideos && tripleSearch ? (
                  <Tabs defaultValue={`count-${numSessions}`} className="w-full">
                    <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${numSessions + 1}, 1fr)` }}>
                      {Array.from({ length: numSessions }, (_, i) => {
                        const c = numSessions - i;
                        const isAll = c === numSessions;
                        const isOne = c === 1;
                        const label = isAll ? "勝ちパターン" : isOne ? "1回のみ" : `${c}回出現`;
                        const Icon = isAll ? Star : isOne ? undefined : Repeat;
                        const iconColor = isAll ? "text-yellow-500" : "text-blue-500";
                        return (
                          <TabsTrigger key={c} value={`count-${c}`} className="text-xs sm:text-sm">
                            {Icon && <Icon className={`h-3 w-3 mr-1 ${iconColor}`} />}
                            {label} ({(sortedCategorizedVideos[c] ?? []).length})
                          </TabsTrigger>
                        );
                      })}
                      <TabsTrigger value="all" className="text-xs sm:text-sm">
                        全件 ({videos.length})
                      </TabsTrigger>
                    </TabsList>

                    {Array.from({ length: numSessions }, (_, i) => {
                      const c = numSessions - i;
                      return (
                        <TabsContent key={c} value={`count-${c}`}>
                          <VideoList videos={sortedCategorizedVideos[c] ?? []} getSentimentBadge={getSentimentBadge} getAppearanceBadge={getAppearanceBadge} formatNumber={formatNumber} getEngagementRate={getEngagementRate} rankInfo={(data?.tripleSearch as any)?.rankInfo} />
                        </TabsContent>
                      );
                    })}
                    <TabsContent value="all">
                      <VideoList videos={sortedVideos} getSentimentBadge={getSentimentBadge} getAppearanceBadge={getAppearanceBadge} formatNumber={formatNumber} getEngagementRate={getEngagementRate} rankInfo={(data?.tripleSearch as any)?.rankInfo} />
                    </TabsContent>
                  </Tabs>
                ) : (
                  <VideoList videos={sortedVideos} getSentimentBadge={getSentimentBadge} getAppearanceBadge={getAppearanceBadge} formatNumber={formatNumber} getEngagementRate={getEngagementRate} rankInfo={(data?.tripleSearch as any)?.rankInfo} />
                )}
              </CardContent>
            </Card>
          ) : videos.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  {job.status === "pending" 
                    ? "分析を自動的に開始します..." 
                    : job.status === "processing"
                    ? "動画データを収集中です..."
                    : "動画データがありません"}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// 動画リストコンポーネント
function VideoList({ videos, getSentimentBadge, getAppearanceBadge, formatNumber, getEngagementRate, rankInfo }: {
  videos: any[];
  getSentimentBadge: (sentiment: string | null) => React.ReactNode;
  getAppearanceBadge: (videoId: string) => React.ReactNode;
  formatNumber: (num: number | bigint | null | undefined) => string;
  getEngagementRate: (video: any) => number;
  rankInfo?: Record<string, { ranks: (number | null)[]; avgRank: number; dominanceScore: number }>;
}) {
  if (videos.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        該当する動画がありません
      </div>
    );
  }

  return (
    <Accordion type="single" collapsible className="w-full">
      {videos.map((video) => (
        <AccordionItem key={video.id} value={`video-${video.id}`}>
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-4 w-full pr-4">
              <img
                src={video.thumbnailUrl || "https://placehold.co/120x80/8A2BE2/white?text=No+Image"}
                alt={video.title || "動画サムネイル"}
                className="w-32 h-20 object-cover rounded flex-shrink-0"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src =
                    "https://placehold.co/120x80/8A2BE2/white?text=No+Image";
                }}
              />
              <div className="flex-1 text-left min-w-0">
                <div className="font-medium line-clamp-1">
                  {video.title || "タイトルなし"}
                </div>
                <div className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    {formatNumber(video.viewCount)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Heart className="h-3 w-3" />
                    {formatNumber(video.likeCount)}
                  </span>
                  <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                    <TrendingUp className="h-3 w-3" />
                    ER {getEngagementRate(video).toFixed(2)}%
                  </span>
                  {rankInfo?.[video.videoId] && (
                    <span className="text-xs text-purple-600 font-medium">
                      平均{rankInfo[video.videoId].avgRank.toFixed(1)}位
                    </span>
                  )}
                  <span className="text-xs">@{video.accountId}</span>
                  {getSentimentBadge(video.sentiment)}
                  {getAppearanceBadge(video.videoId)}
                </div>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="pt-4 space-y-6">
              {/* 動画プレーヤー */}
              <div className="aspect-video bg-black rounded overflow-hidden">
                <iframe
                  src={`https://www.tiktok.com/embed/${video.videoId}`}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>

              {/* 基本情報 */}
              <div>
                <h4 className="font-semibold mb-2">基本情報</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">プラットフォーム:</span>{" "}
                    <span className="font-medium">TikTok</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">尺:</span>{" "}
                    <span className="font-medium">{video.duration}秒</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">投稿者:</span>{" "}
                    <span className="font-medium">{video.accountName}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">フォロワー数:</span>{" "}
                    <span className="font-medium flex items-center gap-1">
                      <Users className="h-4 w-4" />
                      {formatNumber(video.followerCount)}
                    </span>
                  </div>
                </div>
              </div>

              {/* エンゲージメント数値 */}
              <div>
                <h4 className="font-semibold mb-2">エンゲージメント数値</h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="flex items-center gap-2">
                    <Eye className="h-5 w-5 text-blue-500" />
                    <div>
                      <div className="text-xs text-muted-foreground">再生数</div>
                      <div className="font-semibold">{formatNumber(video.viewCount)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Heart className="h-5 w-5 text-red-500" />
                    <div>
                      <div className="text-xs text-muted-foreground">いいね</div>
                      <div className="font-semibold">{formatNumber(video.likeCount)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <MessageCircle className="h-5 w-5 text-green-500" />
                    <div>
                      <div className="text-xs text-muted-foreground">コメント</div>
                      <div className="font-semibold">{formatNumber(video.commentCount)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Share2 className="h-5 w-5 text-purple-500" />
                    <div>
                      <div className="text-xs text-muted-foreground">シェア</div>
                      <div className="font-semibold">{formatNumber(video.shareCount)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Bookmark className="h-5 w-5 text-orange-500" />
                    <div>
                      <div className="text-xs text-muted-foreground">保存</div>
                      <div className="font-semibold">{formatNumber(video.saveCount)}</div>
                    </div>
                  </div>
                </div>
                {/* エンゲージメント率サマリー */}
                <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                  <div className="p-2 bg-emerald-50 rounded text-center">
                    <div className="text-muted-foreground">エンゲージメント率</div>
                    <div className="font-bold text-emerald-700 text-sm">{getEngagementRate(video).toFixed(2)}%</div>
                  </div>
                  <div className="p-2 bg-red-50 rounded text-center">
                    <div className="text-muted-foreground">いいね率</div>
                    <div className="font-bold text-red-600 text-sm">
                      {video.viewCount ? ((video.likeCount || 0) / video.viewCount * 100).toFixed(2) : "0"}%
                    </div>
                  </div>
                  {rankInfo?.[video.videoId] && (
                    <div className="p-2 bg-purple-50 rounded text-center">
                      <div className="text-muted-foreground">平均検索順位</div>
                      <div className="font-bold text-purple-700 text-sm">{rankInfo[video.videoId].avgRank.toFixed(1)}位</div>
                      <div className="text-muted-foreground mt-0.5">
                        {rankInfo[video.videoId].ranks.map((r, i) => r != null ? `S${i + 1}:${r}位` : null).filter(Boolean).join(" / ")}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 分析結果 */}
              <div>
                <h4 className="font-semibold mb-2">分析結果</h4>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">センチメント:</span>{" "}
                    {getSentimentBadge(video.sentiment)}
                  </div>
                  {video.keyHook && (
                    <div>
                      <span className="text-muted-foreground">キーフック:</span>{" "}
                      <span className="font-medium">{video.keyHook}</span>
                    </div>
                  )}
                  {video.keywords && video.keywords.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">キーワード:</span>{" "}
                      <div className="flex flex-wrap gap-1 mt-1">
                        {video.keywords.map((keyword: string, i: number) => (
                          <Badge key={i} variant="secondary">{keyword}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {video.hashtags && video.hashtags.length > 0 && (() => {
                    const filteredTags = filterAdHashtags(video.hashtags);
                    return filteredTags.length > 0 ? (
                      <div>
                        <span className="text-muted-foreground">ハッシュタグ:</span>{" "}
                        <div className="flex flex-wrap gap-1 mt-1">
                          {filteredTags.map((tag: string, i: number) => (
                            <Badge key={i} variant="outline">#{tag}</Badge>
                          ))}
                        </div>
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>

              {/* スコア */}
              {video.score && (
                <div>
                  <h4 className="font-semibold mb-2">スコア</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground">サムネイル</div>
                      <div className="text-2xl font-bold text-purple-600">{video.score.thumbnailScore}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">テキスト</div>
                      <div className="text-2xl font-bold text-blue-600">{video.score.textScore}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">音声</div>
                      <div className="text-2xl font-bold text-green-600">{video.score.audioScore}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">総合</div>
                      <div className="text-2xl font-bold text-orange-600">{video.score.overallScore}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
