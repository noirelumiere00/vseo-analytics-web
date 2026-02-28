import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { trpc } from "@/lib/trpc";
import { useLocation, useSearch } from "wouter";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

export default function Trend() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const keyword = params.get("keyword") || "";

  const { data, isLoading } = trpc.analysis.trend.useQuery(
    { keyword },
    { enabled: !!keyword }
  );

  if (!keyword) {
    return (
      <div className="min-h-screen bg-background p-6">
        <Button variant="ghost" onClick={() => setLocation("/history")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          履歴に戻る
        </Button>
        <p className="mt-8 text-center text-muted-foreground">キーワードが指定されていません</p>
      </div>
    );
  }

  const chartData = (data?.points || []).map(p => ({
    date: format(new Date(p.date), "M/d", { locale: ja }),
    fullDate: format(new Date(p.date), "yyyy年M月d日 HH:mm", { locale: ja }),
    動画数: p.totalVideos,
    再生数: p.totalViews,
    "ポジティブ%": p.positivePercentage,
    "ネガティブ%": p.negativePercentage,
    "ニュートラル%": p.neutralPercentage,
  }));

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/history")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-blue-500" />
              トレンド推移: 「{keyword}」
            </h1>
            <p className="text-sm text-muted-foreground">
              {data?.points.length || 0}回の分析結果を時系列で比較
            </p>
          </div>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">読み込み中...</CardContent>
          </Card>
        ) : chartData.length < 2 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              トレンド比較には同じキーワードで2回以上の分析が必要です（現在{chartData.length}回）
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">センチメント推移</CardTitle>
                <CardDescription>各回の分析でのポジティブ/ネガティブ比率の変化</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                    <Tooltip
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.fullDate || ""}
                      formatter={(value: number, name: string) => [`${value}%`, name]}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="ポジティブ%" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="ニュートラル%" stroke="#9ca3af" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="ネガティブ%" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">動画数・再生数推移</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
                    <Tooltip
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.fullDate || ""}
                    />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="動画数" stroke="#2563eb" strokeWidth={2} dot={{ r: 4 }} />
                    <Line yAxisId="right" type="monotone" dataKey="再生数" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* 回ごとの詳細テーブル */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">分析履歴</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2">日時</th>
                        <th className="text-right py-2">動画数</th>
                        <th className="text-right py-2">再生数</th>
                        <th className="text-right py-2">Pos%</th>
                        <th className="text-right py-2">Neg%</th>
                        <th className="text-right py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.points || []).map((p, i) => (
                        <tr key={p.jobId} className="border-b hover:bg-muted/50">
                          <td className="py-2">{format(new Date(p.date), "M/d HH:mm", { locale: ja })}</td>
                          <td className="text-right">{p.totalVideos}</td>
                          <td className="text-right">{p.totalViews.toLocaleString()}</td>
                          <td className="text-right text-green-600">{p.positivePercentage}%</td>
                          <td className="text-right text-red-500">{p.negativePercentage}%</td>
                          <td className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => setLocation(`/analysis/${p.jobId}`)}>
                              詳細
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
