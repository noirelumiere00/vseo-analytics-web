import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Search, Video, TrendingUp } from "lucide-react";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [keyword, setKeyword] = useState("");
  const [manualUrls, setManualUrls] = useState("");

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
    
    const urls = manualUrls
      .split("\n")
      .map(url => url.trim())
      .filter(url => url.length > 0);

    createAnalysis.mutate({
      keyword: keyword.trim() || undefined,
      manualUrls: urls.length > 0 ? urls : undefined,
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
                    3アカウント×上位15投稿を自動収集し、重複度から真の人気動画を特定
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
                キーワードを入力すると自動で上位動画を収集します。特定の動画を分析したい場合はURLを直接入力してください。
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
                    このキーワードで3アカウント×上位15投稿を自動収集します
                  </p>
                </div>

                {/* Manual URLs Input */}
                <div className="space-y-2">
                  <Label htmlFor="urls">動画URL（任意、1行に1つ）</Label>
                  <Textarea
                    id="urls"
                    placeholder="https://www.tiktok.com/@user/video/123456789&#10;https://www.tiktok.com/@user/video/987654321"
                    rows={6}
                    value={manualUrls}
                    onChange={(e) => setManualUrls(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    TikTokのURLを入力してください
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

          {/* Recent Analyses Link */}
          <div className="text-center">
            <Button variant="outline" onClick={() => setLocation("/history")}>
              過去の分析履歴を見る
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
