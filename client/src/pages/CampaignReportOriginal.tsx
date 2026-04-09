import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ArrowLeft, Download, RefreshCw, TrendingUp, TrendingDown, Minus, Crown, Star, Brain, Search, Eye, BarChart3, Users, Hash, Share2, Globe, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Heart, MessageCircle, Bookmark, ExternalLink, CalendarDays, Pencil, Check, Loader2, Layers, Sparkles, Trophy, AlertTriangle, Play, ArrowUpDown, FileDown, Filter, Link2, Copy, CheckCheck, Music, Target } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { Fragment, useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, LineChart, Line, ReferenceLine, ReferenceArea, Cell, AreaChart, Area, ComposedChart } from "recharts";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { analyzeSentiment } from "@shared/sentiment";

// ============================
// Utilities
// ============================

function fmt(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function ChangeIndicator({ value, suffix = "", inverse = false }: { value: number | null | undefined; suffix?: string; inverse?: boolean }) {
  if (value == null) return <span className="text-muted-foreground">-</span>;
  const isPositive = inverse ? value < 0 : value > 0;
  const isNegative = inverse ? value > 0 : value < 0;
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${isPositive ? "text-emerald-600" : isNegative ? "text-[#D71921]" : "text-muted-foreground"}`}>
      {isPositive ? <TrendingUp className="h-3.5 w-3.5" /> : isNegative ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
      {value > 0 ? "+" : ""}{value}{suffix}
    </span>
  );
}

function BeforeAfter({ before, after, suffix = "" }: { before: string | number; after: string | number; suffix?: string }) {
  return (
    <span>
      <span className="text-muted-foreground">{before}{suffix}</span>
      <span className="text-foreground mx-1">&rarr;</span>
      <span className="text-foreground font-semibold">{after}{suffix}</span>
    </span>
  );
}

const SENTIMENT_CONFIG = {
  positive: { label: "ポジティブ", color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200", dotColor: "bg-emerald-500", Icon: TrendingUp },
  neutral:  { label: "ナチュラル", color: "text-[#6b7280]", bg: "bg-white/80 border-black/6", dotColor: "bg-[#a3a3a3]", Icon: Minus },
  negative: { label: "ネガティブ", color: "text-[#D71921]", bg: "bg-red-50 border-[#D71921]/30", dotColor: "bg-[#D71921]", Icon: TrendingDown },
} as const;

export const gradeColors: Record<string, string> = {
  S: "bg-[#D71921] text-white",
  A: "bg-[#0a0a0a] text-white",
  B: "bg-[#737373] text-white",
  C: "bg-[#a3a3a3] text-[#fafafa]",
  D: "bg-[#d4d4d4] text-[#525252]",
};

export const SECTIONS = [
  { id: "summary", label: "総合", icon: Brain },
  { id: "target", label: "目標達成", icon: Target },
  { id: "platform", label: "全媒体", icon: Layers },
  { id: "videos", label: "施策動画", icon: Play },
  { id: "keyword-sov", label: "順位・シェア", icon: Search },
  { id: "competitor", label: "競合", icon: Users },
  { id: "ripple", label: "波及", icon: Share2 },
  { id: "cross", label: "相関", icon: Globe },
];

// ============================
// Main Component
// ============================

export default function CampaignReport() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const campaignId = parseInt(id || "0");

  const campaignQuery = trpc.campaign.getById.useQuery({ id: campaignId }, { enabled: campaignId > 0 });
  const reportQuery = trpc.campaign.getReport.useQuery({ campaignId }, { enabled: campaignId > 0 });
  const dailyMetricsQuery = trpc.campaign.getDailyMetrics.useQuery({ campaignId }, { enabled: campaignId > 0 });

  const campaign = campaignQuery.data?.campaign;
  const report = reportQuery.data;
  const dailyMetrics = dailyMetricsQuery.data || [];

  const [activeSection, setActiveSection] = useState("summary");
  const [platformTab, setPlatformTab] = useState<"tiktok" | "instagram">("tiktok");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Auto-select platform tab when only one platform has data
  const _vmLen = (report as any)?.videoMetricsReport?.length || 0;
  const _ighLen = ((report as any)?.instagramHashtagReport || []).filter((r: any) => r.topPosts?.length > 0).length;
  useEffect(() => {
    if (_vmLen === 0 && _ighLen > 0) setPlatformTab("instagram");
    else if (_vmLen > 0 && _ighLen === 0) setPlatformTab("tiktok");
  }, [_vmLen, _ighLen]);


  // IntersectionObserver for active section tracking
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 },
    );

    for (const sec of SECTIONS) {
      const el = sectionRefs.current[sec.id];
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [report]);

  const scrollTo = useCallback((sectionId: string) => {
    const el = sectionRefs.current[sectionId];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleCsvExport = async () => {
    try {
      const csv = await (trpc as any).campaign.exportCsv.query({ campaignId });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `campaign_report_${campaignId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSVをダウンロードしました");
    } catch {
      toast.error("CSVエクスポートに失敗しました");
    }
  };

  const regenerateMutation = trpc.campaign.generateReport.useMutation({
    onSuccess: () => {
      toast.success("レポートを再生成しました");
      reportQuery.refetch();
    },
    onError: () => {
      toast.error("レポート再生成に失敗しました");
    },
  });

  const utils = trpc.useUtils();
  const updateSlotMutation = trpc.campaign.updateSovSlot.useMutation({
    onError: () => {
      toast.error("スロット更新に失敗しました");
      reportQuery.refetch();
    },
  });

  const handleSlotUpdate = useCallback((
    keyword: string,
    phase: "before" | "after",
    videoId: string,
    changes: { owner?: string; owner_detail?: string; owner_name?: string; genre?: string; tiktok_labels?: string[] },
  ) => {
    // Optimistic update
    utils.campaign.getReport.setData({ campaignId }, (old: any) => {
      if (!old?.sovReport) return old;
      const sovReport = { ...old.sovReport };
      const kwData = { ...sovReport[keyword] };
      const slotsKey = phase === "before" ? "before_slots" : "after_slots";
      const slots = [...(kwData[slotsKey] || [])];
      const idx = slots.findIndex((s: any) => s.video_id === videoId);
      if (idx === -1) return old;
      const slot = { ...slots[idx], ...changes };
      if (slot.owner !== "own") delete slot.owner_detail;
      if (slot.owner !== "competitor") delete slot.owner_name;
      slots[idx] = slot;
      kwData[slotsKey] = slots;
      // Recalculate counts
      const ownCount = slots.filter((s: any) => s.owner === "own").length;
      kwData[phase] = { ...kwData[phase], own_count: ownCount, total_count: slots.length, percentage: ((ownCount / slots.length) * 100).toFixed(1) };
      sovReport[keyword] = kwData;
      return { ...old, sovReport };
    });

    updateSlotMutation.mutate({
      campaignId,
      keyword,
      videoId,
      phase,
      changes: changes as any,
    });
  }, [campaignId, utils, updateSlotMutation]);

  // IG SOV slot mutation
  const updateIgSlotMutation = trpc.campaign.updateIgSovSlot.useMutation({
    onError: () => {
      toast.error("IG スロット更新に失敗しました");
      reportQuery.refetch();
    },
  });

  const handleIgSlotUpdate = useCallback((
    hashtag: string,
    shortcode: string,
    changes: IgSlotChanges,
  ) => {
    // Optimistic update
    utils.campaign.getReport.setData({ campaignId }, (old: any) => {
      if (!old?.instagramHashtagReport) return old;
      const igReport = [...old.instagramHashtagReport];
      const tagIdx = igReport.findIndex((r: any) => r.hashtag === hashtag);
      if (tagIdx === -1) return old;
      const tagReport = { ...igReport[tagIdx] };
      const posts = [...(tagReport.topPosts || [])];
      const postIdx = posts.findIndex((p: any) => p.shortcode === shortcode);
      if (postIdx === -1) return old;
      const post = { ...posts[postIdx], ...changes, isOwn: changes.owner === "own" };
      if (post.owner !== "own") delete post.owner_detail;
      if (post.owner !== "competitor") delete post.owner_name;
      posts[postIdx] = post;
      tagReport.topPosts = posts;
      tagReport.ownRanks = posts
        .filter((p: any) => p.owner === "own" || (p.owner === undefined && p.isOwn))
        .map((p: any) => p.position);
      igReport[tagIdx] = tagReport;
      return { ...old, instagramHashtagReport: igReport };
    });

    updateIgSlotMutation.mutate({
      campaignId,
      hashtag,
      shortcode,
      changes: changes as any,
    });

    toast.success("スロットを更新しました");
  }, [campaignId, utils, updateIgSlotMutation]);

  // --- 共有リンク ---
  const shareStatusQuery = trpc.campaign.getShareStatus.useQuery(
    { campaignId },
    { enabled: campaignId > 0 },
  );
  const toggleShareMutation = trpc.campaign.toggleShareLink.useMutation({
    onSuccess: () => { shareStatusQuery.refetch(); },
    onError: () => { toast.error("共有リンクの更新に失敗しました"); },
  });
  const [copied, setCopied] = useState(false);
  const shareUrl = shareStatusQuery.data?.token
    ? `${window.location.origin}/share/${shareStatusQuery.data.token}`
    : "";
  const handleCopyShareUrl = useCallback(() => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success("リンクをコピーしました");
    setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

  // --- All hooks MUST be above early returns ---
  const videoMetrics = (report as any)?.videoMetricsReport as any[] | undefined;

  // 施策KW/ハッシュタグに関連するタグのみ表示（日傘等の無関係タグを除外）
  const rawRipple = report?.rippleReport || {};
  const rawCommunityAnalysis = (rawRipple as any)?._communityAnalysis;

  const ripple = useMemo(() => {
    const kws = (campaign?.keywords || []).map((kw: string) => kw.replace(/^#/, "").toLowerCase()).filter(Boolean);
    const name = (campaign?.name || "").toLowerCase();
    const ownIds = (campaign?.ownAccountIds || []).map((id: string) => id.toLowerCase());
    if (kws.length === 0) return rawRipple;
    const filtered: Record<string, any> = {};
    for (const [tag, data] of Object.entries(rawRipple)) {
      if (tag.startsWith("_")) continue; // skip metadata keys
      const lower = tag.toLowerCase();
      const relevant = kws.some(kw => lower.includes(kw) || kw.includes(lower))
        || (name && (lower.includes(name) || name.includes(lower)))
        || ownIds.some(id => lower.includes(id) || id.includes(lower));
      if (relevant) filtered[tag] = data;
    }
    return Object.keys(filtered).length > 0 ? filtered : rawRipple;
  }, [rawRipple, campaign]);

  // 施策期間のデフォルト値（動画投稿日から算出）
  const defaultStart = useMemo(() => {
    if (videoMetrics && videoMetrics.length > 0) {
      const dates = videoMetrics.map((v: any) => v.postedAt).filter(Boolean).sort();
      if (dates.length > 0) return dates[0].split("T")[0];
    }
    return report?.baselineDate ? new Date(report.baselineDate).toISOString().split("T")[0] : "";
  }, [videoMetrics, report?.baselineDate]);
  const defaultEnd = useMemo(() => {
    if (videoMetrics && videoMetrics.length > 0) {
      const dates = videoMetrics.map((v: any) => v.postedAt).filter(Boolean).sort();
      if (dates.length > 0) return dates[dates.length - 1].split("T")[0];
    }
    return report?.measurementDate ? new Date(report.measurementDate).toISOString().split("T")[0] : "";
  }, [videoMetrics, report?.measurementDate]);
  const [campaignStart, setCampaignStart] = useState("");
  const [campaignEnd, setCampaignEnd] = useState("");
  useEffect(() => {
    if (defaultStart && !campaignStart) setCampaignStart(defaultStart);
    if (defaultEnd && !campaignEnd) setCampaignEnd(defaultEnd);
  }, [defaultStart, defaultEnd]);

  // 期間内の第三者投稿数
  const thirdPartyInPeriodCount = useMemo(() => {
    if (!ripple) return 0;
    let count = 0;
    for (const [, data] of Object.entries(ripple)) {
      for (const v of ((data as any).third_party_videos || (data as any).omaage_videos || [])) {
        if (v.posted_at && campaignStart && campaignEnd) {
          const d = v.posted_at.split("T")[0];
          if (d >= campaignStart && d <= campaignEnd) { count++; }
        } else {
          count++;
        }
      }
    }
    return count;
  }, [ripple, campaignStart, campaignEnd]);

  // ANIM-02: Section fade-in
  useEffect(() => {
    const fadeObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) entry.target.classList.add("is-visible");
        }
      },
      { threshold: 0.1 },
    );
    const els = document.querySelectorAll(".section-fade-in");
    els.forEach(el => fadeObserver.observe(el));
    return () => fadeObserver.disconnect();
  }, [report]);

  // --- Early returns ---
  if (reportQuery.isLoading) {
    return (
      <DashboardLayout>
        <div className="w-full min-w-0">
          <div className="space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />)}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!report) {
    return (
      <DashboardLayout>
        <div className="w-full min-w-0 text-center py-12">
          <p className="text-muted-foreground">レポートが見つかりません</p>
          <Button variant="link" onClick={() => setLocation(`/campaigns/${campaignId}`)}>キャンペーンに戻る</Button>
        </div>
      </DashboardLayout>
    );
  }

  // --- Derived data (no hooks below here) ---
  const summary = report.summary;
  const positions = report.positionReport || [];
  const compReport = report.competitorReport || {};
  const sovReport = report.sovReport || {};
  const overviewUniqueAll = (sovReport as any)?._overviewUniqueAll as { after: { own: number; total: number }; before: { own: number; total: number } } | undefined;
  const freqReport = report.competitorFrequencyReport || [];
  const crossPlatform = (report as any).crossPlatformData as any | undefined;
  const videoScores = (report as any).videoScores as any[] | undefined;
  const aiReport = (report as any).aiOverallReport as any | undefined;
  const bigKeywordReport = (report as any).bigKeywordReport as Array<{ keyword: string; before: { ownVideoCount: number; bestRank: number | null }; after: { ownVideoCount: number; bestRank: number | null }; competitors?: Array<{ competitor_name: string; competitor_id: string; best_rank: number | null; video_count_in_top30: number; before_best_rank: number | null; before_video_count_in_top30: number; rank_change: number | null }> }> | undefined;

  const platformSummary = (report as any).platformSummary as {
    youtube?: { totalVideos: number; totalViews: number; totalLikes: number; avgER: number; videos: any[] };
    instagram?: { totalVideos: number; totalViews: number; totalThreeSecViews?: number; totalLikes: number; avgER: number; avgRetention3s?: number; videos: any[] };
  } | undefined;

  const keywordSentimentReport = (report as any).keywordSentimentReport as Record<string, { total: number; positive: number; neutral: number; negative: number }> | undefined;

  const instagramHashtagReport = (report as any).instagramHashtagReport as Array<{
    hashtag: string; totalFetched: number; method: string;
    topPosts: Array<{ position: number; shortcode: string; username: string; type: string; likeCount: number; commentCount: number; viewCount: number; caption: string; coverUrl: string; postUrl: string; isOwn: boolean }>;
    ownRanks: number[];
  }> | undefined;

  const hasBaseline = report.baselineDate != null;
  const hasVideoMetrics = videoMetrics && videoMetrics.length > 0;
  const hasCrossPlatform = crossPlatform && (crossPlatform.trendsData?.length > 0 || crossPlatform.videoTimeline?.length > 0);
  const hasBigKW = bigKeywordReport && bigKeywordReport.length > 0;
  const hasCompetitors = campaign?.competitors && campaign.competitors.length > 0;
  const hasYoutube = platformSummary?.youtube && platformSummary.youtube.videos.length > 0;
  const hasInstagram = platformSummary?.instagram && platformSummary.instagram.videos.length > 0;
  const hasMultiPlatform = hasYoutube || hasInstagram;
  const hasAnyPlatformData = hasVideoMetrics || hasYoutube || hasInstagram;
  const hasInstagramHashtag = instagramHashtagReport && instagramHashtagReport.length > 0 && instagramHashtagReport.some(r => r.topPosts.length > 0);

  const hasTargetViews = campaign?.targetViews != null && campaign.targetViews > 0;

  // Filter visible sections
  const visibleSections = SECTIONS.filter(s => {
    if (s.id === "target" && !hasTargetViews) return false;
    if (s.id === "platform" && !hasAnyPlatformData) return false;
    if (s.id === "videos" && !hasVideoMetrics && !hasInstagramHashtag) return false;
    if (s.id === "competitor" && !hasCompetitors) return false;
    if (s.id === "cross" && !hasCrossPlatform) return false;
    return true;
  });
  const sectionNumber = (id: string) => visibleSections.findIndex(s => s.id === id) + 1;

  return (
    <DashboardLayout>
      <div className="bg-background flex flex-col h-full min-w-0 -m-2 md:-m-3 max-w-full overflow-x-hidden">
        {/* Fixed Header + Nav */}
        <div className="shrink-0 bg-card backdrop-blur-xl z-20 border-b border-border min-w-0 max-w-full">
          <div className="px-3 md:px-4 min-w-0 max-w-full">
            {/* Header */}
            <div className="flex items-center justify-between py-2 gap-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground hover:bg-black/4" onClick={() => setLocation(`/campaigns/${campaignId}`)}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
                <div className="min-w-0">
                  <h1 className="text-lg font-bold tracking-[0.08em] leading-tight text-foreground truncate" style={{ fontFamily: '"Space Mono", "JetBrains Mono", monospace' }}>{campaign?.name || "施策効果レポート"}</h1>
                  <p className="text-xs text-muted-foreground font-mono">
                    {report.baselineDate ? new Date(report.baselineDate).toLocaleDateString("ja-JP") : "?"} &rarr; {report.measurementDate ? new Date(report.measurementDate).toLocaleDateString("ja-JP") : "?"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <TrackingToggle campaignId={campaignId} />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => regenerateMutation.mutate({ campaignId })}
                  disabled={regenerateMutation.isPending}
                  className="gap-1.5"
                >
                  <RefreshCw className={`h-4 w-4 ${regenerateMutation.isPending ? "animate-spin" : ""}`} />
                  <span className="hidden lg:inline">{regenerateMutation.isPending ? "再生成中…" : "再生成"}</span>
                </Button>
                <Button variant="outline" size="sm" onClick={handleCsvExport} className="gap-1.5">
                  <Download className="h-4 w-4" />
                  <span className="hidden lg:inline">CSV</span>
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <Link2 className="h-4 w-4" />
                      <span className="hidden lg:inline">共有</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80" align="end">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">公開リンク共有</div>
                    <Switch
                      checked={shareStatusQuery.data?.enabled ?? false}
                      disabled={toggleShareMutation.isPending}
                      onCheckedChange={(checked) =>
                        toggleShareMutation.mutate({ campaignId, enabled: checked })
                      }
                    />
                  </div>
                  {shareStatusQuery.data?.enabled ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        リンクを知っている全員が閲覧できます
                      </p>
                      <div className="flex gap-2">
                        <Input
                          readOnly
                          value={shareUrl}
                          className="text-xs h-8 font-mono"
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-8 px-2 shrink-0"
                          onClick={handleCopyShareUrl}
                        >
                          {copied ? <CheckCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      オンにするとログインなしで閲覧可能なURLを発行します
                    </p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
              </div>
            </div>

            {/* Navigation */}
            <nav className="py-1 overflow-x-auto min-w-0">
              <div className="flex gap-0 min-w-max segment-control">
                {visibleSections.map((sec) => {
                  const Icon = sec.icon;
                  return (
                    <button
                      key={sec.id}
                      onClick={() => scrollTo(sec.id)}
                      className={`flex items-center gap-1 segment-item ${
                        activeSection === sec.id ? "active" : ""
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {sec.label}
                    </button>
                  );
                })}
              </div>
            </nav>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 max-w-full">
          <div className="px-3 md:px-4 space-y-4 pt-4 pb-8 min-w-0 max-w-full">

        {/* Section: Executive Summary */}
        <div id="summary" ref={el => { sectionRefs.current["summary"] = el; }} className="scroll-mt-16 section-fade-in">
          <SectionHeader number={sectionNumber("summary")} title="エグゼクティブサマリー" question="施策は成功したのか？" />
          {aiReport && (
            <Card className="mb-4 relative overflow-hidden">
              <div className="absolute top-3 right-3">
                <Badge variant="outline" className="gap-1 text-[10px] px-2 py-0.5 bg-white/60 backdrop-blur-sm border-border text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  AI Generated
                </Badge>
              </div>
              <CardContent className="py-5 flex items-start gap-4">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0 ring-4 ring-offset-2 ring-offset-white ${gradeColors[aiReport.grade] || gradeColors.C} ${aiReport.grade === "S" ? "ring-[#D71921]" : aiReport.grade === "A" ? "ring-black/20" : aiReport.grade === "B" ? "ring-black/12" : "ring-black/8"}`} style={{ fontFamily: '"Space Mono", monospace' }}>
                  {aiReport.grade}
                </div>
                <p className="text-sm leading-relaxed pt-2 pr-20 text-secondary-foreground">{aiReport.summary}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Section: 目標達成（全媒体再生数） — only shown when targetViews is set */}
        {hasTargetViews && (
          <div id="target" ref={el => { sectionRefs.current["target"] = el; }} className="scroll-mt-16 section-fade-in">
            <SectionHeader number={sectionNumber("target")} title="目標達成（全媒体再生数）" question="目標に対してどれだけ達成できた？" />
            <TargetAchievementSection videoMetrics={videoMetrics} platformSummary={platformSummary} campaign={campaign} dailyMetrics={dailyMetrics} />
          </div>
        )}

        {/* Section: Multi-Platform Summary */}
        {/* Section: All-Platform Summary */}
        {hasAnyPlatformData && (
          <div id="platform" ref={el => { sectionRefs.current["platform"] = el; }} className="scroll-mt-16 section-fade-in">
            <SectionHeader number={sectionNumber("platform")} title="全媒体横断サマリー" question="全プラットフォームの合計は？" />
            <PlatformSummarySection
              tiktokVideos={(videoMetrics || []).filter((v: any) => {
                const url = v.videoUrl || "";
                return !url.includes("instagram.com") && !url.includes("youtube.com") && !url.includes("youtu.be");
              })}
              platformSummary={platformSummary || {}}
              dailyMetrics={dailyMetrics}
              hasBaseline={hasBaseline}
              campaign={campaign}
            />
          </div>
        )}

        {/* Section: 施策動画 (Platform-tabbed: TikTok / Instagram) */}
        {(hasVideoMetrics || hasInstagramHashtag) && (
          <div id="videos" ref={el => { sectionRefs.current["videos"] = el; }} className="scroll-mt-16 section-fade-in">
            <div className="flex items-end justify-between">
              <SectionHeader number={sectionNumber("videos")} title="施策動画パフォーマンス" question={platformTab === "tiktok" ? "TikTok動画の状況は？" : "Instagram投稿の状況は？"} />
              {hasVideoMetrics && hasInstagramHashtag && (
                <PlatformTabSwitcher value={platformTab} onChange={setPlatformTab} />
              )}
            </div>

            {/* TikTok tab */}
            {(platformTab === "tiktok" && hasVideoMetrics) && (
              <>
                <SummaryCards summary={summary} thirdPartyCount={thirdPartyInPeriodCount} hasBaseline={hasBaseline} ripple={ripple} sovReport={sovReport} />
                <div className="mt-5">
                  <VideoSection videos={(videoMetrics || []).filter((v: any) => {
                    const url = v.videoUrl || "";
                    return !url.includes("instagram.com") && !url.includes("youtube.com") && !url.includes("youtu.be");
                  })} videoScores={videoScores} hasBaseline={hasBaseline} dailyMetrics={dailyMetrics} keywords={campaign?.keywords ?? undefined} bigKeywords={campaign?.bigKeywords ?? undefined} />
                </div>
              </>
            )}

            {/* Instagram tab */}
            {(platformTab === "instagram" && hasInstagramHashtag) && (
              <InstagramVideoSection
                instagramHashtagReport={instagramHashtagReport!}
                platformSummary={platformSummary}
                dailyMetrics={dailyMetrics}
              />
            )}

          </div>
        )}

        {/* Section: Keyword + SOV (platform-linked) */}
        <div id="keyword-sov" ref={el => { sectionRefs.current["keyword-sov"] = el; }} className="scroll-mt-16 section-fade-in">
          <div className="flex items-end justify-between">
            <SectionHeader number={sectionNumber("keyword-sov")} title={platformTab === "tiktok" ? "検索順位・上位シェア率" : "ハッシュタグ検索順位"} question={platformTab === "tiktok" ? "検索上位にどの動画が露出した？" : "IG検索でどの位置に表示された？"} />
            {hasVideoMetrics && hasInstagramHashtag && (
              <PlatformTabSwitcher value={platformTab} onChange={setPlatformTab} />
            )}
          </div>

          {/* TikTok SOV */}
          {platformTab === "tiktok" && (
            <UnifiedKeywordSovSection positions={positions} bigKeywordReport={hasBigKW ? bigKeywordReport! : undefined} sovReport={sovReport} hasBaseline={hasBaseline} campaign={campaign} campaignId={campaignId} onSlotUpdate={handleSlotUpdate} overviewUniqueAll={overviewUniqueAll} />
          )}

          {/* Instagram Hashtag Rankings */}
          {platformTab === "instagram" && hasInstagramHashtag && (
            <InstagramHashtagRankingSection instagramHashtagReport={instagramHashtagReport!} campaignId={campaignId} onIgSlotUpdate={handleIgSlotUpdate} />
          )}
        </div>

        {/* Section: Competitor */}
        {hasCompetitors && (
          <div id="competitor" ref={el => { sectionRefs.current["competitor"] = el; }} className="scroll-mt-16 section-fade-in">
            <SectionHeader number={sectionNumber("competitor")} title="競合動向" question="競合と比べてどうだった？" />
            <CompetitorSection compReport={compReport} freqReport={freqReport} bigKeywordReport={bigKeywordReport} hasBaseline={hasBaseline} />
          </div>
        )}

        {/* Section: Ripple */}
        <div id="ripple" ref={el => { sectionRefs.current["ripple"] = el; }} className="scroll-mt-16 section-fade-in">
          <SectionHeader number={sectionNumber("ripple")} title="波及効果・オーガニック拡散" question="オーガニックにも広がった？" />
          <RippleSection ripple={ripple} communityAnalysis={rawCommunityAnalysis} campaign={campaign} campaignId={campaignId} keywordSentimentReport={keywordSentimentReport} />
        </div>

        {/* Section: Cross Platform */}
        {hasCrossPlatform && (
          <div id="cross" ref={el => { sectionRefs.current["cross"] = el; }} className="scroll-mt-16 section-fade-in">
            <SectionHeader number={sectionNumber("cross")} title="クロスプラットフォーム相関" question="検索トレンドとの関係は？" />
            <CrossPlatformSection data={crossPlatform} videoMetrics={videoMetrics} baselineDate={report.baselineDate} measurementDate={report.measurementDate} ripple={ripple} campaignStart={campaignStart} campaignEnd={campaignEnd} />
          </div>
        )}


        {/* Notes */}
        {report.notes && (
          <Card>
            <CardContent className="py-4">
              <ul className="text-xs text-muted-foreground space-y-1">
                {(report.notes as string[]).map((note, i) => (
                  <li key={i}>* {note}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

// ============================
// Section Header
// ============================

export function SectionHeader({ number, title, question }: { number: number; title: string; question: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[#D71921] text-xs font-bold tracking-widest">{String(number).padStart(2, "0")}</span>
        <h2 className="text-sm font-bold tracking-[0.08em] uppercase" style={{ fontFamily: '"Space Mono", "JetBrains Mono", monospace' }}>{title}</h2>
      </div>
      <p className="text-xs text-muted-foreground ml-9 mt-0.5">{question}</p>
    </div>
  );
}

// ============================
// Platform Tab Switcher
// ============================

export function PlatformTabSwitcher({ value, onChange }: { value: "tiktok" | "instagram"; onChange: (v: "tiktok" | "instagram") => void }) {
  return (
    <div className="flex items-center gap-0 rounded-lg border border-black/8 bg-white p-0.5 shrink-0 mb-4">
      <button
        onClick={() => onChange("tiktok")}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
          value === "tiktok"
            ? "bg-[#0a0a0a] text-white shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Music className="h-3 w-3" />
        TikTok
      </button>
      <button
        onClick={() => onChange("instagram")}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
          value === "instagram"
            ? "bg-gradient-to-r from-[#E1306C] to-[#F77737] text-white shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Hash className="h-3 w-3" />
        Instagram
      </button>
    </div>
  );
}

// ============================
// ============================
// Instagram Video Section (TikTokのVideoSectionと同じフォーマット)
// ============================

function InstagramVideoSection({ instagramHashtagReport, platformSummary, dailyMetrics }: {
  instagramHashtagReport: IGHashtagReport;
  platformSummary?: { instagram?: { totalVideos: number; totalViews: number; totalLikes: number; totalComments?: number; avgER: number; avgRetention3s?: number; videos: any[] } };
  dailyMetrics: any[];
}) {
  const igData = platformSummary?.instagram;
  const igVideos = igData?.videos || [];

  // Collect all own posts for hashtag summary (deduplicate by shortcode)
  const allOwnPosts = useMemo(() => {
    const seen = new Set<string>();
    const posts: Array<IGHashtagReport[0]["topPosts"][0] & { hashtag: string }> = [];
    for (const r of instagramHashtagReport) {
      for (const p of r.topPosts) {
        if (!p.isOwn) continue;
        const key = p.shortcode || p.postUrl;
        if (seen.has(key)) continue;
        seen.add(key);
        posts.push({ ...p, hashtag: r.hashtag });
      }
    }
    return posts;
  }, [instagramHashtagReport]);

  // Aggregate IG metrics
  const { totalViews, totalLikes, totalComments, totalThreeSecViews, avgRetention3s, avgEr } = useMemo(() => {
    let views = 0, likes = 0, comments = 0, threeSecViews = 0;
    for (const v of igVideos) {
      views += v.viewCount || 0;
      likes += v.likeCount || 0;
      comments += v.commentCount || 0;
      threeSecViews += (v as any).threeSecViewCount || 0;
    }
    if (igVideos.length === 0 && allOwnPosts.length > 0) {
      for (const p of allOwnPosts) {
        views += p.viewCount || 0;
        likes += p.likeCount || 0;
        comments += p.commentCount || 0;
      }
    }
    const er = views > 0 ? Number(((likes + comments) / views * 100).toFixed(2)) : 0;
    const ret3s = igData?.avgRetention3s ?? (views > 0 ? Number((threeSecViews / views * 100).toFixed(1)) : 0);
    const t3sv = igData?.totalThreeSecViews ?? threeSecViews;
    return { totalViews: views, totalLikes: likes, totalComments: comments, totalThreeSecViews: t3sv, avgRetention3s: ret3s, avgEr: er };
  }, [igVideos, allOwnPosts, igData]);

  const videoCount = igData?.totalVideos || allOwnPosts.length;

  // Hashtag ranking summary for KPI cards
  const hashtagSummary = useMemo(() => {
    let rankedCount = 0;
    let totalRank = 0;
    for (const r of instagramHashtagReport) {
      if (r.ownRanks && r.ownRanks.length > 0) {
        for (const rank of r.ownRanks) {
          rankedCount++;
          totalRank += rank;
        }
      }
    }
    const avgRank = rankedCount > 0 ? Number((totalRank / rankedCount).toFixed(1)) : null;
    const topTagCount = instagramHashtagReport.filter(r => r.ownRanks && r.ownRanks.some(rk => rk <= 10)).length;
    return { rankedCount, avgRank, topTagCount };
  }, [instagramHashtagReport]);

  // ホバー展開管理（タッチデバイスはタップトグル）
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouchRef = useRef(false);

  useEffect(() => {
    isTouchRef.current = window.matchMedia("(hover: none)").matches;
  }, []);

  const handleMouseEnter = useCallback((url: string) => {
    if (isTouchRef.current) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setExpandedCard(url), 150);
  }, []);
  const handleMouseLeave = useCallback(() => {
    if (isTouchRef.current) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setExpandedCard(null), 100);
  }, []);
  const handleTap = useCallback((url: string) => {
    if (!isTouchRef.current) return;
    setExpandedCard(prev => prev === url ? null : url);
  }, []);

  // IG sparkline data from dailyMetrics
  const [sparkMetric, setSparkMetric] = useState<"views" | "likes" | "comments">("views");
  const IG_SPARK_KEY: Record<string, string> = { views: "viewCount", likes: "likeCount", comments: "commentCount" };

  // Extract shortcode from IG URL for dedup (/p/XXX, /reel/XXX → XXX)
  const igShortcode = (url: string) => {
    const m = url.match(/instagram\.com\/(?:p|reel|reels)\/([^/?]+)/);
    return m ? m[1] : url;
  };

  const sparks = useMemo(() => {
    const igMetrics = dailyMetrics.filter((m: any) => m.platform === "instagram");
    if (igMetrics.length === 0) return [];

    // Group by shortcode (not raw URL) to merge /p/ and /reel/ variants
    const byShortcode = new Map<string, { url: string; entries: Map<string, { viewCount: number; likeCount: number; commentCount: number }> }>();
    for (const dm of igMetrics) {
      const url = dm.videoUrl || "";
      if (!url) continue;
      const sc = igShortcode(url);
      if (!byShortcode.has(sc)) byShortcode.set(sc, { url, entries: new Map() });
      const group = byShortcode.get(sc)!;
      const dateKey = dm.dateKey;
      const existing = group.entries.get(dateKey);
      if (existing) {
        // Same shortcode + same date: keep max values
        existing.viewCount = Math.max(existing.viewCount, Number(dm.viewCount) || 0);
        existing.likeCount = Math.max(existing.likeCount, Number(dm.likeCount) || 0);
        existing.commentCount = Math.max(existing.commentCount, Number(dm.commentCount) || 0);
      } else {
        group.entries.set(dateKey, {
          viewCount: Number(dm.viewCount) || 0,
          likeCount: Number(dm.likeCount) || 0,
          commentCount: Number(dm.commentCount) || 0,
        });
      }
    }

    const metricKey = IG_SPARK_KEY[sparkMetric];
    const result: Array<{
      videoUrl: string; username: string; caption: string; fullCaption: string; coverUrl: string; postUrl: string;
      latestVal: number; er: number; data: Array<{ dateKey: string; value: number }>; deltas: Array<{ dateKey: string; value: number }>;
      allMetrics: { viewCount: number; likeCount: number; commentCount: number };
      recentDeltas: Array<{ dateKey: string; views: number; likes: number; comments: number; er: number }>;
      dailyIncrement: { views: number; likes: number; comments: number } | null;
      trendLabel: string;
    }> = [];

    // Post info lookup by shortcode
    const postsByShortcode = new Map<string, { username: string; caption: string; coverUrl: string; postUrl: string }>();
    for (const p of allOwnPosts) {
      const sc = igShortcode(p.postUrl);
      if (!postsByShortcode.has(sc)) {
        postsByShortcode.set(sc, { username: p.username, caption: p.caption || "", coverUrl: p.coverUrl || "", postUrl: p.postUrl });
      }
    }
    for (const v of igVideos) {
      const url = v.videoUrl || "";
      if (!url) continue;
      const sc = igShortcode(url);
      if (!postsByShortcode.has(sc)) {
        postsByShortcode.set(sc, { username: v.ownerUsername || "", caption: v.caption || "", coverUrl: v.coverUrl || "", postUrl: url });
      }
    }

    for (const [sc, group] of byShortcode.entries()) {
      const sorted = [...group.entries.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dateKey, d]) => ({ dateKey, ...d }));
      const vals = sorted.map(d => Number((d as any)[metricKey]) || 0);
      if (vals.length < 2) continue;

      const last = sorted[sorted.length - 1];
      const postInfo = postsByShortcode.get(sc);

      const deltas: Array<{ dateKey: string; value: number }> = [];
      for (let i = 1; i < sorted.length; i++) {
        deltas.push({ dateKey: sorted[i].dateKey, value: Math.max(0, vals[i] - vals[i - 1]) });
      }

      const er = last.viewCount > 0 ? Number(((last.likeCount + last.commentCount) / last.viewCount * 100).toFixed(2)) : 0;

      // 日次増分（直近2日比較）
      let dailyIncrement: { views: number; likes: number; comments: number } | null = null;
      if (sorted.length >= 2) {
        const prev = sorted[sorted.length - 2];
        dailyIncrement = {
          views: last.viewCount - prev.viewCount,
          likes: last.likeCount - prev.likeCount,
          comments: last.commentCount - prev.commentCount,
        };
      }

      // トレンド乖離
      let trendLabel: "急成長" | "安定" | "停滞" | "バイラル" = "安定";
      if (vals.length >= 3) {
        const lastVal = vals[vals.length - 1];
        if (lastVal > 0) {
          const normalized = vals.map((v, i) => ({
            actual: v / lastVal,
            expected: i / (vals.length - 1),
          }));
          const mse = normalized.reduce((sum, d) => sum + Math.pow(d.actual - d.expected, 2), 0) / normalized.length;
          const rmse = Math.sqrt(mse);
          const recentGrowth = vals.length >= 3
            ? (vals[vals.length - 1] - vals[vals.length - 2]) / Math.max(vals[vals.length - 2] - vals[vals.length - 3], 1)
            : 1;
          if (rmse > 0.35 && recentGrowth > 2) trendLabel = "バイラル";
          else if (rmse > 0.2 && recentGrowth > 1.2) trendLabel = "急成長";
          else if (rmse < 0.15 && dailyIncrement && dailyIncrement.views < 10) trendLabel = "停滞";
          else trendLabel = "安定";
        }
      }

      // 直近3日の全メトリクス日次増分
      const recentDeltas: Array<{ dateKey: string; views: number; likes: number; comments: number; er: number }> = [];
      for (let i = Math.max(1, sorted.length - 3); i < sorted.length; i++) {
        const cur = sorted[i];
        const prev = sorted[i - 1];
        const dv = cur.viewCount - prev.viewCount;
        const dl = cur.likeCount - prev.likeCount;
        const dc = cur.commentCount - prev.commentCount;
        const dEr = dv > 0 ? Number(((dl + dc) / dv * 100).toFixed(2)) : 0;
        recentDeltas.push({ dateKey: cur.dateKey, views: Math.max(0, dv), likes: Math.max(0, dl), comments: Math.max(0, dc), er: dEr });
      }

      result.push({
        videoUrl: group.url,
        username: postInfo ? `@${postInfo.username}` : "",
        caption: (postInfo?.caption || "").slice(0, 18),
        fullCaption: postInfo?.caption || "",
        coverUrl: postInfo?.coverUrl || "",
        postUrl: postInfo?.postUrl || group.url,
        latestVal: vals[vals.length - 1],
        er,
        data: sorted.map(d => ({ dateKey: d.dateKey, value: Number((d as any)[metricKey]) || 0 })),
        deltas,
        allMetrics: { viewCount: last.viewCount, likeCount: last.likeCount, commentCount: last.commentCount },
        recentDeltas,
        dailyIncrement,
        trendLabel,
      });
    }

    return result.sort((a, b) => b.latestVal - a.latestVal);
  }, [dailyMetrics, sparkMetric, allOwnPosts, igVideos]);

  const IG_SORT_OPTIONS = [
    { key: "views", label: "再生数" },
    { key: "likes", label: "いいね" },
    { key: "comments", label: "コメント" },
    { key: "er", label: "ER" },
    { key: "date", label: "投稿日" },
  ];
  const [sortBy, setSortBy] = useState("views");

  const sortedSparks = useMemo(() => {
    return [...sparks].sort((a, b) => {
      if (sortBy === "er") return b.er - a.er;
      if (sortBy === "likes") return b.allMetrics.likeCount - a.allMetrics.likeCount;
      if (sortBy === "comments") return b.allMetrics.commentCount - a.allMetrics.commentCount;
      if (sortBy === "date") return b.latestVal - a.latestVal;
      return b.allMetrics.viewCount - a.allMetrics.viewCount;
    });
  }, [sparks, sortBy]);

  const IG_SPARK_LABELS: Record<string, string> = { views: "再生数", likes: "いいね", comments: "コメント" };

  const SPARK_PAGE = 8;
  const [sparkDisplayCount, setSparkDisplayCount] = useState(SPARK_PAGE);
  const visibleSparks = sortedSparks.slice(0, sparkDisplayCount);
  const sparkRemaining = sortedSparks.length - sparkDisplayCount;
  const topVal = sortBy === "er" ? Math.max(...sortedSparks.map(s => s.er), 1) : Math.max(...sortedSparks.map(s => s.latestVal), 1);

  return (
    <div className="space-y-4 min-w-0">
      {/* ── KPI Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card><CardContent className="py-3 px-4 space-y-1">
          <p className="text-xs text-muted-foreground">平均検索順位</p>
          <p className="text-xl font-bold text-foreground font-mono">
            {hashtagSummary.avgRank != null ? `${hashtagSummary.rankedCount}タグ ${hashtagSummary.avgRank}位` : "圏外"}
          </p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4 space-y-1">
          <p className="text-xs text-muted-foreground">平均ER</p>
          <p className="text-xl font-bold text-foreground font-mono">{avgEr}%</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4 space-y-1">
          <p className="text-xs text-muted-foreground">上位表示率</p>
          <p className="text-xl font-bold text-foreground font-mono">{hashtagSummary.topTagCount}タグ</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4 space-y-1">
          <p className="text-xs text-muted-foreground">第三者投稿</p>
          <p className="text-xl font-bold text-foreground font-mono">{allOwnPosts.length}本</p>
        </CardContent></Card>
      </div>

      {/* ── Video Aggregate Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card><CardContent className="py-3 px-4 text-center">
          <p className="text-xs text-muted-foreground">総投稿数</p>
          <p className="text-xl font-bold">{videoCount}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4 text-center">
          <p className="text-xs text-muted-foreground">総再生数</p>
          <p className="text-xl font-bold">{fmt(totalViews)}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4 text-center">
          <p className="text-xs text-muted-foreground">総いいね数</p>
          <p className="text-xl font-bold">{fmt(totalLikes)}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4 text-center">
          <p className="text-xs text-muted-foreground">総コメント数</p>
          <p className="text-xl font-bold">{fmt(totalComments)}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4 text-center">
          <p className="text-xs text-muted-foreground">3秒再生数</p>
          <p className="text-xl font-bold">{totalThreeSecViews > 0 ? fmt(totalThreeSecViews) : "—"}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4 text-center">
          <p className="text-xs text-muted-foreground">平均視聴維持率</p>
          <p className="text-xl font-bold">{avgRetention3s > 0 ? `${avgRetention3s}%` : "—"}</p>
        </CardContent></Card>
      </div>

      {/* ── 投稿パフォーマンス推移 (mini cards — TikTok-matching layout) ── */}
      {sortedSparks.length > 0 && (
        <Card>
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-sm font-semibold">投稿パフォーマンス推移</p>
                <p className="text-[11px] text-muted-foreground">累積推移スパークライン ＋ ホバーで詳細</p>
              </div>
              <div className="flex gap-1 flex-wrap">
                {IG_SORT_OPTIONS.map(opt => (
                  <button key={opt.key} onClick={() => {
                    setSortBy(opt.key);
                    const sparkMap: Record<string, "views" | "likes" | "comments"> = { views: "views", likes: "likes", comments: "comments", er: "views", date: "views" };
                    setSparkMetric(sparkMap[opt.key] || "views");
                  }}
                    className={`px-2 py-1 rounded text-[11px] transition-colors ${sortBy === opt.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {visibleSparks.map((s, idx) => {
                const displayVal = sortBy === "er" ? s.er : s.latestVal;
                const intensity = topVal > 0 ? Math.min(displayVal / topVal, 1) : 0.5;
                const sc = intensity > 0.5 ? "#E1306C" : intensity > 0.2 ? "#C13584" : "#a5b4fc";
                const isExpanded = expandedCard === s.videoUrl;
                const igMetricKeyMap: Record<string, string> = { views: "views", likes: "likes", comments: "comments", er: "er", date: "views" };
                const deltaKey = igMetricKeyMap[sortBy] || "views";
                const recent3 = s.recentDeltas.slice(-3);

                // Sparkline SVG from s.data
                const sparkData = s.data;
                const sparkW = 100;
                const sparkH = 28;
                let sparkPath = "";
                if (sparkData.length >= 2) {
                  const vals = sparkData.map(d => d.value);
                  const minV = Math.min(...vals);
                  const maxV = Math.max(...vals);
                  const range = maxV - minV || 1;
                  const points = vals.map((v, i) => {
                    const x = (i / (vals.length - 1)) * sparkW;
                    const y = sparkH - ((v - minV) / range) * (sparkH - 4) - 2;
                    return `${x},${y}`;
                  });
                  sparkPath = `M${points.join("L")}`;
                }

                const IG_TREND_CONFIG: Record<string, { cls: string; dot: string }> = {
                  "バイラル": { cls: "text-[#D71921] bg-[#D71921]/8", dot: "bg-[#D71921]" },
                  "急成長": { cls: "text-emerald-700 bg-emerald-50", dot: "bg-emerald-500" },
                  "安定": { cls: "text-slate-600 bg-slate-100", dot: "bg-slate-400" },
                  "停滞": { cls: "text-amber-700 bg-amber-50", dot: "bg-amber-500" },
                };

                return (
                  <div key={s.videoUrl || idx}
                    className="post-card"
                    onMouseEnter={() => handleMouseEnter(s.videoUrl)}
                    onMouseLeave={handleMouseLeave}
                    onClick={() => handleTap(s.videoUrl)}
                  >
                    {/* 上部: サムネ + ユーザー名 + 累積値 */}
                    <div className="flex items-start gap-2.5 p-3 pb-1.5">
                      {s.coverUrl ? (
                        <img src={s.coverUrl} alt="" className="w-10 h-14 rounded-md object-cover flex-shrink-0" loading="lazy" />
                      ) : (
                        <div className="w-10 h-14 rounded-md flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-[#E1306C] to-[#F77737]">
                          <Play className="h-3 w-3 text-white/80" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        {s.username && <p className="text-[10px] font-bold text-slate-600 truncate">{s.username}</p>}
                        <p className="text-[10px] text-slate-400 truncate leading-snug">{s.caption || "投稿"}</p>
                        <p className="text-lg font-extrabold tabular-nums text-slate-800 leading-tight mt-0.5">
                          {sortBy === "er" ? `${s.er}%` : sortBy === "date" ? "-" : fmt(s.latestVal)}
                        </p>
                        <p className="text-[9px] text-slate-400 font-medium">
                          {sortBy === "er" ? "ER" : sortBy === "date" ? "投稿日" : IG_SPARK_LABELS[sparkMetric]} (累計)
                        </p>
                      </div>
                    </div>
                    {/* ミニスパークライン（累積推移の折れ線） */}
                    {sparkPath && (
                      <div className="px-3 pb-2 post-card-mini-spark">
                        <svg width="100%" height={sparkH} viewBox={`0 0 ${sparkW} ${sparkH}`} preserveAspectRatio="none" className="overflow-visible">
                          <defs>
                            <linearGradient id={`ig-spark-fill-${idx}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={sc} stopOpacity="0.18" />
                              <stop offset="100%" stopColor={sc} stopOpacity="0.02" />
                            </linearGradient>
                          </defs>
                          <path d={`${sparkPath}L${sparkW},${sparkH}L0,${sparkH}Z`} fill={`url(#ig-spark-fill-${idx})`} />
                          <path d={sparkPath} fill="none" stroke={sc} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    )}
                    {/* コンパクトメトリクス */}
                    <div className="px-3 pb-2 flex items-center gap-2 text-[9px] text-slate-400">
                      <span className="flex items-center gap-0.5"><Eye className="h-2.5 w-2.5" />{fmt(s.allMetrics.viewCount)}</span>
                      <span className="flex items-center gap-0.5"><Heart className="h-2.5 w-2.5" />{fmt(s.allMetrics.likeCount)}</span>
                      <span className="flex items-center gap-0.5"><MessageCircle className="h-2.5 w-2.5" />{fmt(s.allMetrics.commentCount)}</span>
                      <span className="ml-auto font-mono text-[8px]">ER {s.er}%</span>
                    </div>

                    {/* ===== 展開パネル（ホバー） ===== */}
                    <div className={`post-card-expand ${isExpanded ? "is-expanded" : ""}`}>
                      <div className="post-card-expand-inner">
                        <div className="mx-3 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
                        <div className="px-3 pt-2.5 pb-3 space-y-2 bg-gradient-to-b from-muted/20 to-transparent">
                          {s.fullCaption.length > 18 && (() => {
                            const cleaned = s.fullCaption.replace(/#[\w\u3000-\u9FFF\uF900-\uFAFF]+/g, "").trim();
                            return cleaned ? <p className="spark-detail-item text-[10px] text-slate-500 leading-relaxed line-clamp-3">{cleaned}</p> : null;
                          })()}
                          <div className="spark-detail-item grid grid-cols-3 gap-0.5">
                            {([
                              { key: "viewCount", label: "再生", Icon: Eye, inc: s.dailyIncrement?.views },
                              { key: "likeCount", label: "いいね", Icon: Heart, inc: s.dailyIncrement?.likes },
                              { key: "commentCount", label: "コメ", Icon: MessageCircle, inc: s.dailyIncrement?.comments },
                            ] as const).map(m => (
                              <div key={m.key} className="text-center py-1 rounded-sm">
                                <m.Icon className="h-2.5 w-2.5 mx-auto mb-0.5 text-slate-400" />
                                <p className="text-[10px] font-bold tabular-nums text-foreground">{fmt(s.allMetrics[m.key as keyof typeof s.allMetrics])}</p>
                                <p className="text-[7px] text-muted-foreground tracking-wider">{m.label}</p>
                                {m.inc != null && m.inc !== 0 && (
                                  <p className={`text-[8px] font-semibold tabular-nums mt-0.5 ${m.inc > 0 ? "text-emerald-600" : "text-[#D71921]"}`}>
                                    {m.inc > 0 ? "+" : ""}{fmt(m.inc)}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="spark-detail-item flex items-center justify-between pt-1">
                            <span className={`inline-flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-sm ${IG_TREND_CONFIG[s.trendLabel]?.cls || ""}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${IG_TREND_CONFIG[s.trendLabel]?.dot || ""}`} />
                              {s.trendLabel}
                            </span>
                            <a href={s.postUrl} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 text-[8px] text-primary hover:text-primary/80 font-bold transition-colors"
                              onClick={e => e.stopPropagation()}
                            >
                              <ExternalLink className="h-2.5 w-2.5" />投稿を見る
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {sparkRemaining > 0 && (
              <div className="flex justify-center pt-3">
                <button onClick={() => setSparkDisplayCount(prev => prev + SPARK_PAGE)}
                  className="inline-flex items-center gap-1 px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronDown className="h-3.5 w-3.5" />もっと見る（残り{sparkRemaining}件）
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================
// Instagram Post Section (施策動画 IG tab — reels + images + carousels)
// ============================

type IGHashtagReport = Array<{
  hashtag: string; totalFetched: number; method: string;
  topPosts: Array<IGPostData & { caption: string }>;
  ownRanks: number[];
}>;

export function InstagramReelSection({ instagramHashtagReport }: { instagramHashtagReport: IGHashtagReport }) {
  // Collect all own posts across hashtags for a hero summary
  const allOwnPosts = instagramHashtagReport.flatMap(r =>
    r.topPosts.filter(p => p.isOwn).map(p => ({ ...p, hashtag: r.hashtag }))
  );
  const allPosts = instagramHashtagReport.flatMap(r => r.topPosts);
  const avgViews = allPosts.length > 0
    ? Math.round(allPosts.reduce((s, p) => s + p.viewCount, 0) / allPosts.length)
    : 0;

  return (
    <div className="space-y-4 min-w-0">
      {/* Own posts hero */}
      {allOwnPosts.length > 0 && (
        <Card className="border-[#E1306C]/15 bg-gradient-to-r from-[#E1306C]/[0.03] to-[#F77737]/[0.02]">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-3">
              <Star className="h-4 w-4 text-[#E1306C]" />
              <span className="text-xs font-bold text-[#E1306C]">自社投稿パフォーマンス</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {allOwnPosts.map(post => (
                <div key={post.shortcode} className="p-3 rounded-lg bg-card border border-[#E1306C]/10">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-[10px] text-muted-foreground">#{post.hashtag}</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-black tabular-nums" style={{ fontFamily: '"Space Mono", monospace', color: '#E1306C' }}>
                      {fmt(post.viewCount)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">再生</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                      <Heart className="h-2.5 w-2.5" />{fmt(post.likeCount)}
                    </span>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                      <MessageCircle className="h-2.5 w-2.5" />{fmt(post.commentCount)}
                    </span>
                  </div>
                  {avgViews > 0 && post.viewCount > 0 && (
                    <div className="mt-2 pt-2 border-t border-black/[0.04]">
                      <span className={`text-[10px] font-bold ${post.viewCount >= avgViews ? "text-emerald-600" : "text-[#D71921]"}`}>
                        {post.viewCount >= avgViews ? "+" : ""}{Math.round(((post.viewCount - avgViews) / avgViews) * 100)}% vs 平均
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-hashtag post list (reels + images + carousels) */}
      {instagramHashtagReport.filter(r => r.topPosts.length > 0).map(result => {
        const maxViews = Math.max(...result.topPosts.map(p => p.viewCount), 1);
        return (
          <Card key={result.hashtag}>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-gradient-to-br from-[#E1306C] to-[#F77737] text-white">
                  <Hash className="h-3 w-3" />
                </div>
                <CardTitle className="text-sm font-semibold">{result.hashtag}</CardTitle>
                <Badge variant="outline" className="text-[10px] h-5">{result.totalFetched}件中 上位{result.topPosts.length}件</Badge>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3 pt-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="text-[10px]">
                      <TableHead className="w-10 text-center">#</TableHead>
                      <TableHead>アカウント</TableHead>
                      <TableHead className="w-16 text-center">タイプ</TableHead>
                      <TableHead className="w-[140px]">再生数</TableHead>
                      <TableHead className="w-16 text-right">いいね</TableHead>
                      <TableHead className="w-16 text-right">コメント</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.topPosts.slice(0, 20).map(post => {
                      const viewRatio = maxViews > 0 ? (post.viewCount / maxViews) * 100 : 0;
                      return (
                        <TableRow key={post.shortcode} className={post.isOwn ? "bg-[#E1306C]/[0.04]" : ""}>
                          <TableCell className="text-center">
                            {post.position <= 3 ? (
                              <span className={`inline-flex items-center justify-center h-5 w-5 rounded-md text-[10px] font-black ${
                                post.position === 1 ? "bg-gradient-to-b from-amber-300 to-amber-500 text-white"
                                : post.position === 2 ? "bg-gradient-to-b from-gray-300 to-gray-400 text-white"
                                : "bg-gradient-to-b from-orange-300 to-orange-500 text-white"
                              }`} style={{ fontFamily: '"Space Mono", monospace' }}>
                                {post.position}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground tabular-nums" style={{ fontFamily: '"Space Mono", monospace' }}>{post.position}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {post.isOwn && <Star className="h-3 w-3 text-[#E1306C] shrink-0" />}
                              <span className={`text-xs ${post.isOwn ? "font-bold text-[#E1306C]" : ""}`}>
                                {post.username ? `@${post.username}` : "—"}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                              post.type === "reel" ? "bg-purple-100 text-purple-700" :
                              post.type === "carousel" ? "bg-blue-100 text-blue-700" :
                              post.type === "video" ? "bg-amber-100 text-amber-700" :
                              "bg-gray-100 text-gray-700"
                            }`}>
                              {post.type === "reel" ? "Reel" : post.type === "carousel" ? "カルーセル" : post.type === "video" ? "動画" : "画像"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="text-xs tabular-nums w-12 text-right shrink-0" style={{ fontFamily: '"Space Mono", monospace' }}>
                                {post.viewCount > 0 ? fmt(post.viewCount) : "—"}
                              </span>
                              {post.viewCount > 0 && (
                                <div className="flex-1 h-1.5 bg-black/[0.04] rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${post.isOwn ? "bg-gradient-to-r from-[#E1306C] to-[#F77737]" : "bg-black/[0.12]"}`}
                                    style={{ width: `${viewRatio}%` }}
                                  />
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{fmt(post.likeCount)}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{fmt(post.commentCount)}</TableCell>
                          <TableCell>
                            <a href={post.postUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-[#E1306C] transition-colors">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}


// ============================
// Instagram Phone Mockup — Search Results Mock (matching TikTok pattern)
// ============================

type IGPostData = {
  position: number;
  shortcode: string;
  username: string;
  type: string;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  coverUrl: string;
  postUrl: string;
  isOwn: boolean;
  owner?: "own" | "competitor" | "other";
  owner_detail?: "official" | "satellite" | "campaign";
  owner_name?: string;
  genre?: "recommend" | "howto" | "entertainment" | "negative" | "other";
  ig_labels?: Array<"promotion" | "paid_partnership" | "aigc">;
};

// ============================
// Shared classification constants (used by both IG and TikTok SOV edit forms)
// ============================
const GENRE_CONFIG: Record<string, { label: string; cls: string; barCls: string }> = {
  recommend: { label: "レコメンド", cls: "bg-blue-50 text-blue-700 border border-blue-200", barCls: "bg-blue-600" },
  howto: { label: "How-to", cls: "bg-amber-50 text-amber-700 border border-amber-200", barCls: "bg-amber-500" },
  entertainment: { label: "エンタメ", cls: "bg-purple-50 text-purple-700 border border-purple-200", barCls: "bg-purple-500" },
  negative: { label: "ネガティブ", cls: "bg-red-50 text-[#D71921] border border-[#D71921]/20", barCls: "bg-[#D71921]" },
  other: { label: "その他", cls: "bg-[#f5f5f5] text-[#6b7280] border border-black/6", barCls: "bg-[#9ca3af]" },
};

const OWNER_LABEL_CONFIG: Record<string, { text: string; cls: string }> = {
  official: { text: "公式", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  satellite: { text: "サテライト", cls: "bg-teal-50 text-teal-700 border-teal-200" },
  campaign: { text: "施策", cls: "bg-red-50 text-[#D71921] border-red-200" },
  competitor: { text: "競合", cls: "bg-slate-100 text-slate-600 border-slate-300" },
};

type OwnerKey = "official" | "satellite" | "campaign" | "competitor" | "other";
function slotToOwnerKey(slot: { owner?: string; owner_detail?: string }): OwnerKey {
  if (slot.owner === "own") return (slot.owner_detail as OwnerKey) || "official";
  if (slot.owner === "competitor") return "competitor";
  return "other";
}
function ownerKeyToChanges(key: OwnerKey): { owner: "own" | "competitor" | "other"; owner_detail?: string } {
  if (key === "official" || key === "satellite" || key === "campaign") return { owner: "own", owner_detail: key };
  if (key === "competitor") return { owner: "competitor" };
  return { owner: "other" };
}

function InstagramSearchMock({ posts, hashtag, isOwnOverrides = {} }: { posts: IGPostData[]; hashtag: string; isOwnOverrides?: Record<string, boolean> }) {
  return (
    <div className="relative hover:scale-[1.02] transition-all duration-500">
      {/* iPhone 15 Pro chassis */}
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
          {/* Inner bezel */}
          <div className="relative w-full h-full rounded-[26px] border-[1px] border-[#050505] bg-white overflow-hidden">
            {/* Dynamic Island */}
            <div className="absolute top-[6px] left-1/2 -translate-x-1/2 z-20">
              <div
                className="w-[62px] h-[18px] bg-black rounded-full"
                style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.06)" }}
              >
                <div className="absolute right-[13px] top-1/2 -translate-y-1/2 w-[5px] h-[5px] rounded-full bg-[#0a0a14]" style={{ boxShadow: "inset 0 0 1px rgba(255,255,255,0.1)" }} />
              </div>
            </div>

            {/* Glass reflection */}
            <div className="absolute inset-0 rounded-[24px] z-30 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 30%, transparent 50%)" }} />

            {/* Screen */}
            <div className="w-full h-full rounded-[24px] overflow-hidden bg-white flex flex-col" style={{ fontFamily: "-apple-system, 'Hiragino Sans', sans-serif" }}>

              {/* Status Bar */}
              <div className="relative flex items-center justify-between px-[16px] pt-[28px] pb-[2px] shrink-0">
                <span className="text-[8px] font-semibold text-black tabular-nums tracking-tight">9:41</span>
                <div className="flex items-center gap-[2.5px]">
                  <svg width="12" height="7" viewBox="0 0 12 7" fill="none">
                    <rect x="0" y="5" width="2" height="2" rx="0.4" fill="black"/>
                    <rect x="2.8" y="3.5" width="2" height="3.5" rx="0.4" fill="black"/>
                    <rect x="5.6" y="1.8" width="2" height="5.2" rx="0.4" fill="black"/>
                    <rect x="8.4" y="0" width="2" height="7" rx="0.4" fill="black"/>
                  </svg>
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M5 7.5a0.7 0.7 0 1 0 0-1.4 0.7 0.7 0 0 0 0 1.4Z" fill="black"/>
                    <path d="M3.2 5.6a2.5 2.5 0 0 1 3.6 0" stroke="black" strokeWidth="1.1" strokeLinecap="round"/>
                    <path d="M1.5 3.8a4.9 4.9 0 0 1 7 0" stroke="black" strokeWidth="1.1" strokeLinecap="round"/>
                  </svg>
                  <svg width="16" height="8" viewBox="0 0 16 8" fill="none">
                    <rect x="0.5" y="0.5" width="12" height="7" rx="2.2" stroke="black" strokeWidth="0.8" opacity="0.4"/>
                    <rect x="1.5" y="1.5" width="10" height="5" rx="1.2" fill="black"/>
                    <path d="M13.5 2.8v2.4a1 1 0 0 0 0-2.4Z" fill="black" opacity="0.4"/>
                  </svg>
                </div>
              </div>

              <div className="flex items-center gap-[4px] px-[6px] pb-[3px] shrink-0">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0">
                  <path d="M7 1.5L3 5L7 8.5" stroke="black" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <div className="flex-1 flex items-center gap-[4px] bg-[#f0f0f0] rounded-[8px] px-[7px] py-[4px]">
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" className="shrink-0">
                    <circle cx="4.8" cy="4.8" r="3.2" stroke="#8e8e8e" strokeWidth="1.1"/>
                    <path d="M7.2 7.2L9.8 9.8" stroke="#8e8e8e" strokeWidth="1.1" strokeLinecap="round"/>
                  </svg>
                  <span className="text-[8px] text-black truncate leading-none flex-1 font-semibold">#{hashtag}</span>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 opacity-50">
                    <circle cx="5" cy="5" r="5" fill="#c4c4c4"/>
                    <path d="M3.5 3.5L6.5 6.5M6.5 3.5L3.5 6.5" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                </div>
              </div>

              <div className="flex items-end shrink-0 border-b border-[#dbdbdb] py-[3px]">
                {["\u30C8\u30C3\u30D7", "\u30EA\u30FC\u30EB", "\u30A2\u30AB\u30A6\u30F3\u30C8"].map((tab) => {
                  const isActive = tab === "\u30C8\u30C3\u30D7";
                  return (
                    <div key={tab} className="flex-1 flex flex-col items-center gap-[2px]" style={{ minWidth: 0 }}>
                      <span className={`text-[7.5px] whitespace-nowrap ${isActive ? "text-black font-bold" : "text-[#8e8e8e] font-medium"}`}>
                        {tab}
                      </span>
                      {isActive && <div className="w-[14px] h-[2px] bg-black rounded-full" />}
                    </div>
                  );
                })}
              </div>

              <div className="shrink-0 bg-white px-[8px] py-[4px]">
                <span className="text-[7px] text-[#8e8e8e] font-medium">投稿 {posts.length > 30 ? "30" : posts.length}件</span>
              </div>

              <div className="flex-1 relative bg-white overflow-hidden">
                <div className="absolute inset-0 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
                  <div className="grid grid-cols-3 gap-px bg-white">
                    {posts.slice(0, 30).map((post, i) => {
                      const slotKey = `${hashtag}:${post.shortcode}`;
                      const effectiveIsOwn = slotKey in isOwnOverrides ? isOwnOverrides[slotKey] : (post.owner === "own" || (post.owner === undefined && post.isOwn));
                      const placeholderColors = [
                        "from-[#f0e6ff] to-[#e0d0f0]",
                        "from-[#e6f0ff] to-[#d0e0f0]",
                        "from-[#fff0e6] to-[#f0e0d0]",
                        "from-[#e6ffe6] to-[#d0f0d0]",
                        "from-[#ffe6f0] to-[#f0d0e0]",
                      ];
                      return (
                        <a
                          href={post.postUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          key={i}
                          className={`relative aspect-square overflow-visible group ig-thumb-stagger block`}
                          style={{ animationDelay: `${i * 40}ms`, zIndex: effectiveIsOwn ? 5 : 0 }}
                        >
                          {/* TikTok SOV同様: 施策キャップ */}
                          {effectiveIsOwn && (
                            <div className="absolute top-0 left-0 right-0 z-[6] bg-[#D71921] text-white text-[5px] font-bold text-center py-[2px] leading-none">施策</div>
                          )}
                          <div className={`w-full h-full overflow-hidden ${effectiveIsOwn ? "border-[2px] border-[#D71921]/50" : ""}`}>
                            {post.coverUrl ? (
                              <img src={post.coverUrl} alt="" className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105" loading="lazy" decoding="async" />
                            ) : (
                              <div className={`w-full h-full bg-gradient-to-br ${placeholderColors[i % placeholderColors.length]} flex items-center justify-center`}>
                                {(post.type === "reel" || post.type === "video") ? (
                                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                    <path d="M4 2.5L11 7L4 11.5Z" fill="#b0b0b0" />
                                  </svg>
                                ) : post.type === "carousel" ? (
                                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                    <rect x="1" y="3" width="8" height="8" rx="1" stroke="#b0b0b0" strokeWidth="1.2"/>
                                    <rect x="4" y="1" width="8" height="8" rx="1" stroke="#b0b0b0" strokeWidth="1.2"/>
                                  </svg>
                                ) : (
                                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                    <circle cx="7" cy="7" r="4.5" stroke="#b0b0b0" strokeWidth="1.2"/>
                                    <circle cx="7" cy="7" r="1.5" fill="#b0b0b0"/>
                                    <circle cx="10" cy="3.5" r="0.8" fill="#b0b0b0"/>
                                  </svg>
                                )}
                              </div>
                            )}
                          </div>

                          {/* TikTok SOV同様: 赤オーバーレイ + 左アクセントバー */}
                          {effectiveIsOwn && (
                            <div className="absolute inset-0 pointer-events-none z-[1] bg-[#D71921]/15" />
                          )}
                          {effectiveIsOwn && (
                            <div className="absolute top-0 bottom-0 left-0 w-[3px] z-[4] bg-[#D71921]" />
                          )}

                          <div className={`absolute top-[2px] left-[2px] min-w-[11px] h-[11px] rounded-[2px] flex items-center justify-center px-[2px] ${effectiveIsOwn ? "bg-[#D71921]" : "bg-black/50"}`}>
                            <span className="text-[6px] text-white font-bold leading-none">{post.position}</span>
                          </div>

                          {(post.type === "reel" || post.type === "video") && (
                            <svg className="absolute top-[2px] right-[2px] w-[8px] h-[8px]" viewBox="0 0 8 8" fill="white" style={{ filter: "drop-shadow(0 0.5px 1px rgba(0,0,0,0.5))" }}>
                              <path d="M1.5 0.8L6.5 4L1.5 7.2Z" />
                            </svg>
                          )}
                          {post.type === "carousel" && (
                            <svg className="absolute top-[2px] right-[2px] w-[8px] h-[8px]" viewBox="0 0 8 8" fill="none" style={{ filter: "drop-shadow(0 0.5px 1px rgba(0,0,0,0.5))" }}>
                              <rect x="0.5" y="1.5" width="5" height="5" rx="0.5" stroke="white" strokeWidth="0.8"/>
                              <rect x="2.5" y="0.5" width="5" height="5" rx="0.5" stroke="white" strokeWidth="0.8" fill="none"/>
                            </svg>
                          )}

                          <div className="absolute bottom-0 inset-x-0 h-[40%] bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
                          <div className="absolute bottom-[2px] left-[2px] flex items-center gap-[2px]">
                            <svg width="5" height="5" viewBox="0 0 5 5" fill="white" opacity="0.9">
                              <path d="M2.5 0.5L3.2 1.9L4.7 2.1L3.6 3.2L3.9 4.7L2.5 3.9L1.1 4.7L1.4 3.2L0.3 2.1L1.8 1.9Z" />
                            </svg>
                            <span className="text-[5px] text-white font-medium leading-none" style={{ textShadow: "0 0.5px 2px rgba(0,0,0,0.9)" }}>
                              {fmt(post.likeCount)}
                            </span>
                          </div>
                          {post.viewCount > 0 && (
                            <div className="absolute bottom-[2px] right-[2px] flex items-center gap-[1px]">
                              <svg width="5" height="5" viewBox="0 0 5 5" fill="white" opacity="0.8">
                                <path d="M0.5 2.5C0.5 2.5 1.5 0.8 2.5 0.8C3.5 0.8 4.5 2.5 4.5 2.5C4.5 2.5 3.5 4.2 2.5 4.2C1.5 4.2 0.5 2.5 0.5 2.5Z" />
                                <circle cx="2.5" cy="2.5" r="0.8" fill="#333" opacity="0.6"/>
                              </svg>
                              <span className="text-[5px] text-white font-medium leading-none" style={{ textShadow: "0 0.5px 2px rgba(0,0,0,0.9)" }}>
                                {fmt(post.viewCount)}
                              </span>
                            </div>
                          )}
                        </a>
                      );
                    })}
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white to-transparent pointer-events-none z-10" />
              </div>

              <div className="flex items-center justify-around px-1 pt-[4px] pb-[2px] bg-white border-t border-[#dbdbdb] shrink-0">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M9.005 16.545a2.997 2.997 0 0 1 2.997-2.997A2.997 2.997 0 0 1 15 16.545V22H9.005V16.545Z" fill="black"/><path d="M3 11.543l9-7.736 9 7.736V22h-5.998v-5.455a2.997 2.997 0 0 0-5.995 0V22H3V11.543Z" stroke="black" strokeWidth="1.8" strokeLinejoin="round"/></svg>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="7.5" stroke="black" strokeWidth="2.5"/><path d="M16.5 16.5L22 22" stroke="black" strokeWidth="2.5" strokeLinecap="round"/></svg>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="4" stroke="black" strokeWidth="1.8"/><path d="M12 7v10M7 12h10" stroke="black" strokeWidth="1.8" strokeLinecap="round"/></svg>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="3" stroke="black" strokeWidth="1.8"/><path d="M2 8h20M7 2l3 6M14 2l3 6" stroke="black" strokeWidth="1.5"/><path d="M10 12.5V18l5-2.75L10 12.5Z" fill="black"/></svg>
                <div className="w-[13px] h-[13px] rounded-full border-[1.5px] border-black bg-gradient-to-br from-gray-200 to-gray-300" />
              </div>

              <div className="flex justify-center pt-[2px] pb-[4px] bg-white">
                <div className="w-[38%] h-[2.5px] bg-black/20 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================
// IG SOV Slot Edit Form (matching TikTok SovSlotEditForm pattern)
// ============================

const IG_LABEL_CONFIG: Record<string, { text: string; dot: string }> = {
  promotion: { text: "プロモーション", dot: "bg-amber-500" },
  paid_partnership: { text: "有償パートナーシップ", dot: "bg-purple-500" },
  aigc: { text: "AI生成メディアを含む", dot: "bg-teal-500" },
};

const IG_OWNER_KEY_OPTIONS: { key: OwnerKey; label: string; color: string; activeBg: string }[] = [
  { key: "official", label: "公式", color: "text-blue-700", activeBg: "bg-blue-50 border-blue-300 ring-1 ring-blue-200" },
  { key: "satellite", label: "サテライト", color: "text-teal-700", activeBg: "bg-teal-50 border-teal-300 ring-1 ring-teal-200" },
  { key: "campaign", label: "施策", color: "text-[#D71921]", activeBg: "bg-red-50 border-red-300 ring-1 ring-red-200" },
  { key: "competitor", label: "競合", color: "text-slate-600", activeBg: "bg-slate-100 border-slate-400 ring-1 ring-slate-300" },
  { key: "other", label: "その他", color: "text-[#6b7280]", activeBg: "bg-[#f5f5f5] border-slate-400 ring-1 ring-slate-300" },
];

const IG_GENRE_OPTIONS: { key: string; label: string }[] = [
  { key: "recommend", label: "レコメンド" },
  { key: "howto", label: "How-to" },
  { key: "entertainment", label: "エンタメ" },
  { key: "negative", label: "ネガティブ" },
  { key: "other", label: "その他" },
];

function igPostToOwnerKey(post: IGPostData): OwnerKey {
  if (post.owner === "own") return (post.owner_detail as OwnerKey) || "campaign";
  if (post.owner === "competitor") return "competitor";
  if (post.owner === undefined && post.isOwn) return "campaign";
  if (post.owner === undefined && !post.isOwn) return "other";
  return "other";
}

type IgSlotChanges = { owner: string; owner_detail?: string; owner_name?: string; genre: string; ig_labels: string[] };

function IgSovSlotEditForm({ post, onSave, onCancel }: {
  post: IGPostData;
  onSave: (changes: IgSlotChanges) => void;
  onCancel: () => void;
}) {
  const [ownerKey, setOwnerKey] = useState<OwnerKey>(igPostToOwnerKey(post));
  const [ownerName, setOwnerName] = useState(post.owner_name || "");
  const [genre, setGenre] = useState(post.genre || "other");
  const [labels, setLabels] = useState<string[]>([...(post.ig_labels || [])]);

  const toggleLabel = (l: string) => setLabels(prev => prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l]);

  const handleSave = () => {
    const base = ownerKeyToChanges(ownerKey);
    onSave({
      ...base,
      owner_name: ownerKey === "competitor" ? ownerName : undefined,
      genre,
      ig_labels: labels,
    });
  };

  return (
    <div className="space-y-3 w-56">
      <div className="flex items-center gap-2 pb-1 border-b border-black/4">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">スロット編集</span>
        <span className="text-[10px] text-slate-300">@{post.username}</span>
      </div>

      {/* Owner classification */}
      <div className="space-y-1.5">
        <Label className="text-[11px] font-semibold text-muted-foreground">分類</Label>
        <div className="flex flex-wrap gap-1">
          {IG_OWNER_KEY_OPTIONS.map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setOwnerKey(opt.key)}
              className={`text-[10px] px-2 py-1 rounded-md border font-medium transition-all duration-150 ${
                ownerKey === opt.key
                  ? `${opt.activeBg} ${opt.color}`
                  : "border-border text-muted-foreground hover:border-black/8 hover:text-muted-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {ownerKey === "competitor" && (
          <Input
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="競合名"
            className="h-7 text-xs mt-1"
          />
        )}
      </div>

      {/* Genre */}
      <div className="space-y-1.5">
        <Label className="text-[11px] font-semibold text-muted-foreground">ジャンル</Label>
        <div className="flex flex-wrap gap-1">
          {IG_GENRE_OPTIONS.map(opt => {
            const gi = GENRE_CONFIG[opt.key] || GENRE_CONFIG.other;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setGenre(opt.key)}
                className={`text-[10px] px-2 py-1 rounded-md border font-medium transition-all duration-150 ${
                  genre === opt.key
                    ? `${gi.cls} border-transparent`
                    : "border-border text-muted-foreground hover:border-black/8"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Labels */}
      <div className="space-y-1.5">
        <Label className="text-[11px] font-semibold text-muted-foreground">ラベル</Label>
        <div className="space-y-1">
          {Object.entries(IG_LABEL_CONFIG).map(([key, cfg]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer group/lbl">
              <Checkbox
                checked={labels.includes(key)}
                onCheckedChange={() => toggleLabel(key)}
                className="h-3.5 w-3.5"
              />
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground group-hover/lbl:text-foreground">
                <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                {cfg.text}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-black/4">
        <Button
          size="sm"
          onClick={handleSave}
          className="h-7 text-xs px-3 gap-1"
        >
          <Check className="h-3 w-3" />
          保存
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="h-7 text-xs px-2 text-muted-foreground"
        >
          キャンセル
        </Button>
      </div>
    </div>
  );
}

// ============================
// Instagram Phone Mockup Stage — 3D Carousel (matching TikTok pattern)
// ============================

function getIGCardTransform(offset: number, count: number): { tx: number; scale: number; rotateY: number; z: number; opacity: number } {
  const abs = Math.abs(offset);
  const sign = offset < 0 ? -1 : 1;
  if (count <= 3 && abs >= 2) {
    return { tx: sign * 520, scale: 0.62, rotateY: sign * -13, z: 8, opacity: 0.55 };
  }
  if (abs === 0) return { tx: 0, scale: 1, rotateY: 0, z: 10, opacity: 1 };
  if (abs === 1) return { tx: sign * 540, scale: 0.55, rotateY: sign * -16, z: 8, opacity: 0.70 };
  if (abs === 2) return { tx: sign * 840, scale: 0.40, rotateY: sign * -26, z: 6, opacity: 0.30 };
  return { tx: sign * 1000, scale: 0.28, rotateY: sign * -33, z: 2, opacity: 0 };
}

function IGPhoneMockupStage({ validReports, tagStats, activeTag, showOwnOnly, onActiveTagChange, IG }: {
  validReports: Array<{ hashtag: string; topPosts: IGPostData[] }>;
  tagStats: Array<{ hashtag: string; ownCount: number; totalCount: number; bestPos: number | null; sovPct: number; totalViews: number; ownViews: number }>;
  activeTag: string | null;
  showOwnOnly: boolean;
  onActiveTagChange: (tag: string | null) => void;
  IG: { pink: string; orange: string; purple: string; yellow: string };
  onSlotUpdate?: (hashtag: string, shortcode: string, changes: IgSlotChanges) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  // IG slot edit: track which slot popover is open (by position)
  const [igEditOpenSlot, setIgEditOpenSlot] = useState<number | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setRevealed(true); obs.disconnect(); } },
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Sync selectedIdx when activeTag changes
  useEffect(() => {
    if (activeTag) {
      const idx = validReports.findIndex(r => r.hashtag === activeTag);
      if (idx >= 0) setSelectedIdx(idx);
    } else {
      setSelectedIdx(0);
    }
  }, [activeTag, validReports]);

  const count = validReports.length;
  const isSingle = count <= 1;

  const navigate = useCallback((dir: 1 | -1) => {
    const next = (selectedIdx + dir + count) % count;
    setSelectedIdx(next);
    onActiveTagChange(validReports[next].hashtag);
  }, [selectedIdx, count, validReports, onActiveTagChange]);

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") navigate(-1);
      else if (e.key === "ArrowRight") navigate(1);
    };
    const el = stageRef.current;
    el?.addEventListener("keydown", handler);
    return () => el?.removeEventListener("keydown", handler);
  }, [navigate]);

  const isOverview = activeTag === null;

  const PHONE_SCALE = 1.3;
  const OVERVIEW_PHONE_SCALE = 1.0;
  const activePhoneScale = isOverview ? OVERVIEW_PHONE_SCALE : PHONE_SCALE;
  const PHONE_H = Math.round(476 * activePhoneScale);
  const PHONE_W = Math.round(220 * activePhoneScale);

  const selectedReport = validReports[selectedIdx];
  const selectedTag = tagStats.find(t => t.hashtag === selectedReport?.hashtag);
  const selectedPosts = selectedReport ? selectedReport.topPosts.slice(0, 10) : [];
  const filteredSlotPosts = showOwnOnly ? selectedPosts.filter(p => p.owner === "own" || (p.owner === undefined && p.isOwn)) : selectedPosts;

  return (
    <div className="space-y-4">
      {/* Phone Carousel Card */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div
            ref={stageRef}
            tabIndex={0}
            className="relative bg-transparent px-3 sm:px-6 py-5 sm:py-8 outline-none min-w-0 overflow-hidden"
          >
            {/* Section title */}
            <div className="flex items-center gap-2 mb-5">
              <span className="text-[11px] uppercase tracking-[0.2em] text-[#a3a3a3] font-medium" style={{ fontFamily: "'Space Mono', monospace" }}>
                ハッシュタグ検索結果
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-[#a3a3a3]">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: `linear-gradient(135deg, ${IG.pink}, ${IG.purple})` }} />自社
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-[#a3a3a3]">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-200" />他社
              </span>
            </div>

            {/* Overview mode: all phones side by side in horizontal scroll */}
            {isOverview ? (
              <div className="flex gap-6 overflow-x-auto pb-4 justify-center" style={{ WebkitOverflowScrolling: "touch", scrollbarWidth: "thin" }}>
                {validReports.map((report, kwIdx) => {
                  const ownCount = report.topPosts.filter(p => p.owner === "own" || (p.owner === undefined && p.isOwn)).length;
                  return (
                    <div
                      key={report.hashtag}
                      className="flex flex-col items-center gap-2 shrink-0 cursor-pointer hover:scale-[1.03] transition-transform duration-300"
                      style={{
                        opacity: revealed ? 1 : 0,
                        transition: `opacity 600ms var(--md-ease-standard) ${kwIdx * 100}ms, transform 300ms var(--md-ease-standard)`,
                      }}
                      onClick={() => {
                        setSelectedIdx(kwIdx);
                        onActiveTagChange(report.hashtag);
                      }}
                    >
                      {/* Hashtag label pill */}
                      <div className="text-center">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-wide text-white"
                          style={{ background: `linear-gradient(135deg, ${IG.pink}, ${IG.purple})` }}>
                          <Hash className="w-[10px] h-[10px] opacity-80" />
                          {report.hashtag}
                        </span>
                      </div>

                      {/* Phone + metrics */}
                      <div className="text-center flex flex-col items-center gap-1.5">
                        <div className="space-y-0.5">
                          <span className="text-[12px] font-mono text-foreground font-bold tracking-wider block" style={{ fontFamily: "'Space Mono', monospace" }}>
                            Current
                          </span>
                          <span className="text-[11px] font-semibold block" style={{ color: IG.pink }}>
                            {ownCount}/{report.topPosts.length}枠
                          </span>
                        </div>
                        <div style={{ width: PHONE_W, height: PHONE_H, overflow: "hidden" }}>
                          <div style={{ transform: `scale(${OVERVIEW_PHONE_SCALE})`, transformOrigin: "top left", width: 220 }}>
                            <InstagramSearchMock posts={report.topPosts} hashtag={report.hashtag} />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Selected mode: 3D Carousel Viewport */
              <>
                <div
                  className="relative mx-auto overflow-hidden"
                  style={{
                    perspective: "1400px",
                    height: PHONE_H + 80,
                  }}
                >
                  {validReports.map((report, kwIdx) => {
                    const ts = tagStats.find(t => t.hashtag === report.hashtag);
                    const ownCount = report.topPosts.filter(p => p.owner === "own" || (p.owner === undefined && p.isOwn)).length;
                    const offset = kwIdx - selectedIdx;
                    const t = isSingle
                      ? { tx: 0, scale: 1, rotateY: 0, z: 10, opacity: 1 }
                      : getIGCardTransform(offset, count);
                    const isActive = offset === 0;

                    return (
                      <div
                        key={report.hashtag}
                        className="absolute left-1/2 top-0 flex flex-col items-center gap-2"
                        style={{
                          transform: isActive
                            ? `translateX(calc(-50% + ${t.tx}px))`
                            : `translateX(calc(-50% + ${t.tx}px)) translateZ(${t.z}px) scale(${t.scale}) rotateY(${t.rotateY}deg)`,
                          transformStyle: isActive ? "flat" : "preserve-3d",
                          opacity: revealed ? t.opacity : 0,
                          zIndex: 10 - Math.abs(offset),
                          transition: "transform 800ms var(--md-ease-emphasized-decel), opacity 600ms var(--md-ease-standard)",
                          pointerEvents: t.opacity === 0 ? "none" : "auto",
                          cursor: isActive ? "default" : "pointer",
                        }}
                        onClick={() => {
                          if (!isActive) {
                            setSelectedIdx(kwIdx);
                            onActiveTagChange(report.hashtag);
                          }
                        }}
                      >
                        {/* Hashtag label pill */}
                        <div className="text-center">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-wide text-white"
                            style={{ background: `linear-gradient(135deg, ${IG.pink}, ${IG.purple})` }}>
                            <Hash className="w-[10px] h-[10px] opacity-80" />
                            {report.hashtag}
                          </span>
                        </div>

                        {/* Phone + metrics */}
                        <div className="text-center flex flex-col items-center gap-1.5">
                          <div className="space-y-0.5">
                            <span className="text-[14px] font-mono text-foreground font-bold tracking-wider block" style={{ fontFamily: "'Space Mono', monospace" }}>
                              Current
                            </span>
                            <span className="text-[13px] font-semibold block" style={{ color: IG.pink }}>
                              {ownCount}/{report.topPosts.length}枠
                            </span>
                          </div>
                          <div style={{ width: PHONE_W, height: PHONE_H, overflow: "hidden" }}>
                            <div style={{ transform: `scale(${PHONE_SCALE})`, transformOrigin: "top left", width: 220 }}>
                              <InstagramSearchMock posts={report.topPosts} hashtag={report.hashtag} />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Navigation arrows */}
                {!isSingle && (
                  <>
                    <button
                      onClick={() => navigate(-1)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-white/90 border border-black/8 shadow-md flex items-center justify-center hover:bg-white hover:scale-105 transition-all duration-200"
                    >
                      <ChevronLeft className="w-4 h-4 text-secondary-foreground" />
                    </button>
                    <button
                      onClick={() => navigate(1)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-white/90 border border-black/8 shadow-md flex items-center justify-center hover:bg-white hover:scale-105 transition-all duration-200"
                    >
                      <ChevronRight className="w-4 h-4 text-secondary-foreground" />
                    </button>
                  </>
                )}

                {/* Dot indicators */}
                {!isSingle && (
                  <div className="flex items-center gap-1.5 mt-3 justify-center">
                    {validReports.map((report, i) => {
                      const isActiveIdx = i === selectedIdx;
                      return (
                        <button
                          key={report.hashtag}
                          onClick={() => { setSelectedIdx(i); onActiveTagChange(report.hashtag); }}
                          className={`transition-all duration-300 rounded-full ${isActiveIdx ? "h-2 px-3" : "w-2 h-2 hover:scale-125"}`}
                          style={isActiveIdx
                            ? { background: `linear-gradient(135deg, ${IG.pink}, ${IG.purple})` }
                            : { background: "#d4d4d4" }
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Slot Row — top 10 posts as horizontal thumbnails */}
      {selectedReport && (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-[10px] uppercase tracking-[0.15em] text-[#a3a3a3] font-semibold" style={{ fontFamily: "'Space Mono', monospace" }}>
                  #{selectedReport.hashtag} 上位表示マップ
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-[#a3a3a3]">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />公式
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-[#a3a3a3]">
                  <span className="w-2.5 h-2.5 rounded-full bg-teal-600" />サテライト
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-[#a3a3a3]">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: `linear-gradient(135deg, ${IG.pink}, ${IG.purple})` }} />施策
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-[#a3a3a3]">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-200" />他社
                </span>
              </div>
              {selectedReport.topPosts.filter(p => p.owner === "own" || (p.owner === undefined && p.isOwn)).length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Trophy className="h-3 w-3" style={{ color: IG.pink }} />
                  <span className="text-[11px] font-bold tabular-nums" style={{ color: IG.pink }}>
                    {selectedReport.topPosts.filter(p => p.owner === "own" || (p.owner === undefined && p.isOwn)).map(p => `${p.position}\u4F4D`).join("\u30FB")}
                  </span>
                </div>
              )}
            </div>

            {/* Horizontal slot row */}
            <div className="px-5 py-5">
              <div className="flex gap-2 overflow-x-auto pb-2 min-w-0">
                {filteredSlotPosts.map((post, i) => {
                  const effectiveIsOwn = post.owner === "own" || (post.owner === undefined && post.isOwn);
                  const isCompetitor = post.owner === "competitor";
                  const isLabeled = effectiveIsOwn || isCompetitor;
                  const detail = effectiveIsOwn ? (post.owner_detail || "campaign") : isCompetitor ? "competitor" : undefined;
                  const IG_SLOT_CAP: Record<string, { bg: string; label: string }> = {
                    official: { bg: "bg-blue-600", label: "公式" },
                    satellite: { bg: "bg-teal-600", label: "サテライト" },
                    campaign: { bg: "", label: "施策" },
                    competitor: { bg: "bg-slate-500", label: "競合" },
                  };
                  const capCfg = detail ? IG_SLOT_CAP[detail] : undefined;
                  const isEditOpen = igEditOpenSlot === post.position;
                  const postLabels = post.ig_labels || [];
                  return (
                  <Popover key={i} open={isEditOpen} onOpenChange={(open) => setIgEditOpenSlot(open ? post.position : null)}>
                  <div className={`relative flex flex-col shrink-0 group/slot transition-all duration-200 ${effectiveIsOwn ? "w-20" : "w-16"}`}>
                    {/* 鉛筆ボタン — ホバー時に表示 */}
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); }}
                        className={`absolute -top-1.5 -right-1.5 z-40 w-5 h-5 rounded-full bg-white border border-black/8 shadow-md flex items-center justify-center
                          transition-all duration-200 hover:bg-card hover:border-black/12 hover:border-black/15
                          ${isEditOpen ? "opacity-100 scale-100" : "opacity-0 scale-75 pointer-events-none group-hover/slot:opacity-100 group-hover/slot:scale-100 group-hover/slot:pointer-events-auto"}`}
                      >
                        <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="right" align="start" className="p-3 w-auto z-50" onOpenAutoFocus={(e) => e.preventDefault()}>
                      <IgSovSlotEditForm
                        post={post}
                        onSave={(changes) => {
                          onSlotUpdate?.(selectedReport.hashtag, post.shortcode, changes);
                          setIgEditOpenSlot(null);
                        }}
                        onCancel={() => setIgEditOpenSlot(null)}
                      />
                    </PopoverContent>

                    <a
                      href={post.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`relative flex flex-col cursor-pointer transition-all duration-200 ${isEditOpen ? "" : "hover:scale-110 hover:z-10"}`}
                      onClick={(e) => { if (isEditOpen) { e.preventDefault(); } }}
                    >
                    {/* Top cap: classification badge */}
                    {isLabeled && capCfg ? (
                      <div className={`text-[8px] font-bold text-center py-[2px] rounded-t-md leading-tight shrink-0 text-white ${capCfg.bg}`}
                        style={detail === "campaign" ? { background: `linear-gradient(135deg, ${IG.pink}, ${IG.purple})` } : undefined}>
                        {capCfg.label}
                      </div>
                    ) : (
                      <div className="h-[14px] shrink-0" />
                    )}

                    {/* Thumbnail — 9:16 aspect */}
                    <div className={`relative w-full overflow-hidden ${effectiveIsOwn ? `h-[142px] rounded-b-md border-2 border-[#E1306C] shadow-lg shadow-[#E1306C]/20` : isCompetitor ? "h-[114px] rounded-b-md border-2 border-slate-300" : "h-[114px] rounded-md border border-border/70"}`}>
                      {/* Accent bar */}
                      {effectiveIsOwn && (
                        <div className="absolute top-0 left-0 bottom-0 w-[3px] z-10" style={detail === "official" ? { background: "#2563eb" } : detail === "satellite" ? { background: "#0d9488" } : { background: `linear-gradient(180deg, ${IG.pink}, ${IG.purple})` }} />
                      )}

                      {/* Label dots (promotion/partnership/AI) */}
                      {postLabels.length > 0 && (
                        <div className="absolute top-1 left-1 flex gap-0.5 z-20">
                          {postLabels.map(label => {
                            const lCfg = IG_LABEL_CONFIG[label];
                            return lCfg ? <span key={label} className={`w-2 h-2 rounded-full ${lCfg.dot} shadow-sm ring-1 ring-white/50`} /> : null;
                          })}
                        </div>
                      )}

                      {post.coverUrl ? (
                        <img src={post.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className={`w-full h-full flex items-center justify-center ${effectiveIsOwn ? "bg-[#E1306C]/10" : "bg-slate-50"}`}>
                          <span className={`text-lg font-bold ${effectiveIsOwn ? "text-[#E1306C]" : "text-[#d4d4d4]"}`}>{post.position}</span>
                        </div>
                      )}

                      {/* Position badge */}
                      <span className={`absolute top-1 right-1 text-[9px] font-bold leading-none px-1 py-0.5 rounded z-20 ${effectiveIsOwn ? "bg-[#E1306C] text-white" : "bg-black/50 text-white"}`}>
                        {post.position}
                      </span>

                      {/* Bottom gradient */}
                      <div className="absolute bottom-0 inset-x-0 h-[40%] bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
                    </div>

                    {/* Username with IG-style circle avatar */}
                    <div className="flex flex-col items-center gap-0.5 mt-1.5">
                      <div className={`w-5 h-5 rounded-full overflow-hidden shrink-0 ${effectiveIsOwn ? "ring-[1.5px] ring-[#E1306C]" : "ring-[1px] ring-slate-200"}`}>
                        {post.coverUrl ? (
                          <img src={post.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-slate-200 to-slate-300" />
                        )}
                      </div>
                      <span className={`text-[8px] truncate max-w-full text-center leading-none ${effectiveIsOwn ? "font-semibold text-[#E1306C]" : "text-[#a3a3a3]"}`}>
                        @{post.username}
                      </span>
                    </div>
                    </a>
                  </div>
                  </Popover>
                  );
                })}
              </div>
            </div>

            {/* Stats strip below slots */}
            <div className="border-t border-slate-100 grid grid-cols-3 divide-x divide-slate-100 min-w-0">
              <div className="flex flex-col items-center py-3">
                <span className="text-[10px] text-[#b0b0b0] font-medium uppercase tracking-wider" style={{ fontFamily: "'Space Mono', monospace" }}>上位シェア率</span>
                <span className="text-lg font-black text-foreground tabular-nums">
                  {selectedReport.topPosts.filter(p => p.owner === "own" || (p.owner === undefined && p.isOwn)).length}
                  <span className="text-xs font-normal text-[#b0b0b0]">/{selectedPosts.length > 10 ? 10 : selectedPosts.length}</span>
                </span>
              </div>
              <div className="flex flex-col items-center py-3">
                <span className="text-[10px] text-[#b0b0b0] font-medium uppercase tracking-wider" style={{ fontFamily: "'Space Mono', monospace" }}>自社動画</span>
                <span className="text-lg font-black text-foreground tabular-nums">
                  {selectedReport.topPosts.filter(p => p.owner === "own" || (p.owner === undefined && p.isOwn)).length}
                  <span className="text-xs font-normal text-[#b0b0b0]">/{selectedReport.topPosts.length}</span>
                </span>
              </div>
              <div className="flex flex-col items-center py-3">
                <span className="text-[10px] text-[#b0b0b0] font-medium uppercase tracking-wider" style={{ fontFamily: "'Space Mono', monospace" }}>最高順位</span>
                <span className="text-lg font-black text-foreground tabular-nums">
                  {(() => {
                    const ownPosts = selectedReport.topPosts.filter(p => p.owner === "own" || (p.owner === undefined && p.isOwn));
                    if (ownPosts.length === 0) return <span className="text-[#d4d4d4]">&mdash;</span>;
                    const best = Math.min(...ownPosts.map(p => p.position));
                    return <>{best}<span className="text-xs font-normal text-[#b0b0b0]">位</span></>;
                  })()}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}


// ============================
// Instagram Hashtag Ranking Section (順位・シェア IG tab)
// ============================

export function InstagramHashtagRankingSection({ instagramHashtagReport, campaignId, onIgSlotUpdate }: {
  instagramHashtagReport: IGHashtagReport;
  campaignId: number;
  onIgSlotUpdate?: (hashtag: string, shortcode: string, changes: IgSlotChanges) => void;
}) {
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());
  const [showOwnOnly, setShowOwnOnly] = useState(false);
  const toggleExpand = (tag: string) => setExpandedTags(prev => {
    const n = new Set(prev);
    if (n.has(tag)) n.delete(tag); else n.add(tag);
    return n;
  });

  const validReports = instagramHashtagReport.filter(r => r.topPosts.length > 0);
  const isOverview = activeTag === null;

  // Helper: check if a post is "own" (using owner field with isOwn fallback)
  const isOwnPost = (p: IGPostData) => p.owner === "own" || (p.owner === undefined && p.isOwn);

  // --- Aggregate stats ---
  const agg = useMemo(() => {
    let totalOwn = 0, totalPosts = 0, bestRank = 999;
    let officialCount = 0, satelliteCount = 0, campaignCount = 0;
    for (const r of validReports) {
      const own = r.topPosts.filter(isOwnPost);
      totalOwn += own.length;
      totalPosts += r.topPosts.length;
      for (const p of own) {
        if (p.position < bestRank) bestRank = p.position;
        if (p.owner_detail === "official") officialCount++;
        else if (p.owner_detail === "satellite") satelliteCount++;
        else campaignCount++;
      }
    }
    return {
      totalOwn, totalPosts, bestRank: bestRank < 999 ? bestRank : null,
      sovPct: totalPosts > 0 ? Math.round((totalOwn / totalPosts) * 1000) / 10 : 0,
      tagCount: validReports.length,
      officialCount, satelliteCount, campaignCount,
    };
  }, [validReports]);

  const activeReport = isOverview ? null : validReports.find(r => r.hashtag === activeTag) ?? null;

  // Per-tag stats
  const tagStats = useMemo(() => {
    return validReports.map(r => {
      const own = r.topPosts.filter(isOwnPost);
      const bestPos = own.length > 0 ? Math.min(...own.map(p => p.position)) : null;
      const sovPct = r.topPosts.length > 0 ? Math.round((own.length / r.topPosts.length) * 1000) / 10 : 0;
      const totalViews = r.topPosts.reduce((s, p) => s + p.viewCount, 0);
      const ownViews = own.reduce((s, p) => s + p.viewCount, 0);
      return { hashtag: r.hashtag, ownCount: own.length, totalCount: r.topPosts.length, bestPos, sovPct, totalViews, ownViews };
    });
  }, [validReports]);

  // Hero data — per-tag or aggregate (with views & ER)
  const hero = useMemo(() => {
    if (isOverview) {
      let totalViews = 0, totalLikes = 0, totalComments = 0, ownViews = 0;
      for (const r of validReports) {
        for (const p of r.topPosts) {
          totalViews += p.viewCount;
          totalLikes += p.likeCount;
          totalComments += p.commentCount;
          if (isOwnPost(p)) ownViews += p.viewCount;
        }
      }
      const avgEr = totalViews > 0 ? Number(((totalLikes + totalComments) / totalViews * 100).toFixed(1)) : 0;
      return { ...agg, totalViews, ownViews, avgEr };
    }
    const ts = tagStats.find(t => t.hashtag === activeTag);
    if (!ts) return { ...agg, totalViews: 0, ownViews: 0, avgEr: 0 };
    const r = validReports.find(r => r.hashtag === activeTag);
    let totalLikes = 0, totalComments = 0;
    if (r) { for (const p of r.topPosts) { totalLikes += p.likeCount; totalComments += p.commentCount; } }
    const avgEr = ts.totalViews > 0 ? Number(((totalLikes + totalComments) / ts.totalViews * 100).toFixed(1)) : 0;
    return { totalOwn: ts.ownCount, totalPosts: ts.totalCount, bestRank: ts.bestPos, sovPct: ts.sovPct, tagCount: 1, totalViews: ts.totalViews, ownViews: ts.ownViews, avgEr };
  }, [isOverview, agg, tagStats, activeTag, validReports]);

  // IG brand colors
  const IG = { pink: "#E1306C", orange: "#F77737", purple: "#833AB4", yellow: "#FCAF45" };

  return (
    <div className="space-y-5 min-w-0">

      {/* ======== Hero Card — TikTok SOV統一レイアウト ======== */}
      <Card className="overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
        <CardContent className="p-0">
          <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_1fr] gap-0 md:divide-x divide-slate-100 min-w-0">
            {/* Left: Donut — 赤ベース（TikTokと同じスタイル） */}
            <div className="flex flex-col items-center justify-center py-6 px-4">
              {(() => {
                const circumference = 2 * Math.PI * 50;
                const fillLen = (hero.sovPct / 100) * circumference;
                return (
                  <>
                    <svg viewBox="0 0 120 120" className="w-28 h-28">
                      <circle cx="60" cy="60" r="50" fill="none" stroke="#f1f1f1" strokeWidth="12" />
                      <circle cx="60" cy="60" r="50" fill="none" stroke="#D71921" strokeWidth="12"
                        strokeDasharray={`${fillLen} ${circumference - fillLen}`} strokeLinecap="round"
                        transform="rotate(-90 60 60)" className="animate-donut-fill" />
                      <text x="60" y="55" textAnchor="middle" dominantBaseline="central" className="text-[26px] font-extrabold" fill="#0a0a0a">{hero.sovPct}<tspan className="text-[14px] font-medium" fill="#9ca3af">%</tspan></text>
                      <text x="60" y="77" textAnchor="middle" dominantBaseline="central" className="text-[10px] font-medium" fill="#9ca3af">上位シェア ({hero.totalOwn}/{hero.totalPosts})</text>
                    </svg>
                    <p className="text-xs text-muted-foreground mt-1.5">全{hero.totalPosts}本中 {hero.totalOwn}本が自社</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground">
                        <span className="w-2 h-2 rounded-full bg-[#D71921]" />{hero.totalOwn}
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Center: 4 stat boxes（TikTokと同じ） */}
            <div className="grid grid-cols-2 gap-px bg-[#f5f5f5] min-w-0">
              {(isOverview ? [
                { label: "キーワード数", value: `${agg.tagCount}`, sub: "KW" },
                { label: "自社投稿", value: `${hero.totalOwn}`, sub: `/${hero.totalPosts}` },
                { label: "最高順位", value: hero.bestRank != null ? `${hero.bestRank}` : "—", sub: hero.bestRank != null ? "位" : "" },
                { label: "施策比", value: "—", sub: "" },
              ] : [
                { label: "上位シェア率", value: `${hero.totalOwn}`, sub: `/${hero.totalPosts}` },
                { label: "自社投稿", value: `${hero.totalOwn}`, sub: `/${hero.totalPosts}` },
                { label: "最高順位", value: hero.bestRank != null ? `${hero.bestRank}` : "—", sub: hero.bestRank != null ? "位" : "" },
                { label: "順位変動", value: "—", sub: "" },
              ]).map((stat, i) => (
                <div key={i} className="bg-[#f5f5f5] flex flex-col items-center justify-center py-4 px-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{stat.label}</p>
                  <p className="text-2xl font-extrabold text-foreground leading-none">{stat.value}<span className="text-sm font-normal text-muted-foreground ml-0.5">{stat.sub}</span></p>
                </div>
              ))}
            </div>

            {/* Right: アカウント内訳（TikTokと同じ） */}
            <div className="flex flex-col justify-center py-5 px-5 gap-3 min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">アカウント内訳</p>
              {[
                { label: "公式", count: agg.officialCount, color: "bg-blue-600", textColor: "text-blue-700" },
                { label: "サテライト", count: agg.satelliteCount, color: "bg-teal-600", textColor: "text-teal-700" },
                { label: "施策", count: agg.campaignCount, color: "bg-[#D71921]", textColor: "text-[#D71921]" },
              ].map(cat => {
                const pct = hero.totalOwn > 0 ? (cat.count / Math.max(hero.totalOwn, 1)) * 100 : 0;
                return (
                  <div key={cat.label} className="flex items-center gap-2">
                    <span className={`text-[11px] font-semibold w-16 ${cat.textColor}`}>{cat.label}</span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${cat.color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[11px] font-bold tabular-nums w-6 text-right">{cat.count}本</span>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ======== Tag Selector Pills + Own Filter ======== */}
      {validReports.length > 0 && (
        <div className="flex items-center gap-3 min-w-0">
          <div className="overflow-x-auto flex-1 min-w-0">
          <div className="flex gap-2 min-w-max">
            <button
              onClick={() => setActiveTag(null)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-all whitespace-nowrap ${
                isOverview
                  ? "text-white shadow-lg"
                  : "bg-slate-100 text-[#a3a3a3] hover:bg-slate-200"
              }`}
              style={isOverview ? { background: `linear-gradient(135deg, ${IG.pink}, ${IG.purple})` } : undefined}
            >
              全体
              <span className={`text-[11px] font-bold tabular-nums ${isOverview ? "text-white/70" : "text-[#a3a3a3]"}`}>
                {agg.totalOwn}/{agg.totalPosts}
              </span>
            </button>
            {tagStats.map(ts => {
              const isActive = ts.hashtag === activeTag;
              return (
                <button
                  key={ts.hashtag}
                  onClick={() => setActiveTag(ts.hashtag)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-all whitespace-nowrap ${
                    isActive
                      ? "text-white shadow-lg"
                      : "bg-slate-100 text-muted-foreground hover:bg-slate-200"
                  }`}
                  style={isActive ? { background: `linear-gradient(135deg, ${IG.pink}, ${IG.purple})` } : undefined}
                >
                  #{ts.hashtag}
                  <span className={`text-[11px] font-bold tabular-nums ${isActive ? "text-white/70" : "text-[#a3a3a3]"}`}>
                    {ts.ownCount}/{ts.totalCount}
                  </span>
                </button>
              );
            })}
          </div>
          </div>
          {/* Own-only filter toggle */}
          <button
            onClick={() => setShowOwnOnly(prev => !prev)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-all whitespace-nowrap flex-shrink-0 ${
              showOwnOnly
                ? "text-white shadow-md"
                : "bg-slate-100 text-[#a3a3a3] hover:bg-slate-200"
            }`}
            style={showOwnOnly ? { background: `linear-gradient(135deg, #E1306C, #833AB4)` } : undefined}
          >
            <Filter className="h-3 w-3" />
            自社のみ
          </button>
        </div>
      )}

      {/* ======== Instagram Phone Mockup SOV Visualization ======== */}
      <IGPhoneMockupStage
        validReports={validReports}
        tagStats={tagStats}
        activeTag={activeTag}
        showOwnOnly={showOwnOnly}
        onActiveTagChange={setActiveTag}
        IG={IG}
        onSlotUpdate={onIgSlotUpdate}
      />

      {/* ======== Summary Table with Accordion ======== */}
      {validReports.length > 0 && (
        <Card className="overflow-hidden min-w-0">
          <CardContent className="p-0 overflow-x-auto min-w-0">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="py-2.5 px-4 text-left text-[11px] font-semibold text-muted-foreground">ハッシュタグ</th>
                  <th className="py-2.5 px-3 text-left text-[11px] font-semibold text-muted-foreground w-36">SOV占有率</th>
                  <th className="py-2.5 px-3 text-center text-[11px] font-semibold text-muted-foreground whitespace-nowrap">自社投稿</th>
                  <th className="py-2.5 px-3 text-center text-[11px] font-semibold text-muted-foreground whitespace-nowrap">最高順位</th>
                  <th className="py-2.5 px-3 text-center text-[11px] font-semibold text-muted-foreground whitespace-nowrap">総再生数</th>
                </tr>
              </thead>
              <tbody>
                {tagStats.map(ts => {
                  const r = validReports.find(r => r.hashtag === ts.hashtag)!;
                  const ownPosts = r.topPosts.filter(p => p.owner === "own" || (p.owner === undefined && p.isOwn));
                  const isExp = expandedTags.has(ts.hashtag);
                  return (
                    <Fragment key={ts.hashtag}>
                      <tr
                        className={`border-b border-slate-50 hover:bg-slate-50/50 transition-colors cursor-pointer ${ts.hashtag === activeTag ? "bg-[#E1306C]/[0.02]" : ""}`}
                        onClick={() => { setActiveTag(ts.hashtag); toggleExpand(ts.hashtag); }}
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <ChevronRight className={`h-3.5 w-3.5 text-[#b0b0b0] transition-transform duration-200 ${isExp ? "rotate-90" : ""}`} />
                            <span className="font-semibold text-sm text-foreground">#{ts.hashtag}</span>
                            <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-slate-200 text-[#a3a3a3]">{ts.totalCount}件</Badge>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{
                                width: `${ts.sovPct}%`,
                                background: `linear-gradient(90deg, ${IG.orange}, ${IG.pink})`
                              }} />
                            </div>
                            <span className="text-xs font-bold text-foreground tabular-nums w-12 text-right">{ts.sovPct}%</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className="text-sm font-bold text-foreground tabular-nums">{ts.ownCount}<span className="text-[10px] font-normal text-[#a3a3a3]">/{ts.totalCount}</span></span>
                        </td>
                        <td className="py-3 px-3 text-center">
                          {ts.bestPos != null ? (
                            <span className={`text-sm font-bold tabular-nums ${ts.bestPos <= 3 ? "text-[#E1306C]" : ts.bestPos <= 10 ? "text-foreground" : "text-[#a3a3a3]"}`}>{ts.bestPos}位</span>
                          ) : (
                            <span className="text-xs text-[#d4d4d4]">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className="text-sm font-medium text-secondary-foreground tabular-nums">{fmt(ts.totalViews)}</span>
                        </td>
                      </tr>
                      {/* Accordion: IG-native own posts detail */}
                      {isExp && (
                        <tr>
                          <td colSpan={5} className="p-0">
                            <div className="border-b border-slate-100" style={{ background: `linear-gradient(180deg, #fafafa 0%, white 100%)` }}>
                              {ownPosts.length > 0 ? (
                                <div className="px-5 py-4 space-y-3">
                                  <div className="flex items-center gap-2">
                                    <div className="h-px flex-1" style={{ background: `linear-gradient(90deg, transparent, ${IG.pink}20, transparent)` }} />
                                    <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: IG.pink }}>自社投稿 {ownPosts.length}件</span>
                                    <div className="h-px flex-1" style={{ background: `linear-gradient(90deg, transparent, ${IG.pink}20, transparent)` }} />
                                  </div>
                                  {ownPosts.sort((a, b) => a.position - b.position).map(post => {
                                    const er = post.viewCount > 0 ? ((post.likeCount + post.commentCount) / post.viewCount * 100).toFixed(1) : "0.0";
                                    return (
                                      <a key={post.shortcode} href={post.postUrl} target="_blank" rel="noopener noreferrer"
                                        className="block rounded-2xl bg-white border border-slate-100 hover:border-[#E1306C]/20 shadow-sm hover:shadow-md transition-all overflow-hidden">
                                        {/* IG Feed-style header */}
                                        <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                                          {/* Story ring avatar */}
                                          <div className="w-9 h-9 rounded-full p-[2px] flex-shrink-0" style={{ background: `linear-gradient(135deg, ${IG.yellow}, ${IG.orange}, ${IG.pink}, ${IG.purple})` }}>
                                            <div className="w-full h-full rounded-full border-[1.5px] border-white overflow-hidden">
                                              {post.coverUrl ? (
                                                <img src={post.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                                              ) : (
                                                <div className="w-full h-full bg-gradient-to-br from-[#E1306C]/20 to-[#833AB4]/20 flex items-center justify-center">
                                                  <span className="text-[8px] font-bold text-[#E1306C]">{post.position}</span>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                              <span className="text-[13px] font-semibold text-foreground">@{post.username}</span>
                                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: `linear-gradient(135deg, ${IG.pink}, ${IG.purple})` }}>{post.position}位</span>
                                            </div>
                                            <span className="text-[10px] text-[#a3a3a3]">{post.type === "reel" ? "Reel" : post.type === "carousel" ? "Carousel" : "Post"}</span>
                                          </div>
                                          <ExternalLink className="h-3.5 w-3.5 text-[#d4d4d4] flex-shrink-0" />
                                        </div>
                                        {/* Caption + metrics */}
                                        <div className="px-3.5 pb-3">
                                          {post.caption && (
                                            <p className="text-[11px] text-secondary-foreground line-clamp-2 mb-2 leading-relaxed">{post.caption}</p>
                                          )}
                                          {/* IG-style action row */}
                                          <div className="flex items-center gap-4">
                                            <span className="flex items-center gap-1.5 text-[12px]">
                                              <Heart className="h-4 w-4 text-[#E1306C]" />
                                              <span className="font-semibold text-foreground tabular-nums">{fmt(post.likeCount)}</span>
                                            </span>
                                            <span className="flex items-center gap-1.5 text-[12px]">
                                              <MessageCircle className="h-4 w-4 text-secondary-foreground" />
                                              <span className="font-semibold text-foreground tabular-nums">{fmt(post.commentCount)}</span>
                                            </span>
                                            <span className="flex items-center gap-1.5 text-[12px]">
                                              <Eye className="h-4 w-4 text-secondary-foreground" />
                                              <span className="font-semibold text-foreground tabular-nums">{fmt(post.viewCount)}</span>
                                            </span>
                                            <span className="ml-auto text-[11px] font-bold tabular-nums" style={{ color: IG.pink }}>ER {er}%</span>
                                          </div>
                                        </div>
                                      </a>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="px-5 py-8 text-center">
                                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2">
                                    <Search className="h-5 w-5 text-[#d4d4d4]" />
                                  </div>
                                  <p className="text-sm text-[#a3a3a3]">上位{r.topPosts.length}件に自社投稿なし</p>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================
// Section 1: Summary Cards
// ============================

export function SummaryCards({ summary, thirdPartyCount, hasBaseline, ripple, sovReport }: {
  summary: any; thirdPartyCount: number; hasBaseline: boolean; ripple?: Record<string, any>; sovReport?: Record<string, any>;
}) {
  const fmtAvgRank = (count: number | undefined, rank: number | null | undefined) => {
    if (rank == null || rank === 0 || !count) return "圏外";
    return `${count}ワード ${rank}位`;
  };

  // SOV: 施策KW固有タグ（own_count >= 2）
  const specificTags = useMemo(() => {
    if (!sovReport) return [];
    return Object.entries(sovReport).filter(([, d]) => (d.after?.own_count || 0) >= 2);
  }, [sovReport]);

  // 第三者投稿数・再生数
  const tpStats = useMemo(() => {
    let count = 0, views = 0;
    if (!ripple) return { count: thirdPartyCount, views: 0 };
    for (const [, data] of Object.entries(ripple)) {
      for (const v of (data.third_party_videos || data.omaage_videos || [])) {
        count++;
        views += v.views || 0;
      }
    }
    return { count, views };
  }, [ripple, thirdPartyCount]);

  if (hasBaseline) {
    const cards: { title: string; value: string; before?: string; after?: string; change?: React.ReactNode }[] = [
      {
        title: "平均検索順位",
        value: fmtAvgRank(summary.ranked_keyword_count, summary.avg_rank_after),
      },
      {
        title: "平均ER",
        value: `${summary.er_after}%`,
      },
      {
        title: "上位表示率",
        before: `${summary.sov_before}%`,
        after: `${summary.sov_after}%`,
        value: "",
        change: <ChangeIndicator value={Number((parseFloat(summary.sov_after) - parseFloat(summary.sov_before)).toFixed(1))} suffix="pt" />,
      },
    ];
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardContent className="py-3 px-4 space-y-1 text-center">
              <p className="text-xs text-muted-foreground">{card.title}</p>
              {card.before != null ? (
                <>
                  <p className="text-base font-bold font-mono">
                    <span className="text-muted-foreground">{card.before}</span>
                    <span className="text-foreground mx-1">&rarr;</span>
                    <span className="text-foreground">{card.after}</span>
                  </p>
                  {card.change && <div className="text-sm">{card.change}</div>}
                </>
              ) : (
                <p className="text-xl font-bold text-foreground font-mono">{card.value}</p>
              )}
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="py-3 px-4 space-y-1 text-center">
            <p className="text-xs text-muted-foreground">第三者投稿</p>
            <p className="text-xl font-bold text-foreground font-mono">{tpStats.count}本</p>
            {tpStats.views > 0 && <p className="text-xs text-muted-foreground">{fmt(tpStats.views)} 再生</p>}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Report B: absolute values only
  const absCards = [
    { title: "平均検索順位", value: fmtAvgRank(summary.ranked_keyword_count, summary.avg_rank_after) },
    { title: "平均ER", value: `${summary.er_after}%` },
    { title: "上位表示率", value: specificTags.length > 0 ? `${specificTags.length}タグ` : `${summary.sov_after}%` },
    { title: "第三者投稿", value: `${tpStats.count}本` },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {absCards.map((card) => (
        <Card key={card.title}>
          <CardContent className="py-3 px-4 space-y-1">
            <p className="text-xs text-muted-foreground">{card.title}</p>
            <p className="text-xl font-bold text-foreground font-mono">{card.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================
// OwnVideoCard with inline edit
// ============================

function OwnVideoCard({ slot, keyword, onSlotUpdate, readOnly }: {
  slot: SlotData;
  keyword: string;
  onSlotUpdate: (keyword: string, phase: "before" | "after", videoId: string, changes: any) => void;
  readOnly?: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const configKey: keyof typeof SOV_SLOT_CONFIG = slot.owner_detail === "campaign" ? "campaign" : slot.owner_detail === "satellite" ? "satellite" : "official";
  const cfg = SOV_SLOT_CONFIG[configKey];
  const genreInfo = GENRE_CONFIG[slot.genre] || GENRE_CONFIG.other;

  return (
    <div className="relative group/card">
      <a
        href={slot.video_url}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex items-center gap-3 rounded-lg border-l-4 bg-[#f5f5f5] p-3 hover:border-black/12 transition-all ${
          configKey === "official" ? "border-l-blue-500" : configKey === "satellite" ? "border-l-teal-500" : "border-l-purple-500"
        }`}
      >
        {slot.cover_url ? (
          <img src={slot.cover_url} alt="" className="w-12 h-16 rounded object-cover flex-shrink-0" loading="lazy" />
        ) : (
          <div className={`w-12 h-16 rounded flex items-center justify-center ${cfg.emptyBg} flex-shrink-0`}>
            <span className={`text-lg font-bold ${cfg.emptyText}`}>{slot.rank}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${cfg.capBg} ${cfg.capText}`}>{cfg.capLabel}</span>
            <span className="text-sm font-semibold text-foreground truncate">@{slot.creator_username}</span>
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{slot.description?.slice(0, 40)}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[9px] px-1 rounded ${genreInfo.cls}`}>{genreInfo.label}</span>
            <span className="text-xs font-bold text-muted-foreground">#{slot.rank}</span>
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><Eye className="h-3 w-3" />{fmt(slot.view_count)}</span>
          </div>
        </div>
      </a>
      {/* Edit button */}
      {!readOnly && (
      <Popover open={editOpen} onOpenChange={setEditOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-[#f5f5f5] border border-border shadow-sm flex items-center justify-center transition-all duration-200 hover:bg-card hover:border-black/12 hover:border-black/12 ${
              editOpen ? "opacity-100 scale-100" : "opacity-0 scale-90 pointer-events-none group-hover/card:opacity-100 group-hover/card:scale-100 group-hover/card:pointer-events-auto"
            }`}
          >
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="left" align="start" className="p-3 w-auto z-50" onOpenAutoFocus={(e) => e.preventDefault()}>
          <SovSlotEditForm
            slot={slot}
            onSave={(changes) => {
              onSlotUpdate(keyword, "after", slot.video_id, changes);
              setEditOpen(false);
              toast.success("分類を更新しました");
            }}
            onCancel={() => setEditOpen(false)}
          />
        </PopoverContent>
      </Popover>
      )}
    </div>
  );
}

// ============================
// Unified Keyword + SOV Section
// ============================

export function UnifiedKeywordSovSection({ positions, bigKeywordReport, sovReport, hasBaseline, campaign, campaignId, onSlotUpdate, readOnly, overviewUniqueAll }: {
  positions: any[];
  bigKeywordReport?: Array<{ keyword: string; before: { ownVideoCount: number; bestRank: number | null }; after: { ownVideoCount: number; bestRank: number | null }; ownVideos?: Array<{ videoId: string; username: string; description: string; rank: number; viewCount: number }> }>;
  sovReport: Record<string, any>;
  hasBaseline: boolean;
  campaign?: any;
  campaignId: number;
  onSlotUpdate: (keyword: string, phase: "before" | "after", videoId: string, changes: any) => void;
  readOnly?: boolean;
  overviewUniqueAll?: { after: { own: number; total: number }; before: { own: number; total: number } };
}) {
  const [activeKw, setActiveKw] = useState<string | null>(null);
  const [expandedKws, setExpandedKws] = useState<Set<string>>(new Set());
  const toggleExpanded = (kw: string) => setExpandedKws(prev => {
    const next = new Set(prev);
    if (next.has(kw)) next.delete(kw); else next.add(kw);
    return next;
  });

  // --- SOV aggregate data ---
  const sovEntries = Object.entries(sovReport);
  const chartData = sovEntries
    .map(([kw, data]) => {
      // 全スロット保持（スマホモック用）— スロット一覧バーは別途 top10 に絞る
      const afterSlots = (data.after_slots || []) as SlotData[];
      const beforeSlots = (data.before_slots || []) as SlotData[];
      // 上位10枠ベースの統計
      const top10After = afterSlots.filter(s => s.rank <= 10);
      const top10Before = beforeSlots.filter(s => s.rank <= 10);
      const slotOwn = top10After.filter(s => s.owner === "own").length;
      // 全取得動画ベース（自社動画カウント用 — 50件中のown数）
      const allOwn = (data.after as any)?.own_count ?? slotOwn;
      const allTotal = (data.after as any)?.total_count ?? afterSlots.length;
      return {
        keyword: kw,
        own: slotOwn,
        total: top10After.length,
        pct: top10After.length > 0 ? Math.round((slotOwn / top10After.length) * 100 * 10) / 10 : 0,
        allOwn,
        allTotal,
        afterSlots,
        beforeSlots,
        before: data.before || {},
        after: data.after || {},
        beforeOwn: top10Before.filter(s => s.owner === "own").length,
        beforeAllOwn: (data.before as any)?.own_count ?? top10Before.filter(s => s.owner === "own").length,
        isBigKeyword: !!data._isBigKeyword,
      };
    })
    .filter(d => d.total > 0);

  const allAfterSlots = chartData.flatMap(d => d.afterSlots);
  // 全体モード: video_idで重複排除してユニーク動画数を算出
  const uniqueAfterSlots = (() => {
    const seen = new Map<string, SlotData>();
    for (const s of allAfterSlots) {
      if (!seen.has(s.video_id)) seen.set(s.video_id, s);
    }
    return [...seen.values()];
  })();
  const totalOwn = uniqueAfterSlots.filter(s => s.owner === "own").length;
  const totalScanned = uniqueAfterSlots.length;
  const avgPct = totalScanned > 0 ? Math.round((totalOwn / totalScanned) * 100 * 10) / 10 : 0;

  const officialCount = uniqueAfterSlots.filter(s => s.owner === "own" && s.owner_detail === "official").length;
  const satelliteCount = uniqueAfterSlots.filter(s => s.owner === "own" && s.owner_detail === "satellite").length;
  const campaignCount = uniqueAfterSlots.filter(s => s.owner === "own" && s.owner_detail === "campaign").length;

  // --- Position data integration ---
  const positionMap = useMemo(() => {
    const map = new Map<string, { beforeRank: number | null; afterRank: number | null; rankChange: number | null }>();
    for (const p of positions) {
      map.set(p.keyword, {
        beforeRank: p.before_rank ?? null,
        afterRank: p.after_rank ?? null,
        rankChange: p.rank_change ?? (p.before_rank != null && p.after_rank != null ? p.before_rank - p.after_rank : null),
      });
    }
    for (const item of bigKeywordReport || []) {
      map.set(item.keyword, {
        beforeRank: item.before.bestRank,
        afterRank: item.after.bestRank,
        rankChange: item.before.bestRank != null && item.after.bestRank != null ? item.before.bestRank - item.after.bestRank : null,
      });
    }
    return map;
  }, [positions, bigKeywordReport]);

  // positionReport: 自社動画の全順位データ（Top10外も含む）
  const positionVideosMap = useMemo(() => {
    const map = new Map<string, Array<{ video_id: string; username: string; description: string; search_rank: number; view_count: number; cover_url: string }>>();
    for (const p of positions) {
      map.set(p.keyword, p.videos || []);
    }
    return map;
  }, [positions]);

  // --- Unified KW list: from sovEntries + positions ---
  const kwList = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ keyword: string; isBigKeyword: boolean; sovData: typeof chartData[0] | null; posData: { beforeRank: number | null; afterRank: number | null; rankChange: number | null } | null }> = [];
    for (const d of chartData) {
      seen.add(d.keyword);
      list.push({ keyword: d.keyword, isBigKeyword: d.isBigKeyword, sovData: d, posData: positionMap.get(d.keyword) || null });
    }
    for (const [kw, pos] of positionMap) {
      if (!seen.has(kw)) {
        list.push({ keyword: kw, isBigKeyword: false, sovData: null, posData: pos });
      }
    }
    return list;
  }, [chartData, positionMap]);

  // null = overview mode (全体). No auto-fallback to first KW.
  const isOverviewMode = activeKw === null;
  const activeKwData = isOverviewMode ? null : kwList.find(k => k.keyword === activeKw) ?? null;

  // Best rank across all KWs
  const bestRankOverall = useMemo(() => {
    let best = 999;
    for (const [, pos] of positionMap) {
      if (pos.afterRank != null && pos.afterRank < best) best = pos.afterRank;
    }
    return best < 999 ? best : null;
  }, [positionMap]);

  // --- Pad slots to 10 (スロット一覧バー用) ---
  const padSlots = (slots: SlotData[]) => {
    const result: (SlotData | null)[] = [];
    for (let i = 1; i <= 10; i++) {
      result.push(slots.find(s => s.rank === i) || null);
    }
    return result;
  };

  // --- Pad slots to 30 (スマホモック用) ---
  const padSlots30 = (slots: SlotData[]) => {
    const maxRank = Math.max(30, ...slots.map(s => s.rank));
    const result: (SlotData | null)[] = [];
    for (let i = 1; i <= Math.min(maxRank, 30); i++) {
      result.push(slots.find(s => s.rank === i) || null);
    }
    return result;
  };

  // Max view count for slot display
  const maxViewCount = useMemo(() => {
    const all = chartData.flatMap(d => [...d.afterSlots, ...d.beforeSlots]);
    return all.length > 0 ? Math.max(...all.map(s => s.view_count)) : 1;
  }, [chartData]);

  return (
    <div className="space-y-5 min-w-0">
      {/* ======== HeroCard ======== */}
      {chartData.length > 0 && (() => {
        // Per-KW hero values when individual KW selected
        const heroKwSov = activeKwData?.sovData;
        const heroPct = isOverviewMode ? avgPct : (heroKwSov ? Math.round((heroKwSov.own / heroKwSov.total) * 100 * 10) / 10 : 0);
        const heroOwn = isOverviewMode ? totalOwn : (heroKwSov?.own || 0);
        const heroTotal = isOverviewMode ? totalScanned : (heroKwSov?.total || 0);
        // 全取得動画ベース（自社動画数） — overviewはユニーク（重複除外）
        const heroAllOwn = isOverviewMode ? (overviewUniqueAll?.after.own ?? chartData.reduce((s, d) => s + d.allOwn, 0)) : (heroKwSov?.allOwn || 0);
        const heroAllTotal = isOverviewMode ? (overviewUniqueAll?.after.total ?? chartData.reduce((s, d) => s + d.allTotal, 0)) : (heroKwSov?.allTotal || 0);

        // Best rank for hero
        const heroBestRank = isOverviewMode ? bestRankOverall : (activeKwData?.posData?.afterRank ?? null);

        // Account breakdown — per-KW or overall（全体は重複排除済み）
        const heroAfterSlots = isOverviewMode ? uniqueAfterSlots : (heroKwSov?.afterSlots || []);
        const heroOfficialCount = heroAfterSlots.filter(s => s.owner === "own" && s.owner_detail === "official").length;
        const heroSatelliteCount = heroAfterSlots.filter(s => s.owner === "own" && s.owner_detail === "satellite").length;
        const heroCampaignCount = heroAfterSlots.filter(s => s.owner === "own" && s.owner_detail === "campaign").length;
        const heroOwnTotal = heroAfterSlots.filter(s => s.owner === "own").length;

        // Stat boxes — different labels for overview vs individual
        const heroStats = isOverviewMode ? [
          { label: "キーワード数", value: `${kwList.length}`, sub: "KW" },
          { label: "自社動画", value: `${heroAllOwn}`, sub: `/${heroAllTotal}` },
          { label: "最高順位", value: bestRankOverall != null ? `${bestRankOverall}` : "—", sub: bestRankOverall != null ? "位" : "" },
          { label: "施策比", value: hasBaseline ? (() => {
            let added = 0;
            for (const d of chartData) {
              const beforeIds = new Set(d.beforeSlots.filter(s => s.owner === "own").map(s => s.video_id));
              added += d.afterSlots.filter(s => s.owner === "own" && !beforeIds.has(s.video_id)).length;
            }
            return `+${added}`;
          })() : "—", sub: hasBaseline ? "本" : "" },
        ] : [
          { label: "上位シェア率", value: `${heroOwn}`, sub: `/${heroTotal}` },
          { label: "自社動画", value: `${heroAllOwn}`, sub: `/${heroAllTotal}` },
          { label: "最高順位", value: heroBestRank != null ? `${heroBestRank}` : "—", sub: heroBestRank != null ? "位" : "" },
          { label: "順位変動", value: (() => {
            const rc = activeKwData?.posData?.rankChange;
            if (rc == null) return "—";
            return rc > 0 ? `+${rc}` : `${rc}`;
          })(), sub: activeKwData?.posData?.rankChange != null ? "位" : "" },
        ];

        return (
        <Card key={activeKw ?? "__overview__"} className="overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
          <CardContent className="p-0">
            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_1fr] gap-0 md:divide-x divide-slate-100 min-w-0">
              {/* Donut — アカウント種別ごとにセグメント分け */}
              <div className="flex flex-col items-center justify-center py-6 px-4">
                {(() => {
                  const circumference = 2 * Math.PI * 50; // ≈314
                  const totalPct = heroPct; // 全体シェア率
                  // 各アカウント種別のセグメント（ドーナツ上の比率はheroTotalに対する割合）
                  const segments = [
                    { count: heroOfficialCount, color: "#2563eb", label: "公式" },
                    { count: heroSatelliteCount, color: "#0d9488", label: "サテライト" },
                    { count: heroCampaignCount, color: "#D71921", label: "施策" },
                  ];
                  let offset = 0;
                  return (
                    <>
                      <svg viewBox="0 0 120 120" className="w-28 h-28">
                        {/* 背景リング */}
                        <circle cx="60" cy="60" r="50" fill="none" stroke="#e5e5e5" strokeWidth="12" />
                        {/* アカウント種別セグメント */}
                        {segments.map(seg => {
                          if (seg.count === 0 || heroTotal === 0) return null;
                          const segPct = (seg.count / heroTotal) * 100;
                          const dashLen = (segPct / 100) * circumference;
                          const dashGap = circumference - dashLen;
                          const rotation = -90 + (offset / 100) * 360;
                          offset += segPct;
                          return (
                            <circle
                              key={seg.label}
                              cx="60" cy="60" r="50" fill="none"
                              stroke={seg.color} strokeWidth="12"
                              strokeDasharray={`${dashLen} ${dashGap}`}
                              transform={`rotate(${rotation} 60 60)`}
                              className="animate-donut-fill"
                            />
                          );
                        })}
                        {/* 中央テキスト — 垂直中央配置 */}
                        <text x="60" y="55" textAnchor="middle" dominantBaseline="central" className="text-[26px] font-extrabold" fill="#0a0a0a">{heroPct}<tspan className="text-[14px] font-medium" fill="#9ca3af">%</tspan></text>
                        <text x="60" y="77" textAnchor="middle" dominantBaseline="central" className="text-[10px] font-medium" fill="#9ca3af">上位シェア ({heroOwn}/{heroTotal})</text>
                      </svg>
                      <p className="text-xs text-muted-foreground mt-1.5">全{heroAllTotal}本中 {heroAllOwn}本が自社</p>
                      {/* ミニ内訳 */}
                      <div className="flex items-center gap-2 mt-1">
                        {segments.filter(s => s.count > 0).map(seg => (
                          <span key={seg.label} className="inline-flex items-center gap-1 text-[9px] text-muted-foreground">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: seg.color }} />
                            {seg.count}
                          </span>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* 4 stat boxes */}
              <div className="grid grid-cols-2 gap-px bg-[#f5f5f5] min-w-0">
                {heroStats.map((stat, i) => (
                  <div key={i} className="bg-[#f5f5f5] flex flex-col items-center justify-center py-4 px-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{stat.label}</p>
                    <p className="text-2xl font-extrabold text-foreground leading-none">{stat.value}<span className="text-sm font-normal text-muted-foreground ml-0.5">{stat.sub}</span></p>
                  </div>
                ))}
              </div>

              {/* Account breakdown */}
              <div className="flex flex-col justify-center py-5 px-5 gap-3 min-w-0">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">アカウント内訳</p>
                {[
                  { label: "公式", count: heroOfficialCount, color: "bg-blue-600", textColor: "text-blue-700" },
                  { label: "サテライト", count: heroSatelliteCount, color: "bg-teal-600", textColor: "text-teal-700" },
                  { label: "施策", count: heroCampaignCount, color: "bg-[#D71921]", textColor: "text-[#D71921]" },
                ].map(cat => {
                  const pct = heroOwnTotal > 0 ? (cat.count / heroOwnTotal) * 100 : 0;
                  return (
                    <div key={cat.label} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className={`font-medium ${cat.textColor}`}>{cat.label}</span>
                        <span className="text-muted-foreground tabular-nums">{cat.count}本</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[#f5f5f5] overflow-hidden">
                        <div className={`h-full rounded-full ${cat.color} transition-all`} style={{ width: `${pct}%`, minWidth: cat.count > 0 ? '4px' : 0 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
        );
      })()}

      {/* ======== KwTabBar ======== */}
      {kwList.length > 0 && (
        <div className="overflow-x-auto min-w-0">
          <div className="flex gap-2 min-w-max">
            {/* 全体 (overview) button */}
            <button
              onClick={() => setActiveKw(null)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                isOverviewMode
                  ? "bg-blue-600 text-white shadow-md"
                  : "bg-[#f5f5f5] text-muted-foreground hover:bg-[#e5e5e5]"
              }`}
            >
              全体
              <span className={`text-[11px] font-bold tabular-nums ${isOverviewMode ? "text-blue-200" : "text-muted-foreground"}`}>
                {totalOwn}/{totalScanned}
              </span>
            </button>
            {kwList.filter(kw => (kw.sovData?.total || 0) > 0).map(kw => {
              const isActive = kw.keyword === activeKw;
              const ownCount = kw.sovData?.own || 0;
              const totalCount = kw.sovData?.total || 0;
              return (
                <button
                  key={kw.keyword}
                  onClick={() => setActiveKw(kw.keyword)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                    isActive
                      ? "bg-blue-600 text-white shadow-md"
                      : "bg-[#f5f5f5] text-muted-foreground hover:bg-[#e5e5e5]"
                  }`}
                >
                  {kw.keyword}
                  {totalCount > 0 && (
                    <span className={`text-[11px] font-bold tabular-nums ${isActive ? "text-blue-200" : "text-muted-foreground"}`}>
                      {ownCount}/{totalCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ======== KwTabContent — unified phone + slot card ======== */}
      {(activeKwData || isOverviewMode) && (() => {
        if (isOverviewMode) {
          // Overview mode: flat grid of After phone cards (no 3D carousel)
          const hasAnyCarouselData = chartData.some(d => d.afterSlots.length > 0 || d.beforeSlots.length > 0);
          if (!hasAnyCarouselData) return null;
          return (
            <div className="space-y-5">
              <Card>
                <CardContent className="p-0">
                  {/* Legend */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 border-b border-black/4 text-[10px] text-muted-foreground">
                    <span className="text-[9px] text-muted-foreground font-semibold tracking-wider uppercase mr-1">アカウント</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-[3px] bg-blue-600" />公式</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-[3px] bg-teal-600" />サテライト</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-[3px] bg-[#D71921]" />施策</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-[3px] bg-slate-500" />競合</span>
                    <span className="w-px h-3 bg-black/8 mx-1" />
                    <span className="text-[9px] text-muted-foreground font-semibold tracking-wider uppercase mr-1">ジャンル</span>
                    {Object.entries(GENRE_CONFIG).map(([key, { label, barCls }]) => (
                      <span key={key} className="flex items-center gap-1">
                        <span className={`w-3 h-1 rounded-full ${barCls}`} />
                        {label}
                      </span>
                    ))}
                    <span className="w-px h-3 bg-black/8 mx-1" />
                    <span className="text-[9px] text-muted-foreground font-semibold tracking-wider uppercase mr-1">ラベル</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />有償</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-teal-500" />AI生成</span>
                  </div>
                  {/* Horizontal row of After phone cards */}
                  <div className="px-4 py-5">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="text-[11px] uppercase tracking-[0.2em] text-[#a3a3a3] font-medium">検索結果の変化</span>
                    </div>
                    {(() => {
                      const visibleKws = chartData.filter(d => d.afterSlots.length > 0);
                      const PW = 220, PH = 476; // phone chassis actual height
                      const labelH = 30; // "Current" + subtitle text
                      const totalH = PH + labelH;
                      const sc = visibleKws.length <= 2 ? 1.15 : visibleKws.length <= 4 ? 0.95 : 0.75;
                      return (
                        <div className="flex justify-center gap-3 overflow-x-auto pb-2 min-w-0">
                          {visibleKws.map(d => {
                            const aPct = d.total > 0 ? Math.round((d.own / d.total) * 100) : 0;
                            return (
                              <button key={d.keyword} onClick={() => setActiveKw(d.keyword)}
                                className="flex flex-col items-center gap-1.5 flex-shrink-0 cursor-pointer group/phone">
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide bg-[#171717] text-white">
                                  <Search className="w-[9px] h-[9px] opacity-60" />
                                  {d.keyword}
                                </span>
                                <div style={{ width: PW * sc, height: totalH * sc, overflow: "hidden" }}>
                                  <div className="transition-transform duration-300 group-hover/phone:scale-[1.04] origin-top-left"
                                    style={{ transform: `scale(${sc})`, transformOrigin: "top left", width: PW }}>
                                    <div className="space-y-0.5 text-center mb-1.5">
                                      <span className="text-[14px] font-mono text-foreground font-bold tracking-wider block">Current</span>
                                      <span className="text-[13px] text-blue-600 font-semibold block">{d.own}/{d.total}枠</span>
                                    </div>
                                    <TikTokSearchMock slots={padSlots30(d.afterSlots)} keyword={d.keyword} />
                                  </div>
                                </div>
                                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-[#e5e5e5] shadow-md">
                                  <span className={`text-[11px] font-bold ${aPct >= 30 ? "text-emerald-600" : "text-muted-foreground"}`}>{d.own}/{d.total}</span>
                                  <span className="text-[10px] text-[#b0b0b0]">上位シェア</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        }

        const hasSovData = !!activeKwData!.sovData && activeKwData!.sovData.afterSlots.length > 0;
        const activeChartEntry = chartData.find(d => d.keyword === activeKw);
        const hasCarouselData = !!activeChartEntry && (activeChartEntry.afterSlots.length > 0 || activeChartEntry.beforeSlots.length > 0);
        const showCard = hasSovData || hasCarouselData;

        // SOV calculations (safe even when no sovData)
        // activeKwData is guaranteed non-null here (overview returned early above)
        const sovData = activeKwData!.sovData;
        // 上位10枠のみ表示（30枠 → 10枠に絞る）
        const afterSlotsAll = sovData?.afterSlots || [];
        const beforeSlotsAll = sovData?.beforeSlots || [];
        const afterSlots = afterSlotsAll.filter(s => s.rank <= 10);
        const beforeSlots = beforeSlotsAll.filter(s => s.rank <= 10);
        const afterOwnCount = afterSlots.filter(s => s.owner === "own").length;
        const beforeOwnCount = beforeSlots.filter(s => s.owner === "own").length;
        const ownChange = afterOwnCount - beforeOwnCount;
        const paddedBefore = padSlots(beforeSlots);
        const paddedAfter = padSlots(afterSlots);
        const slotCount = 10;
        const afterPct = afterSlots.length > 0 ? Math.round((afterOwnCount / slotCount) * 100 * 10) / 10 : 0;
        const beforePct = beforeSlots.length > 0 ? Math.round((beforeOwnCount / slotCount) * 100 * 10) / 10 : 0;
        const pctChange = Number((afterPct - beforePct).toFixed(1));

        const countGenres = (slots: SlotData[]) => {
          const counts: Record<string, number> = {};
          for (const g of Object.keys(GENRE_CONFIG)) counts[g] = 0;
          for (const s of slots) {
            const g = GENRE_CONFIG[s.genre] ? s.genre : "other";
            counts[g] = (counts[g] || 0) + 1;
          }
          return counts;
        };
        const beforeGenres = countGenres(beforeSlots);
        const afterGenres = countGenres(afterSlots);
        const beforeNeg = beforeGenres.negative || 0;
        const afterNeg = afterGenres.negative || 0;
        const negChange = afterNeg - beforeNeg;

        const beforeVideoRankMap = new Map<string, number>();
        for (const s of beforeSlots) beforeVideoRankMap.set(s.video_id, s.rank);
        const getRankChange = (slot: SlotData): { label: string; color: string } | null => {
          if (slot.owner !== "own" || !hasBaseline || beforeSlots.length === 0) return null;
          const prevRank = beforeVideoRankMap.get(slot.video_id);
          if (prevRank != null) {
            const diff = prevRank - slot.rank;
            if (diff > 0) return { label: `前#${prevRank} ↑${diff}`, color: "bg-black/55" };
            if (diff < 0) return { label: `前#${prevRank} ↓${Math.abs(diff)}`, color: "bg-black/55" };
            return { label: `前#${prevRank} →0`, color: "bg-black/55" };
          }
          return { label: "NEW", color: "bg-white" };
        };

        const renderSlotInRow = (slot: SlotData | null, i: number, isBefore: boolean) => {
          if (!slot) return (
            <div key={i} className="flex flex-col items-center flex-1 max-w-[100px]">
              <span className="text-[10px] font-semibold text-slate-300/60 mb-0.5">#{i + 1}</span>
              <div className={`w-full ${isBefore ? "h-[85px]" : "h-[100px]"} rounded-md border border-dashed border-border/40 flex items-center justify-center`}>
                <span className="text-[9px] text-slate-200">{i + 1}</span>
              </div>
            </div>
          );
          const rc = !isBefore ? getRankChange(slot) : null;
          const slotIsOwn = slot.owner === "own";
          return (
            <div key={i} className="flex flex-col items-center flex-1 max-w-[100px]">
              <span className="text-[10px] font-semibold text-slate-300 mb-0.5">#{i + 1}</span>
              <SovSlotCell
                slot={slot} maxViewCount={maxViewCount} keyword={activeKwData!.keyword}
                phase={isBefore ? "before" : "after"} isBefore={isBefore}
                onSlotUpdate={onSlotUpdate} readOnly={readOnly}
                rankChangeLabel={rc?.label} rankChangeBadgeColor={rc?.color}
              />
              {/* Circular avatar + account name (matching IG style) */}
              <div className="flex flex-col items-center gap-0.5 mt-1.5">
                <div className={`w-5 h-5 rounded-full overflow-hidden shrink-0 ${slotIsOwn ? "ring-[1.5px] ring-[#D71921]" : "ring-[1px] ring-slate-200"}`}>
                  {slot.cover_url ? (
                    <img src={slot.cover_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-slate-200 to-slate-300" />
                  )}
                </div>
                <span className={`text-[8px] truncate max-w-full text-center leading-none ${slotIsOwn ? "font-semibold text-[#D71921]" : "text-[#a3a3a3]"}`}>
                  @{slot.creator_username}
                </span>
              </div>
            </div>
          );
        };

        return (
          <div className="space-y-5">
            {/* Animated collapse wrapper — grid-rows trick for smooth height */}
            <div
              className="grid transition-all min-w-0"
              style={{
                gridTemplateRows: showCard ? "1fr" : "0fr",
                opacity: showCard ? 1 : 0,
                transform: showCard ? "translateY(0) scale(1)" : "translateY(-16px) scale(0.97)",
                transitionProperty: "grid-template-rows, opacity, transform",
                transitionDuration: showCard ? "700ms, 600ms, 600ms" : "500ms, 400ms, 400ms",
                transitionTimingFunction: "var(--md-ease-emphasized-decel)",
                transitionDelay: showCard ? "0ms, 60ms, 60ms" : "0ms",
              }}
            >
              <div className="overflow-hidden">
              <Card>
                <CardContent className="p-0">
                  {/* Legend — compact pill bar */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 border-b border-black/4 text-[10px] text-muted-foreground">
                    <span className="text-[9px] text-muted-foreground font-semibold tracking-wider uppercase mr-1">アカウント</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-[3px] bg-blue-600" />公式</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-[3px] bg-teal-600" />サテライト</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-[3px] bg-[#D71921]" />施策</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-[3px] bg-slate-500" />競合</span>
                    <span className="w-px h-3 bg-black/8 mx-1" />
                    <span className="text-[9px] text-muted-foreground font-semibold tracking-wider uppercase mr-1">ジャンル</span>
                    {Object.entries(GENRE_CONFIG).map(([key, { label, barCls }]) => (
                      <span key={key} className="flex items-center gap-1">
                        <span className={`w-3 h-1 rounded-full ${barCls}`} />
                        {label}
                      </span>
                    ))}
                    <span className="w-px h-3 bg-black/8 mx-1" />
                    <span className="text-[9px] text-muted-foreground font-semibold tracking-wider uppercase mr-1">ラベル</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />有償</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-teal-500" />AI生成</span>
                  </div>

                  {/* Phone carousel — embedded, left-aligned */}
                  {hasCarouselData && (
                    <div className="border-b border-black/4">
                      <TikTokMockStage
                        kwEntries={chartData.map(d => ({
                          keyword: d.keyword,
                          paddedBefore: padSlots30(d.beforeSlots),
                          paddedAfter: padSlots30(d.afterSlots),
                          showBefore: hasBaseline && d.beforeSlots.length > 0,
                          bOwnCount: d.beforeOwn,
                          aOwnCount: d.own,
                          bTotal: d.beforeSlots.length,
                          aTotal: d.total,
                          bPct: d.beforeSlots.length > 0 ? Math.round((d.beforeOwn / d.beforeSlots.length) * 100) : 0,
                          aPct: d.total > 0 ? Math.round((d.own / d.total) * 100) : 0,
                        }))}
                        activeKw={activeKw}
                        onActiveKwChange={setActiveKw}
                      />
                    </div>
                  )}

                  {/* Slot rows — only when sovData exists */}
                  {hasSovData && (
                    <div className="px-5 py-4 space-y-4">
                      {hasBaseline && beforeSlots.length > 0 ? (
                        <>
                          {/* ===== Before → After 比較レイアウト ===== */}
                          {/* ヘッダー行: Before → After */}
                          <div className="flex items-center gap-3">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#f5f5f5] text-muted-foreground tracking-wide uppercase">Before</span>
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              自社 {beforeOwnCount}/{slotCount} ({beforePct}%)
                            </span>
                            <span className="text-[16px] text-[#a3a3a3] mx-1">→</span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#0a0a0a] text-white tracking-wide uppercase">After</span>
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              自社 {afterOwnCount}/{slotCount} ({afterPct}%)
                            </span>
                            <span className={`text-[11px] font-bold tabular-nums ${ownChange > 0 ? "text-emerald-600" : ownChange < 0 ? "text-[#D71921]" : "text-muted-foreground"}`}>
                              ({ownChange > 0 ? "+" : ""}{ownChange}本)
                            </span>
                          </div>

                          {/* Before / After 2段 */}
                          <div className="space-y-3">
                            <div className="flex items-end w-full gap-0.5 overflow-x-auto pb-1 min-w-0">
                              {paddedBefore.map((slot, i) => renderSlotInRow(slot, i, true))}
                            </div>
                            <div className="flex items-end w-full gap-0.5 overflow-x-auto pb-1 min-w-0">
                              {paddedAfter.map((slot, i) => renderSlotInRow(slot, i, false))}
                            </div>
                          </div>

                          {/* ===== ジャンル変動サマリー (横スクロール pill) ===== */}
                          <div className="flex items-center gap-1.5 overflow-x-auto py-2 -mx-1 px-1">
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#f5f5f5] text-secondary-foreground whitespace-nowrap">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#0a0a0a] shrink-0" />
                              施策動画
                              <span className={`font-bold tabular-nums ${ownChange > 0 ? "text-emerald-600" : ownChange < 0 ? "text-[#D71921]" : "text-muted-foreground"}`}>
                                {beforeOwnCount}→{afterOwnCount}{ownChange !== 0 && ` (${ownChange > 0 ? "+" : ""}${ownChange})`}
                              </span>
                            </div>
                            {Object.entries(GENRE_CONFIG).map(([key, { label, barCls }]) => {
                              const bCount = beforeGenres[key] || 0;
                              const aCount = afterGenres[key] || 0;
                              const change = aCount - bCount;
                              return (
                                <div key={key} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap ${
                                  key === "negative" && change !== 0 ? "bg-red-50 text-[#D71921]" : "bg-[#f5f5f5] text-secondary-foreground"
                                }`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${barCls} shrink-0`} />
                                  {label}
                                  <span className={`font-bold tabular-nums ${change > 0 ? "text-emerald-600" : change < 0 ? "text-[#D71921]" : "text-muted-foreground"}`}>
                                    {bCount}→{aCount}{change !== 0 && ` (${change > 0 ? "+" : ""}${change})`}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        /* ===== ベースラインなし — Current のみ ===== */
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#0a0a0a] text-white tracking-wide uppercase">Current</span>
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              自社 {afterOwnCount}/{slotCount} ({afterPct}%)
                            </span>
                          </div>
                          <div className="grid grid-cols-5 sm:grid-cols-10 gap-0.5">
                            {paddedAfter.map((slot, i) => renderSlotInRow(slot, i, false))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ===== Bottom summary strip ===== */}
                  {hasSovData && (
                    <div className="border-t border-black/4">
                      {/* Change summary */}
                      {hasBaseline && beforeSlots.length > 0 && (
                        <div className="flex justify-center gap-6 px-5 py-2.5 text-[12px] font-semibold border-b border-black/4">
                          <span className={pctChange > 0 ? "text-emerald-600" : pctChange < 0 ? "text-[#D71921]" : "text-muted-foreground"}>
                            上位シェア {beforeOwnCount}/{slotCount} → {afterOwnCount}/{slotCount}（{ownChange > 0 ? "+" : ""}{ownChange}本）
                          </span>
                          <span className="text-black/10">|</span>
                          <span className={negChange < 0 ? "text-[#D71921]" : negChange > 0 ? "text-emerald-600" : "text-muted-foreground"}>
                            ネガティブ {beforeNeg} → {afterNeg}本（{negChange < 0 ? "" : negChange > 0 ? "+" : "±"}{negChange}）
                          </span>
                        </div>
                      )}

                      {/* Stats row — flush bottom */}
                      {(() => {
                        const afterRank = activeKwData!.posData?.afterRank;
                        const rankChange = activeKwData!.posData?.rankChange;
                        return (
                          <div className="grid grid-cols-3 divide-x divide-black/4 min-w-0">
                            <div className="flex flex-col items-center gap-0.5 py-3">
                              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">上位シェア率</span>
                              <span className="text-xl font-black text-foreground tabular-nums">{afterOwnCount}<span className="text-xs font-normal text-muted-foreground ml-0.5">/{slotCount}</span></span>
                              {hasBaseline && beforeSlots.length > 0 && <ChangeIndicator value={ownChange} suffix="本" />}
                            </div>
                            <div className="flex flex-col items-center gap-0.5 py-3">
                              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">自社動画</span>
                              <span className="text-xl font-black text-foreground tabular-nums">{sovData?.allOwn || 0}<span className="text-xs font-normal text-muted-foreground ml-0.5">/{sovData?.allTotal || 0}</span></span>
                              {hasBaseline && beforeSlots.length > 0 && <ChangeIndicator value={(sovData?.allOwn || 0) - (sovData?.beforeAllOwn || 0)} suffix="本" />}
                            </div>
                            <div className="flex flex-col items-center gap-0.5 py-3">
                              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">最高順位</span>
                              {afterRank != null ? (
                                <>
                                  <span className="text-xl font-black text-foreground tabular-nums">{afterRank}<span className="text-xs font-normal ml-0.5">位</span></span>
                                  {hasBaseline && rankChange != null && <ChangeIndicator value={rankChange} suffix="位" />}
                                </>
                              ) : (
                                <span className="text-xl font-black text-slate-300">—</span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </CardContent>
              </Card>
              </div>
            </div>

            {/* OwnVideoCards removed */}
          </div>
        );
      })()}

      {/* ======== KwSummaryTable (アコーディオン付き) ======== */}
      {kwList.length > 0 && (
        <Card>
          <CardContent className="p-0 overflow-x-auto min-w-0">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-card border-b border-border">
                  <th className="py-2.5 px-4 text-left text-xs font-semibold text-muted-foreground">キーワード</th>
                  <th className="py-2.5 px-3 text-left text-xs font-semibold text-muted-foreground w-40">上位シェア率</th>
                  <th className="py-2.5 px-3 text-center text-xs font-semibold text-muted-foreground whitespace-nowrap">自社動画</th>
                  <th className="py-2.5 px-3 text-center text-xs font-semibold text-muted-foreground whitespace-nowrap">最高順位</th>
                  <th className="py-2.5 px-3 text-center text-xs font-semibold text-muted-foreground whitespace-nowrap">順位変動</th>
                </tr>
              </thead>
              <tbody>
                {kwList.filter(kw => (kw.sovData?.total || 0) > 0 || kw.posData?.afterRank != null).map(kw => {
                  const own = kw.sovData?.own || 0;
                  const slotTotal = kw.sovData?.total || 0;
                  const allOwn = kw.sovData?.allOwn || 0;
                  const allTotal = kw.sovData?.allTotal || 0;
                  const afterRank = kw.posData?.afterRank;
                  const rankChange = kw.posData?.rankChange;
                  const isExpanded = expandedKws.has(kw.keyword);

                  // アコーディオン用: afterSlots(top10) + positionReport自社動画(10位以降)
                  const afterSlots = kw.sovData?.afterSlots || [];
                  const posVideos = positionVideosMap.get(kw.keyword) || [];
                  const slotsVideoIds = new Set(afterSlots.map(s => s.video_id));
                  const extraOwnVideos = posVideos.filter(v => !slotsVideoIds.has(v.video_id));

                  return (
                    <Fragment key={kw.keyword}>
                    <tr
                      className={`border-b border-black/4 hover:bg-card/40 transition-colors cursor-pointer ${kw.keyword === activeKw ? "bg-card/60" : ""}`}
                      onClick={() => { setActiveKw(kw.keyword); toggleExpanded(kw.keyword); }}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`} />
                          <span className="font-medium text-sm text-foreground">{kw.keyword}</span>
                          {kw.isBigKeyword && <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 text-muted-foreground border-black/8 bg-card">ビッグKW</Badge>}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-[#f5f5f5] overflow-hidden">
                            <div className="h-full rounded-full bg-[#0a0a0a] transition-all" style={{ width: `${slotTotal > 0 ? (own / slotTotal) * 100 : 0}%` }} />
                          </div>
                          <span className="text-xs font-bold text-foreground tabular-nums w-10 text-right">{own}<span className="text-[10px] font-normal text-muted-foreground">/{slotTotal}</span></span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="text-sm font-bold text-foreground">{allOwn}<span className="text-xs font-normal text-muted-foreground">/{allTotal}</span></span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        {afterRank != null ? (
                          <span className={`text-sm font-bold ${afterRank <= 3 ? "text-[#D71921]" : afterRank <= 10 ? "text-foreground" : "text-muted-foreground"}`}>{afterRank}位</span>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {hasBaseline && rankChange != null ? (
                          <ChangeIndicator value={rankChange} suffix="位" />
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                    {/* アコーディオン展開部分 — 施策動画のみ表示 */}
                    {isExpanded && (() => {
                      // Top10内の自社動画
                      const ownSlots = afterSlots.filter(s => s.owner === "own");
                      // 全自社動画（Top10 + positionReport 10位以降）を統合してrank順
                      const allOwnVideos = [
                        ...ownSlots.map(s => ({ video_id: s.video_id, rank: s.rank, cover_url: s.cover_url || "", description: s.description, username: s.creator_username, view_count: s.view_count, detail: s.owner_detail })),
                        ...extraOwnVideos.map(v => ({ video_id: v.video_id, rank: v.search_rank, cover_url: v.cover_url || "", description: v.description, username: v.username, view_count: v.view_count, detail: undefined as string | undefined })),
                      ].sort((a, b) => a.rank - b.rank);
                      return (
                      <tr>
                        <td colSpan={5} className="p-0">
                          <div className="bg-background border-b border-border">
                            {allOwnVideos.length > 0 ? (
                              <div className="divide-y divide-black/4">
                                {allOwnVideos.map(v => (
                                  <div key={v.video_id} className="flex items-center gap-3 px-6 py-2.5">
                                    <span className="w-6 text-center text-xs font-bold tabular-nums shrink-0 text-[#D71921]">{v.rank}位</span>
                                    {v.cover_url ? (
                                      <img src={v.cover_url} alt="" className="w-10 h-10 rounded object-cover shrink-0 bg-[#f0f0f0]" />
                                    ) : (
                                      <div className="w-10 h-10 rounded bg-[#e5e5e5] shrink-0" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs text-foreground truncate leading-snug">{v.description || "—"}</p>
                                      <p className="text-[10px] text-muted-foreground">@{v.username}</p>
                                    </div>
                                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 shrink-0 border-[#D71921]/20 text-[#D71921] bg-[#D71921]/5">
                                      {v.detail === "official" ? "公式" : v.detail === "satellite" ? "サテライト" : "施策"}
                                    </Badge>
                                    <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{v.view_count >= 10000 ? `${(v.view_count / 10000).toFixed(1)}万` : v.view_count.toLocaleString()}再生</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground text-center py-4">このキーワードに施策動画なし</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                    })()}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================
// Section 3: Videos (After only)
// ============================

function getScoreGradeColor(score: number | undefined): string {
  if (score == null) return "bg-muted text-muted-foreground";
  if (score >= 90) return "bg-[#f5f5f5] text-[#D71921] border-[#D71921]/30"; // S
  if (score >= 75) return "bg-green-100 text-green-800 border-green-300";   // A
  if (score >= 60) return "bg-[#f5f5f5] text-secondary-foreground border-black/8";      // B
  if (score >= 40) return "bg-card text-muted-foreground border-black/8"; // C
  return "bg-red-50 text-[#D71921] border-[#D71921]/30";                          // D
}

function SlantedXTick({ x, y, payload, urlMap }: any) {
  const lines = (payload.value || "").split("\n");
  const url = urlMap?.[payload.value];
  const accountEl = url
    ? <a href={url} target="_blank" rel="noopener noreferrer"><text x={0} y={0} dy={10} textAnchor="end" fontSize={10} fill="#0a0a0a" style={{ cursor: "pointer" }}>{lines[0]}</text></a>
    : <text x={0} y={0} dy={10} textAnchor="end" fontSize={10} fill="#525252">{lines[0]}</text>;
  return (
    <g transform={`translate(${x},${y}) rotate(-35)`}>
      {accountEl}
      {lines[1] && <text x={0} y={0} dy={22} textAnchor="end" fontSize={9} fill="#6b7280">{lines[1]}</text>}
    </g>
  );
}

function VideoChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#f5f5f5] border rounded-lg shadow-none p-2 text-xs">
      <p className="font-medium mb-1 whitespace-pre-line">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium">{Number(entry.value).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function TrackingToggle({ campaignId }: { campaignId: number }) {
  const statusQuery = trpc.campaign.getTrackingStatus.useQuery({ campaignId }, { enabled: campaignId > 0 });
  const toggleMut = trpc.campaign.toggleDailyTracking.useMutation({
    onSuccess: () => { statusQuery.refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const status = statusQuery.data;
  if (!status) return null;

  return (
    <div className="flex items-center gap-1.5 border rounded-md px-2 py-1">
      <span className="text-xs text-muted-foreground whitespace-nowrap">定期観測</span>
      <Switch
        checked={status.enabled}
        onCheckedChange={(checked) => toggleMut.mutate({ campaignId, enabled: checked })}
        disabled={toggleMut.isPending}
        className="scale-75"
      />
    </div>
  );
}

export function VideoSection({ videos, videoScores, hasBaseline = true, dailyMetrics, keywords, bigKeywords }: { videos: any[]; videoScores?: any[]; hasBaseline?: boolean; dailyMetrics?: any[]; keywords?: string[]; bigKeywords?: string[] }) {
  const kwSet = useMemo(() => new Set((keywords || []).map(k => k.replace(/^#/, "").toLowerCase())), [keywords]);
  const bigKwSet = useMemo(() => new Set((bigKeywords || []).map(k => k.replace(/^#/, "").toLowerCase())), [bigKeywords]);
  const SORT_OPTIONS = [
    { key: "views", label: "再生数" },
    { key: "likes", label: "いいね" },
    { key: "comments", label: "コメント" },
    { key: "saves", label: "保存" },
    { key: "shares", label: "シェア" },
    { key: "er", label: "ER" },
    { key: "date", label: "投稿日" },
  ];
  const [sortBy, setSortBy] = useState("views");
  const [sparkMetric, setSparkMetric] = useState<"views" | "likes" | "comments" | "shares" | "saves">("views");
  const bestVideoId = videos.reduce((best, v) => {
    const views = v.after?.viewCount || 0;
    return views > (best.views || 0) ? { id: v.videoId, views } : best;
  }, { id: "", views: 0 }).id;

  // dailyMetricsから各動画の最新値を取得
  const latestByUrl = useMemo(() => {
    const map = new Map<string, { viewCount: number; likeCount: number; commentCount: number; shareCount: number; saveCount: number }>();
    if (!dailyMetrics) return map;
    for (const dm of dailyMetrics) {
      if (dm.platform && dm.platform !== "tiktok") continue;
      const url = dm.videoUrl;
      if (!url) continue;
      const existing = map.get(url);
      const dateKey = dm.dateKey || "";
      if (!existing || dateKey > (existing as any)._dk) {
        map.set(url, {
          viewCount: dm.viewCount || 0, likeCount: dm.likeCount || 0,
          commentCount: dm.commentCount || 0, shareCount: dm.shareCount || 0,
          saveCount: dm.saveCount || 0, _dk: dateKey,
        } as any);
      }
    }
    return map;
  }, [dailyMetrics]);

  // サマリー（dailyMetrics最新値を優先）
  const { totalViews, totalLikes, totalComments, totalShares, totalSaves, avgEr } = useMemo(() => {
    let views = 0, likes = 0, comments = 0, shares = 0, saves = 0;
    for (const v of videos) {
      const url = v.videoUrl || "";
      const dm = latestByUrl.get(url);
      views += Math.max(dm?.viewCount || 0, v.after?.viewCount || 0);
      likes += Math.max(dm?.likeCount || 0, v.after?.likeCount || 0);
      comments += Math.max(dm?.commentCount || 0, v.after?.commentCount || 0);
      shares += Math.max(dm?.shareCount || 0, v.after?.shareCount || 0);
      saves += Math.max(dm?.saveCount || 0, v.after?.saveCount || 0);
    }
    const er = views > 0 ? Number(((likes + comments + shares) / views * 100).toFixed(2)) : 0;
    return { totalViews: views, totalLikes: likes, totalComments: comments, totalShares: shares, totalSaves: saves, avgEr: er };
  }, [videos, latestByUrl]);

  // ソート（dailyMetrics最新値を優先して正確な値でソート）
  const sortedVideos = useMemo(() => {
    return [...videos].sort((a, b) => {
      const getVal = (v: any) => {
        const url = v.videoUrl || "";
        const dm = latestByUrl.get(url);
        const vw = Math.max(dm?.viewCount || 0, v.after?.viewCount || 0);
        const lk = Math.max(dm?.likeCount || 0, v.after?.likeCount || 0);
        const cm = Math.max(dm?.commentCount || 0, v.after?.commentCount || 0);
        const sh = Math.max(dm?.shareCount || 0, v.after?.shareCount || 0);
        const sv = Math.max(dm?.saveCount || 0, v.after?.saveCount || 0);
        switch (sortBy) {
          case "views": return vw;
          case "likes": return lk;
          case "comments": return cm;
          case "saves": return sv;
          case "shares": return sh;
          case "er": return vw > 0 ? (lk + cm + sh) / vw * 100 : 0;
          case "date": return v.postedAt ? new Date(v.postedAt).getTime() : 0;
          default: return 0;
        }
      };
      return getVal(b) - getVal(a);
    });
  }, [videos, sortBy, latestByUrl]);

  // dailyMetrics累積チャート
  const hasDailyData = dailyMetrics && dailyMetrics.length > 0;

  return (
    <div className="space-y-4 min-w-0">
      {/* サマリー */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card><CardContent className="py-3 px-4 text-center">
          <p className="text-xs text-muted-foreground">総投稿数</p>
          <p className="text-xl font-bold">{videos.length}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4 text-center">
          <p className="text-xs text-muted-foreground">総再生数</p>
          <p className="text-xl font-bold">{fmt(totalViews)}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4 text-center">
          <p className="text-xs text-muted-foreground">総いいね</p>
          <p className="text-xl font-bold">{fmt(totalLikes)}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4 text-center">
          <p className="text-xs text-muted-foreground">総コメント</p>
          <p className="text-xl font-bold">{fmt(totalComments)}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4 text-center">
          <p className="text-xs text-muted-foreground">総保存</p>
          <p className="text-xl font-bold">{fmt(totalSaves)}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4 text-center">
          <p className="text-xs text-muted-foreground">平均ER</p>
          <p className="text-xl font-bold">{avgEr}%</p>
        </CardContent></Card>
      </div>

      {/* Report A: パフォーマンス推移（累積 / 日次切替） */}
      {hasBaseline && videos.length > 0 && hasDailyData && (
        <TikTokPerformanceChart dailyMetrics={dailyMetrics!} videos={videos} />
      )}
      {hasBaseline && videos.length > 0 && !hasDailyData && (() => {
        const dayMap = new Map<string, { views: number; likes: number; comments: number; saves: number; shares: number }>();
        for (const v of videos) {
          if (!v.postedAt) continue;
          const dateKey = v.postedAt.split("T")[0];
          const entry = dayMap.get(dateKey) || { views: 0, likes: 0, comments: 0, saves: 0, shares: 0 };
          entry.views += v.after?.viewCount || 0;
          entry.likes += v.after?.likeCount || 0;
          entry.comments += v.after?.commentCount || 0;
          entry.saves += v.after?.saveCount || 0;
          entry.shares += v.after?.shareCount || 0;
          dayMap.set(dateKey, entry);
        }
        const sortedDays = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b));
        let cumViews = 0, cumLikes = 0, cumComments = 0, cumSaves = 0, cumShares = 0;
        const lineData = sortedDays.map(([dateKey, d]) => {
          cumViews += d.views; cumLikes += d.likes; cumComments += d.comments; cumSaves += d.saves; cumShares += d.shares;
          return { name: `${new Date(dateKey).getMonth() + 1}/${new Date(dateKey).getDate()}`, 再生数: cumViews, いいね: cumLikes, コメント: cumComments, 保存: cumSaves, シェア: cumShares };
        });
        const tickInterval = Math.max(1, Math.round(lineData.length / Math.ceil(lineData.length / 7)));
        const ticks = lineData.filter((_, i) => i % tickInterval === 0 || i === lineData.length - 1).map(d => d.name);
        return lineData.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">パフォーマンス推移</CardTitle>
              <CardDescription className="text-xs">日別累積値（投稿日順）</CardDescription>
            </CardHeader>
            <CardContent className="min-w-0 overflow-hidden">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={lineData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" ticks={ticks} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tickFormatter={(v: number) => fmt(v)} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => fmt(v)} tick={{ fontSize: 11 }} />
                  <RechartsTooltip formatter={(v: number) => v.toLocaleString()} />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="再生数" stroke="#0a0a0a" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="いいね" stroke="#D71921" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="コメント" stroke="#6366f1" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="保存" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="シェア" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ) : null;
      })()}

      {/* 投稿パフォーマンス推移（スモールマルチプル） */}
      {videos.length > 0 && (
        <PostPerformanceGrid videos={sortedVideos} dailyMetrics={dailyMetrics} sparkMetric={sparkMetric} setSparkMetric={setSparkMetric} sortBy={sortBy} setSortBy={setSortBy} sortOptions={SORT_OPTIONS} videoScores={videoScores} bestVideoId={bestVideoId} kwSet={kwSet} bigKwSet={bigKwSet} hasBaseline={hasBaseline} />
      )}

    </div>
  );
}

// ============================
// 全媒体パフォーマンス推移（累積 / 日次増分 切替）
// ============================

function TikTokPerformanceChart({ dailyMetrics, videos }: { dailyMetrics: any[]; videos: any[] }) {
  const [chartMode, setChartMode] = useState<"cumulative" | "daily">("cumulative");

  const { cumulativeData, dailyData, hasShares, hasSaves } = useMemo(() => {
    // 動画URL別 → 日付別のスナップショットを整理
    const byVideo = new Map<string, Map<string, { views: number; likes: number; comments: number; shares: number; saves: number }>>();
    for (const dm of dailyMetrics) {
      const dateKey = dm.date?.split("T")[0] || dm.dateKey;
      const url = dm.videoUrl || "";
      if (!dateKey || !url) continue;
      if (!byVideo.has(url)) byVideo.set(url, new Map());
      const videoMap = byVideo.get(url)!;
      const entry = videoMap.get(dateKey) || { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
      entry.views += dm.viewCount || 0;
      entry.likes += dm.likeCount || 0;
      entry.comments += dm.commentCount || 0;
      entry.shares += dm.shareCount || 0;
      entry.saves += dm.saveCount || 0;
      videoMap.set(dateKey, entry);
    }

    // 全日付を収集してソート
    const allDates = new Set<string>();
    for (const videoMap of byVideo.values()) {
      for (const d of videoMap.keys()) allDates.add(d);
    }
    const sortedDates = [...allDates].sort();
    if (sortedDates.length < 2) return { cumulativeData: [], dailyData: [], hasShares: false, hasSaves: false };

    // Forward-fill: 各動画の欠損日を前日値で埋める（累積値が下がるのを防止）
    for (const videoMap of byVideo.values()) {
      let lastKnown: { views: number; likes: number; comments: number; shares: number; saves: number } | null = null;
      for (const dateKey of sortedDates) {
        const snap = videoMap.get(dateKey);
        if (snap) {
          lastKnown = snap;
        } else if (lastKnown) {
          videoMap.set(dateKey, { ...lastKnown });
        }
      }
    }

    // 各動画ごとに日次増分を算出し、日付ごとに全動画分を合計
    const dailyIncrements = sortedDates.slice(1).map((dateKey, i) => {
      const prevDate = sortedDates[i];
      let views = 0, likes = 0, comments = 0, shares = 0, saves = 0;
      for (const videoMap of byVideo.values()) {
        const cur = videoMap.get(dateKey);
        const prev = videoMap.get(prevDate);
        if (cur && prev) {
          views += Math.max(0, cur.views - prev.views);
          likes += Math.max(0, cur.likes - prev.likes);
          comments += Math.max(0, cur.comments - prev.comments);
          shares += Math.max(0, cur.shares - prev.shares);
          saves += Math.max(0, cur.saves - prev.saves);
        }
      }
      return { dateKey, views, likes, comments, shares, saves };
    });

    // 日次増分データ（旧「純増」→ 新「日次」）
    const dData = dailyIncrements.map(d => ({
      name: `${new Date(d.dateKey).getMonth() + 1}/${new Date(d.dateKey).getDate()}`,
      再生数: d.views, いいね: d.likes, コメント: d.comments, シェア: d.shares, 保存: d.saves,
    }));

    // 累積データ：各日付の全動画合計スナップショット値（実際の累積再生数）
    const cumData = sortedDates.map(dateKey => {
      let views = 0, likes = 0, comments = 0, shares = 0, saves = 0;
      for (const videoMap of byVideo.values()) {
        const snap = videoMap.get(dateKey);
        if (snap) {
          views += snap.views;
          likes += snap.likes;
          comments += snap.comments;
          shares += snap.shares;
          saves += snap.saves;
        }
      }
      return {
        name: `${new Date(dateKey).getMonth() + 1}/${new Date(dateKey).getDate()}`,
        再生数: views, いいね: likes, コメント: comments, シェア: shares, 保存: saves,
      };
    });

    const last = cumData[cumData.length - 1];
    const _hasShares = last ? last.シェア > 0 : false;
    const _hasSaves = last ? last.保存 > 0 : false;

    return { cumulativeData: cumData, dailyData: dData, hasShares: _hasShares, hasSaves: _hasSaves };
  }, [dailyMetrics]);

  const lineData = chartMode === "cumulative" ? cumulativeData : dailyData;
  if (lineData.length < 2) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">パフォーマンス推移</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {chartMode === "cumulative" ? "全動画合計の累積再生数推移" : "日毎のメトリクス増分（前日比）"}
            </CardDescription>
          </div>
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                chartMode === "cumulative"
                  ? "bg-[#0a0a0a] text-white"
                  : "bg-[#f5f5f5] hover:bg-card text-muted-foreground"
              }`}
              onClick={() => setChartMode("cumulative")}
            >
              累積
            </button>
            <button
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors border-l border-border ${
                chartMode === "daily"
                  ? "bg-[#0a0a0a] text-white"
                  : "bg-[#f5f5f5] hover:bg-card text-muted-foreground"
              }`}
              onClick={() => setChartMode("daily")}
            >
              日次
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 overflow-hidden">
        <ResponsiveContainer width="100%" height={300}>
          {chartMode === "cumulative" ? (
            <LineChart data={lineData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tickFormatter={(v: number) => fmt(v)} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => fmt(v)} tick={{ fontSize: 11 }} />
              <RechartsTooltip formatter={(v: number) => v.toLocaleString()} />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="再生数" stroke="#0a0a0a" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="いいね" stroke="#D71921" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="コメント" stroke="#6366f1" strokeWidth={2} dot={false} />
              {hasShares && <Line yAxisId="right" type="monotone" dataKey="シェア" stroke="#f59e0b" strokeWidth={2} dot={false} />}
              {hasSaves && <Line yAxisId="right" type="monotone" dataKey="保存" stroke="#8b5cf6" strokeWidth={2} dot={false} />}
            </LineChart>
          ) : (
            <LineChart data={lineData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tickFormatter={(v: number) => fmt(v)} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => fmt(v)} tick={{ fontSize: 11 }} />
              <RechartsTooltip formatter={(v: number) => `+${v.toLocaleString()}`} />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="再生数" stroke="#0a0a0a" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="いいね" stroke="#D71921" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="コメント" stroke="#6366f1" strokeWidth={2} dot={false} />
              {hasShares && <Line yAxisId="right" type="monotone" dataKey="シェア" stroke="#f59e0b" strokeWidth={2} dot={false} />}
              {hasSaves && <Line yAxisId="right" type="monotone" dataKey="保存" stroke="#8b5cf6" strokeWidth={2} dot={false} />}
            </LineChart>
          )}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ============================
// 投稿パフォーマンス推移（スモールマルチプル）
// ============================

const SPARK_LABELS: Record<string, string> = { views: "再生数", likes: "いいね", comments: "コメント", shares: "シェア", saves: "保存" };
const SPARK_KEY: Record<string, string> = { views: "viewCount", likes: "likeCount", comments: "commentCount", shares: "shareCount", saves: "saveCount" };

function PostPerformanceGrid({ videos, dailyMetrics, sparkMetric, setSparkMetric, sortBy, setSortBy, sortOptions, videoScores, bestVideoId, kwSet, bigKwSet, hasBaseline = true }: {
  videos: any[];
  dailyMetrics?: any[];
  sparkMetric: "views" | "likes" | "shares" | "saves";
  setSparkMetric: (m: "views" | "likes" | "shares" | "saves") => void;
  sortBy: string;
  setSortBy: (s: string) => void;
  sortOptions: { key: string; label: string }[];
  videoScores?: any[];
  bestVideoId?: string;
  kwSet: Set<string>;
  bigKwSet: Set<string>;
  hasBaseline?: boolean;
}) {
  const scoreMap = new Map((videoScores || []).map((s: any) => [s.videoId, s]));
  const hasDailyData = dailyMetrics && dailyMetrics.length > 0;
  const metricKey = SPARK_KEY[sparkMetric];

  // ホバー展開管理（タッチデバイスはタップトグル）
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouchRef = useRef(false);

  useEffect(() => {
    isTouchRef.current = window.matchMedia("(hover: none)").matches;
  }, []);

  const handleMouseEnter = useCallback((url: string) => {
    if (isTouchRef.current) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setExpandedCard(url), 150);
  }, []);
  const handleMouseLeave = useCallback(() => {
    if (isTouchRef.current) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setExpandedCard(null), 100);
  }, []);
  const handleTap = useCallback((url: string) => {
    if (!isTouchRef.current) return;
    setExpandedCard(prev => prev === url ? null : url);
  }, []);

  const sparks = useMemo(() => {
    // Group daily metrics by videoUrl — all metrics
    const byVideoAll = new Map<string, Array<{ dateKey: string; viewCount: number; likeCount: number; commentCount: number; shareCount: number; saveCount: number }>>();
    const byVideo = new Map<string, Array<{ dateKey: string; value: number }>>();
    // 最新メトリクス（ER計算用）
    const latestDm = new Map<string, { viewCount: number; likeCount: number; commentCount: number; shareCount: number; saveCount: number; dateKey: string }>();
    if (hasDailyData) {
      for (const dm of dailyMetrics) {
        if (dm.platform !== "tiktok") continue;
        const url = dm.videoUrl;
        if (!url) continue;
        if (!byVideo.has(url)) byVideo.set(url, []);
        byVideo.get(url)!.push({
          dateKey: dm.dateKey,
          value: Number(dm[SPARK_KEY[sparkMetric]]) || 0,
        });
        if (!byVideoAll.has(url)) byVideoAll.set(url, []);
        byVideoAll.get(url)!.push({
          dateKey: dm.dateKey,
          viewCount: Number(dm.viewCount) || 0,
          likeCount: Number(dm.likeCount) || 0,
          commentCount: Number(dm.commentCount) || 0,
          shareCount: Number(dm.shareCount) || 0,
          saveCount: Number(dm.saveCount) || 0,
        });
        const prev = latestDm.get(url);
        if (!prev || dm.dateKey > prev.dateKey) {
          latestDm.set(url, {
            viewCount: dm.viewCount || 0, likeCount: dm.likeCount || 0,
            commentCount: dm.commentCount || 0, shareCount: dm.shareCount || 0,
            saveCount: dm.saveCount || 0, dateKey: dm.dateKey,
          });
        }
      }
    }

    return videos.map(v => {
      const url = v.videoUrl || "";
      const username = url.match(/@([^/]+)/)?.[1] || "";

      // Daily data points
      let sorted = [...(byVideo.get(url) || [])].sort((a, b) => a.dateKey.localeCompare(b.dateKey));

      // Fallback: synthesize from before/after snapshots
      if (sorted.length < 2) {
        const bVal = Number(v.before?.[metricKey]) || 0;
        const aVal = Number(v.after?.[metricKey]) || 0;
        if (v.before && v.after) {
          sorted = [{ dateKey: "before", value: bVal }, { dateKey: "after", value: aVal }];
        } else if (!hasBaseline && aVal > 0 && v.postedAt) {
          const postedDate = new Date(v.postedAt);
          const now = new Date();
          const elapsedDays = Math.max(1, Math.floor((now.getTime() - postedDate.getTime()) / (1000 * 60 * 60 * 24)));
          const points = Math.min(elapsedDays + 1, 30);
          // インデックスベースで等間隔に累積値を生成（Math.round(step*i) の丸めバグ回避）
          sorted = Array.from({ length: points }, (_, i) => ({
            dateKey: `${i}`,
            value: Math.round(aVal * (i / (points - 1))),
          }));
        } else if (aVal > 0) {
          sorted = [{ dateKey: "start", value: 0 }, { dateKey: "now", value: aVal }];
        }
      }

      const latestDailyVal = sorted.length > 0 ? sorted[sorted.length - 1].value : 0;
      const snapshotVal = Number(v.after?.[metricKey]) || 0;
      const latestVal = Math.max(latestDailyVal, snapshotVal);

      // ER計算（dailyMetrics最新値を優先）
      const dm = latestDm.get(url);
      const vw = Math.max(dm?.viewCount || 0, v.after?.viewCount || 0);
      const lk = Math.max(dm?.likeCount || 0, v.after?.likeCount || 0);
      const cm = Math.max(dm?.commentCount || 0, v.after?.commentCount || 0);
      const sh = Math.max(dm?.shareCount || 0, v.after?.shareCount || 0);
      const sv = Math.max(dm?.saveCount || 0, v.after?.saveCount || 0);
      const er = vw > 0 ? Number(((lk + cm + sh) / vw * 100).toFixed(2)) : 0;

      // 日次増分（直近2日比較）
      const allSorted = [...(byVideoAll.get(url) || [])].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
      let dailyIncrement: { views: number; likes: number; comments: number; shares: number; saves: number } | null = null;
      if (allSorted.length >= 2) {
        const last = allSorted[allSorted.length - 1];
        const prev = allSorted[allSorted.length - 2];
        dailyIncrement = {
          views: last.viewCount - prev.viewCount,
          likes: last.likeCount - prev.likeCount,
          comments: last.commentCount - prev.commentCount,
          shares: last.shareCount - prev.shareCount,
          saves: last.saveCount - prev.saveCount,
        };
      }

      // トレンド乖離 — 線形成長からのRMSEベースで分類
      let trendLabel: "急成長" | "安定" | "停滞" | "バイラル" = "安定";
      if (sorted.length >= 3) {
        const lastVal = sorted[sorted.length - 1].value;
        if (lastVal > 0) {
          const normalized = sorted.map((d, i) => ({
            actual: d.value / lastVal,
            expected: i / (sorted.length - 1),
          }));
          const mse = normalized.reduce((sum, d) => sum + Math.pow(d.actual - d.expected, 2), 0) / normalized.length;
          const rmse = Math.sqrt(mse);
          // 最近の加速度
          const recentGrowth = sorted.length >= 3
            ? (sorted[sorted.length - 1].value - sorted[sorted.length - 2].value) /
              Math.max(sorted[sorted.length - 2].value - sorted[sorted.length - 3].value, 1)
            : 1;
          if (rmse > 0.35 && recentGrowth > 2) trendLabel = "バイラル";
          else if (rmse > 0.2 && recentGrowth > 1.2) trendLabel = "急成長";
          else if (rmse < 0.15 && dailyIncrement && dailyIncrement.views < 10) trendLabel = "停滞";
          else trendLabel = "安定";
        }
      }

      // 日次増分の時系列（ミニバーチャート用）
      const deltas: Array<{ dateKey: string; value: number }> = [];
      for (let i = 1; i < sorted.length; i++) {
        deltas.push({
          dateKey: sorted[i].dateKey,
          value: Math.max(0, sorted[i].value - sorted[i - 1].value),
        });
      }

      // 直近3日の全メトリ��ス日次増分
      const recentDeltas: Array<{ dateKey: string; views: number; likes: number; comments: number; shares: number; saves: number; er: number }> = [];
      for (let i = Math.max(1, allSorted.length - 3); i < allSorted.length; i++) {
        const cur = allSorted[i];
        const prev = allSorted[i - 1];
        const dv = cur.viewCount - prev.viewCount;
        const dl = cur.likeCount - prev.likeCount;
        const dc = cur.commentCount - prev.commentCount;
        const ds = cur.shareCount - prev.shareCount;
        const dsv = cur.saveCount - prev.saveCount;
        const dEr = dv > 0 ? Number(((dl + dc + ds) / dv * 100).toFixed(2)) : 0;
        recentDeltas.push({ dateKey: cur.dateKey, views: Math.max(0, dv), likes: Math.max(0, dl), comments: Math.max(0, dc), shares: Math.max(0, ds), saves: Math.max(0, dsv), er: dEr });
      }

      return {
        videoUrl: url,
        caption: (v.description || "").slice(0, 18),
        fullCaption: v.description || "",
        username: username ? `@${username}` : "",
        coverUrl: v.coverUrl || "",
        latestVal,
        data: sorted,
        deltas,
        er,
        postedAt: v.postedAt || "",
        recentDeltas,
        // 展開用追加データ
        hashtags: (v.hashtags || []) as string[],
        duration: (v.duration || 0) as number,
        music: v.music as { id: string; title: string; authorName: string; original: boolean } | null | undefined,
        allMetrics: { viewCount: vw, likeCount: lk, commentCount: cm, shareCount: sh, saveCount: sv },
        dailyIncrement,
        trendLabel,
      };
    }).filter(s => s.data.length >= 2);
  }, [videos, dailyMetrics, sparkMetric, metricKey, hasDailyData]);

  const SPARK_PAGE = 8;
  const [sparkDisplayCount, setSparkDisplayCount] = useState(SPARK_PAGE);

  if (sparks.length === 0) return null;

  const topVal = sortBy === "er"
    ? Math.max(...sparks.map(s => s.er), 1)
    : Math.max(...sparks.map(s => s.latestVal), 1);
  const visibleSparks = sparks.slice(0, sparkDisplayCount);
  const sparkRemaining = sparks.length - sparkDisplayCount;

  const TREND_CONFIG: Record<string, { cls: string; dot: string }> = {
    "バイラル": { cls: "text-[#D71921] bg-[#D71921]/8", dot: "bg-[#D71921]" },
    "急成長": { cls: "text-emerald-700 bg-emerald-50", dot: "bg-emerald-500" },
    "安定": { cls: "text-slate-600 bg-slate-100", dot: "bg-slate-400" },
    "停滞": { cls: "text-amber-700 bg-amber-50", dot: "bg-amber-500" },
  };

  const formatDuration = (sec: number) => {
    if (!sec) return null;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const formatDate = (iso: string) => {
    if (!iso) return "-";
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (<>
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-semibold">投稿パフォーマンス推移</p>
            <p className="text-[11px] text-muted-foreground">{hasDailyData ? "累積推移スパークライン ＋ ホバーで詳細" : "各投稿の施策前後パフォーマンス"}</p>
          </div>
          <div className="flex gap-1 flex-wrap">
            {sortOptions.map(opt => (
              <button key={opt.key} onClick={() => {
                setSortBy(opt.key);
                const sparkMap: Record<string, "views" | "likes" | "comments" | "shares" | "saves"> = { views: "views", likes: "likes", comments: "comments", shares: "shares", saves: "saves", er: "views", date: "views" };
                setSparkMetric(sparkMap[opt.key] || "views");
              }}
                className={`px-2 py-1 rounded text-[11px] transition-colors ${sortBy === opt.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {visibleSparks.map((s, idx) => {
            const displayVal = sortBy === "er" ? s.er : s.latestVal;
            const intensity = topVal > 0 ? Math.min(displayVal / topVal, 1) : 0.5;
            const sc = intensity > 0.5 ? "#D71921" : intensity > 0.2 ? "#e85d68" : "#a5b4fc";
            const isExpanded = expandedCard === s.videoUrl;
            const ttMetricKeyMap: Record<string, string> = { views: "views", likes: "likes", comments: "comments", shares: "shares", saves: "saves", er: "er", date: "views" };
            const deltaKey = ttMetricKeyMap[sortBy] || "views";
            const recent3 = s.recentDeltas.slice(-3);

            return (
              <div key={s.videoUrl || idx}
                className="post-card"
                onMouseEnter={() => handleMouseEnter(s.videoUrl)}
                onMouseLeave={handleMouseLeave}
                onClick={() => handleTap(s.videoUrl)}
              >
                {/* 上部: サムネ + ユーザー名 + 累積値 */}
                <div className="flex items-start gap-2.5 p-3 pb-1.5">
                  {s.coverUrl ? (
                    <img src={s.coverUrl} alt="" className="w-10 h-14 rounded-md object-cover flex-shrink-0" loading="lazy" />
                  ) : (
                    <div className="w-10 h-14 rounded-md flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-[#D71921] to-[#0a0a0a]">
                      <Play className="h-3 w-3 text-white/80" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    {s.username && <p className="text-[10px] font-bold text-slate-600 truncate">{s.username}</p>}
                    <p className="text-[10px] text-slate-400 truncate leading-snug">{s.caption || "動画"}</p>
                    <p className="text-lg font-extrabold tabular-nums text-slate-800 leading-tight mt-0.5">
                      {sortBy === "er" ? `${s.er}%` : sortBy === "date" ? (s.postedAt ? s.postedAt.split("T")[0] : "-") : fmt(s.latestVal)}
                    </p>
                    <p className="text-[9px] text-slate-400 font-medium">
                      {sortBy === "er" ? "ER" : sortBy === "date" ? "投稿日" : SPARK_LABELS[sparkMetric]} (累計)
                    </p>
                  </div>
                </div>
                {/* SVGスパークライン（累積推移） */}
                {s.data.length >= 2 && (() => {
                  const sparkW = 200;
                  const sparkH = 40;
                  const vals = s.data.map((d: any) => d.value);
                  const maxV = Math.max(...vals, 1);
                  const minV = Math.min(...vals);
                  const range = maxV - minV || 1;
                  const points = vals.map((v: number, i: number) => {
                    const x = (i / (vals.length - 1)) * sparkW;
                    const y = sparkH - ((v - minV) / range) * (sparkH - 4) - 2;
                    return `${x},${y}`;
                  });
                  const pathD = `M${points.join("L")}`;
                  return (
                    <div className="px-3 pb-2">
                      <svg width="100%" height={sparkH} viewBox={`0 0 ${sparkW} ${sparkH}`} preserveAspectRatio="none" className="overflow-visible">
                        <defs>
                          <linearGradient id={`tt-spark-fill-${idx}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={sc} stopOpacity="0.18" />
                            <stop offset="100%" stopColor={sc} stopOpacity="0.02" />
                          </linearGradient>
                        </defs>
                        <path d={`${pathD}L${sparkW},${sparkH}L0,${sparkH}Z`} fill={`url(#tt-spark-fill-${idx})`} />
                        <path d={pathD} fill="none" stroke={sc} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  );
                })()}
                {/* コンパクトメトリクス */}
                <div className="px-3 pb-2 flex items-center gap-2 text-[9px] text-slate-400">
                  <span className="flex items-center gap-0.5"><Eye className="h-2.5 w-2.5" />{fmt(s.allMetrics.viewCount)}</span>
                  <span className="flex items-center gap-0.5"><Heart className="h-2.5 w-2.5" />{fmt(s.allMetrics.likeCount)}</span>
                  <span className="flex items-center gap-0.5"><Share2 className="h-2.5 w-2.5" />{fmt(s.allMetrics.shareCount)}</span>
                  <span className="flex items-center gap-0.5"><Bookmark className="h-2.5 w-2.5" />{fmt(s.allMetrics.saveCount)}</span>
                  <span className="ml-auto font-mono text-[8px]">ER {s.er}%</span>
                </div>

                {/* ===== 展開パネル ===== */}
                <div className={`post-card-expand ${isExpanded ? "is-expanded" : ""}`}>
                  <div className="post-card-expand-inner">
                    <div className="mx-3 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
                    <div className="px-3 pt-2.5 pb-3 space-y-2 bg-gradient-to-b from-muted/20 to-transparent">
                      {s.fullCaption.length > 18 && (() => {
                        const cleaned = s.fullCaption.replace(/#[\w\u3000-\u9FFF\uF900-\uFAFF]+/g, "").trim();
                        return cleaned ? <p className="spark-detail-item text-[10px] text-slate-500 leading-relaxed line-clamp-3">{cleaned}</p> : null;
                      })()}
                      {s.hashtags.length > 0 && (
                        <div className="spark-detail-item flex flex-wrap gap-1">
                          {s.hashtags.slice(0, 5).map(tag => (
                            <span key={tag} className="inline-flex items-center text-[8px] font-semibold px-1.5 py-0.5 rounded-sm bg-primary/6 text-primary/80 border border-primary/10">
                              #{tag.replace(/^#/, "")}
                            </span>
                          ))}
                          {s.hashtags.length > 5 && <span className="text-[8px] text-muted-foreground self-center">+{s.hashtags.length - 5}</span>}
                        </div>
                      )}
                      <div className="spark-detail-item grid grid-cols-5 gap-0.5">
                        {([
                          { key: "viewCount", label: "再生", Icon: Eye, inc: s.dailyIncrement?.views },
                          { key: "likeCount", label: "いいね", Icon: Heart, inc: s.dailyIncrement?.likes },
                          { key: "commentCount", label: "コメ", Icon: MessageCircle, inc: s.dailyIncrement?.comments },
                          { key: "shareCount", label: "シェア", Icon: Share2, inc: s.dailyIncrement?.shares },
                          { key: "saveCount", label: "保存", Icon: Bookmark, inc: s.dailyIncrement?.saves },
                        ] as const).map(m => (
                          <div key={m.key} className="text-center py-1 rounded-sm">
                            <m.Icon className="h-2.5 w-2.5 mx-auto mb-0.5 text-slate-400" />
                            <p className="text-[10px] font-bold tabular-nums text-foreground">{fmt(s.allMetrics[m.key as keyof typeof s.allMetrics])}</p>
                            <p className="text-[7px] text-muted-foreground tracking-wider">{m.label}</p>
                            {m.inc != null && m.inc !== 0 && (
                              <p className={`text-[8px] font-semibold tabular-nums mt-0.5 ${m.inc > 0 ? "text-emerald-600" : "text-[#D71921]"}`}>
                                {m.inc > 0 ? "+" : ""}{fmt(m.inc)}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="spark-detail-item flex items-center justify-between pt-1">
                        <span className={`inline-flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-sm ${TREND_CONFIG[s.trendLabel]?.cls || ""}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${TREND_CONFIG[s.trendLabel]?.dot || ""}`} />
                          {s.trendLabel}
                        </span>
                        <a href={s.videoUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-[8px] text-primary hover:text-primary/80 font-bold transition-colors"
                          onClick={e => e.stopPropagation()}
                        >
                          <ExternalLink className="h-2.5 w-2.5" />動画を見る
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {sparkRemaining > 0 && (
          <div className="flex justify-center pt-3">
            <Button variant="ghost" size="sm" onClick={() => setSparkDisplayCount(prev => prev + SPARK_PAGE)}
              className="text-xs text-muted-foreground hover:text-foreground">
              <ChevronDown className="h-3.5 w-3.5 mr-1" />もっと見る（残り{sparkRemaining}件）
            </Button>
          </div>
        )}
      </CardContent>
    </Card>

  </>
  );
}


// ============================
// VideoThumbnail
// ============================

function VideoThumbnail({ url, className }: { url?: string; className?: string }) {
  if (!url) return <div className={`bg-muted rounded flex-shrink-0 ${className || "w-16 h-22"}`} />;
  return <img src={url} alt="" className={`rounded object-cover flex-shrink-0 ${className || "w-16 h-22"}`} loading="lazy" />;
}

// ============================
// ============================
// Section 4: 検索結果占有マップ（SOVスロットマップ）
// ============================

const TIKTOK_LABEL_CONFIG: Record<string, { text: string; dot: string }> = {
  promotion: { text: "プロモーション", dot: "bg-amber-500" },
  paid_partnership: { text: "有償パートナーシップ", dot: "bg-purple-500" },
  aigc: { text: "AI生成メディアを含む", dot: "bg-teal-500" },
};

interface SlotData {
  rank: number;
  video_id: string;
  video_url: string;
  creator_username: string;
  description: string;
  hashtags: string[];
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  owner: "own" | "competitor" | "other";
  owner_name?: string;
  owner_detail?: "official" | "satellite" | "campaign";
  genre: string;
  tiktok_labels: string[];
  cover_url?: string;
}

// SOV slot visual config — color accent per ownership type
const SOV_SLOT_CONFIG = {
  official: {
    capBg: "bg-blue-600",
    capText: "text-white",
    capLabel: "公式",
    accentBar: "bg-blue-600",
    rankBg: "bg-blue-50",
    rankText: "text-blue-700",
    wrapperBorder: "border-blue-200",
    wrapperShadow: "shadow-none",
    emptyBg: "bg-blue-50",
    emptyText: "text-blue-300",
  },
  satellite: {
    capBg: "bg-teal-600",
    capText: "text-white",
    capLabel: "サテライト",
    accentBar: "bg-teal-600",
    rankBg: "bg-teal-50",
    rankText: "text-teal-700",
    wrapperBorder: "border-teal-200",
    wrapperShadow: "shadow-none",
    emptyBg: "bg-teal-50",
    emptyText: "text-teal-300",
  },
  campaign: {
    capBg: "bg-[#D71921]",
    capText: "text-white",
    capLabel: "施策",
    accentBar: "bg-[#D71921]",
    rankBg: "bg-red-50",
    rankText: "text-[#D71921]",
    wrapperBorder: "border-[#D71921]/40",
    wrapperShadow: "shadow-none",
    emptyBg: "bg-red-50",
    emptyText: "text-[#D71921]/50",
  },
  competitor: {
    capBg: "bg-slate-500",
    capText: "text-white",
    capLabel: "競合",
    accentBar: "bg-slate-500",
    rankBg: "bg-slate-100",
    rankText: "text-slate-600",
    wrapperBorder: "border-slate-300",
    wrapperShadow: "shadow-none",
    emptyBg: "bg-slate-50",
    emptyText: "text-slate-400",
  },
  other: {
    capBg: "",
    capText: "",
    capLabel: "",
    accentBar: "",
    rankBg: "bg-[#f5f5f5]",
    rankText: "text-[#6b7280]",
    wrapperBorder: "border-black/6",
    wrapperShadow: "shadow-none",
    emptyBg: "bg-[#f5f5f5]",
    emptyText: "text-[#9ca3af]",
  },
};

const OWNER_KEY_OPTIONS: { key: OwnerKey; label: string; color: string; activeBg: string }[] = [
  { key: "official", label: "公式", color: "text-blue-700", activeBg: "bg-blue-50 border-blue-300 ring-1 ring-blue-200" },
  { key: "satellite", label: "サテライト", color: "text-teal-700", activeBg: "bg-teal-50 border-teal-300 ring-1 ring-teal-200" },
  { key: "campaign", label: "施策", color: "text-[#D71921]", activeBg: "bg-red-50 border-red-300 ring-1 ring-red-200" },
  { key: "competitor", label: "競合", color: "text-slate-600", activeBg: "bg-slate-100 border-slate-400 ring-1 ring-slate-300" },
  { key: "other", label: "その他", color: "text-[#6b7280]", activeBg: "bg-[#f5f5f5] border-slate-400 ring-1 ring-slate-300" },
];

const GENRE_OPTIONS: { key: string; label: string }[] = [
  { key: "recommend", label: "レコメンド" },
  { key: "howto", label: "How-to" },
  { key: "entertainment", label: "エンタメ" },
  { key: "negative", label: "ネガティブ" },
  { key: "other", label: "その他" },
];

function SovSlotEditForm({ slot, onSave, onCancel }: {
  slot: SlotData;
  onSave: (changes: { owner: string; owner_detail?: string; owner_name?: string; genre: string; tiktok_labels: string[] }) => void;
  onCancel: () => void;
}) {
  const [ownerKey, setOwnerKey] = useState<OwnerKey>(slotToOwnerKey(slot));
  const [ownerName, setOwnerName] = useState(slot.owner_name || "");
  const [genre, setGenre] = useState(slot.genre || "other");
  const [labels, setLabels] = useState<string[]>([...(slot.tiktok_labels || [])]);

  const toggleLabel = (l: string) => setLabels(prev => prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l]);

  const handleSave = () => {
    const base = ownerKeyToChanges(ownerKey);
    onSave({
      ...base,
      owner_name: ownerKey === "competitor" ? ownerName : undefined,
      genre,
      tiktok_labels: labels,
    });
  };

  return (
    <div className="space-y-3 w-56">
      {/* Header */}
      <div className="flex items-center gap-2 pb-1 border-b border-black/4">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">スロット編集</span>
        <span className="text-[10px] text-slate-300">@{slot.creator_username}</span>
      </div>

      {/* Owner classification */}
      <div className="space-y-1.5">
        <Label className="text-[11px] font-semibold text-muted-foreground">分類</Label>
        <div className="flex flex-wrap gap-1">
          {OWNER_KEY_OPTIONS.map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setOwnerKey(opt.key)}
              className={`text-[10px] px-2 py-1 rounded-md border font-medium transition-all duration-150 ${
                ownerKey === opt.key
                  ? `${opt.activeBg} ${opt.color}`
                  : "border-border text-muted-foreground hover:border-black/8 hover:text-muted-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {ownerKey === "competitor" && (
          <Input
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="競合名"
            className="h-7 text-xs mt-1"
          />
        )}
      </div>

      {/* Genre */}
      <div className="space-y-1.5">
        <Label className="text-[11px] font-semibold text-muted-foreground">ジャンル</Label>
        <div className="flex flex-wrap gap-1">
          {GENRE_OPTIONS.map(opt => {
            const gi = GENRE_CONFIG[opt.key] || GENRE_CONFIG.other;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setGenre(opt.key)}
                className={`text-[10px] px-2 py-1 rounded-md border font-medium transition-all duration-150 ${
                  genre === opt.key
                    ? `${gi.cls} border-transparent`
                    : "border-border text-muted-foreground hover:border-black/8"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* TikTok labels */}
      <div className="space-y-1.5">
        <Label className="text-[11px] font-semibold text-muted-foreground">ラベル</Label>
        <div className="space-y-1">
          {Object.entries(TIKTOK_LABEL_CONFIG).map(([key, cfg]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer group/lbl">
              <Checkbox
                checked={labels.includes(key)}
                onCheckedChange={() => toggleLabel(key)}
                className="h-3.5 w-3.5"
              />
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground group-hover/lbl:text-foreground">
                <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                {cfg.text}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-black/4">
        <Button
          size="sm"
          onClick={handleSave}
          className="h-7 text-xs px-3 gap-1"
        >
          <Check className="h-3 w-3" />
          保存
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="h-7 text-xs px-2 text-muted-foreground"
        >
          キャンセル
        </Button>
      </div>
    </div>
  );
}

// ============================
// TikTok Mock Stage — 3D Carousel with unified legend
// ============================
interface TikTokMockKwEntry {
  keyword: string;
  paddedBefore: (SlotData | null)[];
  paddedAfter: (SlotData | null)[];
  showBefore: boolean;
  bOwnCount: number; aOwnCount: number;
  bTotal: number; aTotal: number;
  bPct: number; aPct: number;
}

interface TikTokMockStageProps {
  kwEntries: TikTokMockKwEntry[];
  activeKw?: string | null;
  onActiveKwChange?: (kw: string) => void;
  centered?: boolean;
}

function getCardTransform(offset: number, total: number) {
  const abs = Math.abs(offset);
  const sign = offset >= 0 ? 1 : -1;
  // Active card stays at scale 1.0 (native resolution, no blur).
  // Non-active cards scale DOWN — shrinking doesn't cause visible blur.
  // Phone pair width at scale 1.3 ≈ 600px (286*2 + bridge). Half = 300px.
  if (total === 2) {
    if (abs === 0) return { tx: 0, scale: 1, rotateY: 0, z: 10, opacity: 1 };
    return { tx: sign * 520, scale: 0.62, rotateY: sign * -13, z: 8, opacity: 0.55 };
  }
  if (abs === 0) return { tx: 0, scale: 1, rotateY: 0, z: 10, opacity: 1 };
  if (abs === 1) return { tx: sign * 540, scale: 0.55, rotateY: sign * -16, z: 8, opacity: 0.70 };
  if (abs === 2) return { tx: sign * 840, scale: 0.40, rotateY: sign * -26, z: 6, opacity: 0.30 };
  return { tx: sign * 1000, scale: 0.28, rotateY: sign * -33, z: 2, opacity: 0 };
}

function TikTokMockStage({ kwEntries, activeKw, onActiveKwChange, centered }: TikTokMockStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setRevealed(true); obs.disconnect(); } },
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const count = kwEntries.length;
  const activeIndex = activeKw
    ? Math.max(0, kwEntries.findIndex(e => e.keyword === activeKw))
    : 0; // overview mode → first item centered

  const navigate = useCallback((dir: 1 | -1) => {
    const next = (activeIndex + dir + count) % count;
    onActiveKwChange?.(kwEntries[next].keyword);
  }, [activeIndex, count, kwEntries, onActiveKwChange]);

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") navigate(-1);
      else if (e.key === "ArrowRight") navigate(1);
    };
    const el = stageRef.current;
    el?.addEventListener("keydown", handler);
    return () => el?.removeEventListener("keydown", handler);
  }, [navigate]);

  const PHONE_SCALE = 1.25; // スマホ表示サイズ
  const PHONE_H = Math.round(476 * PHONE_SCALE);
  const PHONE_W = Math.round(220 * PHONE_SCALE);
  const isSingle = count <= 1;

  return (
    <div
      ref={stageRef}
      tabIndex={0}
      className="relative bg-transparent px-3 sm:px-6 py-5 sm:py-8 outline-none min-w-0 overflow-hidden"
    >
      {/* Section title */}
      <div className="flex items-center gap-2 mb-5">
        <span className="text-[11px] uppercase tracking-[0.2em] text-[#a3a3a3] font-medium">検索結果の変化</span>
      </div>

      {/* 3D Carousel Viewport */}
      <div
        className="relative mx-auto overflow-hidden"
        style={{
          perspective: "1400px",
          height: PHONE_H + 150, // phone at scale + kw label + metrics pill + padding
        }}
      >
        {kwEntries.map((entry, kwIdx) => {
          const { keyword, paddedBefore, paddedAfter, showBefore, bOwnCount, aOwnCount, bTotal, aTotal, bPct, aPct } = entry;
          const pctDelta = aPct - bPct;
          const ownDelta = aOwnCount - bOwnCount;
          const offset = kwIdx - activeIndex;
          const t = isSingle
            ? { tx: 0, scale: 1, rotateY: 0, z: 10, opacity: 1 }
            : getCardTransform(offset, count);
          const isActive = offset === 0;

          return (
            <div
              key={keyword}
              className="absolute left-1/2 top-0 flex flex-col items-center gap-2"
              style={{
                // Active card: no 3D transforms → native raster resolution, no blur
                transform: isActive
                  ? `translateX(calc(-50% + ${t.tx}px))`
                  : `translateX(calc(-50% + ${t.tx}px)) translateZ(${t.z}px) scale(${t.scale}) rotateY(${t.rotateY}deg)`,
                transformStyle: isActive ? "flat" : "preserve-3d",
                opacity: revealed ? t.opacity : 0,
                zIndex: 10 - Math.abs(offset),
                transition: "transform 800ms var(--md-ease-emphasized-decel), opacity 600ms var(--md-ease-standard)",
                pointerEvents: t.opacity === 0 ? "none" : "auto",
                cursor: isActive ? "default" : "pointer",
              }}
              onClick={() => { if (!isActive) onActiveKwChange?.(keyword); }}
            >
              {/* KW label */}
              <div className="text-center">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-wide bg-[#171717] text-white">
                  <Search className="w-[10px] h-[10px] opacity-60" />
                  {keyword}
                </span>
              </div>

              {/* Before / After pair */}
              <div className="flex items-center gap-0">
                {/* Before phone */}
                {showBefore && (
                  <div className="text-center flex flex-col items-center gap-1.5">
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-mono text-[#b0b0b0] tracking-wider block">Before</span>
                      <span className="text-[9px] text-[#c0c0c0] block">{bOwnCount}/{bTotal}枠</span>
                    </div>
                    <div style={{ width: PHONE_W, height: PHONE_H, overflow: "hidden" }}>
                      <div style={{ transform: `scale(${PHONE_SCALE})`, transformOrigin: "top left", width: 220 }}>
                        <TikTokSearchMock slots={paddedBefore} keyword={keyword} isBefore />
                      </div>
                    </div>
                  </div>
                )}

                {/* Before → After 矢印 */}
                {showBefore && (
                  <div className="flex items-center self-center mx-1 text-[#a3a3a3]">
                    <span className="text-2xl">→</span>
                  </div>
                )}

                {/* After phone */}
                <div className="text-center flex flex-col items-center gap-1.5">
                  <div className="space-y-0.5">
                    <span className="text-[14px] font-mono text-foreground font-bold tracking-wider block">
                      {showBefore ? "After" : "Current"}
                    </span>
                    <span className="text-[13px] text-blue-600 font-semibold block">{aOwnCount}/{aTotal}枠</span>
                  </div>
                  <div style={{ width: PHONE_W, height: PHONE_H, overflow: "hidden" }}>
                    <div style={{ transform: `scale(${PHONE_SCALE})`, transformOrigin: "top left", width: 220 }}>
                      <TikTokSearchMock slots={paddedAfter} keyword={keyword} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Per-KW metrics pill */}
              {showBefore && (
                <div className="flex items-center gap-2.5 flex-wrap justify-center mt-1">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-[#e5e5e5] shadow-sm">
                    <span className="text-[10px] text-[#b0b0b0]">{bPct}%</span>
                    <span className="text-[10px] text-[#d4d4d4]">&rarr;</span>
                    <span className={`text-[10px] font-bold ${pctDelta > 0 ? "text-emerald-600" : pctDelta < 0 ? "text-[#D71921]" : "text-muted-foreground"}`}>
                      {aPct}%
                    </span>
                    {pctDelta !== 0 && (
                      <span className={`text-[9px] ${pctDelta > 0 ? "text-emerald-500" : "text-[#D71921]"}`}>
                        {pctDelta > 0 ? "+" : ""}{pctDelta}pt
                      </span>
                    )}
                  </div>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-[#e5e5e5] shadow-sm">
                    <span className="text-[10px] text-[#b0b0b0]">{bOwnCount}本</span>
                    <span className="text-[10px] text-[#d4d4d4]">&rarr;</span>
                    <span className={`text-[10px] font-bold ${ownDelta > 0 ? "text-emerald-600" : ownDelta < 0 ? "text-[#D71921]" : "text-muted-foreground"}`}>
                      {aOwnCount}本
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Navigation arrows */}
      {!isSingle && (
        <>
          <button
            onClick={() => navigate(-1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-white/90 border border-black/8 shadow-md flex items-center justify-center hover:bg-white hover:scale-105 transition-all duration-200"
          >
            <ChevronLeft className="w-4 h-4 text-secondary-foreground" />
          </button>
          <button
            onClick={() => navigate(1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-white/90 border border-black/8 shadow-md flex items-center justify-center hover:bg-white hover:scale-105 transition-all duration-200"
          >
            <ChevronRight className="w-4 h-4 text-secondary-foreground" />
          </button>
        </>
      )}

      {/* Dot pill indicators with KW names */}
      {!isSingle && (
        <div className="flex items-center gap-1.5 mt-3">
          {kwEntries.map((entry, i) => {
            const isActive = i === activeIndex;
            return (
              <button
                key={entry.keyword}
                onClick={() => onActiveKwChange?.(entry.keyword)}
                className={`px-2 py-0.5 rounded-full text-[9px] font-medium transition-all duration-500 ${
                  isActive
                    ? "bg-[#171717] text-white shadow-sm"
                    : "bg-[#e5e5e5] text-muted-foreground hover:bg-[#d4d4d4] hover:text-muted-foreground"
                }`}
              >
                {entry.keyword}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================
// TikTok Search Mock (iPhone 15 Pro frame)
// ============================

/** Japanese-locale view count (万/億) */
function fmtJa(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}億`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function TikTokSearchMock({ slots, keyword, isBefore }: { slots: (SlotData | null)[]; keyword: string; isBefore?: boolean }) {
  return (
    <div
      className={`relative transition-all duration-500 ${isBefore ? "scale-[0.94]" : "hover:scale-[1.02]"}`}
      style={isBefore ? { filter: "saturate(0.3) grayscale(0.15) blur(0.3px)" } : undefined}
    >
      {/* iPhone 15 Pro chassis */}
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
            boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.06), inset 0 -1px 0 0 rgba(255,255,255,0.03), inset 1px 0 0 0 rgba(255,255,255,0.04), inset -1px 0 0 0 rgba(255,255,255,0.04)",
          }}
        >
          {/* Inner bezel */}
          <div className="relative w-full h-full rounded-[26px] border-[1px] border-[#050505] bg-black overflow-hidden">
            {/* Dynamic Island */}
            <div className="absolute top-[6px] left-1/2 -translate-x-1/2 z-20">
              <div
                className="w-[62px] h-[18px] bg-black rounded-full"
                style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.06), 0 0 3px rgba(0,0,0,0.4)" }}
              >
                <div className="absolute right-[13px] top-1/2 -translate-y-1/2 w-[5px] h-[5px] rounded-full bg-[#0a0a14]" style={{ boxShadow: "inset 0 0 1px rgba(255,255,255,0.1)" }} />
              </div>
            </div>

            {/* Glass reflection */}
            <div className="absolute inset-0 rounded-[24px] z-30 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 30%, transparent 50%)" }} />

            {/* Screen */}
            <div className="w-full h-full rounded-[24px] overflow-hidden bg-black flex flex-col" style={{ fontFamily: "-apple-system, 'Hiragino Sans', sans-serif" }}>

              {/* ── Status Bar — flanking Dynamic Island ── */}
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

              {/* ── Search Header ── */}
              <div className="flex items-center gap-[4px] px-[6px] pb-[3px] shrink-0">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0">
                  <path d="M7 1.5L3 5L7 8.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <div className="flex-1 flex items-center gap-[4px] bg-[#262626] rounded-full px-[7px] py-[4px]">
                  <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="shrink-0">
                    <circle cx="4" cy="4" r="2.8" stroke="#777" strokeWidth="0.9"/>
                    <path d="M6 6L8 8" stroke="#777" strokeWidth="0.9" strokeLinecap="round"/>
                  </svg>
                  <span className="text-[8px] text-white truncate leading-none flex-1">{keyword}</span>
                  <div className="w-[10px] h-[10px] rounded-full bg-[#555] flex items-center justify-center shrink-0">
                    <svg width="6" height="6" viewBox="0 0 6 6" fill="none">
                      <path d="M1.2 1.2L4.8 4.8M4.8 1.2L1.2 4.8" stroke="white" strokeWidth="0.8" strokeLinecap="round"/>
                    </svg>
                  </div>
                </div>
                <span className="text-[8px] text-white font-medium shrink-0 pr-[1px]">検索</span>
              </div>

              {/* ── Tabs ── */}
              <div className="flex items-end shrink-0 border-b border-[#1a1a1a] py-[3px]">
                {["トップ", "動画", "ユーザー", "サウンド", "LIVE"].map((tab) => {
                  const isActive = tab === "動画";
                  return (
                    <div key={tab} className="flex-1 flex flex-col items-center gap-[2px]" style={{ minWidth: 0 }}>
                      <span className={`text-[7.5px] whitespace-nowrap ${isActive ? "text-white font-bold" : "text-[#808080] font-medium"}`}>
                        {tab}
                      </span>
                      {isActive && <div className="w-[14px] h-[2px] bg-white rounded-full" />}
                    </div>
                  );
                })}
              </div>

              {/* ── Filter chips ── */}
              <div className="flex items-center gap-[3px] px-[4px] py-[3px] shrink-0">
                {["関連度順", "いいね数順", "最新順"].map((chip, ci) => (
                  <div key={chip} className={`px-[7px] py-[2.5px] rounded-full text-[5.5px] ${ci === 0 ? "bg-white text-black font-semibold" : "bg-[#262626] text-[#d0d0d0]"}`}>
                    {chip}
                  </div>
                ))}
              </div>

              {/* ── Video Grid (scrollable) ── */}
              <div className="flex-1 relative bg-[#080808] overflow-hidden">
                <div className="absolute inset-0 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
                <div className="grid grid-cols-3 gap-[1.5px]">
                  {slots.map((slot, i) => {
                    if (!slot) return <div key={i} className="aspect-[9/14] bg-[#0a0a0a]" />;
                    const isOwn = slot.owner === "own";
                    const isCompetitor = slot.owner === "competitor";
                    const accentColor = isOwn
                      ? slot.owner_detail === "official" ? "#3b82f6"
                        : slot.owner_detail === "satellite" ? "#14b8a6"
                        : "#D71921"
                      : isCompetitor ? "#64748b" : "";
                    const isHighlighted = isOwn || isCompetitor;
                    const overlayRgba = isOwn
                      ? slot.owner_detail === "official" ? "rgba(37,99,235,0.55)"
                        : slot.owner_detail === "satellite" ? "rgba(13,148,136,0.55)"
                        : "rgba(220,20,30,0.55)"
                      : "";
                    const genreColorMap: Record<string, string> = {
                      recommend: "#3b82f6", howto: "#f59e0b", entertainment: "#a855f7", negative: "#D71921", other: "#9ca3af",
                    };
                    const genreDotColor = genreColorMap[slot.genre] || genreColorMap.other;
                    return (
                      <a
                        key={i}
                        href={slot.video_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="relative aspect-[9/14] overflow-visible block"
                        style={isHighlighted ? {
                          zIndex: 2,
                          boxShadow: `0 0 0 1.5px ${accentColor}, 0 0 6px 1px ${accentColor}66`,
                        } : undefined}
                      >
                        {/* Thumbnail */}
                        <div className="w-full h-full overflow-hidden">
                          {slot.cover_url ? (
                            <img src={slot.cover_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-[#222] to-[#0a0a0a]" />
                          )}
                        </div>

                        {/* Own-video color overlay — per account type */}
                        {isOwn && (
                          <div className="absolute inset-0 pointer-events-none z-[1]" style={{ backgroundColor: overlayRgba }} />
                        )}

                        {/* Bottom gradient */}
                        <div className="absolute bottom-0 inset-x-0 h-[40%] bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />

                        {/* View count */}
                        <div className="absolute bottom-[2px] left-[2px] flex items-center gap-[1px]">
                          <svg width="5" height="5" viewBox="0 0 5 5" fill="white" opacity="0.9" strokeLinejoin="round">
                            <path d="M1.2 0.8 L4.2 2.5 L1.2 4.2 Z" />
                          </svg>
                          <span className="text-[5px] text-white font-medium leading-none" style={{ textShadow: "0 0.5px 2px rgba(0,0,0,0.9)" }}>
                            {fmtJa(slot.view_count)}
                          </span>
                        </div>

                        {/* Rank badge — top3 only */}
                        {slot.rank <= 3 && (
                          <div className="absolute top-[1.5px] left-[1.5px] min-w-[9px] h-[9px] rounded-[1.5px] flex items-center justify-center px-[1.5px] bg-[#fe2c55]/90">
                            <span className="text-[5.5px] text-white font-bold leading-none">{slot.rank}</span>
                          </div>
                        )}

                        {/* Genre dot — bottom-right */}
                        <div
                          className="absolute bottom-[2px] right-[2px] w-[5px] h-[5px] rounded-full z-[5] border border-black/30"
                          style={{ backgroundColor: genreDotColor }}
                        />

                        {/* Highlight accent bar — own or competitor */}
                        {isHighlighted && (
                          <div className="absolute top-0 bottom-0 left-0 w-[2.5px] z-[4]" style={{ backgroundColor: accentColor }} />
                        )}
                      </a>
                    );
                  })}
                </div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-black to-transparent pointer-events-none z-10" />
              </div>

              {/* ── Bottom Nav ── */}
              <div className="flex items-center justify-around px-1 pt-[4px] pb-[2px] bg-black shrink-0">
                <div className="flex flex-col items-center gap-[1px]">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 5.5L6 1.5L10.5 5.5V10.5H7.5V7.5H4.5V10.5H1.5V5.5Z" fill="white" opacity="0.6"/></svg>
                  <span className="text-[4.5px] text-[#8a8a8a]">ホーム</span>
                </div>
                <div className="flex flex-col items-center gap-[1px]">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="5" cy="4" r="2.2" stroke="white" strokeWidth="0.8" opacity="0.6"/><path d="M1 10.5c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="white" strokeWidth="0.8" opacity="0.6"/></svg>
                  <span className="text-[4.5px] text-[#8a8a8a]">友達</span>
                </div>
                {/* Create button */}
                <div className="flex flex-col items-center">
                  <div className="relative w-[24px] h-[14px]">
                    <div className="absolute left-[1px] top-[1px] w-[20px] h-[12px] rounded-[3px] bg-[#25f4ee]" />
                    <div className="absolute right-[1px] top-[1px] w-[20px] h-[12px] rounded-[3px] bg-[#fe2c55]" />
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[20px] h-[12px] rounded-[3px] bg-white flex items-center justify-center">
                      <svg width="7" height="7" viewBox="0 0 7 7" fill="none"><path d="M3.5 1.2V5.8M1.2 3.5H5.8" stroke="black" strokeWidth="1.3" strokeLinecap="round"/></svg>
                    </div>
                  </div>
                </div>
                {/* Inbox — chat bubble */}
                <div className="flex flex-col items-center gap-[1px]">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 2.5h8a1 1 0 011 1v4.5a1 1 0 01-1 1H6L3.5 10.5V9H2a1 1 0 01-1-1V3.5a1 1 0 011-1z" stroke="white" strokeWidth="0.8" opacity="0.6"/>
                  </svg>
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

      {/* Cold overlay for Before */}
      {isBefore && (
        <div className="absolute inset-0 rounded-[28px] pointer-events-none z-40" style={{ background: "rgba(20, 30, 50, 0.12)" }} />
      )}
    </div>
  );
}

function SovSlotCell({ slot, keyword, phase, isBefore, onSlotUpdate, rankChangeLabel, rankChangeBadgeColor, readOnly }: {
  slot: SlotData;
  maxViewCount: number;
  keyword: string;
  phase: "before" | "after";
  isBefore?: boolean;
  onSlotUpdate: (keyword: string, phase: "before" | "after", videoId: string, changes: any) => void;
  readOnly?: boolean;
  rankChangeLabel?: string | null;
  rankChangeBadgeColor?: string;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const genreInfo = GENRE_CONFIG[slot.genre] || GENRE_CONFIG.other;
  const isOwn = slot.owner === "own";
  const isCompetitor = slot.owner === "competitor";

  const configKey: keyof typeof SOV_SLOT_CONFIG = isOwn
    ? (slot.owner_detail === "campaign" ? "campaign" : slot.owner_detail === "satellite" ? "satellite" : "official")
    : isCompetitor ? "competitor" : "other";
  const cfg = SOV_SLOT_CONFIG[configKey];
  const isLabeled = isOwn || isCompetitor;

  // サイズ: isBefore=true は縮小、After自社はサイズアップ
  const cardW = isBefore
    ? (isOwn ? "w-16" : "w-14")
    : (isOwn ? "w-20" : "w-16");
  const thumbH = isBefore
    ? (isOwn ? "h-[114px]" : "h-[100px]")
    : (isOwn ? "h-[142px]" : "h-[114px]");

  // Before側: 彩度低・opacity低
  const beforeFilter = isBefore
    ? "opacity-60 saturate-[0.4] hover:opacity-80 hover:saturate-[0.7]"
    : "";
  // After自社: elevation + ring
  const ownAfterElevation = !isBefore && isOwn
    ? "ring-2 ring-white/20"
    : "";

  return (
    <Popover open={editOpen} onOpenChange={setEditOpen}>
    <div className={`relative flex flex-col ${cardW} shrink-0 group/slot transition-all duration-200 ${beforeFilter}`}>
      {/* 鉛筆ボタン — ホバー時に表示 */}
      {!readOnly && (<>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); }}
          className={`absolute -top-1.5 -right-1.5 z-40 w-5 h-5 rounded-full bg-[#f5f5f5] border border-black/8 shadow-md flex items-center justify-center
            transition-all duration-200 hover:bg-card hover:border-black/12 hover:border-black/15
            ${editOpen ? "opacity-100 scale-100" : "opacity-0 scale-75 pointer-events-none group-hover/slot:opacity-100 group-hover/slot:scale-100 group-hover/slot:pointer-events-auto"}`}
        >
          <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="p-3 w-auto z-50" onOpenAutoFocus={(e) => e.preventDefault()}>
        <SovSlotEditForm
          slot={slot}
          onSave={(changes) => {
            onSlotUpdate(keyword, phase, slot.video_id, changes);
            setEditOpen(false);
            toast.success("スロットを更新しました");
          }}
          onCancel={() => setEditOpen(false)}
        />
      </PopoverContent>
      </>)}

      {/* カード本体 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={slot.video_url}
            target="_blank"
            rel="noopener noreferrer"
            className={`relative flex flex-col cursor-pointer transition-all duration-200 ${editOpen ? "" : "hover:scale-110 hover:z-10"} ${ownAfterElevation ? `rounded-md ${ownAfterElevation}` : ""}`}
            onClick={(e) => { if (editOpen) { e.preventDefault(); } e.stopPropagation(); }}
          >
            {/* トップキャップ: 公式/施策/競合 ラベル */}
            {isLabeled && cfg.capLabel ? (
              <div className={`${cfg.capBg} ${cfg.capText} text-[8px] font-bold text-center py-[2px] rounded-t-md leading-tight shrink-0`}>
                {cfg.capLabel}
              </div>
            ) : (
              <div className="h-[14px] shrink-0" />
            )}

            {/* サムネイル */}
            <div className={`relative w-full ${thumbH} overflow-hidden ${isLabeled ? `rounded-b-md border-2 ${cfg.wrapperBorder} ${cfg.wrapperShadow}` : "rounded-md border border-border/70"}`}>
              {/* 左アクセントバー */}
              {isLabeled && (
                <div className={`absolute top-0 left-0 bottom-0 w-[3px] ${cfg.accentBar} z-10`} />
              )}

              {slot.cover_url ? (
                <img src={slot.cover_url} alt="" className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <div className={`w-full h-full flex items-center justify-center ${cfg.emptyBg}`}>
                  <span className={`text-lg font-bold ${cfg.emptyText}`}>{slot.rank}</span>
                </div>
              )}

              {/* 順位バッジ */}
              <span className={`absolute top-1 right-1 text-[9px] font-bold leading-none px-1 py-0.5 rounded z-20 ${cfg.rankBg} ${cfg.rankText}`}>
                {slot.rank}
              </span>

              {/* TikTokラベルドット（プロモーション/有償/AI） */}
              {slot.tiktok_labels.length > 0 && (
                <div className="absolute top-1 left-1 flex gap-0.5 z-20">
                  {slot.tiktok_labels.map(label => {
                    const lCfg = TIKTOK_LABEL_CONFIG[label];
                    return lCfg ? <span key={label} className={`w-2 h-2 rounded-full ${lCfg.dot} shadow-sm ring-1 ring-white/50`} /> : null;
                  })}
                </div>
              )}

              {/* ジャンルバー */}
              <div className={`absolute bottom-0 left-0 right-0 h-1.5 z-10 ${genreInfo.barCls}`} />
              {/* ランク変動バッジ */}
              {rankChangeLabel && (
                <span className={`absolute bottom-2.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[8px] font-bold text-foreground whitespace-nowrap z-20 ${rankChangeBadgeColor || "bg-black/55"}`}>
                  {rankChangeLabel}
                </span>
              )}
            </div>
          </a>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs bg-[#f5f5f5] text-foreground border shadow-none p-3 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-xs">#{slot.rank}</span>
            <span className="text-xs text-secondary-foreground">@{slot.creator_username}</span>
            {isOwn && cfg.capLabel && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${cfg.capBg} ${cfg.capText}`}>{cfg.capLabel}</span>
            )}
            {isCompetitor && slot.owner_name && (
              <span className="text-[9px] text-muted-foreground font-medium">競合: {slot.owner_name}</span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground line-clamp-2">{slot.description}</p>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-0.5"><Eye className="h-3 w-3" />{fmt(slot.view_count)}</span>
            <span className="flex items-center gap-0.5"><Heart className="h-3 w-3" />{fmt(slot.like_count)}</span>
            <span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{fmt(slot.comment_count)}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[9px] px-1 rounded ${genreInfo.cls}`}>{genreInfo.label}</span>
            {slot.tiktok_labels.map(label => {
              const lCfg = TIKTOK_LABEL_CONFIG[label];
              return lCfg ? (
                <span key={label} className="inline-flex items-center gap-1 text-[9px]">
                  <span className={`w-2 h-2 rounded-full ${lCfg.dot}`} />{lCfg.text}
                </span>
              ) : null;
            })}
          </div>
        </TooltipContent>
      </Tooltip>
    </div>
    </Popover>
  );
}

// (Old SovOccupationMap + SovSection removed — functionality now in UnifiedKeywordSovSection)

// ============================
// Section 6: Competitor
// ============================

export function CompetitorSection({ compReport, freqReport, bigKeywordReport, hasBaseline }: { compReport: Record<string, any>; freqReport: any[]; bigKeywordReport?: Array<{ keyword: string; before: { ownVideoCount: number; bestRank: number | null }; after: { ownVideoCount: number; bestRank: number | null }; competitors?: Array<{ competitor_name: string; competitor_id: string; best_rank: number | null; video_count_in_top30: number; before_best_rank: number | null; before_video_count_in_top30: number; rank_change: number | null }> }>; hasBaseline: boolean }) {
  // 全競合名を収集（施策KW + ビッグKW）— URLではなく@usernameで表示
  const compNames = new Map<string, string>(); // id -> display name
  const toDisplayName = (id: string, name: string) => {
    // nameがURLの場合は@account_idを使う
    if (name.includes("tiktok.com") || name.startsWith("http")) return `@${id}`;
    return name;
  };
  for (const data of Object.values(compReport)) {
    for (const c of data.competitors || []) {
      compNames.set(c.competitor_id, toDisplayName(c.competitor_id, c.competitor_name));
    }
  }
  if (bigKeywordReport) {
    for (const item of bigKeywordReport) {
      for (const c of item.competitors || []) {
        compNames.set(c.competitor_id, toDisplayName(c.competitor_id, c.competitor_name));
      }
    }
  }
  const compList = Array.from(compNames.entries()); // [[id, displayName], ...]

  // 統合テーブル行データ: 施策KW + ビッグKW
  type RowData = { keyword: string; type: "施策KW" | "ビッグKW"; ownBefore: number | null; ownAfter: number | null; comps: Record<string, { before: number | null; after: number | null; count: number }> };
  const rows: RowData[] = [];

  for (const [kw, data] of Object.entries(compReport)) {
    const comps: RowData["comps"] = {};
    for (const c of data.competitors || []) {
      comps[c.competitor_id] = { before: c.before_best_rank ?? null, after: c.best_rank ?? null, count: c.video_count_in_top30 };
    }
    rows.push({ keyword: kw, type: "施策KW", ownBefore: data.own_rank_before ?? null, ownAfter: data.own_rank ?? null, comps });
  }
  if (bigKeywordReport) {
    for (const item of bigKeywordReport) {
      const comps: RowData["comps"] = {};
      for (const c of item.competitors || []) {
        comps[c.competitor_id] = { before: c.before_best_rank ?? null, after: c.best_rank ?? null, count: c.video_count_in_top30 };
      }
      rows.push({ keyword: item.keyword, type: "ビッグKW", ownBefore: item.before.bestRank, ownAfter: item.after.bestRank, comps });
    }
  }

  const rankCell = (before: number | null, after: number | null) => (
    <div className="flex flex-col items-center">
      {before != null && <span className="text-[10px] text-muted-foreground">{before}位</span>}
      <span className={`font-medium ${after != null ? "text-foreground" : "text-muted-foreground"}`}>
        {after != null ? `${after}位` : "圏外"}
      </span>
      {before != null && after != null && (
        <ChangeIndicator value={before - after} suffix="位" />
      )}
    </div>
  );

  return (
    <div className="space-y-4 min-w-0">
      {/* 統合順位比較テーブル */}
      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">キーワード別順位比較</CardTitle>
            <CardDescription className="text-xs">施策KW・ビッグKWでの自社と競合の検索順位（Top30）</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto min-w-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>キーワード</TableHead>
                  <TableHead className="text-center text-foreground font-bold">自社</TableHead>
                  {compList.map(([id, name]) => (
                    <TableHead key={id} className="text-center">{name}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.keyword}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{row.keyword}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${row.type === "ビッグKW" ? "bg-[#f5f5f5] text-muted-foreground" : "bg-[#f5f5f5] text-muted-foreground"}`}>
                          {row.type}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center bg-card/50">
                      {rankCell(row.ownBefore, row.ownAfter)}
                    </TableCell>
                    {compList.map(([id]) => {
                      const c = row.comps[id];
                      return (
                        <TableCell key={id} className="text-center">
                          {c ? rankCell(c.before, c.after) : <span className="text-muted-foreground">-</span>}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* 投稿頻度比較 */}
      {freqReport.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">投稿頻度比較</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {freqReport.map((entry, i) => (
                <div key={i} className={`px-4 py-3 rounded-lg border ${entry.is_own ? "border-primary/30 bg-primary/5" : ""}`}>
                  <p className="text-sm font-medium">{entry.name}</p>
                  <p className="text-lg font-bold mt-1">
                    {entry.frequency ? `週${entry.frequency.posts_per_week}本` : "-"}
                  </p>
                  {entry.frequency && (
                    <p className="text-xs text-muted-foreground">
                      平均{entry.frequency.avg_interval_days}日間隔
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================
// UGC Card Grid (used in RippleSection)
// ============================

function UgcCardGrid({ videos, initialShow, overrides, onSentimentChange }: {
  videos: any[];
  initialShow: number;
  overrides: Record<string, "positive" | "neutral" | "negative">;
  onSentimentChange: (key: string, val: "positive" | "neutral" | "negative") => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? videos : videos.slice(0, initialShow);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-5 py-4 border-b border-black/4">
          <h3 className="text-sm font-bold text-foreground">注目の第三者投稿（再生数上位）</h3>
          <p className="text-xs text-muted-foreground mt-0.5">施策の波及で生まれたオーガニック投稿</p>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayed.map((v: any, i: number) => {
              const vKey = v.video_url || `${v.creator}-${i}`;
              return <UgcCard key={vKey} v={v} vKey={vKey} sentiment={overrides[vKey]} onSentimentChange={onSentimentChange} />;
            })}
          </div>
          {/* Show more / less button */}
          {videos.length > initialShow && (
            <div className="text-center mt-4 pt-3 border-t border-black/4">
              <button
                onClick={(e) => { e.preventDefault(); setShowAll(!showAll); }}
                className="text-xs font-semibold text-muted-foreground hover:text-muted-foreground hover:bg-card px-4 py-1.5 rounded-full transition-colors"
              >
                {showAll ? `閉じる` : `もっと見る（残り ${videos.length - initialShow} 件）`}
              </button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const SENTIMENT_KEYS = ["positive", "neutral", "negative"] as const;

function UgcCard({ v, vKey, sentiment: overrideSentiment, onSentimentChange }: {
  v: any;
  vKey: string;
  sentiment?: "positive" | "neutral" | "negative";
  onSentimentChange: (key: string, val: "positive" | "neutral" | "negative") => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const tags = (v.hashtags || []).slice(0, 3);
  const sentiment = overrideSentiment || analyzeSentiment(v.description);
  const sentCfg = SENTIMENT_CONFIG[sentiment];

  return (
    <div className="relative group/ugc">
      <a
        href={v.video_url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex gap-3 rounded-xl bg-card/80 border border-black/4 p-3.5 hover:border-black/8 hover:border-black/12 transition-all"
      >
        {/* Thumbnail */}
        <div className="relative flex-shrink-0">
          {v.cover_url ? (
            <img src={v.cover_url} alt="" className="w-[56px] h-[100px] rounded-lg object-cover" loading="lazy" />
          ) : (
            <div className="w-[56px] h-[100px] rounded-lg bg-[#f5f5f5] flex items-center justify-center">
              <Play className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          <span className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full border shadow-sm flex items-center justify-center ${sentCfg.bg}`}>
            <sentCfg.Icon className={`h-2.5 w-2.5 ${sentCfg.color}`} />
          </span>
        </div>
        {/* Meta */}
        <div className="flex-1 min-w-0 flex flex-col justify-between gap-1">
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-bold text-foreground truncate">@{v.creator}</p>
              <span className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-px rounded-full border ${sentCfg.bg} ${sentCfg.color} flex-shrink-0`}>
                <sentCfg.Icon className="h-2 w-2" />
                {sentCfg.label}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground line-clamp-2 leading-snug mt-0.5">{v.description?.slice(0, 80)}</p>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag: string, ti: number) => (
                <span key={ti} className="text-[9px] font-medium text-muted-foreground bg-card border border-border rounded-full px-1.5 py-px">
                  #{tag.replace(/^#/, "")}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-0.5"><Eye className="h-2.5 w-2.5" /><strong className="text-foreground">{fmt(v.views)}</strong></span>
            <span className="flex items-center gap-0.5"><Heart className="h-2.5 w-2.5" /><strong className="text-foreground">{fmt(v.likes)}</strong></span>
            <span className="flex items-center gap-0.5"><MessageCircle className="h-2.5 w-2.5" /><strong className="text-foreground">{fmt(v.comments)}</strong></span>
            <span className="flex items-center gap-0.5"><Share2 className="h-2.5 w-2.5" /><strong className="text-foreground">{fmt(v.shares)}</strong></span>
            {v.saves != null && <span className="flex items-center gap-0.5"><Bookmark className="h-2.5 w-2.5" /><strong className="text-foreground">{fmt(v.saves)}</strong></span>}
            {v.views > 0 && <span className="flex items-center gap-0.5"><TrendingUp className="h-2.5 w-2.5" /><strong className="text-foreground">{(((v.likes || 0) + (v.comments || 0)) / v.views * 100).toFixed(2)}%</strong></span>}
          </div>
          {v.posted_at && <p className="text-[10px] text-muted-foreground">{new Date(v.posted_at).toLocaleDateString("ja-JP")}</p>}
        </div>
      </a>
      {/* Edit pencil */}
      <Popover open={editOpen} onOpenChange={setEditOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-[#f5f5f5] border border-border shadow-sm flex items-center justify-center transition-all duration-200 hover:bg-card hover:border-black/12 hover:border-black/12 ${
              editOpen ? "opacity-100 scale-100" : "opacity-0 scale-90 pointer-events-none group-hover/ugc:opacity-100 group-hover/ugc:scale-100 group-hover/ugc:pointer-events-auto"
            }`}
          >
            <Pencil className="h-3 w-3 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="left" align="start" className="p-3 w-48 z-50" onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="space-y-2">
            <div className="flex items-center gap-2 pb-1.5 border-b border-black/4">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">センチメント分類</span>
            </div>
            <div className="flex flex-col gap-1">
              {SENTIMENT_KEYS.map(key => {
                const cfg = SENTIMENT_CONFIG[key];
                const isActive = sentiment === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { onSentimentChange(vKey, key); setEditOpen(false); }}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                      isActive ? `${cfg.bg} ${cfg.color} border` : "text-muted-foreground hover:bg-card"
                    }`}
                  >
                    <cfg.Icon className={`h-3.5 w-3.5 ${isActive ? cfg.color : "text-muted-foreground"}`} />
                    {cfg.label}
                    {isActive && <Check className="h-3 w-3 ml-auto" />}
                  </button>
                );
              })}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ============================
// Section 7: Ripple
// ============================

export function RippleSection({ ripple, communityAnalysis, campaign, campaignId, keywordSentimentReport }: { ripple: Record<string, any>; communityAnalysis?: { communities: Array<{ label: string; summary: string; keyAngle?: string; isTargeted: boolean; postCount: number; totalViews: number; representativeVideos: Array<{ video_url: string; creator: string; description: string; views: number; cover_url?: string }> }>; unclassifiedCount: number }; campaign?: any; campaignId?: number; keywordSentimentReport?: Record<string, { total: number; positive: number; neutral: number; negative: number }> }) {
  // Load saved sentiments from ripple data
  const savedSentiments = useMemo(() => {
    const map: Record<string, "positive" | "neutral" | "negative"> = {};
    for (const [key, tagData] of Object.entries(ripple)) {
      if (key.startsWith("_")) continue;
      for (const v of (tagData.third_party_videos || tagData.omaage_videos || [])) {
        if (v.sentiment && v.video_url) {
          map[v.video_url] = v.sentiment;
        }
      }
    }
    return map;
  }, [ripple]);

  const [sentimentOverrides, setSentimentOverrides] = useState<Record<string, "positive" | "neutral" | "negative">>(savedSentiments);

  const updateSentimentMutation = trpc.campaign.updateThirdPartySentiment.useMutation({
    onError: () => toast.error("センチメント更新に失敗しました"),
  });

  const handleSentimentChange = useCallback((key: string, val: "positive" | "neutral" | "negative") => {
    setSentimentOverrides(prev => ({ ...prev, [key]: val }));
    if (campaignId) {
      updateSentimentMutation.mutate({ campaignId, videoUrl: key, sentiment: val });
    }
  }, [campaignId, updateSentimentMutation]);

  const entries = Object.entries(ripple).filter(([key]) => !key.startsWith("_"));

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          キャンペーンハッシュタグが設定されていないため、波及効果データがありません。
        </CardContent>
      </Card>
    );
  }

  // All third-party videos (deduped across hashtags, sorted by views)
  const allVideosRaw = entries.flatMap(([, data]) =>
    (data.third_party_videos || data.omaage_videos || [])
  );
  const seenVideoUrls = new Set<string>();
  const allVideos = allVideosRaw
    .sort((a: any, b: any) => (b.views || 0) - (a.views || 0))
    .filter((v: any) => {
      const key = v.video_url || v.video_id || `${v.creator}-${v.description}`;
      if (seenVideoUrls.has(key)) return false;
      seenVideoUrls.add(key);
      return true;
    });

  // Aggregate KPIs — use deduplicated allVideos for consistency
  const dedupTotalViews = allVideos.reduce((s: number, v: any) => s + (v.views || 0), 0);
  const maxViews = allVideos.length > 0 ? Math.max(...allVideos.map((v: any) => v.views || 0)) : 0;

  // KW sentiment aggregated totals
  const kwSentAgg = useMemo(() => {
    if (!keywordSentimentReport) return null;
    let total = 0, positive = 0, neutral = 0, negative = 0;
    for (const v of Object.values(keywordSentimentReport)) {
      total += v.total; positive += v.positive; neutral += v.neutral; negative += v.negative;
    }
    return { total, positive, neutral, negative };
  }, [keywordSentimentReport]);

  return (
    <div className="space-y-5 min-w-0">
      {/* ======== 界隈（コミュニティ）分析カード ======== */}
      {communityAnalysis && communityAnalysis.communities.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-amber-600" />
            <h3 className="text-sm font-bold text-foreground">リーチした界隈</h3>
            <span className="text-xs text-muted-foreground">AIによるコミュニティ分類</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {communityAnalysis.communities.map((comm, i) => (
              <Card key={i} className="relative overflow-hidden group hover:shadow-md transition-shadow">
                {/* Left accent bar */}
                <div className={`absolute top-0 left-0 h-full w-1 ${comm.isTargeted ? "bg-emerald-500" : "bg-amber-500"}`} />

                <CardContent className="py-4 pl-5 pr-4 space-y-2.5">
                  {/* Header: label + badge */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-foreground">{comm.label}</span>
                    {comm.isTargeted ? (
                      <Badge className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100">
                        <Target className="h-2.5 w-2.5 mr-0.5" />
                        狙い通り
                      </Badge>
                    ) : (
                      <Badge className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
                        <Sparkles className="h-2.5 w-2.5 mr-0.5" />
                        予想外の発見
                      </Badge>
                    )}
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Play className="h-3 w-3" />
                      <strong className="text-foreground">{comm.postCount}</strong>投稿
                    </span>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Eye className="h-3 w-3" />
                      <strong className="text-foreground">{fmt(comm.totalViews)}</strong>再生
                    </span>
                  </div>

                  {/* Summary */}
                  <p className="text-xs text-muted-foreground leading-relaxed">{comm.summary}</p>

                  {/* Key Angle */}
                  {comm.keyAngle && (
                    <span className="inline-block text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-medium">
                      {comm.keyAngle}
                    </span>
                  )}

                  {/* Representative video thumbnails */}
                  {comm.representativeVideos.length > 0 && (
                    <div className="flex gap-1.5 pt-1">
                      {comm.representativeVideos.map((rv, j) => (
                        <a
                          key={j}
                          href={rv.video_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="relative w-14 h-[74px] rounded overflow-hidden bg-black/5 shrink-0 group/thumb"
                          title={`@${rv.creator} — ${fmt(rv.views)}再生`}
                        >
                          {rv.cover_url ? (
                            <img src={rv.cover_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Play className="h-4 w-4 text-muted-foreground/40" />
                            </div>
                          )}
                          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-1 py-0.5">
                            <span className="text-[8px] text-white font-medium leading-none">{fmt(rv.views)}</span>
                          </div>
                          <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/10 transition-colors" />
                        </a>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          {communityAnalysis.unclassifiedCount > 0 && (
            <p className="text-[11px] text-muted-foreground text-right">
              ※ 未分類: {communityAnalysis.unclassifiedCount}投稿
            </p>
          )}
        </div>
      )}

      {/* ======== Community analysis ran but no clusters ======== */}
      {communityAnalysis && communityAnalysis.communities.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">
          コミュニティの傾向は検出されませんでした
        </p>
      )}

      {/* ======== Hero KPI Row ======== */}
      <div className={`grid gap-4 ${kwSentAgg ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"}`}>
        {[
          { label: "第三者投稿", value: allVideos.length, unit: "本", color: "text-foreground", fmtVal: false },
          { label: "総再生数", value: dedupTotalViews, unit: "", color: "text-foreground", fmtVal: true },
          ...(kwSentAgg ? [
            { label: "検索分析数", value: kwSentAgg.total, unit: "件", color: "text-foreground", fmtVal: false },
            { label: "ポジティブ率", value: kwSentAgg.total > 0 ? Math.round((kwSentAgg.positive / kwSentAgg.total) * 100) : 0, unit: "%", color: "text-emerald-600", fmtVal: false },
          ] : [
            { label: "最高再生", value: maxViews, unit: "", color: "text-foreground", fmtVal: true },
          ]),
        ].map((kpi, i) => (
          <Card key={i}>
            <CardContent className="py-3 px-4 text-center">
              <p className="text-[11px] text-muted-foreground font-semibold tracking-wide uppercase mb-2">{kpi.label}</p>
              <p className={`text-3xl font-extrabold leading-none ${kpi.color}`}>
                {kpi.fmtVal ? fmt(kpi.value) : kpi.value}
                {kpi.unit && <span className="text-base font-semibold ml-0.5">{kpi.unit}</span>}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ======== KW Sentiment Analysis (new) ======== */}
      {kwSentAgg && kwSentAgg.total > 0 && (() => {
        const total = kwSentAgg.total;
        const posPct = Math.round((kwSentAgg.positive / total) * 100);
        const neuPct = Math.round((kwSentAgg.neutral / total) * 100);
        const negPct = 100 - posPct - neuPct;
        const segments = [
          { key: "positive" as const, pct: posPct, count: kwSentAgg.positive },
          { key: "neutral" as const, pct: neuPct, count: kwSentAgg.neutral },
          { key: "negative" as const, pct: negPct, count: kwSentAgg.negative },
        ].filter(s => s.count > 0);
        const radius = 42;
        const circumference = 2 * Math.PI * radius;
        let cumulativeOffset = 0;
        const donutSegments = segments.map(s => {
          const dash = (s.pct / 100) * circumference;
          const offset = cumulativeOffset;
          cumulativeOffset += dash;
          return { ...s, dash, offset };
        });
        const donutColors = { positive: "#059669", neutral: "#6b7280", negative: "#D71921" };

        return (
          <Card>
            <CardContent className="p-0">
              <div className="px-5 py-4 border-b border-black/4">
                <h3 className="text-sm font-bold text-foreground">センチメント分析</h3>
                <p className="text-xs text-muted-foreground mt-0.5">KW検索結果のキャプションから感情を自動分類</p>
              </div>
              <div className="p-5">
                <div className="flex items-center gap-8">
                  <div className="flex-shrink-0 relative">
                    <svg width="120" height="120" viewBox="0 0 120 120">
                      <circle cx="60" cy="60" r={radius} fill="none" stroke="#e5e5e5" strokeWidth="12" />
                      {donutSegments.map((seg) => (
                        <circle
                          key={seg.key}
                          cx="60" cy="60" r={radius}
                          fill="none"
                          stroke={donutColors[seg.key]}
                          strokeWidth="12"
                          strokeDasharray={`${seg.dash} ${circumference - seg.dash}`}
                          strokeDashoffset={-seg.offset}
                          strokeLinecap="round"
                          transform="rotate(-90 60 60)"
                          className="animate-donut-fill"
                          style={{ opacity: 0.85 }}
                        />
                      ))}
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-black text-foreground">{total}</span>
                      <span className="text-[10px] text-muted-foreground font-medium">分析数</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-3">
                    {([
                      { key: "positive" as const, label: "ポジティブ", Icon: TrendingUp, color: "bg-emerald-500", textColor: "text-emerald-700", iconColor: "text-emerald-500" },
                      { key: "neutral" as const, label: "ナチュラル", Icon: Minus, color: "bg-[#9ca3af]", textColor: "text-[#6b7280]", iconColor: "text-[#9ca3af]" },
                      { key: "negative" as const, label: "ネガティブ", Icon: TrendingDown, color: "bg-[#D71921]", textColor: "text-[#D71921]", iconColor: "text-[#D71921]/70" },
                    ]).map((row) => {
                      const count = kwSentAgg[row.key];
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      return (
                        <div key={row.key}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                              <row.Icon className={`h-3.5 w-3.5 ${row.iconColor}`} />
                              {row.label}
                            </span>
                            <span className="text-xs tabular-nums">
                              <strong className={row.textColor}>{count}</strong>
                              <span className="text-muted-foreground ml-1">({pct}%)</span>
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-[#f5f5f5] overflow-hidden">
                            <div
                              className={`h-full rounded-full ${row.color} transition-all duration-700 ease-out`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* ======== Post-Campaign Sentiment Analysis (既存: renamed) ======== */}
      {allVideos.length > 0 && (() => {
        const sentCounts = { positive: 0, neutral: 0, negative: 0 };
        for (const v of allVideos) {
          const vKey = v.video_url || `${v.creator}-${allVideos.indexOf(v)}`;
          sentCounts[sentimentOverrides[vKey] || analyzeSentiment(v.description)]++;
        }
        const total = allVideos.length;
        const posPct = Math.round((sentCounts.positive / total) * 100);
        const neuPct = Math.round((sentCounts.neutral / total) * 100);
        const negPct = 100 - posPct - neuPct;
        const segments = [
          { key: "positive" as const, pct: posPct, count: sentCounts.positive },
          { key: "neutral" as const, pct: neuPct, count: sentCounts.neutral },
          { key: "negative" as const, pct: negPct, count: sentCounts.negative },
        ].filter(s => s.count > 0);
        // Donut SVG params
        const radius = 42;
        const circumference = 2 * Math.PI * radius;
        let cumulativeOffset = 0;
        const donutSegments = segments.map(s => {
          const dash = (s.pct / 100) * circumference;
          const offset = cumulativeOffset;
          cumulativeOffset += dash;
          return { ...s, dash, offset };
        });
        const donutColors = { positive: "#059669", neutral: "#6b7280", negative: "#D71921" };

        return (
          <Card>
            <CardContent className="p-0">
              <div className="px-5 py-4 border-b border-black/4">
                <h3 className="text-sm font-bold text-foreground">施策後センチメント分析</h3>
                <p className="text-xs text-muted-foreground mt-0.5">第三者投稿のキャプションから感情を自動分類</p>
              </div>
              <div className="p-5">
                <div className="flex items-center gap-8">
                  {/* Donut chart */}
                  <div className="flex-shrink-0 relative">
                    <svg width="120" height="120" viewBox="0 0 120 120">
                      <circle cx="60" cy="60" r={radius} fill="none" stroke="#e5e5e5" strokeWidth="12" />
                      {donutSegments.map((seg) => (
                        <circle
                          key={seg.key}
                          cx="60" cy="60" r={radius}
                          fill="none"
                          stroke={donutColors[seg.key]}
                          strokeWidth="12"
                          strokeDasharray={`${seg.dash} ${circumference - seg.dash}`}
                          strokeDashoffset={-seg.offset}
                          strokeLinecap="round"
                          transform="rotate(-90 60 60)"
                          className="animate-donut-fill"
                          style={{ opacity: 0.85 }}
                        />
                      ))}
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-black text-foreground">{total}</span>
                      <span className="text-[10px] text-muted-foreground font-medium">投稿</span>
                    </div>
                  </div>

                  {/* Breakdown bars */}
                  <div className="flex-1 space-y-3">
                    {([
                      { key: "positive" as const, label: "ポジティブ", Icon: TrendingUp, color: "bg-emerald-500", textColor: "text-emerald-700", iconColor: "text-emerald-500" },
                      { key: "neutral" as const, label: "ナチュラル", Icon: Minus, color: "bg-[#9ca3af]", textColor: "text-[#6b7280]", iconColor: "text-[#9ca3af]" },
                      { key: "negative" as const, label: "ネガティブ", Icon: TrendingDown, color: "bg-[#D71921]", textColor: "text-[#D71921]", iconColor: "text-[#D71921]/70" },
                    ]).map((row) => {
                      const count = sentCounts[row.key];
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      return (
                        <div key={row.key}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                              <row.Icon className={`h-3.5 w-3.5 ${row.iconColor}`} />
                              {row.label}
                            </span>
                            <span className="text-xs tabular-nums">
                              <strong className={row.textColor}>{count}</strong>
                              <span className="text-muted-foreground ml-1">({pct}%)</span>
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-[#f5f5f5] overflow-hidden">
                            <div
                              className={`h-full rounded-full ${row.color} transition-all duration-700 ease-out`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* ======== UGC Cards (top third-party videos) ======== */}
      {allVideos.length > 0 && (
        <UgcCardGrid videos={allVideos} initialShow={6} overrides={sentimentOverrides} onSentimentChange={handleSentimentChange} />
      )}

      {/* ======== Story Connector ======== */}
      <div className="flex items-center justify-center gap-3 py-2 text-xs font-semibold text-muted-foreground">
        <span>TikTokでの拡散</span>
        <div className="w-8 h-px bg-[#d4d4d4] relative">
          <div className="absolute -right-1 -top-[3px] border-l-[6px] border-l-slate-300 border-y-[4px] border-y-transparent" />
        </div>
        <span>Google検索への波及</span>
        <div className="w-8 h-px bg-[#d4d4d4] relative">
          <div className="absolute -right-1 -top-[3px] border-l-[6px] border-l-slate-300 border-y-[4px] border-y-transparent" />
        </div>
        <span>認知度の向上</span>
      </div>
    </div>
  );
}

// ============================
// Section 8: Cross Platform
// ============================

export function CrossPlatformSection({ data, videoMetrics, baselineDate, measurementDate, ripple, campaignStart, campaignEnd }: {
  data: any; videoMetrics?: any[]; baselineDate?: any; measurementDate?: any; ripple?: Record<string, any>; campaignStart?: string; campaignEnd?: string;
}) {
  // 日次チャートデータ（Trends + 自社再生数 + 第三者再生数）
  const dailyChartData = useMemo(() => {
    const trendMap = new Map<string, number>((data.trendsData || []).map((t: any) => [t.date, t.value]));
    const videoMap = new Map<string, any>((data.videoTimeline || []).map((v: any) => [v.date, v]));

    // videoTimelineが空の場合、videoMetricsからフォールバック
    if (videoMap.size === 0 && videoMetrics && videoMetrics.length > 0) {
      const fallbackMap = new Map<string, { postCount: number; totalViews: number }>();
      for (const v of videoMetrics) {
        if (!v.postedAt) continue;
        const date = new Date(v.postedAt).toISOString().split("T")[0];
        const existing = fallbackMap.get(date) || { postCount: 0, totalViews: 0 };
        existing.postCount += 1;
        existing.totalViews += (v.after?.viewCount || v.before?.viewCount || 0);
        fallbackMap.set(date, existing);
      }
      for (const [date, stats] of fallbackMap) videoMap.set(date, { date, ...stats });
    }

    // TikTok固有メトリクス（シェア・保存）を日別集計
    const tiktokEngMap = new Map<string, { shares: number; saves: number }>();
    if (videoMetrics && videoMetrics.length > 0) {
      for (const v of videoMetrics) {
        if (!v.postedAt) continue;
        const platform = v.platform || "tiktok";
        if (platform !== "tiktok") continue;
        const date = new Date(v.postedAt).toISOString().split("T")[0];
        const existing = tiktokEngMap.get(date) || { shares: 0, saves: 0 };
        existing.shares += (v.after?.shareCount || 0);
        existing.saves += (v.after?.saveCount || 0);
        tiktokEngMap.set(date, existing);
      }
    }

    // 第三者投稿の日別再生数
    const tpDayViews = new Map<string, number>();
    if (ripple) {
      for (const [, tagData] of Object.entries(ripple)) {
        for (const v of (tagData.third_party_videos || tagData.omaage_videos || [])) {
          if (v.posted_at) {
            const d = v.posted_at.split("T")[0];
            tpDayViews.set(d, (tpDayViews.get(d) || 0) + (v.views || 0));
          }
        }
      }
    }

    const allDates = [...new Set([...trendMap.keys(), ...videoMap.keys(), ...tpDayViews.keys(), ...tiktokEngMap.keys()])].sort();
    let cumViews = 0, cumShares = 0, cumSaves = 0;
    return allDates.map((date: string) => {
      const dayViews = videoMap.get(date)?.totalViews ?? 0;
      const eng = tiktokEngMap.get(date);
      const dayShares = eng?.shares ?? 0;
      const daySaves = eng?.saves ?? 0;
      cumViews += dayViews;
      cumShares += dayShares;
      cumSaves += daySaves;
      return {
        date: date.slice(5),
        fullDate: date,
        trends: trendMap.get(date) ?? null,
        dailyViews: dayViews > 0 ? dayViews : null,
        views: cumViews > 0 ? cumViews : null,
        dailyShares: dayShares > 0 ? dayShares : null,
        shares: cumShares > 0 ? cumShares : null,
        dailySaves: daySaves > 0 ? daySaves : null,
        saves: cumSaves > 0 ? cumSaves : null,
        thirdPartyViews: tpDayViews.get(date) || null,
      };
    });
  }, [data, videoMetrics, ripple]);

  // マーカー: date → platforms のMap（全媒体対応）
  const markerMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const m of (data.videoMarkers || []) as Array<{ date: string; platform?: string }>) {
      const platforms = map.get(m.date) || new Set<string>();
      platforms.add(m.platform || "tiktok");
      map.set(m.date, platforms);
    }
    if (map.size === 0 && videoMetrics && videoMetrics.length > 0) {
      for (const v of videoMetrics) {
        if (v.postedAt) {
          const d = new Date(v.postedAt).toISOString().split("T")[0];
          const platforms = map.get(d) || new Set<string>();
          platforms.add("tiktok");
          map.set(d, platforms);
        }
      }
    }
    return map;
  }, [data, videoMetrics]);
  const markerDates = useMemo(() => new Set(markerMap.keys()), [markerMap]);

  // 表示期間フィルタ: 最初の投稿日の2週間前 〜 最後の投稿日の2ヶ月後
  const filteredDailyChartData = useMemo(() => {
    const markerArray = Array.from(markerDates).sort();
    if (markerArray.length === 0) return dailyChartData;
    const firstPost = new Date(markerArray[0]);
    const lastPost = new Date(markerArray[markerArray.length - 1]);
    const rangeStart = new Date(firstPost);
    rangeStart.setDate(rangeStart.getDate() - 14);
    const rangeEnd = new Date(lastPost);
    rangeEnd.setMonth(rangeEnd.getMonth() + 2);
    const startStr = rangeStart.toISOString().split("T")[0];
    const endStr = rangeEnd.toISOString().split("T")[0];
    return dailyChartData.filter(d => d.fullDate >= startStr && d.fullDate <= endStr);
  }, [dailyChartData, markerDates]);

  // 施策ハイライト期間: 最初の投稿日 〜 最後の投稿日+2週間
  const highlightRange = useMemo(() => {
    const markerArray = Array.from(markerDates).sort();
    if (markerArray.length === 0) return null;
    const start = markerArray[0].slice(5); // MM-DD format matching chart
    const lastPost = new Date(markerArray[markerArray.length - 1]);
    lastPost.setDate(lastPost.getDate() + 14);
    const end = lastPost.toISOString().split("T")[0].slice(5);
    return { start, end };
  }, [markerDates]);

  // 月別検索ボリュームチャートデータ
  const keywordVolumes = data.keywordSearchVolumes as any[] | undefined;
  const monthlyVolumeData = useMemo(() => {
    if (!keywordVolumes || keywordVolumes.length === 0) return [];
    // 全キーワードの月次データを集約（合計）
    const monthMap = new Map<string, { total: number; perKw: Record<string, number> }>();
    for (const kw of keywordVolumes) {
      for (const mv of (kw.monthlyVolumes || [])) {
        const key = `${mv.year}-${String(mv.month).padStart(2, "0")}`;
        const entry = monthMap.get(key) || { total: 0, perKw: {} };
        entry.total += mv.volume || 0;
        entry.perKw[kw.keyword] = mv.volume || 0;
        monthMap.set(key, entry);
      }
    }
    return [...monthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, d]) => ({ month: month.slice(2), fullMonth: month, total: d.total, ...d.perKw }));
  }, [keywordVolumes]);

  // 月別チャートの施策ハイライト月
  const highlightMonths = useMemo(() => {
    const markerArray = Array.from(markerDates).sort();
    if (markerArray.length === 0) return null;
    const startMonth = markerArray[0].slice(2, 7); // YY-MM
    const lastPost = new Date(markerArray[markerArray.length - 1]);
    lastPost.setDate(lastPost.getDate() + 14);
    const endMonth = lastPost.toISOString().split("T")[0].slice(2, 7);
    return { start: startMonth, end: endMonth };
  }, [markerDates]);


  const VOLUME_COLORS = ["#0a0a0a", "#D71921", "#6366f1", "#059669", "#f59e0b", "#8b5cf6"];

  // Correlation strength helpers
  const corr = data.correlation as number | null | undefined;
  const corrAbs = corr != null ? Math.abs(corr) : 0;
  const corrStrength = corrAbs >= 0.7 ? "強い" : corrAbs >= 0.4 ? "中程度" : "弱い";
  const corrColor = corrAbs >= 0.7 ? "emerald" : corrAbs >= 0.4 ? "amber" : "slate";
  const corrBgClass = corrAbs >= 0.7 ? "bg-card border-black/8" : corrAbs >= 0.4 ? "bg-card border-black/8" : "bg-card border-border";
  const corrTextClass = corrAbs >= 0.7 ? "text-emerald-700" : corrAbs >= 0.4 ? "text-amber-700" : "text-muted-foreground";
  const corrBadgeBg = corrAbs >= 0.7 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : corrAbs >= 0.4 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-[#f5f5f5] text-muted-foreground border-black/8";
  const corrDesc = corrAbs >= 0.7 ? "施策動画がGoogle検索トレンドに明確な影響を与えています" : corrAbs >= 0.4 ? "施策動画とGoogle検索に一定の関連が見られます" : "施策動画とGoogle検索の直接的な関連は限定的です";

  // Monthly volume: compute peak spike
  const peakMonth = useMemo(() => {
    if (monthlyVolumeData.length < 2) return null;
    let maxIdx = 0;
    let maxVal = 0;
    monthlyVolumeData.forEach((d: any, i: number) => { if (d.total > maxVal) { maxVal = d.total; maxIdx = i; } });
    const prevVal = maxIdx > 0 ? monthlyVolumeData[maxIdx - 1].total : 0;
    const pctChange = prevVal > 0 ? Math.round(((maxVal - prevVal) / prevVal) * 100) : 0;
    return { month: monthlyVolumeData[maxIdx].month, total: maxVal, pctChange };
  }, [monthlyVolumeData]);

  return (
    <div className="space-y-5 min-w-0">
      {/* ====== Correlation Hero Card ====== */}
      {corr != null && (
        <Card className={`border ${corrBgClass} relative overflow-hidden`}>
          {/* Decorative gradient accent */}
          <div className={`absolute inset-0 bg-gradient-to-r ${corrAbs >= 0.7 ? "from-emerald-500/5 to-transparent" : corrAbs >= 0.4 ? "from-amber-500/5 to-transparent" : "from-slate-500/5 to-transparent"}`} />
          <CardContent className="py-5 relative">
            <div className="flex items-center gap-6">
              {/* Coefficient Circle */}
              <div className="flex-shrink-0">
                <div className={`w-20 h-20 rounded-2xl flex flex-col items-center justify-center ${corrAbs >= 0.7 ? "bg-emerald-600 text-white" : corrAbs >= 0.4 ? "bg-amber-500 text-white" : "bg-slate-200 text-slate-600"} shadow-none`}
                  style={{ boxShadow: `0 8px 24px ${corrAbs >= 0.7 ? "rgba(16,185,129,0.3)" : corrAbs >= 0.4 ? "rgba(245,158,11,0.3)" : "rgba(100,116,139,0.2)"}` }}>
                  <span className="text-[10px] font-medium opacity-80 tracking-wider uppercase">相関</span>
                  <span className="text-2xl font-black tabular-nums leading-none mt-0.5">{corr.toFixed(2)}</span>
                </div>
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <h3 className="text-base font-bold text-foreground">Google Trends × 施策動画 相関分析</h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${corrBadgeBg}`}>{corrStrength}</span>
                </div>
                <p className={`text-sm ${corrTextClass}`}>{corrDesc}</p>
                <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#0a0a0a]" /> Google Trends</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#6366f1]" /> 全媒体 施策投稿</span>
                  <span className="flex items-center gap-1"><span className="w-6 h-px bg-emerald-400 border-dashed border-t" /> 投稿日マーカー</span>
                </div>
              </div>
              {/* Strength meter */}
              <div className="flex-shrink-0 hidden sm:flex flex-col items-center gap-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Strength</span>
                <div className="flex gap-0.5">
                  {[0.2, 0.4, 0.6, 0.8, 1.0].map((t, i) => (
                    <div key={i} className={`w-2 rounded-full transition-all ${corrAbs >= t ? (corrAbs >= 0.7 ? "bg-white h-6" : corrAbs >= 0.4 ? "bg-[#a3a3a3] h-5" : "bg-[#d4d4d4] h-4") : "bg-[#e5e5e5] h-3"}`}
                      style={{ height: `${12 + i * 4}px` }} />
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ====== Trends × TikTok Chart ====== */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                <Globe className="h-4 w-4 text-blue-500" />
                Google Trends × 全媒体施策タイムライン
              </CardTitle>
            </div>
            {highlightRange && (
              <span className="text-[10px] font-medium text-secondary-foreground bg-[#f5f5f5] border border-black/8 px-2 py-0.5 rounded-full flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                施策期間
              </span>
            )}
          </div>
          <CardDescription className="text-xs mt-0.5">
            検索トレンドの推移と施策投稿の日次再生数を重ね合わせて表示
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 overflow-hidden">
          <>
                <div className="flex items-center justify-center gap-4 sm:gap-6 mb-3 text-xs">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded bg-[#0a0a0a]" /> Google Trends（左軸）</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm bg-[#6366f1]/50" /> 日次再生数（右軸）</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-px bg-emerald-400 border-dashed border-t" /> 投稿日</span>
                </div>
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={filteredDailyChartData} margin={{ top: 10, right: 50, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0a0a0a" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#0a0a0a" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d4d4d4" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={{ stroke: "#d4d4d4" }} tickLine={false} />
                    <YAxis yAxisId="left" domain={[0, 100]} tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmt(v)} />
                    <RechartsTooltip
                      contentStyle={{ borderRadius: "10px", border: "1px solid #d4d4d4", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", fontSize: 12 }}
                      formatter={(value: any, name: string) => {
                        if (value === null || value === undefined) return ["—", name];
                        if (name === "Google Trends") return [`${value} / 100`, name];
                        return [Number(value).toLocaleString() + " 回", name];
                      }}
                    />
                    {highlightRange && (
                      <ReferenceArea x1={highlightRange.start} x2={highlightRange.end} fill="#9ca3af" fillOpacity={0.06} />
                    )}
                    <Area yAxisId="left" type="monotone" dataKey="trends" name="Google Trends" stroke="#0a0a0a" strokeWidth={2.5} fill="url(#trendFill)" dot={false} connectNulls />
                    <Bar yAxisId="right" dataKey="dailyViews" name="日次再生数" fill="#6366f1" fillOpacity={0.5} radius={[2, 2, 0, 0]} barSize={6} />
                    {Array.from(markerDates).map((date: string) => (
                      <ReferenceLine key={date} x={date.slice(5)} stroke="#059669" strokeWidth={1.5} strokeDasharray="4 3" yAxisId="left">
                        <label position="top" offset={8}>
                          <text style={{ fontSize: 9, fill: "#059669", fontWeight: 600 }}>
                            <tspan>&#9658;</tspan>
                          </text>
                        </label>
                      </ReferenceLine>
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </>
          {/* Event marker legend below chart */}
          {markerDates.size > 0 && (
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-black/4">
              {Array.from(markerDates).sort().map((date: string) => {
                const platforms = markerMap.get(date);
                const labels = platforms ? Array.from(platforms).map(p => p === "youtube" ? "YT" : p === "instagram" ? "IG" : "TT") : ["TT"];
                return (
                  <span key={date} className="text-[10px] text-secondary-foreground bg-[#f5f5f5] border border-black/8 rounded-full px-2 py-0.5 flex items-center gap-1">
                    <Play className="h-2.5 w-2.5 fill-emerald-500 text-emerald-500" />
                    {date.slice(5).replace("-", "/")} {labels.join("/")}
                  </span>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ====== Google Monthly Search Volume ====== */}
      {monthlyVolumeData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Search className="h-4 w-4 text-indigo-500" />
                  Google 月間検索ボリューム推移
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">Google Ads Keyword Planner — 施策前後の検索数変化</CardDescription>
              </div>
              {peakMonth && peakMonth.pctChange > 0 && (
                <span className="text-[10px] font-bold text-foreground bg-card border border-black/8 rounded-full px-2.5 py-0.5 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  ピーク月 +{peakMonth.pctChange}%
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="min-w-0 overflow-hidden">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={monthlyVolumeData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  {keywordVolumes!.map((kw: any, i: number) => (
                    <linearGradient key={kw.keyword} id={`volFill-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={VOLUME_COLORS[i % VOLUME_COLORS.length]} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={VOLUME_COLORS[i % VOLUME_COLORS.length]} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#d4d4d4" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={{ stroke: "#d4d4d4" }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} tickFormatter={(v: number) => fmt(v)} axisLine={false} tickLine={false} />
                <RechartsTooltip
                  contentStyle={{ borderRadius: "10px", border: "1px solid #d4d4d4", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", fontSize: 12 }}
                  formatter={(value: any, name: string) => [Number(value).toLocaleString(), name]}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                {highlightMonths && (
                  <ReferenceArea x1={highlightMonths.start} x2={highlightMonths.end} fill="#6b7280" fillOpacity={0.05} />
                )}
                {keywordVolumes!.map((kw: any, i: number) => (
                  <Area key={kw.keyword} type="monotone" dataKey={kw.keyword} stroke={VOLUME_COLORS[i % VOLUME_COLORS.length]} strokeWidth={2} fill={`url(#volFill-${i})`} dot={{ r: 2.5, strokeWidth: 0, fill: VOLUME_COLORS[i % VOLUME_COLORS.length] }} connectNulls />
                ))}
              </AreaChart>
            </ResponsiveContainer>
            {/* Keyword chips below chart */}
            {keywordVolumes && keywordVolumes.length > 1 && (
              <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-black/4">
                {keywordVolumes.map((kw: any, i: number) => {
                  const vols = (kw.monthlyVolumes || []) as any[];
                  const lastVol = vols.length > 0 ? vols[vols.length - 1].volume : 0;
                  const prevVol = vols.length > 1 ? vols[vols.length - 2].volume : 0;
                  const change = prevVol > 0 ? Math.round(((lastVol - prevVol) / prevVol) * 100) : 0;
                  return (
                    <span key={kw.keyword} className="text-[10px] bg-card border border-border rounded-full px-2 py-0.5 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: VOLUME_COLORS[i % VOLUME_COLORS.length] }} />
                      <span className="font-medium text-secondary-foreground">{kw.keyword}</span>
                      {change !== 0 && (
                        <span className={`font-bold ${change > 0 ? "text-emerald-600" : "text-[#D71921]"}`}>
                          {change > 0 ? "+" : ""}{change}%
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}



// ============================
// 全媒体横断サマリー
// ============================

type UnifiedVideo = {
  videoUrl: string;
  channelId: string;
  caption: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number | null;
  saveCount: number | null;
  coverUrl: string;
  platform: "tiktok" | "youtube" | "instagram";
  publishedAt: string;
  er: number | null;
  hashtags: string[];
  musicInfo?: { title: string; artist: string; isOriginal?: boolean } | null;
  /** 3秒視聴維持率 (%) — Instagram only */
  retention3s?: number | null;
  /** Instagram: メトリクスが信頼できるか (viewCount > 100 && likeCount === 0 && commentCount === 0 の場合 false) */
  igMetricsIncomplete?: boolean;
};

const PLATFORM_COLORS = {
  tiktok: { accent: "#0a0a0a", bg: "bg-[#f5f5f5]", border: "border-l-[#0a0a0a]", dot: "bg-[#0a0a0a]", text: "text-[#0a0a0a]" },
  youtube: { accent: "#D71921", bg: "bg-red-50", border: "border-l-[#D71921]", dot: "bg-[#D71921]", text: "text-[#D71921]" },
  instagram: { accent: "#a855f7", bg: "bg-purple-50", border: "border-l-purple-500", dot: "bg-purple-500", text: "text-purple-600" },
} as const;

const PLATFORM_ICONS: Record<string, string> = { tiktok: "TT", youtube: "YT", instagram: "IG" };

export function PlatformSummarySection({ tiktokVideos, platformSummary, dailyMetrics, hasBaseline = true, campaign }: {
  tiktokVideos: any[];
  platformSummary: {
    youtube?: { totalVideos: number; totalViews: number; totalLikes: number; avgER: number; videos: any[] };
    instagram?: { totalVideos: number; totalViews: number; totalThreeSecViews?: number; totalLikes: number; avgER: number; avgRetention3s?: number; videos: any[] };
  };
  dailyMetrics: any[];
  hasBaseline?: boolean;
  campaign?: any;
}) {
  const [bestWorstSort, setBestWorstSort] = useState<"views" | "likes" | "er" | "comments">("views");
  const [tablePlatformFilter, setTablePlatformFilter] = useState<"all" | "tiktok" | "youtube" | "instagram">("all");
  const [tableSortKey, setTableSortKey] = useState<"views" | "likes" | "comments" | "shares" | "saves" | "er" | "date">("views");
  const [tableSortDir, setTableSortDir] = useState<"asc" | "desc">("desc");
  const TABLE_PAGE_SIZE = 5;
  const [tableDisplayCount, setTableDisplayCount] = useState(TABLE_PAGE_SIZE);

  // === Latest values from dailyMetrics (per-video, per-platform) ===
  const latestByUrl = useMemo(() => {
    const map = new Map<string, { viewCount: number; likeCount: number; commentCount: number; shareCount: number; saveCount: number; platform: string }>();
    if (!dailyMetrics) return map;
    for (const dm of dailyMetrics) {
      const url = dm.videoUrl;
      if (!url) continue;
      const existing = map.get(url);
      const dateKey = dm.dateKey || "";
      if (!existing || dateKey > (existing as any)._dk) {
        map.set(url, {
          viewCount: dm.viewCount || 0,
          likeCount: dm.likeCount || 0,
          commentCount: dm.commentCount || 0,
          shareCount: dm.shareCount || 0,
          saveCount: dm.saveCount || 0,
          platform: dm.platform || "",
          _dk: dateKey,
        } as any);
      }
    }
    return map;
  }, [dailyMetrics]);

  // === Aggregate metrics (prefer dailyMetrics latest values) ===
  const ytData = platformSummary.youtube;
  const igData = platformSummary.instagram;

  const computeAgg = useMemo(() => {
    let ttViews = 0, ttLikes = 0, ttComments = 0, ttShares = 0, ttSaves = 0;
    for (const v of tiktokVideos) {
      const url = v.videoUrl || "";
      const dm = latestByUrl.get(url);
      ttViews += Math.max(dm?.viewCount || 0, v.after?.viewCount || 0);
      ttLikes += Math.max(dm?.likeCount || 0, v.after?.likeCount || 0);
      ttComments += Math.max(dm?.commentCount || 0, v.after?.commentCount || 0);
      ttShares += Math.max(dm?.shareCount || 0, v.after?.shareCount || 0);
      ttSaves += Math.max(dm?.saveCount || 0, v.after?.saveCount || 0);
    }

    let ytViews = 0, ytLikes = 0, ytCommentsSum = 0;
    for (const v of (ytData?.videos || [])) {
      const url = v.videoUrl || "";
      const dm = latestByUrl.get(url);
      ytViews += Math.max(dm?.viewCount || 0, v.viewCount || 0);
      ytLikes += Math.max(dm?.likeCount || 0, v.likeCount || 0);
      ytCommentsSum += Math.max(dm?.commentCount || 0, v.commentCount || 0);
    }

    let igViews = 0, igLikes = 0, igCommentsSum = 0;
    for (const v of (igData?.videos || [])) {
      const url = v.videoUrl || "";
      const dm = latestByUrl.get(url);
      const vViews = Math.max(dm?.viewCount || 0, v.viewCount || 0);
      const vLikes = Math.max(dm?.likeCount || 0, v.likeCount || 0);
      const vComments = Math.max(dm?.commentCount || 0, v.commentCount || 0);
      igViews += vViews;
      // Exclude incomplete IG posts (high views but 0 engagement) from likes/comments totals
      const isIgIncomplete = vViews > 100 && vLikes === 0 && vComments === 0;
      if (!isIgIncomplete) {
        igLikes += vLikes;
        igCommentsSum += vComments;
      }
    }

    return { ttViews, ttLikes, ttComments, ttShares, ttSaves, ytViews, ytLikes, ytCommentsSum, igViews, igLikes, igCommentsSum };
  }, [tiktokVideos, ytData, igData, latestByUrl]);

  const { ttViews: tiktokViews, ttLikes: tiktokLikes, ttComments: tiktokComments, ttShares: tiktokShares, ttSaves: tiktokSaves,
    ytViews, ytLikes, ytCommentsSum: ytComments, igViews, igLikes, igCommentsSum: igComments } = computeAgg;

  const totalVideos = tiktokVideos.length + (ytData?.totalVideos || 0) + (igData?.totalVideos || 0);
  const totalViews = tiktokViews + ytViews + igViews;
  const totalLikes = tiktokLikes + ytLikes + igLikes;
  const totalComments = tiktokComments + ytComments + igComments;
  const totalEngagement = totalLikes + totalComments;
  const avgER = totalViews > 0 ? Number((totalEngagement / totalViews * 100).toFixed(2)) : 0;

  // === Unified video list (all platforms merged, prefer dailyMetrics latest) ===
  const allVideos: UnifiedVideo[] = useMemo(() => {
    const vids: UnifiedVideo[] = [];

    // TikTok
    for (const v of tiktokVideos) {
      const url = v.videoUrl || "";
      const dm = latestByUrl.get(url);
      const views = Math.max(dm?.viewCount || 0, v.after?.viewCount || 0);
      const likes = Math.max(dm?.likeCount || 0, v.after?.likeCount || 0);
      const comments = Math.max(dm?.commentCount || 0, v.after?.commentCount || 0);
      const shares = Math.max(dm?.shareCount || 0, v.after?.shareCount || 0);
      const saves = Math.max(dm?.saveCount || 0, v.after?.saveCount || 0);
      const eng = likes + comments + shares + saves;
      const ttMusic = (v as any).music;
      vids.push({
        videoUrl: url, channelId: url.match(/@([^/]+)/)?.[1] || "",
        caption: v.description || "", viewCount: views, likeCount: likes, commentCount: comments,
        shareCount: shares, saveCount: saves, coverUrl: v.coverUrl || "",
        platform: "tiktok", publishedAt: v.postedAt || "",
        er: views > 0 ? Number(((eng / views) * 100).toFixed(2)) : 0,
        hashtags: v.hashtags || [],
        musicInfo: ttMusic ? { title: ttMusic.title || "", artist: ttMusic.authorName || "", isOriginal: !!ttMusic.original } : null,
      });
    }

    // YouTube
    for (const v of (ytData?.videos || [])) {
      const url = v.videoUrl || "";
      const dm = latestByUrl.get(url);
      const views = Math.max(dm?.viewCount || 0, v.viewCount || 0);
      const likes = Math.max(dm?.likeCount || 0, v.likeCount || 0);
      const comments = Math.max(dm?.commentCount || 0, v.commentCount || 0);
      const eng = likes + comments;
      // Extract hashtags from title/description
      const ytTags = ((v.title || "") + " " + (v.description || "")).match(/#[^\s#]+/g)?.map((t: string) => t.replace(/^#/, "")) || [];
      vids.push({
        videoUrl: url, channelId: v.channelTitle || "",
        caption: v.title || "", viewCount: views, likeCount: likes, commentCount: comments,
        shareCount: null, saveCount: null, coverUrl: v.coverUrl || "",
        platform: "youtube", publishedAt: v.publishedAt || "",
        er: views > 0 ? Number(((eng / views) * 100).toFixed(2)) : 0,
        hashtags: ytTags,
        musicInfo: null,
      });
    }

    // Instagram
    for (const v of (igData?.videos || [])) {
      const url = v.videoUrl || "";
      const dm = latestByUrl.get(url);
      const views = Math.max(dm?.viewCount || 0, v.viewCount || 0);
      const likes = Math.max(dm?.likeCount || 0, v.likeCount || 0);
      const comments = Math.max(dm?.commentCount || 0, v.commentCount || 0);
      const eng = likes + comments;
      const igTags = ((v.caption || "")).match(/#[^\s#]+/g)?.map((t: string) => t.replace(/^#/, "")) || [];
      const igMusic = (v as any).musicInfo;
      // Detect incomplete IG metrics: high views but 0 likes & comments suggests API data issue
      const isIgIncomplete = views > 100 && likes === 0 && comments === 0;
      vids.push({
        videoUrl: url, channelId: v.ownerUsername ? `@${v.ownerUsername}` : "",
        caption: v.caption || "", viewCount: views, likeCount: likes, commentCount: comments,
        shareCount: null, saveCount: null, coverUrl: v.coverUrl || "",
        platform: "instagram", publishedAt: v.publishedAt || "",
        er: isIgIncomplete ? null : (views > 0 ? Number(((eng / views) * 100).toFixed(2)) : 0),
        hashtags: igTags,
        musicInfo: igMusic ? { title: igMusic.title || "", artist: igMusic.artistName || "" } : null,
        retention3s: (v as any).retention3s ?? null,
        igMetricsIncomplete: isIgIncomplete || undefined,
      });
    }
    // Dedup: same URL appearing twice
    const seen = new Set<string>();
    return vids.filter(v => {
      const key = v.videoUrl;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [tiktokVideos, ytData, igData, latestByUrl]);

  // === Best/Worst sorted ===
  const sortedForBestWorst = useMemo(() => {
    const key = bestWorstSort === "views" ? "viewCount" : bestWorstSort === "likes" ? "likeCount" : bestWorstSort === "comments" ? "commentCount" : "er";
    return [...allVideos].sort((a, b) => (b as any)[key] - (a as any)[key]);
  }, [allVideos, bestWorstSort]);

  const bestVideos = sortedForBestWorst.slice(0, 3);
  const worstVideos = sortedForBestWorst.slice(-3).reverse();

  // === Table filtered + sorted ===
  const tableVideos = useMemo(() => {
    let filtered = tablePlatformFilter === "all" ? allVideos : allVideos.filter(v => v.platform === tablePlatformFilter);
    const keyMap: Record<string, keyof UnifiedVideo> = {
      views: "viewCount", likes: "likeCount", comments: "commentCount",
      shares: "shareCount", saves: "saveCount", er: "er", date: "publishedAt",
    };
    const k = keyMap[tableSortKey] || "viewCount";
    filtered = [...filtered].sort((a, b) => {
      const av = a[k] ?? 0;
      const bv = b[k] ?? 0;
      if (k === "publishedAt") return tableSortDir === "desc" ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
      return tableSortDir === "desc" ? (Number(bv) - Number(av)) : (Number(av) - Number(bv));
    });
    return filtered;
  }, [allVideos, tablePlatformFilter, tableSortKey, tableSortDir]);

  // === CSV Export ===
  const handleTableCsvExport = useCallback(() => {
    const header = ["#", "動画", "媒体", "再生数", "いいね", "コメント", "シェア", "保存", "ER(%)", "音源", "投稿日"];
    const rows = tableVideos.map((v, i) => [
      i + 1,
      `"${(v.caption || "動画").replace(/"/g, '""')}"`,
      v.platform,
      v.viewCount,
      v.likeCount,
      v.commentCount,
      v.shareCount ?? "",
      v.saveCount ?? "",
      v.er ?? "",
      v.musicInfo?.title ? `"${(v.musicInfo.title + (v.musicInfo.artist ? ` - ${v.musicInfo.artist}` : "")).replace(/"/g, '""')}"` : "",
      v.publishedAt ? v.publishedAt.split("T")[0] : "",
    ].join(","));
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "platform_videos.csv"; a.click();
    URL.revokeObjectURL(url);
  }, [tableVideos]);

  const toggleSort = (key: typeof tableSortKey) => {
    if (tableSortKey === key) setTableSortDir(d => d === "desc" ? "asc" : "desc");
    else { setTableSortKey(key); setTableSortDir("desc"); }
  };

  // === Per-platform stats for cards ===
  const platformCards = useMemo(() => {
    const cards: Array<{
      key: "youtube" | "instagram" | "tiktok";
      name: string;
      videoCount: number;
      stats: { label: string; value: number; icon: typeof Eye }[];
    }> = [];

    if (ytData) {
      const ytER = ytViews > 0 ? Number(((ytLikes + ytComments) / ytViews * 100).toFixed(2)) : 0;
      cards.push({
        key: "youtube", name: "YouTube", videoCount: ytData.totalVideos,
        stats: [
          { label: "再生数", value: ytViews, icon: Eye },
          { label: "いいね", value: ytLikes, icon: Heart },
          { label: "コメント", value: ytComments, icon: MessageCircle },
          { label: "平均ER", value: ytER, icon: TrendingUp },
        ],
      });
    }

    if (igData) {
      const igER = igViews > 0 ? Number(((igLikes + igComments) / igViews * 100).toFixed(2)) : 0;
      const igRetention3s = (igData as any).avgRetention3s ?? null;
      const igStats: typeof cards[0]["stats"] = [
        { label: "再生数", value: igViews, icon: Eye },
        { label: "いいね", value: igLikes, icon: Heart },
        { label: "コメント", value: igComments, icon: MessageCircle },
        { label: "平均ER", value: igER, icon: TrendingUp },
      ];
      if (igRetention3s != null && igRetention3s > 0) {
        igStats.push({ label: "3秒維持率", value: igRetention3s, icon: Target });
      }
      cards.push({
        key: "instagram", name: "Instagram", videoCount: igData.totalVideos,
        stats: igStats,
      });
    }

    if (tiktokVideos.length > 0) {
      const ttER = tiktokViews > 0 ? Number(((tiktokLikes + tiktokComments + tiktokShares + tiktokSaves) / tiktokViews * 100).toFixed(2)) : 0;
      cards.push({
        key: "tiktok", name: "TikTok", videoCount: tiktokVideos.length,
        stats: [
          { label: "再生数", value: tiktokViews, icon: Eye },
          { label: "いいね", value: tiktokLikes, icon: Heart },
          { label: "コメント", value: tiktokComments, icon: MessageCircle },
          { label: "シェア", value: tiktokShares, icon: Share2 },
          { label: "保存", value: tiktokSaves, icon: Bookmark },
          { label: "平均ER", value: ttER, icon: TrendingUp },
        ],
      });
    }
    return cards;
  }, [ytData, igData, tiktokVideos, tiktokViews, tiktokLikes, tiktokComments, tiktokShares, tiktokSaves, ytViews, ytLikes, ytComments, igViews, igLikes, igComments]);

  return (
    <div className="space-y-5 min-w-0">

      {/* ── 2a. Global KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: "総投稿数", value: totalVideos.toString(), icon: Play, color: "text-foreground" },
          { label: "総再生数", value: fmt(totalViews), icon: Eye, color: "text-foreground" },
          { label: "総いいね", value: fmt(totalLikes), icon: Heart, color: "text-rose-500" },
          { label: "総コメント", value: fmt(totalComments), icon: MessageCircle, color: "text-muted-foreground" },
          { label: "平均ER", value: `${avgER}%`, icon: TrendingUp, color: "text-foreground" },
        ].map(c => {
          const Icon = c.icon;
          // Sparkline-style proportional bar
          const maxVal = Math.max(totalViews, 1);
          const rawNum = c.label === "総再生数" ? totalViews : c.label === "総いいね" ? totalLikes : c.label === "総コメント" ? totalComments : 0;
          const barPct = c.label === "平均ER" ? Math.min(avgER * 5, 100) : c.label === "総投稿数" ? Math.min(totalVideos * 3, 100) : Math.min((rawNum / maxVal) * 100, 100);
          return (
            <Card key={c.label} className="group hover:border-black/12 transition-shadow duration-200">
              <CardContent className="py-4 px-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <Icon className={`h-3.5 w-3.5 ${c.color}`} />
                  <span className="text-[11px] text-muted-foreground font-medium">{c.label}</span>
                </div>
                <p className={`text-2xl font-bold tracking-tight ${c.color}`}>{c.value}</p>
                <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-700 ease-out ${c.label === "平均ER" ? "bg-emerald-400" : c.label === "総再生数" ? "bg-blue-400" : c.label === "総いいね" ? "bg-rose-400" : c.label === "総コメント" ? "bg-[#a3a3a3]" : "bg-foreground/30"}`} style={{ width: `${barPct}%` }} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── 2b. Platform Cards ── */}
      {platformCards.length > 0 && (
        <div className={`grid gap-3 ${platformCards.length === 1 ? "grid-cols-1" : platformCards.length === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 md:grid-cols-3"}`}>
          {platformCards.map(p => {
            const colors = PLATFORM_COLORS[p.key];
            return (
              <Card key={p.key} className={`border-l-3 ${colors.border} ${colors.bg} overflow-hidden`}>
                <CardContent className="py-2.5 px-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-5 h-5 rounded flex items-center justify-center text-[8px] font-black text-white ${p.key === "youtube" ? "bg-red-600" : p.key === "instagram" ? "bg-gradient-to-br from-purple-600 to-pink-500" : "bg-slate-900"}`}>
                        {PLATFORM_ICONS[p.key]}
                      </span>
                      <span className="font-semibold text-xs">{p.name}</span>
                    </div>
                    <Badge variant="secondary" className="text-[9px] px-1 py-0">{p.videoCount}本</Badge>
                  </div>
                  <div className={`grid ${p.stats.length <= 4 ? "grid-cols-2" : "grid-cols-3"} gap-1.5`}>
                    {p.stats.map(s => {
                      const SIcon = s.icon;
                      return (
                        <div key={s.label} className="bg-background/60 rounded-md px-2 py-1.5">
                          <div className="flex items-center gap-0.5 mb-0.5">
                            <SIcon className="h-2.5 w-2.5 text-muted-foreground" />
                            <span className="text-[9px] text-muted-foreground">{s.label}</span>
                          </div>
                          <p className="text-xs font-bold">{s.label === "平均ER" || s.label === "3秒維持率" ? `${s.value}%` : fmt(s.value)}</p>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── 2c. Daily Chart ── */}
      <CumulativeMetricsChart dailyMetrics={dailyMetrics} campaign={campaign} />

      {/* ── 2d. Best / Worst Videos ── */}
      {allVideos.length >= 3 && (
        <Card>
          <CardHeader className="py-2.5 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs flex items-center gap-1.5">
                <Trophy className="h-3.5 w-3.5 text-muted-foreground" />
                Best / Worst パフォーマンス
              </CardTitle>
              <div className="flex gap-1">
                {([["views", "再生数"], ["likes", "いいね"], ["er", "ER"], ["comments", "コメント"]] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setBestWorstSort(val)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${bestWorstSort === val ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 pb-3 px-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Best 3 */}
              <div>
                <p className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5"><TrendingUp className="h-4 w-4" /> TOP 3</p>
                <div className="space-y-1.5">
                  {bestVideos.map((v, i) => (
                    <BestWorstVideoCard key={`best-${i}`} video={v} rank={i + 1} type="best" sortKey={bestWorstSort} />
                  ))}
                </div>
              </div>
              {/* Worst 3 */}
              <div>
                <p className="text-sm font-semibold text-orange-500 mb-2 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> 改善候補 3</p>
                <div className="space-y-1.5">
                  {worstVideos.map((v, i) => (
                    <BestWorstVideoCard key={`worst-${i}`} video={v} rank={allVideos.length - 2 + i} type="worst" sortKey={bestWorstSort} />
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 2e. Video Data Table ── */}
      {allVideos.length > 0 && (
        <Card>
          <CardHeader className="pb-1.5 pt-3 px-3">
            <div className="flex items-center justify-between flex-wrap gap-1.5">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                動画データ一覧
                <Badge variant="secondary" className="text-[10px] ml-1">{tableVideos.length}件</Badge>
              </CardTitle>
              <div className="flex items-center gap-1.5">
                {/* Platform filter chips */}
                <div className="flex gap-0.5">
                  {(["all", "tiktok", "youtube", "instagram"] as const).map(pf => {
                    const active = tablePlatformFilter === pf;
                    const count = pf === "all" ? allVideos.length : allVideos.filter(v => v.platform === pf).length;
                    if (pf !== "all" && count === 0) return null;
                    return (
                      <button
                        key={pf}
                        onClick={() => { setTablePlatformFilter(pf); setTableDisplayCount(TABLE_PAGE_SIZE); }}
                        className={`px-2 py-0.5 rounded-full text-[9px] font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                      >
                        {pf === "all" ? "全て" : pf === "tiktok" ? "TikTok" : pf === "youtube" ? "YouTube" : "Instagram"}
                        <span className="ml-0.5 opacity-70">{count}</span>
                      </button>
                    );
                  })}
                </div>
                <button onClick={handleTableCsvExport} className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-medium bg-muted hover:bg-muted/80 transition-colors text-muted-foreground">
                  <FileDown className="h-3 w-3" /> CSV
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-3 pb-2 overflow-x-auto min-w-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 text-xs">#</TableHead>
                  <TableHead className="text-xs min-w-[180px]">動画</TableHead>
                  <TableHead className="text-xs w-14">媒体</TableHead>
                  <TableHead className="text-xs cursor-pointer hover:text-foreground" onClick={() => toggleSort("views")}>
                    <span className="flex items-center gap-0.5">再生数{tableSortKey === "views" && <ArrowUpDown className="h-3 w-3" />}</span>
                  </TableHead>
                  <TableHead className="text-xs cursor-pointer hover:text-foreground" onClick={() => toggleSort("likes")}>
                    <span className="flex items-center gap-0.5">いいね{tableSortKey === "likes" && <ArrowUpDown className="h-3 w-3" />}</span>
                  </TableHead>
                  <TableHead className="text-xs cursor-pointer hover:text-foreground" onClick={() => toggleSort("comments")}>
                    <span className="flex items-center gap-0.5">コメント{tableSortKey === "comments" && <ArrowUpDown className="h-3 w-3" />}</span>
                  </TableHead>
                  <TableHead className="text-xs cursor-pointer hover:text-foreground" onClick={() => toggleSort("shares")}>
                    <span className="flex items-center gap-0.5">シェア{tableSortKey === "shares" && <ArrowUpDown className="h-3 w-3" />}</span>
                  </TableHead>
                  <TableHead className="text-xs cursor-pointer hover:text-foreground" onClick={() => toggleSort("saves")}>
                    <span className="flex items-center gap-0.5">保存{tableSortKey === "saves" && <ArrowUpDown className="h-3 w-3" />}</span>
                  </TableHead>
                  <TableHead className="text-xs cursor-pointer hover:text-foreground" onClick={() => toggleSort("er")}>
                    <span className="flex items-center gap-0.5">ER{tableSortKey === "er" && <ArrowUpDown className="h-3 w-3" />}</span>
                  </TableHead>
                  <TableHead className="text-xs">
                    <span className="flex items-center gap-0.5" title="3秒視聴維持率（Instagram）">3s維持</span>
                  </TableHead>
                  <TableHead className="text-xs min-w-[120px]">
                    <span className="flex items-center gap-0.5"><Music className="h-3 w-3" />音源</span>
                  </TableHead>
                  <TableHead className="text-xs cursor-pointer hover:text-foreground" onClick={() => toggleSort("date")}>
                    <span className="flex items-center gap-0.5">投稿日{tableSortKey === "date" && <ArrowUpDown className="h-3 w-3" />}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableVideos.slice(0, tableDisplayCount).map((v, i) => {
                  const colors = PLATFORM_COLORS[v.platform];
                  return (
                    <TableRow key={`${v.videoUrl}-${i}`} className="group">
                      <TableCell className="text-xs text-muted-foreground font-mono py-1.5">{i + 1}</TableCell>
                      <TableCell className="py-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          {v.coverUrl && <img src={v.coverUrl} alt="" className="w-9 h-12 rounded object-cover flex-shrink-0" loading="lazy" />}
                          <div className="min-w-0">
                            <a href={v.videoUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-medium hover:underline text-primary truncate block max-w-[220px]">
                              {(v.caption || "動画").slice(0, 30)}{(v.caption || "").length > 30 ? "…" : ""}
                            </a>
                            {v.channelId && <p className="text-[10px] text-muted-foreground truncate">{v.channelId.startsWith("@") ? v.channelId : `@${v.channelId}`}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${colors.text}`}>
                          <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                          {PLATFORM_ICONS[v.platform]}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs font-medium tabular-nums py-1.5">{fmt(v.viewCount)}</TableCell>
                      <TableCell className="text-xs tabular-nums py-1.5">{v.igMetricsIncomplete ? <span className="text-muted-foreground" title="データ取得不完全">-</span> : fmt(v.likeCount)}</TableCell>
                      <TableCell className="text-xs tabular-nums py-1.5">{v.igMetricsIncomplete ? <span className="text-muted-foreground" title="データ取得不完全">-</span> : fmt(v.commentCount)}</TableCell>
                      <TableCell className="text-xs tabular-nums py-1.5">{v.igMetricsIncomplete ? <span className="text-muted-foreground" title="データ取得不完全">-</span> : (v.shareCount != null ? fmt(v.shareCount) : "-")}</TableCell>
                      <TableCell className="text-xs tabular-nums py-1.5">{v.igMetricsIncomplete ? <span className="text-muted-foreground" title="データ取得不完全">-</span> : (v.saveCount != null ? fmt(v.saveCount) : "-")}</TableCell>
                      <TableCell className="text-xs font-medium tabular-nums py-1.5">{v.igMetricsIncomplete ? <span className="text-muted-foreground" title="データ取得不完全">-</span> : (v.er != null ? `${v.er}%` : "-")}</TableCell>
                      <TableCell className="text-xs tabular-nums py-1.5">
                        {v.retention3s != null ? <span className="font-medium">{v.retention3s}%</span> : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell className="py-1.5">
                        {v.musicInfo && v.musicInfo.title ? (
                          <div className="flex items-center gap-1 text-[10px] text-violet-600 dark:text-violet-400 max-w-[150px]">
                            <Music className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{v.musicInfo.title}</span>
                          </div>
                        ) : <span className="text-[10px] text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap py-1.5">{v.publishedAt ? v.publishedAt.split("T")[0] : "-"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {tableVideos.length > tableDisplayCount && (
              <div className="flex justify-center py-1.5">
                <Button variant="ghost" size="sm" onClick={() => setTableDisplayCount(prev => prev + TABLE_PAGE_SIZE)}
                  className="text-[10px] h-7 text-muted-foreground hover:text-foreground">
                  <ChevronDown className="h-3.5 w-3.5 mr-1" />もっと見る（残り{tableVideos.length - tableDisplayCount}件）
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// === Best/Worst Video Card Component ===
function BestWorstVideoCard({ video, rank, type, sortKey }: {
  video: UnifiedVideo; rank: number; type: "best" | "worst"; sortKey: string;
}) {
  const colors = PLATFORM_COLORS[video.platform];
  const rankColors = type === "best"
    ? (rank === 1 ? "bg-[#a3a3a3] text-[#0a0a0a]" : rank === 2 ? "bg-[#d4d4d4] text-[#171717]" : "bg-[#d4d4d4] text-[#9ca3af]")
    : "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-[#D71921]/70";

  const highlightValue = sortKey === "views" ? fmt(video.viewCount) : sortKey === "likes" ? fmt(video.likeCount) : sortKey === "comments" ? fmt(video.commentCount) : (video.er != null ? `${video.er}%` : "-");
  const highlightLabel = sortKey === "views" ? "再生" : sortKey === "likes" ? "いいね" : sortKey === "comments" ? "コメント" : "ER";

  return (
    <div className="flex items-center gap-4 px-3 py-2.5 rounded-xl hover:bg-muted/40 transition-colors group">
      <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${rankColors}`}>
        {type === "best" ? rank : "!"}
      </span>
      {video.coverUrl && <img src={video.coverUrl} alt="" className="w-20 h-28 rounded-lg object-cover flex-shrink-0" loading="lazy" />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <a href={video.videoUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:underline line-clamp-2 text-primary leading-snug">
            {(video.caption || "動画").slice(0, 50)}{(video.caption || "").length > 50 ? "…" : ""}
          </a>
        </div>
        {video.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {video.hashtags.slice(0, 3).map((tag, ti) => (
              <span key={ti} className="text-[10px] font-medium text-muted-foreground bg-card border border-border rounded-full px-1.5 py-px dark:text-indigo-400 dark:bg-indigo-950/40 dark:border-indigo-800">
                #{tag.replace(/^#/, "")}
              </span>
            ))}
          </div>
        )}
        {video.musicInfo && video.musicInfo.title && (
          <div className="flex items-center gap-1 mt-1 text-[10px] text-violet-600 dark:text-violet-400">
            <Music className="h-3 w-3 flex-shrink-0" />
            <span className="truncate max-w-[200px]">{video.musicInfo.title}{video.musicInfo.artist ? ` - ${video.musicInfo.artist}` : ""}</span>
            {video.musicInfo.isOriginal && <span className="text-[9px] bg-violet-100 dark:bg-violet-900/40 rounded px-1 py-px font-medium flex-shrink-0">Original</span>}
          </div>
        )}
        <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-1">
          <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{fmt(video.viewCount)}</span>
          <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" />{fmt(video.likeCount)}</span>
          <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{fmt(video.commentCount)}</span>
          {video.shareCount != null && <span className="flex items-center gap-1"><Share2 className="h-3.5 w-3.5" />{fmt(video.shareCount)}</span>}
          {video.saveCount != null && <span className="flex items-center gap-1"><Bookmark className="h-3.5 w-3.5" />{fmt(video.saveCount)}</span>}
          <span className="flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" />{video.er != null ? `${video.er}%` : "-"}</span>
        </div>
        {video.publishedAt && (
          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
            <CalendarDays className="h-3 w-3" />{video.publishedAt.split("T")[0]}
          </p>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`text-base font-bold ${type === "best" ? "text-foreground" : "text-orange-500"}`}>{highlightValue}</p>
        <p className="text-[11px] text-muted-foreground">{highlightLabel}</p>
      </div>
    </div>
  );
}

// === Daily Chart (enhanced with platform filter + 5 metrics + cumulative/daily toggle) ===
function AllPlatformDailyChart({ dailyMetrics }: { dailyMetrics: any[] }) {
  const [chartFilter, setChartFilter] = useState<"all" | "tiktok" | "youtube" | "instagram">("all");
  const [chartMode, setChartMode] = useState<"cumulative" | "daily">("cumulative");

  const cumulativeData = useMemo(() => {
    if (!dailyMetrics || dailyMetrics.length === 0) return [];
    const filtered = chartFilter === "all" ? dailyMetrics : dailyMetrics.filter((m: any) => m.platform === chartFilter);

    // 動画URL別 → 日付別にスナップショットを整理
    const byVideo = new Map<string, Map<string, { views: number; likes: number; comments: number; shares: number; saves: number }>>();
    for (const m of filtered) {
      const url = m.videoUrl || "";
      const dateKey = m.dateKey;
      if (!url || !dateKey) continue;
      if (!byVideo.has(url)) byVideo.set(url, new Map());
      const videoMap = byVideo.get(url)!;
      const entry = videoMap.get(dateKey) || { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
      entry.views += m.viewCount || 0;
      entry.likes += m.likeCount || 0;
      entry.comments += m.commentCount || 0;
      entry.shares += m.shareCount || 0;
      entry.saves += m.saveCount || 0;
      videoMap.set(dateKey, entry);
    }

    const allDates = new Set<string>();
    for (const videoMap of byVideo.values()) {
      for (const d of videoMap.keys()) allDates.add(d);
    }
    const sortedDates = [...allDates].sort();

    // Forward-fill: 欠損日を前日値で埋めて累積値が下がるのを防止
    for (const videoMap of byVideo.values()) {
      let lastKnown: { views: number; likes: number; comments: number; shares: number; saves: number } | null = null;
      for (const dateKey of sortedDates) {
        const snap = videoMap.get(dateKey);
        if (snap) {
          lastKnown = snap;
        } else if (lastKnown) {
          videoMap.set(dateKey, { ...lastKnown });
        }
      }
    }

    // 各日付の全動画合計
    return sortedDates.map(dateKey => {
      let views = 0, likes = 0, comments = 0, shares = 0, saves = 0;
      for (const videoMap of byVideo.values()) {
        const snap = videoMap.get(dateKey);
        if (snap) {
          views += snap.views;
          likes += snap.likes;
          comments += snap.comments;
          shares += snap.shares;
          saves += snap.saves;
        }
      }
      return { date: dateKey, views, likes, comments, shares, saves };
    });
  }, [dailyMetrics, chartFilter]);

  const dailyIncrementData = useMemo(() => {
    // Skip first day — its "increment" would be the full cumulative total
    return cumulativeData.slice(1).map((d, i) => {
      const prev = cumulativeData[i]; // i offset by 1 due to slice
      return {
        date: d.date,
        views: Math.max(0, d.views - prev.views),
        likes: Math.max(0, d.likes - prev.likes),
        comments: Math.max(0, d.comments - prev.comments),
        shares: Math.max(0, d.shares - prev.shares),
        saves: Math.max(0, d.saves - prev.saves),
      };
    });
  }, [cumulativeData]);

  const chartData = chartMode === "cumulative" ? cumulativeData : dailyIncrementData;

  // Check which platforms exist in data
  const availablePlatforms = useMemo(() => {
    if (!dailyMetrics || dailyMetrics.length === 0) return new Set<string>();
    return new Set(dailyMetrics.map((m: any) => m.platform).filter(Boolean));
  }, [dailyMetrics]);

  if (cumulativeData.length < 2) return null;

  const hasShares = cumulativeData.some(d => d.shares > 0);
  const hasSaves = cumulativeData.some(d => d.saves > 0);

  const metricNames: Record<string, string> = { views: "再生数", likes: "いいね", comments: "コメント", shares: "シェア", saves: "保存" };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">パフォーマンス推移</CardTitle>
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  chartMode === "cumulative"
                    ? "bg-[#0a0a0a] text-white"
                    : "bg-[#f5f5f5] hover:bg-card text-muted-foreground"
                }`}
                onClick={() => setChartMode("cumulative")}
              >
                累計
              </button>
              <button
                className={`px-2 py-0.5 text-[10px] font-medium transition-colors border-l border-border ${
                  chartMode === "daily"
                    ? "bg-[#0a0a0a] text-white"
                    : "bg-[#f5f5f5] hover:bg-card text-muted-foreground"
                }`}
                onClick={() => setChartMode("daily")}
              >
                日次
              </button>
            </div>
          </div>
          <div className="flex gap-1">
            {(["all", "tiktok", "youtube", "instagram"] as const).map(pf => {
              if (pf !== "all" && !availablePlatforms.has(pf)) return null;
              const active = chartFilter === pf;
              return (
                <button
                  key={pf}
                  onClick={() => setChartFilter(pf)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                >
                  {pf === "all" ? "全体" : pf === "tiktok" ? "TikTok" : pf === "youtube" ? "YouTube" : "Instagram"}
                </button>
              );
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 overflow-hidden">
        <ResponsiveContainer width="100%" height={280}>
          {chartMode === "cumulative" ? (
            <ComposedChart data={chartData}>
              <defs>
                <linearGradient id="gradViews2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0a0a0a" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#0a0a0a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={v => v.slice(5)} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={v => fmt(v)} domain={['dataMin', 'dataMax']} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={v => fmt(v)} domain={['dataMin', 'dataMax']} />
              <RechartsTooltip
                formatter={(v: number, name: string) => [fmt(v), metricNames[name] || name]}
                labelFormatter={v => v}
                contentStyle={{ fontSize: 11 }}
              />
              <Legend formatter={(v) => metricNames[v] || v} wrapperStyle={{ fontSize: 11 }} />
              <Area yAxisId="left" type="monotone" dataKey="views" stroke="#0a0a0a" fill="url(#gradViews2)" strokeWidth={2} name="views" />
              <Line yAxisId="right" type="monotone" dataKey="likes" stroke="#D71921" strokeWidth={1.5} dot={false} name="likes" />
              <Line yAxisId="right" type="monotone" dataKey="comments" stroke="#6366f1" strokeWidth={1.5} dot={false} name="comments" />
              {hasShares && <Line yAxisId="right" type="monotone" dataKey="shares" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="shares" />}
              {hasSaves && <Line yAxisId="right" type="monotone" dataKey="saves" stroke="#8b5cf6" strokeWidth={1.5} dot={false} name="saves" />}
            </ComposedChart>
          ) : (
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={v => v.slice(5)} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={v => fmt(v)} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={v => fmt(v)} />
              <RechartsTooltip
                formatter={(v: number, name: string) => [fmt(v), metricNames[name] || name]}
                labelFormatter={v => v}
                contentStyle={{ fontSize: 11 }}
              />
              <Legend formatter={(v) => metricNames[v] || v} wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="views" fill="#0a0a0a" fillOpacity={0.7} radius={[2, 2, 0, 0]} name="views" />
              <Line yAxisId="right" type="monotone" dataKey="likes" stroke="#D71921" strokeWidth={1.5} dot={false} name="likes" />
              <Line yAxisId="right" type="monotone" dataKey="comments" stroke="#6366f1" strokeWidth={1.5} dot={false} name="comments" />
              {hasShares && <Line yAxisId="right" type="monotone" dataKey="shares" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="shares" />}
              {hasSaves && <Line yAxisId="right" type="monotone" dataKey="saves" stroke="#8b5cf6" strokeWidth={1.5} dot={false} name="saves" />}
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ============================
// Target Achievement Section (目標達成)
// ============================

function TargetAchievementSection({ videoMetrics, platformSummary, campaign, dailyMetrics }: {
  videoMetrics?: any[];
  platformSummary?: {
    youtube?: { totalVideos: number; totalViews: number; totalLikes: number; avgER: number; videos: any[] };
    instagram?: { totalVideos: number; totalViews: number; totalThreeSecViews?: number; totalLikes: number; avgER: number; avgRetention3s?: number; videos: any[] };
  };
  campaign?: any;
  dailyMetrics?: any[];
}) {
  // Build latest-value lookup from dailyMetrics (same logic as PlatformSummarySection)
  const latestByUrl = useMemo(() => {
    const map = new Map<string, { viewCount: number }>();
    if (!dailyMetrics) return map;
    for (const dm of dailyMetrics) {
      const url = dm.videoUrl;
      if (!url) continue;
      const existing = map.get(url);
      const dateKey = dm.dateKey || "";
      if (!existing || dateKey > (existing as any)._dk) {
        map.set(url, { viewCount: dm.viewCount || 0, _dk: dateKey } as any);
      }
    }
    return map;
  }, [dailyMetrics]);

  // TikTok: use max(dailyMetrics latest, report snapshot) — filter to TikTok only
  const tiktokViews = (videoMetrics || [])
    .filter((v: any) => {
      const url = v.videoUrl || "";
      return !url.includes("instagram.com") && !url.includes("youtube.com") && !url.includes("youtu.be");
    })
    .reduce((sum: number, v: any) => {
      const url = v.videoUrl || "";
      const dm = latestByUrl.get(url);
      return sum + Math.max(dm?.viewCount || 0, v.views || v.after?.viewCount || 0);
    }, 0);

  // YouTube / Instagram: use max(dailyMetrics latest, report snapshot) per video
  const youtubeViews = (platformSummary?.youtube?.videos || []).reduce((sum: number, v: any) => {
    const dm = latestByUrl.get(v.videoUrl || "");
    return sum + Math.max(dm?.viewCount || 0, v.viewCount || 0);
  }, 0);
  const instagramViews = (platformSummary?.instagram?.videos || []).reduce((sum: number, v: any) => {
    const dm = latestByUrl.get(v.videoUrl || "");
    return sum + Math.max(dm?.viewCount || 0, v.viewCount || 0);
  }, 0);

  const totalViews = tiktokViews + youtubeViews + instagramViews;

  const targetViews = campaign?.targetViews as number | undefined;
  const achievementRate = targetViews && targetViews > 0 ? Math.round((totalViews / targetViews) * 100) : null;
  const clampedRate = Math.min(achievementRate ?? 0, 100);

  const platforms = [
    { label: "TikTok", abbr: "TT", views: tiktokViews, color: "#171717", ring: "stroke-[#171717]" },
    { label: "YouTube", abbr: "YT", views: youtubeViews, color: "#D71921", ring: "stroke-[#D71921]" },
    { label: "Instagram", abbr: "IG", views: instagramViews, color: "#a855f7", ring: "stroke-purple-500" },
  ].filter(p => p.views > 0);

  // Gauge SVG params
  const gaugeR = 58;
  const gaugeC = 2 * Math.PI * gaugeR;
  const gaugeStroke = gaugeC * (1 - clampedRate / 100);
  const rateColor = (achievementRate ?? 0) >= 100 ? "#059669" : (achievementRate ?? 0) >= 70 ? "#171717" : "#D71921";

  // Stacked bar proportions
  const barTotal = platforms.reduce((s, p) => s + p.views, 0) || 1;

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-col md:flex-row">
          {/* Left: Radial gauge */}
          <div className="flex items-center justify-center py-8 px-10 md:border-r border-black/4">
            <div className="relative">
              <svg width="140" height="140" viewBox="0 0 140 140" className="transform -rotate-90">
                <circle cx="70" cy="70" r={gaugeR} fill="none" stroke="#f0f0f0" strokeWidth="10" />
                <circle
                  cx="70" cy="70" r={gaugeR} fill="none"
                  stroke={rateColor} strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={`${gaugeC}`}
                  strokeDashoffset={gaugeStroke}
                  className="transition-all duration-1000 ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-black tabular-nums leading-none" style={{ color: rateColor }}>{achievementRate ?? 0}%</span>
                <span className="text-[10px] text-muted-foreground font-medium mt-1">達成率</span>
              </div>
            </div>
          </div>

          {/* Right: Numbers + breakdown */}
          <div className="flex-1 py-6 px-6 flex flex-col justify-center gap-5">
            {/* Current / Target row */}
            <div className="flex items-end gap-6">
              <div>
                <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">実績</p>
                <p className="text-3xl font-black tabular-nums leading-none text-foreground">
                  {totalViews >= 10000 ? `${(totalViews / 10000).toFixed(1)}万` : fmt(totalViews)}
                </p>
              </div>
              {targetViews && targetViews > 0 && (
                <div>
                  <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">目標</p>
                  <p className="text-xl font-bold tabular-nums leading-none text-secondary-foreground">
                    {targetViews >= 10000 ? `${(targetViews / 10000).toFixed(1)}万` : fmt(targetViews)}
                  </p>
                </div>
              )}
            </div>

            {/* Stacked horizontal bar */}
            {platforms.length > 0 && (
              <div>
                <div className="flex h-2.5 rounded-full overflow-hidden bg-[#f0f0f0]">
                  {platforms.map((p, i) => (
                    <div
                      key={p.label}
                      className="h-full transition-all duration-700 ease-out"
                      style={{
                        width: `${Math.max((p.views / barTotal) * 100, 1)}%`,
                        backgroundColor: p.color,
                        borderRadius: i === 0 ? "9999px 0 0 9999px" : i === platforms.length - 1 ? "0 9999px 9999px 0" : undefined,
                      }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-4 mt-2.5">
                  {platforms.map(p => (
                    <div key={p.label} className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                      <span className="text-[11px] text-muted-foreground font-medium">{p.label}</span>
                      <span className="text-[11px] font-bold tabular-nums text-foreground">{fmt(p.views)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================
// Cumulative Metrics Chart (累計メトリクス推移)
// ============================

type MetricKey = "views" | "likes" | "comments" | "shares" | "saves";
const METRIC_CONFIG: { key: MetricKey; label: string; color: string }[] = [
  { key: "views", label: "再生数", color: "#0a0a0a" },
  { key: "likes", label: "いいね", color: "#D71921" },
  { key: "comments", label: "コメント", color: "#6366f1" },
  { key: "shares", label: "シェア", color: "#f59e0b" },
  { key: "saves", label: "保存", color: "#8b5cf6" },
];

function CumulativeMetricsChart({ dailyMetrics, campaign }: { dailyMetrics: any[]; campaign?: any }) {
  const [chartFilter, setChartFilter] = useState<"all" | "tiktok" | "youtube" | "instagram">("all");
  const [chartMode, setChartMode] = useState<"cumulative" | "daily">("cumulative");
  const [enabledMetrics, setEnabledMetrics] = useState<Set<MetricKey>>(new Set(["views", "likes", "comments", "shares", "saves"]));

  const targetViews = campaign?.targetViews as number | undefined;

  const toggleMetric = (key: MetricKey) => {
    setEnabledMetrics(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key); // 最低1つは残す
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // 動画URL別 → 日付別のスナップショットを整理
  const { cumulativeData, dailyIncrementData } = useMemo(() => {
    if (!dailyMetrics || dailyMetrics.length === 0) return { cumulativeData: [], dailyIncrementData: [] };
    const filtered = chartFilter === "all" ? dailyMetrics : dailyMetrics.filter((m: any) => m.platform === chartFilter);

    const byVideo = new Map<string, Map<string, { views: number; likes: number; comments: number; shares: number; saves: number }>>();
    for (const m of filtered) {
      const url = m.videoUrl || "";
      const dateKey = m.dateKey;
      if (!url || !dateKey) continue;
      if (!byVideo.has(url)) byVideo.set(url, new Map());
      const videoMap = byVideo.get(url)!;
      const entry = videoMap.get(dateKey) || { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
      entry.views += m.viewCount || 0;
      entry.likes += m.likeCount || 0;
      entry.comments += m.commentCount || 0;
      entry.shares += m.shareCount || 0;
      entry.saves += m.saveCount || 0;
      videoMap.set(dateKey, entry);
    }

    const allDates = new Set<string>();
    for (const videoMap of byVideo.values()) {
      for (const d of videoMap.keys()) allDates.add(d);
    }
    const sortedDates = [...allDates].sort();
    if (sortedDates.length < 2) return { cumulativeData: [], dailyIncrementData: [] };

    // Forward-fill: 欠損日を前日値で埋めて累積値が下がるのを防止
    for (const videoMap of byVideo.values()) {
      let lastKnown: { views: number; likes: number; comments: number; shares: number; saves: number } | null = null;
      for (const dateKey of sortedDates) {
        const snap = videoMap.get(dateKey);
        if (snap) {
          lastKnown = snap;
        } else if (lastKnown) {
          videoMap.set(dateKey, { ...lastKnown });
        }
      }
    }

    // 日次増分（前日比）
    const dailyIncr = sortedDates.slice(1).map((dateKey, i) => {
      const prevDate = sortedDates[i];
      let views = 0, likes = 0, comments = 0, shares = 0, saves = 0;
      for (const videoMap of byVideo.values()) {
        const cur = videoMap.get(dateKey);
        const prev = videoMap.get(prevDate);
        if (cur && prev) {
          views += Math.max(0, cur.views - prev.views);
          likes += Math.max(0, cur.likes - prev.likes);
          comments += Math.max(0, cur.comments - prev.comments);
          shares += Math.max(0, cur.shares - prev.shares);
          saves += Math.max(0, cur.saves - prev.saves);
        }
      }
      return { date: dateKey, views, likes, comments, shares, saves };
    });

    // 累積データ：各日付の全動画合計スナップショット値（実際の累積再生数）
    const cumData = sortedDates.map(dateKey => {
      let views = 0, likes = 0, comments = 0, shares = 0, saves = 0;
      for (const videoMap of byVideo.values()) {
        const snap = videoMap.get(dateKey);
        if (snap) {
          views += snap.views;
          likes += snap.likes;
          comments += snap.comments;
          shares += snap.shares;
          saves += snap.saves;
        }
      }
      return { date: dateKey, views, likes, comments, shares, saves };
    });

    return { cumulativeData: cumData, dailyIncrementData: dailyIncr };
  }, [dailyMetrics, chartFilter]);

  const chartData = chartMode === "cumulative" ? cumulativeData : dailyIncrementData;

  const availablePlatforms = useMemo(() => {
    if (!dailyMetrics || dailyMetrics.length === 0) return new Set<string>();
    return new Set(dailyMetrics.map((m: any) => m.platform).filter(Boolean));
  }, [dailyMetrics]);

  // どのメトリクスが存在するか（生の dailyMetrics レコードで判定）
  const availableMetrics = useMemo(() => {
    const set = new Set<MetricKey>(["views"]);
    if (!dailyMetrics) return set;
    const filtered = chartFilter === "all" ? dailyMetrics : dailyMetrics.filter((m: any) => m.platform === chartFilter);
    for (const m of filtered) {
      if ((m.likeCount || 0) > 0) set.add("likes");
      if ((m.commentCount || 0) > 0) set.add("comments");
      if ((m.shareCount || 0) > 0) set.add("shares");
      if ((m.saveCount || 0) > 0) set.add("saves");
    }
    return set;
  }, [dailyMetrics, chartFilter]);

  // 再生数と他メトリクスでスケールが大きく異なるのでデュアルY軸を使う
  const activeMetrics = METRIC_CONFIG.filter(m => availableMetrics.has(m.key) && enabledMetrics.has(m.key));
  const showViews = enabledMetrics.has("views") && availableMetrics.has("views");
  const engagementMetrics = activeMetrics.filter(m => m.key !== "views");
  const needsDualAxis = showViews && engagementMetrics.length > 0;

  if (cumulativeData.length < 2) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-2">
          {/* Row 1: Title + cumulative/daily toggle + platform filter */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">パフォーマンス推移</CardTitle>
              <div className="flex rounded-lg border border-border dark:border-slate-700 overflow-hidden">
                <button
                  className={`px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                    chartMode === "cumulative"
                      ? "bg-[#0a0a0a] text-white"
                      : "bg-[#f5f5f5] dark:bg-slate-900 hover:bg-card dark:hover:bg-slate-800 text-muted-foreground"
                  }`}
                  onClick={() => setChartMode("cumulative")}
                >
                  累積
                </button>
                <button
                  className={`px-2.5 py-0.5 text-[10px] font-medium transition-colors border-l border-border dark:border-slate-700 ${
                    chartMode === "daily"
                      ? "bg-[#0a0a0a] text-white"
                      : "bg-[#f5f5f5] dark:bg-slate-900 hover:bg-card dark:hover:bg-slate-800 text-muted-foreground"
                  }`}
                  onClick={() => setChartMode("daily")}
                >
                  日次
                </button>
              </div>
            </div>
            <div className="flex gap-1">
              {(["all", "tiktok", "youtube", "instagram"] as const).map(pf => {
                if (pf !== "all" && !availablePlatforms.has(pf)) return null;
                const active = chartFilter === pf;
                return (
                  <button
                    key={pf}
                    onClick={() => setChartFilter(pf)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    {pf === "all" ? "全体" : pf === "tiktok" ? "TikTok" : pf === "youtube" ? "YouTube" : "Instagram"}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Row 2: Metric toggle buttons — click to show/hide each metric */}
          <div className="flex items-center gap-1 flex-wrap">
            {METRIC_CONFIG.filter(m => availableMetrics.has(m.key)).map(m => {
              const active = enabledMetrics.has(m.key);
              return (
                <button
                  key={m.key}
                  onClick={() => toggleMetric(m.key)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 ${
                    active
                      ? "text-white shadow-sm"
                      : "bg-[#f5f5f5] dark:bg-slate-800 text-muted-foreground hover:bg-[#e5e5e5] dark:hover:bg-slate-700 line-through"
                  }`}
                  style={active ? { backgroundColor: m.color } : undefined}
                >
                  <span className="w-2 h-2 rounded-full border border-current" style={active ? { backgroundColor: "rgba(255,255,255,0.5)" } : { backgroundColor: m.color, opacity: 0.4 }} />
                  {m.label}
                </button>
              );
            })}
            {needsDualAxis && (
              <span className="ml-auto text-[10px] text-muted-foreground">左軸: 再生数 / 右軸: エンゲージメント</span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 overflow-hidden">
        <ResponsiveContainer width="100%" height={300}>
          {chartMode === "cumulative" ? (
            <ComposedChart data={chartData}>
              <defs>
                {activeMetrics.map(m => (
                  <linearGradient key={m.key} id={`gradCumul_${m.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={m.color} stopOpacity={m.key === "views" ? 0.15 : 0} />
                    <stop offset="95%" stopColor={m.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={v => v.slice(5)} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={v => fmt(v)} />
              {needsDualAxis && (
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={v => fmt(v)} />
              )}
              <RechartsTooltip
                formatter={(v: number, name: string) => {
                  const mc = METRIC_CONFIG.find(m => m.key === name);
                  return [v.toLocaleString(), mc?.label ?? name];
                }}
                labelFormatter={v => v}
                contentStyle={{ fontSize: 11 }}
              />
              {showViews && (
                <Area yAxisId="left" type="monotone" dataKey="views" stroke="#0a0a0a" fill={`url(#gradCumul_views)`} strokeWidth={2} name="views" dot={{ r: 2, fill: "#0a0a0a" }} />
              )}
              {engagementMetrics.map(m => (
                <Line key={m.key} yAxisId={needsDualAxis ? "right" : "left"} type="monotone" dataKey={m.key} stroke={m.color} strokeWidth={2} name={m.key} dot={{ r: 2, fill: m.color }} />
              ))}
              {!needsDualAxis && activeMetrics.filter(m => m.key !== "views").length === 0 && showViews && targetViews && targetViews > 0 && (
                <ReferenceLine yAxisId="left" y={targetViews} stroke="#f97316" strokeDasharray="6 3" strokeWidth={2} label={{ value: `目標 ${targetViews >= 10000 ? `${(targetViews / 10000).toFixed(1)}万` : fmt(targetViews)}`, position: "insideTopRight", fontSize: 10, fill: "#f97316" }} />
              )}
            </ComposedChart>
          ) : (
            <ComposedChart data={chartData}>
              <defs>
                {activeMetrics.map(m => (
                  <linearGradient key={m.key} id={`gradDaily_${m.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={m.color} stopOpacity={m.key === "views" ? 0.15 : 0} />
                    <stop offset="95%" stopColor={m.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={v => v.slice(5)} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={v => fmt(v)} />
              {needsDualAxis && (
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={v => fmt(v)} />
              )}
              <RechartsTooltip
                formatter={(v: number, name: string) => {
                  const mc = METRIC_CONFIG.find(m => m.key === name);
                  return [`+${fmt(v)}`, mc?.label ?? name];
                }}
                labelFormatter={v => v}
                contentStyle={{ fontSize: 11 }}
              />
              {showViews && (
                <Area yAxisId="left" type="monotone" dataKey="views" stroke="#0a0a0a" fill={`url(#gradDaily_views)`} strokeWidth={2} name="views" dot={{ r: 2, fill: "#0a0a0a" }} />
              )}
              {engagementMetrics.map(m => (
                <Line key={m.key} yAxisId={needsDualAxis ? "right" : "left"} type="monotone" dataKey={m.key} stroke={m.color} strokeWidth={2} name={m.key} dot={{ r: 2, fill: m.color }} />
              ))}
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

