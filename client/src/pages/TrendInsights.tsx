import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { useState } from "react";
import {
  CheckCircle2, CheckSquare, Clock, Compass, Loader2,
  Loader as LoaderIcon, RotateCcw, Trash2, XCircle,
} from "lucide-react";

export default function TrendInsights() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const jobsQuery = trpc.trendDiscovery.list.useQuery(undefined, {
    enabled: !!user,
  });

  const deleteMutation = trpc.trendDiscovery.delete.useMutation({
    onSuccess: () => {
      toast.success("分析ジョブを削除しました");
      utils.trendDiscovery.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const retryMutation = trpc.trendDiscovery.execute.useMutation({
    onSuccess: (_, variables) => {
      toast.success("再実行を開始します");
      setLocation(`/trend-discovery/${variables.jobId}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const [deleteMode, setDeleteMode] = useState(false);
  const [deleteSelectedIds, setDeleteSelectedIds] = useState<number[]>([]);

  const toggleDeleteMode = () => {
    setDeleteMode((prev) => !prev);
    setDeleteSelectedIds([]);
  };

  const toggleDeleteSelect = (e: React.MouseEvent, jobId: number) => {
    e.stopPropagation();
    setDeleteSelectedIds((prev) =>
      prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId]
    );
  };

  const selectAllDeletable = () => {
    if (!jobsQuery.data) return;
    const deletableIds = jobsQuery.data.filter((j) => j.status !== "processing" && j.status !== "queued").map((j) => j.id);
    setDeleteSelectedIds((prev) =>
      prev.length === deletableIds.length ? [] : deletableIds
    );
  };

  const handleBulkDelete = () => {
    if (deleteSelectedIds.length === 0) {
      toast.info("削除するジョブを選択してください");
      return;
    }
    if (window.confirm(`${deleteSelectedIds.length}件の分析ジョブを削除しますか？`)) {
      // Delete one by one since there's no bulkDelete endpoint
      for (const jobId of deleteSelectedIds) {
        deleteMutation.mutate({ jobId });
      }
      setDeleteMode(false);
      setDeleteSelectedIds([]);
    }
  };

  const handleDelete = (e: React.MouseEvent, jobId: number) => {
    e.stopPropagation();
    if (window.confirm("この分析ジョブを削除しますか？")) {
      deleteMutation.mutate({ jobId });
    }
  };

  const handleRetry = (e: React.MouseEvent, jobId: number) => {
    e.stopPropagation();
    retryMutation.mutate({ jobId });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-500"><CheckCircle2 className="h-3 w-3 mr-1" />完了</Badge>;
      case "processing":
        return <Badge className="bg-blue-500"><LoaderIcon className="h-3 w-3 mr-1 animate-spin" />処理中</Badge>;
      case "queued":
        return <Badge className="bg-yellow-500"><Clock className="h-3 w-3 mr-1" />キュー中</Badge>;
      case "failed":
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />失敗</Badge>;
      default:
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />待機中</Badge>;
    }
  };

  const jobs = jobsQuery.data || [];

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">トレンド分析履歴</h1>
            <p className="text-sm text-muted-foreground mt-1">
              過去に実行したトレンド分析ジョブの一覧
            </p>
          </div>
          <div className="flex items-center gap-2">
            {jobs.length >= 2 && (
              <Button
                variant={deleteMode ? "default" : "outline"}
                size="sm"
                onClick={toggleDeleteMode}
                className={deleteMode ? "bg-destructive hover:bg-destructive/90 text-white" : ""}
              >
                <CheckSquare className="h-4 w-4 mr-1.5" />
                {deleteMode ? "キャンセル" : "選択削除"}
              </Button>
            )}
            <Button size="sm" className="gradient-primary text-white" onClick={() => setLocation("/trend-discovery")}>
              <Compass className="h-4 w-4 mr-1.5" />
              新規分析
            </Button>
          </div>
        </div>

        {/* Delete action bar */}
        {deleteMode && (
          <div className="flex items-center justify-between p-4 rounded-lg border border-destructive/30 bg-destructive/5">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={selectAllDeletable}>
                {jobs.length > 0 && deleteSelectedIds.length === jobs.filter((j) => j.status !== "processing" && j.status !== "queued").length
                  ? "全解除"
                  : "全選択"}
              </Button>
              <p className="text-sm text-muted-foreground">
                {deleteSelectedIds.length === 0
                  ? "削除するジョブを選択してください"
                  : `${deleteSelectedIds.length}件選択中`}
              </p>
            </div>
            <Button
              disabled={deleteSelectedIds.length === 0 || deleteMutation.isPending}
              onClick={handleBulkDelete}
              variant="destructive"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              {deleteSelectedIds.length}件を削除
            </Button>
          </div>
        )}

        {/* Loading */}
        {jobsQuery.isLoading && (
          <div className="flex items-center justify-center py-20">
            <img src="/favicon.png" alt="" className="h-12 w-12 object-contain logo-blend animate-logo-pulse" />
          </div>
        )}

        {/* Empty state */}
        {!jobsQuery.isLoading && jobs.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <img src="/favicon.png" alt="" className="h-16 w-16 object-contain logo-blend opacity-30 mb-4" />
              <h3 className="font-semibold text-lg">まだ分析履歴がありません</h3>
              <p className="text-muted-foreground text-sm mt-1">
                TikTokトレンド分析を実行すると、ここに結果が表示されます
              </p>
              <Button className="mt-4" onClick={() => setLocation("/trend-discovery")}>
                <Compass className="h-4 w-4 mr-2" />
                トレンド分析を開始
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Jobs list */}
        {!jobsQuery.isLoading && jobs.length > 0 && (
          <div className="space-y-3">
            {jobs.map((job, i) => {
              const isDeleteSelected = deleteSelectedIds.includes(job.id);
              const isProcessing = job.status === "processing" || job.status === "queued";
              const cross = job.crossAnalysis as any;
              const videoCount = cross?.topVideos?.length
                ? cross.uniqueVideoCount ?? cross.topVideos.length
                : null;
              const kwCount = (job.expandedKeywords as string[])?.length || 0;

              return (
                <Card
                  key={job.id}
                  className={`card-interactive animate-list-item transition-colors ${
                    deleteMode
                      ? isProcessing
                        ? "opacity-50 cursor-not-allowed"
                        : isDeleteSelected
                        ? "border-destructive ring-2 ring-destructive/30 cursor-pointer"
                        : "cursor-pointer hover:border-destructive/60"
                      : "cursor-pointer hover:border-primary"
                  }`}
                  style={{ animationDelay: `${i * 40}ms` }}
                  onClick={(e) => {
                    if (deleteMode) {
                      if (!isProcessing) toggleDeleteSelect(e, job.id);
                    } else {
                      setLocation(`/trend-discovery/${job.id}`);
                    }
                  }}
                >
                  <CardHeader className="py-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        {deleteMode && (
                          <Checkbox
                            checked={isDeleteSelected}
                            disabled={isProcessing}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!isProcessing) toggleDeleteSelect(e as unknown as React.MouseEvent, job.id);
                            }}
                            className="mt-0.5"
                          />
                        )}
                        <div className="space-y-1 flex-1">
                          <CardTitle className="text-base flex items-center gap-2">
                            {job.persona}
                          </CardTitle>
                          <CardDescription className="flex items-center gap-2">
                            {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true, locale: ja })}
                            {kwCount > 0 && (
                              <span className="text-xs">/ KW: {kwCount}件</span>
                            )}
                            {videoCount != null && (
                              <span className="text-xs">/ 動画: {videoCount}件</span>
                            )}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(job.status)}
                        {!deleteMode && (job.status === "failed" || job.status === "pending") && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => handleRetry(e, job.id)}
                            disabled={retryMutation.isPending}
                            title="再実行"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {!deleteMode && !isProcessing && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => handleDelete(e, job.id)}
                            disabled={deleteMutation.isPending}
                            className="text-destructive hover:text-destructive"
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
