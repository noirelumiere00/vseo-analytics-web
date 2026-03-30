import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Sparkles, Loader2, Eye, Lock } from "lucide-react";
import { useParams } from "wouter";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  SECTIONS,
  gradeColors,
  SectionHeader,
  SummaryCards,
  PlatformSummarySection,
  VideoSection,
  KeywordSection,
  SovSection,
  CompetitorSection,
  RippleSection,
  CrossPlatformSection,
  NextActionsSection,
} from "./CampaignReport";

export default function SharedReport() {
  const { token } = useParams<{ token: string }>();

  const reportQuery = trpc.campaign.getPublicReport.useQuery(
    { token: token || "" },
    { enabled: !!token, retry: false },
  );
  const dailyMetricsQuery = trpc.campaign.getPublicDailyMetrics.useQuery(
    { token: token || "" },
    { enabled: !!token },
  );

  const report = reportQuery.data?.report;
  const campaignName = reportQuery.data?.campaignName;
  const dailyMetrics = dailyMetricsQuery.data || [];

  const [activeSection, setActiveSection] = useState("summary");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
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

  // Loading
  if (reportQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error / not found
  if (reportQuery.isError || !report) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <Lock className="h-10 w-10 mx-auto text-muted-foreground" />
          <h2 className="text-lg font-semibold">レポートが見つかりません</h2>
          <p className="text-sm text-muted-foreground">
            リンクが無効か、共有が無効化されています
          </p>
        </div>
      </div>
    );
  }

  // Derived data
  const summary = report.summary;
  const positions = report.positionReport || [];
  const compReport = report.competitorReport || {};
  const sovReport = report.sovReport || {};
  const freqReport = report.competitorFrequencyReport || [];
  const crossPlatform = (report as any).crossPlatformData as any | undefined;
  const videoScores = (report as any).videoScores as any[] | undefined;
  const aiReport = (report as any).aiOverallReport as any | undefined;
  const videoMetrics = (report as any)?.videoMetricsReport as any[] | undefined;
  const bigKeywordReport = (report as any).bigKeywordReport as any[] | undefined;
  const platformSummary = (report as any).platformSummary as any | undefined;
  const ripple = report.rippleReport || {};

  const hasBaseline = report.baselineDate != null;
  const hasVideoMetrics = videoMetrics && videoMetrics.length > 0;
  const hasCrossPlatform = crossPlatform && (crossPlatform.trendsData?.length > 0 || crossPlatform.videoTimeline?.length > 0);
  const hasBigKW = bigKeywordReport && bigKeywordReport.length > 0;
  const hasYoutube = platformSummary?.youtube && platformSummary.youtube.videos?.length > 0;
  const hasInstagram = platformSummary?.instagram && platformSummary.instagram.videos?.length > 0;
  const hasAnyPlatformData = hasVideoMetrics || hasYoutube || hasInstagram;

  const visibleSections = SECTIONS.filter(s => {
    if (s.id === "platform" && !hasAnyPlatformData) return false;
    if (s.id === "videos" && !hasVideoMetrics) return false;
    if (s.id === "competitor") return false; // hide competitor in shared view
    if (s.id === "cross" && !hasCrossPlatform) return false;
    if (s.id === "next" && !aiReport) return false;
    return true;
  });
  const sectionNumber = (id: string) => visibleSections.findIndex(s => s.id === id) + 1;

  // Campaign period defaults from video metrics
  const campaignStart = (() => {
    if (videoMetrics && videoMetrics.length > 0) {
      const dates = videoMetrics.map((v: any) => v.postedAt).filter(Boolean).sort();
      if (dates.length > 0) return dates[0].split("T")[0];
    }
    return report.baselineDate ? new Date(report.baselineDate).toISOString().split("T")[0] : "";
  })();
  const campaignEnd = (() => {
    if (videoMetrics && videoMetrics.length > 0) {
      const dates = videoMetrics.map((v: any) => v.postedAt).filter(Boolean).sort();
      if (dates.length > 0) return dates[dates.length - 1].split("T")[0];
    }
    return report.measurementDate ? new Date(report.measurementDate).toISOString().split("T")[0] : "";
  })();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{campaignName || "施策効果レポート"}</h1>
            <p className="text-sm text-muted-foreground">
              {report.baselineDate ? new Date(report.baselineDate).toLocaleDateString("ja-JP") : "?"} &rarr; {report.measurementDate ? new Date(report.measurementDate).toLocaleDateString("ja-JP") : "?"}
            </p>
          </div>
          <Badge variant="secondary" className="gap-1.5 text-xs">
            <Eye className="h-3 w-3" />
            閲覧専用
          </Badge>
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

        {/* Summary */}
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

        {/* Platform */}
        {hasAnyPlatformData && (
          <div id="platform" ref={el => { sectionRefs.current["platform"] = el; }} className="scroll-mt-16 section-fade-in">
            <SectionHeader number={sectionNumber("platform")} title="全媒体横断サマリー" question="全プラットフォームの合計は？" />
            <PlatformSummarySection tiktokVideos={videoMetrics || []} platformSummary={platformSummary || {}} dailyMetrics={dailyMetrics} />
          </div>
        )}

        {/* TikTok Videos */}
        {hasVideoMetrics && (
          <div id="videos" ref={el => { sectionRefs.current["videos"] = el; }} className="scroll-mt-16 section-fade-in">
            <SectionHeader number={sectionNumber("videos")} title="TikTok 施策動画パフォーマンス" question="TikTok動画の状況は？" />
            <SummaryCards summary={summary} thirdPartyCount={0} hasBaseline={hasBaseline} ripple={ripple} sovReport={sovReport} />
            <VideoSection videos={videoMetrics!} videoScores={videoScores} hasBaseline={hasBaseline} dailyMetrics={dailyMetrics} />
          </div>
        )}

        {/* Keyword */}
        <div id="keyword" ref={el => { sectionRefs.current["keyword"] = el; }} className="scroll-mt-16 section-fade-in">
          <SectionHeader number={sectionNumber("keyword")} title="検索順位・露出" question="検索順位はどう変わった？" />
          <KeywordSection positions={positions} bigKeywordReport={hasBigKW ? bigKeywordReport! : undefined} hasBaseline={hasBaseline} />
        </div>

        {/* SOV (read-only) */}
        <div id="sov" ref={el => { sectionRefs.current["sov"] = el; }} className="scroll-mt-16 section-fade-in">
          <SectionHeader number={sectionNumber("sov")} title="検索上位シェア率" question="どのKWにどの動画が露出した？" />
          <SovSection sovReport={sovReport} positions={positions} hasBaseline={hasBaseline} campaignId={0} onSlotUpdate={() => {}} />
        </div>

        {/* Ripple */}
        <div id="ripple" ref={el => { sectionRefs.current["ripple"] = el; }} className="scroll-mt-16 section-fade-in">
          <SectionHeader number={sectionNumber("ripple")} title="波及効果・オーガニック拡散" question="オーガニックにも広がった？" />
          <RippleSection ripple={ripple} />
        </div>

        {/* Cross Platform */}
        {hasCrossPlatform && (
          <div id="cross" ref={el => { sectionRefs.current["cross"] = el; }} className="scroll-mt-16 section-fade-in">
            <SectionHeader number={sectionNumber("cross")} title="クロスプラットフォーム相関" question="検索トレンドとの関係は？" />
            <CrossPlatformSection data={crossPlatform} videoMetrics={videoMetrics} baselineDate={report.baselineDate} measurementDate={report.measurementDate} ripple={ripple} campaignStart={campaignStart} campaignEnd={campaignEnd} />
          </div>
        )}

        {/* Next Actions */}
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

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground py-6 border-t">
          Powered by VSEO Analytics
        </div>
      </div>
    </div>
  );
}
