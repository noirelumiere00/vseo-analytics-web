import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
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
import { Loader2, Play, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle, Search, Repeat, Star, Download, GitCompare, Megaphone, ChevronDown, XCircle, FileText, Compass, Share2, Film, Eye, Clock, ExternalLink, Heart, MessageCircle, Bookmark } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { trpc } from "@/lib/trpc";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { handleTrpcError } from "@/lib/error-handler";
import { useAuth } from "@/_core/hooks/useAuth";
import { FacetAnalysis } from "@/components/FacetAnalysis";
import { ReportSection, MicroAnalysisSection, SeoMetaKeywordsSection } from '@/components/ReportSection';
import { isPromotionVideo } from "@shared/const";
import PostingTimeHeatmap from "@/components/PostingTimeHeatmap";
import DurationAnalysis from "@/components/DurationAnalysis";
import AccountAnalysis from "@/components/AccountAnalysis";
import HashtagStrategy from "@/components/HashtagStrategy";
import DashboardLayout from "@/components/DashboardLayout";
import { AnalysisDetailSkeleton } from "@/components/PageSkeleton";
import { WinPatternContent, LosePatternContent } from "@/components/PatternContent";
import { VideoList } from "@/components/VideoList";
import { useReportStats } from "@/hooks/useReportStats";
import { usePageTitle } from "@/hooks/usePageTitle";
import { CopyButton } from "@/components/CopyButton";
import ProductionBrief from "@/components/ProductionBrief";

const SECTIONS = [
  { id: "summary", label: "概要" },
  { id: "search-mockup", label: "検索結果" },
  { id: "patterns", label: "パターン" },
  { id: "brief", label: "ブリーフ" },
  { id: "reputation", label: "評判" },
  { id: "optimization", label: "最適化" },
  { id: "data", label: "付録" },
  { id: "videos", label: "動画一覧" },
];

