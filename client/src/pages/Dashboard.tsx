import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { DashboardSkeleton } from "@/components/PageSkeleton";
import DashboardLayout from "@/components/DashboardLayout";
import {
  BarChart3, TrendingUp, Search, ArrowRight, AlertTriangle,
  Layers, X, Loader2, Compass, Hash, Clock, Smile, Frown, Minus,
  Lightbulb, Users, Ruler, Play, Zap, Megaphone, Sparkles,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.analysis.dashboard.useQuery(undefined, {
    refetchInterval: (query) => {
      const d = query.state.data as typeof data | undefined;
      if (!d) return false;
      const hasActive = d.activeJobs.analysis.length > 0 || d.activeJobs.trend.length > 0 || d.activeJobs.campaign.length > 0;
      return hasActive ? 3000 : false;
    },
  });

  const { data: insights } = trpc.analysis.platformInsights.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  const cancelAnalysis = trpc.analysis.cancel.useMutation({
    onSuccess: () => utils.analysis.dashboard.invalidate(),
  });
  const cancelTrend = trpc.trendDiscovery.cancel.useMutation({
    onSuccess: () => utils.analysis.dashboard.invalidate(),
  });

  if (isLoading) {
    return <DashboardLayout><DashboardSkeleton /></DashboardLayout>;
  }

  const hasActiveJobs = data && (
    data.activeJobs.analysis.length > 0 ||
    data.activeJobs.trend.length > 0 ||
    data.activeJobs.campaign.length > 0
  );

  // Duration performance: sort by ER desc, assign verdict
  const rankedDurations = insights?.durationPerformance
    ? [...insights.durationPerformance].sort((a, b) => b.avgER - a.avgER).map((d, i) => ({
        ...d,
        verdict: i === 0 ? "Best" as const : i < 3 ? "Good" as const : "Weak" as const,
      }))
    : [];

  // Format summary for duration
  const formatSummary = (() => {
    if (rankedDurations.length === 0) return "";
    const bestER = rankedDurations[0];
    const bestViews = [...rankedDurations].sort((a, b) => b.avgViews - a.avgViews)[0];
    if (bestER.label === bestViews.label) {
      return `${bestER.label}の動画がER ${bestER.avgER}%・平均${bestER.avgViews.toLocaleString()}再生で最も効果的。`;
    }
    return `${bestER.label}がER ${bestER.avgER}%で最高。再生数なら${bestViews.label}が${bestViews.avgViews.toLocaleString()}再生で優位。`;
  })();

  // Heatmap helpers
  const heatmapDays = ["月", "火", "水", "木", "金", "土", "日"];
  const heatmapBands = ["朝", "昼", "夕", "夜"];
  const getHeatmapIntensity = (er: number, maxER: number) => {
    if (er === 0) return 0;
    const ratio = er / maxER;
    if (ratio > 0.8) return 4;
    if (ratio > 0.6) return 3;
    if (ratio > 0.35) return 2;
    return 1;
  };
  const maxHeatmapER = insights?.postingHeatmap
    ? Math.max(...heatmapBands.flatMap(b => heatmapDays.map(d => (insights.postingHeatmap as any)?.[b]?.[d]?.er ?? 0)), 0.01)
    : 1;

  // Sentiment best
  const sentimentBest = insights?.sentimentAnalysis
    ? [...insights.sentimentAnalysis].sort((a, b) => b.avgER - a.avgER)[0]
    : null;
  const sentimentLabels: Record<string, string> = { positive: "ポジティブ", neutral: "中立", negative: "ネガティブ" };

  // Creator insight
  const bestReachCreator = insights?.topCreators?.[0];
  const bestERCreator = insights?.topCreators
    ? [...insights.topCreators].sort((a, b) => b.avgER - a.avgER)[0]
    : null;

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">ダッシュボード</h1>
            <p className="text-sm text-muted-foreground mt-1">コンテンツ戦略の全体像</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setLocation("/trend-discovery")}>
              <Compass className="h-4 w-4 mr-1.5" />
              トレンド発掘
            </Button>
            <Button size="sm" className="gradient-primary text-white" onClick={() => setLocation("/analysis/new")}>
              <Search className="h-4 w-4 mr-1.5" />
              新規分析
            </Button>
          </div>
        </div>

        {/* === 進行中ジョブバナー === */}
        {hasActiveJobs && (
          <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-800">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                  進行中のジョブ
                </CardTitle>
                {(data?.kpi.failedJobs ?? 0) > 0 && (
                  <Button variant="ghost" size="sm" className="text-xs text-red-600 hover:text-red-700 h-auto py-1" onClick={() => setLocation("/activity")}>
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {data!.kpi.failedJobs}件の失敗あり
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {data!.activeJobs.analysis.map(job => {
                const prog = job.progress as { message?: string; percent?: number } | null;
                return (
                  <div key={`a-${job.id}`} className="flex items-center gap-3 p-2 rounded-lg bg-white/60 dark:bg-white/5">
                    <Badge variant="secondary" className="shrink-0 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">SEO</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{job.keyword || "手動URL"}</div>
                      <div className="text-xs text-muted-foreground">{prog?.message || "処理中..."}</div>
                      <Progress value={prog?.percent ?? 0} className="h-1.5 mt-1" />
                    </div>
                    <CancelButton label={`「${job.keyword || "手動URL"}」の分析を中止します。`} onConfirm={() => cancelAnalysis.mutate({ jobId: job.id })} />
                  </div>
                );
              })}
              {data!.activeJobs.trend.map(job => {
                const prog = job.progress as { message?: string; percent?: number } | null;
                return (
                  <div key={`t-${job.id}`} className="flex items-center gap-3 p-2 rounded-lg bg-white/60 dark:bg-white/5">
                    <Badge variant="secondary" className="shrink-0 bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">トレンド</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{job.persona}</div>
                      <div className="text-xs text-muted-foreground">{prog?.message || "処理中..."}</div>
                      <Progress value={prog?.percent ?? 0} className="h-1.5 mt-1" />
                    </div>
                    <CancelButton label={`「${job.persona}」のトレンド発掘を中止します。`} onConfirm={() => cancelTrend.mutate({ jobId: job.id })} />
                  </div>
                );
              })}
              {data!.activeJobs.campaign.map(job => {
                const prog = job.progress as { message?: string; percent?: number } | null;
                return (
                  <div key={`c-${job.id}`} className="flex items-center gap-3 p-2 rounded-lg bg-white/60 dark:bg-white/5">
                    <Badge variant="secondary" className="shrink-0 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">施策</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{job.campaignName} ({job.snapshotType === "baseline" ? "ベースライン" : "効果測定"})</div>
                      <div className="text-xs text-muted-foreground">{prog?.message || "処理中..."}</div>
                      <Progress value={prog?.percent ?? 0} className="h-1.5 mt-1" />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* === KPIカード === */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="relative overflow-hidden">
            <CardContent className="pt-6 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">分析実行数</p>
                  <div className="text-3xl font-bold mt-1 tabular-nums">{data?.kpi.totalAnalyses || 0}</div>
                  {(data?.kpi.weeklyDelta ?? 0) > 0 && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />今週 +{data!.kpi.weeklyDelta}
                    </p>
                  )}
                </div>
                <div className="h-12 w-12 rounded-xl bg-blue-50 dark:bg-blue-950 flex items-center justify-center">
                  <BarChart3 className="h-6 w-6 text-blue-500" />
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-400 to-blue-600" />
            </CardContent>
          </Card>
          <Card className="relative overflow-hidden">
            <CardContent className="pt-6 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">解析済み動画</p>
                  <div className="text-3xl font-bold mt-1 tabular-nums">{insights?.stats.totalVideos?.toLocaleString() || "0"}</div>
                  <p className="text-xs text-muted-foreground mt-1">全期間</p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-purple-50 dark:bg-purple-950 flex items-center justify-center">
                  <Play className="h-6 w-6 text-purple-500" />
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-400 to-purple-600" />
            </CardContent>
          </Card>
        </div>

        {/* 失敗ジョブ通知 (バナーが非表示の場合のみ) */}
        {!hasActiveJobs && (data?.kpi.failedJobs ?? 0) > 0 && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-sm">
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
            <span className="text-red-700 dark:text-red-400">{data!.kpi.failedJobs}件のジョブが失敗しています</span>
            <Button variant="ghost" size="sm" className="ml-auto text-xs h-auto py-1" onClick={() => setLocation("/activity")}>
              履歴を確認 <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
        )}

        {/* === 最近のアクティビティ (5件) === */}
        {data?.recentActivity && data.recentActivity.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" />
                最近のアクティビティ
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.recentActivity.map((item, i) => (
                  item.type === "seo" ? (
                    <div
                      key={`seo-${item.jobId}`}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 cursor-pointer card-interactive animate-list-item"
                      style={{ animationDelay: `${i * 50}ms` }}
                      onClick={() => setLocation(`/analysis/${item.jobId}`)}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">SEO</Badge>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">{item.keyword}</div>
                          <div className="text-xs text-muted-foreground">
                            {format(new Date(item.date), "M月d日 HH:mm", { locale: ja })} / {item.totalVideos}本 / {item.totalViews.toLocaleString()}再生
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex h-2 w-16 rounded-full overflow-hidden bg-muted">
                          <div className="bg-green-500" style={{ width: `${item.positivePercentage ?? 0}%` }} />
                          <div className="bg-red-400" style={{ width: `${item.negativePercentage ?? 0}%` }} />
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </div>
                    </div>
                  ) : (
                    <div
                      key={`trend-${item.jobId}`}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 cursor-pointer card-interactive animate-list-item"
                      style={{ animationDelay: `${i * 50}ms` }}
                      onClick={() => setLocation(`/trend-discovery/${item.jobId}`)}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">トレンド</Badge>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">{item.persona}</div>
                          <div className="text-xs text-muted-foreground">
                            {format(new Date(item.date), "M月d日 HH:mm", { locale: ja })} / KW {item.keywordCount}個 / #{item.hashtagCount}個
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1">
                          {item.topTags.map(tag => (
                            <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0 border-purple-300 text-purple-600 dark:border-purple-700 dark:text-purple-400">
                              #{tag}
                            </Badge>
                          ))}
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </div>
                    </div>
                  )
                ))}
              </div>
              <div className="pt-3 border-t mt-3">
                <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => setLocation("/activity")}>
                  すべての履歴を見る
                  <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 空状態 */}
        {(!data?.recentActivity || data.recentActivity.length === 0) && (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon"><BarChart3 className="h-6 w-6" /></EmptyMedia>
              <EmptyTitle>まだ分析結果がありません</EmptyTitle>
              <EmptyDescription>
                キーワードを入力して最初のVSEO分析を始めましょう。上位動画の自動収集からAIレポート生成まで、約30分で完了します。
              </EmptyDescription>
            </EmptyHeader>
            <Button onClick={() => setLocation("/analysis/new")} className="gradient-primary text-white">
              <Search className="mr-2 h-4 w-4" />最初の分析を始める
            </Button>
          </Empty>
        )}

        {/* === コンテンツ戦略インテリジェンス === */}
        {insights && insights.stats.totalVideos > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                コンテンツ戦略インテリジェンス
              </CardTitle>
              <CardDescription>
                {insights.stats.totalVideos.toLocaleString()}本の動画データに基づく戦略分析（直近30日） — ER = エンゲージメント率
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Panel A: フォーマット最適化 */}
                {rankedDurations.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-3 flex items-center gap-1.5">
                      <Ruler className="h-3.5 w-3.5 text-blue-500" />
                      フォーマット最適化
                    </h4>
                    <div className="space-y-1.5">
                      {rankedDurations.map((d, i) => (
                        <div
                          key={d.label}
                          className={`flex items-center gap-3 p-2 rounded-lg text-sm ${
                            i === 0
                              ? "bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800"
                              : "bg-muted/30"
                          }`}
                        >
                          <span className="w-16 shrink-0 font-medium">{d.label}</span>
                          <span className="flex-1 tabular-nums text-muted-foreground text-xs">
                            {d.avgViews.toLocaleString()}再生
                          </span>
                          <Badge
                            variant={i === 0 ? "default" : "secondary"}
                            className={`text-xs ${i === 0 ? "bg-teal-600 hover:bg-teal-600" : ""}`}
                          >
                            ER {d.avgER}%
                          </Badge>
                          <span className="text-xs text-muted-foreground w-10 text-right">{d.count}本</span>
                          <Badge variant="outline" className={`text-[10px] px-1.5 ${
                            d.verdict === "Best" ? "border-teal-400 text-teal-700 dark:text-teal-400" :
                            d.verdict === "Good" ? "border-blue-300 text-blue-600 dark:text-blue-400" :
                            "border-amber-300 text-amber-600 dark:text-amber-400"
                          }`}>
                            {d.verdict}
                          </Badge>
                        </div>
                      ))}
                    </div>
                    {formatSummary && (
                      <p className="text-xs text-muted-foreground mt-2 p-2 bg-blue-50/50 dark:bg-blue-950/20 rounded-lg">
                        <Lightbulb className="h-3 w-3 inline mr-1" />
                        {formatSummary}
                      </p>
                    )}
                  </div>
                )}

                {/* Panel B: ハッシュタグ戦略 */}
                {insights.topHashtags.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-3 flex items-center gap-1.5">
                      <Hash className="h-3.5 w-3.5 text-sky-500" />
                      ハッシュタグ戦略
                    </h4>
                    {/* Tier 1: Top 3 with ER bars */}
                    <div className="space-y-1.5 mb-3">
                      {insights.topHashtags.slice(0, 3).map(h => {
                        const maxER = Math.max(...insights.topHashtags.slice(0, 3).map(x => x.avgER), 0.01);
                        return (
                          <div key={h.tag} className="flex items-center gap-2 text-sm">
                            <span className="w-28 shrink-0 font-medium truncate">#{h.tag}</span>
                            <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-sky-500 rounded-full" style={{ width: `${(h.avgER / maxER) * 100}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground w-10 text-right shrink-0">{h.count}本</span>
                            <Badge variant="outline" className="text-[10px] shrink-0">ER {h.avgER}%</Badge>
                          </div>
                        );
                      })}
                    </div>
                    {/* Tier 2: Remaining as badges */}
                    {insights.topHashtags.length > 3 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {insights.topHashtags.slice(3).map(h => (
                          <Badge key={h.tag} variant="secondary" className="text-xs">
                            #{h.tag} <span className="ml-1 opacity-50">{h.count}</span>
                          </Badge>
                        ))}
                      </div>
                    )}
                    {/* Combinations */}
                    {insights.topHashtagCombinations && insights.topHashtagCombinations.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1.5">効果的な組合せ</p>
                        <div className="space-y-1">
                          {insights.topHashtagCombinations.map((combo, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs">
                              <span className="w-4 shrink-0 font-bold text-muted-foreground">{i + 1}.</span>
                              <span className="flex-1 truncate">
                                {combo.tags.map(t => `#${t}`).join(" + ")}
                              </span>
                              <Badge variant="outline" className="text-[10px]">{formatNumber(combo.avgViews)}再生</Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Panel C: 注目クリエイター */}
                {insights.topCreators && insights.topCreators.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-3 flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-violet-500" />
                      注目クリエイター
                    </h4>
                    <div className="space-y-2">
                      {insights.topCreators.map((creator, i) => (
                        <div key={creator.accountName} className="flex items-center gap-3 text-sm">
                          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-violet-400 to-purple-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="font-medium truncate block text-sm">{creator.accountName.startsWith("@") ? creator.accountName : `@${creator.accountName}`}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatNumber(creator.followerCount)}フォロワー / {creator.videoCount}本
                            </span>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-xs tabular-nums">{formatNumber(creator.totalPlays)}再生</div>
                            <Badge variant="outline" className="text-[10px]">ER {creator.avgER}%</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                    {bestReachCreator && bestERCreator && bestReachCreator.accountName !== bestERCreator.accountName && (
                      <p className="text-xs text-muted-foreground mt-2 p-2 bg-violet-50/50 dark:bg-violet-950/20 rounded-lg">
                        <Lightbulb className="h-3 w-3 inline mr-1" />
                        {bestReachCreator.accountName.startsWith("@") ? bestReachCreator.accountName : `@${bestReachCreator.accountName}`}が最大リーチ。{bestERCreator.accountName.startsWith("@") ? bestERCreator.accountName : `@${bestERCreator.accountName}`}はER {bestERCreator.avgER}%で最も高効率。
                      </p>
                    )}
                  </div>
                )}

                {/* Panel D: 投稿タイミング＆センチメント */}
                <div className="space-y-4">
                  {/* Heatmap */}
                  {insights.postingHeatmap && (
                    <div>
                      <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-orange-500" />
                        投稿タイミング
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr>
                              <th className="w-8"></th>
                              {heatmapDays.map(d => (
                                <th key={d} className="text-center font-normal text-muted-foreground pb-1 w-10">{d}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {heatmapBands.map(band => (
                              <tr key={band}>
                                <td className="text-muted-foreground pr-1.5 py-0.5 font-medium">{band}</td>
                                {heatmapDays.map(day => {
                                  const cell = (insights.postingHeatmap as any)?.[band]?.[day] ?? { er: 0, count: 0 };
                                  const intensity = getHeatmapIntensity(cell.er, maxHeatmapER);
                                  return (
                                    <td key={day} className="p-0.5">
                                      <div
                                        className={`w-full aspect-square rounded-sm flex items-center justify-center text-[9px] tabular-nums ${
                                          intensity === 0 ? "bg-gray-100 dark:bg-gray-800" :
                                          intensity === 1 ? "bg-orange-100 dark:bg-orange-900/30" :
                                          intensity === 2 ? "bg-orange-200 dark:bg-orange-800/50 font-medium" :
                                          intensity === 3 ? "bg-orange-400 dark:bg-orange-600 text-white font-medium" :
                                          "bg-orange-600 dark:bg-orange-500 text-white font-bold"
                                        }`}
                                        title={`${day}${band}: ER ${cell.er}% (${cell.count}本)`}
                                      >
                                        {cell.count > 0 ? cell.er : ""}
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {insights.bestHeatmapSlot && insights.bestHeatmapSlot.er > 0 && (
                        <p className="text-xs text-muted-foreground mt-1.5">
                          <Lightbulb className="h-3 w-3 inline mr-1" />
                          {insights.bestHeatmapSlot.day}曜・{insights.bestHeatmapSlot.band}の投稿がER {insights.bestHeatmapSlot.er}%で最も高パフォーマンス。
                        </p>
                      )}
                    </div>
                  )}

                  {/* Sentiment with ER */}
                  {insights.sentimentAnalysis && (
                    <div>
                      <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                        <Smile className="h-3.5 w-3.5 text-emerald-500" />
                        コンテンツのトーン
                      </h4>
                      {(() => {
                        const total = insights.sentimentAnalysis.reduce((sum, s) => sum + s.count, 0);
                        if (total === 0) return <p className="text-xs text-muted-foreground">データなし</p>;

                        return (
                          <div className="space-y-2">
                            {insights.sentimentAnalysis.map(s => {
                              const pct = Math.round((s.count / total) * 100);
                              const icon = s.sentiment === "positive" ? <Smile className="h-3.5 w-3.5 text-green-500" /> :
                                           s.sentiment === "negative" ? <Frown className="h-3.5 w-3.5 text-red-400" /> :
                                           <Minus className="h-3.5 w-3.5 text-gray-400" />;
                              const color = s.sentiment === "positive" ? "bg-green-500" :
                                            s.sentiment === "negative" ? "bg-red-400" : "bg-gray-300 dark:bg-gray-600";
                              return (
                                <div key={s.sentiment} className="flex items-center gap-2 text-xs">
                                  {icon}
                                  <span className="w-16 shrink-0">{sentimentLabels[s.sentiment]}</span>
                                  <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="w-8 text-right tabular-nums">{pct}%</span>
                                  <Badge variant="outline" className="text-[10px]">ER {s.avgER}%</Badge>
                                </div>
                              );
                            })}
                            {sentimentBest && (
                              <p className="text-xs text-muted-foreground mt-1 p-2 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-lg">
                                <Lightbulb className="h-3 w-3 inline mr-1" />
                                {sentimentLabels[sentimentBest.sentiment]}トーンの動画がER {sentimentBest.avgER}%で最も高パフォーマンス。
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* Panel E: キーフック分析 */}
                {insights.topHooks && insights.topHooks.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-3 flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5 text-amber-500" />
                      キーフック分析
                    </h4>
                    <div className="space-y-1.5">
                      {insights.topHooks.map((hook: any, i: number) => {
                        const maxER = Math.max(...(insights.topHooks as any[]).map((h: any) => h.avgER), 0.01);
                        return (
                          <div
                            key={hook.hook}
                            className={`flex items-center gap-3 p-2 rounded-lg text-sm ${
                              i === 0
                                ? "bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800"
                                : "bg-muted/30"
                            }`}
                          >
                            <span className="text-amber-500 font-bold text-xs w-5 shrink-0">#{i + 1}</span>
                            <span className="flex-1 font-medium truncate text-xs">{hook.hook}</span>
                            <div className="w-16 h-2 bg-muted rounded-full overflow-hidden shrink-0">
                              <div className="h-full bg-amber-400 rounded-full" style={{ width: `${(hook.avgER / maxER) * 100}%` }} />
                            </div>
                            <Badge variant={i === 0 ? "default" : "outline"} className={`text-[10px] shrink-0 ${i === 0 ? "bg-amber-600 hover:bg-amber-600" : ""}`}>
                              ER {hook.avgER}%
                            </Badge>
                            <span className="text-xs text-muted-foreground w-8 text-right">{hook.count}本</span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 p-2 bg-amber-50/50 dark:bg-amber-950/20 rounded-lg">
                      <Lightbulb className="h-3 w-3 inline mr-1" />
                      冒頭のフックが視聴継続率に直結。上位パターンを参考に最初の3秒を最適化。
                    </p>
                  </div>
                )}

                {/* Panel F: 広告 vs オーガニック */}
                {insights.adVsOrganic && (insights.adVsOrganic.ad.count > 0 || insights.adVsOrganic.organic.count > 0) && (
                  <div>
                    <h4 className="text-sm font-medium mb-3 flex items-center gap-1.5">
                      <Megaphone className="h-3.5 w-3.5 text-rose-500" />
                      広告・オーガニック比較
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      {/* Organic Card */}
                      <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full bg-emerald-500" />
                          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">オーガニック</span>
                        </div>
                        <div className="text-2xl font-bold tabular-nums">{(insights.adVsOrganic as any).organic.count}本</div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">平均ER</span>
                            <span className="font-medium">{(insights.adVsOrganic as any).organic.avgER}%</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">平均再生</span>
                            <span className="font-medium">{formatNumber((insights.adVsOrganic as any).organic.avgViews)}</span>
                          </div>
                        </div>
                      </div>
                      {/* Ad Card */}
                      <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20 p-3 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full bg-rose-500" />
                          <span className="text-xs font-medium text-rose-700 dark:text-rose-400">広告</span>
                        </div>
                        <div className="text-2xl font-bold tabular-nums">{(insights.adVsOrganic as any).ad.count}本</div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">平均ER</span>
                            <span className="font-medium">{(insights.adVsOrganic as any).ad.avgER}%</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">平均再生</span>
                            <span className="font-medium">{formatNumber((insights.adVsOrganic as any).ad.avgViews)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    {(insights.adVsOrganic as any).organic.count > 0 && (insights.adVsOrganic as any).ad.count > 0 && (
                      <p className="text-xs text-muted-foreground mt-2 p-2 bg-rose-50/50 dark:bg-rose-950/20 rounded-lg">
                        <Lightbulb className="h-3 w-3 inline mr-1" />
                        {(insights.adVsOrganic as any).organic.avgER > (insights.adVsOrganic as any).ad.avgER
                          ? `オーガニックがER ${((insights.adVsOrganic as any).organic.avgER - (insights.adVsOrganic as any).ad.avgER).toFixed(1)}pt上回る。広告はリーチ目的で活用が効果的。`
                          : `広告がER ${((insights.adVsOrganic as any).ad.avgER - (insights.adVsOrganic as any).organic.avgER).toFixed(1)}pt上回る。質の高い広告クリエイティブが高パフォーマンス。`
                        }
                      </p>
                    )}
                  </div>
                )}

                {/* Panel G: 感情ワードマップ (full-width) */}
                {insights.emotionQuadrants && Object.values(insights.emotionQuadrants as Record<string, any>).some((q: any) => q.words?.length > 0) && (
                  <div className="md:col-span-2">
                    <h4 className="text-sm font-medium mb-3 flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-pink-500" />
                      感情ワードマップ
                    </h4>
                    <p className="text-xs text-muted-foreground mb-3">
                      高パフォーマンス動画で頻出する感情表現を4象限で分析
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { key: "excitement", label: "興奮・驚き", color: "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800", textColor: "text-red-600 dark:text-red-400", badgeColor: "border-red-300 text-red-600 dark:border-red-700 dark:text-red-400" },
                        { key: "trust", label: "信頼・安心", color: "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800", textColor: "text-blue-600 dark:text-blue-400", badgeColor: "border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400" },
                        { key: "curiosity", label: "好奇心・探求", color: "bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800", textColor: "text-purple-600 dark:text-purple-400", badgeColor: "border-purple-300 text-purple-600 dark:border-purple-700 dark:text-purple-400" },
                        { key: "empathy", label: "共感・親近感", color: "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800", textColor: "text-amber-600 dark:text-amber-400", badgeColor: "border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400" },
                      ].map(quadrant => {
                        const qData = (insights.emotionQuadrants as any)?.[quadrant.key];
                        if (!qData || !qData.words || qData.words.length === 0) return null;
                        return (
                          <div key={quadrant.key} className={`rounded-lg border p-3 ${quadrant.color}`}>
                            <div className="flex items-center justify-between mb-2">
                              <span className={`text-xs font-medium ${quadrant.textColor}`}>
                                {quadrant.label}
                              </span>
                              <Badge variant="outline" className={`text-[10px] ${quadrant.badgeColor}`}>
                                ER {qData.avgER}%
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {qData.words.slice(0, 8).map((w: any) => (
                                <Badge key={w.word} variant="outline" className={`text-[10px] px-1.5 ${quadrant.badgeColor}`}>
                                  {w.word}
                                  {w.count > 1 && <span className="ml-0.5 opacity-50">×{w.count}</span>}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {insights.emotionLandscape && (insights.emotionLandscape as any[]).length > 0 && (
                      <p className="text-xs text-muted-foreground mt-2 p-2 bg-pink-50/50 dark:bg-pink-950/20 rounded-lg">
                        <Lightbulb className="h-3 w-3 inline mr-1" />
                        最も使われている感情ワード: {(insights.emotionLandscape as any[]).slice(0, 5).map((e: any) => `「${e.word}」`).join("、")}
                      </p>
                    )}
                  </div>
                )}

              </div>
            </CardContent>
          </Card>
        )}

        {/* データ不足時 */}
        {insights && insights.stats.totalVideos === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              分析データが蓄積されるとコンテンツ戦略インテリジェンスが表示されます
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

function CancelButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="shrink-0 h-7 w-7">
          <X className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>ジョブをキャンセルしますか？</AlertDialogTitle>
          <AlertDialogDescription>{label}この操作は取り消せません。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>戻る</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>キャンセル</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
