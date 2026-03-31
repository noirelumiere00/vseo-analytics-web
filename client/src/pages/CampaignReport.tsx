import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ArrowLeft, Download, RefreshCw, TrendingUp, TrendingDown, Minus, Crown, Star, Brain, Search, Eye, BarChart3, Users, Hash, Share2, Globe, ChevronUp, ChevronDown, Heart, MessageCircle, Bookmark, ExternalLink, CalendarDays, Pencil, Check, Loader2, Layers, Sparkles, Trophy, AlertTriangle, Play, ArrowUpDown, FileDown, Filter, Link2, Copy, CheckCheck, Music } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, LineChart, Line, ReferenceLine, ReferenceArea, Cell, AreaChart, Area, ComposedChart } from "recharts";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

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
    <span className={`inline-flex items-center gap-0.5 font-medium ${isPositive ? "text-green-600" : isNegative ? "text-red-500" : "text-muted-foreground"}`}>
      {isPositive ? <TrendingUp className="h-3.5 w-3.5" /> : isNegative ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
      {value > 0 ? "+" : ""}{value}{suffix}
    </span>
  );
}

function BeforeAfter({ before, after, suffix = "" }: { before: string | number; after: string | number; suffix?: string }) {
  return (
    <span>
      <span className="text-slate-400">{before}{suffix}</span>
      <span className="text-muted-foreground mx-1">&rarr;</span>
      <span className="text-blue-600 font-semibold">{after}{suffix}</span>
    </span>
  );
}

// Sentiment analysis from caption text
const POS_WORDS = /最高|美味し|おいし|すごい|すごく|良い|いい感じ|おすすめ|オススメ|楽し|好き|可愛|かわいい|カワイイ|嬉し|素敵|綺麗|きれい|最強|神$|神す|ヤバい|やばい|やばす|感動|面白|おもしろ|幸せ|大好き|ハマ|リピ|推し|優勝|天才|完璧|完成度|満足|虜|沼|飯テロ|至福|贅沢|絶品|旨|うま|ウマ|映え|バズ|お気に入り|抜群|極上|最上|一番|ベスト|感謝|ありがと|👍|🔥|❤|💕|😍|🥰|✨|💯|👏|😋|🤤/i;
const NEG_WORDS = /最悪|まずい|マズい|ダメ|だめ|微妙|残念|嫌い|きらい|ひどい|酷い|悪い|がっかり|ガッカリ|不味|後悔|失敗|期待はずれ|いまいち|イマイチ|つまらな|詐欺|ぼったくり|高すぎ|不満|苦手|やめた|無理|クソ|ゴミ|💩|😤|😡|👎/i;

function analyzeSentiment(text: string | undefined): "positive" | "neutral" | "negative" {
  if (!text) return "neutral";
  const hasPos = POS_WORDS.test(text);
  const hasNeg = NEG_WORDS.test(text);
  if (hasPos && !hasNeg) return "positive";
  if (hasNeg && !hasPos) return "negative";
  if (hasPos && hasNeg) return "neutral"; // mixed → neutral
  return "neutral";
}

