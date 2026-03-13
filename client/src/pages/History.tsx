import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { HistorySkeleton } from "@/components/PageSkeleton";
import DashboardLayout from "@/components/DashboardLayout";
import { Loader2, Clock, CheckCircle2, XCircle, Loader as LoaderIcon, Trash2, RotateCcw, GitCompare, TrendingUp, CheckSquare, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocation, useSearch } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";
import { useEffect, useState } from "react";

export default function History() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const utils = trpc.useUtils();
  const { data: jobs, isLoading } = trpc.analysis.list.useQuery(undefined, {
    enabled: !!user,
  });

  const compareWithId = parseInt(new URLSearchParams(search).get("compareWith") ?? "0");
  const [compareMode, setCompareMode] = useState(compareWithId > 0);
  const [selectedIds, setSelectedIds] = useState<number[]>(compareWithId > 0 ? [compareWithId] : []);

  useEffect(() => {
    if (compareWithId > 0 && jobs) {
      const target = jobs.find((j) => j.id === compareWithId && j.status === "completed");
      if (target) {
        setCompareMode(true);
        setSelectedIds([compareWithId]);
      }
    }
  }, [jobs, compareWithId]);

  const deleteJob = trpc.analysis.delete.useMutation({
    onSuccess: () => {
      toast.success("分析ジョブを削除しました");
      utils.analysis.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const retryJob = trpc.analysis.retry.useMutation({
    onSuccess: (data) => {
      toast.success("再実行を開始します");
      setLocation(`/analysis/${data.jobId}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const [deleteMode, setDeleteMode] = useState(false);
  const [deleteSelectedIds, setDeleteSelectedIds] = useState<number[]>([]);

  const bulkDeleteJobs = trpc.analysis.bulkDelete.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.deleted}件の分析ジョブを削除しました`);
      setDeleteMode(false);
      setDeleteSelectedIds([]);
      utils.analysis.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  if (authLoading || isLoading) {
    return (
      <DashboardLayout>
        <HistorySkeleton />
      </DashboardLayout>
    );
  }

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

  const handleDelete = (e: React.MouseEvent, jobId: number) => {
    e.stopPropagation();
    if (window.confirm("この分析ジョブを削除しますか？関連する全てのデータが削除されます。")) {
      deleteJob.mutate({ jobId });
    }
  };

  const handleRetry = (e: React.MouseEvent, jobId: number) => {
    e.stopPropagation();
    retryJob.mutate({ jobId });
  };

  const toggleCompareMode = () => {
    setCompareMode((prev) => !prev);
    setSelectedIds([]);
    setDeleteMode(false);
    setDeleteSelectedIds([]);
  };

  const toggleDeleteMode = () => {
    setDeleteMode((prev) => !prev);
    setDeleteSelectedIds([]);
    setCompareMode(false);
    setSelectedIds([]);
  };

  const toggleDeleteSelect = (e: React.MouseEvent, jobId: number) => {
    e.stopPropagation();
    setDeleteSelectedIds((prev) =>
      prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId]
    );
  };

  const handleBulkDelete = () => {
    if (deleteSelectedIds.length === 0) {
      toast.info("削除するジョブを選択してください");
      return;
    }
    if (window.confirm(`${deleteSelectedIds.length}件の分析ジョブを削除しますか？関連する全てのデータが削除されます。`)) {
      bulkDeleteJobs.mutate({ jobIds: deleteSelectedIds });
    }
  };

  const selectAllDeletable = () => {
    if (!jobs) return;
    const deletableIds = jobs.filter((j) => j.status !== "processing" && j.status !== "queued").map((j) => j.id);
    setDeleteSelectedIds((prev) =>
      prev.length === deletableIds.length ? [] : deletableIds
    );
  };

  const toggleSelect = (e: React.MouseEvent, jobId: number) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      if (prev.includes(jobId)) return prev.filter((id) => id !== jobId);
      if (prev.length >= 2) {
        toast.info("比較できるのは2件までです");
        return prev;
      }
      return [...prev, jobId];
    });
  };

  const handleCompare = () => {
    if (selectedIds.length !== 2) {
      toast.info("比較する2件を選択してください");
      return;
    }
    setLocation(`/compare?a=${selectedIds[0]}&b=${selectedIds[1]}`);
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">SEO分析履歴</h1>
            <p className="text-sm text-muted-foreground mt-1">
              過去に実行した分析ジョブの一覧
            </p>
          </div>
          <div className="flex items-center gap-2">
            {jobs && jobs.length >= 2 && (
              <>
                <Button
                  variant={deleteMode ? "default" : "outline"}
                  size="sm"
                  onClick={toggleDeleteMode}
                  className={deleteMode ? "bg-destructive hover:bg-destructive/90 text-white" : ""}
                >
                  <CheckSquare className="h-4 w-4 mr-1.5" />
                  {deleteMode ? "キャンセル" : "選択削除"}
                </Button>
                <Button
                  variant={compareMode ? "default" : "outline"}
                  size="sm"
                  onClick={toggleCompareMode}
                  className={compareMode ? "gradient-primary text-white" : ""}
                >
                  <GitCompare className="h-4 w-4 mr-1.5" />
                  {compareMode ? "キャンセル" : "比較"}
                </Button>
              </>
            )}
            <Button size="sm" className="gradient-primary text-white" onClick={() => setLocation("/")}>
              <Search className="h-4 w-4 mr-1.5" />
              新規分析
            </Button>
          </div>
        </div>

        {/* Delete action bar */}
        {deleteMode && (
          <div className="flex items-center justify-between p-4 rounded-lg border border-destructive/30 bg-destructive/5">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={selectAllDeletable}>
                {jobs && deleteSelectedIds.length === jobs.filter((j) => j.status !== "processing" && j.status !== "queued").length
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
              disabled={deleteSelectedIds.length === 0 || bulkDeleteJobs.isPending}
              onClick={handleBulkDelete}
              variant="destructive"
            >
              {bulkDeleteJobs.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              {deleteSelectedIds.length}件を削除
            </Button>
          </div>
        )}

        {/* Compare action bar */}
        {compareMode && (
          <div className="flex items-center justify-between p-4 rounded-lg border border-primary/30 bg-primary/5">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                {[0, 1].map((i) => (
                  <div
                    key={i}
                    className={`h-2.5 w-2.5 rounded-full transition-colors ${
                      i < selectedIds.length ? "bg-primary" : "bg-muted-foreground/30"
                    }`}
                  />
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                {selectedIds.length === 0 && "比較したい分析を2件選択してください"}
                {selectedIds.length === 1 && (compareWithId > 0 ? "比較先をもう1件選択してください" : "あと1件選択してください")}
                {selectedIds.length === 2 && "2件選択済み — 比較を開始できます"}
              </p>
            </div>
            <Button
              disabled={selectedIds.length !== 2}
              onClick={handleCompare}
              className="gradient-primary text-white"
            >
              <GitCompare className="h-4 w-4 mr-2" />
              比較する
            </Button>
          </div>
        )}

        {/* Jobs List */}
        {!jobs || jobs.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia><img src="/favicon.png" alt="" className="h-16 w-16 object-contain logo-blend opacity-30" /></EmptyMedia>
              <EmptyTitle>まだ分析履歴がありません</EmptyTitle>
              <EmptyDescription>
                キーワードを入力して最初のVSEO分析を開始しましょう。
              </EmptyDescription>
            </EmptyHeader>
            <Button className="gradient-primary text-white" onClick={() => setLocation("/")}>
              <Search className="mr-2 h-4 w-4" />最初の分析を開始
            </Button>
          </Empty>
        ) : (
          <div className="space-y-3">
            {jobs.map((job, i) => {
              const isSelected = selectedIds.includes(job.id);
              const isDeleteSelected = deleteSelectedIds.includes(job.id);
              const isCompleted = job.status === "completed";
              const isProcessing = job.status === "processing" || job.status === "queued";
              const isDisabled = compareMode && !isCompleted;
              const isDeleteDisabled = deleteMode && isProcessing;
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
                      : compareMode && isCompleted
                      ? isSelected
                        ? "border-primary ring-2 ring-primary/30 cursor-pointer"
                        : "cursor-pointer hover:border-primary/60"
                      : compareMode
                      ? "opacity-50 cursor-not-allowed"
                      : "cursor-pointer hover:border-primary"
                  }`}
                  style={{ animationDelay: `${i * 40}ms` }}
                  onClick={(e) => {
                    if (deleteMode) {
                      if (!isProcessing) toggleDeleteSelect(e, job.id);
                    } else if (compareMode) {
                      if (isCompleted) toggleSelect(e, job.id);
                    } else {
                      setLocation(`/analysis/${job.id}`);
                    }
                  }}
                >
                  <CardHeader className="py-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        {deleteMode && (
                          <Checkbox
                            checked={isDeleteSelected}
                            disabled={isDeleteDisabled}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!isProcessing) toggleDeleteSelect(e as unknown as React.MouseEvent, job.id);
                            }}
                            className="mt-0.5"
                          />
                        )}
                        {compareMode && (
                          <Checkbox
                            checked={isSelected}
                            disabled={isDisabled}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isCompleted) toggleSelect(e as unknown as React.MouseEvent, job.id);
                            }}
                            className="mt-0.5"
                          />
                        )}
                        <div className="space-y-1 flex-1">
                          <CardTitle className="text-base flex items-center gap-2">
                            {job.keyword ? `${job.keyword}` : "手動URL分析"}
                            {job.keyword && job.status === "completed" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 px-1.5 text-[10px] text-blue-500 hover:text-blue-700"
                                onClick={(e) => { e.stopPropagation(); setLocation(`/trend?keyword=${encodeURIComponent(job.keyword!)}`); }}
                                title="トレンド推移を見る"
                              >
                                <TrendingUp className="h-3 w-3" />
                              </Button>
                            )}
                          </CardTitle>
                          <CardDescription>
                            {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true, locale: ja })}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(job.status)}
                        {!compareMode && !deleteMode && (job.status === "failed" || job.status === "pending") && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => handleRetry(e, job.id)}
                            disabled={retryJob.isPending}
                            title="再実行"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {!compareMode && !deleteMode && job.status !== "processing" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => handleDelete(e, job.id)}
                            disabled={deleteJob.isPending}
                            className="text-destructive hover:text-destructive"
                            title="削除"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  {job.manualUrls && job.manualUrls.length > 0 && (
                    <CardContent className="pt-0 pb-4">
                      <p className="text-sm text-muted-foreground">
                        {job.manualUrls.length}件の動画URL
                      </p>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
