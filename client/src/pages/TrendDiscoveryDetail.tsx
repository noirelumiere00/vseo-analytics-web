import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { trpc } from "@/lib/trpc";
import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { AlertTriangle, ArrowLeft, Bookmark, CheckCircle, ChevronDown, Download, Eye, FileText, Hash, Heart, Loader2, MessageCircle, Play, RefreshCcw, Search, Share2, Sparkles, TrendingUp, Users } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  PerformanceClassification,
  EngagementStatsTable,
  FollowerErScatter,
  QueryFreshnessChart,
  AdInsightSection,
  TrendSeoMetaKeywordsSection,
  HashtagPerformanceChart,
  DurationBandsChart,
  TrendPostingTimeHeatmap,
  PlayCountDistribution,
  type TrendStatistics,
} from "@/components/TrendStatisticsPanel";

export default function TrendDiscoveryDetail() {
  const params = useParams<{ id: string }>();
  const jobId = Number(params.id);
  const [, setLocation] = useLocation();
  const executedRef = useRef(false);

  const jobQuery = trpc.trendDiscovery.getById.useQuery(
    { jobId },
    { enabled: !!jobId, refetchInterval: (query) => {
      const data = query.state.data;
      return (data?.status === "processing" || data?.status === "queued") ? 3000 : false;
    }},
  );

  const progressQuery = trpc.trendDiscovery.getProgress.useQuery(
    { jobId },
    {
      enabled: !!jobId && (jobQuery.data?.status === "processing" || jobQuery.data?.status === "queued"),
      refetchInterval: 2000,
    },
  );

  const executeMutation = trpc.trendDiscovery.execute.useMutation({
    onError: (error) => toast.error(error.message),
  });

  const recomputeMutation = trpc.trendDiscovery.recomputeStatistics.useMutation({
    onSuccess: () => {
      toast.success("統計を再計算しました");
      jobQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const csvQuery = trpc.trendDiscovery.exportCsv.useQuery(
    { jobId },
    { enabled: false },
  );

  // pending時に自動execute
  useEffect(() => {
    if (jobQuery.data?.status === "pending" && !executedRef.current) {
      executedRef.current = true;
      executeMutation.mutate({ jobId });
    }
  }, [jobQuery.data?.status, jobId]);

  const handleExportCsv = async () => {
    try {
      const result = await csvQuery.refetch();
      if (result.data) {
        const bom = "\uFEFF";
        const blob = new Blob([bom + result.data.csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = result.data.filename;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      toast.error("CSV出力に失敗しました");
    }
  };

  const job = jobQuery.data;
  const progress = progressQuery.data;

  if (jobQuery.isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20">
          <img src="/favicon.png" alt="" className="h-12 w-12 object-contain logo-blend animate-logo-pulse" />
        </div>
      </DashboardLayout>
    );
  }

  if (!job) {
    return (
      <DashboardLayout>
        <div className="text-center py-20 text-muted-foreground">ジョブが見つかりません</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/trend-insights")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{job.persona}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {new Date(job.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                {job.status === "completed" && " — 分析完了"}
              </p>
            </div>
          </div>
          {job.status === "completed" && (
            <div className="flex items-center gap-2">
              <Button onClick={() => setLocation(`/campaigns/new?trendJobId=${jobId}`)}>
                <FileText className="h-4 w-4 mr-2" />
                施策レポート作成
              </Button>
              <Button
                variant="outline"
                onClick={() => recomputeMutation.mutate({ jobId })}
                disabled={recomputeMutation.isPending}
              >
                {recomputeMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCcw className="h-4 w-4 mr-2" />
                )}
                統計再計算
              </Button>
              <Button variant="outline" onClick={handleExportCsv}>
                <Download className="h-4 w-4 mr-2" />
                CSV出力
              </Button>
            </div>
          )}
        </div>

        {/* Processing / Queued */}
        {(job.status === "processing" || job.status === "queued") && (
          <Card className="border-primary/20">
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
                      {progress?.currentStep || "分析を実行中..."}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">{Math.max(0, progress?.progress ?? 0)}%</p>
                  </div>
                  <Progress value={Math.max(0, progress?.progress ?? 0)} className="h-2 w-full" />
                </div>

                {/* ステップインジケーター */}
                <div className="space-y-3">
                  {[
                    { label: "キーワード拡張", desc: "ペルソナからKW・ハッシュタグを生成", startAt: 1, doneAt: 10 },
                    { label: "TikTok検索・スクレイピング", desc: "検索結果から動画データを取得", startAt: 10, doneAt: 80 },
                    { label: "SEOキーワード取得", desc: "上位動画のメタキーワードを解析", startAt: 80, doneAt: 85 },
                    { label: "横断集計・統計分析", desc: "全クエリを横断して統計を算出", startAt: 85, doneAt: 90 },
                    { label: "AIレポート生成", desc: "インサイト・戦略提案を自動生成", startAt: 90, doneAt: 99 },
                  ].map((step, i) => {
                    const pct = progress?.progress ?? 0;
                    const isDone = pct >= step.doneAt;
                    const isActive = pct >= step.startAt && !isDone;
                    return (
                      <div key={i} className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${isActive ? "bg-primary/5 border border-primary/20" : isDone ? "opacity-60" : "opacity-40"}`}>
                        <div className={`mt-0.5 h-5 w-5 rounded-full flex items-center justify-center shrink-0 ${isDone ? "bg-green-500" : isActive ? "bg-primary" : "bg-muted"}`}>
                          {isDone ? (
                            <CheckCircle className="h-3.5 w-3.5 text-white" />
                          ) : isActive ? (
                            <Loader2 className="h-3 w-3 animate-spin text-white" />
                          ) : (
                            <span className="text-[10px] text-muted-foreground">{i + 1}</span>
                          )}
                        </div>
                        <div>
                          <p className={`text-sm ${isDone ? "line-through" : isActive ? "font-medium" : ""}`}>{step.label}</p>
                          <p className="text-xs text-muted-foreground">{step.desc}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Failed */}
        {job.status === "failed" && (
          <Card className="border-destructive/30">
            <CardContent className="py-8">
              <div className="flex flex-col items-center gap-4 text-center">
                <AlertTriangle className="h-8 w-8 text-destructive" />
                <div>
                  <p className="font-medium text-destructive">分析に失敗しました</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {progress?.currentStep || "再実行してください"}
                  </p>
                </div>
                <Button
                  onClick={() => {
                    executedRef.current = false;
                    executeMutation.mutate({ jobId });
                  }}
                  disabled={executeMutation.isPending}
                >
                  {executeMutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />実行中...</>
                  ) : (
                    <><Play className="mr-2 h-4 w-4" />再実行</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Completed */}
        {job.status === "completed" && (
          <>
            {/* 統計サマリーバナー */}
            {(() => {
              const stats = (job.crossAnalysis as any)?.statistics;
              const kwCount = (job.expandedKeywords as string[] || []).length;
              const htCount = (job.expandedHashtags as string[] || []).length;
              return (
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="flex items-center gap-3 border-l-4 border-primary rounded-lg p-4 bg-primary/5">
                    <Search className="h-5 w-5 text-primary shrink-0" />
                    <div>
                      <p className="text-2xl font-bold">{kwCount + htCount}</p>
                      <p className="text-xs text-muted-foreground">検索クエリ数</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 border-l-4 border-blue-500 rounded-lg p-4 bg-blue-50 dark:bg-blue-950/20">
                    <Play className="h-5 w-5 text-blue-500 shrink-0" />
                    <div>
                      <p className="text-2xl font-bold">{stats?.totalVideos ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">分析動画数</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 border-l-4 border-amber-500 rounded-lg p-4 bg-amber-50 dark:bg-amber-950/20">
                    <TrendingUp className="h-5 w-5 text-amber-500 shrink-0" />
                    <div>
                      <p className="text-2xl font-bold">{stats?.engagementStats?.er?.median != null ? `${stats.engagementStats.er.median}%` : "—"}</p>
                      <p className="text-xs text-muted-foreground">中央値ER</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 border-l-4 border-rose-500 rounded-lg p-4 bg-rose-50 dark:bg-rose-950/20">
                    <FileText className="h-5 w-5 text-rose-500 shrink-0" />
                    <div>
                      <p className="text-2xl font-bold">{stats?.adInsight ? `${stats.adInsight.adRate}%` : "0%"}</p>
                      <p className="text-xs text-muted-foreground">PR/Ad率</p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* AIレポート (デフォルト展開) */}
            {((job.crossAnalysis as any)?.report?.length > 0 || (job.crossAnalysis as any)?.summary) && (
              <AITrendReport
                report={(job.crossAnalysis as any)?.report}
                fallbackSummary={(job.crossAnalysis as any)?.summary}
              />
            )}

            {/* パフォーマンス分類 (常時表示) */}
            {(job.crossAnalysis as any)?.statistics?.performanceClassification && (
              <PerformanceClassification
                data={(job.crossAnalysis as any).statistics.performanceClassification}
                total={(job.crossAnalysis as any).statistics.totalVideos}
              />
            )}

            {/* 5グループのAccordion */}
            {(job.crossAnalysis as any)?.statistics && (() => {
              const statistics = (job.crossAnalysis as any).statistics as TrendStatistics;
              return (
                <>
                {/* 1. 需要トレンド分析 (常時表示) */}
                {statistics.queryFreshness && statistics.queryFreshness.length > 0 && (
                  <QueryFreshnessChart data={statistics.queryFreshness} />
                )}

                <Accordion type="multiple" className="space-y-2">
                  {/* 2. ハッシュタグ分析 */}
                  <AccordionItem value="hashtag-analysis" className="border rounded-xl">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/40 font-semibold text-sm">
                      ハッシュタグ分析
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4 space-y-6">
                      <TrendingHashtags data={(job.crossAnalysis as any)?.trendingHashtags || []} />
                      {statistics.hashtagPerformance.length > 0 && (
                        <HashtagPerformanceChart data={statistics.hashtagPerformance} globalMedianER={statistics.engagementStats.er.median} />
                      )}
                      <CoOccurringTags data={(job.crossAnalysis as any)?.coOccurringTags || []} />
                    </AccordionContent>
                  </AccordionItem>

                  {/* 3. エンゲージメント詳細 */}
                  <AccordionItem value="engagement-detail" className="border rounded-xl">
                    <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/40 font-semibold text-sm">
                      エンゲージメント詳細
                    </AccordionTrigger>
                    <AccordionContent className="px-4 pb-4 space-y-6">
                      <EngagementStatsTable stats={statistics.engagementStats} extremeVideos={statistics.extremeVideos} />
                      <FollowerErScatter data={statistics.followerErScatter} tiers={statistics.followerTierSummary} />
                      {statistics.durationBands.length > 0 && (
                        <DurationBandsChart data={statistics.durationBands} globalMedianER={statistics.engagementStats.er.median} />
                      )}
                      <TrendPostingTimeHeatmap grid={statistics.postingTimeGrid} bestSlots={statistics.bestTimeSlots} />
                      {statistics.playCountDistribution.length > 0 && (
                        <PlayCountDistribution data={statistics.playCountDistribution} />
                      )}
                    </AccordionContent>
                  </AccordionItem>

                  {/* 4. PR/Ad・SEO分析 */}
                  {(statistics.adInsight || (statistics.seoMetaKeywords && statistics.seoMetaKeywords.keywordRanking.length > 0)) && (
                    <AccordionItem value="pr-seo" className="border rounded-xl">
                      <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/40 font-semibold text-sm">
                        PR/Ad・SEO分析
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4 space-y-6">
                        {statistics.adInsight && (
                          <AdInsightSection data={statistics.adInsight} />
                        )}
                        {statistics.seoMetaKeywords && statistics.seoMetaKeywords.keywordRanking.length > 0 && (
                          <TrendSeoMetaKeywordsSection data={statistics.seoMetaKeywords} />
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {/* 5. トップ動画・クリエイター */}
                  {(((job.crossAnalysis as any)?.topVideos?.length > 0) || ((job.crossAnalysis as any)?.keyCreators?.length > 0)) && (
                    <AccordionItem value="top-videos-creators" className="border rounded-xl">
                      <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/40 font-semibold text-sm">
                        トップ動画・クリエイター
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4">
                        <TopVideosAndCreators
                          videos={(job.crossAnalysis as any)?.topVideos || []}
                          creators={(job.crossAnalysis as any)?.keyCreators || []}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  )}
                </Accordion>
                </>
              );
            })()}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

// ---- AIレポート (Accordion化 + 構造化表示) ----

const REPORT_SECTION_ICONS: Record<string, React.ReactNode> = {
  TrendingUp: <TrendingUp className="h-4 w-4" />,
  Hash: <Hash className="h-4 w-4" />,
  Play: <Play className="h-4 w-4" />,
  Users: <Users className="h-4 w-4" />,
  Sparkles: <Sparkles className="h-4 w-4" />,
};

function AITrendReport({ report, fallbackSummary }: {
  report?: Array<{ id: string; title: string; icon: string; content: string; bullets?: string[]; dataHighlights?: string[]; recommendation?: string }>;
  fallbackSummary?: string;
}) {
  // 新形式: report セクション配列がある場合
  if (report && report.length > 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            AIトレンドレポート
            <span className="text-xs font-normal text-muted-foreground ml-1">{report.length}セクション</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Accordion type="multiple" defaultValue={["overview"]} className="space-y-2">
            {report.map((section) => {
              const icon = REPORT_SECTION_ICONS[section.icon] ?? <FileText className="h-4 w-4" />;
              const hasBullets = section.bullets && section.bullets.length > 0;
              return (
                <AccordionItem key={section.id} value={section.id} className="border rounded-xl">
                  <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/40 font-semibold text-sm">
                    <span className="flex items-center gap-2">
                      {icon}
                      {section.title}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    {hasBullets ? (
                      <div className="space-y-3">
                        {/* dataHighlights — インラインバッジ行 */}
                        {section.dataHighlights && section.dataHighlights.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {section.dataHighlights.map((h, i) => (
                              <span key={i} className="bg-muted rounded px-2 py-0.5 text-xs">{h}</span>
                            ))}
                          </div>
                        )}
                        {/* bullets — リスト */}
                        <ul className="space-y-1.5">
                          {section.bullets!.map((b, i) => (
                            <li key={i} className="text-sm flex gap-2">
                              <span className="text-muted-foreground shrink-0 mt-0.5">•</span>
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                        {/* recommendation — アクションカード */}
                        {section.recommendation && (
                          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg p-3">
                            <p className="text-sm flex items-start gap-2">
                              <Sparkles className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                              <span><span className="font-medium text-blue-700 dark:text-blue-300">推奨: </span>{section.recommendation}</span>
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* fallback: 旧データ — ReactMarkdown表示 */
                      <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-sm prose-headings:font-bold prose-headings:mt-3 prose-headings:mb-1.5 first:prose-headings:mt-0 prose-p:leading-relaxed prose-p:my-1.5 prose-li:leading-relaxed prose-li:my-0.5 prose-strong:text-foreground prose-ul:my-1.5">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.content}</ReactMarkdown>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </CardContent>
      </Card>
    );
  }

  // フォールバック: 旧形式の単一 summary
  if (!fallbackSummary) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          AIトレンド分析
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-base prose-headings:font-bold prose-headings:mt-5 prose-headings:mb-2 first:prose-headings:mt-0 prose-p:leading-relaxed prose-li:leading-relaxed prose-strong:text-foreground">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{fallbackSummary}</ReactMarkdown>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- トレンドハッシュタグ (inline) ----

function TrendingHashtags({ data }: { data: Array<{ tag: string; videoCount: number; queryCount: number; avgER: number }> }) {
  if (data.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Hash className="h-4 w-4" />
        トレンドハッシュタグ
        <span className="text-xs font-normal text-muted-foreground">{data.length}件</span>
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="pb-2 pr-4 font-medium text-muted-foreground">#</th>
              <th className="pb-2 pr-4 font-medium text-muted-foreground">タグ</th>
              <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">出現動画数</th>
              <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">クエリ横断数</th>
              <th className="pb-2 font-medium text-muted-foreground text-right">平均ER(%)</th>
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 30).map((t, i) => (
              <tr key={t.tag} className="border-b last:border-0">
                <td className="py-2 pr-4 text-muted-foreground">{i + 1}</td>
                <td className="py-2 pr-4 font-medium">#{t.tag}</td>
                <td className="py-2 pr-4 text-right">{t.videoCount}</td>
                <td className="py-2 pr-4 text-right">{t.queryCount}</td>
                <td className="py-2 text-right">{t.avgER}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- トップ動画 / キークリエイター (inline, タブ切替) ----

type SortKey = "er" | "playCount" | "diggCount" | "commentCount" | "shareCount" | "collectCount";
const SORT_OPTIONS: Array<{ key: SortKey; label: string; icon: React.ReactNode }> = [
  { key: "er", label: "ER%順", icon: <Play className="h-3 w-3" /> },
  { key: "playCount", label: "再生数順", icon: <Eye className="h-3 w-3" /> },
  { key: "diggCount", label: "いいね順", icon: <Heart className="h-3 w-3" /> },
  { key: "commentCount", label: "コメント順", icon: <MessageCircle className="h-3 w-3" /> },
  { key: "shareCount", label: "シェア順", icon: <Share2 className="h-3 w-3" /> },
  { key: "collectCount", label: "保存順", icon: <Bookmark className="h-3 w-3" /> },
];

function TopVideosAndCreators({ videos, creators }: {
  videos: Array<{
    videoId: string; desc: string; authorUniqueId: string; authorNickname: string;
    playCount: number; diggCount?: number; commentCount?: number; shareCount?: number; collectCount?: number;
    er: number; coverUrl: string; hashtags: string[];
  }>;
  creators: Array<{ uniqueId: string; nickname: string; avatarUrl: string; followerCount: number; videoCount: number; queryCount: number; totalPlays: number }>;
}) {
  const [tab, setTab] = useState<"videos" | "creators">("videos");
  const [sortBy, setSortBy] = useState<SortKey>("er");
  const [sortOpen, setSortOpen] = useState(false);
  if (videos.length === 0 && creators.length === 0) return null;

  const formatCount = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  const sorted = [...videos].sort((a, b) => {
    const aVal = sortBy === "er" ? a.er : ((a as any)[sortBy] ?? 0);
    const bVal = sortBy === "er" ? b.er : ((b as any)[sortBy] ?? 0);
    return bVal - aVal;
  });
  const currentOption = SORT_OPTIONS.find(o => o.key === sortBy)!;

  return (
    <div>
      {/* タブ切替 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1 p-0.5 bg-muted rounded-lg">
          <button
            onClick={() => setTab("videos")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${tab === "videos" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Play className="h-3 w-3" />
            トップ動画
          </button>
          <button
            onClick={() => setTab("creators")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${tab === "creators" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Users className="h-3 w-3" />
            キークリエイター
          </button>
        </div>
        {tab === "videos" && (
          <div className="relative">
            <button
              onClick={() => setSortOpen(!sortOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-md hover:bg-accent transition-colors"
            >
              {currentOption.icon}
              <span>{currentOption.label}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
            {sortOpen && (
              <div className="absolute right-0 top-full mt-1 z-10 bg-background border rounded-md shadow-lg py-1 min-w-[140px]">
                {SORT_OPTIONS.map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => { setSortBy(opt.key); setSortOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors ${sortBy === opt.key ? "font-medium bg-accent/50" : ""}`}
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 動画タブ */}
      {tab === "videos" && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sorted.slice(0, 12).map((v) => (
            <a
              key={v.videoId}
              href={`https://www.tiktok.com/@${v.authorUniqueId}/video/${v.videoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border p-3 hover:bg-accent/50 transition-colors"
            >
              <div className="flex gap-3">
                {v.coverUrl && (
                  <img src={v.coverUrl} alt="" className="w-16 h-20 object-cover rounded flex-shrink-0" loading="lazy" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">@{v.authorUniqueId}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{v.desc}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-0.5"><Eye className="h-3 w-3" /> {formatCount(v.playCount)}</span>
                    <span className="flex items-center gap-0.5"><Heart className="h-3 w-3" /> {formatCount(v.diggCount ?? 0)}</span>
                    <span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" /> {formatCount(v.commentCount ?? 0)}</span>
                    <span className="font-medium text-primary">ER {v.er}%</span>
                  </div>
                </div>
              </div>
              {v.hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {v.hashtags.slice(0, 5).map(tag => (
                    <span key={tag} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">#{tag}</span>
                  ))}
                </div>
              )}
            </a>
          ))}
        </div>
      )}

      {/* クリエイタータブ */}
      {tab === "creators" && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {creators.map((c) => (
            <a
              key={c.uniqueId}
              href={`https://www.tiktok.com/@${c.uniqueId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 border rounded-lg p-3 hover:bg-accent/50 transition-colors"
            >
              {c.avatarUrl ? (
                <img src={c.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" loading="lazy" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <Users className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">@{c.uniqueId}</p>
                <p className="text-xs text-muted-foreground truncate">{c.nickname}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <span>{formatCount(c.followerCount)} followers</span>
                  <span>{c.videoCount}動画</span>
                  <span>{c.queryCount}クエリ</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- 共起タグ (inline) ----

function CoOccurringTags({ data }: { data: Array<{ tagA: string; tagB: string; count: number }> }) {
  if (data.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Share2 className="h-4 w-4" />
        共起タグペア
        <span className="text-xs font-normal text-muted-foreground">{data.length}件</span>
      </h4>
      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {data.slice(0, 15).map((p, i) => (
          <div key={`${p.tagA}-${p.tagB}`} className="flex items-center justify-between border rounded-lg px-3 py-2">
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">{i + 1}.</span>
              <Badge variant="secondary" className="text-xs">#{p.tagA}</Badge>
              <span className="text-muted-foreground">+</span>
              <Badge variant="secondary" className="text-xs">#{p.tagB}</Badge>
            </div>
            <span className="text-sm font-medium">{p.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
