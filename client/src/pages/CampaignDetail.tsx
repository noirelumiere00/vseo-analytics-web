import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { Camera, FileText, ArrowLeft, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  draft: { label: "下書き", variant: "outline" },
  baseline_captured: { label: "ベースライン取得済", variant: "secondary" },
  measurement_captured: { label: "効果測定済", variant: "secondary" },
  report_ready: { label: "レポート完了", variant: "default" },
};

const snapshotStatusIcons: Record<string, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  queued: <Clock className="h-4 w-4 text-yellow-500" />,
  processing: <Loader2 className="h-4 w-4 animate-spin text-blue-500" />,
  completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-destructive" />,
};

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const campaignId = parseInt(id || "0");

  const detailQuery = trpc.campaign.getById.useQuery(
    { id: campaignId },
    { enabled: campaignId > 0, refetchInterval: 5000 },
  );

  const captureMutation = trpc.campaign.captureSnapshot.useMutation({
    onSuccess: () => {
      toast.success("スナップショット取得を開始しました");
      detailQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const generateReportMutation = trpc.campaign.generateReport.useMutation({
    onSuccess: () => {
      toast.success("レポートを生成しました");
      detailQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const campaign = detailQuery.data?.campaign;
  const snapshots = detailQuery.data?.snapshots || [];
  const report = detailQuery.data?.report;

  const baselineSnapshots = snapshots.filter(s => s.snapshotType === "baseline");
  const measurementSnapshots = snapshots.filter(s => s.snapshotType === "measurement");
  const latestBaseline = baselineSnapshots[0];
  const latestMeasurement = measurementSnapshots[0];

  const isCapturing = snapshots.some(s => s.status === "processing" || s.status === "queued");
  const status = campaign ? statusConfig[campaign.status] || statusConfig.draft : statusConfig.draft;

  if (!campaign && !detailQuery.isLoading) {
    return (
      <DashboardLayout>
        <div className="max-w-4xl mx-auto text-center py-12">
          <p className="text-muted-foreground">キャンペーンが見つかりません</p>
          <Button variant="link" onClick={() => setLocation("/campaigns")}>一覧に戻る</Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/campaigns")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight truncate">{campaign?.name || "読み込み中..."}</h1>
              {campaign && <Badge variant={status.variant}>{status.label}</Badge>}
            </div>
            {campaign?.clientName && (
              <p className="text-sm text-muted-foreground mt-0.5">{campaign.clientName}</p>
            )}
          </div>
        </div>

        {/* Campaign Config Summary */}
        {campaign && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">キャンペーン設定</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">計測キーワード:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(campaign.keywords as string[])?.map((kw, i) => (
                    <Badge key={i} variant="secondary">{kw}</Badge>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">自社アカウント:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(campaign.ownAccountIds as string[])?.map((id, i) => (
                    <Badge key={i} variant="outline">@{id}</Badge>
                  ))}
                </div>
              </div>
              {(campaign.campaignHashtags as string[])?.length > 0 && (
                <div>
                  <span className="text-muted-foreground">ハッシュタグ:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(campaign.campaignHashtags as string[]).map((tag, i) => (
                      <Badge key={i} variant="secondary">{tag}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {(campaign.competitors as any[])?.length > 0 && (
                <div>
                  <span className="text-muted-foreground">競合:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(campaign.competitors as any[]).map((comp, i) => (
                      <Badge key={i} variant="outline">{comp.name}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Snapshot Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Baseline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Camera className="h-4 w-4" />
                ベースライン（施策前）
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {latestBaseline ? (
                <div className="flex items-center gap-2">
                  {snapshotStatusIcons[latestBaseline.status]}
                  <span className="text-sm">
                    {latestBaseline.status === "completed"
                      ? `取得完了: ${latestBaseline.capturedAt ? new Date(latestBaseline.capturedAt).toLocaleString("ja-JP") : "-"}`
                      : latestBaseline.status === "processing"
                      ? "取得中..."
                      : latestBaseline.status === "queued"
                      ? "キュー待ち中..."
                      : latestBaseline.status === "failed"
                      ? "取得失敗"
                      : "待機中"}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">未取得</p>
              )}
              {(latestBaseline?.status === "processing" || latestBaseline?.status === "queued") && (
                <SnapshotProgressBar snapshotId={latestBaseline.id} />
              )}
              <Button
                onClick={() => captureMutation.mutate({ campaignId, type: "baseline" })}
                disabled={isCapturing || captureMutation.isPending}
                className="w-full"
                variant={latestBaseline?.status === "completed" ? "outline" : "default"}
              >
                {captureMutation.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />開始中...</>
                ) : latestBaseline?.status === "completed" ? (
                  "再取得"
                ) : (
                  "ベースライン取得"
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Measurement */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Camera className="h-4 w-4" />
                効果測定（施策後）
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {latestMeasurement ? (
                <div className="flex items-center gap-2">
                  {snapshotStatusIcons[latestMeasurement.status]}
                  <span className="text-sm">
                    {latestMeasurement.status === "completed"
                      ? `取得完了: ${latestMeasurement.capturedAt ? new Date(latestMeasurement.capturedAt).toLocaleString("ja-JP") : "-"}`
                      : latestMeasurement.status === "processing"
                      ? "取得中..."
                      : latestMeasurement.status === "queued"
                      ? "キュー待ち中..."
                      : latestMeasurement.status === "failed"
                      ? "取得失敗"
                      : "待機中"}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">未取得</p>
              )}
              {(latestMeasurement?.status === "processing" || latestMeasurement?.status === "queued") && (
                <SnapshotProgressBar snapshotId={latestMeasurement.id} />
              )}
              <Button
                onClick={() => captureMutation.mutate({ campaignId, type: "measurement" })}
                disabled={isCapturing || captureMutation.isPending}
                className="w-full"
                variant={latestMeasurement?.status === "completed" ? "outline" : "default"}
              >
                {captureMutation.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />開始中...</>
                ) : latestMeasurement?.status === "completed" ? (
                  "再取得"
                ) : (
                  "効果測定取得"
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Report */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              施策効果レポート
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {report ? (
              <div className="space-y-3">
                <p className="text-sm text-green-600">レポートが生成されています</p>
                <div className="flex gap-2">
                  <Button onClick={() => setLocation(`/campaigns/${campaignId}/report`)}>
                    レポートを表示
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => generateReportMutation.mutate({ campaignId })}
                    disabled={generateReportMutation.isPending}
                  >
                    再生成
                  </Button>
                </div>
              </div>
            ) : latestBaseline?.status === "completed" && latestMeasurement?.status === "completed" ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">両方のスナップショットが揃いました。レポートを生成できます。</p>
                <Button
                  onClick={() => generateReportMutation.mutate({ campaignId })}
                  disabled={generateReportMutation.isPending}
                >
                  {generateReportMutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />生成中...</>
                  ) : (
                    "レポート生成"
                  )}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                ベースラインと効果測定の両方のスナップショットを取得するとレポートを生成できます。
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function SnapshotProgressBar({ snapshotId }: { snapshotId: number }) {
  const progressQuery = trpc.campaign.getSnapshotProgress.useQuery(
    { snapshotId },
    { refetchInterval: 2000 },
  );

  const progress = progressQuery.data?.progress;
  if (!progress) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{progress.message}</span>
        <span>{progress.percent}%</span>
      </div>
      <Progress value={progress.percent} className="h-2" />
    </div>
  );
}
