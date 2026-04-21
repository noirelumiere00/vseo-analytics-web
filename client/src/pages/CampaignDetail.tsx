import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { usePageTitle } from "@/hooks/usePageTitle";
import { trpc } from "@/lib/trpc";
import { Camera, FileText, ArrowLeft, Loader2, CheckCircle2, XCircle, Clock, Video, UserPlus, Plus, Check, X, RefreshCw, ExternalLink, Target, Pencil } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { useState } from "react";
import { detectPlatform, platformLabel } from "@shared/videoUrl";
import { handleTrpcError } from "@/lib/error-handler";

function extractTikTokUsername(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/tiktok\.com\/@([a-zA-Z0-9_.]+)/);
  if (urlMatch) return urlMatch[1];
  if (trimmed.startsWith("@")) {
    const id = trimmed.slice(1).split(/[\s?#/]/)[0];
    return id || null;
  }
  if (/^[a-zA-Z0-9_.]+$/.test(trimmed)) return trimmed;
  return null;
}

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
  usePageTitle("施策詳細");
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
    onError: handleTrpcError,
  });

  const generateReportMutation = trpc.campaign.generateReport.useMutation({
    onSuccess: () => {
      toast.success("レポートを生成しました");
      detailQuery.refetch();
    },
    onError: handleTrpcError,
  });

  const scrapeVideosMutation = trpc.campaign.scrapeVideoUrls.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.videoCount}件の動画データ取得を開始しました（バックグラウンドで実行中）`);
      // Poll for completion - refetch every 5s for up to 2 minutes
      let attempts = 0;
      const pollInterval = setInterval(() => {
        detailQuery.refetch();
        attempts++;
        if (attempts >= 24) clearInterval(pollInterval); // Stop after 2 min
      }, 5000);
    },
    onError: handleTrpcError,
  });

  const applyCompetitorsMutation = trpc.campaign.applyDetectedCompetitors.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.added}件の競合を追加しました`);
      detailQuery.refetch();
    },
    onError: handleTrpcError,
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
  const isBaselineCompleted = latestBaseline?.status === "completed";

  // 既存の総再生数（目標再生数のデフォルト値に使用）
  const currentTotalViews = ((campaign as any)?.ownVideoData as any[] | undefined)
    ?.reduce((sum: number, v: any) => sum + (v.viewCount || 0), 0) ?? 0;

  // 目標再生数インライン編集
  const [targetViewsField, setTargetViewsField] = useState("");
  const [isEditingTarget, setIsEditingTarget] = useState(false);
  const updateCampaignMutation = trpc.campaign.update.useMutation({
    onSuccess: () => {
      detailQuery.refetch();
      setIsEditingTarget(false);
      setEditingKeywordField(null);
    },
    onError: handleTrpcError,
  });

  // キーワードインライン編集
  const [editingKeywordField, setEditingKeywordField] = useState<string | null>(null);
  const [editingKeywordText, setEditingKeywordText] = useState("");

  const startEditKeyword = (fieldName: string, values: string[]) => {
    setEditingKeywordField(fieldName);
    setEditingKeywordText(values.join("\n"));
  };

  const saveKeyword = (fieldName: string, required: boolean, hashtagMode: boolean) => {
    let lines = editingKeywordText.split("\n").map(s => s.trim()).filter(Boolean);
    if (required && lines.length === 0) {
      toast.error("最低1件は入力してください");
      return;
    }
    if (hashtagMode) {
      lines = lines.map(l => l.startsWith("#") ? l : `#${l}`);
    }
    updateCampaignMutation.mutate(
      { id: campaignId, [fieldName]: lines },
      { onSuccess: () => toast.success("キーワードを保存しました") },
    );
  };

  const startEditTarget = () => {
    setTargetViewsField(campaign?.targetViews ? String(campaign.targetViews) : currentTotalViews > 0 ? String(currentTotalViews) : "");
    setIsEditingTarget(true);
  };

  const saveTargetViews = () => {
    const raw = targetViewsField.trim().replace(/,/g, "");
    const parsed = raw ? parseInt(raw, 10) : null;
    if (raw && (!parsed || parsed <= 0 || isNaN(parsed))) {
      toast.error("目標再生数は正の整数で入力してください");
      return;
    }
    updateCampaignMutation.mutate(
      { id: campaignId, targetViews: parsed },
      { onSuccess: () => toast.success("目標再生数を保存しました") },
    );
  };

  // レポート生成ダイアログ
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [targetViewsInput, setTargetViewsInput] = useState("");

  const openReportDialog = () => {
    setTargetViewsInput(campaign?.targetViews ? String(campaign.targetViews) : currentTotalViews > 0 ? String(currentTotalViews) : "");
    setReportDialogOpen(true);
  };

  const handleGenerateReport = () => {
    const parsed = targetViewsInput.trim() ? parseInt(targetViewsInput.replace(/,/g, ""), 10) : undefined;
    if (targetViewsInput.trim() && (!parsed || parsed <= 0 || isNaN(parsed))) {
      toast.error("目標再生数は正の整数で入力してください");
      return;
    }
    generateReportMutation.mutate({
      campaignId,
      ...(parsed ? { targetViews: parsed } : {}),
    });
    setReportDialogOpen(false);
  };

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
          {/* Header Report Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {report ? (
              <>
                <Button
                  size="sm"
                  className="bg-primary text-primary-foreground"
                  onClick={() => setLocation(`/campaigns/${campaignId}/report`)}
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  レポートを表示
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openReportDialog}
                  disabled={generateReportMutation.isPending}
                >
                  {generateReportMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </Button>
              </>
            ) : latestMeasurement?.status === "completed" ? (
              <Button
                size="sm"
                onClick={openReportDialog}
                disabled={generateReportMutation.isPending}
              >
                {generateReportMutation.isPending ? (
                  <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />生成中...</>
                ) : (
                  <><FileText className="h-3.5 w-3.5 mr-1.5" />レポート生成</>
                )}
              </Button>
            ) : null}
          </div>
        </div>

        {/* Workflow Stepper */}
        {campaign && (
          <div className="flex items-center gap-2 text-xs">
            <StepIndicator
              label="ベースライン"
              status={latestBaseline?.status === "completed" ? "done" : latestBaseline?.status === "processing" || latestBaseline?.status === "queued" ? "active" : "pending"}
            />
            <div className="h-px flex-1 max-w-8 bg-border" />
            <StepIndicator
              label="効果測定"
              status={latestMeasurement?.status === "completed" ? "done" : latestMeasurement?.status === "processing" || latestMeasurement?.status === "queued" ? "active" : "pending"}
            />
            <div className="h-px flex-1 max-w-8 bg-border" />
            <StepIndicator
              label="レポート"
              status={report ? "done" : latestBaseline?.status === "completed" && latestMeasurement?.status === "completed" ? "ready" : "pending"}
            />
          </div>
        )}

        {/* Campaign Config Summary */}
        {campaign && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">キャンペーン設定</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              {/* 計測キーワード (required) */}
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">計測キーワード:</span>
                  {editingKeywordField !== "keywords" && (
                    <button onClick={() => startEditKeyword("keywords", (campaign.keywords as string[]) || [])} className="text-muted-foreground hover:text-foreground transition-colors">
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {editingKeywordField === "keywords" ? (
                  <div className="mt-1 space-y-1.5">
                    <Textarea
                      value={editingKeywordText}
                      onChange={e => setEditingKeywordText(e.target.value)}
                      placeholder="1行に1キーワード"
                      rows={3}
                      className="text-sm"
                      autoFocus
                    />
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => saveKeyword("keywords", true, false)} disabled={updateCampaignMutation.isPending}>
                        {updateCampaignMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingKeywordField(null)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(campaign.keywords as string[])?.map((kw, i) => (
                      <Badge key={i} variant="secondary">{kw}</Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* 自社アカウント (read-only, edited in the video section) */}
              {(campaign.ownAccountIds as string[])?.length > 0 && (
                <div>
                  <span className="text-muted-foreground">自社アカウント:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(campaign.ownAccountIds as string[]).map((aid, i) => (
                      <Badge key={i} variant="outline">@{aid}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* ビッグキーワード */}
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">ビッグキーワード:</span>
                  {editingKeywordField !== "bigKeywords" && (
                    <button onClick={() => startEditKeyword("bigKeywords", ((campaign as any).bigKeywords as string[]) || [])} className="text-muted-foreground hover:text-foreground transition-colors">
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {editingKeywordField === "bigKeywords" ? (
                  <div className="mt-1 space-y-1.5">
                    <Textarea
                      value={editingKeywordText}
                      onChange={e => setEditingKeywordText(e.target.value)}
                      placeholder="1行に1キーワード"
                      rows={3}
                      className="text-sm"
                      autoFocus
                    />
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => saveKeyword("bigKeywords", false, false)} disabled={updateCampaignMutation.isPending}>
                        {updateCampaignMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingKeywordField(null)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {((campaign as any).bigKeywords as string[])?.length > 0
                      ? ((campaign as any).bigKeywords as string[]).map((bk, i) => (
                          <Badge key={i} variant="secondary">{bk}</Badge>
                        ))
                      : <span className="text-muted-foreground text-xs">未設定</span>
                    }
                  </div>
                )}
              </div>

              {/* 施策ハッシュタグ */}
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">施策ハッシュタグ:</span>
                  {editingKeywordField !== "campaignHashtags" && (
                    <button onClick={() => startEditKeyword("campaignHashtags", (campaign.campaignHashtags as string[]) || [])} className="text-muted-foreground hover:text-foreground transition-colors">
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {editingKeywordField === "campaignHashtags" ? (
                  <div className="mt-1 space-y-1.5">
                    <Textarea
                      value={editingKeywordText}
                      onChange={e => setEditingKeywordText(e.target.value)}
                      placeholder="1行に1ハッシュタグ（#は自動付与）"
                      rows={3}
                      className="text-sm"
                      autoFocus
                    />
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => saveKeyword("campaignHashtags", false, true)} disabled={updateCampaignMutation.isPending}>
                        {updateCampaignMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingKeywordField(null)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(campaign.campaignHashtags as string[])?.length > 0
                      ? (campaign.campaignHashtags as string[]).map((tag, i) => (
                          <Badge key={i} variant="secondary">{tag}</Badge>
                        ))
                      : <span className="text-muted-foreground text-xs">未設定</span>
                    }
                  </div>
                )}
              </div>

              {/* ブランドキーワード */}
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">ブランドキーワード:</span>
                  {editingKeywordField !== "brandKeywords" && (
                    <button onClick={() => startEditKeyword("brandKeywords", ((campaign as any).brandKeywords as string[]) || [])} className="text-muted-foreground hover:text-foreground transition-colors">
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {editingKeywordField === "brandKeywords" ? (
                  <div className="mt-1 space-y-1.5">
                    <Textarea
                      value={editingKeywordText}
                      onChange={e => setEditingKeywordText(e.target.value)}
                      placeholder="1行に1キーワード"
                      rows={3}
                      className="text-sm"
                      autoFocus
                    />
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => saveKeyword("brandKeywords", false, false)} disabled={updateCampaignMutation.isPending}>
                        {updateCampaignMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingKeywordField(null)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {((campaign as any).brandKeywords as string[])?.length > 0
                      ? ((campaign as any).brandKeywords as string[]).map((bk, i) => (
                          <Badge key={i} variant="secondary">{bk}</Badge>
                        ))
                      : <span className="text-muted-foreground text-xs">未設定</span>
                    }
                  </div>
                )}
              </div>

              {/* ターゲット界隈 */}
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">ターゲット界隈:</span>
                  {editingKeywordField !== "targetCommunities" && (
                    <button onClick={() => startEditKeyword("targetCommunities", ((campaign as any).targetCommunities as string[]) || [])} className="text-muted-foreground hover:text-foreground transition-colors">
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {editingKeywordField === "targetCommunities" ? (
                  <div className="mt-1 space-y-1.5">
                    <Textarea
                      value={editingKeywordText}
                      onChange={e => setEditingKeywordText(e.target.value)}
                      placeholder="1行に1界隈"
                      rows={3}
                      className="text-sm"
                      autoFocus
                    />
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => saveKeyword("targetCommunities", false, false)} disabled={updateCampaignMutation.isPending}>
                        {updateCampaignMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingKeywordField(null)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {((campaign as any).targetCommunities as string[])?.length > 0
                      ? ((campaign as any).targetCommunities as string[]).map((tc, i) => (
                          <Badge key={i} variant="secondary">{tc}</Badge>
                        ))
                      : <span className="text-muted-foreground text-xs">未設定</span>
                    }
                  </div>
                )}
              </div>

              {/* 競合 (read-only) */}
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

        {/* 施策コンテンツの登録 */}
        {campaign && (
          <PostCampaignRegistration
            campaign={campaign}
            campaignId={campaignId}
            scrapeVideosMutation={scrapeVideosMutation}
            onRefetch={() => detailQuery.refetch()}
          />
        )}

        {/* 施策動画データ表示（ownVideoData がある場合） */}
        {campaign && (campaign as any).ownVideoData?.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Video className="h-4 w-4" />
                施策動画データ
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 md:grid-cols-2">
                {((campaign as any).ownVideoData as any[]).map((v: any) => (
                  <div key={v.videoId} className="border rounded-lg p-3 flex gap-3">
                    {v.coverUrl && (
                      <img src={v.coverUrl} alt="" className="w-16 h-20 rounded object-cover flex-shrink-0" loading="lazy" />
                    )}
                    <div className="min-w-0 flex-1 text-xs">
                      <div className="flex items-center gap-1.5">
                        {v.platform && v.platform !== "tiktok" && (
                          <Badge variant="outline" className={`text-[9px] px-1 py-0 ${
                            v.platform === "youtube" ? "border-red-300 text-red-600" : "border-purple-300 text-purple-600"
                          }`}>{platformLabel(v.platform)}</Badge>
                        )}
                        <p className="font-medium truncate">{v.title || v.description?.slice(0, 40) || v.videoId}</p>
                      </div>
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

        {/* 目標再生数 */}
        <Card>
          <CardContent className="py-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 bg-orange-100 dark:bg-orange-950/40 text-orange-600">
              <Target className="h-4 w-4" />
            </div>
            {isEditingTarget ? (
              <div className="flex-1 flex items-center gap-2">
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="例: 100000"
                  value={targetViewsField}
                  onChange={e => setTargetViewsField(e.target.value)}
                  className="h-8 w-40 text-sm"
                  autoFocus
                  onKeyDown={e => { if (e.key === "Enter") saveTargetViews(); if (e.key === "Escape") setIsEditingTarget(false); }}
                />
                <Button size="sm" variant="ghost" onClick={saveTargetViews} disabled={updateCampaignMutation.isPending}>
                  {updateCampaignMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setIsEditingTarget(false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">目標再生数</p>
                  <p className="text-xs text-muted-foreground">
                    {campaign?.targetViews
                      ? `${Number(campaign.targetViews).toLocaleString()} 再生`
                      : "未設定"}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={startEditTarget}>
                  {campaign?.targetViews ? "変更" : "設定"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Report */}
        <Card className={report ? "border-green-200 bg-green-50/30" : ""}>
          <CardContent className="py-4 flex items-center gap-3">
            <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${report ? "bg-green-100 text-green-600" : "bg-muted text-muted-foreground"}`}>
              <FileText className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">施策効果レポート</p>
              <p className="text-xs text-muted-foreground">
                {report
                  ? `生成済み（${new Date(report.createdAt).toLocaleDateString("ja-JP")}）`
                  : latestMeasurement?.status === "completed"
                  ? `スナップショット完了 — レポート生成可能${!latestBaseline || latestBaseline.status !== "completed" ? "（ベースラインなし）" : ""}`
                  : "効果測定の完了後に生成可能"}
              </p>
            </div>
            {report ? (
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" onClick={() => setLocation(`/campaigns/${campaignId}/report`)}>
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  表示
                </Button>
                <Button
                  size="sm" variant="ghost"
                  onClick={openReportDialog}
                  disabled={generateReportMutation.isPending}
                >
                  {generateReportMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                </Button>
              </div>
            ) : latestMeasurement?.status === "completed" ? (
              <Button
                size="sm"
                onClick={openReportDialog}
                disabled={generateReportMutation.isPending}
              >
                {generateReportMutation.isPending ? (
                  <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />生成中...</>
                ) : (
                  "レポート生成"
                )}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* レポート生成ダイアログ */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              レポート生成
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="targetViews">目標再生数（任意）</Label>
              <Input
                id="targetViews"
                type="text"
                inputMode="numeric"
                placeholder="例: 100000"
                value={targetViewsInput}
                onChange={e => setTargetViewsInput(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                設定するとレポートに目標達成率と目標ラインが表示されます
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportDialogOpen(false)}>
              キャンセル
            </Button>
            <Button onClick={handleGenerateReport} disabled={generateReportMutation.isPending}>
              {generateReportMutation.isPending ? (
                <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />生成中...</>
              ) : (
                <><FileText className="h-4 w-4 mr-1.5" />レポート生成</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

// ============================
// 施策コンテンツ登録セクション
// ============================

function PostCampaignRegistration({
  campaign, campaignId, scrapeVideosMutation, onRefetch,
}: {
  campaign: any;
  campaignId: number;
  scrapeVideosMutation: any;
  onRefetch: () => void;
}) {
  const [videoUrl, setVideoUrl] = useState("");
  const [accountUrl, setAccountUrl] = useState("");
  const [satelliteUrl, setSatelliteUrl] = useState("");
  const [competitorUrl, setCompetitorUrl] = useState("");

  const updateMutation = trpc.campaign.update.useMutation({
    onSuccess: () => {
      onRefetch();
    },
    onError: handleTrpcError,
  });

  const handleAddVideos = () => {
    const lines = videoUrl.split("\n").map(s => s.trim()).filter(Boolean)
      .map(u => /^https?:\/\//i.test(u) ? u : `https://${u}`);
    if (lines.length === 0) { toast.error("URLを入力してください"); return; }

    const invalid = lines.filter(u => detectPlatform(u) === null);
    if (invalid.length > 0) { toast.error(`対応していないURLが${invalid.length}件あります（TikTok/YouTube/Instagram対応）`); return; }

    const existingUrls = (campaign.ownVideoUrls as string[]) || [];
    const existingLower = new Set(existingUrls.map(u => u.toLowerCase()));
    const newUrls = lines.filter(u => !existingLower.has(u.toLowerCase()));
    if (newUrls.length === 0) { toast.error("全て登録済みのURLです"); return; }

    updateMutation.mutate({
      id: campaignId,
      ownVideoUrls: [...existingUrls, ...newUrls],
    }, {
      onSuccess: () => {
        toast.success(`${newUrls.length}件の動画URLを追加しました`);
        setVideoUrl("");
        scrapeVideosMutation.mutate({ campaignId });
      },
    });
  };

  const handleAddAccounts = () => {
    const lines = accountUrl.split("\n").map(s => s.trim()).filter(Boolean);
    if (lines.length === 0) { toast.error("アカウントを入力してください"); return; }

    const parsed = lines.map(l => extractTikTokUsername(l));
    const invalid = lines.filter((_, i) => !parsed[i]);
    if (invalid.length > 0) { toast.error(`解析できないアカウントが${invalid.length}件あります`); return; }

    const validIds = parsed.filter(Boolean) as string[];
    const existing = new Set((campaign.ownAccountIds as string[]) || []);
    const newIds = validIds.filter(id => !existing.has(id));
    if (newIds.length === 0) { toast.error("全て登録済みのアカウントです"); return; }

    updateMutation.mutate({
      id: campaignId,
      ownAccountIds: [...existing, ...newIds],
    }, {
      onSuccess: () => {
        toast.success(`${newIds.length}件のアカウントを追加しました`);
        setAccountUrl("");
      },
    });
  };

  const handleAddSatellites = () => {
    const lines = satelliteUrl.split("\n").map(s => s.trim()).filter(Boolean);
    if (lines.length === 0) { toast.error("アカウントを入力してください"); return; }

    const parsed = lines.map(l => extractTikTokUsername(l));
    const invalid = lines.filter((_, i) => !parsed[i]);
    if (invalid.length > 0) { toast.error(`解析できないアカウントが${invalid.length}件あります`); return; }

    const validIds = parsed.filter(Boolean) as string[];
    const existing = new Set(((campaign as any).satelliteAccountIds as string[]) || []);
    const newIds = validIds.filter(id => !existing.has(id));
    if (newIds.length === 0) { toast.error("全て登録済みのアカウントです"); return; }

    updateMutation.mutate({
      id: campaignId,
      satelliteAccountIds: [...existing, ...newIds],
    }, {
      onSuccess: () => {
        toast.success(`${newIds.length}件のサテライトアカウントを追加しました`);
        setSatelliteUrl("");
      },
    });
  };

  const handleAddCompetitors = () => {
    const lines = competitorUrl.split("\n").map(s => s.trim()).filter(Boolean);
    if (lines.length === 0) { toast.error("競合アカウントを入力してください"); return; }

    const parsed = lines.map(l => extractTikTokUsername(l));
    const invalid = lines.filter((_, i) => !parsed[i]);
    if (invalid.length > 0) { toast.error(`解析できないアカウントが${invalid.length}件あります`); return; }

    const validIds = parsed.filter(Boolean) as string[];
    const existing = (campaign.competitors as any[]) || [];
    const existingIds = new Set(existing.map((c: any) => c.account_id));
    const newIds = validIds.filter(id => !existingIds.has(id));
    if (newIds.length === 0) { toast.error("全て登録済みの競合です"); return; }

    updateMutation.mutate({
      id: campaignId,
      competitors: [...existing, ...newIds.map(id => ({ name: id, account_id: id }))],
    }, {
      onSuccess: () => {
        toast.success(`${newIds.length}件の競合を追加しました`);
        setCompetitorUrl("");
      },
    });
  };

  const accountLines = accountUrl.split("\n").map(s => s.trim()).filter(Boolean);
  const satelliteLines = satelliteUrl.split("\n").map(s => s.trim()).filter(Boolean);
  const competitorLines = competitorUrl.split("\n").map(s => s.trim()).filter(Boolean);

  return (
    <Card className="border-blue-200 bg-blue-50/30">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Plus className="h-4 w-4" />
          施策コンテンツの登録
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">施策で投稿した動画やアカウントを登録してください</p>

        {/* 施策動画 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">施策動画URL（1行1URL）</Label>
          {((campaign.ownVideoUrls as string[]) || []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {((campaign.ownVideoUrls as string[]) || []).map((url, i) => {
              const plat = detectPlatform(url);
              const platColors = plat === "youtube" ? "bg-red-50 text-red-700 border-red-200"
                : plat === "instagram" ? "bg-purple-50 text-purple-700 border-purple-200"
                : "bg-slate-100 text-slate-700 border-slate-200";
              return (
                <span key={i} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${platColors}`}>
                  {plat && <span className="font-medium">{platformLabel(plat)}</span>}
                  <span className="truncate max-w-[200px]">{url.replace(/^https?:\/\/(www\.)?(tiktok|youtube|instagram)\.com\//, "").slice(0, 35)}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const urlToRemove = (campaign.ownVideoUrls as string[])[i];
                      const updatedUrls = ((campaign.ownVideoUrls as string[]) || []).filter((_, idx) => idx !== i);
                      const updatedData = ((campaign as any).ownVideoData || []).filter((v: any) => v.videoUrl !== urlToRemove);
                      updateMutation.mutate({ id: campaignId, ownVideoUrls: updatedUrls, ownVideoData: updatedData }, {
                        onSuccess: () => { toast.success("動画URLを削除しました"); onRefetch(); },
                      });
                    }}
                    disabled={updateMutation.isPending}
                    className="hover:text-red-600 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
              })}
            </div>
          )}
          <Textarea
            value={videoUrl}
            onChange={e => setVideoUrl(e.target.value)}
            placeholder={"https://www.tiktok.com/@user/video/123...\nhttps://www.youtube.com/watch?v=...\nhttps://www.instagram.com/reel/..."}
            rows={4}
            className="bg-white"
          />
          <div className="flex items-center justify-end">
            <Button
              size="sm"
              onClick={handleAddVideos}
              disabled={updateMutation.isPending || !videoUrl.trim()}
            >
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "一括追加"}
            </Button>
          </div>
        </div>

        {/* 自社アカウント */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">自社 TikTok アカウント追加（1行1アカウント）</Label>
          {((campaign.ownAccountIds as string[]) || []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {((campaign.ownAccountIds as string[]) || []).map((id, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  @{id}
                  <button
                    type="button"
                    onClick={() => {
                      const updated = ((campaign.ownAccountIds as string[]) || []).filter((_, idx) => idx !== i);
                      updateMutation.mutate({ id: campaignId, ownAccountIds: updated }, {
                        onSuccess: () => { toast.success("アカウントを削除しました"); onRefetch(); },
                      });
                    }}
                    disabled={updateMutation.isPending}
                    className="hover:text-red-600 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <Textarea
            value={accountUrl}
            onChange={e => setAccountUrl(e.target.value)}
            placeholder={"https://www.tiktok.com/@account1\nhttps://www.tiktok.com/@account2\n@account3"}
            rows={3}
            className="bg-white"
          />
          {accountLines.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {accountLines.map((line, i) => {
                const parsed = extractTikTokUsername(line);
                return (
                  <span key={i} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${parsed ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-600 border border-red-200"}`}>
                    {parsed ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    {parsed ? `@${parsed}` : line.slice(0, 30)}
                  </span>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-end">
            <Button
              size="sm"
              onClick={handleAddAccounts}
              disabled={updateMutation.isPending || !accountUrl.trim()}
            >
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "一括追加"}
            </Button>
          </div>
        </div>

        {/* サテライトアカウント */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">サテライトアカウント追加（1行1アカウント）</Label>
          {(((campaign as any).satelliteAccountIds as string[]) || []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {(((campaign as any).satelliteAccountIds as string[]) || []).map((id, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                  @{id}
                  <button
                    type="button"
                    onClick={() => {
                      const updated = (((campaign as any).satelliteAccountIds as string[]) || []).filter((_, idx) => idx !== i);
                      updateMutation.mutate({ id: campaignId, satelliteAccountIds: updated }, {
                        onSuccess: () => { toast.success("サテライトアカウントを削除しました"); onRefetch(); },
                      });
                    }}
                    disabled={updateMutation.isPending}
                    className="hover:text-red-600 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <Textarea
            value={satelliteUrl}
            onChange={e => setSatelliteUrl(e.target.value)}
            placeholder={"https://www.tiktok.com/@satellite1\n@satellite2"}
            rows={3}
            className="bg-white"
          />
          {satelliteLines.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {satelliteLines.map((line, i) => {
                const parsed = extractTikTokUsername(line);
                return (
                  <span key={i} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${parsed ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-600 border border-red-200"}`}>
                    {parsed ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    {parsed ? `@${parsed}` : line.slice(0, 30)}
                  </span>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-end">
            <Button
              size="sm"
              onClick={handleAddSatellites}
              disabled={updateMutation.isPending || !satelliteUrl.trim()}
            >
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "一括追加"}
            </Button>
          </div>
        </div>

        {/* 競合追加 */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">競合追加（1行1アカウント）</Label>
          {((campaign.competitors as any[]) || []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {((campaign.competitors as any[]) || []).map((c: any, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">
                  @{c.account_id}
                  <button
                    type="button"
                    onClick={() => {
                      const updated = ((campaign.competitors as any[]) || []).filter((_, idx) => idx !== i);
                      updateMutation.mutate({ id: campaignId, competitors: updated }, {
                        onSuccess: () => { toast.success("競合を削除しました"); onRefetch(); },
                      });
                    }}
                    disabled={updateMutation.isPending}
                    className="hover:text-red-600 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <Textarea
            value={competitorUrl}
            onChange={e => setCompetitorUrl(e.target.value)}
            placeholder={"https://www.tiktok.com/@competitor_a\nhttps://www.tiktok.com/@competitor_b\n@competitor_c"}
            rows={3}
            className="bg-white"
          />
          {competitorLines.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {competitorLines.map((line, i) => {
                const parsed = extractTikTokUsername(line);
                return (
                  <span key={i} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${parsed ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-600 border border-red-200"}`}>
                    {parsed ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    {parsed ? `@${parsed}` : line.slice(0, 30)}
                  </span>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-end">
            <Button
              size="sm"
              onClick={handleAddCompetitors}
              disabled={updateMutation.isPending || !competitorUrl.trim()}
            >
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "一括追加"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================
// 検出された競合
// ============================

function DetectedCompetitorsCard({
  campaign, snapshots, campaignId, applyMutation,
}: {
  campaign: any;
  snapshots: any[];
  campaignId: number;
  applyMutation: any;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

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
  // 自社アカウント + 施策動画投稿者を除外（古いスナップショットで混入したケース対応）
  const ownAccountIds = new Set((campaign?.ownAccountIds || []).map((id: string) => id.toLowerCase()));
  const ownVideoAuthors = new Set(
    ((campaign?.ownVideoData || []) as any[]).map((v: any) => (v.authorUniqueId || "").toLowerCase()).filter(Boolean)
  );
  const newCandidates = detected.filter(d =>
    !existingIds.has(d.accountId) &&
    !ownAccountIds.has(d.accountId.toLowerCase()) &&
    !ownVideoAuthors.has(d.accountId.toLowerCase())
  );

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

function StepIndicator({ label, status }: { label: string; status: "pending" | "active" | "ready" | "done" }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${
      status === "done" ? "bg-green-100 text-green-700" :
      status === "active" ? "bg-blue-100 text-blue-700" :
      status === "ready" ? "bg-amber-100 text-amber-700" :
      "bg-muted text-muted-foreground"
    }`}>
      {status === "done" ? <CheckCircle2 className="h-3 w-3" /> :
       status === "active" ? <Loader2 className="h-3 w-3 animate-spin" /> :
       status === "ready" ? <FileText className="h-3 w-3" /> :
       <Clock className="h-3 w-3" />}
      <span>{label}</span>
    </div>
  );
}

function SnapshotProgressBar({ snapshotId }: { snapshotId: number }) {
  const progressQuery = trpc.campaign.getSnapshotProgress.useQuery(
    { snapshotId },
    { refetchInterval: (query) => {
        const p = query.state.data?.progress?.percent;
        return (p != null && p >= 100) ? false : 2000;
      }
    },
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
