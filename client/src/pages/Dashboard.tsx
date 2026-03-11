import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { DashboardSkeleton } from "@/components/PageSkeleton";
import DashboardLayout from "@/components/DashboardLayout";
import { BarChart3, TrendingUp, Search, ArrowRight, CheckCircle2, AlertTriangle, Layers } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = trpc.analysis.dashboard.useQuery();

  if (isLoading) {
    return (
      <DashboardLayout>
        <DashboardSkeleton />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              ダッシュボード
            </h1>
            <p className="text-sm text-muted-foreground mt-1">全分析の俯瞰</p>
          </div>
          <Button size="sm" className="gradient-primary text-white" onClick={() => setLocation("/")}>
            <Search className="h-4 w-4 mr-1.5" />
            新規分析
          </Button>
        </div>

        {/* KPIカード */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="relative overflow-hidden">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">完了済み分析</p>
                  <div className="text-3xl font-bold mt-1">{data?.completedJobs || 0}</div>
                </div>
                <div className="h-12 w-12 rounded-xl bg-green-50 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6 text-green-500" />
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-green-400 to-green-500" />
            </CardContent>
          </Card>
          <Card className="relative overflow-hidden">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">総ジョブ数</p>
                  <div className="text-3xl font-bold mt-1">{data?.totalJobs || 0}</div>
                </div>
                <div className="h-12 w-12 rounded-xl bg-blue-50 flex items-center justify-center">
                  <Layers className="h-6 w-6 text-blue-500" />
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-400 to-blue-500" />
            </CardContent>
          </Card>
          <Card className="relative overflow-hidden">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">失敗</p>
                  <div className="text-3xl font-bold mt-1">{data?.failedJobs || 0}</div>
                </div>
                <div className="h-12 w-12 rounded-xl bg-red-50 flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6 text-red-500" />
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-red-400 to-red-500" />
            </CardContent>
          </Card>
        </div>

        {/* よく使うキーワード */}
        {data?.topKeywords && data.topKeywords.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Search className="h-4 w-4" />
                よく分析するキーワード
              </CardTitle>
              <CardDescription>クリックでトレンド推移を確認</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {data.topKeywords.map(kw => (
                  <Badge
                    key={kw.keyword}
                    variant="secondary"
                    className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors text-sm px-3 py-1.5"
                    onClick={() => setLocation(`/trend?keyword=${encodeURIComponent(kw.keyword)}`)}
                  >
                    {kw.keyword}
                    <span className="ml-1.5 opacity-60">({kw.count}回)</span>
                    {kw.count >= 2 && <TrendingUp className="ml-1 h-3 w-3" />}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 最近の分析結果 */}
        {data?.recentSummaries && data.recentSummaries.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                最近の分析
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.recentSummaries.map((s, i) => (
                  <div
                    key={s.jobId}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 cursor-pointer card-interactive animate-list-item"
                    style={{ animationDelay: `${i * 50}ms` }}
                    onClick={() => setLocation(`/analysis/${s.jobId}`)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{s.keyword}</div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(s.date), "M月d日 HH:mm", { locale: ja })} / {s.totalVideos}本 / {s.totalViews.toLocaleString()}再生
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {/* Sentiment mini bar */}
                      <div className="flex h-2 w-16 rounded-full overflow-hidden bg-muted">
                        <div className="bg-green-500" style={{ width: `${s.positivePercentage}%` }} />
                        <div className="bg-red-400" style={{ width: `${s.negativePercentage}%` }} />
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {(!data?.recentSummaries || data.recentSummaries.length === 0) && (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon"><BarChart3 className="h-6 w-6" /></EmptyMedia>
              <EmptyTitle>まだ分析結果がありません</EmptyTitle>
              <EmptyDescription>
                キーワードを入力して最初のVSEO分析を始めましょう。上位動画の自動収集からAIレポート生成まで、約30分で完了します。
              </EmptyDescription>
            </EmptyHeader>
            <Button onClick={() => setLocation("/")} className="gradient-primary text-white">
              <Search className="mr-2 h-4 w-4" />最初の分析を始める
            </Button>
          </Empty>
        )}
      </div>
    </DashboardLayout>
  );
}
