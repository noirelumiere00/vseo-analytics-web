import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, History, Loader2, LogOut, Search, Video, TrendingUp } from "lucide-react";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { SCRAPER_SESSION_COUNT, SCRAPER_VIDEOS_PER_SESSION } from "@shared/const";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function Home() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [keyword, setKeyword] = useState("");

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
        {/* Hero Section */}
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
              <Card className="border-2">
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

              <Card className="border-2">
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

              <Card className="border-2">
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

  return (
    <div className="min-h-screen bg-background">
      {/* ナビゲーションバー */}
      <div className="border-b bg-background/95 backdrop-blur sticky top-0 z-40">
        <div className="container flex items-center justify-between h-14">
          <span className="font-semibold gradient-text">VSEO Analytics</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/history")}>
              <History className="h-4 w-4 mr-1.5" />
              分析履歴
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setLocation("/dashboard")}>
              <BarChart3 className="h-4 w-4 mr-1.5" />
              ダッシュボード
            </Button>
            <Button variant="ghost" size="sm" onClick={logout} className="text-destructive hover:text-destructive">
              <LogOut className="h-4 w-4 mr-1.5" />
              ログアウト
            </Button>
          </div>
        </div>
      </div>

      <div className="container py-12">
        <div className="max-w-3xl mx-auto space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-bold">
              <span className="gradient-text">新しい分析を開始</span>
            </h1>
            <p className="text-muted-foreground text-lg">
              キーワードまたは動画URLを入力して、VSEO分析を実行します
            </p>
          </div>

          {/* Analysis Form */}
          <Card>
            <CardHeader>
              <CardTitle>分析設定</CardTitle>
              <CardDescription>
                キーワードを入力すると自動で上位動画を収集します
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Keyword Input */}
                <div className="space-y-2">
                  <Label htmlFor="keyword">キーワード（任意）</Label>
                  <Input
                    id="keyword"
                    placeholder="例: メイク、料理、旅行"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    このキーワードで{SCRAPER_SESSION_COUNT}アカウント×上位{SCRAPER_VIDEOS_PER_SESSION}投稿を自動収集します
                  </p>
                </div>

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
                    "分析を開始"
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
