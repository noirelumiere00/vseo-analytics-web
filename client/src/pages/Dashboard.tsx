import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, TrendingUp, Search, ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = trpc.analysis.dashboard.useQuery();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-4 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-blue-500" />
              ダッシュボード
            </h1>
            <p className="text-sm text-muted-foreground mt-1">全分析の俯瞰</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setLocation("/history")}>
              履歴
            </Button>
            <Button size="sm" className="gradient-primary text-white" onClick={() => setLocation("/")}>
              新規分析
            </Button>
          </div>
        </div>

        {/* サマリーカード */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-3xl font-bold">{data?.completedJobs || 0}</div>
              <p className="text-sm text-muted-foreground mt-1">完了済み分析</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-3xl font-bold">{data?.totalJobs || 0}</div>
              <p className="text-sm text-muted-foreground mt-1">総ジョブ数</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-3xl font-bold text-red-500">{data?.failedJobs || 0}</div>
              <p className="text-sm text-muted-foreground mt-1">失敗</p>
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
              <CardTitle className="text-base">最近の分析</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.recentSummaries.map(s => (
                  <div
                    key={s.jobId}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 cursor-pointer"
                    onClick={() => setLocation(`/analysis/${s.jobId}`)}
                  >
                    <div>
                      <div className="font-medium text-sm">{s.keyword}</div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(s.date), "M月d日 HH:mm", { locale: ja })} / {s.totalVideos}本 / {s.totalViews.toLocaleString()}再生
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex gap-1.5">
                        <span className="text-xs text-green-600 font-medium">{s.positivePercentage}% pos</span>
                        <span className="text-xs text-red-500 font-medium">{s.negativePercentage}% neg</span>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {(!data?.recentSummaries || data.recentSummaries.length === 0) && (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground mb-4">まだ分析結果がありません</p>
              <Button onClick={() => setLocation("/")}>
                最初の分析を始める
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
