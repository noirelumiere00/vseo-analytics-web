import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye, FileText, Loader2, Search, Video } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { SCRAPER_SESSION_COUNT, SCRAPER_VIDEOS_PER_SESSION } from "@shared/const";
import { toast } from "sonner";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";

const STEPS = [
  { icon: Search, label: "キーワード入力", desc: "分析対象を設定" },
  { icon: Eye, label: "動画自動収集", desc: `上位動画を取得` },
  { icon: Video, label: "コンテンツ解析", desc: "OCR + 音声 + AI分析" },
  { icon: FileText, label: "レポート生成", desc: "戦略提案・比較" },
];

export default function AnalysisNew() {
  const [, setLocation] = useLocation();
  const [keyword, setKeyword] = useState("");

  const dashboardQuery = trpc.analysis.dashboard.useQuery();

  const createAnalysis = trpc.analysis.create.useMutation({
    onSuccess: (data) => {
      toast.success("分析ジョブを作成しました");
      setLocation(`/analysis/${data.jobId}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createAnalysis.mutate({
      keyword: keyword.trim() || undefined,
    });
  };

  const topKeywords = dashboardQuery.data?.topKeywords;

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">TikTok SEO分析</h1>
          <p className="text-muted-foreground">
            キーワードを入力して、TikTok SEO分析を実行します
          </p>
        </div>

        {/* Analysis Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">分析設定</CardTitle>
            <CardDescription>
              キーワードを入力すると{SCRAPER_SESSION_COUNT}アカウント×上位{SCRAPER_VIDEOS_PER_SESSION}投稿を自動収集します
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="keyword">キーワード</Label>
                <Input
                  id="keyword"
                  placeholder="例: メイク、料理、旅行"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </div>

              {/* Recent keywords as quick select */}
              {topKeywords && topKeywords.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">最近の分析キーワード</p>
                  <div className="flex flex-wrap gap-1.5">
                    {topKeywords.slice(0, 6).map(kw => (
                      <Badge
                        key={kw.keyword}
                        variant="secondary"
                        className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors text-xs px-2.5 py-1"
                        onClick={() => setKeyword(kw.keyword)}
                      >
                        {kw.keyword}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <Button
                type="submit"
                className="w-full gradient-primary text-white"
                disabled={createAnalysis.isPending}
              >
                {createAnalysis.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    分析を開始しています...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    分析を開始
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* How it works */}
        <Card className="bg-muted/30 border-dashed">
          <CardHeader>
            <CardTitle className="text-base">分析の流れ</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {STEPS.map(({ icon: Icon, label, desc }, i) => (
                <div key={i} className="text-center space-y-2">
                  <div className="mx-auto h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
