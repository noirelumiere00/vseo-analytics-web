import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Clock, CheckCircle2, XCircle, Loader as LoaderIcon, Trash2, RotateCcw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";

export default function History() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const { data: jobs, isLoading } = trpc.analysis.list.useQuery(undefined, {
    enabled: !!user,
  });

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

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-500"><CheckCircle2 className="h-3 w-3 mr-1" />完了</Badge>;
      case "processing":
        return <Badge className="bg-blue-500"><LoaderIcon className="h-3 w-3 mr-1 animate-spin" />処理中</Badge>;
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

  return (
    <div className="min-h-screen bg-background">
      <div className="container py-12">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold">
                <span className="gradient-text">分析履歴</span>
              </h1>
              <p className="text-muted-foreground mt-2">
                過去に実行した分析ジョブの一覧です
              </p>
            </div>
            <Button variant="outline" onClick={() => setLocation("/")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              戻る
            </Button>
          </div>

          {/* Jobs List */}
          {!jobs || jobs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">まだ分析履歴がありません</p>
                <Button className="mt-4 gradient-primary text-white" onClick={() => setLocation("/")}>
                  最初の分析を開始
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {jobs.map((job) => (
                <Card 
                  key={job.id} 
                  className="cursor-pointer hover:border-primary transition-colors"
                  onClick={() => setLocation(`/analysis/${job.id}`)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 flex-1">
                        <CardTitle>
                          {job.keyword ? `キーワード: ${job.keyword}` : "手動URL分析"}
                        </CardTitle>
                        <CardDescription>
                          {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true, locale: ja })}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(job.status)}
                        {/* 再実行ボタン（failed/pendingの場合） */}
                        {(job.status === "failed" || job.status === "pending") && (
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
                        {/* 削除ボタン（processing以外） */}
                        {job.status !== "processing" && (
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
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        {job.manualUrls.length}件の動画URL
                      </p>
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
