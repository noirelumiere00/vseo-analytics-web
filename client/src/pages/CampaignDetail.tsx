import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2, ArrowLeft, Play, Eye, Heart, MessageCircle, Share2,
  Bookmark, TrendingUp, TrendingDown, Target, DollarSign,
  CheckCircle, AlertTriangle, ArrowUpRight, ArrowDownRight, Copy,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useParams, useLocation } from "wouter";
import { toast } from "sonner";

const evaluationConfig: Record<string, { label: string; color: string; bg: string }> = {
  excellent: { label: "優秀", color: "text-green-700", bg: "bg-green-50 border-green-200" },
  good: { label: "良好", color: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
  needs_improvement: { label: "改善必要", color: "text-yellow-700", bg: "bg-yellow-50 border-yellow-200" },
  poor: { label: "要改善", color: "text-red-700", bg: "bg-red-50 border-red-200" },
};

export default function CampaignDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const campaignId = parseInt(params.id || "0");

  const { data, isLoading, refetch } = trpc.campaign.getById.useQuery(
    { id: campaignId },
    { enabled: campaignId > 0, refetchInterval: (query) => {
      const status = query.state.data?.campaign?.status;
      return status === "processing" || status === "pending" ? 3000 : false;
    }},
  );
  const executeMutation = trpc.campaign.execute.useMutation({
    onSuccess: () => {
      toast.success("分析を開始しました");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">施策レポートが見つかりません</p>
      </div>
    );
  }

  const { campaign, videos } = data;
  const isComplete = campaign.status === "completed";
  const isProcessing = campaign.status === "processing";
  const isPending = campaign.status === "pending";
  const comparison = campaign.beforeAfterComparison as any;
  const effectAnalysis = campaign.effectAnalysis as any[] || [];
  const nextRecs = campaign.nextRecommendations as any[] || [];

  return (
    <div className="min-h-screen bg-background">
      <div className="container py-8">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => setLocation("/campaign")}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-3xl font-bold">
                  <span className="gradient-text">{campaign.campaignName}</span>
                </h1>
                <p className="text-muted-foreground mt-1">
                  {campaign.keyword && `KW: ${campaign.keyword}`}
                  {campaign.startDate && ` | ${new Date(campaign.startDate).toLocaleDateString("ja-JP")}`}
                  {campaign.endDate && ` ～ ${new Date(campaign.endDate).toLocaleDateString("ja-JP")}`}
                </p>
              </div>
            </div>
            {isPending && (
              <Button
                className="gradient-primary text-white"
                onClick={() => executeMutation.mutate({ id: campaignId })}
                disabled={executeMutation.isPending}
              >
                {executeMutation.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />開始中...</>
                ) : (
                  "分析を実行"
                )}
              </Button>
            )}
          </div>

          {/* Processing State */}
          {isProcessing && (
            <Card>
              <CardContent className="py-8 text-center">
                <Loader2 className="animate-spin h-10 w-10 text-primary mx-auto mb-4" />
                <p className="text-lg font-medium">施策分析を実行中...</p>
                <p className="text-muted-foreground mt-1">動画データの取得・センチメント分析・AI評価を行っています</p>
                <Progress value={50} className="mt-4 max-w-md mx-auto" />
              </CardContent>
            </Card>
          )}

          {/* Failed State */}
          {campaign.status === "failed" && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="py-6 text-center">
                <AlertTriangle className="h-10 w-10 text-red-500 mx-auto mb-2" />
                <p className="text-red-700 font-medium">分析に失敗しました</p>
                <Button variant="outline" className="mt-3" onClick={() => executeMutation.mutate({ id: campaignId })}>
                  再実行
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Completed: Full Report */}
          {isComplete && (
            <Tabs defaultValue="overview">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="overview">総合評価</TabsTrigger>
                <TabsTrigger value="videos">成果物</TabsTrigger>
                <TabsTrigger value="comparison">Before/After</TabsTrigger>
                <TabsTrigger value="next">Next提案</TabsTrigger>
              </TabsList>

              {/* Tab: 総合評価 */}
              <TabsContent value="overview" className="space-y-6">
                {/* Evaluation Banner */}
                {campaign.overallEvaluation && (
                  <Card className={`border-2 ${evaluationConfig[campaign.overallEvaluation]?.bg || ""}`}>
                    <CardContent className="py-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">総合評価</p>
                          <p className={`text-3xl font-bold ${evaluationConfig[campaign.overallEvaluation]?.color || ""}`}>
                            {evaluationConfig[campaign.overallEvaluation]?.label || campaign.overallEvaluation}
                          </p>
                        </div>
                        <CheckCircle className={`h-12 w-12 ${evaluationConfig[campaign.overallEvaluation]?.color || ""}`} />
                      </div>
                      {campaign.evaluationSummary && (
                        <p className="mt-3 text-sm leading-relaxed">{campaign.evaluationSummary}</p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* KPI Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard
                    icon={<Eye className="h-5 w-5" />}
                    label="合計再生数"
                    value={Number(campaign.totalViews || 0).toLocaleString()}
                    sub={campaign.viewsAchievementRate ? `目標達成率 ${campaign.viewsAchievementRate}%` : undefined}
                    subColor={campaign.viewsAchievementRate && campaign.viewsAchievementRate >= 100 ? "text-green-600" : "text-yellow-600"}
                  />
                  <MetricCard
                    icon={<TrendingUp className="h-5 w-5" />}
                    label="平均ER"
                    value={`${((campaign.avgEngagementRate || 0) / 100).toFixed(2)}%`}
                    sub={campaign.erAchievementRate ? `目標達成率 ${campaign.erAchievementRate}%` : undefined}
                    subColor={campaign.erAchievementRate && campaign.erAchievementRate >= 100 ? "text-green-600" : "text-yellow-600"}
                  />
                  <MetricCard
                    icon={<DollarSign className="h-5 w-5" />}
                    label="CPV"
                    value={campaign.cpv ? `¥${(campaign.cpv / 100).toFixed(1)}` : "N/A"}
                  />
                  <MetricCard
                    icon={<Target className="h-5 w-5" />}
                    label="CPE"
                    value={campaign.cpe ? `¥${(campaign.cpe / 100).toFixed(1)}` : "N/A"}
                  />
                </div>

                {/* Engagement Breakdown */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <EngagementCard icon={<Heart className="h-4 w-4 text-red-500" />} label="いいね" value={Number(campaign.totalLikes || 0).toLocaleString()} />
                  <EngagementCard icon={<MessageCircle className="h-4 w-4 text-blue-500" />} label="コメント" value={Number(campaign.totalComments || 0).toLocaleString()} />
                  <EngagementCard icon={<Share2 className="h-4 w-4 text-green-500" />} label="シェア" value={Number(campaign.totalShares || 0).toLocaleString()} />
                  <EngagementCard icon={<Bookmark className="h-4 w-4 text-purple-500" />} label="保存" value={Number(campaign.totalSaves || 0).toLocaleString()} />
                  <EngagementCard icon={<Play className="h-4 w-4 text-orange-500" />} label="動画数" value={`${campaign.totalVideos || 0}本`} />
                </div>

                {/* Sentiment */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">センチメント分布</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-2 h-8 rounded-full overflow-hidden">
                      {(campaign.positivePercentage || 0) > 0 && (
                        <div className="bg-green-500 flex items-center justify-center text-white text-xs font-medium" style={{ width: `${campaign.positivePercentage}%` }}>
                          {campaign.positivePercentage}%
                        </div>
                      )}
                      {(campaign.neutralPercentage || 0) > 0 && (
                        <div className="bg-gray-400 flex items-center justify-center text-white text-xs font-medium" style={{ width: `${campaign.neutralPercentage}%` }}>
                          {campaign.neutralPercentage}%
                        </div>
                      )}
                      {(campaign.negativePercentage || 0) > 0 && (
                        <div className="bg-red-500 flex items-center justify-center text-white text-xs font-medium" style={{ width: `${campaign.negativePercentage}%` }}>
                          {campaign.negativePercentage}%
                        </div>
                      )}
                    </div>
                    <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                      <span>Positive {campaign.positiveCount}本</span>
                      <span>Neutral {campaign.neutralCount}本</span>
                      <span>Negative {campaign.negativeCount}本</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Effect Analysis */}
                {effectAnalysis.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">効果分析</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {effectAnalysis.map((item: any, i: number) => (
                        <div key={i} className={`p-3 rounded-lg border ${
                          item.category === "strength" ? "bg-green-50 border-green-200" :
                          item.category === "improvement" ? "bg-yellow-50 border-yellow-200" :
                          "bg-red-50 border-red-200"
                        }`}>
                          <div className="flex items-center gap-2">
                            <Badge variant={item.category === "strength" ? "default" : item.category === "improvement" ? "secondary" : "destructive"}>
                              {item.category === "strength" ? "強み" : item.category === "improvement" ? "改善点" : "リスク"}
                            </Badge>
                            <span className="font-medium text-sm">{item.title}</span>
                          </div>
                          <p className="text-sm mt-1 text-muted-foreground">{item.description}</p>
                          {item.metric && <p className="text-xs mt-1 font-mono">{item.metric}</p>}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Tab: 成果物（動画一覧） */}
              <TabsContent value="videos" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">施策動画一覧 ({videos.length}本)</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {videos.map((v) => {
                      const views = Number(v.viewCount) || 0;
                      const eng = (Number(v.likeCount)||0) + (Number(v.commentCount)||0) + (Number(v.shareCount)||0) + (Number(v.saveCount)||0);
                      const er = views > 0 ? ((eng / views) * 100).toFixed(2) : "0";

                      return (
                        <div key={v.id} className="flex gap-4 p-4 rounded-lg border hover:bg-muted/50 transition-colors">
                          {/* Thumbnail */}
                          <div className="flex-shrink-0 w-24 h-32 rounded-md overflow-hidden bg-muted">
                            {v.thumbnailUrl ? (
                              <img src={v.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Play className="h-8 w-8 text-muted-foreground" />
                              </div>
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-sm truncate">{v.accountName || "unknown"}</span>
                              {v.sentiment && (
                                <Badge variant={v.sentiment === "positive" ? "default" : v.sentiment === "negative" ? "destructive" : "secondary"}>
                                  {v.sentiment}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2">{v.title || v.description || "説明文なし"}</p>
                            {v.keyHook && (
                              <p className="text-xs text-primary mt-1">Key: {v.keyHook}</p>
                            )}

                            {/* Metrics */}
                            <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{views.toLocaleString()}</span>
                              <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{Number(v.likeCount || 0).toLocaleString()}</span>
                              <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{Number(v.commentCount || 0).toLocaleString()}</span>
                              <span className="flex items-center gap-1"><Share2 className="h-3 w-3" />{Number(v.shareCount || 0).toLocaleString()}</span>
                              <span className="flex items-center gap-1"><Bookmark className="h-3 w-3" />{Number(v.saveCount || 0).toLocaleString()}</span>
                              <span className="font-medium text-primary">ER {er}%</span>
                              {v.duration && <span>{v.duration}秒</span>}
                            </div>

                            {/* Hashtags */}
                            {v.hashtags && (v.hashtags as string[]).length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {(v.hashtags as string[]).slice(0, 6).map((tag, i) => (
                                  <span key={i} className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">#{tag}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Tab: Before/After */}
              <TabsContent value="comparison" className="space-y-6">
                {comparison ? (
                  <>
                    {/* Change Indicators */}
                    <div className="grid grid-cols-3 gap-4">
                      <ChangeCard
                        label="再生数変化"
                        value={`${comparison.changes.viewsChange > 0 ? "+" : ""}${comparison.changes.viewsChange}%`}
                        positive={comparison.changes.viewsChange > 0}
                      />
                      <ChangeCard
                        label="ER変化"
                        value={`${comparison.changes.erChange > 0 ? "+" : ""}${(comparison.changes.erChange / 100).toFixed(2)}pt`}
                        positive={comparison.changes.erChange > 0}
                      />
                      <ChangeCard
                        label="ポジティブ率変化"
                        value={`${comparison.changes.sentimentChange > 0 ? "+" : ""}${comparison.changes.sentimentChange}pt`}
                        positive={comparison.changes.sentimentChange > 0}
                      />
                    </div>

                    {/* Comparison Table */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Before / After 比較</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-2">指標</th>
                              <th className="text-right py-2">Before</th>
                              <th className="text-right py-2">After</th>
                              <th className="text-right py-2">変化</th>
                            </tr>
                          </thead>
                          <tbody>
                            <ComparisonRow
                              label="動画数"
                              before={`${comparison.before.totalVideos}本`}
                              after={`${comparison.after.totalVideos}本`}
                            />
                            <ComparisonRow
                              label="合計再生数"
                              before={comparison.before.totalViews.toLocaleString()}
                              after={comparison.after.totalViews.toLocaleString()}
                              changePercent={comparison.changes.viewsChange}
                            />
                            <ComparisonRow
                              label="平均ER"
                              before={`${(comparison.before.avgEngagementRate / 100).toFixed(2)}%`}
                              after={`${(comparison.after.avgEngagementRate / 100).toFixed(2)}%`}
                              changePercent={comparison.before.avgEngagementRate > 0 ? Math.round(((comparison.after.avgEngagementRate - comparison.before.avgEngagementRate) / comparison.before.avgEngagementRate) * 100) : 0}
                            />
                            <ComparisonRow
                              label="Positive率"
                              before={`${comparison.before.positivePercentage}%`}
                              after={`${comparison.after.positivePercentage}%`}
                              changePoints={comparison.changes.sentimentChange}
                            />
                            <ComparisonRow
                              label="Negative率"
                              before={`${comparison.before.negativePercentage}%`}
                              after={`${comparison.after.negativePercentage}%`}
                              changePoints={comparison.after.negativePercentage - comparison.before.negativePercentage}
                              invertColor
                            />
                          </tbody>
                        </table>
                      </CardContent>
                    </Card>
                  </>
                ) : (
                  <Card className="text-center py-12">
                    <CardContent>
                      <p className="text-muted-foreground">Before比較が設定されていません</p>
                      <p className="text-sm text-muted-foreground mt-1">施策レポート作成時に過去のSEO分析結果を選択すると、Before/After比較が表示されます</p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Tab: Next提案 */}
              <TabsContent value="next" className="space-y-6">
                {/* Recommendations */}
                {nextRecs.length > 0 && (
                  <div className="space-y-4">
                    {nextRecs.map((rec: any, i: number) => (
                      <Card key={i} className={`border-l-4 ${
                        rec.priority === "high" ? "border-l-red-500" :
                        rec.priority === "medium" ? "border-l-yellow-500" :
                        "border-l-blue-500"
                      }`}>
                        <CardHeader className="pb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={rec.priority === "high" ? "destructive" : rec.priority === "medium" ? "secondary" : "outline"}>
                              {rec.priority === "high" ? "優先度：高" : rec.priority === "medium" ? "優先度：中" : "優先度：低"}
                            </Badge>
                            <CardTitle className="text-base">{rec.title}</CardTitle>
                          </div>
                          <CardDescription>{rec.description}</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <ul className="space-y-1">
                            {(rec.actionItems || []).map((item: string, j: number) => (
                              <li key={j} className="flex items-start gap-2 text-sm">
                                <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {/* Closing Summary */}
                {campaign.closingSummary && (
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">クロージング用サマリー</CardTitle>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(campaign.closingSummary || "");
                            toast.success("コピーしました");
                          }}
                        >
                          <Copy className="h-4 w-4 mr-1" />
                          コピー
                        </Button>
                      </div>
                      <CardDescription>クライアント報告にそのまま使えるサマリーです</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="bg-muted p-4 rounded-lg text-sm leading-relaxed whitespace-pre-wrap">
                        {campaign.closingSummary}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Sub Components ---

function MetricCard({ icon, label, value, sub, subColor }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; subColor?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          {icon}
          <span className="text-xs">{label}</span>
        </div>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className={`text-xs mt-1 ${subColor || "text-muted-foreground"}`}>{sub}</p>}
      </CardContent>
    </Card>
  );
}

function EngagementCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-lg border bg-card">
      {icon}
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}

function ChangeCard({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <Card className={`border-2 ${positive ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
      <CardContent className="pt-4 pb-3 text-center">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <div className="flex items-center justify-center gap-1">
          {positive ? (
            <ArrowUpRight className="h-5 w-5 text-green-600" />
          ) : (
            <ArrowDownRight className="h-5 w-5 text-red-600" />
          )}
          <span className={`text-xl font-bold ${positive ? "text-green-700" : "text-red-700"}`}>{value}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ComparisonRow({ label, before, after, changePercent, changePoints, invertColor }: {
  label: string; before: string; after: string; changePercent?: number; changePoints?: number; invertColor?: boolean;
}) {
  const change = changePercent ?? changePoints;
  const isPositive = invertColor ? (change != null && change < 0) : (change != null && change > 0);
  const changeStr = change != null
    ? `${change > 0 ? "+" : ""}${change}${changePercent != null ? "%" : "pt"}`
    : "";

  return (
    <tr className="border-b last:border-b-0">
      <td className="py-2 text-muted-foreground">{label}</td>
      <td className="py-2 text-right">{before}</td>
      <td className="py-2 text-right font-medium">{after}</td>
      <td className={`py-2 text-right text-sm font-medium ${
        change == null ? "" : isPositive ? "text-green-600" : "text-red-600"
      }`}>
        {changeStr}
      </td>
    </tr>
  );
}
