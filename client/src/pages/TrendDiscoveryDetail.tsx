import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { AlertTriangle, ArrowLeft, Bookmark, CheckCircle, ChevronDown, ChevronRight, Download, Eye, FileText, Hash, Heart, Loader2, MessageCircle, Play, RefreshCcw, Search, Share2, Sparkles, TrendingUp, Users } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useLocation } from "wouter";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import TrendStatisticsPanel from "@/components/TrendStatisticsPanel";

export default function TrendDiscoveryDetail() {
  const params = useParams<{ id: string }>();
  const jobId = Number(params.id);
  const [, setLocation] = useLocation();
  const executedRef = useRef(false);

  const jobQuery = trpc.trendDiscovery.getById.useQuery(
    { jobId },
    { enabled: !!jobId, refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === "processing" ? 3000 : false;
    }},
  );

  const progressQuery = trpc.trendDiscovery.getProgress.useQuery(
    { jobId },
    {
      enabled: !!jobId && jobQuery.data?.status === "processing",
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
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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

        {/* Processing */}
        {job.status === "processing" && (
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

            {/* AIレポート (最重要 — 高レベルインサイトを最初に) */}
            {((job.crossAnalysis as any)?.report?.length > 0 || (job.crossAnalysis as any)?.summary) && (
              <AITrendReport
                report={(job.crossAnalysis as any)?.report}
                fallbackSummary={(job.crossAnalysis as any)?.summary}
              />
            )}

            {/* 統計分析 (鮮度・PR/Adインサイト・SEOキーワード) */}
            {(job.crossAnalysis as any)?.statistics && (
              <TrendStatisticsPanel statistics={(job.crossAnalysis as any).statistics} />
            )}

            {/* トレンドハッシュタグ */}
            <TrendingHashtags data={(job.crossAnalysis as any)?.trendingHashtags || []} />

            {/* トップ動画 */}
            <TopVideos data={(job.crossAnalysis as any)?.topVideos || []} />

            {/* キークリエイター */}
            <KeyCreators data={(job.crossAnalysis as any)?.keyCreators || []} />

            {/* 共起タグ */}
            <CoOccurringTags data={(job.crossAnalysis as any)?.coOccurringTags || []} />

            {/* 拡張キーワード・ハッシュタグ (参考データ — 末尾へ) */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  拡張されたクエリ
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">キーワード</p>
                  <div className="flex flex-wrap gap-2">
                    {(job.expandedKeywords as string[] || []).map((kw) => (
                      <Badge key={kw} variant="secondary">{kw}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">ハッシュタグ</p>
                  <div className="flex flex-wrap gap-2">
                    {(job.expandedHashtags as string[] || []).map((ht) => (
                      <Badge key={ht} variant="outline">#{ht}</Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

// ---- 汎用アコーディオンセクション ----

function CollapsibleSection({ icon, title, subtitle, defaultOpen = false, children }: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none hover:bg-accent/30 transition-colors">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                {icon}
                {title}
                {subtitle && (
                  <span className="text-xs font-normal text-muted-foreground ml-1">{subtitle}</span>
                )}
              </CardTitle>
              <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            {children}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ---- AIレポート (複数セクション) ----

const REPORT_SECTION_ICONS: Record<string, React.ReactNode> = {
  TrendingUp: <TrendingUp className="h-4 w-4" />,
  Hash: <Hash className="h-4 w-4" />,
  Play: <Play className="h-4 w-4" />,
  Users: <Users className="h-4 w-4" />,
  Sparkles: <Sparkles className="h-4 w-4" />,
};

// SEOレポートと統一したblue基調のトーン
const REPORT_SECTION_COLORS: Record<string, { gradient: string; badge: string }> = {
  overview:          { gradient: "from-blue-600 to-blue-700", badge: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  hashtag_strategy:  { gradient: "from-blue-600 to-blue-700", badge: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  content_insights:  { gradient: "from-blue-600 to-blue-700", badge: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  creator_analysis:  { gradient: "from-blue-600 to-blue-700", badge: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  action_plan:       { gradient: "from-blue-600 to-blue-700", badge: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
};

function AITrendReport({ report, fallbackSummary }: {
  report?: Array<{ id: string; title: string; icon: string; content: string }>;
  fallbackSummary?: string;
}) {
  const [open, setOpen] = useState(false);

  // 新形式: report セクション配列がある場合
  if (report && report.length > 0) {
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <Card className="overflow-hidden">
          <CollapsibleTrigger asChild>
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-5 py-3 cursor-pointer hover:from-blue-700 hover:to-blue-800 transition-colors">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/20 backdrop-blur-sm">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-bold text-white">AIトレンドレポート</h3>
                  <p className="text-xs text-white/70">データに基づく{report.length}セクションの分析レポート</p>
                </div>
                <ChevronDown className={`h-5 w-5 text-white/70 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
              </div>
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="divide-y">
              {report.map((section, idx) => {
                const colors = REPORT_SECTION_COLORS[section.id] ?? { gradient: "from-gray-600 to-gray-700", badge: "bg-gray-100 text-gray-700" };
                const icon = REPORT_SECTION_ICONS[section.icon] ?? <FileText className="h-4 w-4" />;
                return (
                  <ReportSection key={section.id || idx} section={section} colors={colors} icon={icon} idx={idx} total={report.length} />
                );
              })}
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    );
  }

  // フォールバック: 旧形式の単一 summary
  if (!fallbackSummary) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="overflow-hidden shadow-lg">
        <CollapsibleTrigger asChild>
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 cursor-pointer hover:from-blue-700 hover:to-blue-800 transition-colors">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/20 backdrop-blur-sm">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-white">AIトレンド分析</h3>
                <p className="text-xs text-white/70">データに基づくインサイトと推奨アクション</p>
              </div>
              <ChevronDown className={`h-5 w-5 text-white/70 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-6 pb-6">
            <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-base prose-headings:font-bold prose-headings:mt-5 prose-headings:mb-2 first:prose-headings:mt-0 prose-p:leading-relaxed prose-li:leading-relaxed prose-strong:text-foreground">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{fallbackSummary}</ReactMarkdown>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function ReportSection({ section, colors, icon, idx, total }: {
  section: { id: string; title: string; content: string };
  colors: { gradient: string; badge: string };
  icon: React.ReactNode;
  idx: number;
  total: number;
}) {
  const [open, setOpen] = useState(idx === 0);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <div className={`bg-gradient-to-r ${colors.gradient} px-5 py-3 cursor-pointer hover:brightness-110 transition-all`}>
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-6 h-6 rounded-md bg-white/20 backdrop-blur-sm">
              <span className="text-white">{icon}</span>
            </div>
            <h4 className="text-sm font-bold text-white flex-1">{section.title}</h4>
            <span className="text-[10px] text-white/60 font-medium mr-2">{idx + 1}/{total}</span>
            <ChevronDown className={`h-4 w-4 text-white/70 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <CardContent className="pt-4 pb-4">
          <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-sm prose-headings:font-bold prose-headings:mt-3 prose-headings:mb-1.5 first:prose-headings:mt-0 prose-p:leading-relaxed prose-p:my-1.5 prose-li:leading-relaxed prose-li:my-0.5 prose-strong:text-foreground prose-ul:my-1.5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.content}</ReactMarkdown>
          </div>
        </CardContent>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TrendingHashtags({ data }: { data: Array<{ tag: string; videoCount: number; queryCount: number; avgER: number }> }) {
  if (data.length === 0) return null;
  return (
    <CollapsibleSection
      icon={<Hash className="h-4 w-4" />}
      title="トレンドハッシュタグ"
      subtitle={`${data.length}件`}
    >
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
    </CollapsibleSection>
  );
}

type SortKey = "er" | "playCount" | "diggCount" | "commentCount" | "shareCount" | "collectCount";
const SORT_OPTIONS: Array<{ key: SortKey; label: string; icon: React.ReactNode }> = [
  { key: "er", label: "ER%順", icon: <Play className="h-3 w-3" /> },
  { key: "playCount", label: "再生数順", icon: <Eye className="h-3 w-3" /> },
  { key: "diggCount", label: "いいね順", icon: <Heart className="h-3 w-3" /> },
  { key: "commentCount", label: "コメント順", icon: <MessageCircle className="h-3 w-3" /> },
  { key: "shareCount", label: "シェア順", icon: <Share2 className="h-3 w-3" /> },
  { key: "collectCount", label: "保存順", icon: <Bookmark className="h-3 w-3" /> },
];

function TopVideos({ data }: { data: Array<{
  videoId: string; desc: string; authorUniqueId: string; authorNickname: string;
  playCount: number; diggCount?: number; commentCount?: number; shareCount?: number; collectCount?: number;
  er: number; coverUrl: string; hashtags: string[];
}> }) {
  const [sortBy, setSortBy] = useState<SortKey>("er");
  const [isOpen, setIsOpen] = useState(false);
  if (data.length === 0) return null;

  const formatCount = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  const sorted = [...data].sort((a, b) => {
    const aVal = sortBy === "er" ? a.er : ((a as any)[sortBy] ?? 0);
    const bVal = sortBy === "er" ? b.er : ((b as any)[sortBy] ?? 0);
    return bVal - aVal;
  });

  const currentOption = SORT_OPTIONS.find(o => o.key === sortBy)!;

  return (
    <CollapsibleSection
      icon={<Play className="h-4 w-4" />}
      title="トップ動画"
      subtitle={`${data.length}件`}
    >
      <div className="mb-3 flex justify-end">
        <div className="relative">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-md hover:bg-accent transition-colors"
          >
            {currentOption.icon}
            <span>{currentOption.label}</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
          {isOpen && (
            <div className="absolute right-0 top-full mt-1 z-10 bg-background border rounded-md shadow-lg py-1 min-w-[140px]">
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => { setSortBy(opt.key); setIsOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors ${sortBy === opt.key ? "font-medium bg-accent/50" : ""}`}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
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
                <img
                  src={v.coverUrl}
                  alt=""
                  className="w-16 h-20 object-cover rounded flex-shrink-0"
                  loading="lazy"
                />
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
    </CollapsibleSection>
  );
}

function CoOccurringTags({ data }: { data: Array<{ tagA: string; tagB: string; count: number }> }) {
  if (data.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Share2 className="h-4 w-4" />
          共起タグペア
        </CardTitle>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}

function KeyCreators({ data }: { data: Array<{ uniqueId: string; nickname: string; avatarUrl: string; followerCount: number; videoCount: number; queryCount: number; totalPlays: number }> }) {
  if (data.length === 0) return null;

  const formatCount = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  return (
    <CollapsibleSection
      icon={<Users className="h-4 w-4" />}
      title="キークリエイター"
      subtitle={`${data.length}件`}
    >
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {data.map((c) => (
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
    </CollapsibleSection>
  );
}
