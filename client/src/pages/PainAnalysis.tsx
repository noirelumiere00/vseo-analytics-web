import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { usePageTitle } from "@/hooks/usePageTitle";
import { trpc } from "@/lib/trpc";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useLocation, useRoute } from "wouter";
import {
  Crosshair, Loader2, CheckCircle2, AlertTriangle, Globe, Search,
  Users, Lightbulb, ShoppingCart, Clock, ChevronRight, ArrowRight,
  Plus, Trash2, ExternalLink, Hash, TrendingUp, Brain, UserCheck, Zap,
  Target, BarChart3,
} from "lucide-react";

// ================================================================
// History List
// ================================================================

function PainAnalysisHistoryList({ onSelect }: { onSelect: (id: number) => void }) {
  const { data, isLoading } = trpc.painAnalysis.list.useQuery({ limit: 20 });

  if (isLoading) return <div className="text-sm text-muted-foreground py-4 text-center"><Loader2 className="h-4 w-4 animate-spin inline mr-1" />読み込み中...</div>;
  if (!data?.items.length) return null;

  const statusConfig: Record<string, { label: string; cls: string }> = {
    completed: { label: "完了", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" },
    awaiting_approval: { label: "承認待ち", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" },
    verifying: { label: "検証中", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
    segmenting: { label: "分類中", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
    estimating: { label: "推定中", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
    proposing: { label: "生成中", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
    collecting: { label: "収集中", cls: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400" },
    hypothesizing: { label: "仮説生成", cls: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400" },
    pending: { label: "待機中", cls: "bg-slate-100 text-slate-600" },
    failed: { label: "失敗", cls: "bg-red-100 text-red-700" },
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5"><Clock className="h-4 w-4" />分析履歴</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {data.items.map(item => {
          const sc = statusConfig[item.status] || statusConfig.pending;
          return (
            <button key={item.id} onClick={() => onSelect(item.id)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-muted/60 transition-colors text-left group">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{item.productName}</p>
                <p className="text-[11px] text-muted-foreground">{new Date(item.createdAt).toLocaleDateString("ja-JP")}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${sc.cls}`}>{sc.label}</Badge>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ================================================================
// Status Polling View
// ================================================================

function PainAnalysisStatusView({ analysisId, onAwaitingApproval, onComplete }: {
  analysisId: number;
  onAwaitingApproval: () => void;
  onComplete: () => void;
}) {
  const { data } = trpc.painAnalysis.getStatus.useQuery(
    { analysisId },
    {
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        if (!s || s === "completed" || s === "failed" || s === "awaiting_approval") return false;
        return 2500;
      },
    }
  );

  useEffect(() => {
    if (data?.status === "completed") onComplete();
    if (data?.status === "awaiting_approval") onAwaitingApproval();
  }, [data?.status, onComplete, onAwaitingApproval]);

  const phases = [
    { key: "pending", label: "待機中", icon: Clock },
    { key: "collecting", label: "データ収集", icon: Globe },
    { key: "hypothesizing", label: "仮説生成", icon: Brain },
    { key: "awaiting_approval", label: "仮説確認", icon: UserCheck },
    { key: "verifying", label: "ペイン検証", icon: Search },
    { key: "segmenting", label: "セグメント分類", icon: Users },
    { key: "estimating", label: "購買態度推定", icon: ShoppingCart },
    { key: "proposing", label: "提案生成", icon: Lightbulb },
    { key: "completed", label: "完了", icon: CheckCircle2 },
  ];
  const currentIdx = phases.findIndex(p => p.key === data?.status);

  if (data?.status === "failed") {
    return (
      <Card className="border-red-200 bg-red-50/50 dark:bg-red-950/20">
        <CardContent className="py-8 text-center space-y-3">
          <AlertTriangle className="h-10 w-10 text-red-400 mx-auto" />
          <p className="text-sm font-medium text-red-700 dark:text-red-400">分析に失敗しました</p>
          {data.errorMessage && <p className="text-xs text-red-500">{data.errorMessage}</p>}
        </CardContent>
      </Card>
    );
  }

  if (data?.status === "awaiting_approval") return null; // Handled by parent

  return (
    <Card>
      <CardContent className="py-8">
        <div className="flex items-center justify-center gap-2 mb-6">
          <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
          <p className="text-sm font-medium">{data?.progress?.message || "分析を実行中です..."}</p>
        </div>
        {/* Progress bar */}
        <div className="max-w-lg mx-auto mb-6">
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{
                width: `${data?.progress?.percent || 0}%`,
                transition: "width 500ms var(--md-ease-standard)",
              }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground text-right mt-1">{data?.progress?.percent || 0}%</p>
        </div>
        {/* Phase indicators */}
        <div className="flex items-center justify-between max-w-2xl mx-auto overflow-x-auto gap-0.5">
          {phases.map((phase, i) => {
            const Icon = phase.icon;
            const done = i < currentIdx;
            const active = i === currentIdx;
            return (
              <div key={phase.key} className="flex flex-col items-center gap-1 flex-1 min-w-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-500 ${
                  done ? "bg-emerald-500 text-white" : active ? "bg-blue-500 text-white animate-pulse" : "bg-muted text-muted-foreground"
                }`}>
                  {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </div>
                <span className={`text-[9px] font-medium text-center leading-tight ${active ? "text-blue-600" : done ? "text-emerald-600" : "text-muted-foreground"}`}>
                  {phase.label}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ================================================================
// Hypothesis Approval View
// ================================================================

function HypothesisApprovalView({ analysisId, onApproved }: { analysisId: number; onApproved: () => void }) {
  const { data, isLoading } = trpc.painAnalysis.getHypotheses.useQuery({ analysisId });
  const approveMutation = trpc.painAnalysis.approveHypotheses.useMutation({
    onSuccess: () => {
      toast.success("検証を開始しました");
      onApproved();
    },
    onError: (err) => toast.error(err.message),
  });

  const [hypotheses, setHypotheses] = useState<Array<{
    id: string; pain: string; feature: string; searchQuery: string;
    confidence: number; approved: boolean; userAdded?: boolean;
  }>>([]);
  const [newPain, setNewPain] = useState("");

  useEffect(() => {
    if (data?.hypotheses && data.hypotheses.length > 0 && hypotheses.length === 0) {
      setHypotheses(data.hypotheses as any);
    }
  }, [data?.hypotheses, hypotheses.length]);

  if (isLoading) return <div className="py-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>;
  if (!data) return null;

  const features = data.productFeatures as any;
  const approvedCount = hypotheses.filter(h => h.approved).length;

  const toggleApproved = (id: string) => {
    setHypotheses(prev => prev.map(h => h.id === id ? { ...h, approved: !h.approved } : h));
  };

  const addCustomPain = () => {
    if (!newPain.trim()) return;
    const id = `pain_user_${Date.now()}`;
    setHypotheses(prev => [...prev, {
      id,
      pain: newPain.trim(),
      feature: "",
      searchQuery: newPain.trim(),
      confidence: 0.5,
      approved: true,
      userAdded: true,
    }]);
    setNewPain("");
  };

  const removePain = (id: string) => {
    setHypotheses(prev => prev.filter(h => h.id !== id));
  };

  const handleSubmit = () => {
    if (approvedCount === 0) {
      toast.error("少なくとも1つのペイン仮説を承認してください");
      return;
    }
    approveMutation.mutate({ analysisId, approvedHypotheses: hypotheses });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="border-l-4 border-l-amber-500 bg-amber-50/30 dark:bg-amber-950/10">
        <CardContent className="py-4">
          <div className="flex items-center gap-2 mb-1">
            <UserCheck className="h-5 w-5 text-amber-600" />
            <h2 className="text-base font-bold">ペイン仮説の確認</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            AIが生成したペイン仮説を確認してください。不要なものはチェックを外し、独自のペインも追加できます。
          </p>
        </CardContent>
      </Card>

      {/* Product Features */}
      {features && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Target className="h-4 w-4 text-blue-500" />
              抽出された商品特徴
            </CardTitle>
            <CardDescription>{data.productName} — {features.productCategory}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {features.features?.map((f: string, i: number) => (
                <Badge key={i} variant="secondary" className="text-xs">{f}</Badge>
              ))}
            </div>
            {features.targetAudience && (
              <p className="text-xs text-muted-foreground mt-2">
                <span className="font-medium">ターゲット:</span> {features.targetAudience}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Hypotheses List */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Brain className="h-4 w-4 text-purple-500" />
              ペイン仮説 ({approvedCount}/{hypotheses.length} 承認済み)
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {hypotheses.map(h => (
            <div
              key={h.id}
              className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${
                h.approved
                  ? "bg-white dark:bg-card border-border"
                  : "bg-muted/30 border-transparent opacity-60"
              }`}
            >
              <Checkbox
                checked={h.approved}
                onCheckedChange={() => toggleApproved(h.id)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <p className={`text-sm leading-snug ${h.approved ? "font-medium" : "line-through text-muted-foreground"}`}>
                  {h.pain}
                </p>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  {h.feature && (
                    <span className="text-[10px] text-blue-600 bg-blue-50 dark:bg-blue-950/30 rounded px-1.5 py-0.5">
                      {h.feature}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                    <Search className="h-2.5 w-2.5" />{h.searchQuery}
                  </span>
                  {/* Confidence bar */}
                  <div className="flex items-center gap-1">
                    <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-purple-500"
                        style={{ width: `${h.confidence * 100}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-muted-foreground">{Math.round(h.confidence * 100)}%</span>
                  </div>
                  {h.userAdded && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 text-amber-600 border-amber-300">ユーザー追加</Badge>
                  )}
                </div>
              </div>
              {h.userAdded && (
                <button onClick={() => removePain(h.id)} className="text-muted-foreground hover:text-red-500 transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}

          {/* Add custom pain */}
          <div className="flex gap-2 pt-2">
            <Input
              value={newPain}
              onChange={e => setNewPain(e.target.value)}
              placeholder="独自のペイン仮説を追加..."
              className="text-sm"
              onKeyDown={e => e.key === "Enter" && addCustomPain()}
            />
            <Button variant="outline" size="sm" onClick={addCustomPain} disabled={!newPain.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Submit */}
      <div className="flex justify-end">
        <Button
          onClick={handleSubmit}
          disabled={approvedCount === 0 || approveMutation.isPending}
          className="px-6"
        >
          {approveMutation.isPending ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />検証開始中...</>
          ) : (
            <><Search className="mr-2 h-4 w-4" />承認済み {approvedCount} 件で検証開始</>
          )}
        </Button>
      </div>
    </div>
  );
}

// ================================================================
// Result View
// ================================================================

function PainAnalysisResultView({ analysisId }: { analysisId: number }) {
  const { data, isLoading } = trpc.painAnalysis.getResult.useQuery({ analysisId });

  if (isLoading) return <div className="py-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>;
  if (!data) return <p className="text-sm text-muted-foreground text-center py-8">結果がありません</p>;

  const result = data.analysisResult as any;
  const segments = (data.segmentData as any)?.segments || [];
  const communities = (data.segmentData as any)?.communities || [];
  const verificationData = data.verificationData as any;
  const purchaseAttitudes = (data.purchaseAttitudes as any[]) || [];
  const proposals = (data.proposals as any[]) || [];

  return (
    <div className="space-y-5">
      {/* Executive Summary */}
      {result && (
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="py-5">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="h-5 w-5 text-emerald-500" />
              <h2 className="text-lg font-bold">{data.productName}</h2>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground mb-4">{result.executiveSummary}</p>

            {/* Segment Breakdown */}
            {result.segmentBreakdown && result.segmentBreakdown.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {result.segmentBreakdown.map((seg: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
                    <span className="text-lg">{seg.icon}</span>
                    <div>
                      <p className="text-xs font-semibold">{seg.segmentName}</p>
                      <p className="text-lg font-bold" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{seg.percentage}%</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Recommendations */}
            {result.recommendations && result.recommendations.length > 0 && (
              <div className="mt-4 space-y-1">
                <p className="text-[11px] font-medium text-emerald-600 uppercase tracking-wider">戦略提言</p>
                {result.recommendations.map((r: string, i: number) => (
                  <p key={i} className="text-sm flex items-start gap-1.5">
                    <ArrowRight className="h-3.5 w-3.5 mt-0.5 text-emerald-400 flex-shrink-0" />{r}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Segment Cards */}
      {segments.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
            <Users className="h-4 w-4 text-blue-500" />セグメント分析
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {segments.map((seg: any) => {
              const attitude = purchaseAttitudes.find((a: any) => a.segmentId === seg.id);
              return (
                <Card key={seg.id} className="overflow-hidden">
                  <div className="h-1 bg-gradient-to-r from-blue-500 to-purple-500" style={{ opacity: seg.matchScore }} />
                  <CardContent className="pt-4 pb-3 space-y-2.5">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{seg.icon}</span>
                        <div>
                          <h4 className="font-bold text-sm">{seg.name}</h4>
                          <p className="text-[10px] text-muted-foreground">マッチ度: {seg.matchScore >= 0.8 ? "高" : seg.matchScore >= 0.5 ? "中〜高" : "中"}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className={`text-[10px] ${
                        seg.matchScore >= 0.8 ? "border-emerald-300 text-emerald-700 bg-emerald-50" :
                        seg.matchScore >= 0.5 ? "border-blue-300 text-blue-700 bg-blue-50" :
                        "border-slate-300 text-slate-600"
                      }`}>
                        {Math.round(seg.matchScore * 100)}%
                      </Badge>
                    </div>

                    {/* Primary Pain */}
                    <div className="bg-red-50/50 dark:bg-red-950/10 rounded-md p-2">
                      <p className="text-[10px] font-medium text-red-600 mb-0.5">ペイン</p>
                      <p className="text-xs">{seg.primaryPain}</p>
                    </div>

                    {/* Appeals */}
                    {seg.appeals && seg.appeals.length > 0 && (
                      <div>
                        <p className="text-[10px] font-medium text-muted-foreground mb-1">訴求</p>
                        <div className="flex flex-wrap gap-1">
                          {seg.appeals.map((a: string, i: number) => (
                            <Badge key={i} variant="secondary" className="text-[10px]">{a}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Purchase Attitude */}
                    {attitude && (
                      <div className="bg-blue-50/50 dark:bg-blue-950/10 rounded-md p-2">
                        <p className="text-[10px] font-medium text-blue-600 mb-0.5">購買態度</p>
                        <p className="text-xs">{attitude.attitude}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{attitude.priceRange}</p>
                      </div>
                    )}

                    {/* Trend Stats */}
                    {seg.trendStats && (
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1 border-t">
                        <span className="flex items-center gap-0.5"><TrendingUp className="h-3 w-3" />ER: {seg.trendStats.avgER}%</span>
                        <span className="flex items-center gap-0.5"><BarChart3 className="h-3 w-3" />{seg.trendStats.postCount}件</span>
                        {seg.trendStats.topHashtags?.slice(0, 3).map((tag: string, i: number) => (
                          <span key={i} className="flex items-center gap-0.5"><Hash className="h-2.5 w-2.5" />{tag}</span>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Verified Pains */}
      {verificationData?.verifiedPains && verificationData.verifiedPains.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              検証済みペイン ({verificationData.verifiedPains.length}件)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {verificationData.verifiedPains.map((pain: any) => (
              <div key={pain.painId} className="flex items-center gap-3 py-2 border-b border-border/30 last:border-b-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{pain.pain}</p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                    <span>X: {pain.xPostCount}件</span>
                    <span>TT: {pain.ttVideoCount}件</span>
                  </div>
                </div>
                {/* Score bar */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        pain.verificationScore >= 0.7 ? "bg-emerald-500" :
                        pain.verificationScore >= 0.4 ? "bg-amber-500" : "bg-red-400"
                      }`}
                      style={{ width: `${pain.verificationScore * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono w-8 text-right">{Math.round(pain.verificationScore * 100)}%</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Proposals */}
      {proposals.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
            <Lightbulb className="h-4 w-4 text-amber-500" />訴求案
          </h3>
          <div className="space-y-4">
            {proposals.map((proposal: any) => (
              <Card key={proposal.segmentId}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{proposal.segmentName}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Copy Proposals */}
                  {proposal.copyProposals?.map((copy: any, i: number) => (
                    <div key={i} className="bg-muted/30 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Badge variant="outline" className="text-[9px] px-1 py-0">{copy.platform.toUpperCase()}</Badge>
                      </div>
                      <p className="text-sm font-semibold">{copy.headline}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{copy.body}</p>
                      {copy.cta && <p className="text-xs text-blue-600 mt-1">{copy.cta}</p>}
                    </div>
                  ))}

                  {/* Hashtags */}
                  {proposal.hashtagSets?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {proposal.hashtagSets.map((tag: string, i: number) => (
                        <span key={i} className="text-[11px] text-blue-600 bg-blue-50 rounded px-1.5 py-0.5">#{tag}</span>
                      ))}
                    </div>
                  )}

                  {/* Priority Actions */}
                  {proposal.priorityActions?.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">優先アクション</p>
                      {proposal.priorityActions.map((action: any, i: number) => (
                        <div key={i} className="flex items-start gap-2">
                          <Badge variant="secondary" className="text-[9px] px-1 py-0 flex-shrink-0 mt-0.5">{action.timeline}</Badge>
                          <div>
                            <p className="text-xs font-medium">{action.action}</p>
                            <p className="text-[10px] text-muted-foreground">{action.expectedImpact}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Representative Content */}
                  {proposal.representativeContent?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-2 border-t">
                      {proposal.representativeContent.map((content: any, i: number) => (
                        <a key={i} href={content.url} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] text-blue-600 bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5 hover:bg-blue-100 transition-colors flex items-center gap-0.5">
                          <ExternalLink className="h-2.5 w-2.5" />{content.platform} ({content.engagement.toLocaleString()})
                        </a>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ================================================================
// Main Page Component
// ================================================================

export default function PainAnalysis() {
  usePageTitle("ペイン分析");

  const [, setLocation] = useLocation();
  const [, params] = useRoute("/pain-analysis/:id");
  const analysisId = params?.id ? parseInt(params.id, 10) : null;

  const [productName, setProductName] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [view, setView] = useState<"input" | "status" | "approval" | "result">("input");

  const createMutation = trpc.painAnalysis.analyze.useMutation({
    onSuccess: (data) => {
      setLocation(`/pain-analysis/${data.analysisId}`);
    },
    onError: (err) => toast.error(err.message),
  });

  // Determine view based on status when analysisId changes
  const { data: statusData } = trpc.painAnalysis.getStatus.useQuery(
    { analysisId: analysisId! },
    { enabled: !!analysisId, refetchOnMount: true },
  );

  useEffect(() => {
    if (!analysisId) {
      setView("input");
      return;
    }
    if (!statusData) return;
    if (statusData.status === "completed") setView("result");
    else if (statusData.status === "awaiting_approval") setView("approval");
    else if (statusData.status === "failed") setView("status");
    else setView("status");
  }, [analysisId, statusData?.status]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName.trim()) return;
    createMutation.mutate({
      productName: productName.trim(),
      productUrl: productUrl.trim() || undefined,
    });
  };

  const handleAwaitingApproval = useCallback(() => {
    setView("approval");
  }, []);

  const handleComplete = useCallback(() => {
    setView("result");
  }, []);

  const handleApproved = useCallback(() => {
    setView("status");
  }, []);

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Crosshair className="h-5 w-5" />
            ペイン分析
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            商品名を入力するだけで、「誰が・どんな悩みで・どう買うか」を自動分析します
          </p>
        </div>

        {/* Input Form (show when no analysisId or view is input) */}
        {view === "input" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">新規分析</CardTitle>
              <CardDescription>商品名を入力してください。URLは任意です。</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-3">
                <Input
                  value={productName}
                  onChange={e => setProductName(e.target.value)}
                  placeholder="例: ナイキ エアマックス 90"
                  className="text-sm"
                  autoFocus
                />
                <Input
                  value={productUrl}
                  onChange={e => setProductUrl(e.target.value)}
                  placeholder="商品ページURL（任意）"
                  className="text-sm"
                  type="url"
                />
                <Button type="submit" disabled={!productName.trim() || createMutation.isPending} className="w-full">
                  {createMutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />分析を開始中...</>
                  ) : (
                    <><Crosshair className="mr-2 h-4 w-4" />ペイン分析を開始</>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Status View */}
        {view === "status" && analysisId && (
          <PainAnalysisStatusView
            analysisId={analysisId}
            onAwaitingApproval={handleAwaitingApproval}
            onComplete={handleComplete}
          />
        )}

        {/* Hypothesis Approval View */}
        {view === "approval" && analysisId && (
          <HypothesisApprovalView
            analysisId={analysisId}
            onApproved={handleApproved}
          />
        )}

        {/* Result View */}
        {view === "result" && analysisId && (
          <PainAnalysisResultView analysisId={analysisId} />
        )}

        {/* History */}
        <PainAnalysisHistoryList onSelect={(id) => setLocation(`/pain-analysis/${id}`)} />
      </div>
    </DashboardLayout>
  );
}