const SENTIMENT_CONFIG = {
  positive: { label: "ポジティブ", color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200", dotColor: "bg-emerald-500", Icon: TrendingUp },
  neutral:  { label: "ナチュラル", color: "text-slate-500", bg: "bg-slate-50 border-slate-200", dotColor: "bg-slate-400", Icon: Minus },
  negative: { label: "ネガティブ", color: "text-red-500", bg: "bg-red-50 border-red-200", dotColor: "bg-red-500", Icon: TrendingDown },
} as const;

export const gradeColors: Record<string, string> = {
  S: "bg-yellow-500 text-white",
  A: "bg-green-500 text-white",
  B: "bg-blue-500 text-white",
  C: "bg-gray-500 text-white",
  D: "bg-red-500 text-white",
};

export const SECTIONS = [
  { id: "summary", label: "総合", icon: Brain },
  { id: "platform", label: "全媒体", icon: Layers },
  { id: "videos", label: "TikTok", icon: Eye },
  { id: "keyword-sov", label: "順位・シェア", icon: Search },
  { id: "competitor", label: "競合", icon: Users },
  { id: "ripple", label: "波及", icon: Share2 },
  { id: "cross", label: "相関", icon: Globe },
];

// ============================
// Main Component
// ============================

export default function CampaignReport() {
  usePageTitle("施策レポート");
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
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
  const ripple = useMemo(() => {
    const rawRipple = report?.rippleReport || {};
    const kws = (campaign?.keywords || []).map((kw: string) => kw.replace(/^#/, "").toLowerCase()).filter(Boolean);
    const name = (campaign?.name || "").toLowerCase();
    const ownIds = (campaign?.ownAccountIds || []).map((id: string) => id.toLowerCase());
    if (kws.length === 0) return rawRipple;
    const filtered: Record<string, any> = {};
    for (const [tag, data] of Object.entries(rawRipple)) {
      const lower = tag.toLowerCase();
      const relevant = kws.some(kw => lower.includes(kw) || kw.includes(lower))
        || (name && (lower.includes(name) || name.includes(lower)))
        || ownIds.some(id => lower.includes(id) || id.includes(lower));
      if (relevant) filtered[tag] = data;
    }
    return Object.keys(filtered).length > 0 ? filtered : rawRipple;
  }, [report, campaign]);

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
        <div className="max-w-7xl mx-auto">
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
        <div className="max-w-7xl mx-auto text-center py-12">
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
  const freqReport = report.competitorFrequencyReport || [];
  const crossPlatform = (report as any).crossPlatformData as any | undefined;
  const videoScores = (report as any).videoScores as any[] | undefined;
  const aiReport = (report as any).aiOverallReport as any | undefined;
  const bigKeywordReport = (report as any).bigKeywordReport as Array<{ keyword: string; before: { ownVideoCount: number; bestRank: number | null }; after: { ownVideoCount: number; bestRank: number | null }; competitors?: Array<{ competitor_name: string; competitor_id: string; best_rank: number | null; video_count_in_top30: number; before_best_rank: number | null; before_video_count_in_top30: number; rank_change: number | null }> }> | undefined;

  const platformSummary = (report as any).platformSummary as {
    youtube?: { totalVideos: number; totalViews: number; totalLikes: number; avgER: number; videos: any[] };
    instagram?: { totalVideos: number; totalViews: number; totalLikes: number; avgER: number; videos: any[] };
  } | undefined;

  const hasBaseline = report.baselineDate != null;
  const hasVideoMetrics = videoMetrics && videoMetrics.length > 0;
  const hasCrossPlatform = crossPlatform && (crossPlatform.trendsData?.length > 0 || crossPlatform.videoTimeline?.length > 0);
  const hasBigKW = bigKeywordReport && bigKeywordReport.length > 0;
  const hasCompetitors = campaign?.competitors && campaign.competitors.length > 0;
  const hasYoutube = platformSummary?.youtube && platformSummary.youtube.videos.length > 0;
  const hasInstagram = platformSummary?.instagram && platformSummary.instagram.videos.length > 0;
  const hasMultiPlatform = hasYoutube || hasInstagram;
  const hasAnyPlatformData = hasVideoMetrics || hasYoutube || hasInstagram;

  // Filter visible sections
  const visibleSections = SECTIONS.filter(s => {
    if (s.id === "platform" && !hasAnyPlatformData) return false;
    if (s.id === "videos" && !hasVideoMetrics) return false;
    if (s.id === "competitor" && !hasCompetitors) return false;
    if (s.id === "cross" && !hasCrossPlatform) return false;
    return true;
  });
  const sectionNumber = (id: string) => visibleSections.findIndex(s => s.id === id) + 1;

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full">
        {/* Fixed Header + Nav */}
        <div className="shrink-0 bg-background z-20 border-b">
          <div className="max-w-[1600px] mx-auto px-2 md:px-3">
            {/* Header */}
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLocation(`/campaigns/${campaignId}`)}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
                <div>
                  <h1 className="text-lg font-bold tracking-tight leading-tight">{campaign?.name || "施策効果レポート"}</h1>
                  <p className="text-xs text-muted-foreground">
                    {report.baselineDate ? new Date(report.baselineDate).toLocaleDateString("ja-JP") : "?"} &rarr; {report.measurementDate ? new Date(report.measurementDate).toLocaleDateString("ja-JP") : "?"}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <CalendarDays className="h-3.5 w-3.5" />
                    <span>施策期間:</span>
                    <input type="date" value={campaignStart} onChange={e => setCampaignStart(e.target.value)} className="border rounded px-1.5 py-0.5 text-xs bg-background" />
                    <span>〜</span>
                    <input type="date" value={campaignEnd} onChange={e => setCampaignEnd(e.target.value)} className="border rounded px-1.5 py-0.5 text-xs bg-background" />
                    {(campaignStart !== defaultStart || campaignEnd !== defaultEnd) && (
                      <button onClick={() => { setCampaignStart(defaultStart); setCampaignEnd(defaultEnd); }} className="text-xs text-primary hover:underline">リセット</button>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <TrackingToggle campaignId={campaignId} />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => regenerateMutation.mutate({ campaignId })}
                  disabled={regenerateMutation.isPending}
                  className="gap-2"
                >
                  <RefreshCw className={`h-4 w-4 ${regenerateMutation.isPending ? "animate-spin" : ""}`} />
                  {regenerateMutation.isPending ? "再生成中…" : "レポート再生成"}
                </Button>
                <Button variant="outline" onClick={handleCsvExport} className="gap-2">
                  <Download className="h-4 w-4" />
                  CSV
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <Link2 className="h-4 w-4" />
                      共有
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
            <nav className="py-1 overflow-x-auto">
              <div className="flex gap-1 min-w-max">
                {visibleSections.map((sec) => {
                  const Icon = sec.icon;
                  return (
                    <button
                      key={sec.id}
                      onClick={() => scrollTo(sec.id)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors whitespace-nowrap ${
                        activeSection === sec.id
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
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
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[1600px] mx-auto px-2 md:px-3 space-y-4 pt-4 pb-8">

        {/* Section: Executive Summary */}
        <div id="summary" ref={el => { sectionRefs.current["summary"] = el; }} className="scroll-mt-16 section-fade-in">
          <SectionHeader number={sectionNumber("summary")} title="エグゼクティブサマリー" question="施策は成功したのか？" />
          {aiReport && (
            <Card className="mb-4 relative overflow-hidden">
              <div className="absolute top-3 right-3">
                <Badge variant="outline" className="gap-1 text-[10px] px-2 py-0.5 bg-background/80 backdrop-blur-sm border-violet-300 text-violet-600">
                  <Sparkles className="h-3 w-3" />
                  AI Generated
                </Badge>
              </div>
              <CardContent className="py-5 flex items-start gap-4">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0 ring-4 ring-offset-2 ring-offset-background ${gradeColors[aiReport.grade] || gradeColors.C} ${aiReport.grade === "S" ? "ring-yellow-300" : aiReport.grade === "A" ? "ring-green-300" : aiReport.grade === "B" ? "ring-blue-300" : "ring-gray-200"}`}>
                  {aiReport.grade}
                </div>
                <p className="text-sm leading-relaxed pt-2 pr-20">{aiReport.summary}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Section: Multi-Platform Summary */}
        {/* Section: All-Platform Summary */}
        {hasAnyPlatformData && (
          <div id="platform" ref={el => { sectionRefs.current["platform"] = el; }} className="scroll-mt-16 section-fade-in">
            <SectionHeader number={sectionNumber("platform")} title="全媒体横断サマリー" question="全プラットフォームの合計は？" />
            <PlatformSummarySection
              tiktokVideos={videoMetrics || []}
              platformSummary={platformSummary || {}}
              dailyMetrics={dailyMetrics}
              hasBaseline={hasBaseline}
            />
          </div>
        )}

        {/* Section: TikTok Videos */}
        {hasVideoMetrics && (
          <div id="videos" ref={el => { sectionRefs.current["videos"] = el; }} className="scroll-mt-16 section-fade-in">
            <SectionHeader number={sectionNumber("videos")} title="TikTok 施策動画パフォーマンス" question="TikTok動画の状況は？" />
            <SummaryCards summary={summary} thirdPartyCount={thirdPartyInPeriodCount} hasBaseline={hasBaseline} ripple={ripple} sovReport={sovReport} />
            <div className="mt-5">
              <VideoSection videos={videoMetrics!} videoScores={videoScores} hasBaseline={hasBaseline} dailyMetrics={dailyMetrics} keywords={campaign?.keywords ?? undefined} bigKeywords={campaign?.bigKeywords ?? undefined} />
            </div>
          </div>
        )}

        {/* Section: Keyword + SOV (unified) */}
        <div id="keyword-sov" ref={el => { sectionRefs.current["keyword-sov"] = el; }} className="scroll-mt-16 section-fade-in">
          <SectionHeader number={sectionNumber("keyword-sov")} title="検索順位・上位シェア率" question="検索上位にどの動画が露出した？" />
          <UnifiedKeywordSovSection positions={positions} bigKeywordReport={hasBigKW ? bigKeywordReport! : undefined} sovReport={sovReport} hasBaseline={hasBaseline} campaign={campaign} campaignId={campaignId} onSlotUpdate={handleSlotUpdate} />
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
          <RippleSection ripple={ripple} campaign={campaign} campaignId={campaignId} />
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
      <div className="flex items-center gap-2">
        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold">{number}</span>
        <h2 className="text-lg font-bold">{title}</h2>
      </div>
      <p className="text-sm text-muted-foreground ml-9">{question}</p>
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
                  <p className="text-base font-bold">
                    <span className="text-slate-400">{card.before}</span>
                    <span className="text-muted-foreground mx-1">&rarr;</span>
                    <span className="text-blue-600">{card.after}</span>
                  </p>
                  {card.change && <div className="text-sm">{card.change}</div>}
                </>
              ) : (
                <p className="text-xl font-bold text-blue-600">{card.value}</p>
              )}
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="py-3 px-4 space-y-1 text-center">
            <p className="text-xs text-muted-foreground">第三者投稿</p>
            <p className="text-xl font-bold text-blue-600">{tpStats.count}本</p>
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
            <p className="text-xl font-bold text-blue-600">{card.value}</p>
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
        className={`flex items-center gap-3 rounded-lg border-l-4 bg-white p-3 hover:shadow-md transition-all ${
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
            <span className="text-sm font-semibold text-slate-800 truncate">@{slot.creator_username}</span>
          </div>
          <p className="text-xs text-slate-400 truncate mt-0.5">{slot.description?.slice(0, 40)}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[9px] px-1 rounded ${genreInfo.cls}`}>{genreInfo.label}</span>
            <span className="text-xs font-bold text-slate-600">#{slot.rank}</span>
            <span className="text-[10px] text-slate-400 flex items-center gap-0.5"><Eye className="h-3 w-3" />{fmt(slot.view_count)}</span>
          </div>
        </div>
      </a>
      {/* Edit button */}
      {!readOnly && (
      <Popover open={editOpen} onOpenChange={setEditOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center transition-all duration-200 hover:bg-blue-50 hover:border-blue-400 hover:shadow-md ${
              editOpen ? "opacity-100 scale-100" : "opacity-0 scale-90 pointer-events-none group-hover/card:opacity-100 group-hover/card:scale-100 group-hover/card:pointer-events-auto"
            }`}
          >
            <Pencil className="h-3 w-3 text-slate-400" />
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

export function UnifiedKeywordSovSection({ positions, bigKeywordReport, sovReport, hasBaseline, campaign, campaignId, onSlotUpdate, readOnly }: {
  positions: any[];
  bigKeywordReport?: Array<{ keyword: string; before: { ownVideoCount: number; bestRank: number | null }; after: { ownVideoCount: number; bestRank: number | null }; ownVideos?: Array<{ videoId: string; username: string; description: string; rank: number; viewCount: number }> }>;
  sovReport: Record<string, any>;
  hasBaseline: boolean;
  campaign?: any;
  campaignId: number;
  onSlotUpdate: (keyword: string, phase: "before" | "after", videoId: string, changes: any) => void;
  readOnly?: boolean;
}) {
  const [activeKw, setActiveKw] = useState<string | null>(null);

  // --- SOV aggregate data ---
  const sovEntries = Object.entries(sovReport);
  const chartData = sovEntries
    .map(([kw, data]) => {
      const afterSlots = (data.after_slots || []) as SlotData[];
      const beforeSlots = (data.before_slots || []) as SlotData[];
      // Use slot-based counts (Top10) for consistency
      const slotTotal = afterSlots.length;
      const slotOwn = afterSlots.filter(s => s.owner === "own").length;
      return {
        keyword: kw,
        own: slotOwn,
        total: slotTotal,
        pct: slotTotal > 0 ? Math.round((slotOwn / slotTotal) * 100 * 10) / 10 : 0,
        afterSlots,
        beforeSlots,
        before: data.before || {},
        after: data.after || {},
        beforeOwn: beforeSlots.filter(s => s.owner === "own").length,
        isBigKeyword: !!data._isBigKeyword,
      };
    })
    .filter(d => d.total > 0);

  const allAfterSlots = chartData.flatMap(d => d.afterSlots);
  const totalOwn = chartData.reduce((s, d) => s + d.own, 0);
  const totalScanned = chartData.reduce((s, d) => s + d.total, 0);
  const avgPct = totalScanned > 0 ? Math.round((totalOwn / totalScanned) * 100 * 10) / 10 : 0;

  const officialCount = allAfterSlots.filter(s => s.owner === "own" && s.owner_detail === "official").length;
  const satelliteCount = allAfterSlots.filter(s => s.owner === "own" && s.owner_detail === "satellite").length;
  const campaignCount = allAfterSlots.filter(s => s.owner === "own" && s.owner_detail === "campaign").length;

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

  // Set default active KW
  const effectiveActiveKw = activeKw || (kwList.length > 0 ? kwList[0].keyword : null);
  const activeKwData = kwList.find(k => k.keyword === effectiveActiveKw);

  // Best rank across all KWs
  const bestRankOverall = useMemo(() => {
    let best = 999;
    for (const [, pos] of positionMap) {
      if (pos.afterRank != null && pos.afterRank < best) best = pos.afterRank;
    }
    return best < 999 ? best : null;
  }, [positionMap]);

  // --- Pad slots to 10 ---
  const padSlots = (slots: SlotData[]) => {
    const result: (SlotData | null)[] = [];
    for (let i = 1; i <= 10; i++) {
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
    <div className="space-y-5">
      {/* ======== HeroCard ======== */}
      {chartData.length > 0 && (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_1fr] gap-0 md:divide-x divide-slate-100">
              {/* Donut */}
              <div className="flex flex-col items-center justify-center py-6 px-4">
                <svg viewBox="0 0 120 120" className="w-28 h-28">
                  <circle cx="60" cy="60" r="50" fill="none" stroke="#f1f5f9" strokeWidth="12" />
                  <circle
                    cx="60" cy="60" r="50" fill="none"
                    stroke="#3b82f6" strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray={`${(avgPct / 100) * 314} 314`}
                    transform="rotate(-90 60 60)"
                    className="animate-donut-fill"
                  />
                  <text x="60" y="54" textAnchor="middle" className="text-[28px] font-extrabold fill-blue-600">{avgPct}</text>
                  <text x="60" y="72" textAnchor="middle" className="text-[11px] fill-slate-400">%シェア</text>
                </svg>
                <p className="text-xs text-slate-400 mt-1.5">{totalOwn}/{totalScanned}本が自社</p>
              </div>

              {/* 4 stat boxes */}
              <div className="grid grid-cols-2 gap-px bg-slate-100">
                {[
                  { label: "キーワード数", value: `${kwList.length}`, sub: "KW" },
                  { label: "Top10 自社動画", value: `${totalOwn}`, sub: "本" },
                  { label: "最高順位", value: bestRankOverall != null ? `${bestRankOverall}` : "—", sub: bestRankOverall != null ? "位" : "" },
                  { label: "施策比", value: hasBaseline ? (() => {
                    // 施策で新たにTop10入りした自社動画数（afterにいてbeforeにいない）
                    let added = 0;
                    for (const d of chartData) {
                      const beforeIds = new Set(d.beforeSlots.filter(s => s.owner === "own").map(s => s.video_id));
                      added += d.afterSlots.filter(s => s.owner === "own" && !beforeIds.has(s.video_id)).length;
                    }
                    return `+${added}`;
                  })() : "—", sub: hasBaseline ? "本" : "" },
                ].map((stat, i) => (
                  <div key={i} className="bg-white flex flex-col items-center justify-center py-4 px-3">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">{stat.label}</p>
                    <p className="text-2xl font-extrabold text-slate-800 leading-none">{stat.value}<span className="text-sm font-normal text-slate-400 ml-0.5">{stat.sub}</span></p>
                  </div>
                ))}
              </div>

              {/* Account breakdown */}
              <div className="flex flex-col justify-center py-5 px-5 gap-3">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">アカウント内訳</p>
                {[
                  { label: "公式", count: officialCount, color: "bg-blue-500", textColor: "text-blue-700" },
                  { label: "サテライト", count: satelliteCount, color: "bg-teal-500", textColor: "text-teal-700" },
                  { label: "施策", count: campaignCount, color: "bg-purple-500", textColor: "text-purple-700" },
                ].map(cat => {
                  const pct = totalOwn > 0 ? (cat.count / totalOwn) * 100 : 0;
                  return (
                    <div key={cat.label} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className={`font-medium ${cat.textColor}`}>{cat.label}</span>
                        <span className="text-slate-500 tabular-nums">{cat.count}本</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className={`h-full rounded-full ${cat.color} transition-all`} style={{ width: `${pct}%`, minWidth: cat.count > 0 ? '4px' : 0 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ======== KwTabBar ======== */}
      {kwList.length > 0 && (
        <div className="overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            {kwList.map(kw => {
              const isActive = kw.keyword === effectiveActiveKw;
              const ownCount = kw.sovData?.own || 0;
              const totalCount = kw.sovData?.total || 0;
              return (
                <button
                  key={kw.keyword}
                  onClick={() => setActiveKw(kw.keyword)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                    isActive
                      ? "bg-blue-600 text-white shadow-md"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {kw.keyword}
                  {totalCount > 0 && (
                    <span className={`text-[11px] font-bold tabular-nums ${isActive ? "text-blue-200" : "text-slate-400"}`}>
                      {ownCount}/{totalCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ======== KwTabContent ======== */}
      {activeKwData && (
        <div className="space-y-5">
          {/* OwnVideoCards */}
          {activeKwData.sovData && (() => {
            const ownSlots = activeKwData.sovData.afterSlots.filter(s => s.owner === "own");
            if (ownSlots.length === 0) return null;
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {ownSlots.map(slot => (
                  <OwnVideoCard key={slot.video_id} slot={slot} keyword={activeKwData.keyword} onSlotUpdate={onSlotUpdate} readOnly={readOnly} />
                ))}
              </div>
            );
          })()}

          {/* OccupationMap (前後比較 — ジャンル可視化) */}
          {activeKwData.sovData && (() => {
            const sovData = activeKwData.sovData;
            const afterSlots = sovData.afterSlots;
            const beforeSlots = sovData.beforeSlots;
            const afterOwnCount = afterSlots.filter(s => s.owner === "own").length;
            const beforeOwnCount = beforeSlots.filter(s => s.owner === "own").length;
            const ownChange = afterOwnCount - beforeOwnCount;
            const paddedBefore = padSlots(beforeSlots);
            const paddedAfter = padSlots(afterSlots);
            const afterPct = afterSlots.length > 0 ? Math.round((afterOwnCount / afterSlots.length) * 100 * 10) / 10 : 0;
            const beforePct = beforeSlots.length > 0 ? Math.round((beforeOwnCount / beforeSlots.length) * 100 * 10) / 10 : 0;
            const pctChange = Number((afterPct - beforePct).toFixed(1));

            // Genre counting
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

            // Rank change map for after-row badges
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
              return { label: "NEW", color: "bg-emerald-500" };
            };

            const renderSlotInRow = (slot: SlotData | null, i: number, isBefore: boolean) => {
              if (!slot) return (
                <div key={i} className="flex flex-col items-center flex-1 max-w-[100px]">
                  <span className="text-[10px] font-semibold text-slate-300/60 mb-0.5">#{i + 1}</span>
                  <div className={`w-full ${isBefore ? "h-[85px]" : "h-[100px]"} rounded-md border border-dashed border-slate-200/40 flex items-center justify-center`}>
                    <span className="text-[9px] text-slate-200">{i + 1}</span>
                  </div>
                </div>
              );
              const rc = !isBefore ? getRankChange(slot) : null;
              return (
                <div key={i} className="flex flex-col items-center flex-1 max-w-[100px]">
                  <span className="text-[10px] font-semibold text-slate-300 mb-0.5">#{i + 1}</span>
                  <SovSlotCell
                    slot={slot} maxViewCount={maxViewCount} keyword={activeKwData.keyword}
                    phase={isBefore ? "before" : "after"} isBefore={isBefore}
                    onSlotUpdate={onSlotUpdate} readOnly={readOnly}
                    rankChangeLabel={rc?.label} rankChangeBadgeColor={rc?.color}
                  />
                  {slot.owner === "own" && (
                    <span className="mt-0.5 text-[9px] font-semibold text-foreground text-center max-w-[80px] truncate">
                      @{slot.creator_username}
                    </span>
                  )}
                </div>
              );
            };

            return afterSlots.length > 0 ? (
              <Card>
                <CardContent className="px-4 py-5 space-y-3">
                  {/* Legend */}
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-slate-500 font-medium">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[9px] text-slate-400 font-semibold tracking-wider uppercase">アカウント</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-blue-600" />公式</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-teal-600" />サテライト</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-purple-600" />施策</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-slate-200 border border-slate-300" />競合</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="text-[9px] text-slate-400 font-semibold tracking-wider uppercase">ジャンル</span>
                      {Object.entries(GENRE_CONFIG).map(([key, { label, barCls }]) => (
                        <span key={key} className="flex items-center gap-1">
                          <span className={`w-4 h-1.5 rounded-sm ${barCls}`} />
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* ===== 施策前 ===== */}
                  {hasBaseline && beforeSlots.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-500">施策前</span>
                        <span className="text-[11px] text-slate-400">
                          自社 {beforeOwnCount}/{beforeSlots.length} ({beforePct}%) ｜ ネガティブ {beforeNeg}本
                        </span>
                      </div>
                      <div className="flex justify-between items-end w-full gap-0.5 overflow-x-auto pb-1">
                        {paddedBefore.map((slot, i) => renderSlotInRow(slot, i, true))}
                      </div>
                    </>
                  )}

                  {/* ===== ジャンル変動サマリー ===== */}
                  {hasBaseline && beforeSlots.length > 0 && (
                    <div className="flex justify-center items-center gap-1.5 py-3 flex-wrap">
                      {/* 施策動画 */}
                      <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold ${
                        ownChange > 0 ? "bg-emerald-50 border border-emerald-200" : "bg-slate-50"
                      }`}>
                        <span className="w-2 h-2 rounded-sm bg-emerald-500 shrink-0" />
                        <span>施策動画</span>
                        <span className={`font-bold ${ownChange > 0 ? "text-emerald-500" : ownChange < 0 ? "text-red-500" : "text-slate-400"}`}>
                          {beforeOwnCount}→{afterOwnCount}本{ownChange !== 0 && ` (${ownChange > 0 ? "+" : ""}${ownChange})`}
                        </span>
                      </div>
                      {/* Genre items */}
                      {Object.entries(GENRE_CONFIG).map(([key, { label, barCls }]) => {
                        const bCount = beforeGenres[key] || 0;
                        const aCount = afterGenres[key] || 0;
                        const change = aCount - bCount;
                        const isNegReduced = key === "negative" && change < 0;
                        return (
                          <div key={key} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold ${
                            isNegReduced ? "bg-red-50 border border-red-200" : "bg-slate-50"
                          }`}>
                            <span className={`w-2 h-2 rounded-sm ${barCls} shrink-0`} />
                            <span>{label}</span>
                            <span className={`font-bold ${change > 0 ? "text-emerald-500" : change < 0 ? "text-red-500" : "text-slate-400"}`}>
                              {bCount}→{aCount}本{change !== 0 && ` (${change > 0 ? "+" : ""}${change})`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* ===== 施策後 ===== */}
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-blue-600">
                      {hasBaseline && beforeSlots.length > 0 ? "施策後" : "現在"}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      自社 {afterOwnCount}/{afterSlots.length} ({afterPct}%) ｜ ネガティブ {afterNeg}本
                    </span>
                  </div>
                  <div className="flex justify-between items-end w-full gap-0.5 overflow-x-auto pb-1">
                    {paddedAfter.map((slot, i) => renderSlotInRow(slot, i, false))}
                  </div>

                  {/* ===== 変化サマリー ===== */}
                  {hasBaseline && beforeSlots.length > 0 && (
                    <div className="flex justify-center gap-6 pt-2 text-[13px] font-semibold">
                      <span className={pctChange > 0 ? "text-emerald-500" : pctChange < 0 ? "text-red-500" : "text-slate-400"}>
                        シェア {beforePct}% → {afterPct}%（{pctChange > 0 ? "+" : ""}{pctChange}pt）
                      </span>
                      <span className="text-slate-300">｜</span>
                      <span className={negChange < 0 ? "text-red-500" : negChange > 0 ? "text-emerald-500" : "text-slate-400"}>
                        ネガティブ {beforeNeg}本 → {afterNeg}本（{negChange < 0 ? "" : negChange > 0 ? "+" : "±"}{negChange}本）
                      </span>
                    </div>
                  )}

                  {/* Stats cards */}
                  {(() => {
                    const afterRank = activeKwData.posData?.afterRank;
                    const rankChange = activeKwData.posData?.rankChange;
                    return (
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex flex-col items-center gap-1 rounded-lg bg-slate-50/80 py-2.5 px-2">
                          <span className="text-[10px] text-slate-400 font-medium">シェア率</span>
                          <span className="text-xl font-bold text-blue-600">{afterPct}<span className="text-sm font-normal">%</span></span>
                          {hasBaseline && beforeSlots.length > 0 && (
                            <ChangeIndicator value={pctChange} suffix="pt" />
                          )}
                        </div>
                        <div className="flex flex-col items-center gap-1 rounded-lg bg-slate-50/80 py-2.5 px-2">
                          <span className="text-[10px] text-slate-400 font-medium">自社動画数</span>
                          <span className="text-xl font-bold text-slate-700">{afterOwnCount}<span className="text-sm font-normal text-slate-400"> /{afterSlots.length}</span></span>
                          {hasBaseline && beforeSlots.length > 0 && (
                            <ChangeIndicator value={ownChange} suffix="本" />
                          )}
                        </div>
                        <div className="flex flex-col items-center gap-1 rounded-lg bg-slate-50/80 py-2.5 px-2">
                          <span className="text-[10px] text-slate-400 font-medium">最高順位</span>
                          {afterRank != null ? (
                            <>
                              <span className="text-xl font-bold text-slate-700">{afterRank}<span className="text-sm font-normal">位</span></span>
                              {hasBaseline && rankChange != null && (
                                <ChangeIndicator value={rankChange} suffix="位" />
                              )}
                            </>
                          ) : (
                            <span className="text-xl font-bold text-slate-300">—</span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            ) : null;
          })()}
        </div>
      )}

      {/* ======== KwSummaryTable (常時表示) ======== */}
      {kwList.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="py-2.5 px-4 text-left text-xs font-semibold text-slate-500">キーワード</th>
                  <th className="py-2.5 px-3 text-left text-xs font-semibold text-slate-500 w-40">シェア率</th>
                  <th className="py-2.5 px-3 text-center text-xs font-semibold text-slate-500 whitespace-nowrap">自社動画</th>
                  <th className="py-2.5 px-3 text-center text-xs font-semibold text-slate-500 whitespace-nowrap">最高順位</th>
                  <th className="py-2.5 px-3 text-center text-xs font-semibold text-slate-500 whitespace-nowrap">順位変動</th>
                </tr>
              </thead>
              <tbody>
                {kwList.map(kw => {
                  const pct = kw.sovData?.pct || 0;
                  const own = kw.sovData?.own || 0;
                  const afterRank = kw.posData?.afterRank;
                  const rankChange = kw.posData?.rankChange;
                  return (
                    <tr
                      key={kw.keyword}
                      className={`border-b border-slate-50 hover:bg-blue-50/40 transition-colors cursor-pointer ${kw.keyword === effectiveActiveKw ? "bg-blue-50/60" : ""}`}
                      onClick={() => setActiveKw(kw.keyword)}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-slate-800">{kw.keyword}</span>
                          {kw.isBigKeyword && <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 text-amber-700 border-amber-300 bg-amber-50">ビッグKW</Badge>}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-bold text-blue-600 tabular-nums w-10 text-right">{pct}%</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="text-sm font-bold text-slate-700">{own}<span className="text-xs font-normal text-slate-400">/{kw.sovData?.total || 0}</span></span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        {afterRank != null ? (
                          <span className={`text-sm font-bold ${afterRank <= 3 ? "text-green-600" : afterRank <= 10 ? "text-blue-600" : "text-slate-600"}`}>{afterRank}位</span>
                        ) : (
                          <span className="text-xs text-slate-300">圏外</span>
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
  if (score >= 90) return "bg-yellow-100 text-yellow-800 border-yellow-300"; // S
  if (score >= 75) return "bg-green-100 text-green-800 border-green-300";   // A
  if (score >= 60) return "bg-blue-100 text-blue-800 border-blue-300";      // B
  if (score >= 40) return "bg-orange-100 text-orange-800 border-orange-300"; // C
  return "bg-red-100 text-red-800 border-red-300";                          // D
}

function SlantedXTick({ x, y, payload, urlMap }: any) {
  const lines = (payload.value || "").split("\n");
  const url = urlMap?.[payload.value];
  const accountEl = url
    ? <a href={url} target="_blank" rel="noopener noreferrer"><text x={0} y={0} dy={10} textAnchor="end" fontSize={10} fill="#2563eb" style={{ cursor: "pointer" }}>{lines[0]}</text></a>
    : <text x={0} y={0} dy={10} textAnchor="end" fontSize={10} fill="#64748b">{lines[0]}</text>;
  return (
    <g transform={`translate(${x},${y}) rotate(-35)`}>
      {accountEl}
      {lines[1] && <text x={0} y={0} dy={22} textAnchor="end" fontSize={9} fill="#94a3b8">{lines[1]}</text>}
    </g>
  );
}

function VideoChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border rounded-lg shadow-lg p-2 text-xs">
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
    <div className="space-y-4">
      {/* サマリー */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card><CardContent className="py-3 px-4 text-center">
          <p className="text-xs text-muted-foreground">動画数</p>
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
        // フォールバック: postedAt集約の累積チャート
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
              <CardTitle className="text-base">累積パフォーマンス推移</CardTitle>
              <CardDescription className="text-xs">日別累積値（投稿日順）</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={lineData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" ticks={ticks} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tickFormatter={(v: number) => fmt(v)} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => fmt(v)} tick={{ fontSize: 11 }} />
                  <RechartsTooltip formatter={(v: number) => v.toLocaleString()} />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="再生数" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="いいね" stroke="#ef4444" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="コメント" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="保存" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="シェア" stroke="#8b5cf6" strokeWidth={2} dot={false} />
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
// TikTok パフォーマンス推移（累積 / 日次増分 切替）
// ============================

function TikTokPerformanceChart({ dailyMetrics, videos }: { dailyMetrics: any[]; videos: any[] }) {
  const [chartMode, setChartMode] = useState<"cumulative" | "daily">("cumulative");

  const { cumulativeData, dailyData, hasShares, hasSaves } = useMemo(() => {
    // 日付×動画URL別にスナップショットを整理
    const dayMap = new Map<string, { views: number; likes: number; comments: number; shares: number; saves: number }>();
    for (const dm of dailyMetrics) {
      if (dm.platform && dm.platform !== "tiktok") continue;
      const dateKey = dm.date?.split("T")[0] || dm.dateKey;
      if (!dateKey) continue;
      const entry = dayMap.get(dateKey) || { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
      entry.views += dm.viewCount || 0;
      entry.likes += dm.likeCount || 0;
      entry.comments += dm.commentCount || 0;
      entry.shares += dm.shareCount || 0;
      entry.saves += dm.saveCount || 0;
      dayMap.set(dateKey, entry);
    }

    const sortedDays = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b));

    // 累積データ（スナップショット値そのまま）
    const cumData = sortedDays.map(([dateKey, d]) => ({
      name: `${new Date(dateKey).getMonth() + 1}/${new Date(dateKey).getDate()}`,
      再生数: d.views, いいね: d.likes, コメント: d.comments, シェア: d.shares, 保存: d.saves,
    }));

    // 日次増分データ（前日との差分）
    const dData = sortedDays.map(([dateKey, d], i) => {
      const prev = i > 0 ? sortedDays[i - 1][1] : { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
      return {
        name: `${new Date(dateKey).getMonth() + 1}/${new Date(dateKey).getDate()}`,
        再生数: Math.max(0, d.views - prev.views),
        いいね: Math.max(0, d.likes - prev.likes),
        コメント: Math.max(0, d.comments - prev.comments),
        シェア: Math.max(0, d.shares - prev.shares),
        保存: Math.max(0, d.saves - prev.saves),
      };
    });

    const _hasShares = cumData.some(d => d.シェア > 0);
    const _hasSaves = cumData.some(d => d.保存 > 0);

    return { cumulativeData: cumData, dailyData: dData, hasShares: _hasShares, hasSaves: _hasSaves };
  }, [dailyMetrics]);

  const lineData = chartMode === "cumulative" ? cumulativeData : dailyData;
  if (lineData.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">パフォーマンス推移（実測値）</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {chartMode === "cumulative" ? "各動画の累積メトリクス合計の推移" : "日毎のメトリクス増分（前日比）"}
            </CardDescription>
          </div>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            <button
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                chartMode === "cumulative"
                  ? "bg-blue-500 text-white"
                  : "bg-white hover:bg-slate-50 text-slate-500"
              }`}
              onClick={() => setChartMode("cumulative")}
            >
              累計
            </button>
            <button
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors border-l border-slate-200 ${
                chartMode === "daily"
                  ? "bg-blue-500 text-white"
                  : "bg-white hover:bg-slate-50 text-slate-500"
              }`}
              onClick={() => setChartMode("daily")}
            >
              日次
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          {chartMode === "cumulative" ? (
            <LineChart data={lineData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tickFormatter={(v: number) => fmt(v)} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => fmt(v)} tick={{ fontSize: 11 }} />
              <RechartsTooltip formatter={(v: number) => v.toLocaleString()} />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="再生数" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="いいね" stroke="#ef4444" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="コメント" stroke="#f59e0b" strokeWidth={2} dot={false} />
              {hasShares && <Line yAxisId="right" type="monotone" dataKey="シェア" stroke="#8b5cf6" strokeWidth={2} dot={false} />}
              {hasSaves && <Line yAxisId="right" type="monotone" dataKey="保存" stroke="#10b981" strokeWidth={2} dot={false} />}
            </LineChart>
          ) : (
            <ComposedChart data={lineData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tickFormatter={(v: number) => fmt(v)} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => fmt(v)} tick={{ fontSize: 11 }} />
              <RechartsTooltip formatter={(v: number) => v.toLocaleString()} />
              <Legend />
              <Bar yAxisId="left" dataKey="再生数" fill="#3b82f6" fillOpacity={0.7} radius={[2, 2, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="いいね" stroke="#ef4444" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="コメント" stroke="#f59e0b" strokeWidth={2} dot={false} />
              {hasShares && <Line yAxisId="right" type="monotone" dataKey="シェア" stroke="#8b5cf6" strokeWidth={2} dot={false} />}
              {hasSaves && <Line yAxisId="right" type="monotone" dataKey="保存" stroke="#10b981" strokeWidth={2} dot={false} />}
            </ComposedChart>
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

  const sparks = useMemo(() => {
    // Group daily metrics by videoUrl
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
          // レポートA: before→after の2点
          sorted = [{ dateKey: "before", value: bVal }, { dateKey: "after", value: aVal }];
        } else if (!hasBaseline && aVal > 0 && v.postedAt) {
          // レポートB: 投稿日からの経過日数で均等割り → 1日あたり上昇値の推移
          const postedDate = new Date(v.postedAt);
          const now = new Date();
          const elapsedDays = Math.max(1, Math.floor((now.getTime() - postedDate.getTime()) / (1000 * 60 * 60 * 24)));
          const dailyAvg = aVal / elapsedDays;
          const points = Math.min(elapsedDays + 1, 30); // 最大30点でグラフ描画
          const step = elapsedDays / (points - 1);
          sorted = Array.from({ length: points }, (_, i) => {
            const day = Math.round(step * i);
            return {
              dateKey: `${day}日`,
              value: day === 0 ? 0 : Math.round(dailyAvg * day),
            };
          });
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
      const er = vw > 0 ? Number(((lk + cm + sh) / vw * 100).toFixed(2)) : 0;

      return {
        videoUrl: url,
        caption: (v.description || "").slice(0, 18),
        username: username ? `@${username}` : "",
        coverUrl: v.coverUrl || "",
        latestVal,
        data: sorted,
        er,
        postedAt: v.postedAt || "",
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

  return (<>
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-semibold">投稿パフォーマンス推移</p>
            <p className="text-[11px] text-muted-foreground">{hasDailyData ? "各投稿の時系列パフォーマンス" : "各投稿の施策前後パフォーマンス"}</p>
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
            const vals = s.data.map(d => d.value);
            const sMax = Math.max(...vals, 1);
            const sMin = Math.min(...vals, 0);
            const sRange = sMax - sMin || 1;
            const W = 200, H = 40;
            const pts = vals.map((sv, si) => {
              const x = vals.length > 1 ? (si / (vals.length - 1)) * W : W / 2;
              const y = H - ((sv - sMin) / sRange) * (H - 4) - 2;
              return `${x},${y}`;
            });
            const poly = pts.join(" ");
            const polyFill = `0,${H} ${poly} ${W},${H}`;
            const displayVal = sortBy === "er" ? s.er : s.latestVal;
            const intensity = topVal > 0 ? Math.min(displayVal / topVal, 1) : 0.5;
            const sc = intensity > 0.5 ? "#6366f1" : intensity > 0.2 ? "#818cf8" : "#a5b4fc";
            const gId = `spk-${idx}`;
            return (
              <a key={s.videoUrl || idx} href={s.videoUrl} target="_blank" rel="noopener noreferrer"
                className="block rounded-lg border bg-background hover:border-slate-300 hover:shadow-md transition-all overflow-hidden group">
                {/* 上部: サムネ + ユーザー名 + キャプション + 大きな数値 */}
                <div className="flex items-start gap-2.5 p-3 pb-2">
                  {s.coverUrl ? (
                    <img src={s.coverUrl} alt="" className="w-11 h-[62px] rounded-md object-cover flex-shrink-0" loading="lazy" />
                  ) : (
                    <div className="w-11 h-[62px] rounded-md bg-gradient-to-br from-indigo-400 to-purple-500 flex-shrink-0 flex items-center justify-center">
                      <Play className="h-3 w-3 text-white/80" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    {s.username && <p className="text-[10px] font-bold text-slate-600 truncate">{s.username}</p>}
                    <p className="text-[10px] text-slate-400 truncate leading-snug">{s.caption || "動画"}</p>
                    <p className="text-2xl font-extrabold tabular-nums text-slate-800 leading-tight mt-0.5">
                      {sortBy === "er" ? `${s.er}%` : sortBy === "date" ? (s.postedAt ? s.postedAt.split("T")[0] : "-") : fmt(s.latestVal)}
                    </p>
                    <p className="text-[9px] text-slate-400 font-medium">
                      {sortBy === "er" ? "ER" : sortBy === "date" ? "投稿日" : SPARK_LABELS[sparkMetric]}
                    </p>
                  </div>
                </div>
                {/* 下部: スパークライン */}
                {vals.length >= 2 && (
                  <div className="px-3 pb-2">
                    <div className="h-[40px]">
                      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full">
                        <defs>
                          <linearGradient id={gId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={sc} stopOpacity={0.25} />
                            <stop offset="100%" stopColor={sc} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <polygon fill={`url(#${gId})`} points={polyFill} />
                        <polyline fill="none" stroke={sc} strokeWidth="2" points={poly} />
                      </svg>
                    </div>
                  </div>
                )}
              </a>
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

    {/* 下段: 動画詳細カード (スパークラインなし) */}
    <PostDetailCardGrid videos={videos} dailyMetrics={dailyMetrics} />
  </>
  );
}

const DETAIL_PAGE = 8;

function PostDetailCardGrid({ videos, dailyMetrics }: { videos: any[]; dailyMetrics?: any[] }) {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? videos : videos.slice(0, DETAIL_PAGE);
  const remaining = videos.length - DETAIL_PAGE;

  // dailyMetricsから各動画の最新値を取得
  const latestByUrl = useMemo(() => {
    const map = new Map<string, { viewCount: number; likeCount: number; commentCount: number; shareCount: number; saveCount: number }>();
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
          _dk: dateKey,
        } as any);
      }
    }
    return map;
  }, [dailyMetrics]);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800">動画詳細</h3>
          <p className="text-xs text-muted-foreground mt-0.5">施策動画の詳細情報</p>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {displayed.map((v: any, i: number) => {
              const url = v.videoUrl || "";
              const username = url.match(/@([^/]+)/)?.[1] || "";
              const tags = (v.hashtags || []).slice(0, 4);
              // 最新のdailyMetricsがあればそちらを優先、なければスナップショット値
              const dm = latestByUrl.get(url);
              const views = Math.max(dm?.viewCount || 0, v.after?.viewCount || 0);
              const likes = Math.max(dm?.likeCount || 0, v.after?.likeCount || 0);
              const comments = Math.max(dm?.commentCount || 0, v.after?.commentCount || 0);
              const shares = Math.max(dm?.shareCount || 0, v.after?.shareCount || 0);
              const saves = Math.max(dm?.saveCount || 0, v.after?.saveCount || 0);

              return (
                <a key={url || i} href={url} target="_blank" rel="noopener noreferrer"
                  className="flex gap-3 rounded-xl bg-slate-50/80 border border-slate-100 p-3.5 hover:border-slate-300 hover:shadow-md transition-all">
                  {/* Thumbnail */}
                  {v.coverUrl ? (
                    <img src={v.coverUrl} alt="" className="w-[56px] h-[100px] rounded-lg object-cover flex-shrink-0" loading="lazy" />
                  ) : (
                    <div className="w-[56px] h-[100px] rounded-lg bg-gradient-to-br from-indigo-400 to-purple-500 flex-shrink-0 flex items-center justify-center">
                      <Play className="h-4 w-4 text-white/80" />
                    </div>
                  )}
                  {/* Meta */}
                  <div className="flex-1 min-w-0 flex flex-col justify-between gap-1">
                    <div>
                      {username && <p className="text-xs font-bold text-slate-800 truncate">@{username}</p>}
                      <p className="text-[11px] text-slate-500 line-clamp-2 leading-snug mt-0.5">{(v.description || "").slice(0, 80)}</p>
                    </div>
                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {tags.map((tag: string, ti: number) => (
                          <span key={ti} className="text-[9px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-1.5 py-px">
                            #{tag.replace(/^#/, "")}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 flex-wrap">
                      <span className="flex items-center gap-0.5"><Eye className="h-2.5 w-2.5" /><strong className="text-slate-700">{fmt(views)}</strong></span>
                      <span className="flex items-center gap-0.5"><Heart className="h-2.5 w-2.5" /><strong className="text-slate-700">{fmt(likes)}</strong></span>
                      <span className="flex items-center gap-0.5"><MessageCircle className="h-2.5 w-2.5" /><strong className="text-slate-700">{fmt(comments)}</strong></span>
                      <span className="flex items-center gap-0.5"><Share2 className="h-2.5 w-2.5" /><strong className="text-slate-700">{fmt(shares)}</strong></span>
                      {saves > 0 && <span className="flex items-center gap-0.5"><Bookmark className="h-2.5 w-2.5" /><strong className="text-slate-700">{fmt(saves)}</strong></span>}
                      {views > 0 && <span className="flex items-center gap-0.5"><TrendingUp className="h-2.5 w-2.5" /><strong className="text-slate-700">{(((likes || 0) + (comments || 0)) / views * 100).toFixed(2)}%</strong></span>}
                    </div>
                    {v.postedAt && <p className="text-[10px] text-slate-400">{new Date(v.postedAt).toLocaleDateString("ja-JP")}</p>}
                  </div>
                </a>
              );
            })}
          </div>
          {remaining > 0 && (
            <div className="text-center mt-4 pt-3 border-t border-slate-100">
              <button
                onClick={(e) => { e.preventDefault(); setShowAll(!showAll); }}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-4 py-1.5 rounded-full transition-colors"
              >
                {showAll ? "閉じる" : `もっと見る（残り ${remaining} 件）`}
              </button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
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

const GENRE_CONFIG: Record<string, { label: string; cls: string; barCls: string }> = {
  recommend: { label: "レコメンド", cls: "bg-orange-500 text-white", barCls: "bg-orange-500" },
  howto: { label: "How-to", cls: "bg-sky-400 text-white", barCls: "bg-sky-400" },
  entertainment: { label: "エンタメ", cls: "bg-pink-500 text-white", barCls: "bg-pink-500" },
  negative: { label: "ネガティブ", cls: "bg-red-500 text-white", barCls: "bg-red-500" },
  other: { label: "その他", cls: "bg-slate-400 text-white", barCls: "bg-slate-400" },
};

const OWNER_LABEL_CONFIG: Record<string, { text: string; cls: string }> = {
  official: { text: "公式", cls: "bg-blue-100 text-blue-700 border-blue-300" },
  satellite: { text: "サテライト", cls: "bg-teal-100 text-teal-700 border-teal-300" },
  campaign: { text: "施策", cls: "bg-purple-100 text-purple-700 border-purple-300" },
  competitor: { text: "競合", cls: "bg-orange-100 text-orange-700 border-orange-300" },
};

const TIKTOK_LABEL_CONFIG: Record<string, { text: string; dot: string }> = {
  promotion: { text: "プロモーション", dot: "bg-amber-400" },
  paid_partnership: { text: "有償パートナーシップ", dot: "bg-pink-400" },
  aigc: { text: "AI生成メディアを含む", dot: "bg-violet-400" },
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
    // Top cap label
    capBg: "bg-blue-600",
    capText: "text-white",
    capLabel: "公式",
    // Left accent bar
    accentBar: "bg-blue-500",
    // Rank badge
    rankBg: "bg-blue-600",
    rankText: "text-white",
    // Card wrapper
    wrapperBorder: "border-blue-400",
    wrapperShadow: "shadow-[0_4px_16px_rgba(59,130,246,0.35)]",
    // Empty thumbnail fallback
    emptyBg: "bg-blue-50",
    emptyText: "text-blue-300",
  },
  satellite: {
    capBg: "bg-teal-600",
    capText: "text-white",
    capLabel: "サテライト",
    accentBar: "bg-teal-500",
    rankBg: "bg-teal-600",
    rankText: "text-white",
    wrapperBorder: "border-teal-400",
    wrapperShadow: "shadow-[0_4px_16px_rgba(20,184,166,0.35)]",
    emptyBg: "bg-teal-50",
    emptyText: "text-teal-300",
  },
  campaign: {
    capBg: "bg-purple-600",
    capText: "text-white",
    capLabel: "施策",
    accentBar: "bg-purple-500",
    rankBg: "bg-purple-600",
    rankText: "text-white",
    wrapperBorder: "border-purple-400",
    wrapperShadow: "shadow-[0_4px_16px_rgba(147,51,234,0.35)]",
    emptyBg: "bg-purple-50",
    emptyText: "text-purple-300",
  },
  competitor: {
    capBg: "bg-orange-500",
    capText: "text-white",
    capLabel: "競合",
    accentBar: "bg-orange-400",
    rankBg: "bg-black/50",
    rankText: "text-white",
    wrapperBorder: "border-orange-300",
    wrapperShadow: "shadow-sm",
    emptyBg: "bg-orange-50",
    emptyText: "text-orange-300",
  },
  other: {
    capBg: "",
    capText: "",
    capLabel: "",
    accentBar: "",
    rankBg: "bg-black/40",
    rankText: "text-white",
    wrapperBorder: "border-slate-200",
    wrapperShadow: "shadow-none",
    emptyBg: "bg-slate-100",
    emptyText: "text-slate-300",
  },
};

// Owner key maps to owner + owner_detail combo
type OwnerKey = "official" | "satellite" | "campaign" | "competitor" | "other";
function slotToOwnerKey(slot: SlotData): OwnerKey {
  if (slot.owner === "own") return (slot.owner_detail as OwnerKey) || "official";
  if (slot.owner === "competitor") return "competitor";
  return "other";
}
function ownerKeyToChanges(key: OwnerKey): { owner: "own" | "competitor" | "other"; owner_detail?: string } {
  if (key === "official" || key === "satellite" || key === "campaign") return { owner: "own", owner_detail: key };
  if (key === "competitor") return { owner: "competitor" };
  return { owner: "other" };
}

const OWNER_KEY_OPTIONS: { key: OwnerKey; label: string; color: string; activeBg: string }[] = [
  { key: "official", label: "公式", color: "text-blue-700", activeBg: "bg-blue-100 border-blue-400 ring-1 ring-blue-300" },
  { key: "satellite", label: "サテライト", color: "text-teal-700", activeBg: "bg-teal-100 border-teal-400 ring-1 ring-teal-300" },
  { key: "campaign", label: "施策", color: "text-purple-700", activeBg: "bg-purple-100 border-purple-400 ring-1 ring-purple-300" },
  { key: "competitor", label: "競合", color: "text-orange-700", activeBg: "bg-orange-100 border-orange-400 ring-1 ring-orange-300" },
  { key: "other", label: "その他", color: "text-slate-600", activeBg: "bg-slate-100 border-slate-400 ring-1 ring-slate-300" },
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
      <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">スロット編集</span>
        <span className="text-[10px] text-slate-300">@{slot.creator_username}</span>
      </div>

      {/* Owner classification */}
      <div className="space-y-1.5">
        <Label className="text-[11px] font-semibold text-slate-500">分類</Label>
        <div className="flex flex-wrap gap-1">
          {OWNER_KEY_OPTIONS.map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setOwnerKey(opt.key)}
              className={`text-[10px] px-2 py-1 rounded-md border font-medium transition-all duration-150 ${
                ownerKey === opt.key
                  ? `${opt.activeBg} ${opt.color}`
                  : "border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600"
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
        <Label className="text-[11px] font-semibold text-slate-500">ジャンル</Label>
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
                    : "border-slate-200 text-slate-400 hover:border-slate-300"
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
        <Label className="text-[11px] font-semibold text-slate-500">ラベル</Label>
        <div className="space-y-1">
          {Object.entries(TIKTOK_LABEL_CONFIG).map(([key, cfg]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer group/lbl">
              <Checkbox
                checked={labels.includes(key)}
                onCheckedChange={() => toggleLabel(key)}
                className="h-3.5 w-3.5"
              />
              <span className="flex items-center gap-1 text-[11px] text-slate-600 group-hover/lbl:text-slate-800">
                <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                {cfg.text}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
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
          className="h-7 text-xs px-2 text-slate-400"
        >
          キャンセル
        </Button>
      </div>
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
    ? "shadow-[0_4px_16px_rgba(59,130,246,0.25)] ring-2 ring-blue-400/50"
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
          className={`absolute -top-1.5 -right-1.5 z-40 w-5 h-5 rounded-full bg-white border border-slate-300 shadow-md flex items-center justify-center
            transition-all duration-200 hover:bg-blue-50 hover:border-blue-400 hover:shadow-lg
            ${editOpen ? "opacity-100 scale-100" : "opacity-0 scale-75 pointer-events-none group-hover/slot:opacity-100 group-hover/slot:scale-100 group-hover/slot:pointer-events-auto"}`}
        >
          <Pencil className="h-2.5 w-2.5 text-slate-500" />
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
            <div className={`relative w-full ${thumbH} overflow-hidden ${isLabeled ? `rounded-b-md border-2 ${cfg.wrapperBorder} ${cfg.wrapperShadow}` : "rounded-md border border-slate-200/70"}`}>
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
                <span className={`absolute bottom-2.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[8px] font-bold text-white whitespace-nowrap z-20 ${rankChangeBadgeColor || "bg-black/55"}`}>
                  {rankChangeLabel}
                </span>
              )}
            </div>
          </a>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs bg-white text-foreground border shadow-lg p-3 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-xs">#{slot.rank}</span>
            <span className="text-xs text-blue-600">@{slot.creator_username}</span>
            {isOwn && cfg.capLabel && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${cfg.capBg} ${cfg.capText}`}>{cfg.capLabel}</span>
            )}
            {isCompetitor && slot.owner_name && (
              <span className="text-[9px] text-orange-600 font-medium">競合: {slot.owner_name}</span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground line-clamp-2">{slot.description}</p>
          <div className="flex items-center gap-3 text-[10px] text-slate-500">
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
      {before != null && <span className="text-[10px] text-slate-400">{before}位</span>}
      <span className={`font-medium ${after != null ? "text-foreground" : "text-muted-foreground"}`}>
        {after != null ? `${after}位` : "圏外"}
      </span>
      {before != null && after != null && (
        <ChangeIndicator value={before - after} suffix="位" />
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* 統合順位比較テーブル */}
      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">キーワード別順位比較</CardTitle>
            <CardDescription className="text-xs">施策KW・ビッグKWでの自社と競合の検索順位（Top30）</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>キーワード</TableHead>
                  <TableHead className="text-center text-blue-600">自社</TableHead>
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
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${row.type === "ビッグKW" ? "bg-purple-100 text-purple-600" : "bg-blue-100 text-blue-600"}`}>
                          {row.type}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center bg-blue-50/50">
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
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800">注目の第三者投稿（再生数上位）</h3>
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
            <div className="text-center mt-4 pt-3 border-t border-slate-100">
              <button
                onClick={(e) => { e.preventDefault(); setShowAll(!showAll); }}
                className="text-xs font-semibold text-purple-600 hover:text-purple-700 hover:bg-purple-50 px-4 py-1.5 rounded-full transition-colors"
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
        className="flex gap-3 rounded-xl bg-slate-50/80 border border-slate-100 p-3.5 hover:border-slate-300 hover:shadow-md transition-all"
      >
        {/* Thumbnail */}
        <div className="relative flex-shrink-0">
          {v.cover_url ? (
            <img src={v.cover_url} alt="" className="w-[56px] h-[100px] rounded-lg object-cover" loading="lazy" />
          ) : (
            <div className="w-[56px] h-[100px] rounded-lg bg-gradient-to-br from-purple-400 to-indigo-500 flex items-center justify-center">
              <Play className="h-4 w-4 text-white/80" />
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
              <p className="text-xs font-bold text-slate-800 truncate">@{v.creator}</p>
              <span className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-px rounded-full border ${sentCfg.bg} ${sentCfg.color} flex-shrink-0`}>
                <sentCfg.Icon className="h-2 w-2" />
                {sentCfg.label}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 line-clamp-2 leading-snug mt-0.5">{v.description?.slice(0, 80)}</p>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag: string, ti: number) => (
                <span key={ti} className="text-[9px] font-medium text-purple-600 bg-purple-50 border border-purple-100 rounded-full px-1.5 py-px">
                  #{tag.replace(/^#/, "")}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
            <span className="flex items-center gap-0.5"><Eye className="h-2.5 w-2.5" /><strong className="text-slate-700">{fmt(v.views)}</strong></span>
            <span className="flex items-center gap-0.5"><Heart className="h-2.5 w-2.5" /><strong className="text-slate-700">{fmt(v.likes)}</strong></span>
            <span className="flex items-center gap-0.5"><MessageCircle className="h-2.5 w-2.5" /><strong className="text-slate-700">{fmt(v.comments)}</strong></span>
            <span className="flex items-center gap-0.5"><Share2 className="h-2.5 w-2.5" /><strong className="text-slate-700">{fmt(v.shares)}</strong></span>
            {v.saves != null && <span className="flex items-center gap-0.5"><Bookmark className="h-2.5 w-2.5" /><strong className="text-slate-700">{fmt(v.saves)}</strong></span>}
            {v.views > 0 && <span className="flex items-center gap-0.5"><TrendingUp className="h-2.5 w-2.5" /><strong className="text-slate-700">{(((v.likes || 0) + (v.comments || 0)) / v.views * 100).toFixed(2)}%</strong></span>}
          </div>
          {v.posted_at && <p className="text-[10px] text-slate-400">{new Date(v.posted_at).toLocaleDateString("ja-JP")}</p>}
        </div>
      </a>
      {/* Edit pencil */}
      <Popover open={editOpen} onOpenChange={setEditOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center transition-all duration-200 hover:bg-blue-50 hover:border-blue-400 hover:shadow-md ${
              editOpen ? "opacity-100 scale-100" : "opacity-0 scale-90 pointer-events-none group-hover/ugc:opacity-100 group-hover/ugc:scale-100 group-hover/ugc:pointer-events-auto"
            }`}
          >
            <Pencil className="h-3 w-3 text-slate-400" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="left" align="start" className="p-3 w-48 z-50" onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="space-y-2">
            <div className="flex items-center gap-2 pb-1.5 border-b border-slate-100">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">センチメント分類</span>
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
                      isActive ? `${cfg.bg} ${cfg.color} border` : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <cfg.Icon className={`h-3.5 w-3.5 ${isActive ? cfg.color : "text-slate-400"}`} />
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

export function RippleSection({ ripple, campaign, campaignId }: { ripple: Record<string, any>; campaign?: any; campaignId?: number }) {
  // Load saved sentiments from ripple data
  const savedSentiments = useMemo(() => {
    const map: Record<string, "positive" | "neutral" | "negative"> = {};
    for (const [, tagData] of Object.entries(ripple)) {
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

  const entries = Object.entries(ripple);

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          キャンペーンハッシュタグが設定されていないため、波及効果データがありません。
        </CardContent>
      </Card>
    );
  }

  // Aggregate totals
  const totalBeforePosts = entries.reduce((sum, [, d]) => sum + (d.before_posts || 0), 0);
  const totalAfterPosts = entries.reduce((sum, [, d]) => sum + (d.after_posts || 0), 0);
  const totalBeforeViews = entries.reduce((sum, [, d]) => sum + (d.before_total_views || 0), 0);
  const totalAfterViews = entries.reduce((sum, [, d]) => sum + (d.after_total_views || 0), 0);
  const totalThirdParty = entries.reduce((sum, [, d]) => sum + (d.third_party_count || d.omaage_count || 0), 0);

  // All third-party videos (deduped, sorted by views)
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

  // Aggregate KPIs
  const allViews = allVideos.map((v: any) => v.views || 0);
  const avgViews = allVideos.length > 0 ? Math.round(allViews.reduce((s, v) => s + v, 0) / allVideos.length) : 0;
  const maxViews = allViews.length > 0 ? Math.max(...allViews) : 0;

  // Max views across tags (for bar normalization)
  const maxTagViews = Math.max(...entries.map(([, d]) => d.after_total_views || 0), 1);

  // Filter out zero entries & sort by views desc
  const sortedEntries = [...entries]
    .filter(([, d]) => {
      const count = d.third_party_count || d.omaage_count || 0;
      const beforeCount = d.before_posts || 0;
      return count > 0 || beforeCount > 0;
    })
    .sort(([, a], [, b]) => (b.after_total_views || 0) - (a.after_total_views || 0));

  return (
    <div className="space-y-5">
      {/* ======== Hero KPI Row (4 cards) ======== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "第三者投稿", value: totalThirdParty, unit: "本", color: "text-blue-600", change: null },
          { label: "総再生数", value: totalAfterViews, unit: "", color: "text-purple-600", change: null, fmtVal: true },
          { label: "平均再生数", value: avgViews, unit: "", color: "text-amber-600", change: null, fmtVal: true },
          { label: "最高再生", value: maxViews, unit: "", color: "text-green-600", change: null, fmtVal: true },
        ].map((kpi, i) => (
          <Card key={i}>
            <CardContent className="py-3 px-4 text-center">
              <p className="text-[11px] text-muted-foreground font-semibold tracking-wide uppercase mb-2">{kpi.label}</p>
              <p className={`text-3xl font-extrabold leading-none ${kpi.color}`}>
                {kpi.fmtVal ? fmt(kpi.value) : kpi.value}
                {kpi.unit && <span className="text-base font-semibold ml-0.5">{kpi.unit}</span>}
              </p>
              {kpi.change != null && kpi.change !== 0 && (
                <div className="mt-2">
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${kpi.change > 0 ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}`}>
                    {kpi.change > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {kpi.change > 0 ? "+" : ""}{kpi.fmtVal ? fmt(kpi.change) : kpi.change} vs 施策前
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ======== Hashtag Breakdown Table ======== */}
      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-800">ハッシュタグ別内訳</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50/80">
                  <th className="py-2.5 px-5 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider">タグ</th>
                  <th className="py-2.5 px-4 text-right text-[11px] font-semibold text-slate-400 uppercase tracking-wider">投稿数</th>
                  <th className="py-2.5 px-4 text-right text-[11px] font-semibold text-slate-400 uppercase tracking-wider min-w-[180px]">総再生数</th>
                  <th className="py-2.5 px-4 text-right text-[11px] font-semibold text-slate-400 uppercase tracking-wider">施策前比</th>
                </tr>
              </thead>
              <tbody>
                {sortedEntries.map(([tag, data]) => {
                  const count = data.third_party_count || data.omaage_count || 0;
                  const views = data.after_total_views || 0;
                  const beforeCount = data.before_posts || 0;
                  const change = count - beforeCount;
                  const barPct = maxTagViews > 0 ? (views / maxTagViews) * 100 : 0;
                  return (
                    <tr key={tag} className="border-b border-slate-50 last:border-0">
                      <td className="py-3 px-5 text-sm font-bold text-slate-800">{tag}</td>
                      <td className="py-3 px-4 text-right text-sm font-medium text-slate-600">{count}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-20 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full bg-purple-500 transition-all" style={{ width: `${barPct}%` }} />
                          </div>
                          <span className="text-sm font-medium text-slate-700 tabular-nums">{fmt(views)}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {change !== 0 ? (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold ${change > 0 ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}`}>
                            {change > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {change > 0 ? "+" : ""}{change}本
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">±0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ======== Sentiment Analysis ======== */}
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
        const donutColors = { positive: "#10b981", neutral: "#94a3b8", negative: "#ef4444" };

        return (
          <Card>
            <CardContent className="p-0">
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-800">センチメント分析</h3>
                <p className="text-xs text-muted-foreground mt-0.5">第三者投稿のキャプションから感情を自動分類</p>
              </div>
              <div className="p-5">
                <div className="flex items-center gap-8">
                  {/* Donut chart */}
                  <div className="flex-shrink-0 relative">
                    <svg width="120" height="120" viewBox="0 0 120 120">
                      <circle cx="60" cy="60" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="12" />
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
                      <span className="text-2xl font-black text-slate-800">{total}</span>
                      <span className="text-[10px] text-slate-400 font-medium">投稿</span>
                    </div>
                  </div>

                  {/* Breakdown bars */}
                  <div className="flex-1 space-y-3">
                    {([
                      { key: "positive" as const, label: "ポジティブ", Icon: TrendingUp, color: "bg-emerald-500", textColor: "text-emerald-600", iconColor: "text-emerald-500" },
                      { key: "neutral" as const, label: "ナチュラル", Icon: Minus, color: "bg-slate-400", textColor: "text-slate-500", iconColor: "text-slate-400" },
                      { key: "negative" as const, label: "ネガティブ", Icon: TrendingDown, color: "bg-red-500", textColor: "text-red-500", iconColor: "text-red-400" },
                    ]).map((row) => {
                      const count = sentCounts[row.key];
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      return (
                        <div key={row.key}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                              <row.Icon className={`h-3.5 w-3.5 ${row.iconColor}`} />
                              {row.label}
                            </span>
                            <span className="text-xs tabular-nums">
                              <strong className={row.textColor}>{count}</strong>
                              <span className="text-slate-400 ml-1">({pct}%)</span>
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
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
      <div className="flex items-center justify-center gap-3 py-2 text-xs font-semibold text-slate-400">
        <span>TikTokでの拡散</span>
        <div className="w-8 h-px bg-slate-300 relative">
          <div className="absolute -right-1 -top-[3px] border-l-[6px] border-l-slate-300 border-y-[4px] border-y-transparent" />
        </div>
        <span>Google検索への波及</span>
        <div className="w-8 h-px bg-slate-300 relative">
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

  const markerDates = useMemo(() => {
    const dates = new Set<string>((data.videoMarkers || []).map((m: any) => m.date as string));
    if (dates.size === 0 && videoMetrics && videoMetrics.length > 0) {
      for (const v of videoMetrics) {
        if (v.postedAt) dates.add(new Date(v.postedAt).toISOString().split("T")[0]);
      }
    }
    return dates;
  }, [data, videoMetrics]);

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


  const VOLUME_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4"];

  // Correlation strength helpers
  const corr = data.correlation as number | null | undefined;
  const corrAbs = corr != null ? Math.abs(corr) : 0;
  const corrStrength = corrAbs >= 0.7 ? "強い" : corrAbs >= 0.4 ? "中程度" : "弱い";
  const corrColor = corrAbs >= 0.7 ? "emerald" : corrAbs >= 0.4 ? "amber" : "slate";
  const corrBgClass = corrAbs >= 0.7 ? "bg-emerald-50 border-emerald-200" : corrAbs >= 0.4 ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200";
  const corrTextClass = corrAbs >= 0.7 ? "text-emerald-700" : corrAbs >= 0.4 ? "text-amber-700" : "text-slate-500";
  const corrBadgeBg = corrAbs >= 0.7 ? "bg-emerald-100 text-emerald-700 border-emerald-300" : corrAbs >= 0.4 ? "bg-amber-100 text-amber-700 border-amber-300" : "bg-slate-100 text-slate-500 border-slate-300";
  const corrDesc = corrAbs >= 0.7 ? "TikTok施策がGoogle検索トレンドに明確な影響を与えています" : corrAbs >= 0.4 ? "TikTok施策とGoogle検索に一定の関連が見られます" : "TikTok施策とGoogle検索の直接的な関連は限定的です";

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
    <div className="space-y-5">
      {/* ====== Correlation Hero Card ====== */}
      {corr != null && (
        <Card className={`border ${corrBgClass} relative overflow-hidden`}>
          {/* Decorative gradient accent */}
          <div className={`absolute inset-0 bg-gradient-to-r ${corrAbs >= 0.7 ? "from-emerald-500/5 to-transparent" : corrAbs >= 0.4 ? "from-amber-500/5 to-transparent" : "from-slate-500/5 to-transparent"}`} />
          <CardContent className="py-5 relative">
            <div className="flex items-center gap-6">
              {/* Coefficient Circle */}
              <div className="flex-shrink-0">
                <div className={`w-20 h-20 rounded-2xl flex flex-col items-center justify-center ${corrAbs >= 0.7 ? "bg-emerald-600" : corrAbs >= 0.4 ? "bg-amber-500" : "bg-slate-400"} text-white shadow-lg`}
                  style={{ boxShadow: `0 8px 24px ${corrAbs >= 0.7 ? "rgba(16,185,129,0.3)" : corrAbs >= 0.4 ? "rgba(245,158,11,0.3)" : "rgba(100,116,139,0.2)"}` }}>
                  <span className="text-[10px] font-medium opacity-80 tracking-wider uppercase">相関</span>
                  <span className="text-2xl font-black tabular-nums leading-none mt-0.5">{corr.toFixed(2)}</span>
                </div>
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <h3 className="text-base font-bold text-slate-800">Google Trends × TikTok 相関分析</h3>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${corrBadgeBg}`}>{corrStrength}</span>
                </div>
                <p className={`text-sm ${corrTextClass}`}>{corrDesc}</p>
                <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Google Trends</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> TikTok 施策投稿</span>
                  <span className="flex items-center gap-1"><span className="w-6 h-px bg-emerald-400 border-dashed border-t" /> 投稿日マーカー</span>
                </div>
              </div>
              {/* Strength meter */}
              <div className="flex-shrink-0 hidden sm:flex flex-col items-center gap-1">
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Strength</span>
                <div className="flex gap-0.5">
                  {[0.2, 0.4, 0.6, 0.8, 1.0].map((t, i) => (
                    <div key={i} className={`w-2 rounded-full transition-all ${corrAbs >= t ? (corrAbs >= 0.7 ? "bg-emerald-500 h-6" : corrAbs >= 0.4 ? "bg-amber-400 h-5" : "bg-slate-300 h-4") : "bg-slate-200 h-3"}`}
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
              <CardTitle className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <Globe className="h-4 w-4 text-blue-500" />
                Google Trends × TikTok 施策タイムライン
              </CardTitle>
            </div>
            {highlightRange && (
              <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                施策期間
              </span>
            )}
          </div>
          <CardDescription className="text-xs mt-0.5">
            検索トレンドの推移と施策投稿の日次・累計再生数を重ね合わせて表示
          </CardDescription>
        </CardHeader>
        <CardContent>
          <>
                <div className="flex items-center justify-center gap-4 sm:gap-6 mb-3 text-xs">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded bg-blue-500" /> Google Trends（左軸）</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm bg-amber-400/70" /> 日次再生数（右軸）</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded bg-orange-600" /> 累計再生数（右軸）</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-px bg-emerald-400 border-dashed border-t" /> 投稿日</span>
                </div>
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={filteredDailyChartData} margin={{ top: 10, right: 50, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="cumViewsFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ea580c" stopOpacity={0.12} />
                        <stop offset="95%" stopColor="#ea580c" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
                    <YAxis yAxisId="left" domain={[0, 100]} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "#b45309" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmt(v)} />
                    <RechartsTooltip
                      contentStyle={{ borderRadius: "10px", border: "1px solid #e2e8f0", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", fontSize: 12 }}
                      formatter={(value: any, name: string) => {
                        if (value === null || value === undefined) return ["—", name];
                        if (name === "Google Trends") return [`${value} / 100`, name];
                        return [Number(value).toLocaleString() + " 回", name];
                      }}
                    />
                    {highlightRange && (
                      <ReferenceArea x1={highlightRange.start} x2={highlightRange.end} fill="#10b981" fillOpacity={0.06} />
                    )}
                    <Area yAxisId="left" type="monotone" dataKey="trends" name="Google Trends" stroke="#3b82f6" strokeWidth={2.5} fill="url(#trendFill)" dot={false} connectNulls />
                    <Bar yAxisId="right" dataKey="dailyViews" name="日次再生数" fill="#f59e0b" fillOpacity={0.7} radius={[2, 2, 0, 0]} barSize={6} />
                    <Area yAxisId="right" type="monotone" dataKey="views" name="累計再生数" stroke="#ea580c" strokeWidth={2} fill="url(#cumViewsFill)" dot={false} connectNulls />
                    {Array.from(markerDates).map((date: string) => (
                      <ReferenceLine key={date} x={date.slice(5)} stroke="#10b981" strokeWidth={1.5} strokeDasharray="4 3" yAxisId="left">
                        <label position="top" offset={8}>
                          <text style={{ fontSize: 9, fill: "#10b981", fontWeight: 600 }}>
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
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
              {Array.from(markerDates).sort().map((date: string) => (
                <span key={date} className="text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 flex items-center gap-1">
                  <Play className="h-2.5 w-2.5 fill-emerald-500 text-emerald-500" />
                  {date.slice(5).replace("-", "/")} 投稿
                </span>
              ))}
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
                <CardTitle className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <Search className="h-4 w-4 text-indigo-500" />
                  Google 月間検索ボリューム推移
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">Google Ads Keyword Planner — 施策前後の検索数変化</CardDescription>
              </div>
              {peakMonth && peakMonth.pctChange > 0 && (
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  ピーク月 +{peakMonth.pctChange}%
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
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
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v: number) => fmt(v)} axisLine={false} tickLine={false} />
                <RechartsTooltip
                  contentStyle={{ borderRadius: "10px", border: "1px solid #e2e8f0", boxShadow: "0 4px 12px rgba(0,0,0,0.08)", fontSize: 12 }}
                  formatter={(value: any, name: string) => [Number(value).toLocaleString(), name]}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                {highlightMonths && (
                  <ReferenceArea x1={highlightMonths.start} x2={highlightMonths.end} fill="#6366f1" fillOpacity={0.05} />
                )}
                {keywordVolumes!.map((kw: any, i: number) => (
                  <Area key={kw.keyword} type="monotone" dataKey={kw.keyword} stroke={VOLUME_COLORS[i % VOLUME_COLORS.length]} strokeWidth={2} fill={`url(#volFill-${i})`} dot={{ r: 2.5, strokeWidth: 0, fill: VOLUME_COLORS[i % VOLUME_COLORS.length] }} connectNulls />
                ))}
              </AreaChart>
            </ResponsiveContainer>
            {/* Keyword chips below chart */}
            {keywordVolumes && keywordVolumes.length > 1 && (
              <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-slate-100">
                {keywordVolumes.map((kw: any, i: number) => {
                  const vols = (kw.monthlyVolumes || []) as any[];
                  const lastVol = vols.length > 0 ? vols[vols.length - 1].volume : 0;
                  const prevVol = vols.length > 1 ? vols[vols.length - 2].volume : 0;
                  const change = prevVol > 0 ? Math.round(((lastVol - prevVol) / prevVol) * 100) : 0;
                  return (
                    <span key={kw.keyword} className="text-[10px] bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: VOLUME_COLORS[i % VOLUME_COLORS.length] }} />
                      <span className="font-medium text-slate-600">{kw.keyword}</span>
                      {change !== 0 && (
                        <span className={`font-bold ${change > 0 ? "text-emerald-600" : "text-red-500"}`}>
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
  er: number;
  hashtags: string[];
  musicInfo?: { title: string; artist: string; isOriginal?: boolean } | null;
};

const PLATFORM_COLORS = {
  tiktok: { accent: "#00f2ea", bg: "bg-cyan-50 dark:bg-cyan-950/30", border: "border-l-cyan-400", dot: "bg-cyan-400", text: "text-cyan-600 dark:text-cyan-400" },
  youtube: { accent: "#dc2626", bg: "bg-red-50 dark:bg-red-950/30", border: "border-l-red-500", dot: "bg-red-500", text: "text-red-600 dark:text-red-400" },
  instagram: { accent: "#e1306c", bg: "bg-pink-50 dark:bg-pink-950/30", border: "border-l-pink-500", dot: "bg-pink-500", text: "text-pink-600 dark:text-pink-400" },
} as const;

const PLATFORM_ICONS: Record<string, string> = { tiktok: "TT", youtube: "YT", instagram: "IG" };

export function PlatformSummarySection({ tiktokVideos, platformSummary, dailyMetrics, hasBaseline = true }: {
  tiktokVideos: any[];
  platformSummary: {
    youtube?: { totalVideos: number; totalViews: number; totalLikes: number; avgER: number; videos: any[] };
    instagram?: { totalVideos: number; totalViews: number; totalLikes: number; avgER: number; videos: any[] };
  };
  dailyMetrics: any[];
  hasBaseline?: boolean;
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
      igViews += Math.max(dm?.viewCount || 0, v.viewCount || 0);
      igLikes += Math.max(dm?.likeCount || 0, v.likeCount || 0);
      igCommentsSum += Math.max(dm?.commentCount || 0, v.commentCount || 0);
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
      vids.push({
        videoUrl: url, channelId: v.ownerUsername ? `@${v.ownerUsername}` : "",
        caption: v.caption || "", viewCount: views, likeCount: likes, commentCount: comments,
        shareCount: null, saveCount: null, coverUrl: v.coverUrl || "",
        platform: "instagram", publishedAt: v.publishedAt || "",
        er: views > 0 ? Number(((eng / views) * 100).toFixed(2)) : 0,
        hashtags: igTags,
        musicInfo: igMusic ? { title: igMusic.title || "", artist: igMusic.artistName || "" } : null,
      });
    }
    return vids;
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
      v.er,
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
      cards.push({
        key: "instagram", name: "Instagram", videoCount: igData.totalVideos,
        stats: [
          { label: "再生数", value: igViews, icon: Eye },
          { label: "いいね", value: igLikes, icon: Heart },
          { label: "コメント", value: igComments, icon: MessageCircle },
          { label: "平均ER", value: igER, icon: TrendingUp },
        ],
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
    <div className="space-y-5">

      {/* ── 2a. Global KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "総投稿数", value: totalVideos.toString(), icon: Play, color: "text-foreground" },
          { label: "総再生数", value: fmt(totalViews), icon: Eye, color: "text-blue-600" },
          { label: "総いいね", value: fmt(totalLikes), icon: Heart, color: "text-rose-500" },
          { label: "総コメント", value: fmt(totalComments), icon: MessageCircle, color: "text-amber-500" },
          { label: "平均ER", value: `${avgER}%`, icon: TrendingUp, color: "text-emerald-500" },
        ].map(c => {
          const Icon = c.icon;
          // Sparkline-style proportional bar
          const maxVal = Math.max(totalViews, 1);
          const rawNum = c.label === "総再生数" ? totalViews : c.label === "総いいね" ? totalLikes : c.label === "総コメント" ? totalComments : 0;
          const barPct = c.label === "平均ER" ? Math.min(avgER * 5, 100) : c.label === "総投稿数" ? Math.min(totalVideos * 3, 100) : Math.min((rawNum / maxVal) * 100, 100);
          return (
            <Card key={c.label} className="group hover:shadow-md transition-shadow duration-200">
              <CardContent className="py-4 px-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <Icon className={`h-3.5 w-3.5 ${c.color}`} />
                  <span className="text-[11px] text-muted-foreground font-medium">{c.label}</span>
                </div>
                <p className={`text-2xl font-bold tracking-tight ${c.color}`}>{c.value}</p>
                <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-700 ease-out ${c.label === "平均ER" ? "bg-emerald-400" : c.label === "総再生数" ? "bg-blue-400" : c.label === "総いいね" ? "bg-rose-400" : c.label === "総コメント" ? "bg-amber-400" : "bg-foreground/30"}`} style={{ width: `${barPct}%` }} />
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
                          <p className="text-xs font-bold">{s.label === "平均ER" ? `${s.value}%` : fmt(s.value)}</p>
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

      {/* ── 2c. Daily Chart (enhanced) — レポートAのみ表示 ── */}
      {hasBaseline && <AllPlatformDailyChart dailyMetrics={dailyMetrics} />}

      {/* ── 2d. Best / Worst Videos ── */}
      {allVideos.length >= 3 && (
        <Card>
          <CardHeader className="py-2.5 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs flex items-center gap-1.5">
                <Trophy className="h-3.5 w-3.5 text-amber-500" />
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
                <p className="text-sm font-semibold text-emerald-600 mb-2 flex items-center gap-1.5"><TrendingUp className="h-4 w-4" /> TOP 3</p>
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
          <CardContent className="pt-0 px-3 pb-2 overflow-x-auto">
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
                      <TableCell className="text-xs tabular-nums py-1.5">{fmt(v.likeCount)}</TableCell>
                      <TableCell className="text-xs tabular-nums py-1.5">{fmt(v.commentCount)}</TableCell>
                      <TableCell className="text-xs tabular-nums py-1.5">{v.shareCount != null ? fmt(v.shareCount) : "-"}</TableCell>
                      <TableCell className="text-xs tabular-nums py-1.5">{v.saveCount != null ? fmt(v.saveCount) : "-"}</TableCell>
                      <TableCell className="text-xs font-medium tabular-nums py-1.5">{v.er}%</TableCell>
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
    ? (rank === 1 ? "bg-amber-400 text-amber-900" : rank === 2 ? "bg-slate-300 text-slate-700" : "bg-orange-300 text-orange-800")
    : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400";

  const highlightValue = sortKey === "views" ? fmt(video.viewCount) : sortKey === "likes" ? fmt(video.likeCount) : sortKey === "comments" ? fmt(video.commentCount) : `${video.er}%`;
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
              <span key={ti} className="text-[10px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-1.5 py-px dark:text-indigo-400 dark:bg-indigo-950/40 dark:border-indigo-800">
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
          <span className="flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" />{video.er}%</span>
        </div>
        {video.publishedAt && (
          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">
            <CalendarDays className="h-3 w-3" />{video.publishedAt.split("T")[0]}
          </p>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`text-base font-bold ${type === "best" ? "text-emerald-600" : "text-orange-500"}`}>{highlightValue}</p>
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
    const byDate = new Map<string, { date: string; views: number; likes: number; comments: number; shares: number; saves: number }>();
    for (const m of filtered) {
      const existing = byDate.get(m.dateKey) || { date: m.dateKey, views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
      existing.views += m.viewCount || 0;
      existing.likes += m.likeCount || 0;
      existing.comments += m.commentCount || 0;
      existing.shares += m.shareCount || 0;
      existing.saves += m.saveCount || 0;
      byDate.set(m.dateKey, existing);
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [dailyMetrics, chartFilter]);

  const dailyIncrementData = useMemo(() => {
    return cumulativeData.map((d, i) => {
      const prev = i > 0 ? cumulativeData[i - 1] : { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
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
            <CardTitle className="text-sm">メトリクス推移</CardTitle>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              <button
                className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  chartMode === "cumulative"
                    ? "bg-blue-500 text-white"
                    : "bg-white hover:bg-slate-50 text-slate-500"
                }`}
                onClick={() => setChartMode("cumulative")}
              >
                累計
              </button>
              <button
                className={`px-2 py-0.5 text-[10px] font-medium transition-colors border-l border-slate-200 ${
                  chartMode === "daily"
                    ? "bg-blue-500 text-white"
                    : "bg-white hover:bg-slate-50 text-slate-500"
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
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          {chartMode === "cumulative" ? (
            <ComposedChart data={chartData}>
              <defs>
                <linearGradient id="gradViews2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
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
              <Area yAxisId="left" type="monotone" dataKey="views" stroke="#3b82f6" fill="url(#gradViews2)" strokeWidth={2} name="views" />
              <Line yAxisId="right" type="monotone" dataKey="likes" stroke="#ef4444" strokeWidth={1.5} dot={false} name="likes" />
              <Line yAxisId="right" type="monotone" dataKey="comments" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="comments" />
              {hasShares && <Line yAxisId="right" type="monotone" dataKey="shares" stroke="#8b5cf6" strokeWidth={1.5} dot={false} name="shares" />}
              {hasSaves && <Line yAxisId="right" type="monotone" dataKey="saves" stroke="#10b981" strokeWidth={1.5} dot={false} name="saves" />}
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
              <Bar yAxisId="left" dataKey="views" fill="#3b82f6" fillOpacity={0.7} radius={[2, 2, 0, 0]} name="views" />
              <Line yAxisId="right" type="monotone" dataKey="likes" stroke="#ef4444" strokeWidth={1.5} dot={false} name="likes" />
              <Line yAxisId="right" type="monotone" dataKey="comments" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="comments" />
              {hasShares && <Line yAxisId="right" type="monotone" dataKey="shares" stroke="#8b5cf6" strokeWidth={1.5} dot={false} name="shares" />}
              {hasSaves && <Line yAxisId="right" type="monotone" dataKey="saves" stroke="#10b981" strokeWidth={1.5} dot={false} name="saves" />}
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

