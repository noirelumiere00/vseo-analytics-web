import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Download, TrendingUp, TrendingDown, Minus, Crown } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";

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

        {/* Summary Cards */}
        {summary && <SummaryCards summary={summary} />}

        {/* Tabs */}
        <Tabs defaultValue="position" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="position">自社ポジション</TabsTrigger>
            <TabsTrigger value="competitor">競合比較</TabsTrigger>
            <TabsTrigger value="ripple">波及効果</TabsTrigger>
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
      {/* Table */}
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

      {/* Chart */}
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
      {/* Rank Matrix */}
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

      {/* SOV */}
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

      {/* Posting Frequency */}
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

          {/* Metrics */}
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

          {/* Impact Flow */}
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

          {/* Omaage Videos */}
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
                          <a
                            href={v.video_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
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
