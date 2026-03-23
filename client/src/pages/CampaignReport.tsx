import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ArrowLeft, Download, TrendingUp, TrendingDown, Minus, Crown, Star, Brain, Search, Eye, BarChart3, Users, Hash, Share2, Globe, Lightbulb, ChevronUp, ChevronDown } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { useEffect, useRef, useState, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, ReferenceLine } from "recharts";

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

const gradeColors: Record<string, string> = {
  S: "bg-yellow-500 text-white",
  A: "bg-green-500 text-white",
  B: "bg-blue-500 text-white",
  C: "bg-gray-500 text-white",
  D: "bg-red-500 text-white",
};

const SECTIONS = [
  { id: "summary", label: "総合", icon: Brain },
  { id: "videos", label: "動画", icon: Eye },
  { id: "position", label: "順位", icon: Search },
  { id: "sov", label: "SOV", icon: BarChart3 },
  { id: "bigkw", label: "露出", icon: Hash },
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

  const campaign = campaignQuery.data?.campaign;
  const report = reportQuery.data;

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

  if (reportQuery.isLoading) {
    return (
      <DashboardLayout>
        <div className="max-w-6xl mx-auto">
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
        <div className="max-w-6xl mx-auto text-center py-12">
          <p className="text-muted-foreground">レポートが見つかりません</p>
          <Button variant="link" onClick={() => setLocation(`/campaigns/${campaignId}`)}>キャンペーンに戻る</Button>
        </div>
      </DashboardLayout>
    );
  }

  const summary = report.summary;
  const positions = report.positionReport || [];
  const compReport = report.competitorReport || {};
  const sovReport = report.sovReport || {};
  const ripple = report.rippleReport || {};
  const freqReport = report.competitorFrequencyReport || [];
  const videoMetrics = (report as any).videoMetricsReport as any[] | undefined;
  const crossPlatform = (report as any).crossPlatformData as any | undefined;
  const videoScores = (report as any).videoScores as any[] | undefined;
  const aiReport = (report as any).aiOverallReport as any | undefined;

  const bigKeywordReport = (report as any).bigKeywordReport as Array<{ keyword: string; before: { ownVideoCount: number; bestRank: number | null }; after: { ownVideoCount: number; bestRank: number | null }; competitors?: Array<{ competitor_name: string; competitor_id: string; best_rank: number | null; video_count_in_top30: number; before_best_rank: number | null; before_video_count_in_top30: number; rank_change: number | null }> }> | undefined;

  const hasVideoMetrics = videoMetrics && videoMetrics.length > 0;
  const hasKeywordVolumes = crossPlatform?.keywordSearchVolumes?.length > 0;
  const hasCrossPlatform = crossPlatform && (crossPlatform.trendsData?.length > 0 || crossPlatform.videoTimeline?.length > 0 || hasKeywordVolumes);
  const hasBigKW = bigKeywordReport && bigKeywordReport.length > 0;

  // Filter visible sections
  const visibleSections = SECTIONS.filter(s => {
    if (s.id === "videos" && !hasVideoMetrics) return false;
    if (s.id === "bigkw" && !hasBigKW) return false;
    if (s.id === "cross" && !hasCrossPlatform) return false;
    if (s.id === "next" && !aiReport) return false;
    return true;
  });

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
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
            </div>
          </div>
          <Button variant="outline" onClick={handleCsvExport} className="gap-2">
            <Download className="h-4 w-4" />
            CSV
          </Button>
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

        {/* Section 1: Executive Summary */}
        <div id="summary" ref={el => { sectionRefs.current["summary"] = el; }} className="scroll-mt-16">
          <SectionHeader number={1} title="エグゼクティブサマリー" question="施策は成功したのか？" />
          {aiReport && (
            <Card className="mb-4">
              <CardContent className="py-5 flex items-start gap-4">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0 ${gradeColors[aiReport.grade] || gradeColors.C}`}>
                  {aiReport.grade}
                </div>
                <p className="text-sm leading-relaxed pt-2">{aiReport.summary}</p>
              </CardContent>
            </Card>
          )}
          {summary && <SummaryCards summary={summary} />}
        </div>

        {/* Section 2: Videos */}
        {hasVideoMetrics && (
          <div id="videos" ref={el => { sectionRefs.current["videos"] = el; }} className="scroll-mt-16">
            <SectionHeader number={2} title="施策動画パフォーマンス" question="投稿した動画の状況は？" />
            <VideoSection videos={videoMetrics!} videoScores={videoScores} />
          </div>
        )}

        {/* Section 3: Position */}
        <div id="position" ref={el => { sectionRefs.current["position"] = el; }} className="scroll-mt-16">
          <SectionHeader number={3} title="検索順位の変化" question="検索順位はどう変わった？" />
          <PositionSection positions={positions} />
        </div>

        {/* Section 4: SOV */}
        <div id="sov" ref={el => { sectionRefs.current["sov"] = el; }} className="scroll-mt-16">
          <SectionHeader number={4} title="SOV・市場シェア" question="市場シェアは拡大した？" />
          <SovSection sovReport={sovReport} />
        </div>

        {/* Section 5: Big Keyword */}
        {hasBigKW && (
          <div id="bigkw" ref={el => { sectionRefs.current["bigkw"] = el; }} className="scroll-mt-16">
            <SectionHeader number={5} title="ビッグキーワード露出" question="カテゴリ検索で商品が露出できた？" />
            <BigKeywordSection data={bigKeywordReport!} />
          </div>
        )}

        {/* Section 6: Competitor */}
        <div id="competitor" ref={el => { sectionRefs.current["competitor"] = el; }} className="scroll-mt-16">
          <SectionHeader number={6} title="競合動向" question="競合と比べてどうだった？" />
          <CompetitorSection compReport={compReport} freqReport={freqReport} bigKeywordReport={bigKeywordReport} />
        </div>

        {/* Section 7: Ripple */}
        <div id="ripple" ref={el => { sectionRefs.current["ripple"] = el; }} className="scroll-mt-16">
          <SectionHeader number={7} title="波及効果・オーガニック拡散" question="オーガニックにも広がった？" />
          <RippleSection ripple={ripple} />
        </div>

        {/* Section 8: Cross Platform */}
        {hasCrossPlatform && (
          <div id="cross" ref={el => { sectionRefs.current["cross"] = el; }} className="scroll-mt-16">
            <SectionHeader number={8} title="クロスプラットフォーム相関" question="検索トレンドとの関係は？" />
            {(crossPlatform.trendsData?.length > 0 || crossPlatform.videoTimeline?.length > 0) && (
              <CrossPlatformSection data={crossPlatform} videoMetrics={videoMetrics} />
            )}
            {hasKeywordVolumes && (
              <KeywordVolumeSection data={crossPlatform.keywordSearchVolumes} />
            )}
          </div>
        )}

        {/* Section 9: Next Actions */}
        {aiReport && (
          <div id="next" ref={el => { sectionRefs.current["next"] = el; }} className="scroll-mt-16">
            <SectionHeader number={9} title="ネクストアクション" question="次に何をすべき？" />
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

function SectionHeader({ number, title, question }: { number: number; title: string; question: string }) {
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

function SummaryCards({ summary }: { summary: any }) {
  const cards = [
    {
      title: "検索順位",
      before: summary.rank_before != null ? `${summary.rank_before}位` : "圏外",
      after: summary.rank_after != null ? `${summary.rank_after}位` : "圏外",
      change: summary.rank_change != null ? <ChangeIndicator value={summary.rank_change} suffix="位" /> : null,
    },
    {
      title: "再生数",
      before: fmt(summary.views_before),
      after: fmt(summary.views_after),
      change: summary.views_before > 0 ? (
        <ChangeIndicator value={Number(((summary.views_after - summary.views_before) / summary.views_before * 100).toFixed(0))} suffix="%" />
      ) : null,
    },
    {
      title: "ER",
      before: `${summary.er_before}%`,
      after: `${summary.er_after}%`,
      change: <ChangeIndicator value={Number((summary.er_after - summary.er_before).toFixed(2))} suffix="pt" />,
    },
    {
      title: "SOV",
      before: `${summary.sov_before}%`,
      after: `${summary.sov_after}%`,
      change: <ChangeIndicator value={Number((parseFloat(summary.sov_after) - parseFloat(summary.sov_before)).toFixed(1))} suffix="pt" />,
    },
    {
      title: "関連投稿数",
      before: String(summary.related_posts_before),
      after: String(summary.related_posts_after),
      change: summary.related_posts_before > 0 ? (
        <ChangeIndicator value={Number(((summary.related_posts_after - summary.related_posts_before) / summary.related_posts_before * 100).toFixed(0))} suffix="%" />
      ) : <span className="text-green-600">+{summary.related_posts_after - summary.related_posts_before}</span>,
    },
    {
      title: "第三者投稿",
      before: "-",
      after: `${summary.omaage_count || 0}本`,
      change: null,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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
    </div>
  );
}

// ============================
// Section 2: Position
// ============================

function PositionSection({ positions }: { positions: any[] }) {
  // 順位を反転: rank 1→30(最も高い棒), rank 30→1(短い棒), 圏外(31)→0(表示なし)
  const chartData = positions.map(p => ({
    keyword: p.keyword.length > 12 ? p.keyword.slice(0, 12) + "…" : p.keyword,
    施策前: p.before_rank != null ? 31 - p.before_rank : 0,
    施策後: p.after_rank != null ? 31 - p.after_rank : 0,
  }));

  // Y軸ティック: 値→実際の順位ラベル (30→"1位", 25→"6位", ... 1→"30位", 0→"圏外")
  const yTicks = [0, 6, 11, 16, 21, 26, 30];
  const rankLabel = (v: number) => v <= 0 ? "圏外" : `${31 - v}位`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">KW別検索順位変化</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="keyword" tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 30]} ticks={yTicks} tickFormatter={rankLabel} />
            <Tooltip formatter={(value: number) => rankLabel(value)} />
            <Legend />
            <Bar dataKey="施策前" fill="#94a3b8" />
            <Bar dataKey="施策後" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
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

function VideoSection({ videos, videoScores }: { videos: any[]; videoScores?: any[] }) {
  const PAGE_SIZE = 5;
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const scoreMap = new Map((videoScores || []).map((s: any) => [s.videoId, s]));

  const bestVideoId = videos.reduce((best, v) => {
    const views = v.after?.viewCount || 0;
    return views > (best.views || 0) ? { id: v.videoId, views } : best;
  }, { id: "", views: 0 }).id;

  // サマリー
  const totalViews = videos.reduce((s, v) => s + (v.after?.viewCount || 0), 0);
  const totalLikes = videos.reduce((s, v) => s + (v.after?.likeCount || 0), 0);
  const totalComments = videos.reduce((s, v) => s + (v.after?.commentCount || 0), 0);

  const displayedVideos = videos.slice(0, displayCount);
  const remaining = videos.length - displayCount;

  const totalShares = videos.reduce((s, v) => s + (v.after?.shareCount || 0), 0);
  const totalSaves = videos.reduce((s, v) => s + (v.after?.saveCount || 0), 0);

  return (
    <div className="space-y-4">
      {/* サマリー */}
      <p className="text-sm text-muted-foreground">{videos.length}本の施策動画</p>
      <div className="grid grid-cols-5 gap-3">
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
          <p className="text-xs text-muted-foreground">総シェア</p>
          <p className="text-xl font-bold">{fmt(totalShares)}</p>
        </CardContent></Card>
      </div>

      {/* 累積折れ線グラフ（再生数 + エンゲージメント）— 日別集約・週単位表示 */}
      {videos.length > 0 && (() => {
        // 日別に集約（日付なしの動画は除外）
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

        // 累積計算
        let cumViews = 0, cumLikes = 0, cumComments = 0, cumSaves = 0, cumShares = 0;
        const lineData = sortedDays.map(([dateKey, d]) => {
          cumViews += d.views;
          cumLikes += d.likes;
          cumComments += d.comments;
          cumSaves += d.saves;
          cumShares += d.shares;
          const label = dateKey !== "unknown"
            ? `${new Date(dateKey).getMonth() + 1}/${new Date(dateKey).getDate()}`
            : dateKey;
          return { name: label, dateKey, 再生数: cumViews, いいね: cumLikes, コメント: cumComments, 保存: cumSaves, シェア: cumShares };
        });

        // 約7日間隔でtickを選定
        const tickInterval = Math.max(1, Math.round(lineData.length / Math.ceil(lineData.length / 7)));
        const ticks = lineData.filter((_, i) => i % tickInterval === 0 || i === lineData.length - 1).map(d => d.name);

        return (
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
                  <Tooltip formatter={(v: number) => v.toLocaleString()} />
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
        );
      })()}

      {/* アコーディオン */}
      <Card>
        <CardContent className="pt-4 pb-2">
          <Accordion type="multiple" defaultValue={[`video-0`]}>
            {displayedVideos.map((v, i) => {
              const score = scoreMap.get(v.videoId);
              const isBest = v.videoId === bestVideoId;
              const views = v.after?.viewCount || 0;
              const likes = v.after?.likeCount || 0;
              const comments = v.after?.commentCount || 0;
              const shares = v.after?.shareCount || 0;
              const erPercent = v.er != null ? v.er : (views > 0 ? Number(((likes + comments + shares) / views * 100).toFixed(2)) : 0);
              const hashtags: string[] = v.hashtags || [];
              const duration: number = v.duration || 0;
              const durationStr = duration > 0 ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}` : null;

              return (
                <AccordionItem key={i} value={`video-${i}`} className={isBest ? "border-yellow-300" : ""}>
                  <AccordionTrigger className="hover:no-underline py-3 gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {v.coverUrl && (
                        <img src={v.coverUrl} alt="" className="w-10 h-14 rounded object-cover flex-shrink-0" loading="lazy" />
                      )}
                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-2">
                          {isBest && <Crown className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />}
                          <p className="text-sm font-medium truncate">{v.description?.slice(0, 50) || v.videoId}</p>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          <span>{fmt(views)} 再生</span>
                          <span>ER {erPercent}%</span>
                          {durationStr && <span>{durationStr}</span>}
                          {score && (
                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium border ${getScoreGradeColor(score.overallScore)}`}>
                              <Star className="h-2.5 w-2.5" />{score.overallScore}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-3 pl-1">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {v.postedAt && <span>投稿日: {new Date(v.postedAt).toLocaleDateString("ja-JP")}</span>}
                        {durationStr && <span>尺: {durationStr}</span>}
                        <span>ER: {erPercent}%</span>
                      </div>
                      {score?.aiEvaluation && (
                        <Badge variant="secondary" className="text-xs">{score.aiEvaluation}</Badge>
                      )}
                      {/* ハッシュタグ */}
                      {hashtags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {hashtags.map((tag, ti) => (
                            <span key={ti} className="inline-block px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[11px] font-medium">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* SEOメトリクス */}
                      <div className="grid grid-cols-4 gap-2 text-xs">
                        {[
                          { label: "再生数", value: views },
                          { label: "いいね", value: likes },
                          { label: "コメント", value: comments },
                          { label: "保存", value: v.after?.saveCount || 0 },
                        ].map(m => (
                          <div key={m.label} className="text-center p-2 rounded bg-muted/50">
                            <p className="text-muted-foreground">{m.label}</p>
                            <p className="font-semibold">{fmt(m.value)}</p>
                          </div>
                        ))}
                      </div>
                      {v.videoUrl && (
                        <a href={v.videoUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                          TikTokで見る &rarr;
                        </a>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>

          {/* もっと見るボタン */}
          {remaining > 0 && (
            <div className="flex justify-center pt-3 pb-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDisplayCount(prev => prev + PAGE_SIZE)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className="h-3.5 w-3.5 mr-1" />
                もっと見る（残り{remaining}件）
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================
// Section 4: SOV
// ============================

function SovSection({ sovReport }: { sovReport: Record<string, any> }) {
  const sovEntries = Object.entries(sovReport);

  // Chart data for grouped bar
  const chartData = sovEntries.map(([kw, data]) => ({
    keyword: kw.length > 12 ? kw.slice(0, 12) + "..." : kw,
    before: parseFloat(data.before.percentage) || 0,
    after: parseFloat(data.after.percentage) || 0,
  }));

  return (
    <div className="space-y-4">
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">KW別SOV変化</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="keyword" tick={{ fontSize: 11 }} />
                <YAxis unit="%" />
                <Tooltip formatter={(value: number) => `${value}%`} />
                <Legend />
                <Bar dataKey="before" name="施策前" fill="#94a3b8" />
                <Bar dataKey="after" name="施策後" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>キーワード</TableHead>
                <TableHead className="text-right">施策前</TableHead>
                <TableHead className="text-right">施策後</TableHead>
                <TableHead className="text-right">変動</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sovEntries.map(([kw, data]) => {
                const beforeFailed = data.before.total_count === 0;
                const afterFailed = data.after.total_count === 0;
                const canCompare = !beforeFailed && !afterFailed;
                return (
                  <TableRow key={kw}>
                    <TableCell className="font-medium">{kw}</TableCell>
                    <TableCell className="text-right text-slate-400">
                      {beforeFailed
                        ? <span className="text-orange-400 text-xs">データ取得失敗</span>
                        : <>{data.before.own_count}/{data.before.total_count} ({data.before.percentage}%)</>
                      }
                    </TableCell>
                    <TableCell className="text-right text-blue-600 font-semibold">
                      {afterFailed
                        ? <span className="text-orange-400 text-xs font-normal">データ取得失敗</span>
                        : <>{data.after.own_count}/{data.after.total_count} ({data.after.percentage}%)</>
                      }
                    </TableCell>
                    <TableCell className="text-right">
                      {canCompare ? (
                        <ChangeIndicator
                          value={Number((parseFloat(data.after.percentage) - parseFloat(data.before.percentage)).toFixed(1))}
                          suffix="pt"
                        />
                      ) : <span className="text-slate-300">-</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

    </div>
  );
}

// ============================
// Section 5: Big Keyword Exposure
// ============================

function BigKeywordSection({ data }: { data: Array<{ keyword: string; before: { ownVideoCount: number; bestRank: number | null }; after: { ownVideoCount: number; bestRank: number | null } }> }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>キーワード</TableHead>
              <TableHead className="text-center">施策前</TableHead>
              <TableHead className="text-center">施策後</TableHead>
              <TableHead className="text-center">結果</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((item) => {
              const exposed = item.after.ownVideoCount > 0;
              const wasExposed = item.before.ownVideoCount > 0;
              return (
                <TableRow key={item.keyword}>
                  <TableCell className="font-medium">{item.keyword}</TableCell>
                  <TableCell className="text-center text-slate-400 text-sm">
                    {wasExposed ? `${item.before.bestRank}位（${item.before.ownVideoCount}本）` : "圏外"}
                  </TableCell>
                  <TableCell className="text-center text-sm">
                    {exposed
                      ? <span className="text-green-600 font-semibold">{item.after.bestRank}位（{item.after.ownVideoCount}本）</span>
                      : <span className="text-muted-foreground">圏外</span>
                    }
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={exposed ? "default" : "secondary"} className={exposed ? "bg-green-600" : ""}>
                      {exposed ? (wasExposed ? "継続露出" : "露出成功") : "未露出"}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ============================
// Section 6: Competitor
// ============================

function CompetitorSection({ compReport, freqReport, bigKeywordReport }: { compReport: Record<string, any>; freqReport: any[]; bigKeywordReport?: Array<{ keyword: string; before: { ownVideoCount: number; bestRank: number | null }; after: { ownVideoCount: number; bestRank: number | null }; competitors?: Array<{ competitor_name: string; competitor_id: string; best_rank: number | null; video_count_in_top30: number; before_best_rank: number | null; before_video_count_in_top30: number; rank_change: number | null }> }> }) {
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

function RippleSection({ ripple }: { ripple: Record<string, any> }) {
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
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-xs text-muted-foreground">関連投稿数</p>
            <p className="text-2xl font-bold mt-1">
              <BeforeAfter before={totalBeforePosts} after={totalAfterPosts} />
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-xs text-muted-foreground">総再生数</p>
            <p className="text-2xl font-bold mt-1">
              <BeforeAfter before={fmt(totalBeforeViews)} after={fmt(totalAfterViews)} />
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-xs text-muted-foreground">第三者投稿</p>
            <p className="text-2xl font-bold mt-1">{totalThirdParty}本</p>
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
                    <td className="py-1.5 px-2 text-right">
                      <BeforeAfter before={data.before_posts || 0} after={data.after_posts || 0} />
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      <BeforeAfter before={fmt(data.before_total_views || 0)} after={fmt(data.after_total_views || 0)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Top third-party videos (all tags combined) */}
      {(() => {
        const allVideos = entries.flatMap(([, data]) =>
          (data.third_party_videos || data.omaage_videos || [])
        ).sort((a: any, b: any) => (b.views || 0) - (a.views || 0)).slice(0, 5);
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

function CrossPlatformSection({ data, videoMetrics }: { data: any; videoMetrics?: any[] }) {
  const trendMap = new Map<string, number>((data.trendsData || []).map((t: any) => [t.date, t.value]));
  const videoMap = new Map<string, any>((data.videoTimeline || []).map((v: any) => [v.date, v]));

  // videoTimelineが空の場合、videoMetricsからフォールバック
  if (videoMap.size === 0 && videoMetrics && videoMetrics.length > 0) {
    const fallbackMap = new Map<string, { postCount: number; totalViews: number }>();
    for (const v of videoMetrics) {
      const postedAt = v.postedAt;
      if (!postedAt) continue;
      const date = new Date(postedAt).toISOString().split("T")[0];
      const existing = fallbackMap.get(date) || { postCount: 0, totalViews: 0 };
      existing.postCount += 1;
      existing.totalViews += (v.after?.viewCount || v.before?.viewCount || 0);
      fallbackMap.set(date, existing);
    }
    for (const [date, stats] of fallbackMap) {
      videoMap.set(date, { date, ...stats });
    }
  }

  const allDates = [...new Set([...trendMap.keys(), ...videoMap.keys()])].sort();
  // 累計再生数を算出
  let cumulativeViews = 0;
  const chartData = allDates.map((date: string) => {
    const dayViews = videoMap.get(date)?.totalViews ?? 0;
    cumulativeViews += dayViews;
    return {
      date: date.slice(5),
      fullDate: date,
      trends: trendMap.get(date) ?? null,
      views: cumulativeViews > 0 ? cumulativeViews : null,
    };
  });

  const markerDates = new Set<string>((data.videoMarkers || []).map((m: any) => m.date as string));
  // videoMarkersが空の場合、videoMetricsからフォールバック
  if (markerDates.size === 0 && videoMetrics && videoMetrics.length > 0) {
    for (const v of videoMetrics) {
      if (v.postedAt) {
        const date = new Date(v.postedAt).toISOString().split("T")[0];
        markerDates.add(date);
      }
    }
  }

  const hasViewsData = chartData.some(d => d.views != null && d.views > 0);

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
          {!hasViewsData && (
            <CardDescription className="text-xs text-amber-600">
              TikTok再生数データが取得できていません。動画の投稿日マーカーのみ表示しています。
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" label={{ value: "Trends", angle: -90, position: "insideLeft", style: { fontSize: 11 } }} />
              <YAxis yAxisId="right" orientation="right" label={{ value: "累計再生数", angle: 90, position: "insideRight", style: { fontSize: 11 } }} />
              <Tooltip
                formatter={(value: any, name: string) => {
                  if (value === null || value === undefined) return ["—", name];
                  if (name === "Google Trends") return [`${value} / 100`, name];
                  return [Number(value).toLocaleString() + " 回", name];
                }}
              />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="trends" name="Google Trends" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
              <Line yAxisId="right" type="monotone" dataKey="views" name="累計再生数" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} connectNulls />
              {Array.from(markerDates).map((date: string) => (
                <ReferenceLine key={date} x={date.slice(5)} yAxisId="left" stroke="#10b981" strokeDasharray="3 3" label={{ value: "投稿", fill: "#10b981", fontSize: 10 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Correlation interpretation card */}
      {data.correlation != null && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm">
              {Math.abs(data.correlation) >= 0.7
                ? "TikTok施策とGoogle検索トレンドに強い相関が認められます。施策がクロスプラットフォームで認知を押し上げている可能性があります。"
                : Math.abs(data.correlation) >= 0.4
                ? "一定の相関が見られます。施策が検索トレンドに寄与している可能性がありますが、他要因の影響も考えられます。"
                : "明確な相関は認められません。TikTok施策とGoogle検索トレンドは独立して推移しています。"
              }
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================
// Section 8b: Keyword Search Volumes
// ============================

function KeywordVolumeSection({ data }: { data: any[] }) {
  // 月別推移チャート用データ（直近12ヶ月）
  const chartData = (() => {
    if (!data || data.length === 0) return [];
    // 全キーワードの月次データを集約
    const monthMap = new Map<string, Record<string, number>>();
    for (const kw of data) {
      for (const mv of (kw.monthlyVolumes || []).slice(-12)) {
        const key = `${mv.year}-${String(mv.month).padStart(2, "0")}`;
        if (!monthMap.has(key)) monthMap.set(key, {});
        monthMap.get(key)![kw.keyword] = mv.volume;
      }
    }
    return [...monthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, volumes]) => ({ month: month.slice(2), ...volumes }));
  })();

  const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#84cc16"];

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" />
            Google 検索ボリューム
          </CardTitle>
          <CardDescription>Google Ads Keyword Planner による月間検索ボリューム</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>キーワード</TableHead>
                <TableHead className="text-right">月間検索数</TableHead>
                <TableHead className="text-center">競合性</TableHead>
                <TableHead className="text-right">競合指数</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((kw: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{kw.keyword}</TableCell>
                  <TableCell className="text-right">{fmt(kw.avgMonthlySearches)}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={
                      kw.competition === "HIGH" ? "destructive" :
                      kw.competition === "MEDIUM" ? "secondary" :
                      "outline"
                    }>
                      {kw.competition === "HIGH" ? "高" :
                       kw.competition === "MEDIUM" ? "中" :
                       kw.competition === "LOW" ? "低" : "-"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{kw.competitionIndex}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">月別検索ボリューム推移</CardTitle>
            <CardDescription>直近12ヶ月の検索ボリューム推移</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                {data.map((kw: any, i: number) => (
                  <Bar key={kw.keyword} dataKey={kw.keyword} fill={COLORS[i % COLORS.length]} />
                ))}
              </BarChart>
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

function NextActionsSection({ aiReport }: { aiReport: any }) {
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
