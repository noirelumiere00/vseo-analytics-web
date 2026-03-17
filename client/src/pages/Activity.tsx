import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { HistorySkeleton } from "@/components/PageSkeleton";
import DashboardLayout from "@/components/DashboardLayout";
import {
  Clock, CheckCircle2, XCircle, Loader as LoaderIcon, Trash2, RotateCcw,
  TrendingUp, Search, Compass, ArrowRight, BarChart3, Smile, Frown, Minus,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";
import { useState } from "react";

type FilterType = "all" | "seo" | "trend";

export default function Activity() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const { data: items, isLoading } = trpc.analysis.allActivity.useQuery();
  const [filter, setFilter] = useState<FilterType>("all");

  const deleteAnalysis = trpc.analysis.delete.useMutation({
    onSuccess: () => {
      toast.success("分析ジョブを削除しました");
      utils.analysis.allActivity.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const retryAnalysis = trpc.analysis.retry.useMutation({
    onSuccess: (data) => {
      toast.success("再実行を開始します");
      setLocation(`/analysis/${data.jobId}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteTrend = trpc.trendDiscovery.delete.useMutation({
    onSuccess: () => {
      toast.success("トレンド発掘ジョブを削除しました");
      utils.analysis.allActivity.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const retryTrend = trpc.trendDiscovery.execute.useMutation({
    onSuccess: () => {
      toast.success("再実行を開始します");
      utils.analysis.allActivity.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return <DashboardLayout><HistorySkeleton /></DashboardLayout>;
  }

  const filtered = items?.filter(item => {
    if (filter === "all") return true;
    return item.type === filter;
  }) ?? [];

  const counts = {
    all: items?.length ?? 0,
    seo: items?.filter(i => i.type === "seo").length ?? 0,
    trend: items?.filter(i => i.type === "trend").length ?? 0,
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-500 hover:bg-green-500"><CheckCircle2 className="h-3 w-3 mr-1" />完了</Badge>;
      case "processing":
        return <Badge className="bg-blue-500 hover:bg-blue-500"><LoaderIcon className="h-3 w-3 mr-1 animate-spin" />処理中</Badge>;
      case "queued":
        return <Badge className="bg-yellow-500 hover:bg-yellow-500"><Clock className="h-3 w-3 mr-1" />キュー中</Badge>;
      case "failed":
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />失敗</Badge>;
      default:
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />待機中</Badge>;
    }
  };

  const handleDelete = (e: React.MouseEvent, item: typeof filtered[0]) => {
    e.stopPropagation();
    const label = item.type === "seo" ? "分析ジョブ" : "トレンド発掘ジョブ";
    if (window.confirm(`この${label}を削除しますか？関連する全てのデータが削除されます。`)) {
      if (item.type === "seo") {
        deleteAnalysis.mutate({ jobId: item.id });
      } else {
        deleteTrend.mutate({ jobId: item.id });
      }
    }
  };

  const handleRetry = (e: React.MouseEvent, item: typeof filtered[0]) => {
    e.stopPropagation();
    if (item.type === "seo") {
      retryAnalysis.mutate({ jobId: item.id });
    } else {
      retryTrend.mutate({ jobId: item.id });
    }
  };

  const handleClick = (item: typeof filtered[0]) => {
    if (item.type === "seo") {
      setLocation(`/analysis/${item.id}`);
    } else {
      setLocation(`/trend-discovery/${item.id}`);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">アクティビティ</h1>
            <p className="text-sm text-muted-foreground mt-1">
              SEO分析・トレンド発掘の全履歴
            </p>
          </div>
          <div className="flex items-center gap-2">
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

        {/* Filter tabs */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
          {([
            { key: "all" as const, label: "すべて", count: counts.all },
            { key: "seo" as const, label: "SEO分析", count: counts.seo },
            { key: "trend" as const, label: "トレンド発掘", count: counts.trend },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                filter === tab.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 text-xs opacity-60">{tab.count}</span>
            </button>
          ))}
        </div>

        {/* Activity List */}
        {filtered.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon"><BarChart3 className="h-6 w-6" /></EmptyMedia>
              <EmptyTitle>
                {filter === "all" ? "まだ履歴がありません" : filter === "seo" ? "SEO分析の履歴がありません" : "トレンド発掘の履歴がありません"}
              </EmptyTitle>
              <EmptyDescription>
                {filter === "all"
                  ? "キーワード分析やトレンド発掘を実行すると、ここに表示されます。"
                  : filter === "seo"
                  ? "キーワードを入力してVSEO分析を開始しましょう。"
                  : "ペルソナを入力してTikTokトレンドを発掘しましょう。"}
              </EmptyDescription>
            </EmptyHeader>
            <Button className="gradient-primary text-white" onClick={() => setLocation(filter === "trend" ? "/trend-discovery" : "/analysis/new")}>
              <Search className="mr-2 h-4 w-4" />
              {filter === "trend" ? "トレンド発掘を開始" : "分析を開始"}
            </Button>
          </Empty>
        ) : (
          <div className="space-y-2">
            {filtered.map((item, i) => {
              const isProcessing = item.status === "processing" || item.status === "queued";
              const canRetry = item.status === "failed" || item.status === "pending";
              const canDelete = !isProcessing;

              return (
                <Card
                  key={`${item.type}-${item.id}`}
                  className="card-interactive cursor-pointer hover:border-primary/40 animate-list-item"
                  style={{ animationDelay: `${i * 30}ms` }}
                  onClick={() => handleClick(item)}
                >
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {/* Type badge */}
                        <Badge
                          variant="secondary"
                          className={`shrink-0 text-[10px] px-1.5 py-0.5 ${
                            item.type === "seo"
                              ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                              : "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                          }`}
                        >
                          {item.type === "seo" ? "SEO" : "トレンド"}
                        </Badge>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-sm font-medium truncate">
                              {item.label}
                            </CardTitle>
                            {item.type === "seo" && item.status === "completed" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 px-1.5 text-[10px] text-blue-500 hover:text-blue-700 shrink-0"
                                onClick={(e) => { e.stopPropagation(); setLocation(`/trend?keyword=${encodeURIComponent(item.label)}`); }}
                                title="トレンド推移を見る"
                              >
                                <TrendingUp className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                          <CardDescription className="text-xs mt-0.5">
                            {formatDistanceToNow(new Date(item.date), { addSuffix: true, locale: ja })}
                            {/* Extra metadata for completed items */}
                            {item.type === "seo" && item.status === "completed" && (item as any).totalVideos != null && (
                              <span className="ml-2">
                                / {(item as any).totalVideos}本 / {((item as any).totalViews ?? 0).toLocaleString()}再生
                              </span>
                            )}
                            {item.type === "trend" && item.status === "completed" && (
                              <span className="ml-2">
                                / KW {(item as any).keywordCount}個 / #{(item as any).hashtagCount}個
                              </span>
                            )}
                          </CardDescription>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Sentiment bar for SEO */}
                        {item.type === "seo" && item.status === "completed" && (item as any).positivePercentage != null && (
                          <div className="flex h-2 w-14 rounded-full overflow-hidden bg-muted">
                            <div className="bg-green-500" style={{ width: `${(item as any).positivePercentage}%` }} />
                            <div className="bg-red-400" style={{ width: `${(item as any).negativePercentage ?? 0}%` }} />
                          </div>
                        )}

                        {/* Top tags for trend */}
                        {item.type === "trend" && item.status === "completed" && (item as any).topTags?.length > 0 && (
                          <div className="hidden sm:flex gap-1">
                            {((item as any).topTags as string[]).map(tag => (
                              <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0 border-purple-300 text-purple-600 dark:border-purple-700 dark:text-purple-400">
                                #{tag}
                              </Badge>
                            ))}
                          </div>
                        )}

                        {getStatusBadge(item.status)}

                        {/* Actions */}
                        {canRetry && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={(e) => handleRetry(e, item)}
                            title="再実行"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={(e) => handleDelete(e, item)}
                            title="削除"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
