import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Download, TrendingUp, TrendingDown, Minus, Crown, Star, Brain } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, ReferenceLine } from "recharts";

function fmt(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function ChangeIndicator({ value, suffix = "", inverse = false }: { value: number | null | undefined; suffix?: string; inverse?: boolean }) {
  if (value == null) return <span className="text-muted-foreground">-</span>;
  const isPositive = inverse ? value < 0 : value > 0;
  const isNegative = inverse ? value > 0 : value < 0;
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${isPositive ? "text-green-600" : isNegative ? "text-red-500" : "text-muted-foreground"}`}>
      {isPositive ? <TrendingUp className="h-3.5 w-3.5" /> : isNegative ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
      {value > 0 ? "+" : ""}{value}{suffix}
    </span>
  );
}

const gradeColors: Record<string, string> = {
  S: "bg-yellow-500 text-white",
  A: "bg-green-500 text-white",
  B: "bg-blue-500 text-white",
  C: "bg-gray-500 text-white",
  D: "bg-red-500 text-white",
};

export default function CampaignReport() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const campaignId = parseInt(id || "0");

  const campaignQuery = trpc.campaign.getById.useQuery({ id: campaignId }, { enabled: campaignId > 0 });
  const reportQuery = trpc.campaign.getReport.useQuery({ campaignId }, { enabled: campaignId > 0 });

  const campaign = campaignQuery.data?.campaign;
  const report = reportQuery.data;

  const handleCsvExport = async () => {
    try {
      const csv = await (trpc as any).campaign.exportCsv.query({ campaignId });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `campaign_report_${campaignId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSVをダウンロードしました");
    } catch {
      toast.error("CSVエクスポートに失敗しました");
    }
  };

  if (reportQuery.isLoading) {
    return (
      <DashboardLayout>
        <div className="max-w-6xl mx-auto">
          <div className="space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />)}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!report) {
    return (
      <DashboardLayout>
        <div className="max-w-6xl mx-auto text-center py-12">
          <p className="text-muted-foreground">レポートが見つかりません</p>
          <Button variant="link" onClick={() => setLocation(`/campaigns/${campaignId}`)}>キャンペーンに戻る</Button>
        </div>
      </DashboardLayout>
    );
  }

  const summary = report.summary;
  const positions = report.positionReport || [];
  const compReport = report.competitorReport || {};
  const sovReport = report.sovReport || {};
  const ripple = report.rippleReport || {};
  const freqReport = report.competitorFrequencyReport || [];
  const videoMetrics = (report as any).videoMetricsReport as any[] | undefined;
  const hashtagSov = (report as any).hashtagSovReport as any[] | undefined;
  const crossPlatform = (report as any).crossPlatformData as any | undefined;
  const videoScores = (report as any).videoScores as any[] | undefined;
  const aiReport = (report as any).aiOverallReport as any | undefined;

  // Determine which tabs to show
  const hasVideoMetrics = videoMetrics && videoMetrics.length > 0;
  const hasHashtagSov = hashtagSov && hashtagSov.length > 0;
  const hasCrossPlatform = crossPlatform && crossPlatform.trendsData?.length > 0;
  const hasAiReport = aiReport || (videoScores && videoScores.length > 0);

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setLocation(`/campaigns/${campaignId}`)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{campaign?.name || "施策効果レポート"}</h1>
              <p className="text-sm text-muted-foreground">
                {report.baselineDate ? new Date(report.baselineDate).toLocaleDateString("ja-JP") : "?"} → {report.measurementDate ? new Date(report.measurementDate).toLocaleDateString("ja-JP") : "?"}
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={handleCsvExport} className="gap-2">
            <Download className="h-4 w-4" />
            CSV
          </Button>
        </div>

        {/* AI Overall Report Card */}
        {aiReport && (
          <Card className="border-2 border-primary/20">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Brain className="h-4 w-4" />
                AI総合評価
                <span className={`ml-2 px-3 py-0.5 rounded-full text-sm font-bold ${gradeColors[aiReport.grade] || gradeColors.C}`}>
                  {aiReport.grade}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm">{aiReport.summary}</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {aiReport.strengths?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-green-600 mb-1">強み</p>
                    <ul className="text-xs space-y-1">
                      {aiReport.strengths.map((s: string, i: number) => (
                        <li key={i} className="flex gap-1"><span className="text-green-500">+</span>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiReport.weaknesses?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-red-500 mb-1">弱み</p>
                    <ul className="text-xs space-y-1">
                      {aiReport.weaknesses.map((s: string, i: number) => (
                        <li key={i} className="flex gap-1"><span className="text-red-400">-</span>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiReport.actionProposals?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-blue-600 mb-1">アクション提案</p>
                    <ul className="text-xs space-y-1">
                      {aiReport.actionProposals.map((s: string, i: number) => (
                        <li key={i} className="flex gap-1"><span className="text-blue-500">{i + 1}.</span>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        {summary && <SummaryCards summary={summary} />}

        {/* Tabs */}
        <Tabs defaultValue="position" className="space-y-4">
          <TabsList className="flex w-full overflow-x-auto">
            <TabsTrigger value="position">自社ポジション</TabsTrigger>
            <TabsTrigger value="competitor">競合比較</TabsTrigger>
            <TabsTrigger value="ripple">波及効果</TabsTrigger>
            {hasVideoMetrics && <TabsTrigger value="videos">施策動画</TabsTrigger>}
            {hasHashtagSov && <TabsTrigger value="hashtagSov">ハッシュタグSOV</TabsTrigger>}
            {hasCrossPlatform && <TabsTrigger value="crossPlatform">クロスPF</TabsTrigger>}
          </TabsList>

          {/* Tab 1: Position */}
          <TabsContent value="position" className="space-y-4">
            <PositionTab positions={positions} />
          </TabsContent>

          {/* Tab 2: Competitor */}
          <TabsContent value="competitor" className="space-y-4">
            <CompetitorTab compReport={compReport} sovReport={sovReport} freqReport={freqReport} />
          </TabsContent>

          {/* Tab 3: Ripple */}
          <TabsContent value="ripple" className="space-y-4">
            <RippleTab ripple={ripple} />
          </TabsContent>

          {/* Tab 4: Video Metrics */}
          {hasVideoMetrics && (
            <TabsContent value="videos" className="space-y-4">
              <VideoMetricsTab videos={videoMetrics!} videoScores={videoScores} />
            </TabsContent>
          )}

          {/* Tab 5: Hashtag SOV */}
          {hasHashtagSov && (
            <TabsContent value="hashtagSov" className="space-y-4">
              <HashtagSovTab data={hashtagSov!} />
            </TabsContent>
          )}

          {/* Tab 6: Cross Platform */}
          {hasCrossPlatform && (
            <TabsContent value="crossPlatform" className="space-y-4">
              <CrossPlatformTab data={crossPlatform} />
            </TabsContent>
          )}
        </Tabs>

        {/* Notes */}
        {report.notes && (
          <Card>
            <CardContent className="py-4">
              <ul className="text-xs text-muted-foreground space-y-1">
                {(report.notes as string[]).map((note, i) => (
                  <li key={i}>* {note}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

// ============================
// Summary Cards
// ============================

function SummaryCards({ summary }: { summary: NonNullable<any> }) {
  const cards = [
    {
      title: "検索順位",
      before: summary.rank_before != null ? `${summary.rank_before}位` : "圏外",
      after: summary.rank_after != null ? `${summary.rank_after}位` : "圏外",
      change: summary.rank_change != null ? (
        <ChangeIndicator value={summary.rank_change} suffix="位改善" />
      ) : null,
    },
    {
      title: "再生数",
      before: fmt(summary.views_before),
      after: fmt(summary.views_after),
      change: summary.views_before > 0 ? (
        <ChangeIndicator value={Number(((summary.views_after - summary.views_before) / summary.views_before * 100).toFixed(0))} suffix="%" />
      ) : null,
    },
    {
      title: "ER",
      before: `${summary.er_before}%`,
      after: `${summary.er_after}%`,
      change: <ChangeIndicator value={Number((summary.er_after - summary.er_before).toFixed(2))} suffix="pt" />,
    },
    {
      title: "シェア・オブ・ボイス",
      before: `${summary.sov_before}%`,
      after: `${summary.sov_after}%`,
      change: <ChangeIndicator value={Number((parseFloat(summary.sov_after) - parseFloat(summary.sov_before)).toFixed(1))} suffix="pt" />,
    },
    {
      title: "関連投稿数",
      before: String(summary.related_posts_before),
      after: String(summary.related_posts_after),
      change: summary.related_posts_before > 0 ? (
        <ChangeIndicator value={Number(((summary.related_posts_after - summary.related_posts_before) / summary.related_posts_before * 100).toFixed(0))} suffix="%" />
      ) : <span className="text-green-600">+{summary.related_posts_after - summary.related_posts_before}</span>,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardContent className="py-3 px-4 space-y-1">
            <p className="text-xs text-muted-foreground">{card.title}</p>
            <p className="text-lg font-bold">
              {card.before}<span className="text-muted-foreground mx-1">→</span>{card.after}
            </p>
            {card.change && <div className="text-sm">{card.change}</div>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================
// Position Tab
// ============================

function PositionTab({ positions }: { positions: any[] }) {
  const chartData = positions.map(p => ({
    keyword: p.keyword.length > 10 ? p.keyword.slice(0, 10) + "..." : p.keyword,
    before: p.before_rank ?? 31,
    after: p.after_rank ?? 31,
  }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">KW別ポジション変化</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>キーワード</TableHead>
                <TableHead className="text-right">順位（前）</TableHead>
                <TableHead className="text-right">順位（後）</TableHead>
                <TableHead className="text-right">変動</TableHead>
                <TableHead className="text-right">再生数（前）</TableHead>
                <TableHead className="text-right">再生数（後）</TableHead>
                <TableHead className="text-right">ER（前→後）</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((p, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{p.keyword}</TableCell>
                  <TableCell className="text-right">{p.before_rank ?? "圏外"}</TableCell>
                  <TableCell className="text-right">{p.after_rank ?? "圏外"}</TableCell>
                  <TableCell className="text-right">
                    <ChangeIndicator value={p.rank_change} suffix="位" />
                  </TableCell>
                  <TableCell className="text-right">{fmt(p.before_views)}</TableCell>
                  <TableCell className="text-right">{fmt(p.after_views)}</TableCell>
                  <TableCell className="text-right">
                    {p.before_er}% → {p.after_er}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">順位変動チャート</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 30]} reversed />
                <YAxis type="category" dataKey="keyword" width={120} />
                <Tooltip formatter={(value: number) => value >= 31 ? "圏外" : `${value}位`} />
                <Legend />
                <Bar dataKey="before" name="施策前" fill="#94a3b8" barSize={12} />
                <Bar dataKey="after" name="施策後" fill="#3b82f6" barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================
// Competitor Tab
// ============================

function CompetitorTab({
  compReport,
  sovReport,
  freqReport,
}: {
  compReport: Record<string, any>;
  sovReport: Record<string, any>;
  freqReport: any[];
}) {
  return (
    <div className="space-y-4">
      {Object.entries(compReport).map(([kw, data]) => (
        <Card key={kw}>
          <CardHeader>
            <CardTitle className="text-base">「{kw}」順位比較</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${data.is_top ? "border-yellow-400 bg-yellow-50" : ""}`}>
                {data.is_top && <Crown className="h-4 w-4 text-yellow-500" />}
                <span className="font-semibold">自社</span>
                <Badge variant={data.own_rank ? "default" : "outline"}>
                  {data.own_rank ? `${data.own_rank}位` : "圏外"}
                </Badge>
              </div>
              {data.competitors?.map((comp: any, i: number) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg border">
                  <span>{comp.competitor_name}</span>
                  <Badge variant={comp.best_rank ? "secondary" : "outline"}>
                    {comp.best_rank ? `${comp.best_rank}位` : "圏外"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">({comp.video_count_in_top30}本)</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">シェア・オブ・ボイス（上位30本中の自社占有率）</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>キーワード</TableHead>
                <TableHead className="text-right">施策前</TableHead>
                <TableHead className="text-right">施策後</TableHead>
                <TableHead className="text-right">変動</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(sovReport).map(([kw, data]) => (
                <TableRow key={kw}>
                  <TableCell className="font-medium">{kw}</TableCell>
                  <TableCell className="text-right">
                    {data.before.own_count}/{data.before.total_count} ({data.before.percentage}%)
                  </TableCell>
                  <TableCell className="text-right">
                    {data.after.own_count}/{data.after.total_count} ({data.after.percentage}%)
                  </TableCell>
                  <TableCell className="text-right">
                    <ChangeIndicator
                      value={Number((parseFloat(data.after.percentage) - parseFloat(data.before.percentage)).toFixed(1))}
                      suffix="pt"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {freqReport.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">投稿頻度比較</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {freqReport.map((entry, i) => (
                <div key={i} className={`px-4 py-3 rounded-lg border ${entry.is_own ? "border-primary/30 bg-primary/5" : ""}`}>
                  <p className="text-sm font-medium">{entry.name}</p>
                  <p className="text-lg font-bold mt-1">
                    {entry.frequency ? `週${entry.frequency.posts_per_week}本` : "-"}
                  </p>
                  {entry.frequency && (
                    <p className="text-xs text-muted-foreground">
                      平均{entry.frequency.avg_interval_days}日間隔 (n={entry.frequency.sample_size})
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================
// Ripple Tab
// ============================

function RippleTab({ ripple }: { ripple: Record<string, any> }) {
  return (
    <div className="space-y-4">
      {Object.entries(ripple).map(([tag, data]) => (
        <div key={tag} className="space-y-4">
          <h3 className="text-lg font-semibold">{tag}</h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="py-3 px-4">
                <p className="text-xs text-muted-foreground">関連投稿数</p>
                <p className="text-lg font-bold">{data.before_posts} → {data.after_posts}</p>
                {data.posts_change_pct && (
                  <ChangeIndicator value={Number(data.posts_change_pct)} suffix="%" />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4">
                <p className="text-xs text-muted-foreground">総再生数</p>
                <p className="text-lg font-bold">{fmt(data.before_total_views)} → {fmt(data.after_total_views)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4">
                <p className="text-xs text-muted-foreground">オマージュ動画</p>
                <p className="text-lg font-bold">{data.omaage_count}本</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4">
                <p className="text-xs text-muted-foreground">投稿数変化</p>
                <p className="text-lg font-bold">+{data.posts_change}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">影響フロー</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between flex-wrap gap-2 text-center">
                {[
                  { label: "施策動画投稿", icon: "📤", value: "" },
                  { label: "検索上位獲得", icon: "🔍", value: "" },
                  { label: "再生数獲得", icon: "👀", value: fmt(data.after_total_views) },
                  { label: "オマージュ発生", icon: "🔄", value: `${data.omaage_count}本` },
                  { label: "投稿増加", icon: "📈", value: data.posts_change_pct ? `+${data.posts_change_pct}%` : `+${data.posts_change}` },
                ].map((step, i) => (
                  <div key={i} className="flex items-center gap-2">
                    {i > 0 && <span className="text-muted-foreground">→</span>}
                    <div className="flex flex-col items-center">
                      <span className="text-2xl">{step.icon}</span>
                      <span className="text-xs text-muted-foreground">{step.label}</span>
                      {step.value && <span className="text-sm font-semibold">{step.value}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {data.omaage_videos?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">オマージュ/影響動画リスト</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>クリエイター</TableHead>
                      <TableHead className="text-right">再生数</TableHead>
                      <TableHead className="text-right">いいね</TableHead>
                      <TableHead>説明文</TableHead>
                      <TableHead>投稿日</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.omaage_videos.map((v: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell>
                          <a href={v.video_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                            @{v.creator}
                          </a>
                        </TableCell>
                        <TableCell className="text-right">{fmt(v.views)}</TableCell>
                        <TableCell className="text-right">{fmt(v.likes)}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs">{v.description}</TableCell>
                        <TableCell className="text-xs">
                          {v.posted_at ? new Date(v.posted_at).toLocaleDateString("ja-JP") : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      ))}

      {Object.keys(ripple).length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            キャンペーンハッシュタグが設定されていないため、波及効果データがありません。
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================
// Video Metrics Tab (Phase 1)
// ============================

function VideoMetricsTab({ videos, videoScores }: { videos: any[]; videoScores?: any[] }) {
  const scoreMap = new Map((videoScores || []).map((s: any) => [s.videoId, s]));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">施策動画一覧 Before/After</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {videos.map((v, i) => {
              const score = scoreMap.get(v.videoId);
              return (
                <div key={i} className="border rounded-lg p-4 flex gap-4">
                  {v.coverUrl && (
                    <img src={v.coverUrl} alt="" className="w-20 h-28 rounded object-cover flex-shrink-0" loading="lazy" />
                  )}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{v.description?.slice(0, 60) || v.videoId}</p>
                      {score && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Star className="h-3.5 w-3.5 text-yellow-500" />
                          <span className="text-sm font-bold">{score.overallScore}</span>
                        </div>
                      )}
                    </div>
                    {v.postedAt && (
                      <p className="text-xs text-muted-foreground">投稿日: {new Date(v.postedAt).toLocaleDateString("ja-JP")}</p>
                    )}
                    {score?.aiEvaluation && (
                      <p className="text-xs text-blue-600">{score.aiEvaluation}</p>
                    )}

                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs py-1">指標</TableHead>
                          <TableHead className="text-xs py-1 text-right">施策前</TableHead>
                          <TableHead className="text-xs py-1 text-right">施策後</TableHead>
                          <TableHead className="text-xs py-1 text-right">変動</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[
                          { label: "再生数", key: "viewCount" },
                          { label: "いいね", key: "likeCount" },
                          { label: "コメント", key: "commentCount" },
                          { label: "シェア", key: "shareCount" },
                          { label: "保存", key: "saveCount" },
                        ].map(({ label, key }) => (
                          <TableRow key={key}>
                            <TableCell className="py-1 text-xs">{label}</TableCell>
                            <TableCell className="py-1 text-xs text-right">{fmt(v.before?.[key])}</TableCell>
                            <TableCell className="py-1 text-xs text-right">{fmt(v.after?.[key])}</TableCell>
                            <TableCell className="py-1 text-xs text-right">
                              {v.before?.[key] && v.after?.[key] ? (
                                <ChangeIndicator
                                  value={Number(((v.after[key] - v.before[key]) / (v.before[key] || 1) * 100).toFixed(0))}
                                  suffix="%"
                                />
                              ) : "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================
// Hashtag SOV Tab (Phase 2)
// ============================

function HashtagSovTab({ data }: { data: any[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">ハッシュタグ別SOV（発見欄占有率）</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ハッシュタグ</TableHead>
              <TableHead className="text-right">総投稿数</TableHead>
              <TableHead className="text-right">SOV前</TableHead>
              <TableHead className="text-right">SOV後</TableHead>
              <TableHead className="text-right">最上位(前)</TableHead>
              <TableHead className="text-right">最上位(後)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((h, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">#{h.hashtag}</TableCell>
                <TableCell className="text-right">{fmt(h.totalPostCount)}</TableCell>
                <TableCell className="text-right">{h.before.sovPct}%</TableCell>
                <TableCell className="text-right">
                  {h.after.sovPct}%
                  <span className="ml-1">
                    <ChangeIndicator value={Number((h.after.sovPct - h.before.sovPct).toFixed(1))} suffix="pt" />
                  </span>
                </TableCell>
                <TableCell className="text-right">{h.before.bestRank ?? "圏外"}</TableCell>
                <TableCell className="text-right">
                  {h.after.bestRank ?? "圏外"}
                  {h.before.bestRank && h.after.bestRank && (
                    <span className="ml-1">
                      <ChangeIndicator value={h.before.bestRank - h.after.bestRank} suffix="位" />
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ============================
// Cross Platform Tab (Phase 4)
// ============================

function CrossPlatformTab({ data }: { data: any }) {
  // Merge trends and video timeline by date
  const trendMap = new Map<string, number>((data.trendsData || []).map((t: any) => [t.date, t.value]));
  const videoMap = new Map<string, any>((data.videoTimeline || []).map((v: any) => [v.date, v]));

  const allDates = [...new Set([...trendMap.keys(), ...videoMap.keys()])].sort();
  const chartData = allDates.map((date: string) => ({
    date: date.slice(5), // MM-DD
    fullDate: date,
    trends: trendMap.get(date) ?? null,
    views: videoMap.get(date)?.totalViews ?? null,
  }));

  const markerDates = new Set<string>((data.videoMarkers || []).map((m: any) => m.date as string));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Google Trends × TikTok 重ね合わせチャート
            {data.correlation != null && (
              <span className={`ml-2 text-sm font-normal ${
                Math.abs(data.correlation) >= 0.7 ? "text-green-600" :
                Math.abs(data.correlation) >= 0.4 ? "text-yellow-600" : "text-muted-foreground"
              }`}>
                相関係数: {data.correlation.toFixed(3)}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" label={{ value: "Google Trends", angle: -90, position: "insideLeft", style: { fontSize: 11 } }} />
              <YAxis yAxisId="right" orientation="right" label={{ value: "再生数", angle: 90, position: "insideRight", style: { fontSize: 11 } }} />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="trends" name="Google Trends" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
              <Line yAxisId="right" type="monotone" dataKey="views" name="再生数" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls />
              {Array.from(markerDates).map((date: string) => (
                <ReferenceLine key={date} x={date.slice(5)} yAxisId="left" stroke="#10b981" strokeDasharray="3 3" label={{ value: "投稿", fill: "#10b981", fontSize: 10 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Video Markers */}
      {data.videoMarkers?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">施策動画投稿タイムライン</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.videoMarkers.map((m: any, i: number) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <Badge variant="outline">{m.date}</Badge>
                  <a href={m.videoUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">
                    {m.description || m.videoId}
                  </a>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
