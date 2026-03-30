import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ArrowLeft, Download, RefreshCw, TrendingUp, TrendingDown, Minus, Crown, Star, Brain, Search, Eye, BarChart3, Users, Hash, Share2, Globe, Lightbulb, ChevronUp, ChevronDown, Heart, MessageCircle, Bookmark, ExternalLink, CalendarDays, Pencil, Check, Loader2, Layers, Sparkles, Trophy, AlertTriangle, Play, ArrowUpDown, FileDown, Filter, Link2, Copy, CheckCheck } from "lucide-react";
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
  { id: "keyword", label: "順位・露出", icon: Search },
  { id: "sov", label: "シェア率", icon: BarChart3 },
  { id: "competitor", label: "競合", icon: Users },
  { id: "ripple", label: "波及", icon: Share2 },
  { id: "cross", label: "相関", icon: Globe },
  { id: "next", label: "Next", icon: Lightbulb },
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
    if (s.id === "next" && !aiReport) return false;
    return true;
  });
  const sectionNumber = (id: string) => visibleSections.findIndex(s => s.id === id) + 1;

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setLocation(`/campaigns/${campaignId}`)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{campaign?.name || "施策効果レポート"}</h1>
              <p className="text-sm text-muted-foreground">
                {report.baselineDate ? new Date(report.baselineDate).toLocaleDateString("ja-JP") : "?"} &rarr; {report.measurementDate ? new Date(report.measurementDate).toLocaleDateString("ja-JP") : "?"}
              </p>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
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

        {/* Sticky Navigation */}
        <nav className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b py-2 -mx-4 px-4 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {visibleSections.map((sec) => {
              const Icon = sec.icon;
              return (
                <button
                  key={sec.id}
                  onClick={() => scrollTo(sec.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
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
            />
          </div>
        )}

        {/* Section: TikTok Videos */}
        {hasVideoMetrics && (
          <div id="videos" ref={el => { sectionRefs.current["videos"] = el; }} className="scroll-mt-16 section-fade-in">
            <SectionHeader number={sectionNumber("videos")} title="TikTok 施策動画パフォーマンス" question="TikTok動画の状況は？" />
            <SummaryCards summary={summary} thirdPartyCount={thirdPartyInPeriodCount} hasBaseline={hasBaseline} ripple={ripple} sovReport={sovReport} />
            <VideoSection videos={videoMetrics!} videoScores={videoScores} hasBaseline={hasBaseline} dailyMetrics={dailyMetrics} keywords={campaign?.keywords ?? undefined} bigKeywords={campaign?.bigKeywords ?? undefined} />
          </div>
        )}

        {/* Section: Keyword (merged Position + BigKeyword) */}
        <div id="keyword" ref={el => { sectionRefs.current["keyword"] = el; }} className="scroll-mt-16 section-fade-in">
          <SectionHeader number={sectionNumber("keyword")} title="検索順位・露出" question="検索順位はどう変わった？" />
          <KeywordSection positions={positions} bigKeywordReport={hasBigKW ? bigKeywordReport! : undefined} hasBaseline={hasBaseline} keywords={campaign?.keywords} bigKeywords={campaign?.bigKeywords} campaign={campaign} />
        </div>

        {/* Section: SOV */}
        <div id="sov" ref={el => { sectionRefs.current["sov"] = el; }} className="scroll-mt-16 section-fade-in">
          <SectionHeader number={sectionNumber("sov")} title="検索上位シェア率" question="どのKWにどの動画が露出した？" />
          <SovSection sovReport={sovReport} positions={positions} hasBaseline={hasBaseline} campaign={campaign} campaignId={campaignId} onSlotUpdate={handleSlotUpdate} />
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
          <RippleSection ripple={ripple} campaign={campaign} />
        </div>

        {/* Section: Cross Platform */}
        {hasCrossPlatform && (
          <div id="cross" ref={el => { sectionRefs.current["cross"] = el; }} className="scroll-mt-16 section-fade-in">
            <SectionHeader number={sectionNumber("cross")} title="クロスプラットフォーム相関" question="検索トレンドとの関係は？" />
            <CrossPlatformSection data={crossPlatform} videoMetrics={videoMetrics} baselineDate={report.baselineDate} measurementDate={report.measurementDate} ripple={ripple} campaignStart={campaignStart} campaignEnd={campaignEnd} />
          </div>
        )}

        {/* Section: Next Actions */}
        {aiReport && (
          <div id="next" ref={el => { sectionRefs.current["next"] = el; }} className="scroll-mt-16 section-fade-in">
            <SectionHeader number={sectionNumber("next")} title="ネクストアクション" question="次に何をすべき？" />
            <NextActionsSection aiReport={aiReport} />
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
    const cards = [
      {
        title: "平均検索順位",
        before: fmtAvgRank(summary.total_keyword_count, summary.avg_rank_before),
        after: fmtAvgRank(summary.ranked_keyword_count, summary.avg_rank_after),
        change: summary.avg_rank_after != null && summary.avg_rank_after > 0 && summary.avg_rank_before === 0
          ? <span className="text-green-600 font-medium flex items-center gap-0.5"><TrendingUp className="h-3.5 w-3.5" />圏外→{summary.avg_rank_after}位</span>
          : summary.avg_rank_before != null && summary.avg_rank_before > 0 && summary.avg_rank_after != null && summary.avg_rank_after > 0
          ? <ChangeIndicator value={Number((summary.avg_rank_before - summary.avg_rank_after).toFixed(1))} suffix="位" />
          : null,
      },
      {
        title: "平均ER",
        before: `${summary.er_before}%`,
        after: `${summary.er_after}%`,
        change: <ChangeIndicator value={Number((summary.er_after - summary.er_before).toFixed(2))} suffix="pt" />,
      },
      {
        title: "上位表示率",
        before: `${summary.sov_before}%`,
        after: `${summary.sov_after}%`,
        change: <ChangeIndicator value={Number((parseFloat(summary.sov_after) - parseFloat(summary.sov_before)).toFixed(1))} suffix="pt" />,
      },
    ];
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardContent className="py-3 px-4 space-y-1">
              <p className="text-xs text-muted-foreground">{card.title}</p>
              <p className="text-base font-bold">
                <span className="text-slate-400">{card.before}</span>
                <span className="text-muted-foreground mx-1">&rarr;</span>
                <span className="text-blue-600">{card.after}</span>
              </p>
              {card.change && <div className="text-sm">{card.change}</div>}
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="py-3 px-4 space-y-1">
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
// KwVideoCard — KWカード（5件表示 + もっと見る）
// ============================

const INITIAL_SHOW = 5;

function KwVideoCard({ group, ownAccountIds, officialAccountIds, satelliteAccountIds }: { group: { keyword: string; kwType: string; rows: Array<{ keyword: string; kwType: string; username: string; description: string; rank: number | null; viewCount: number; videoId: string }> }; ownAccountIds: Set<string>; officialAccountIds: Set<string>; satelliteAccountIds: Set<string> }) {
  const [expanded, setExpanded] = useState(false);
  const rankedRows = group.rows.filter(r => r.rank != null && r.rank <= 30);
  const hasRanked = rankedRows.length > 0;
  const bestRank = hasRanked ? Math.min(...rankedRows.map(r => r.rank!)) : 999;
  const visibleRows = expanded ? rankedRows : rankedRows.slice(0, INITIAL_SHOW);
  const hiddenCount = rankedRows.length - INITIAL_SHOW;

  return (
    <div className={`rounded-lg border ${hasRanked ? "bg-white" : "bg-muted/30 border-dashed"}`}>
      {/* KWヘッダー */}
      <div className={`flex items-center gap-2 px-3 py-2 ${hasRanked ? "border-b bg-slate-50/80" : ""}`}>
        <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${group.kwType === "ビッグKW" ? "bg-green-400" : "bg-blue-400"}`} />
        <span className="font-medium text-sm">{group.keyword}</span>
        {group.kwType === "ビッグKW" && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-green-700 border-green-300 bg-green-50">ビッグKW</Badge>
        )}
        {hasRanked ? (
          <Badge className={`ml-auto text-[10px] px-1.5 py-0 h-5 ${
            bestRank <= 3 ? "bg-amber-500 hover:bg-amber-500" :
            bestRank <= 10 ? "bg-blue-500 hover:bg-blue-500" :
            "bg-slate-500 hover:bg-slate-500"
          }`}>
            最高 {bestRank}位 / {rankedRows.length}本ランクイン
          </Badge>
        ) : (
          <span className="ml-auto text-xs text-muted-foreground">圏外</span>
        )}
      </div>
      {/* 動画リスト */}
      {hasRanked && (
        <div className="divide-y">
          {visibleRows.map((r, ri) => {
            const videoUrl = r.username && r.videoId
              ? `https://www.tiktok.com/@${r.username}/video/${r.videoId}`
              : null;
            const Row = (
              <div className={`flex items-center gap-3 px-3 py-2 ${videoUrl ? "hover:bg-muted/40 transition-colors" : ""}`}>
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 font-bold text-sm ${
                  r.rank! <= 3 ? "bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-sm" :
                  r.rank! <= 10 ? "bg-gradient-to-br from-blue-400 to-blue-500 text-white shadow-sm" :
                  r.rank! <= 20 ? "bg-slate-100 text-slate-600" :
                  "bg-slate-50 text-slate-400"
                }`}>
                  {r.rank}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate flex items-center gap-1.5">
                    {r.username ? (() => {
                      const uLower = r.username.toLowerCase();
                      const isOfficial = officialAccountIds.has(uLower);
                      const isSatellite = !isOfficial && satelliteAccountIds.has(uLower);
                      const isCampaign = !isOfficial && !isSatellite && ownAccountIds.has(uLower);
                      return (
                        <>
                          {isOfficial && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0 border-blue-300 text-blue-700 bg-blue-50">公式</Badge>
                          )}
                          {isSatellite && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0 border-teal-300 text-teal-700 bg-teal-50">サテライト</Badge>
                          )}
                          {isCampaign && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0 border-purple-300 text-purple-700 bg-purple-50">施策</Badge>
                          )}
                          <span className={`font-medium ${isOfficial ? "text-blue-700" : isSatellite ? "text-teal-700" : isCampaign ? "text-purple-700" : "text-foreground"}`}>@{r.username}</span>
                          {r.description && <span className="text-muted-foreground ml-0.5 truncate">{r.description}</span>}
                        </>
                      );
                    })() : (
                      <span className="text-muted-foreground italic text-xs">該当動画なし</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-sm font-medium ${r.viewCount >= 1_000_000 ? "text-amber-600" : r.viewCount >= 100_000 ? "text-blue-600" : "text-muted-foreground"}`}>
                    {fmt(r.viewCount)}
                  </span>
                  {videoUrl
                    ? <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/40" />
                    : <Eye className="h-3 w-3 text-muted-foreground/50" />
                  }
                </div>
              </div>
            );
            return videoUrl ? (
              <a key={`${r.videoId || ri}`} href={videoUrl} target="_blank" rel="noopener noreferrer" className="block">{Row}</a>
            ) : (
              <div key={`${r.videoId || ri}`}>{Row}</div>
            );
          })}
          {hiddenCount > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              {expanded ? (
                <><ChevronUp className="h-3.5 w-3.5" />閉じる</>
              ) : (
                <><ChevronDown className="h-3.5 w-3.5" />もっと見る（{hiddenCount}件）</>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================
// KeywordSection (merged Position + BigKeyword)
// ============================

export function KeywordSection({ positions, bigKeywordReport, hasBaseline, keywords, bigKeywords, campaign }: {
  positions: any[];
  bigKeywordReport?: Array<{ keyword: string; before: { ownVideoCount: number; bestRank: number | null }; after: { ownVideoCount: number; bestRank: number | null }; ownVideos?: Array<{ videoId: string; username: string; description: string; rank: number; viewCount: number }> }>;
  hasBaseline: boolean;
  keywords?: string[];
  bigKeywords?: string[];
  campaign?: any;
}) {
  // Tab-based view state
  const [kwViewMode, setKwViewMode] = useState<"video" | "keyword">("video");
  const [videoViewExpanded, setVideoViewExpanded] = useState(false);
  const [kwCardExpanded, setKwCardExpanded] = useState<Set<string>>(new Set());
  const [closedKwCards, setClosedKwCards] = useState<Set<string>>(new Set());

  const VIDEO_VIEW_LIMIT = 5;
  const KW_VIDEO_LIMIT = 5;

  // 公式アカウント（ownAccountIds）
  const officialAccountIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of campaign?.ownAccountIds || []) ids.add(id.toLowerCase());
    return ids;
  }, [campaign]);
  // サテライトアカウント
  const satelliteAccountIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of (campaign as any)?.satelliteAccountIds || []) ids.add(id.toLowerCase());
    return ids;
  }, [campaign]);
  // 施策動画投稿者（ownVideoDataのauthor、公式アカウント除く）
  const campaignVideoAccountIds = useMemo(() => {
    const ids = new Set<string>();
    for (const v of campaign?.ownVideoData || []) {
      if (v.authorUniqueId) ids.add(v.authorUniqueId.toLowerCase());
    }
    return ids;
  }, [campaign]);

  // coverUrl map: videoId → coverUrl from ownVideoData
  const coverUrlMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of campaign?.ownVideoData || []) {
      if (v.videoId && v.coverUrl) map.set(v.videoId, v.coverUrl);
    }
    return map;
  }, [campaign]);

  // 全KW × 各動画の行を統合
  type VideoRow = { keyword: string; kwType: "施策KW" | "ビッグKW"; username: string; description: string; rank: number | null; viewCount: number; videoId: string };
  const allRows: VideoRow[] = [];

  for (const p of positions) {
    const videos = (p.videos as Array<{ video_id: string; username: string; description: string; search_rank: number; view_count: number }>) || [];
    if (videos.length > 0) {
      for (const v of videos) {
        allRows.push({ keyword: p.keyword, kwType: "施策KW", username: v.username, description: v.description, rank: v.search_rank, viewCount: v.view_count, videoId: v.video_id });
      }
    } else {
      allRows.push({ keyword: p.keyword, kwType: "施策KW", username: "", description: "", rank: p.after_rank, viewCount: 0, videoId: "" });
    }
  }
  for (const item of bigKeywordReport || []) {
    const videos = item.ownVideos || [];
    if (videos.length > 0) {
      for (const v of videos) {
        allRows.push({ keyword: item.keyword, kwType: "ビッグKW", username: v.username, description: v.description, rank: v.rank, viewCount: v.viewCount, videoId: v.videoId });
      }
    } else {
      allRows.push({ keyword: item.keyword, kwType: "ビッグKW", username: "", description: "", rank: item.after.bestRank, viewCount: 0, videoId: "" });
    }
  }

  // 全KW名を収集
  const allKwList: Array<{ keyword: string; kwType: string }> = [];
  const kwSeen = new Set<string>();
  for (const r of allRows) {
    if (!kwSeen.has(r.keyword)) { kwSeen.add(r.keyword); allKwList.push({ keyword: r.keyword, kwType: r.kwType }); }
  }

  // Rank tier helper (モック準拠: top=1-3, mid=4-10, low=11-20, bad=21+)
  const rankTier = (rank: number | null): "top" | "mid" | "low" | "bad" | null => {
    if (rank == null || rank > 30) return null;
    if (rank <= 3) return "top";
    if (rank <= 10) return "mid";
    if (rank <= 20) return "low";
    return "bad";
  };
  const chipCls = (t: "top" | "mid" | "low" | "bad" | null) => {
    switch (t) {
      case "top": return "bg-green-100 text-green-800";
      case "mid": return "bg-blue-100 text-blue-800";
      case "low": return "bg-yellow-100 text-yellow-800";
      case "bad": return "bg-red-100 text-red-800";
      default: return "bg-slate-50 text-slate-400";
    }
  };
  const pillCls = chipCls; // 同じ色体系
  const barFillCls = (t: "top" | "mid" | "low" | "bad" | null) => {
    switch (t) {
      case "top": return "bg-green-500";
      case "mid": return "bg-blue-500";
      case "low": return "bg-yellow-400";
      case "bad": return "bg-red-400";
      default: return "bg-slate-200";
    }
  };
  const bestCls = (rank: number) => {
    if (rank <= 1) return "text-yellow-600";
    if (rank <= 2) return "text-slate-500";
    if (rank <= 3) return "text-orange-600";
    return "text-slate-400";
  };

  // 動画別ビュー: ユニーク動画ごとにKWランクを集約
  const videoViewData = useMemo(() => {
    const vMap = new Map<string, { username: string; description: string; videoId: string; kwRanks: Record<string, number | null> }>();
    for (const r of allRows) {
      if (!r.username || !r.videoId) continue;
      const key = r.videoId || r.username;
      if (!vMap.has(key)) {
        vMap.set(key, { username: r.username, description: r.description, videoId: r.videoId, kwRanks: {} });
      }
      const entry = vMap.get(key)!;
      const existing = entry.kwRanks[r.keyword];
      if (existing == null || (r.rank != null && r.rank < existing)) {
        entry.kwRanks[r.keyword] = r.rank;
      }
    }
    return [...vMap.values()].sort((a, b) => {
      const bestA = Math.min(...Object.values(a.kwRanks).filter((v): v is number => v != null && v <= 30), 999);
      const bestB = Math.min(...Object.values(b.kwRanks).filter((v): v is number => v != null && v <= 30), 999);
      return bestA - bestB;
    });
  }, [allRows, allKwList]);

  const hasVideoData = allRows.some(r => r.username !== "");

  // フォールバック: videos無し（旧データ）→ X軸=KW, 最上位順位バー
  const chartFallback = !hasVideoData
    ? allRows.filter(r => r.rank != null && r.rank <= 30).map(r => ({
        label: r.keyword.length > 10 ? r.keyword.slice(0, 10) + "…" : r.keyword,
        順位: 31 - r.rank!,
        actualRank: r.rank!,
        kwType: r.kwType,
      }))
    : null;

  const yTicks = [0, 6, 11, 16, 21, 26, 30];
  const rankLabel = (v: number) => v <= 0 ? "圏外" : `${31 - v}位`;

  // テーブル表示: KWごとにグループ化
  const tableGroups: Array<{ keyword: string; kwType: string; rows: VideoRow[] }> = [];
  const seen = new Set<string>();
  for (const r of allRows) {
    if (!seen.has(r.keyword)) {
      seen.add(r.keyword);
      tableGroups.push({ keyword: r.keyword, kwType: r.kwType, rows: allRows.filter(ar => ar.keyword === r.keyword) });
    }
  }

  // KW別 前後比較 data
  const comparisonRows = useMemo(() => {
    const rows: Array<{ keyword: string; kwType: string; beforeRank: number | null; afterRank: number | null; rankChange: number | null }> = [];
    for (const p of positions) {
      rows.push({
        keyword: p.keyword,
        kwType: "施策KW",
        beforeRank: p.before_rank ?? null,
        afterRank: p.after_rank ?? null,
        rankChange: p.rank_change ?? (p.before_rank != null && p.after_rank != null ? p.before_rank - p.after_rank : null),
      });
    }
    for (const item of bigKeywordReport || []) {
      rows.push({
        keyword: item.keyword,
        kwType: "ビッグKW",
        beforeRank: item.before.bestRank,
        afterRank: item.after.bestRank,
        rankChange: item.before.bestRank != null && item.after.bestRank != null ? item.before.bestRank - item.after.bestRank : null,
      });
    }
    return rows;
  }, [positions, bigKeywordReport]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-base">KW別検索順位</CardTitle>
        </CardHeader>
        <CardContent className="pt-3 space-y-4">
          {/* タブバー（モック準拠） */}
          {hasVideoData && (
            <div className="flex border-b">
              <button
                onClick={() => setKwViewMode("video")}
                className={`px-5 py-3 text-sm font-semibold border-b-[3px] transition-colors ${
                  kwViewMode === "video"
                    ? "text-blue-600 border-blue-600"
                    : "text-slate-400 border-transparent hover:text-blue-600"
                }`}
              >
                動画から見る
                <span className={`ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full font-bold ${kwViewMode === "video" ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-500"}`}>
                  {videoViewData.length}本
                </span>
              </button>
              <button
                onClick={() => setKwViewMode("keyword")}
                className={`px-5 py-3 text-sm font-semibold border-b-[3px] transition-colors ${
                  kwViewMode === "keyword"
                    ? "text-blue-600 border-blue-600"
                    : "text-slate-400 border-transparent hover:text-blue-600"
                }`}
              >
                キーワードから見る
                <span className={`ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full font-bold ${kwViewMode === "keyword" ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-500"}`}>
                  {allKwList.length}個
                </span>
              </button>
            </div>
          )}

          {/* ===== 動画から見る（モック準拠: # / 動画 / 最高順位 / ハッシュタグ別順位） ===== */}
          {hasVideoData && kwViewMode === "video" && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b-2 border-slate-200">
                    <th className="py-2.5 pl-5 pr-2 text-left text-xs font-semibold text-slate-500 w-7"></th>
                    <th className="py-2.5 px-3 text-left text-xs font-semibold text-slate-500">動画</th>
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-slate-500 whitespace-nowrap">最高順位</th>
                    <th className="py-2.5 px-3 text-left text-xs font-semibold text-slate-500">ハッシュタグ別順位</th>
                  </tr>
                </thead>
                <tbody>
                  {(videoViewExpanded ? videoViewData : videoViewData.slice(0, VIDEO_VIEW_LIMIT)).map((v, idx) => {
                    const videoUrl = v.username && v.videoId
                      ? `https://www.tiktok.com/@${v.username}/video/${v.videoId}`
                      : null;
                    // 各KWのランクをチップに
                    const tags = allKwList
                      .map(kw => ({ keyword: kw.keyword, rank: v.kwRanks[kw.keyword] ?? null }))
                      .filter(t => t.rank != null && t.rank <= 30)
                      .sort((a, b) => a.rank! - b.rank!);
                    const best = tags.length > 0 ? tags[0].rank! : null;

                    return (
                      <tr key={v.videoId || v.username} className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                        {/* # */}
                        <td className="py-3 pl-5 pr-2 text-xs font-bold text-slate-300">{idx + 1}</td>
                        {/* 動画 */}
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2.5">
                            <VideoThumbnail url={coverUrlMap.get(v.videoId)} className="w-10 h-14 rounded" />
                            <div className="min-w-0">
                              {videoUrl ? (
                                <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-slate-800 hover:text-blue-600 transition-colors">
                                  @{v.username}
                                </a>
                              ) : (
                                <span className="text-sm font-semibold text-slate-800">@{v.username}</span>
                              )}
                              <p className="text-xs text-slate-400 truncate max-w-[160px]">{v.description?.slice(0, 25)}</p>
                            </div>
                          </div>
                        </td>
                        {/* 最高順位 */}
                        <td className="py-3 px-3 text-center">
                          {best != null ? (
                            <div>
                              <span className={`text-xl font-extrabold leading-none ${bestCls(best)}`}>{best}</span>
                              <div className="text-[10px] text-slate-400">位</div>
                            </div>
                          ) : (
                            <span className="text-sm text-slate-300">—</span>
                          )}
                        </td>
                        {/* ハッシュタグ別順位チップ */}
                        <td className="py-3 px-3">
                          <div className="flex flex-wrap gap-1.5">
                            {tags.map((t, ti) => {
                              const tier = rankTier(t.rank);
                              return (
                                <span
                                  key={t.keyword}
                                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs ${chipCls(tier)} ${ti === 0 ? "ring-2 ring-yellow-500/50" : ""}`}
                                >
                                  <span className="font-extrabold min-w-[18px] text-center">{t.rank}</span>
                                  <span className="font-medium opacity-80">{t.keyword.length > 10 ? t.keyword.slice(0, 10) + "…" : t.keyword}</span>
                                </span>
                              );
                            })}
                            {tags.length === 0 && <span className="text-xs text-slate-300">—</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {videoViewData.length > VIDEO_VIEW_LIMIT && (
                <button
                  onClick={() => setVideoViewExpanded(!videoViewExpanded)}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors mt-1 rounded-b-lg"
                >
                  {videoViewExpanded ? (
                    <><ChevronUp className="h-3.5 w-3.5" />閉じる</>
                  ) : (
                    <><ChevronDown className="h-3.5 w-3.5" />もっと見る（{videoViewData.length - VIDEO_VIEW_LIMIT}件）</>
                  )}
                </button>
              )}
            </div>
          )}

          {/* ===== キーワードから見る（モック準拠: アコーディオン + 平均順位） ===== */}
          {hasVideoData && kwViewMode === "keyword" && (
            <div className="space-y-3">
              {tableGroups.map((group) => {
                const rankedRows = group.rows.filter(r => r.rank != null && r.rank <= 30).sort((a, b) => a.rank! - b.rank!);
                const hasRanked = rankedRows.length > 0;
                const bestRank = hasRanked ? rankedRows[0].rank! : 999;
                const avgRank = hasRanked ? Math.round(rankedRows.reduce((s, r) => s + r.rank!, 0) / rankedRows.length * 10) / 10 : 0;
                const isOpen = !closedKwCards.has(group.keyword);
                const isExpanded = kwCardExpanded.has(group.keyword);
                const visibleRows = isExpanded ? rankedRows : rankedRows.slice(0, KW_VIDEO_LIMIT);
                const hiddenCount = rankedRows.length - KW_VIDEO_LIMIT;
                const bestTier = rankTier(bestRank);
                const tierTextCls = bestTier === "top" ? "text-green-600" : bestTier === "mid" ? "text-blue-600" : bestTier === "low" ? "text-yellow-600" : "text-red-500";

                return (
                  <div key={group.keyword} className={`rounded-xl border shadow-sm overflow-hidden ${hasRanked ? "bg-white" : "bg-muted/30 border-dashed"}`}>
                    {/* KWヘッダー */}
                    <button
                      onClick={() => {
                        const next = new Set(closedKwCards);
                        if (next.has(group.keyword)) next.delete(group.keyword);
                        else next.add(group.keyword);
                        setClosedKwCards(next);
                      }}
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="font-bold text-[15px] text-slate-800">{group.keyword}</span>
                        <span className="text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full font-semibold">{rankedRows.length}本</span>
                      </div>
                      <div className="flex items-center gap-3.5">
                        {hasRanked && (
                          <>
                            <span className="text-xs text-slate-400">平均 {avgRank}位</span>
                            <span className={`text-sm font-extrabold ${tierTextCls}`}>最高 {bestRank}位</span>
                          </>
                        )}
                        {!hasRanked && <span className="text-xs text-slate-400">圏外</span>}
                        <ChevronDown className={`h-4 w-4 text-slate-300 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </div>
                    </button>
                    {/* 動画リスト (accordion) */}
                    {hasRanked && isOpen && (
                      <div className="border-t border-slate-100">
                        {visibleRows.map((r, ri) => {
                          const tier = rankTier(r.rank);
                          const barWidth = r.rank != null && r.rank <= 30 ? Math.max(100 - (r.rank / 27) * 100, 4) : 0;
                          const videoUrl = r.username && r.videoId
                            ? `https://www.tiktok.com/@${r.username}/video/${r.videoId}`
                            : null;
                          return (
                            <div key={`${r.videoId || ri}`} className="grid grid-cols-[50px_1fr] items-center px-5 py-2.5 border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors">
                              {/* Rank pill */}
                              <span className={`inline-flex items-center justify-center w-[42px] h-7 rounded-lg text-sm font-extrabold ${pillCls(tier)}`}>
                                {r.rank != null ? `${r.rank}位` : "-"}
                              </span>
                              {/* Video info + bar */}
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <VideoThumbnail url={coverUrlMap.get(r.videoId)} className="w-8 h-11 rounded" />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      {videoUrl ? (
                                        <a href={videoUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-sm font-semibold text-slate-800 hover:text-blue-600 transition-colors truncate">
                                          @{r.username}
                                        </a>
                                      ) : (
                                        <span className="text-sm font-semibold text-slate-800 truncate">@{r.username}</span>
                                      )}
                                      <span className="text-xs text-slate-400 truncate">{r.description?.slice(0, 20)}</span>
                                    </div>
                                    {/* Bar indicator */}
                                    <div className="mt-1 h-1 rounded-full bg-slate-100 overflow-hidden">
                                      <div className={`h-full rounded-full transition-all duration-400 ${barFillCls(tier)}`} style={{ width: `${barWidth}%` }} />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {hiddenCount > 0 && (
                          <button
                            onClick={() => {
                              const next = new Set(kwCardExpanded);
                              if (next.has(group.keyword)) next.delete(group.keyword);
                              else next.add(group.keyword);
                              setKwCardExpanded(next);
                            }}
                            className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            {isExpanded ? (
                              <><ChevronUp className="h-3.5 w-3.5" />閉じる</>
                            ) : (
                              <><ChevronDown className="h-3.5 w-3.5" />もっと見る（{hiddenCount}件）</>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Legacy fallback chart for old data without video info */}
          {chartFallback && chartFallback.length > 0 && (
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={chartFallback} margin={{ top: 10, right: 10, left: 0, bottom: 60 }} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={<SlantedXTick />} interval={0} height={70} />
                <YAxis domain={[0, 30]} ticks={yTicks} tickFormatter={rankLabel} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <RechartsTooltip content={({ active, payload }: any) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0]?.payload;
                  return (
                    <div className="bg-white border rounded-lg shadow-lg p-2 text-xs">
                      <p className="font-medium mb-1">{d?.label}</p>
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: payload[0]?.color }} />
                        <span className="font-medium">{d?.actualRank}位</span>
                      </div>
                    </div>
                  );
                }} />
                <Bar dataKey="順位" radius={[4, 4, 0, 0]} barSize={28}>
                  {chartFallback.map((entry, idx) => (
                    <Cell key={idx} fill={entry.kwType === "ビッグKW" ? "#86efac" : "#93c5fd"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* KW別 前後比較 */}
      {hasBaseline && comparisonRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">KW別 前後比較</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {comparisonRows.filter(row => row.afterRank != null).map((row) => (
                <div key={row.keyword} className="flex items-center justify-between py-4 px-5">
                  <div className="flex items-center gap-2.5">
                    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${row.kwType === "ビッグKW" ? "bg-green-400" : "bg-blue-400"}`} />
                    <span className="font-medium text-sm">{row.keyword}</span>
                    {row.kwType === "ビッグKW" && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-green-700 border-green-300 bg-green-50">ビッグKW</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-400">{row.beforeRank != null ? `${row.beforeRank}位` : "圏外"}</span>
                    <span className="text-muted-foreground">&rarr;</span>
                    <span className="text-sm font-semibold text-blue-600">{row.afterRank != null ? `${row.afterRank}位` : "圏外"}</span>
                    <span className="w-16 text-right">
                      <ChangeIndicator value={row.rankChange} suffix="位" />
                    </span>
                  </div>
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
  const [sparkMetric, setSparkMetric] = useState<"views" | "likes" | "shares" | "saves">("views");
  const bestVideoId = videos.reduce((best, v) => {
    const views = v.after?.viewCount || 0;
    return views > (best.views || 0) ? { id: v.videoId, views } : best;
  }, { id: "", views: 0 }).id;

  // サマリー
  const totalViews = videos.reduce((s, v) => s + (v.after?.viewCount || 0), 0);
  const totalLikes = videos.reduce((s, v) => s + (v.after?.likeCount || 0), 0);
  const totalComments = videos.reduce((s, v) => s + (v.after?.commentCount || 0), 0);
  const totalShares = videos.reduce((s, v) => s + (v.after?.shareCount || 0), 0);
  const totalSaves = videos.reduce((s, v) => s + (v.after?.saveCount || 0), 0);
  const avgEr = totalViews > 0 ? Number(((totalLikes + totalComments + totalShares) / totalViews * 100).toFixed(2)) : 0;

  // ソート
  const sortedVideos = useMemo(() => {
    return [...videos].sort((a, b) => {
      const getVal = (v: any) => {
        switch (sortBy) {
          case "views": return v.after?.viewCount || 0;
          case "likes": return v.after?.likeCount || 0;
          case "comments": return v.after?.commentCount || 0;
          case "saves": return v.after?.saveCount || 0;
          case "shares": return v.after?.shareCount || 0;
          case "er": {
            const vw = v.after?.viewCount || 0;
            const lk = v.after?.likeCount || 0;
            const cm = v.after?.commentCount || 0;
            const sh = v.after?.shareCount || 0;
            return vw > 0 ? (lk + cm + sh) / vw * 100 : 0;
          }
          case "date": return v.postedAt ? new Date(v.postedAt).getTime() : 0;
          default: return 0;
        }
      };
      return getVal(b) - getVal(a);
    });
  }, [videos, sortBy]);

  // dailyMetrics累積チャート
  const hasDailyData = dailyMetrics && dailyMetrics.length > 0;

  return (
    <div className="space-y-4">
      {/* サマリー */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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

      {/* Report A: 累積パフォーマンス推移 */}
      {hasBaseline && videos.length > 0 && (() => {
        if (hasDailyData) {
          // 実測値ベースの累積チャート
          const dayMap = new Map<string, { views: number; likes: number; comments: number }>();
          for (const dm of dailyMetrics!) {
            const dateKey = dm.date?.split("T")[0] || dm.dateKey;
            if (!dateKey) continue;
            const entry = dayMap.get(dateKey) || { views: 0, likes: 0, comments: 0 };
            entry.views += dm.viewCount || 0;
            entry.likes += dm.likeCount || 0;
            entry.comments += dm.commentCount || 0;
            dayMap.set(dateKey, entry);
          }
          const sortedDays = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b));
          const lineData = sortedDays.map(([dateKey, d]) => ({
            name: `${new Date(dateKey).getMonth() + 1}/${new Date(dateKey).getDate()}`,
            再生数: d.views, いいね: d.likes, コメント: d.comments,
          }));
          return lineData.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">累積パフォーマンス推移（実測値）</CardTitle>
                <CardDescription className="text-xs">日次取得データ</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
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
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          ) : null;
        }

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
        <PostPerformanceGrid videos={sortedVideos} dailyMetrics={dailyMetrics} sparkMetric={sparkMetric} setSparkMetric={setSparkMetric} sortBy={sortBy} setSortBy={setSortBy} sortOptions={SORT_OPTIONS} videoScores={videoScores} bestVideoId={bestVideoId} kwSet={kwSet} bigKwSet={bigKwSet} />
      )}

    </div>
  );
}

// ============================
// 投稿パフォーマンス推移（スモールマルチプル）
// ============================

const SPARK_LABELS: Record<string, string> = { views: "再生数", likes: "いいね", shares: "シェア", saves: "保存" };
const SPARK_KEY: Record<string, string> = { views: "viewCount", likes: "likeCount", shares: "shareCount", saves: "saveCount" };

function PostPerformanceGrid({ videos, dailyMetrics, sparkMetric, setSparkMetric, sortBy, setSortBy, sortOptions, videoScores, bestVideoId, kwSet, bigKwSet }: {
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
}) {
  const scoreMap = new Map((videoScores || []).map((s: any) => [s.videoId, s]));
  const hasDailyData = dailyMetrics && dailyMetrics.length > 0;
  const metricKey = SPARK_KEY[sparkMetric];

  const sparks = useMemo(() => {
    // Group daily metrics by videoUrl
    const byVideo = new Map<string, Array<{ dateKey: string; value: number }>>();
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
        } else if (aVal > 0) {
          sorted = [{ dateKey: "start", value: 0 }, { dateKey: "now", value: aVal }];
        }
      }

      const latestVal = sorted.length > 0 ? sorted[sorted.length - 1].value : 0;
      return {
        videoUrl: url,
        caption: (v.description || "").slice(0, 18),
        username: username ? `@${username}` : "",
        coverUrl: v.coverUrl || "",
        latestVal,
        data: sorted,
      };
    }).filter(s => s.data.length >= 2);
  }, [videos, dailyMetrics, sparkMetric, metricKey, hasDailyData]);

  const SPARK_PAGE = 8;
  const [sparkDisplayCount, setSparkDisplayCount] = useState(SPARK_PAGE);

  if (sparks.length === 0) return null;

  const topVal = Math.max(...sparks.map(s => s.latestVal), 1);
  const visibleSparks = sparks.slice(0, sparkDisplayCount);
  const sparkRemaining = sparks.length - sparkDisplayCount;

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-semibold">投稿パフォーマンス推移</p>
            <p className="text-[11px] text-muted-foreground">{hasDailyData ? "各投稿の時系列パフォーマンス" : "各投稿の施策前後パフォーマンス"}</p>
          </div>
          <div className="flex gap-1 flex-wrap">
            {sortOptions.map(opt => (
              <button key={opt.key} onClick={() => { setSortBy(opt.key); const map: Record<string, "views" | "likes" | "shares" | "saves"> = { views: "views", likes: "likes", shares: "shares", saves: "saves" }; if (map[opt.key]) setSparkMetric(map[opt.key]); }}
                className={`px-2 py-1 rounded text-[11px] transition-colors ${sortBy === opt.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {visibleSparks.map((s, idx) => {
            const vals = s.data.map(d => d.value);
            const max = Math.max(...vals, 1);
            const min = Math.min(...vals, 0);
            const range = max - min || 1;
            const W = 200;
            const H = 50;
            const points = vals.map((v, i) => {
              const x = vals.length > 1 ? (i / (vals.length - 1)) * W : W / 2;
              const y = H - ((v - min) / range) * (H - 4) - 2;
              return `${x},${y}`;
            });
            const polyline = points.join(" ");
            const polygon = `0,${H} ${polyline} ${W},${H}`;
            const gradId = `spk-${idx}`;
            const intensity = topVal > 0 ? Math.min(s.latestVal / topVal, 1) : 0.5;
            const strokeColor = intensity > 0.5 ? "#6366f1" : intensity > 0.2 ? "#818cf8" : "#a5b4fc";

            return (
              <a key={s.videoUrl || idx} href={s.videoUrl} target="_blank" rel="noopener noreferrer" className="block rounded-lg border bg-background hover:bg-muted/30 transition-colors p-3 group">
                <div className="flex items-start gap-2.5 mb-2">
                  {s.coverUrl && <img src={s.coverUrl} alt="" className="w-12 h-16 rounded-md object-cover flex-shrink-0" loading="lazy" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium leading-tight line-clamp-2 group-hover:text-primary transition-colors">{s.caption || "動画"}</p>
                    {s.username && <p className="text-[10px] text-muted-foreground truncate mt-0.5">{s.username}</p>}
                  </div>
                </div>
                <p className="text-lg font-bold tabular-nums mb-1">{fmt(s.latestVal)}</p>
                <div className="h-[50px]">
                  <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full">
                    <defs>
                      <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={strokeColor} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <polygon fill={`url(#${gradId})`} points={polygon} />
                    <polyline fill="none" stroke={strokeColor} strokeWidth="2" points={polyline} />
                  </svg>
                </div>
              </a>
            );
          })}
        </div>
        {sparkRemaining > 0 && (
          <div className="flex justify-center pt-1">
            <Button variant="ghost" size="sm" onClick={() => setSparkDisplayCount(prev => prev + SPARK_PAGE)}
              className="text-xs text-muted-foreground hover:text-foreground">
              <ChevronDown className="h-3.5 w-3.5 mr-1" />もっと見る（残り{sparkRemaining}件）
            </Button>
          </div>
        )}

        {/* 動画詳細リスト */}
        <div className="space-y-2 pt-2 border-t">
          {visibleSparks.map((s, i) => {
            const v = videos[videos.findIndex(vid => (vid.videoUrl || "") === s.videoUrl)];
            if (!v) return null;
            const score = scoreMap.get(v.videoId);
            const isBest = v.videoId === bestVideoId;
            const views = v.after?.viewCount || 0;
            const likes = v.after?.likeCount || 0;
            const comments = v.after?.commentCount || 0;
            const shares = v.after?.shareCount || 0;
            const saves = v.after?.saveCount || 0;
            const erPercent = v.er != null ? v.er : (views > 0 ? Number(((likes + comments + shares) / views * 100).toFixed(2)) : 0);
            const hashtags: string[] = v.hashtags || [];
            const duration: number = v.duration || 0;
            const durationStr = duration > 0 ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}` : null;

            return (
              <div key={s.videoUrl || i} className={`flex gap-3 py-2 px-3 rounded-lg border ${isBest ? "border-yellow-300 bg-yellow-50/30" : "hover:bg-muted/30"}`}>
                <VideoThumbnail url={v.coverUrl} className="w-12 h-16" />
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    {isBest && <Crown className="h-3 w-3 text-yellow-500 flex-shrink-0" />}
                    <p className="text-xs font-medium truncate">{v.description?.slice(0, 60) || v.videoId}</p>
                    {score && (
                      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium border ${getScoreGradeColor(score.overallScore)}`}>
                        <Star className="h-2.5 w-2.5" />{score.overallScore}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{fmt(views)}</span>
                    <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{fmt(likes)}</span>
                    <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{fmt(comments)}</span>
                    <span className="flex items-center gap-1"><Bookmark className="h-3 w-3" />{fmt(saves)}</span>
                    <span className="flex items-center gap-1"><Share2 className="h-3 w-3" />{fmt(shares)}</span>
                    <span className="font-medium text-foreground">ER {erPercent}%</span>
                    {v.postedAt && <span>{new Date(v.postedAt).toLocaleDateString("ja-JP")}</span>}
                    {durationStr && <span>{durationStr}</span>}
                    {v.videoUrl && (
                      <a href={v.videoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                        <ExternalLink className="h-3 w-3" />TikTok
                      </a>
                    )}
                  </div>
                  {hashtags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {hashtags.slice(0, 8).map((tag, ti) => {
                        const lower = tag.toLowerCase();
                        const isBigKw = bigKwSet.has(lower);
                        const isKw = kwSet.has(lower);
                        const colorCls = isBigKw
                          ? "bg-green-50 text-green-700 border-green-200"
                          : isKw
                          ? "bg-blue-50 text-blue-600 border-blue-200"
                          : "bg-slate-50 text-slate-500 border-slate-200";
                        return (
                          <span key={ti} className={`inline-block px-1.5 py-0 rounded-full text-[10px] border ${colorCls}`}>
                            #{tag}
                          </span>
                        );
                      })}
                      {hashtags.length > 8 && <span className="text-[10px] text-muted-foreground">+{hashtags.length - 8}</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {sparkRemaining > 0 && (
            <div className="flex justify-center pt-2">
              <Button variant="ghost" size="sm" onClick={() => setSparkDisplayCount(prev => prev + SPARK_PAGE)}
                className="text-xs text-muted-foreground hover:text-foreground">
                <ChevronDown className="h-3.5 w-3.5 mr-1" />もっと見る（残り{sparkRemaining}件）
              </Button>
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

const GENRE_CONFIG: Record<string, { label: string; cls: string }> = {
  recommend: { label: "レコメンド", cls: "bg-emerald-600/80 text-white" },
  howto: { label: "How-to", cls: "bg-sky-600/80 text-white" },
  entertainment: { label: "エンタメ", cls: "bg-fuchsia-600/80 text-white" },
  negative: { label: "ネガティブ", cls: "bg-red-600/80 text-white" },
  other: { label: "その他", cls: "bg-slate-600/80 text-white" },
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

function SovSlotCell({ slot, keyword, phase, onSlotUpdate }: {
  slot: SlotData;
  maxViewCount: number;
  keyword: string;
  phase: "before" | "after";
  onSlotUpdate: (keyword: string, phase: "before" | "after", videoId: string, changes: any) => void;
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

  // 自社=大サイズ（9:16比維持）、その他=通常サイズ
  const cardW = isOwn ? "w-20" : "w-16";
  const thumbH = isOwn ? "h-[142px]" : "h-[114px]";

  return (
    <Popover open={editOpen} onOpenChange={setEditOpen}>
    <div className={`relative flex flex-col ${cardW} shrink-0 group/slot`}>
      {/* 鉛筆ボタン — ホバー時に表示 */}
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

      {/* カード本体 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={slot.video_url}
            target="_blank"
            rel="noopener noreferrer"
            className={`relative flex flex-col cursor-pointer transition-all duration-200 ${editOpen ? "" : "hover:scale-110 hover:z-10"}`}
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

              {/* ジャンルタグ */}
              <span className={`absolute bottom-0 left-0 right-0 text-center text-[7px] leading-tight py-0.5 z-10 ${genreInfo.cls}`}>
                {genreInfo.label}
              </span>
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

function SovOccupationMap({ keyword, data, hasBaseline, isBigKeyword = false, campaignId, onSlotUpdate }: {
  keyword: string;
  data: any;
  hasBaseline: boolean;
  isBigKeyword?: boolean;
  campaignId: number;
  onSlotUpdate: (keyword: string, phase: "before" | "after", videoId: string, changes: any) => void;
}) {
  const afterSlots: SlotData[] = data.after_slots || [];
  const beforeSlots: SlotData[] = data.before_slots || [];
  const afterSov = data.after || { own_count: 0, total_count: 0, percentage: "0" };

  const afterOwnCount = afterSlots.filter(s => s.owner === "own").length;
  const afterCompCount = afterSlots.filter(s => s.owner === "competitor").length;
  const beforeOwnCount = beforeSlots.filter(s => s.owner === "own").length;
  const ownChange = afterOwnCount - beforeOwnCount;

  // Max view count for opacity scaling (across both before/after)
  const allSlots = [...afterSlots, ...beforeSlots];
  const maxViewCount = allSlots.length > 0 ? Math.max(...allSlots.map(s => s.view_count)) : 1;

  // Pad slots to 10 for display
  const padSlots = (slots: SlotData[]) => {
    const result: (SlotData | null)[] = [];
    for (let i = 1; i <= 10; i++) {
      result.push(slots.find(s => s.rank === i) || null);
    }
    return result;
  };

  const renderSlotRow = (slots: SlotData[], label: string, phase: "before" | "after") => {
    const padded = padSlots(slots);
    const ownCount = slots.filter(s => s.owner === "own").length;

    const renderSlot = (slot: SlotData | null, idx: number) =>
      slot ? (
        <SovSlotCell key={slot.video_id} slot={slot} maxViewCount={maxViewCount} keyword={keyword} phase={phase} onSlotUpdate={onSlotUpdate} />
      ) : (
        <div key={`empty-${idx}`} className="relative flex flex-col w-16 shrink-0">
          <div className="h-[14px] shrink-0" />
          <div className="w-full h-[114px] rounded-md border border-dashed border-slate-200/50 flex items-center justify-center">
            <span className="text-[9px] text-slate-200">{idx + 1}</span>
          </div>
        </div>
      );

    return (
      <div className="flex items-center gap-1.5">
        {hasBaseline && (
          <span className="text-[9px] text-slate-400 w-8 shrink-0 text-right">{label}</span>
        )}
        <div className="flex items-end gap-1.5">
          {padded.map((slot, i) => renderSlot(slot, i))}
        </div>
        {/* 自社カウント — 占有率を直感的に見せるミニバー */}
        <div className="shrink-0 ml-3 flex flex-col items-center gap-0.5">
          <span className="text-lg font-bold text-blue-600">{ownCount}<span className="text-xs font-normal text-slate-400">/10</span></span>
          <div className="w-10 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${ownCount * 10}%` }} />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-lg border bg-white">
      {/* KWヘッダー — キーワード名 + 自社占有バー */}
      <div className={`flex items-center gap-3 px-4 py-2.5 border-b ${isBigKeyword ? "bg-gradient-to-r from-amber-50/80 to-slate-50/80" : "bg-slate-50/80"}`}>
        <Search className={`h-3.5 w-3.5 ${isBigKeyword ? "text-amber-600" : "text-slate-400"}`} />
        <span className="font-semibold text-sm">{keyword}</span>
        {isBigKeyword && <Badge className="text-[9px] px-1 py-0 h-4 bg-amber-100 text-amber-700 border-amber-300">ビッグKW</Badge>}
        <div className="ml-auto flex items-center gap-2.5">
          {/* ミニ占有バー + 数値 */}
          <div className="flex items-center gap-1.5">
            <div className="w-16 h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${(afterOwnCount / 10) * 100}%` }} />
            </div>
            <span className="text-sm font-bold text-blue-600">{afterOwnCount}<span className="text-xs font-normal text-slate-400">/10</span></span>
          </div>
          {hasBaseline && ownChange !== 0 && (
            <ChangeIndicator value={ownChange} suffix="本" />
          )}
        </div>
      </div>
      {/* Slot rows */}
      <div className="px-3 py-2.5 space-y-2">
        {afterSlots.length > 0 ? (
          <>
            {hasBaseline && beforeSlots.length > 0 && renderSlotRow(beforeSlots, "前", "before")}
            {renderSlotRow(afterSlots, hasBaseline ? "後" : "", "after")}
          </>
        ) : (
          <div className="text-xs text-muted-foreground italic py-1">スロットデータなし</div>
        )}
      </div>
    </div>
  );
}

export function SovSection({ sovReport, positions, hasBaseline, campaign, campaignId, onSlotUpdate }: {
  sovReport: Record<string, any>;
  positions: any[];
  hasBaseline: boolean;
  campaign?: any;
  campaignId: number;
  onSlotUpdate: (keyword: string, phase: "before" | "after", videoId: string, changes: any) => void;
}) {
  const sovEntries = Object.entries(sovReport);

  // Aggregate stats (from the existing sov percentage data)
  const chartData = sovEntries
    .map(([kw, data]) => ({
      keyword: kw,
      own: data.after?.own_count || 0,
      total: data.after?.total_count || 0,
      pct: parseFloat(data.after?.percentage) || 0,
      afterSlots: (data.after_slots || []) as SlotData[],
    }))
    .filter(d => d.total > 0);

  const totalOwn = chartData.reduce((s, d) => s + d.own, 0);
  const totalScanned = chartData.reduce((s, d) => s + d.total, 0);
  const avgPct = totalScanned > 0 ? Math.round((totalOwn / totalScanned) * 100 * 10) / 10 : 0;

  // Count slots by owner type across all KWs (top 10 only)
  const allAfterSlots = chartData.flatMap(d => d.afterSlots);
  const ownInTop10 = allAfterSlots.filter(s => s.owner === "own").length;
  const compInTop10 = allAfterSlots.filter(s => s.owner === "competitor").length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">検索結果占有マップ</CardTitle>
          <CardDescription className="text-xs">各KWの検索Top10をサムネイルで可視化。タグ=ジャンル</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* === サマリー — M3 segmented bar + chips === */}
          {chartData.length > 0 && (() => {
            const officialCount = allAfterSlots.filter(s => s.owner === "own" && s.owner_detail === "official").length;
            const satelliteCount = allAfterSlots.filter(s => s.owner === "own" && s.owner_detail === "satellite").length;
            const campaignCount = allAfterSlots.filter(s => s.owner === "own" && s.owner_detail === "campaign").length;
            const othersCount = allAfterSlots.filter(s => s.owner !== "own").length;
            const totalSlots = officialCount + satelliteCount + campaignCount + othersCount;
            const officialPct = totalSlots > 0 ? (officialCount / totalSlots) * 100 : 0;
            const satellitePct = totalSlots > 0 ? (satelliteCount / totalSlots) * 100 : 0;
            const campaignPct = totalSlots > 0 ? (campaignCount / totalSlots) * 100 : 0;
            const othersPct = totalSlots > 0 ? (othersCount / totalSlots) * 100 : 0;
            return (
              <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50/80 to-white p-5 space-y-4">
                {/* Hero metric row */}
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-500 tracking-wide uppercase mb-1">自社シェア率</p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-[42px] leading-none font-extrabold tracking-tight text-blue-600">{avgPct}</span>
                      <span className="text-lg font-bold text-blue-400">%</span>
                    </div>
                  </div>
                  <div className="text-right pb-1">
                    <p className="text-sm text-slate-600">
                      全{chartData.length}キーワードの上位10件中
                    </p>
                    <p className="text-xs text-slate-400">
                      計<span className="font-bold text-slate-600 mx-0.5">{totalOwn}</span>件 / {totalScanned}件が自社動画
                    </p>
                  </div>
                </div>

                {/* M3 Segmented stacked bar */}
                <div className="space-y-2">
                  <div
                    className="flex h-3 rounded-full overflow-hidden bg-slate-100"
                    role="img"
                    aria-label={`自社シェア率: 公式${officialCount}件、サテライト${satelliteCount}件、施策${campaignCount}件、その他${othersCount}件`}
                    style={{ animation: 'sov-bar-fill 700ms var(--md-ease-emphasized-decel) both' }}
                  >
                    {officialCount > 0 && (
                      <div
                        className="h-full bg-blue-500 transition-all duration-500"
                        style={{ width: `${officialPct}%`, minWidth: officialCount > 0 ? '4px' : 0 }}
                      />
                    )}
                    {satelliteCount > 0 && (
                      <div
                        className="h-full bg-teal-500 transition-all duration-500"
                        style={{ width: `${satellitePct}%`, minWidth: satelliteCount > 0 ? '4px' : 0 }}
                      />
                    )}
                    {campaignCount > 0 && (
                      <div
                        className="h-full bg-purple-500 transition-all duration-500"
                        style={{ width: `${campaignPct}%`, minWidth: campaignCount > 0 ? '4px' : 0 }}
                      />
                    )}
                    {/* その他 is the remaining track background */}
                  </div>

                  {/* Category chips */}
                  <div className="flex items-center gap-3">
                    {[
                      { label: '公式', count: officialCount, color: 'bg-blue-500', textColor: 'text-blue-700', bgChip: 'bg-blue-50' },
                      { label: 'サテライト', count: satelliteCount, color: 'bg-teal-500', textColor: 'text-teal-700', bgChip: 'bg-teal-50' },
                      { label: '施策', count: campaignCount, color: 'bg-purple-500', textColor: 'text-purple-700', bgChip: 'bg-purple-50' },
                      { label: 'その他', count: othersCount, color: 'bg-slate-300', textColor: 'text-slate-600', bgChip: 'bg-slate-50' },
                    ].map(cat => (
                      <div
                        key={cat.label}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cat.bgChip} ${cat.count === 0 ? 'opacity-40' : ''}`}
                      >
                        <span className={`w-2 h-2 rounded-full ${cat.color} shrink-0`} />
                        <span className={cat.textColor}>{cat.label}</span>
                        <span className={`font-bold ${cat.textColor} tabular-nums`}>{cat.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ジャンル + TikTokラベル凡例 */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
            {Object.entries(GENRE_CONFIG).map(([key, { label, cls }]) => (
              <span key={key} className={`px-1 rounded text-[9px] ${cls}`}>{label}</span>
            ))}
            <span className="text-slate-300">|</span>
            {Object.entries(TIKTOK_LABEL_CONFIG).map(([key, { text, dot }]) => (
              <span key={key} className="flex items-center gap-0.5"><span className={`w-2 h-2 rounded-full ${dot}`} />{text}</span>
            ))}
          </div>

          {/* === Per-keyword Slot Maps === */}
          <div className="space-y-3">
            {sovEntries.map(([kw, data]) => (
              <SovOccupationMap key={kw} keyword={kw} data={data} hasBaseline={hasBaseline} isBigKeyword={!!data._isBigKeyword} campaignId={campaignId} onSlotUpdate={onSlotUpdate} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// (BigKeywordSection merged into KeywordSection above)

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
// Section 7: Ripple
// ============================

export function RippleSection({ ripple, campaign }: { ripple: Record<string, any>; campaign?: any }) {
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

  return (
    <div className="space-y-4">
      {/* Big number cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-xs text-muted-foreground">第三者投稿</p>
            <p className="text-2xl font-bold mt-1">
              <span className="text-blue-600 font-semibold">{totalThirdParty}本</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-xs text-muted-foreground">総再生数</p>
            <p className="text-2xl font-bold mt-1">
              <span className="text-blue-600 font-semibold">{fmt(totalAfterViews)}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Per-tag table (compact) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">ハッシュタグ別内訳</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3">タグ</th>
                  <th className="py-1.5 px-2 text-right">投稿数</th>
                  <th className="py-1.5 px-2 text-right">総再生数</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(([tag, data]) => (
                  <tr key={tag} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 font-medium">{tag}</td>
                    <td className="py-1.5 px-2 text-right">{data.after_posts || 0}</td>
                    <td className="py-1.5 px-2 text-right">{fmt(data.after_total_views || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Top third-party videos (all tags combined) */}
      {(() => {
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
          })
          .slice(0, 5);
        return allVideos.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">注目の第三者投稿（再生数上位）</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {allVideos.map((v: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-1.5 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <a href={v.video_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium shrink-0">
                        @{v.creator}
                      </a>
                      <span className="text-xs text-muted-foreground truncate">{v.description?.slice(0, 40)}</span>
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground shrink-0 ml-2">
                      <span>{fmt(v.views)} 再生</span>
                      <span>{fmt(v.likes)} いいね</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })()}
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

    const allDates = [...new Set([...trendMap.keys(), ...videoMap.keys(), ...tpDayViews.keys()])].sort();
    let cumulativeViews = 0;
    return allDates.map((date: string) => {
      const dayViews = videoMap.get(date)?.totalViews ?? 0;
      cumulativeViews += dayViews;
      return {
        date: date.slice(5),
        fullDate: date,
        trends: trendMap.get(date) ?? null,
        views: cumulativeViews > 0 ? cumulativeViews : null,
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Google Trends x TikTok
            {data.correlation != null && (
              <span className={`ml-2 text-sm font-normal ${
                Math.abs(data.correlation) >= 0.7 ? "text-green-600" :
                Math.abs(data.correlation) >= 0.4 ? "text-yellow-600" : "text-muted-foreground"
              }`}>
                相関: {data.correlation.toFixed(3)}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={filteredDailyChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis label={{ value: "Trends", angle: -90, position: "insideLeft", style: { fontSize: 11 } }} />
              <RechartsTooltip formatter={(value: any, name: string) => {
                if (value === null || value === undefined) return ["—", name];
                if (name === "Google Trends") return [`${value} / 100`, name];
                return [String(value), name];
              }} />
              <Legend />
              {highlightRange && (
                <ReferenceArea x1={highlightRange.start} x2={highlightRange.end} fill="#10b981" fillOpacity={0.08} label={{ value: "施策期間", fill: "#10b981", fontSize: 10, position: "insideTopLeft" }} />
              )}
              <Line type="monotone" dataKey="trends" name="Google Trends" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
              {Array.from(markerDates).map((date: string) => (
                <ReferenceLine key={date} x={date.slice(5)} stroke="#10b981" strokeDasharray="3 3" label={{ value: "投稿", fill: "#10b981", fontSize: 10 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {monthlyVolumeData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4" />
              Google 月間検索ボリューム推移
            </CardTitle>
            <CardDescription>Google Ads Keyword Planner — 施策前後の検索数変化</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyVolumeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmt(v)} />
                <RechartsTooltip formatter={(value: any) => [Number(value).toLocaleString(), "検索数"]} />
                <Legend />
                {highlightMonths && (
                  <ReferenceArea x1={highlightMonths.start} x2={highlightMonths.end} fill="#10b981" fillOpacity={0.08} label={{ value: "施策期間", fill: "#10b981", fontSize: 10, position: "insideTopLeft" }} />
                )}
                {keywordVolumes!.map((kw: any, i: number) => (
                  <Line key={kw.keyword} type="monotone" dataKey={kw.keyword} stroke={VOLUME_COLORS[i % VOLUME_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}


// ============================
// Section 9: Next Actions
// ============================

export function NextActionsSection({ aiReport }: { aiReport: any }) {
  return (
    <div className="space-y-3">
      {aiReport.strengths?.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <h3 className="text-sm font-semibold text-green-600 mb-2">強み</h3>
            <ul className="space-y-2">
              {aiReport.strengths.map((s: string, i: number) => (
                <li key={i} className="text-sm border-l-4 border-green-500 pl-3 py-1">{s}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {aiReport.weaknesses?.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <h3 className="text-sm font-semibold text-red-500 mb-2">弱み</h3>
            <ul className="space-y-2">
              {aiReport.weaknesses.map((s: string, i: number) => (
                <li key={i} className="text-sm border-l-4 border-red-500 pl-3 py-1">{s}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {aiReport.actionProposals?.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <h3 className="text-sm font-semibold text-blue-600 mb-2">アクション提案</h3>
            <ul className="space-y-2">
              {aiReport.actionProposals.map((s: string, i: number) => (
                <li key={i} className="text-sm border-l-4 border-blue-500 pl-3 py-1">
                  <span className="font-medium text-blue-600 mr-1">{i + 1}.</span>{s}
                </li>
              ))}
            </ul>
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
};

const PLATFORM_COLORS = {
  tiktok: { accent: "#00f2ea", bg: "bg-cyan-50 dark:bg-cyan-950/30", border: "border-l-cyan-400", dot: "bg-cyan-400", text: "text-cyan-600 dark:text-cyan-400" },
  youtube: { accent: "#dc2626", bg: "bg-red-50 dark:bg-red-950/30", border: "border-l-red-500", dot: "bg-red-500", text: "text-red-600 dark:text-red-400" },
  instagram: { accent: "#e1306c", bg: "bg-pink-50 dark:bg-pink-950/30", border: "border-l-pink-500", dot: "bg-pink-500", text: "text-pink-600 dark:text-pink-400" },
} as const;

const PLATFORM_ICONS: Record<string, string> = { tiktok: "TT", youtube: "YT", instagram: "IG" };

export function PlatformSummarySection({ tiktokVideos, platformSummary, dailyMetrics }: {
  tiktokVideos: any[];
  platformSummary: {
    youtube?: { totalVideos: number; totalViews: number; totalLikes: number; avgER: number; videos: any[] };
    instagram?: { totalVideos: number; totalViews: number; totalLikes: number; avgER: number; videos: any[] };
  };
  dailyMetrics: any[];
}) {
  const [bestWorstSort, setBestWorstSort] = useState<"views" | "likes" | "er" | "comments">("views");
  const [tablePlatformFilter, setTablePlatformFilter] = useState<"all" | "tiktok" | "youtube" | "instagram">("all");
  const [tableSortKey, setTableSortKey] = useState<"views" | "likes" | "comments" | "shares" | "saves" | "er" | "date">("views");
  const [tableSortDir, setTableSortDir] = useState<"asc" | "desc">("desc");
  const TABLE_PAGE_SIZE = 8;
  const [tableDisplayCount, setTableDisplayCount] = useState(TABLE_PAGE_SIZE);

  // === Aggregate metrics ===
  const tiktokViews = tiktokVideos.reduce((s, v) => s + ((v.after?.viewCount) || 0), 0);
  const tiktokLikes = tiktokVideos.reduce((s, v) => s + ((v.after?.likeCount) || 0), 0);
  const tiktokComments = tiktokVideos.reduce((s, v) => s + ((v.after?.commentCount) || 0), 0);
  const tiktokShares = tiktokVideos.reduce((s, v) => s + ((v.after?.shareCount) || 0), 0);
  const tiktokSaves = tiktokVideos.reduce((s, v) => s + ((v.after?.saveCount) || 0), 0);

  const ytData = platformSummary.youtube;
  const igData = platformSummary.instagram;
  const ytComments = ytData?.videos?.reduce((s: number, v: any) => s + (v.commentCount || 0), 0) || 0;
  const igComments = igData?.videos?.reduce((s: number, v: any) => s + (v.commentCount || 0), 0) || 0;

  const totalVideos = tiktokVideos.length + (ytData?.totalVideos || 0) + (igData?.totalVideos || 0);
  const totalViews = tiktokViews + (ytData?.totalViews || 0) + (igData?.totalViews || 0);
  const totalLikes = tiktokLikes + (ytData?.totalLikes || 0) + (igData?.totalLikes || 0);
  const totalComments = tiktokComments + ytComments + igComments;
  const totalEngagement = totalLikes + totalComments;
  const avgER = totalViews > 0 ? Number((totalEngagement / totalViews * 100).toFixed(2)) : 0;

  // === Unified video list (all platforms merged) ===
  const allVideos: UnifiedVideo[] = useMemo(() => {
    const vids: UnifiedVideo[] = [];

    // TikTok
    for (const v of tiktokVideos) {
      const views = v.after?.viewCount || 0;
      const likes = v.after?.likeCount || 0;
      const comments = v.after?.commentCount || 0;
      const shares = v.after?.shareCount || 0;
      const saves = v.after?.saveCount || 0;
      const eng = likes + comments + shares + saves;
      vids.push({
        videoUrl: v.videoUrl || "", channelId: v.videoUrl?.match(/@([^/]+)/)?.[1] || "",
        caption: v.description || "", viewCount: views, likeCount: likes, commentCount: comments,
        shareCount: shares, saveCount: saves, coverUrl: v.coverUrl || "",
        platform: "tiktok", publishedAt: v.postedAt || "",
        er: views > 0 ? Number(((eng / views) * 100).toFixed(2)) : 0,
      });
    }

    // YouTube
    for (const v of (ytData?.videos || [])) {
      const views = v.viewCount || 0;
      const likes = v.likeCount || 0;
      const comments = v.commentCount || 0;
      const eng = likes + comments;
      vids.push({
        videoUrl: v.videoUrl || "", channelId: v.channelTitle || "",
        caption: v.title || "", viewCount: views, likeCount: likes, commentCount: comments,
        shareCount: null, saveCount: null, coverUrl: v.coverUrl || "",
        platform: "youtube", publishedAt: v.publishedAt || "",
        er: views > 0 ? Number(((eng / views) * 100).toFixed(2)) : 0,
      });
    }

    // Instagram
    for (const v of (igData?.videos || [])) {
      const views = v.viewCount || 0;
      const likes = v.likeCount || 0;
      const comments = v.commentCount || 0;
      const eng = likes + comments;
      vids.push({
        videoUrl: v.videoUrl || "", channelId: v.ownerUsername ? `@${v.ownerUsername}` : "",
        caption: v.caption || "", viewCount: views, likeCount: likes, commentCount: comments,
        shareCount: null, saveCount: null, coverUrl: v.coverUrl || "",
        platform: "instagram", publishedAt: v.publishedAt || "",
        er: views > 0 ? Number(((eng / views) * 100).toFixed(2)) : 0,
      });
    }
    return vids;
  }, [tiktokVideos, ytData, igData]);

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
    const header = ["#", "動画", "媒体", "再生数", "いいね", "コメント", "シェア", "保存", "ER(%)", "投稿日"];
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
      cards.push({
        key: "youtube", name: "YouTube", videoCount: ytData.totalVideos,
        stats: [
          { label: "再生数", value: ytData.totalViews, icon: Eye },
          { label: "いいね", value: ytData.totalLikes, icon: Heart },
          { label: "コメント", value: ytComments, icon: MessageCircle },
          { label: "平均ER", value: ytData.avgER, icon: TrendingUp },
        ],
      });
    }

    if (igData) {
      cards.push({
        key: "instagram", name: "Instagram", videoCount: igData.totalVideos,
        stats: [
          { label: "再生数", value: igData.totalViews, icon: Eye },
          { label: "いいね", value: igData.totalLikes, icon: Heart },
          { label: "コメント", value: igComments, icon: MessageCircle },
          { label: "平均ER", value: igData.avgER, icon: TrendingUp },
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
  }, [ytData, igData, tiktokVideos, tiktokViews, tiktokLikes, tiktokComments, tiktokShares, tiktokSaves, ytComments, igComments]);

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
              <Card key={p.key} className={`border-l-4 ${colors.border} ${colors.bg} overflow-hidden`}>
                <CardContent className="py-4 px-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-black text-white ${p.key === "youtube" ? "bg-red-600" : p.key === "instagram" ? "bg-gradient-to-br from-purple-600 to-pink-500" : "bg-slate-900"}`}>
                        {PLATFORM_ICONS[p.key]}
                      </span>
                      <span className="font-semibold text-sm">{p.name}</span>
                    </div>
                    <Badge variant="secondary" className="text-[10px] px-1.5">{p.videoCount}本</Badge>
                  </div>
                  <div className={`grid ${p.stats.length <= 4 ? "grid-cols-2" : "grid-cols-3"} gap-2`}>
                    {p.stats.map(s => {
                      const SIcon = s.icon;
                      return (
                        <div key={s.label} className="bg-background/60 rounded-lg px-2.5 py-2">
                          <div className="flex items-center gap-1 mb-0.5">
                            <SIcon className="h-3 w-3 text-muted-foreground" />
                            <span className="text-[10px] text-muted-foreground">{s.label}</span>
                          </div>
                          <p className="text-sm font-bold">{s.label === "平均ER" ? `${s.value}%` : fmt(s.value)}</p>
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

      {/* ── 2c. Daily Chart (enhanced) ── */}
      <AllPlatformDailyChart dailyMetrics={dailyMetrics} />

      {/* ── 2d. Best / Worst Videos ── */}
      {allVideos.length >= 3 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" />
                Best / Worst パフォーマンス
              </CardTitle>
              <div className="flex gap-1">
                {([["views", "再生数"], ["likes", "いいね"], ["er", "ER"], ["comments", "コメント"]] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setBestWorstSort(val)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${bestWorstSort === val ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Best 3 */}
              <div>
                <p className="text-xs font-semibold text-emerald-600 mb-2 flex items-center gap-1"><TrendingUp className="h-3 w-3" /> TOP 3</p>
                <div className="space-y-2">
                  {bestVideos.map((v, i) => (
                    <BestWorstVideoCard key={`best-${i}`} video={v} rank={i + 1} type="best" sortKey={bestWorstSort} />
                  ))}
                </div>
              </div>
              {/* Worst 3 */}
              <div>
                <p className="text-xs font-semibold text-orange-500 mb-2 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> 改善候補 3</p>
                <div className="space-y-2">
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
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                動画データ一覧
                <Badge variant="secondary" className="text-[10px] ml-1">{tableVideos.length}件</Badge>
              </CardTitle>
              <div className="flex items-center gap-2">
                {/* Platform filter chips */}
                <div className="flex gap-1">
                  {(["all", "tiktok", "youtube", "instagram"] as const).map(pf => {
                    const active = tablePlatformFilter === pf;
                    const count = pf === "all" ? allVideos.length : allVideos.filter(v => v.platform === pf).length;
                    if (pf !== "all" && count === 0) return null;
                    return (
                      <button
                        key={pf}
                        onClick={() => { setTablePlatformFilter(pf); setTableDisplayCount(TABLE_PAGE_SIZE); }}
                        className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                      >
                        {pf === "all" ? "全て" : pf === "tiktok" ? "TikTok" : pf === "youtube" ? "YouTube" : "Instagram"}
                        <span className="ml-1 opacity-70">{count}</span>
                      </button>
                    );
                  })}
                </div>
                <button onClick={handleTableCsvExport} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium bg-muted hover:bg-muted/80 transition-colors text-muted-foreground">
                  <FileDown className="h-3 w-3" /> CSV
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 text-[10px]">#</TableHead>
                  <TableHead className="text-[10px] min-w-[180px]">動画</TableHead>
                  <TableHead className="text-[10px] w-14">媒体</TableHead>
                  <TableHead className="text-[10px] cursor-pointer hover:text-foreground" onClick={() => toggleSort("views")}>
                    <span className="flex items-center gap-0.5">再生数{tableSortKey === "views" && <ArrowUpDown className="h-3 w-3" />}</span>
                  </TableHead>
                  <TableHead className="text-[10px] cursor-pointer hover:text-foreground" onClick={() => toggleSort("likes")}>
                    <span className="flex items-center gap-0.5">いいね{tableSortKey === "likes" && <ArrowUpDown className="h-3 w-3" />}</span>
                  </TableHead>
                  <TableHead className="text-[10px] cursor-pointer hover:text-foreground" onClick={() => toggleSort("comments")}>
                    <span className="flex items-center gap-0.5">コメント{tableSortKey === "comments" && <ArrowUpDown className="h-3 w-3" />}</span>
                  </TableHead>
                  <TableHead className="text-[10px] cursor-pointer hover:text-foreground" onClick={() => toggleSort("shares")}>
                    <span className="flex items-center gap-0.5">シェア{tableSortKey === "shares" && <ArrowUpDown className="h-3 w-3" />}</span>
                  </TableHead>
                  <TableHead className="text-[10px] cursor-pointer hover:text-foreground" onClick={() => toggleSort("saves")}>
                    <span className="flex items-center gap-0.5">保存{tableSortKey === "saves" && <ArrowUpDown className="h-3 w-3" />}</span>
                  </TableHead>
                  <TableHead className="text-[10px] cursor-pointer hover:text-foreground" onClick={() => toggleSort("er")}>
                    <span className="flex items-center gap-0.5">ER{tableSortKey === "er" && <ArrowUpDown className="h-3 w-3" />}</span>
                  </TableHead>
                  <TableHead className="text-[10px] cursor-pointer hover:text-foreground" onClick={() => toggleSort("date")}>
                    <span className="flex items-center gap-0.5">投稿日{tableSortKey === "date" && <ArrowUpDown className="h-3 w-3" />}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableVideos.slice(0, tableDisplayCount).map((v, i) => {
                  const colors = PLATFORM_COLORS[v.platform];
                  return (
                    <TableRow key={`${v.videoUrl}-${i}`} className="group">
                      <TableCell className="text-[11px] text-muted-foreground font-mono">{i + 1}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-0">
                          {v.coverUrl && <img src={v.coverUrl} alt="" className="w-8 h-11 rounded object-cover flex-shrink-0" loading="lazy" />}
                          <div className="min-w-0">
                            <a href={v.videoUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium hover:underline text-primary truncate block max-w-[200px]">
                              {(v.caption || "動画").slice(0, 30)}{(v.caption || "").length > 30 ? "…" : ""}
                            </a>
                            {v.channelId && <p className="text-[9px] text-muted-foreground truncate">{v.channelId.startsWith("@") ? v.channelId : `@${v.channelId}`}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${colors.text}`}>
                          <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                          {PLATFORM_ICONS[v.platform]}
                        </span>
                      </TableCell>
                      <TableCell className="text-[11px] font-medium tabular-nums">{fmt(v.viewCount)}</TableCell>
                      <TableCell className="text-[11px] tabular-nums">{fmt(v.likeCount)}</TableCell>
                      <TableCell className="text-[11px] tabular-nums">{fmt(v.commentCount)}</TableCell>
                      <TableCell className="text-[11px] tabular-nums">{v.shareCount != null ? fmt(v.shareCount) : "-"}</TableCell>
                      <TableCell className="text-[11px] tabular-nums">{v.saveCount != null ? fmt(v.saveCount) : "-"}</TableCell>
                      <TableCell className="text-[11px] font-medium tabular-nums">{v.er}%</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground whitespace-nowrap">{v.publishedAt ? v.publishedAt.split("T")[0] : "-"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {tableVideos.length > tableDisplayCount && (
              <div className="flex justify-center py-3">
                <Button variant="ghost" size="sm" onClick={() => setTableDisplayCount(prev => prev + TABLE_PAGE_SIZE)}
                  className="text-xs text-muted-foreground hover:text-foreground">
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
    <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted/40 transition-colors group">
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${rankColors}`}>
        {type === "best" ? rank : "!"}
      </span>
      {video.coverUrl && <img src={video.coverUrl} alt="" className="w-9 h-12 rounded object-cover flex-shrink-0" loading="lazy" />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${colors.dot}`} />
          <a href={video.videoUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium hover:underline truncate text-primary">
            {(video.caption || "動画").slice(0, 25)}{(video.caption || "").length > 25 ? "…" : ""}
          </a>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-0.5"><Eye className="h-2.5 w-2.5" />{fmt(video.viewCount)}</span>
          <span className="flex items-center gap-0.5"><Heart className="h-2.5 w-2.5" />{fmt(video.likeCount)}</span>
          <span className="flex items-center gap-0.5"><MessageCircle className="h-2.5 w-2.5" />{fmt(video.commentCount)}</span>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`text-sm font-bold ${type === "best" ? "text-emerald-600" : "text-orange-500"}`}>{highlightValue}</p>
        <p className="text-[9px] text-muted-foreground">{highlightLabel}</p>
      </div>
    </div>
  );
}

// === Daily Chart (enhanced with platform filter + 5 metrics) ===
function AllPlatformDailyChart({ dailyMetrics }: { dailyMetrics: any[] }) {
  const [chartFilter, setChartFilter] = useState<"all" | "tiktok" | "youtube" | "instagram">("all");

  const chartData = useMemo(() => {
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

  // Check which platforms exist in data
  const availablePlatforms = useMemo(() => {
    if (!dailyMetrics || dailyMetrics.length === 0) return new Set<string>();
    return new Set(dailyMetrics.map((m: any) => m.platform).filter(Boolean));
  }, [dailyMetrics]);

  if (chartData.length < 2) return null;

  const hasShares = chartData.some(d => d.shares > 0);
  const hasSaves = chartData.some(d => d.saves > 0);

  const metricNames: Record<string, string> = { views: "再生数", likes: "いいね", comments: "コメント", shares: "シェア", saves: "保存" };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">日次推移</CardTitle>
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
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

