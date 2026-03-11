import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye, FileText, Loader2, Search, Video, TrendingUp } from "lucide-react";
import { getLoginUrl } from "@/const";
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

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [keyword, setKeyword] = useState("");

  const dashboardQuery = trpc.analysis.dashboard.useQuery(undefined, {
    enabled: isAuthenticated,
  });

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-16">
          <div className="max-w-4xl mx-auto text-center space-y-8">
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight">
              <span className="gradient-text">VSEO Analytics</span>
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto">
              ショート動画時代のPR革命ツール
              <br />
              個人の「感覚」と「バイアス」を排除し、AIが導き出す「正解」
            </p>

            <div className="grid md:grid-cols-3 gap-6 mt-12">
              <Card className="border-2 card-interactive">
                <CardHeader>
                  <Search className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>定量的分析</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>
                    {SCRAPER_SESSION_COUNT}アカウント×上位{SCRAPER_VIDEOS_PER_SESSION}投稿を自動収集し、重複度から真の人気動画を特定
                  </CardDescription>
                </CardContent>
              </Card>
              <Card className="border-2 card-interactive">
                <CardHeader>
                  <Video className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>完全解析</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>
                    OCR（2秒/1フレーム）+ Whisper音声文字起こしで構成要素を完全分解
                  </CardDescription>
                </CardContent>
              </Card>
              <Card className="border-2 card-interactive">
                <CardHeader>
                  <TrendingUp className="h-10 w-10 text-primary mb-2" />
                  <CardTitle>工数1/30</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>
                    15時間かかっていた分析を30分に短縮。圧倒的な業務効率化を実現
                  </CardDescription>
                </CardContent>
              </Card>
            </div>

            <div className="pt-8">
              <Button size="lg" className="gradient-primary text-white" asChild>
                <a href={getLoginUrl()}>今すぐ始める</a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const topKeywords = dashboardQuery.data?.topKeywords;

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">新しい分析を開始</h1>
          <p className="text-muted-foreground">
            キーワードを入力して、VSEO分析を実行します
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
