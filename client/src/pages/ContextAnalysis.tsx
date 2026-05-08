import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { usePageTitle } from "@/hooks/usePageTitle";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useLocation, useRoute } from "wouter";
import {
  ScanSearch, Loader2, CheckCircle2, AlertTriangle, Globe, TrendingUp,
  Users, Eye, EyeOff, Target, ArrowRight, ExternalLink, Hash, MessageCircle,
  Newspaper, Star, ShieldAlert, Lightbulb, ChevronRight, Clock, Package,
} from "lucide-react";

// ── History List ──
function AnalysisHistoryList({ onSelect }: { onSelect: (id: number) => void }) {
  const { data, isLoading } = trpc.contextAnalyzer.list.useQuery({ limit: 20 });

  if (isLoading) return <div className="text-sm text-muted-foreground py-4 text-center"><Loader2 className="h-4 w-4 animate-spin inline mr-1" />読み込み中...</div>;
  if (!data?.items.length) return null;

  const statusConfig: Record<string, { label: string; cls: string }> = {
    completed: { label: "完了", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" },
    analyzing: { label: "分析中", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
    collecting: { label: "収集中", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" },
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

// ── Status Polling ──
function AnalysisStatusView({ analysisId, onComplete }: { analysisId: number; onComplete: () => void }) {
  const { data } = trpc.contextAnalyzer.getStatus.useQuery(
    { analysisId },
    { refetchInterval: (query) => {
      const s = query.state.data?.status;
      return (s === "pending" || s === "collecting" || s === "analyzing") ? 2500 : false;
    }}
  );

  useEffect(() => {
    if (data?.status === "completed") onComplete();
  }, [data?.status, onComplete]);

  const phases = [
    { key: "pending", label: "待機中", icon: Clock },
    { key: "collecting", label: "データ収集中", icon: Globe },
    { key: "analyzing", label: "AI分析中", icon: ScanSearch },
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

  return (
    <Card>
      <CardContent className="py-8">
        <div className="flex items-center justify-center gap-2 mb-8">
          <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
          <p className="text-sm font-medium">分析を実行中です...</p>
        </div>
        <div className="flex items-center justify-between max-w-md mx-auto">
          {phases.map((phase, i) => {
            const Icon = phase.icon;
            const done = i < currentIdx;
            const active = i === currentIdx;
            return (
              <div key={phase.key} className="flex flex-col items-center gap-1.5 flex-1">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 ${
                  done ? "bg-emerald-500 text-white" : active ? "bg-blue-500 text-white animate-pulse" : "bg-muted text-muted-foreground"
                }`}>
                  {done ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                </div>
                <span className={`text-[11px] font-medium ${active ? "text-blue-600" : done ? "text-emerald-600" : "text-muted-foreground"}`}>
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

// ── Result Display ──
function AnalysisResultView({ analysisId }: { analysisId: number }) {
  const { data, isLoading } = trpc.contextAnalyzer.getResult.useQuery({ analysisId });

  if (isLoading) return <div className="py-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>;
  if (!data?.analysisResult) return <p className="text-sm text-muted-foreground text-center py-8">結果がありません</p>;

  const r = data.analysisResult as any;
  const segments = r.segments || {};
  const gap = r.gapAnalysis || {};
  const contextMap = r.contextMap || [];

  const sentimentColor: Record<string, string> = {
    positive: "text-emerald-600 bg-emerald-50 border-emerald-200",
    neutral: "text-slate-600 bg-slate-50 border-slate-200",
    negative: "text-red-600 bg-red-50 border-red-200",
    mixed: "text-amber-600 bg-amber-50 border-amber-200",
  };
  const presenceColor: Record<string, { bg: string; text: string }> = {
    strong: { bg: "bg-emerald-500", text: "強い" },
    weak: { bg: "bg-amber-400", text: "弱い" },
    absent: { bg: "bg-red-400", text: "不在" },
  };

  return (
    <div className="space-y-5">
      {/* Summary */}
      <Card className="border-l-4 border-l-blue-500">
        <CardContent className="py-5">
          <h2 className="text-lg font-bold mb-2">{r.productName}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{r.summary}</p>
        </CardContent>
      </Card>

      {/* S1: Client Intent */}
      {segments.clientIntent && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Newspaper className="h-4 w-4 text-blue-500" />
              S1: クライアント発信
            </CardTitle>
            <CardDescription>PR・公式情報から読み取れる発信意図</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-blue-50/50 dark:bg-blue-950/20 rounded-lg p-3 space-y-1">
                <p className="text-[11px] font-medium text-blue-600 uppercase tracking-wider">主要メッセージ</p>
                <p className="text-sm">{segments.clientIntent.mainMessage}</p>
              </div>
              <div className="bg-blue-50/50 dark:bg-blue-950/20 rounded-lg p-3 space-y-1">
                <p className="text-[11px] font-medium text-blue-600 uppercase tracking-wider">ターゲット層</p>
                <p className="text-sm">{segments.clientIntent.targetAudience}</p>
              </div>
            </div>
            {segments.clientIntent.keyPoints?.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1.5">要点</p>
                <ul className="space-y-1">
                  {segments.clientIntent.keyPoints.map((pt: string, i: number) => (
                    <li key={i} className="text-sm flex items-start gap-1.5">
                      <ArrowRight className="h-3.5 w-3.5 mt-0.5 text-blue-400 flex-shrink-0" />{pt}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {segments.clientIntent.sources?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {segments.clientIntent.sources.map((s: any, i: number) => (
                  <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] text-blue-600 bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5 hover:bg-blue-100 transition-colors flex items-center gap-0.5">
                    <ExternalLink className="h-2.5 w-2.5" />{(s.title || s.url).slice(0, 40)}
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* S2: Social Reaction */}
      {segments.socialReaction && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-pink-500" />
              S2: SNS反応
            </CardTitle>
            <CardDescription>TikTok・Instagramでの語られ方</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {segments.socialReaction.tiktok && (
                <div className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded bg-slate-900 text-white text-[9px] font-black flex items-center justify-center">TT</span>
                    <span className="text-sm font-semibold">TikTok</span>
                    {segments.socialReaction.tiktok.videoCount > 0 && (
                      <Badge variant="secondary" className="text-[10px]">{segments.socialReaction.tiktok.videoCount}本</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{segments.socialReaction.tiktok.dominantNarrative}</p>
                  {segments.socialReaction.tiktok.topHashtags?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {segments.socialReaction.tiktok.topHashtags.map((tag: string, i: number) => (
                        <span key={i} className="text-[10px] font-medium text-cyan-600 bg-cyan-50 border border-cyan-100 rounded-full px-1.5 py-px">
                          #{tag.replace(/^#/, "")}
                        </span>
                      ))}
                    </div>
                  )}
                  {segments.socialReaction.tiktok.engagementPatterns?.length > 0 && (
                    <ul className="text-xs text-muted-foreground space-y-0.5">
                      {segments.socialReaction.tiktok.engagementPatterns.map((p: string, i: number) => (
                        <li key={i} className="flex items-start gap-1"><TrendingUp className="h-3 w-3 mt-0.5 text-cyan-400 flex-shrink-0" />{p}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {segments.socialReaction.instagram && (
                <div className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded bg-gradient-to-br from-purple-600 to-pink-500 text-white text-[9px] font-black flex items-center justify-center">IG</span>
                    <span className="text-sm font-semibold">Instagram</span>
                    {segments.socialReaction.instagram.videoCount > 0 && (
                      <Badge variant="secondary" className="text-[10px]">{segments.socialReaction.instagram.videoCount}本</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{segments.socialReaction.instagram.dominantNarrative}</p>
                  {segments.socialReaction.instagram.topHashtags?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {segments.socialReaction.instagram.topHashtags.map((tag: string, i: number) => (
                        <span key={i} className="text-[10px] font-medium text-pink-600 bg-pink-50 border border-pink-100 rounded-full px-1.5 py-px">
                          #{tag.replace(/^#/, "")}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* S3: Web Reputation */}
      {segments.webReputation && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Globe className="h-4 w-4 text-amber-500" />
              S3: Web評判
            </CardTitle>
            <CardDescription>レビュー・比較記事からの評価</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">総合センチメント:</span>
              <Badge className={`text-[11px] ${sentimentColor[segments.webReputation.overallSentiment] || ""}`}>
                {segments.webReputation.overallSentiment === "positive" ? "ポジティブ" :
                 segments.webReputation.overallSentiment === "negative" ? "ネガティブ" :
                 segments.webReputation.overallSentiment === "mixed" ? "混在" : "中立"}
              </Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-emerald-50/50 dark:bg-emerald-950/20 rounded-lg p-3">
                <p className="text-[11px] font-medium text-emerald-600 mb-1.5 flex items-center gap-1"><Star className="h-3 w-3" />強み</p>
                <ul className="space-y-0.5">
                  {(segments.webReputation.strengths || []).map((s: string, i: number) => (
                    <li key={i} className="text-sm flex items-start gap-1"><CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-emerald-400 flex-shrink-0" />{s}</li>
                  ))}
                </ul>
              </div>
              <div className="bg-red-50/50 dark:bg-red-950/20 rounded-lg p-3">
                <p className="text-[11px] font-medium text-red-600 mb-1.5 flex items-center gap-1"><ShieldAlert className="h-3 w-3" />弱み</p>
                <ul className="space-y-0.5">
                  {(segments.webReputation.weaknesses || []).map((s: string, i: number) => (
                    <li key={i} className="text-sm flex items-start gap-1"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-red-400 flex-shrink-0" />{s}</li>
                  ))}
                </ul>
              </div>
            </div>
            {segments.webReputation.comparisonContext && (
              <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
                <span className="font-medium text-foreground">競合ポジショニング: </span>{segments.webReputation.comparisonContext}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Gap Analysis */}
      {(gap.reachedAudiences?.length > 0 || gap.unreachedAudiences?.length > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4 text-violet-500" />
              ギャップ分析
            </CardTitle>
            <CardDescription>届いている層 vs 届いていない層</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {gap.reachedAudiences?.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-emerald-600 uppercase tracking-wider mb-2 flex items-center gap-1"><Eye className="h-3.5 w-3.5" />届いている層</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {gap.reachedAudiences.map((a: any, i: number) => (
                    <div key={i} className="border border-emerald-100 bg-emerald-50/30 dark:bg-emerald-950/10 rounded-lg p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{a.segment}</span>
                        <Badge variant="outline" className={`text-[10px] ${a.strength === "high" ? "border-emerald-300 text-emerald-600" : a.strength === "medium" ? "border-amber-300 text-amber-600" : "border-slate-300"}`}>
                          {a.strength === "high" ? "強" : a.strength === "medium" ? "中" : "弱"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{a.evidence}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {gap.unreachedAudiences?.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-violet-600 uppercase tracking-wider mb-2 flex items-center gap-1"><EyeOff className="h-3.5 w-3.5" />未開拓の層（チャンス）</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {gap.unreachedAudiences.map((a: any, i: number) => (
                    <div key={i} className="border border-violet-100 bg-violet-50/30 dark:bg-violet-950/10 rounded-lg p-3 space-y-1.5">
                      <span className="text-sm font-semibold">{a.segment}</span>
                      <p className="text-xs text-muted-foreground"><Lightbulb className="h-3 w-3 inline mr-0.5 text-amber-400" />{a.opportunity}</p>
                      <p className="text-xs text-red-500/80"><ShieldAlert className="h-3 w-3 inline mr-0.5" />{a.barrier}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {gap.competitorGaps?.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-orange-600 uppercase tracking-wider mb-2">競合ギャップ</p>
                <div className="space-y-1.5">
                  {gap.competitorGaps.map((c: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 text-sm bg-orange-50/30 dark:bg-orange-950/10 rounded-lg p-2.5 border border-orange-100">
                      <span className="font-semibold text-orange-700 whitespace-nowrap">{c.competitor}</span>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <p><span className="text-orange-600 font-medium">競合の強み:</span> {c.theirStrength}</p>
                        <p><span className="text-red-500 font-medium">自社の弱み:</span> {c.ourWeakness}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Context Map */}
      {contextMap.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Hash className="h-4 w-4 text-indigo-500" />
              コンテキストマップ
            </CardTitle>
            <CardDescription>悩み・切り口ごとの現在のカバー状況</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {contextMap.map((ctx: any, i: number) => {
                const presence = presenceColor[ctx.currentPresence] || presenceColor.absent;
                return (
                  <div key={i} className="border rounded-lg p-3 space-y-1.5 hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{ctx.context}</span>
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${presence.bg}`} />
                        <span className="text-[10px] text-muted-foreground">{presence.text}</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{ctx.description}</p>
                    <Badge variant="outline" className="text-[9px]">
                      {ctx.relevantPlatform === "tiktok" ? "TikTok" : ctx.relevantPlatform === "instagram" ? "Instagram" : "Web"}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Content Component (for embedding in ProductAnalysis tabs) ──
export function ContextAnalysisContent({ externalId, onNavigate }: { externalId?: number | null; onNavigate?: (id: number | null) => void }) {
  const [, setLocation] = useLocation();

  const analysisId = externalId ?? null;

  const [productName, setProductName] = useState("");
  const [activeId, setActiveId] = useState<number | null>(analysisId);
  const [showResult, setShowResult] = useState(false);

  const utils = trpc.useUtils();
  const createMutation = trpc.contextAnalyzer.analyze.useMutation({
    onSuccess: (data) => {
      toast.success("分析を開始しました");
      setActiveId(data.analysisId);
      setShowResult(false);
      setProductName("");
      utils.contextAnalyzer.list.invalidate();
      onNavigate?.(data.analysisId);
    },
    onError: (e) => toast.error(e.message),
  });

  // If URL has id, check if it's completed
  const { data: statusData } = trpc.contextAnalyzer.getStatus.useQuery(
    { analysisId: analysisId! },
    { enabled: !!analysisId }
  );

  useEffect(() => {
    if (analysisId) {
      setActiveId(analysisId);
      if (statusData?.status === "completed") setShowResult(true);
      else setShowResult(false);
    }
  }, [analysisId, statusData?.status]);

  // Sync external id changes
  useEffect(() => {
    if (externalId !== undefined) {
      setActiveId(externalId);
      if (!externalId) setShowResult(false);
    }
  }, [externalId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productName.trim()) return;
    createMutation.mutate({ productName: productName.trim() });
  };

  const handleSelectHistory = (id: number) => {
    setActiveId(id);
    setShowResult(false);
    onNavigate?.(id);
  };

  return (
    <div className="space-y-6">
      {/* Input Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Package className="h-4 w-4" />新しいコンテキスト分析</CardTitle>
          <CardDescription>分析したい商品名・サービス名を入力してください（例: 楽天カード、SHEIN、ユニクロ）</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex gap-3">
            <Input
              placeholder="商品名 / サービス名を入力..."
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              className="flex-1"
              disabled={createMutation.isPending}
            />
            <Button type="submit" disabled={!productName.trim() || createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ScanSearch className="h-4 w-4 mr-2" />}
              分析開始
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Active Analysis: Status or Result */}
      {activeId && !showResult && (
        <AnalysisStatusView analysisId={activeId} onComplete={() => setShowResult(true)} />
      )}
      {activeId && showResult && (
        <AnalysisResultView analysisId={activeId} />
      )}

      {/* History */}
      <AnalysisHistoryList onSelect={handleSelectHistory} />
    </div>
  );
}

// ── Main Page (redirect to product-analysis) ──
export default function ContextAnalysis() {
  usePageTitle("コンテキスト分析");
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/context-analysis/:id");
  const analysisId = params?.id ? parseInt(params.id, 10) : null;

  useEffect(() => {
    const url = analysisId
      ? `/product-analysis?tab=context&id=${analysisId}`
      : "/product-analysis?tab=context";
    setLocation(url, { replace: true });
  }, [analysisId, setLocation]);

  return null;
}
