import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, FileText, Loader2, Search, Video, TrendingUp } from "lucide-react";
import { getLoginUrl } from "@/const";
import { SCRAPER_SESSION_COUNT, SCRAPER_VIDEOS_PER_SESSION } from "@shared/const";
import { useEffect } from "react";
import { useLocation } from "wouter";

export default function Home() {
  const { loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && isAuthenticated) {
      setLocation("/dashboard", { replace: true });
    }
  }, [loading, isAuthenticated, setLocation]);

  if (loading || isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

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