export default function AnalysisDetail() {
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const jobId = parseInt(params.id || "0");
  const [videoSortKey, setVideoSortKey] = useState<"dominance" | "views" | "engagementRate" | "sentiment" | "promotion">("dominance");
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
        const s = query.state.data?.status;
        return (s === "processing" || s === "queued") ? 2000 : false;
      }
    }
  );

  // 残り時間の推定
  const progressStartRef = useRef<{ time: number; pct: number } | null>(null);
  const [estimatedRemaining, setEstimatedRemaining] = useState<string | null>(null);

  useEffect(() => {
    const pct = progressData?.progress ?? 0;
    if (pct <= 0 || pct >= 100 || (progressData?.status !== "processing" && progressData?.status !== "queued")) {
      progressStartRef.current = null;
      setEstimatedRemaining(null);
      return;
    }
    if (!progressStartRef.current || pct < progressStartRef.current.pct) {
      progressStartRef.current = { time: Date.now(), pct };
      return;
    }
    const elapsed = (Date.now() - progressStartRef.current.time) / 1000;
    const pctDone = pct - progressStartRef.current.pct;
    if (pctDone < 3 || elapsed < 10) return;
    const secPerPct = elapsed / pctDone;
    const remaining = Math.round(secPerPct * (100 - pct));
    if (remaining < 60) {
      setEstimatedRemaining(`残り約${remaining}秒`);
    } else {
      setEstimatedRemaining(`残り約${Math.ceil(remaining / 60)}分`);
    }
  }, [progressData?.progress, progressData?.status]);

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

  const [cancelRequested, setCancelRequested] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("summary");

  const cancelAnalysis = trpc.analysis.cancel.useMutation({
    onSuccess: () => {
      setCancelRequested(true);
      toast.success("キャンセルリクエストを送信しました");
      refetchProgress();
    },
    onError: handleTrpcError,
  });

  const generateBrief = trpc.analysis.generateBrief.useMutation({
    onSuccess: () => {
      toast.success("ブリーフを生成しました");
      refetch();
    },
    onError: handleTrpcError,
  });

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  // IntersectionObserver for sticky nav
  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    const ids = SECTIONS.map(s => s.id);
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveSection(id);
        },
        { rootMargin: "-40% 0px -50% 0px", threshold: 0 }
      );
      obs.observe(el);
      observers.push(obs);
    }
    return () => observers.forEach(o => o.disconnect());
  }, [data]);

  // キャンセル後にfailed状態になったらrefetch
  useEffect(() => {
    if (cancelRequested && progressData?.status === "failed") {
      refetch();
      setCancelRequested(false);
    }
  }, [cancelRequested, progressData?.status, refetch]);

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

  // 自動的に分析を開始（pending状態の場合、キャンセル直後は除外）
  useEffect(() => {
    if (data?.job.status === "pending" && !executeAnalysis.isPending && !cancelRequested) {
      executeAnalysis.mutate({ jobId });
    }
  }, [data?.job.status, jobId, cancelRequested]);


  // レポート統計を計算 - MUST be before any early returns
  const reportStats = useReportStats(data);

  usePageTitle(data?.job?.keyword ? `SEO分析: ${data.job.keyword}` : "SEO分析");

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
      if (videoSortKey === "promotion") {
        const aPromo = (a.isAd || isPromotionVideo(a.hashtags || [])) ? 0 : 1;
        const bPromo = (b.isAd || isPromotionVideo(b.hashtags || [])) ? 0 : 1;
        if (aPromo !== bPromo) return aPromo - bPromo;
        return (b.viewCount || 0) - (a.viewCount || 0);
      }
      // 安定順位順: 平均順位昇順（低い＝上位）→ 同順位はdominanceScore降順
      const avgA = rankInfo[a.videoId]?.avgRank ?? 999;
      const avgB = rankInfo[b.videoId]?.avgRank ?? 999;
      if (avgA !== avgB) return avgA - avgB;
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
      if (videoSortKey === "promotion") {
        const aPromo = ((a as any).isAd || isPromotionVideo((a as any).hashtags || [])) ? 0 : 1;
        const bPromo = ((b as any).isAd || isPromotionVideo((b as any).hashtags || [])) ? 0 : 1;
        if (aPromo !== bPromo) return aPromo - bPromo;
        return ((b as any).viewCount || 0) - ((a as any).viewCount || 0);
      }
      // 安定順位順: 平均順位昇順（低い＝上位）→ 同順位はdominanceScore降順
      const avgA = rankInfo[(a as any).videoId]?.avgRank ?? 999;
      const avgB = rankInfo[(b as any).videoId]?.avgRank ?? 999;
      if (avgA !== avgB) return avgA - avgB;
      return (rankInfo[(b as any).videoId]?.dominanceScore ?? 0) - (rankInfo[(a as any).videoId]?.dominanceScore ?? 0);
    });
  }, [data?.videos, videoSortKey, data?.tripleSearch, getEngagementRate]);

  // videoMetaKeywords Map（videoId → keywords[]）
  const metaKeywordsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    const vmk = (data?.report as any)?.videoMetaKeywords;
    if (Array.isArray(vmk)) {
      for (const item of vmk) {
        if (item.videoId && Array.isArray(item.keywords)) {
          map.set(item.videoId, item.keywords);
        }
      }
    }
    return map;
  }, [data?.report]);

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

  // CSV ダウンロードヘルパー（tRPC batch形式対応）
  const downloadCsv = useCallback((endpoint: string, fallbackFilename: string) => {
    const batchInput = encodeURIComponent(JSON.stringify({ "0": { json: { jobId } } }));
    fetch(`/api/trpc/${endpoint}?batch=1&input=${batchInput}`, { credentials: "include" })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(res => {
        const item = Array.isArray(res) ? res[0] : res;
        if (item?.error) {
          toast.error(item.error.json?.message || "CSVエクスポートに失敗しました");
          return;
        }
        const data = item?.result?.data?.json || item?.result?.data;
        const csvData = data?.csv;
        const filename = data?.filename || fallbackFilename;
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
        } else {
          toast.error("CSVデータが空です");
        }
      })
      .catch((err) => toast.error(`CSVエクスポートに失敗しました: ${err.message}`));
  }, [jobId]);

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
      <DashboardLayout>
        <AnalysisDetailSkeleton />
      </DashboardLayout>
    );
  }

  if (!data) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-32">
          <div className="text-center space-y-4">
            <p className="text-muted-foreground">分析ジョブが見つかりません</p>
            <Button onClick={() => setLocation("/activity")}>一覧に戻る</Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const { job, videos, tripleSearch } = data;

  // ===== コンパクトカード描画ヘルパー (2列リスト形式) =====
  const renderVideoGrid = (vids: any[], useTripleRank = false) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mt-4">
      {vids.map((video: any, vi: number) => {
        const er = getEngagementRate(video);
        const sentimentColor = video.sentiment === "positive" ? "text-emerald-600" : video.sentiment === "negative" ? "text-[#D71921]" : "text-muted-foreground";
        const sentimentLabel = video.sentiment === "positive" ? "Positive" : video.sentiment === "negative" ? "Negative" : "Neutral";
        const ri = useTripleRank ? (data?.tripleSearch as any)?.rankInfo?.[video.videoId] : null;
        const rank = ri?.avgRank ? Math.round(ri.avgRank) : vi + 1;
        const hashtags = (video.hashtags || []).slice(0, 4);
        const desc = video.title || video.description?.slice(0, 80) || "";
        const isAd = video.isAd || isPromotionVideo(video.hashtags || []);
        return (
          <a
            key={video.videoId}
            href={video.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex gap-3 p-2.5 border border-border/50 rounded-lg bg-card/40 hover:bg-card hover:shadow-md transition-all"
            style={{ transition: `all var(--md-dur-medium2) var(--md-ease-emphasized-decel)` }}
          >
            {/* ランク番号 */}
            <div className="flex items-start pt-1 shrink-0">
              <span className="text-[13px] font-bold text-muted-foreground/60 w-5 text-center tabular-nums">{rank}</span>
            </div>
            {/* サムネイル */}
            <div className="relative w-16 h-20 rounded-md overflow-hidden shrink-0 bg-muted">
              <img
                src={video.thumbnailUrl || "https://placehold.co/64x80/1a1a1a/666?text=No"}
                alt="" className="w-full h-full object-cover" loading="lazy"
              />
              {video.duration && (
                <span className="absolute bottom-0.5 right-0.5 text-[8px] text-white bg-black/60 px-0.5 rounded font-mono">{video.duration}秒</span>
              )}
            </div>
            {/* メタ情報 */}
            <div className="flex-1 min-w-0 flex flex-col justify-between">
              {/* タイトル / 説明 */}
              <p className="text-[12px] font-medium leading-tight line-clamp-2 text-foreground">
                {desc || "（タイトルなし）"}
              </p>
              {/* ハッシュタグ */}
              {hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {hashtags.map((tag: string, ti: number) => (
                    <span key={ti} className="text-[10px] text-blue-500">#{tag}</span>
                  ))}
                </div>
              )}
              {/* メトリクス行 */}
              <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground" style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>
                <span className="flex items-center gap-0.5"><Eye className="h-3 w-3" />{formatNumber(video.viewCount)}</span>
                <span className="flex items-center gap-0.5"><Heart className="h-3 w-3" />{formatNumber(video.likeCount)}</span>
                <span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{formatNumber(video.commentCount)}</span>
                <span className="flex items-center gap-0.5"><Bookmark className="h-3 w-3" />{formatNumber(video.saveCount)}</span>
                <span className="text-emerald-600 font-medium">↗{er.toFixed(2)}%</span>
              </div>
              {/* アカウント + バッジ */}
              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground">
                <span>@{video.accountId || video.accountName}</span>
                {isAd && <span className="px-1 py-0 rounded bg-amber-100 text-amber-700 text-[9px] font-medium">広告</span>}
                <span className={`font-medium ${sentimentColor}`}>{sentimentLabel}</span>
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );  return (
    <DashboardLayout>
      <div className="w-full min-w-0 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ fontFamily: "'Space Mono', 'JetBrains Mono', monospace", letterSpacing: "0.08em" }}>
              {job.keyword ? job.keyword.replace(/^#+/, "") : "手動URL分析"}
            </h1>
            {job.status === "completed" && (
              <p className="text-sm text-muted-foreground mt-1">分析完了</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {job.status === "completed" && (
              <>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-primary/50 text-primary hover:bg-primary/10"
                    >
                      <Share2 className="h-4 w-4 mr-1.5" />
                      共有
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-3" align="end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/share/${jobId}`).then(() => {
                          toast.success("共有リンクをコピーしました");
                        }).catch(() => {
                          toast.error("コピーに失敗しました");
                        });
                      }}
                    >
                      共有リンクをコピー
                    </Button>
                  </PopoverContent>
                </Popover>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setSelectedCompareId(null); setCompareDialogOpen(true); }}
                  className="border-primary/50 text-primary hover:bg-primary/10"
                >
                  <GitCompare className="h-4 w-4 mr-1.5" />
                  比較
                </Button>
              </>
            )}
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
                  className="bg-primary text-primary-foreground"
                >
                  <GitCompare className="h-4 w-4 mr-2" />
                  比較する
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Processing / Pending / Failed */}
          {job.status !== "completed" && (
            <>
              {job.status === "failed" ? (
                <Card className="bg-card/60 backdrop-blur-sm border-destructive/30">
                  <CardContent className="py-8">
                    <div className="flex flex-col items-center gap-4 text-center">
                      <AlertTriangle className="h-8 w-8 text-destructive" />
                      <div>
                        <p className="font-medium text-destructive">分析に失敗しました</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          {progressData?.currentStep || "再実行してください"}
                        </p>
                      </div>
                      <Button
                        className="bg-primary text-primary-foreground"
                        onClick={() => executeAnalysis.mutate({ jobId })}
                        disabled={executeAnalysis.isPending}
                      >
                        {executeAnalysis.isPending ? (
                          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />実行中...</>
                        ) : (
                          <><Play className="mr-2 h-4 w-4" />再実行</>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="bg-card/60 backdrop-blur-sm border-primary/20">
                  <CardContent className="py-10">
                    <div className="max-w-md mx-auto space-y-8">
                      {/* メインステータス */}
                      <div className="flex flex-col items-center gap-3 text-center">
                        <div className="relative">
                          <div className="h-20 w-20 rounded-full p-[3px] bg-gradient-to-r from-primary via-purple-500 to-primary animate-spin-slow">
                            <div className="h-full w-full rounded-full bg-background flex items-center justify-center">
                              <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            </div>
                          </div>
                        </div>
                        <div>
                          <p className="font-semibold text-lg">
                            {progressData?.currentStep || (job.status === "pending" ? "分析を準備中..." : job.status === "queued" ? "ワーカーの処理待ち中..." : "分析を実行中...")}
                          </p>
                          {progressData && (
                            <div className="text-sm text-muted-foreground mt-1">
                              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>{Math.max(0, progressData.progress)}%</span>
                              {estimatedRemaining && (
                                <span className="ml-2 text-xs">({estimatedRemaining})</span>
                              )}
                            </div>
                          )}
                        </div>
                        {progressData && (
                          <div className="w-full">
                            <Progress value={Math.max(0, progressData.progress)} className="h-2" />
                          </div>
                        )}
                      </div>

                      {/* ステップインジケーター */}
                      <div className="space-y-3">
                        {[
                          { label: "動画データ収集", desc: "TikTok検索結果から動画を取得", startAt: 1, doneAt: 41 },
                          { label: "重複度・順位分析", desc: "複数セッションの出現パターンを分析", startAt: 41, doneAt: 43 },
                          { label: "動画コンテンツ解析", desc: "OCR・音声文字起こし・センチメント分析", startAt: 43, doneAt: 80 },
                          { label: "AIレポート生成", desc: "インサイト・戦略提案を自動生成", startAt: 80, doneAt: 99 },
                        ].map((step, i) => {
                          const pct = progressData?.progress ?? 0;
                          const isDone = pct >= step.doneAt;
                          const isActive = pct >= step.startAt && !isDone;
                          return (
                            <div key={i} className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${isActive ? "bg-primary/5 border border-primary/20" : isDone ? "opacity-60" : "opacity-40"}`} style={{ transition: `all var(--md-dur-medium2) var(--md-ease-emphasized-decel)` }}>
                              <div className={`mt-0.5 h-5 w-5 rounded-full flex items-center justify-center shrink-0 ${isDone ? "bg-green-500" : isActive ? "bg-primary" : "bg-muted"}`}>
                                {isDone ? (
                                  <CheckCircle className="h-3.5 w-3.5 text-white" />
                                ) : isActive ? (
                                  <Loader2 className="h-3 w-3 animate-spin text-white" />
                                ) : (
                                  <span className="text-[10px] text-muted-foreground font-bold">{i + 1}</span>
                                )}
                              </div>
                              <div>
                                <p className={`text-sm font-medium ${isActive ? "text-foreground" : ""}`}>{step.label}</p>
                                <p className="text-xs text-muted-foreground">{step.desc}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* キャンセルボタン */}
                      <div className="flex flex-col items-center gap-1 pt-2">
                        {cancelRequested ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            キャンセル処理中...（次のチェックポイントで停止します）
                          </div>
                        ) : (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-destructive border-destructive/30 hover:bg-destructive/10"
                              onClick={() => setCancelDialogOpen(true)}
                              disabled={cancelAnalysis.isPending}
                            >
                              {cancelAnalysis.isPending ? (
                                <><Loader2 className="mr-2 h-3 w-3 animate-spin" />送信中...</>
                              ) : (
                                <><XCircle className="mr-2 h-3 w-3" />分析をキャンセル</>
                              )}
                            </Button>
                            <p className="text-[11px] text-muted-foreground">※ 収集済みデータは保持されます</p>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* キャンセル確認ダイアログ */}
          <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>分析をキャンセルしますか？</AlertDialogTitle>
                <AlertDialogDescription>
                  実行中の分析を中断します。既に収集済みの動画データは保持され、後から再実行できます。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>戻る</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => {
                    cancelAnalysis.mutate({ jobId });
                    setCancelDialogOpen(false);
                  }}
                >
                  キャンセルする
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Completed — アクションバー（インライン） */}
          {job.status === "completed" && (
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                className="bg-primary text-primary-foreground"
                onClick={() => executeAnalysis.mutate({ jobId })}
                disabled={executeAnalysis.isPending}
                size="sm"
              >
                {executeAnalysis.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />実行中...</>
                ) : (
                  <><Play className="mr-2 h-4 w-4" />再実行</>
                )}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Download className="mr-2 h-4 w-4" />
                    CSV
                    <ChevronDown className="ml-1 h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => downloadCsv("analysis.exportCsv", `動画一覧_${jobId}.csv`)}>
                    <Download className="mr-2 h-4 w-4" />
                    動画一覧のみ
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => downloadCsv("analysis.exportCsvReport", `レポート_${jobId}.csv`)}>
                    <FileText className="mr-2 h-4 w-4" />
                    統合レポート（全データ）
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation(`/trend-discovery?keyword=${encodeURIComponent(job.keyword)}`)}
              >
                <Compass className="mr-2 h-4 w-4" />
                トレンド発掘
              </Button>
            </div>
          )}

          {/* Sticky Section Navigation */}
          {job.status === "completed" && (
            <nav className="sticky top-0 z-30 -mx-2 px-2 py-2 bg-background/80 backdrop-blur-md border-b border-border/50" style={{ transition: `all var(--md-dur-medium2) var(--md-ease-emphasized-decel)` }}>
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                {SECTIONS.map((sec) => (
                  <button
                    key={sec.id}
                    onClick={() => {
                      const el = document.getElementById(sec.id);
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      activeSection === sec.id
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    style={{ fontFamily: "'Space Mono', monospace", letterSpacing: "0.04em", transition: `all var(--md-dur-medium2) var(--md-ease-emphasized-decel)` }}
                  >
                    {sec.label}
                  </button>
                ))}
              </div>
            </nav>
          )}

          {/* KPIサマリーバナー */}
          {job.status === "completed" && reportStats && (() => {
            const avgER = reportStats.totalViews > 0
              ? ((reportStats.totalEngagement / reportStats.totalViews) * 100).toFixed(2)
              : "—";
            return (
              <div className="grid gap-4 md:grid-cols-4">
                <div className="flex items-center gap-3 border-l-4 border-primary rounded-lg p-4 bg-card/60 backdrop-blur-sm">
                  <Play className="h-5 w-5 text-primary shrink-0" />
                  <div>
                    <p className="text-2xl font-bold" style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>{reportStats.totalVideos}</p>
                    <p className="text-xs text-muted-foreground">分析動画数</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 border-l-4 border-primary/60 rounded-lg p-4 bg-card/60 backdrop-blur-sm">
                  <Search className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex items-center gap-1">
                    <div>
                      <p className="text-2xl font-bold" style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>{formatNumber(reportStats.totalViews)}</p>
                      <p className="text-xs text-muted-foreground">総再生数</p>
                    </div>
                    <CopyButton value={formatNumber(reportStats.totalViews)} className="h-6 w-6 [&_svg]:h-3 [&_svg]:w-3" />
                  </div>
                </div>
                <div className="flex items-center gap-3 border-l-4 border-primary/40 rounded-lg p-4 bg-card/60 backdrop-blur-sm">
                  <TrendingUp className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-2xl font-bold" style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>{reportStats.sentimentPercentages.positive}%</p>
                    <p className="text-xs text-muted-foreground">ポジティブ率</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 border-l-4 border-primary/20 rounded-lg p-4 bg-card/60 backdrop-blur-sm">
                  <Star className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex items-center gap-1">
                    <div>
                      <p className="text-2xl font-bold" style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>{avgER}%</p>
                      <p className="text-xs text-muted-foreground">平均ER</p>
                    </div>
                    <CopyButton value={`${avgER}%`} className="h-6 w-6 [&_svg]:h-3 [&_svg]:w-3" />
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ===== 1. 概要 (autoInsight + impact analysis) ===== */}
          {reportStats && job.status === "completed" && (
            <Card id="summary" className="bg-card/60 backdrop-blur-sm">
              <CardHeader>
                <h2 className="text-xl leading-tight uppercase tracking-wider" style={{ fontFamily: "'Space Mono', 'JetBrains Mono', monospace" }}>概要</h2>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* 自動インサイト */}
                <div className="p-4 rounded-lg bg-muted/50 border border-border/60">
                  <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-1">
                    <Star className="h-4 w-4" /> 自動インサイト
                  </h3>
                  <p className="text-sm text-foreground/80 leading-relaxed">{data?.report?.autoInsight || reportStats.autoInsight}</p>
                </div>

                {/* インパクト分析 */}
                <div>
                  <h3 className="text-sm font-semibold mb-4 uppercase tracking-wider" style={{ fontFamily: "'Space Mono', monospace" }}>インパクト分析</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {([
                      { title: "投稿数シェア",             data: reportStats.threeWay.posts       },
                      { title: "総再生数シェア",           data: reportStats.threeWay.views       },
                      { title: "総エンゲージメントシェア", data: reportStats.threeWay.engagement  },
                    ] as const).map(({ title, data }) => (
                      <div key={title} className="p-4 border border-border/60 rounded-lg bg-card/40">
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
                                <span className="font-bold text-xs" style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>{row.pct}%</span>
                              </div>
                              <Progress value={Number(row.pct)} className={`h-1.5 ${row.bgCls} [&>div]:${row.barCls}`} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}


          {/* ===== Phone Mockups — Search Result Visualization ===== */}
          {tripleSearch && job.status === "completed" && videos.length > 0 && (() => {
            const rankInfo = (tripleSearch as any)?.rankInfo ?? {};
            const searches = tripleSearch.searches || [];
            if (searches.length === 0) return null;
            // Build video lookup
            const videoMap = new Map<string, any>();
            for (const v of videos) videoMap.set((v as any).videoId, v);
            return (
              <Card id="search-mockup" className="bg-card/60 backdrop-blur-sm">
                <CardHeader>
                  <h2 className="text-xl leading-tight uppercase tracking-wider" style={{ fontFamily: "'Space Mono', 'JetBrains Mono', monospace" }}>検索結果</h2>
                  <p className="text-sm text-muted-foreground">{numSessions}セッションの TikTok 検索結果比較</p>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-center gap-6 overflow-x-auto pb-4">
                    {searches.slice(0, 3).map((search: any, sessionIdx: number) => {
                      const sessionVideos = (search.results || search.videos || []);
                      return (
                        <div key={sessionIdx} className="flex flex-col items-center gap-2 shrink-0">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider" style={{ fontFamily: "'Space Mono', monospace" }}>
                            セッション {sessionIdx + 1}
                          </span>
                          {/* iPhone frame */}
                          <div
                            className="relative"
                            style={{
                              width: 220, height: 476,
                              filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.18)) drop-shadow(0 12px 24px rgba(0,0,0,0.12)) drop-shadow(0 24px 48px rgba(0,0,0,0.08))",
                            }}
                          >
                            {/* Side buttons */}
                            <div className="absolute -left-[3px] top-[74px] w-[3px] h-[15px] rounded-l-[1.5px]" style={{ background: "linear-gradient(180deg, #48484a, #2c2c2e)" }} />
                            <div className="absolute -left-[3px] top-[103px] w-[3px] h-[19px] rounded-l-[1.5px]" style={{ background: "linear-gradient(180deg, #48484a, #2c2c2e)" }} />
                            <div className="absolute -left-[3px] top-[127px] w-[3px] h-[19px] rounded-l-[1.5px]" style={{ background: "linear-gradient(180deg, #48484a, #2c2c2e)" }} />
                            <div className="absolute -right-[3px] top-[112px] w-[3px] h-[23px] rounded-r-[1.5px]" style={{ background: "linear-gradient(180deg, #48484a, #2c2c2e)" }} />

                            {/* Titanium frame */}
                            <div
                              className="relative w-full h-full rounded-[28px] p-[2.5px]"
                              style={{
                                background: "linear-gradient(170deg, #48484a 0%, #3a3a3c 15%, #2c2c2e 40%, #1c1c1e 60%, #2c2c2e 80%, #3a3a3c 100%)",
                                boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.06), inset 0 -1px 0 0 rgba(255,255,255,0.03)",
                              }}
                            >
                              <div className="relative w-full h-full rounded-[26px] border-[1px] border-[#050505] bg-black overflow-hidden">
                                {/* Dynamic Island */}
                                <div className="absolute top-[6px] left-1/2 -translate-x-1/2 z-20">
                                  <div className="w-[62px] h-[18px] bg-black rounded-full" style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.06)" }}>
                                    <div className="absolute right-[13px] top-1/2 -translate-y-1/2 w-[5px] h-[5px] rounded-full bg-[#0a0a14]" />
                                  </div>
                                </div>

                                {/* Glass reflection */}
                                <div className="absolute inset-0 rounded-[24px] z-30 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, transparent 50%)" }} />

                                {/* Screen */}
                                <div className="w-full h-full rounded-[24px] overflow-hidden bg-black flex flex-col" style={{ fontFamily: "-apple-system, 'Hiragino Sans', sans-serif" }}>
                                  {/* Status Bar */}
                                  <div className="relative flex items-center justify-between px-[16px] h-[24px] shrink-0">
                                    <span className="text-[8px] font-semibold text-white tabular-nums tracking-tight" style={{ marginTop: 10 }}>9:41</span>
                                    <div className="flex items-center gap-[2.5px]" style={{ marginTop: 10 }}>
                                      <svg width="12" height="7" viewBox="0 0 12 7" fill="none">
                                        <rect x="0" y="5" width="2" height="2" rx="0.4" fill="white"/>
                                        <rect x="2.8" y="3.5" width="2" height="3.5" rx="0.4" fill="white"/>
                                        <rect x="5.6" y="1.8" width="2" height="5.2" rx="0.4" fill="white"/>
                                        <rect x="8.4" y="0" width="2" height="7" rx="0.4" fill="white"/>
                                      </svg>
                                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                        <path d="M5 7.5a0.7 0.7 0 1 0 0-1.4 0.7 0.7 0 0 0 0 1.4Z" fill="white"/>
                                        <path d="M3.2 5.6a2.5 2.5 0 0 1 3.6 0" stroke="white" strokeWidth="1.1" strokeLinecap="round"/>
                                        <path d="M1.5 3.8a4.9 4.9 0 0 1 7 0" stroke="white" strokeWidth="1.1" strokeLinecap="round"/>
                                      </svg>
                                      <svg width="16" height="8" viewBox="0 0 16 8" fill="none">
                                        <rect x="0.5" y="0.5" width="12" height="7" rx="2.2" stroke="white" strokeWidth="0.8" opacity="0.4"/>
                                        <rect x="1.5" y="1.5" width="10" height="5" rx="1.2" fill="white"/>
                                        <path d="M13.5 2.8v2.4a1 1 0 0 0 0-2.4Z" fill="white" opacity="0.4"/>
                                      </svg>
                                    </div>
                                  </div>

                                  {/* Search Header */}
                                  <div className="flex items-center gap-[4px] px-[6px] pb-[3px] shrink-0">
                                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0">
                                      <path d="M7 1.5L3 5L7 8.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                    <div className="flex-1 flex items-center gap-[4px] bg-[#262626] rounded-full px-[7px] py-[4px]">
                                      <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="shrink-0">
                                        <circle cx="4" cy="4" r="2.8" stroke="#777" strokeWidth="0.9"/>
                                        <path d="M6 6L8 8" stroke="#777" strokeWidth="0.9" strokeLinecap="round"/>
                                      </svg>
                                      <span className="text-[8px] text-white truncate leading-none flex-1">{job.keyword || ""}</span>
                                    </div>
                                    <span className="text-[8px] text-white font-medium shrink-0 pr-[1px]">検索</span>
                                  </div>

                                  {/* Tabs */}
                                  <div className="flex items-end shrink-0 border-b border-[#1a1a1a] py-[3px]">
                                    {["トップ", "動画", "ユーザー", "サウンド", "LIVE"].map((tab) => {
                                      const isActive = tab === "動画";
                                      return (
                                        <div key={tab} className="flex-1 flex flex-col items-center gap-[2px]" style={{ minWidth: 0 }}>
                                          <span className={`text-[7.5px] whitespace-nowrap ${isActive ? "text-white font-bold" : "text-[#808080] font-medium"}`}>{tab}</span>
                                          {isActive && <div className="w-[14px] h-[2px] bg-white rounded-full" />}
                                        </div>
                                      );
                                    })}
                                  </div>

                                  {/* Filter chips */}
                                  <div className="flex items-center gap-[3px] px-[4px] py-[3px] shrink-0">
                                    {["関連度順", "いいね数順", "最新順"].map((chip, ci) => (
                                      <div key={chip} className={`px-[7px] py-[2.5px] rounded-full text-[5.5px] ${ci === 0 ? "bg-white text-black font-semibold" : "bg-[#262626] text-[#d0d0d0]"}`}>
                                        {chip}
                                      </div>
                                    ))}
                                  </div>

                                  {/* Video Grid */}
                                  <div className="flex-1 relative bg-[#080808] overflow-hidden">
                                    <div className="absolute inset-0 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
                                      <div className="grid grid-cols-3 gap-[1.5px]">
                                        {sessionVideos.map((result: any, vi: number) => {
                                          const videoId = result.videoId || result.video_id;
                                          const video = videoMap.get(videoId);
                                          const ri = rankInfo[videoId];
                                          const count = ri?.appearanceCount ?? 0;
                                          const isAllSessions = count >= numSessions;
                                          const isTwoSessions = count >= 2 && !isAllSessions;
                                          const thumb = video?.thumbnailUrl || result.cover_url || result.thumbnailUrl;
                                          const views = video?.viewCount || result.view_count || 0;
                                          const borderColor = isAllSessions ? "#eab308" : isTwoSessions ? "#3b82f6" : "transparent";
                                          return (
                                            <div
                                              key={vi}
                                              className="relative aspect-[9/14] overflow-visible"
                                              style={isAllSessions || isTwoSessions ? {
                                                zIndex: 2,
                                                boxShadow: `0 0 0 1.5px ${borderColor}, 0 0 6px 1px ${borderColor}66`,
                                              } : undefined}
                                            >
                                              <div className="w-full h-full overflow-hidden">
                                                {thumb ? (
                                                  <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                                                ) : (
                                                  <div className="w-full h-full bg-gradient-to-br from-[#222] to-[#0a0a0a]" />
                                                )}
                                              </div>
                                              <div className="absolute bottom-0 inset-x-0 h-[40%] bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
                                              <div className="absolute bottom-[2px] left-[2px] flex items-center gap-[1px]">
                                                <svg width="5" height="5" viewBox="0 0 5 5" fill="white" opacity="0.9"><path d="M1.2 0.8 L4.2 2.5 L1.2 4.2 Z" /></svg>
                                                <span className="text-[5px] text-white font-medium leading-none" style={{ textShadow: "0 0.5px 2px rgba(0,0,0,0.9)" }}>
                                                  {formatNumber(views)}
                                                </span>
                                              </div>
                                              {vi < 3 && (
                                                <div className="absolute top-[1.5px] left-[1.5px] min-w-[9px] h-[9px] rounded-[1.5px] flex items-center justify-center px-[1.5px] bg-[#fe2c55]/90">
                                                  <span className="text-[5.5px] text-white font-bold leading-none">{vi + 1}</span>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                    <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-black to-transparent pointer-events-none z-10" />
                                  </div>

                                  {/* Bottom Nav */}
                                  <div className="flex items-center justify-around px-1 pt-[4px] pb-[2px] bg-black shrink-0">
                                    <div className="flex flex-col items-center gap-[1px]">
                                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 5.5L6 1.5L10.5 5.5V10.5H7.5V7.5H4.5V10.5H1.5V5.5Z" fill="white" opacity="0.6"/></svg>
                                      <span className="text-[4.5px] text-[#8a8a8a]">ホーム</span>
                                    </div>
                                    <div className="flex flex-col items-center gap-[1px]">
                                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="5" cy="4" r="2.2" stroke="white" strokeWidth="0.8" opacity="0.6"/><path d="M1 10.5c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="white" strokeWidth="0.8" opacity="0.6"/></svg>
                                      <span className="text-[4.5px] text-[#8a8a8a]">友達</span>
                                    </div>
                                    <div className="flex flex-col items-center">
                                      <div className="relative w-[24px] h-[14px]">
                                        <div className="absolute left-[1px] top-[1px] w-[20px] h-[12px] rounded-[3px] bg-[#25f4ee]" />
                                        <div className="absolute right-[1px] top-[1px] w-[20px] h-[12px] rounded-[3px] bg-[#fe2c55]" />
                                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[20px] h-[12px] rounded-[3px] bg-white flex items-center justify-center">
                                          <svg width="7" height="7" viewBox="0 0 7 7" fill="none"><path d="M3.5 1.2V5.8M1.2 3.5H5.8" stroke="black" strokeWidth="1.3" strokeLinecap="round"/></svg>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex flex-col items-center gap-[1px]">
                                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2.5h8a1 1 0 011 1v4.5a1 1 0 01-1 1H6L3.5 10.5V9H2a1 1 0 01-1-1V3.5a1 1 0 011-1z" stroke="white" strokeWidth="0.8" opacity="0.6"/></svg>
                                      <span className="text-[4.5px] text-[#8a8a8a]">受信箱</span>
                                    </div>
                                    <div className="flex flex-col items-center gap-[1px]">
                                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="4" r="2.2" stroke="white" strokeWidth="0.8" opacity="0.6"/><path d="M1.5 11c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5" stroke="white" strokeWidth="0.8" opacity="0.6"/></svg>
                                      <span className="text-[4.5px] text-[#8a8a8a]">プロフィール</span>
                                    </div>
                                  </div>

                                  {/* Home indicator */}
                                  <div className="flex justify-center pt-[2px] pb-[4px] bg-black">
                                    <div className="w-[38%] h-[2.5px] bg-white/40 rounded-full" />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Legend */}
                  <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm border-2 border-yellow-500" /> 全セッション出現</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm border-2 border-blue-500" /> 2セッション出現</span>
                  </div>
                </CardContent>
              </Card>
            );
          })()}


          {/* ===== 2. パターン戦略ガイド（勝ち + 負け統合） with Thumbnail Reel ===== */}
          {tripleSearch && (tripleSearch.commonalityAnalysis || tripleSearch.losePatternAnalysis) && job.status === "completed" && (
            <Card id="patterns" className="bg-card/60 backdrop-blur-sm">
              <CardHeader>
                <h2 className="text-xl leading-tight uppercase tracking-wider flex items-center gap-2" style={{ fontFamily: "'Space Mono', 'JetBrains Mono', monospace" }}>
                  パターン
                </h2>
              </CardHeader>
              <CardContent>
                {/* Phase 2: Win Pattern Thumbnail Reel */}
                {(() => {
                  const rankInfo = (tripleSearch as any)?.rankInfo ?? {};
                  const reelVideos = videos
                    .filter((v: any) => {
                      const ri = rankInfo[v.videoId];
                      return ri && ri.appearanceCount >= numSessions;
                    })
                    .sort((a: any, b: any) => (rankInfo[b.videoId]?.dominanceScore ?? 0) - (rankInfo[a.videoId]?.dominanceScore ?? 0))
                    .slice(0, 5);
                  if (reelVideos.length === 0) return null;
                  return (
                    <div className="mb-6">
                      <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider" style={{ fontFamily: "'Space Mono', monospace" }}>全セッション出現動画</p>
                      <div className="flex overflow-x-auto gap-3 pb-2 no-scrollbar">
                        {reelVideos.map((video: any) => (
                          <a
                            key={video.videoId}
                            href={video.videoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 w-[120px] group"
                          >
                            <div className="relative aspect-[9/16] rounded-lg overflow-hidden bg-muted border border-border/60 group-hover:border-primary/40 transition-all" style={{ transition: `all var(--md-dur-medium2) var(--md-ease-emphasized-decel)` }}>
                              <img
                                src={video.thumbnailUrl || "https://placehold.co/120x213/1a1a1a/666?text=No+Image"}
                                alt={video.title || ""}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                                {video.duration && (
                                  <span className="text-[10px] text-white/80 font-mono">{video.duration}秒</span>
                                )}
                              </div>
                              <div className="absolute top-1.5 right-1.5">
                                <Badge className="text-[9px] bg-black/60 text-white border-0">
                                  ER {getEngagementRate(video).toFixed(1)}%
                                </Badge>
                              </div>
                            </div>
                            <div className="mt-1.5 space-y-0.5">
                              <p className="text-xs text-muted-foreground flex items-center gap-0.5" style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>
                                <Eye className="h-3 w-3" />{formatNumber(video.viewCount)}
                              </p>
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Pattern content (win+lose integrated, from Beta) */}
                {(tripleSearch.commonalityAnalysisAd || tripleSearch.losePatternAnalysisAd) ? (
                  <Tabs defaultValue="organic" className="w-full">
                    <TabsList className="grid w-full grid-cols-2 mb-4">
                      <TabsTrigger value="organic">オーガニック</TabsTrigger>
                      <TabsTrigger value="ad" className="flex items-center gap-1">
                        <Megaphone className="h-3 w-3" />Ad投稿
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="organic" className="space-y-0">
                      {tripleSearch.commonalityAnalysis && (
                        <WinPatternContent analysis={tripleSearch.commonalityAnalysis} />
                      )}
                    </TabsContent>
                    <TabsContent value="ad" className="space-y-0">
                      {tripleSearch.commonalityAnalysisAd && (
                        <WinPatternContent analysis={tripleSearch.commonalityAnalysisAd} />
                      )}
                    </TabsContent>
                  </Tabs>
                ) : (
                  <Accordion type="multiple" defaultValue={["win", "lose"]}>
                    {tripleSearch.commonalityAnalysis && (
                      <AccordionItem value="win" className="border-0">
                        <AccordionTrigger className="px-4 py-3 rounded-lg bg-muted/50 border-l-4 border-primary hover:no-underline hover:bg-muted/70">
                          <span className="flex items-center gap-2 font-semibold text-foreground">
                            <Star className="h-4 w-4" />勝ちパターン戦略
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="pt-3 pb-4">
                          <WinPatternContent analysis={tripleSearch.commonalityAnalysis} />
                        </AccordionContent>
                      </AccordionItem>
                    )}
                  </Accordion>
                )}
              </CardContent>
            </Card>
          )}

          {/* ===== 3. 制作ブリーフ ===== */}
          {tripleSearch && job.status === "completed" && (
            <Card id="brief" className="bg-card/60 backdrop-blur-sm border-l-4 border-primary">
              <CardHeader>
                <h2 className="text-xl leading-tight uppercase tracking-wider flex items-center gap-2" style={{ fontFamily: "'Space Mono', 'JetBrains Mono', monospace" }}>
                  <FileText className="h-5 w-5" />
                  ブリーフ
                </h2>
              </CardHeader>
              <CardContent>
                <ProductionBrief
                  brief={(data.report as any)?.productionBrief ?? null}
                  onGenerate={() => {
                    generateBrief.mutate({ jobId });
                  }}
                  isGenerating={generateBrief.isPending}
                />
              </CardContent>
            </Card>
          )}



          {/* ===== 5. 評判分析 ===== */}
          {reportStats && job.status === "completed" && (
            <Card id="reputation" className="bg-card/60 backdrop-blur-sm">
              <CardHeader>
                <h2 className="text-xl leading-tight uppercase tracking-wider" style={{ fontFamily: "'Space Mono', 'JetBrains Mono', monospace" }}>評判分析</h2>
              </CardHeader>
              <CardContent className="space-y-8">
                {/* センチメント構成比 */}
                <div>
                  <h3 className="text-sm font-semibold mb-4 uppercase tracking-wider" style={{ fontFamily: "'Space Mono', monospace" }}>センチメント構成比</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                    <div className="relative min-w-0">
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
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center">
                          <div className="text-3xl font-bold leading-none" style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>
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

                    <div className="space-y-3">
                      {([
                        {
                          label: "Positive", count: reportStats.sentimentCounts.positive,
                          pct: reportStats.sentimentPercentages.positive,
                          border: "border-green-500/30", bg: "bg-green-500/5",
                          numCls: "text-green-700", pctCls: "text-green-500",
                          bar: "bg-green-500",
                        },
                        {
                          label: "Neutral", count: reportStats.sentimentCounts.neutral,
                          pct: reportStats.sentimentPercentages.neutral,
                          border: "border-border", bg: "bg-muted/30",
                          numCls: "text-muted-foreground", pctCls: "text-muted-foreground",
                          bar: "bg-gray-400",
                        },
                        {
                          label: "Negative", count: reportStats.sentimentCounts.negative,
                          pct: reportStats.sentimentPercentages.negative,
                          border: "border-red-500/30", bg: "bg-red-500/5",
                          numCls: "text-red-700", pctCls: "text-red-500",
                          bar: "bg-red-500",
                        },
                      ] as const).map(row => (
                        <div key={row.label} className={`p-4 rounded-xl border ${row.border} ${row.bg}`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className={`text-xs font-bold uppercase tracking-wider ${row.numCls}`} style={{ fontFamily: "'Space Mono', monospace" }}>{row.label}</span>
                            <span className={`text-2xl font-black ${row.pctCls}`} style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>{row.pct}%</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-xl font-bold ${row.numCls}`} style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>{row.count}<span className="text-xs font-normal ml-1">本</span></span>
                            <div className="flex-1 h-2 bg-white/60 rounded-full overflow-hidden">
                              <div className={`h-full ${row.bar} rounded-full`} style={{ width: `${row.pct}%`, transition: `width 700ms var(--md-ease-emphasized-decel)` }} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ファセット分析 */}
                {data && data.report?.facets && data.report.facets.length > 0 && (
                  <FacetAnalysis facets={(data.report.facets as any[]).map((f: any) => ({
                    aspect: f.aspect || f.name || "",
                    positive_percentage: f.positive_percentage || f.pos || 0,
                    negative_percentage: f.negative_percentage || f.neg || 0,
                  }))} />
                )}
              </CardContent>
            </Card>
          )}

          {/* ===== 6. 投稿最適化 ===== */}
          {data?.videos && data.videos.length > 0 && job.status === "completed" && (
            <Card id="optimization" className="bg-card/60 backdrop-blur-sm">
              <CardHeader>
                <h2 className="text-xl leading-tight uppercase tracking-wider" style={{ fontFamily: "'Space Mono', 'JetBrains Mono', monospace" }}>投稿最適化</h2>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="heatmap" className="w-full">
                  <TabsList className="w-full">
                    <TabsTrigger value="heatmap" className="flex-1 text-xs">投稿ヒートマップ</TabsTrigger>
                    <TabsTrigger value="duration" className="flex-1 text-xs">動画尺 x 再生数</TabsTrigger>
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
              </CardContent>
            </Card>
          )}


          {/* ===== 7. データ付録 ===== */}
          {reportStats && job.status === "completed" && (
            <Card id="data" className="bg-card/60 backdrop-blur-sm">
              <CardHeader>
                <h2 className="text-xl leading-tight uppercase tracking-wider" style={{ fontFamily: "'Space Mono', 'JetBrains Mono', monospace" }}>データ付録</h2>
              </CardHeader>
              <CardContent>
                <Accordion type="multiple" className="space-y-2">

                  {/* 重複度分析 */}
                  {tripleSearch && (
                    <AccordionItem value="overlap" className="border rounded-xl">
                      <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/40 font-semibold text-sm">
                        重複度分析
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4 space-y-6">
                        {/* 検索結果サマリー */}
                        <div className={`grid gap-3 max-w-2xl mx-auto`} style={{ gridTemplateColumns: `repeat(${Math.min(tripleSearch.searches.length, 5)}, 1fr)` }}>
                          {tripleSearch.searches.map((search: any, i: number) => (
                            <div key={i} className="text-center p-3 bg-muted/50 rounded-lg">
                              <div className="text-sm font-medium mb-1">アカウント {i + 1}</div>
                              <div className="text-2xl font-bold" style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>{search.totalFetched}</div>
                              <div className="text-xs text-muted-foreground">件取得</div>
                            </div>
                          ))}
                        </div>

                        {/* 重複度分析結果 */}
                        <div className={`grid gap-3 max-w-2xl mx-auto`} style={{ gridTemplateColumns: `repeat(${Math.min(numSessions, 5)}, 1fr)` }}>
                          {Array.from({ length: numSessions }, (_, i) => {
                            const count = numSessions - i;
                            const ids = appearanceCountMap[count] ?? [];
                            const isAll = count === numSessions;
                            const isOne = count === 1;
                            const Icon = isAll ? Star : isOne ? Search : Repeat;
                            const label = isAll ? `${count}回全出現` : count === 1 ? "1回のみ" : `${count}回出現`;
                            const sublabel = isAll ? "(勝ちパターン)" : isOne ? "(パーソナライズ)" : "(準勝ち)";
                            return (
                              <div key={count} className="text-center p-3 rounded-lg bg-muted/50 border border-border/60">
                                <Icon className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                                <div className="text-2xl font-bold" style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>{ids.length}</div>
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
                                const label = isAll ? `${count}回出現` : count === 1 ? "1回のみ" : `${count}回出現`;
                                return (
                                  <div key={count} className="p-3 rounded-lg border border-border/60 bg-card/40">
                                    <div className="text-xs font-bold mb-2 text-muted-foreground">{label}（{stats.count}件）</div>
                                    <div className="space-y-1.5 text-xs">
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">平均再生数</span>
                                        <span className="font-semibold" style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>{formatNumber(Math.round(stats.avgViews))}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">平均ER%</span>
                                        <span className="font-semibold" style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>{stats.avgEngagementRate.toFixed(2)}%</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">平均スコア</span>
                                        <span className="font-semibold" style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>{stats.avgScore.toFixed(0)}</span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* 重複率サマリー */}
                        <div className="p-4 bg-muted/40 border-l-4 border-primary rounded space-y-3">
                          <p className="text-sm">
                            <strong>重複率 {tripleSearch.duplicateAnalysis.overlapRate.toFixed(1)}%</strong> - 
                            {tripleSearch.duplicateAnalysis.overlapRate >= 80 
                              ? "非常に高い重複率です。TikTokのアルゴリズムがこのキーワードに対して一貫した検索結果を返しており、上位表示動画は安定しています。"
                              : tripleSearch.duplicateAnalysis.overlapRate >= 50
                              ? "中程度の重複率です。一部の動画はアルゴリズムにより安定的に上位表示されていますが、パーソナライズの影響も見られます。"
                              : "低い重複率です。パーソナライズの影響が大きく、ユーザーごとに異なる検索結果が表示される傾向があります。"
                            }
                          </p>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {/* マクロ分析 */}
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
                          videoMetaKeywords={(data.report as any)?.videoMetaKeywords ?? undefined}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {/* ミクロ分析 */}
                  {data && data.report && (
                    <AccordionItem value="micro-analysis" className="border rounded-xl">
                      <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/40 font-semibold text-sm">
                        動画ミクロ分析
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4 pt-2">
                        <Tabs defaultValue="insights" className="w-full">
                          <TabsList className="w-full mb-3">
                            <TabsTrigger value="insights" className="flex-1 text-xs">マーケティング施策</TabsTrigger>
                            <TabsTrigger value="seo-keywords" className="flex-1 text-xs">SEOメタキーワード</TabsTrigger>
                          </TabsList>
                          <TabsContent value="insights">
                            <MicroAnalysisSection
                              proposals={(data.report?.keyInsights as Array<{ category: string; title: string; description: string; analysis?: string; strategicAdvice?: string; sourceVideoIds?: string[] }> || []).map(insight => {
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
                          </TabsContent>
                          <TabsContent value="seo-keywords">
                            <SeoMetaKeywordsSection videoMetaKeywords={(data.report as any)?.videoMetaKeywords ?? undefined} />
                          </TabsContent>
                        </Tabs>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {/* エンゲージメント詳細 */}
                  <AccordionItem value="engagement-detail" className="border rounded-xl">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/40 font-semibold text-sm">
                      エンゲージメント詳細（内訳 / 平均動画時間 / ハッシュタグ）
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4">
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
                            <div key={key} className="p-3 border border-border/60 rounded-lg">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium">{icon} {label}</span>
                                <span className="text-xs text-muted-foreground" style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>合計 {formatNumber(d.total)}</span>
                              </div>
                              <div className="flex h-2.5 rounded-full overflow-hidden">
                                <div style={{ width: `${posShare}%` }} className="bg-green-500" title={`Positive: ${formatNumber(d.pos)}`} />
                                <div style={{ width: `${100 - posShare}%` }} className="bg-red-400" title={`Negative: ${formatNumber(d.neg)}`} />
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
                      <div className="p-4 border border-border/60 rounded-lg mt-4">
                        <h4 className="font-semibold mb-3 text-xs text-muted-foreground uppercase tracking-wide" style={{ fontFamily: "'Space Mono', monospace" }}>平均動画時間（秒）</h4>
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
                                    <span className="font-bold text-xs" style={{ fontFamily: "'JetBrains Mono', monospace", fontFeatureSettings: '"tnum"' }}>{val > 0 ? `${Math.round(val)}秒` : "—"}</span>
                                  </div>
                                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                                    <div className={`h-full ${color} rounded-full`} style={{ width: `${(val / maxDur) * 100}%`, transition: `width 700ms var(--md-ease-emphasized-decel)` }} />
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
                          <h4 className="font-semibold mb-3 text-xs text-muted-foreground uppercase tracking-wide" style={{ fontFamily: "'Space Mono', monospace" }}># ハッシュタグ Top5（Positive / Negative）</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-3 border rounded-lg border-green-500/20 bg-green-500/5">
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
                            <div className="p-3 border rounded-lg border-red-500/20 bg-red-500/5">
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

                  {/* アカウント分析 */}
                  {data?.videos && data.videos.length > 0 && (
                    <AccordionItem value="account-analysis" className="border rounded-xl">
                      <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/40 font-semibold text-sm">
                        アカウント別分析
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4">
                        <AccountAnalysis videos={data.videos as any} rankInfo={(data?.tripleSearch as any)?.rankInfo} numSessions={numSessions} />
                      </AccordionContent>
                    </AccordionItem>
                  )}

                </Accordion>
              </CardContent>
            </Card>
          )}


          {/* ===== 8. 動画一覧 (Phase 3: Card Grid) ===== */}
          {videos.length > 0 && job.status === "completed" ? (
            <Card id="videos" className="bg-card/60 backdrop-blur-sm">
              <CardHeader>
                <h2 className="text-xl leading-tight uppercase tracking-wider" style={{ fontFamily: "'Space Mono', 'JetBrains Mono', monospace" }}>
                  動画一覧 ({videos.length}件)
                </h2>
                <CardDescription>
                  {tripleSearch 
                    ? `${numSessions}シークレットブラウザ検索での出現回数別に分類` 
                    : "収集された動画の詳細分析結果"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* ソートコントロール */}
                <div className="flex flex-wrap items-center gap-2 mb-4 pb-4 border-b border-border/60">
                  <span className="text-xs text-muted-foreground font-medium">並び順:</span>
                  {[
                    { key: "dominance", label: "安定順位順" },
                    { key: "views", label: "再生数順" },
                    { key: "engagementRate", label: "ER率順" },
                    { key: "sentiment", label: "ポジネガ順" },
                    { key: "promotion", label: "広告順" },
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
                      const vids = sortedCategorizedVideos[c] ?? [];
                      return (
                        <TabsContent key={c} value={`count-${c}`}>
                          {renderVideoGrid(vids, true)}
                        </TabsContent>
                      );
                    })}
                    <TabsContent value="all">
                      {renderVideoGrid(sortedVideos, true)}
                    </TabsContent>
                  </Tabs>
                ) : (
                  renderVideoGrid(sortedVideos, false)
                )}
              </CardContent>
            </Card>
          ) : videos.length === 0 && job.status === "completed" && (
            <Card className="bg-card/60 backdrop-blur-sm">
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">動画データがありません</p>
              </CardContent>
            </Card>
          )}
        </div>
    </DashboardLayout>
  );
}
