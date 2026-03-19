import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { Camera, FileText, ArrowLeft, Loader2, CheckCircle2, XCircle, Clock, Video, UserPlus } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { useState } from "react";

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
    {
      enabled: campaignId > 0,
      refetchInterval: (query) => {
        const snapshots = query.state.data?.snapshots || [];
        const hasActive = snapshots.some((s: any) => s.status === "processing" || s.status === "queued");
        return hasActive ? 5000 : false;
      },
    },
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

  const scrapeVideosMutation = trpc.campaign.scrapeVideoUrls.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.videoCount}件の動画データを取得しました${data.newHashtags.length > 0 ? `（${data.newHashtags.length}件の新規ハッシュタグを追加）` : ""}`);
      detailQuery.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const applyCompetitorsMutation = trpc.campaign.applyDetectedCompetitors.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.added}件の競合を追加しました`);
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

        {/* 施策動画データ取得 */}
        {campaign && (campaign as any).ownVideoUrls?.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Video className="h-4 w-4" />
                施策動画データ
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(campaign as any).ownVideoData?.length > 0 ? (
                <>
                  <div className="grid gap-2 md:grid-cols-2">
                    {((campaign as any).ownVideoData as any[]).map((v: any) => (
                      <div key={v.videoId} className="border rounded-lg p-3 flex gap-3">
                        {v.coverUrl && (
                          <img src={v.coverUrl} alt="" className="w-16 h-20 rounded object-cover flex-shrink-0" loading="lazy" />
                        )}
                        <div className="min-w-0 flex-1 text-xs">
                          <p className="font-medium truncate">{v.description?.slice(0, 40) || v.videoId}</p>
                          <p className="text-muted-foreground">@{v.authorUniqueId}</p>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-muted-foreground">
                            <span>{(v.viewCount || 0).toLocaleString()} 再生</span>
                            <span>{(v.likeCount || 0).toLocaleString()} いいね</span>
                            <span>{(v.commentCount || 0).toLocaleString()} コメント</span>
                          </div>
                          {v.hashtags?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {v.hashtags.slice(0, 5).map((t: string, i: number) => (
                                <Badge key={i} variant="secondary" className="text-[10px]">#{t}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => scrapeVideosMutation.mutate({ campaignId })}
                    disabled={scrapeVideosMutation.isPending}
                  >
                    {scrapeVideosMutation.isPending ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" />取得中...</> : "動画データ再取得"}
                  </Button>
                </>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">{((campaign as any).ownVideoUrls as string[]).length}件のURLが設定されています</p>
                  <Button
                    onClick={() => scrapeVideosMutation.mutate({ campaignId })}
                    disabled={scrapeVideosMutation.isPending}
                  >
                    {scrapeVideosMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />取得中...</> : "動画データ取得"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 検出された競合 */}
        <DetectedCompetitorsCard
          campaign={campaign}
          snapshots={snapshots}
          campaignId={campaignId}
          applyMutation={applyCompetitorsMutation}
        />

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

function DetectedCompetitorsCard({
  campaign, snapshots, campaignId, applyMutation,
}: {
  campaign: any;
  snapshots: any[];
  campaignId: number;
  applyMutation: any;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Find latest completed snapshot with detected competitors
  const snapshotWithCompetitors = snapshots.find(
    (s: any) => s.status === "completed" && s.detectedCompetitors?.length > 0,
  );

  if (!snapshotWithCompetitors) return null;

  const detected = (snapshotWithCompetitors.detectedCompetitors || []) as Array<{
    accountId: string; nickname: string; avatarUrl: string;
    followerCount: number; keywordAppearances: number;
    totalVideosInTop30: number; avgRank: number;
  }>;
  const existingIds = new Set(((campaign?.competitors || []) as any[]).map((c: any) => c.account_id));
  const newCandidates = detected.filter(d => !existingIds.has(d.accountId));

  if (newCandidates.length === 0) return null;

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <UserPlus className="h-4 w-4" />
          検出された競合候補（{newCandidates.length}件）
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">KW検索Top30に2つ以上のキーワードで出現するアカウントです</p>
        <div className="space-y-2">
          {newCandidates.map(d => (
            <label key={d.accountId} className="flex items-center gap-3 border rounded-lg p-2.5 cursor-pointer hover:bg-muted/50">
              <input
                type="checkbox"
                checked={selectedIds.includes(d.accountId)}
                onChange={() => toggleSelect(d.accountId)}
                className="rounded"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">@{d.accountId}</p>
                <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <span>{d.keywordAppearances}KWに出現</span>
                  <span>Top30内 {d.totalVideosInTop30}本</span>
                  <span>平均{d.avgRank}位</span>
                </div>
              </div>
            </label>
          ))}
        </div>
        {selectedIds.length > 0 && (
          <Button
            size="sm"
            onClick={() => applyMutation.mutate({
              campaignId,
              snapshotId: snapshotWithCompetitors.id,
              selectedAccountIds: selectedIds,
            })}
            disabled={applyMutation.isPending}
          >
            {applyMutation.isPending ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" />追加中...</> : `選択した${selectedIds.length}件を競合に追加`}
          </Button>
        )}
      </CardContent>
    </Card>
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
