import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Search, Video, TrendingUp } from "lucide-react";
import { getLoginUrl } from "@/const";
import { SCRAPER_SESSION_COUNT, SCRAPER_VIDEOS_PER_SESSION } from "@shared/const";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useEffect } from "react";
import { useLocation } from "wouter";

export default function Home() {
  usePageTitle("");
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
      {/* Hero: Asymmetric editorial spread */}
      <div className="flex-1 flex flex-col lg:flex-row items-center justify-center px-4 py-16 gap-12 lg:gap-16 max-w-6xl mx-auto w-full">
        {/* Left 60%: Editorial statement */}
        <div className="lg:w-[60%] space-y-6 text-center lg:text-left">
          <h1 className="text-5xl md:text-7xl tracking-tight" style={{ fontFamily: '"Shippori Mincho", serif', fontWeight: 800 }}>
            <span className="text-primary">V</span>SEO Analytics
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground leading-relaxed" style={{ fontFamily: '"Shippori Mincho", serif', fontWeight: 500 }}>
            ショート動画時代のPR革命ツール
          </p>
          {/* Vermillion horizontal rule */}
          <div className="w-16 h-0.5 bg-primary mx-auto lg:mx-0" />
          <p className="text-base text-muted-foreground max-w-lg mx-auto lg:mx-0">
            個人の「感覚」と「バイアス」を排除し、AIが導き出す「正解」
          </p>
          <div className="pt-4">
            <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90" asChild>
              <a href={getLoginUrl()}>今すぐ始める</a>
            </Button>
          </div>
        </div>

        {/* Right 40%: Feature cards */}
        <div className="lg:w-[40%] space-y-4 w-full max-w-sm">
          <Card className="card-interactive">
            <CardHeader className="pb-2">
              <Search className="h-8 w-8 text-primary mb-1" />
              <CardTitle className="text-base">定量的分析</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                {SCRAPER_SESSION_COUNT}アカウント×上位{SCRAPER_VIDEOS_PER_SESSION}投稿を自動収集し、重複度から真の人気動画を特定
              </CardDescription>
            </CardContent>
          </Card>
          <Card className="card-interactive">
            <CardHeader className="pb-2">
              <Video className="h-8 w-8 text-primary mb-1" />
              <CardTitle className="text-base">完全解析</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                OCR（2秒/1フレーム）+ Whisper音声文字起こしで構成要素を完全分解
              </CardDescription>
            </CardContent>
          </Card>
          <Card className="card-interactive">
            <CardHeader className="pb-2">
              <TrendingUp className="h-8 w-8 text-primary mb-1" />
              <CardTitle className="text-base">工数1/30</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                15時間かかっていた分析を30分に短縮。圧倒的な業務効率化を実現
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
