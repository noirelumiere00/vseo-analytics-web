import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, Search, Video, TrendingUp, BarChart3, Sparkles, Play } from "lucide-react";
import { getLoginUrl } from "@/const";
import { SCRAPER_SESSION_COUNT, SCRAPER_VIDEOS_PER_SESSION } from "@shared/const";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";

const features = [
  {
    icon: Search,
    title: "定量的分析",
    desc: `${SCRAPER_SESSION_COUNT}アカウント×上位${SCRAPER_VIDEOS_PER_SESSION}投稿を自動収集し、重複度から真の人気動画を特定`,
    accent: "oklch(0.55 0.18 25)",
  },
  {
    icon: Video,
    title: "完全解析",
    desc: "OCR（2秒/1フレーム）+ Whisper音声文字起こしで構成要素を完全分解",
    accent: "oklch(0.50 0.14 45)",
  },
  {
    icon: TrendingUp,
    title: "工数 1/30",
    desc: "15時間かかっていた分析を30分に短縮。圧倒的な業務効率化を実現",
    accent: "oklch(0.45 0.12 160)",
  },
  {
    icon: BarChart3,
    title: "施策効果測定",
    desc: "SOV・検索順位・波及効果をBefore/Afterで可視化し、PR施策の成果を定量証明",
    accent: "oklch(0.50 0.10 250)",
  },
];

export default function Home() {
  usePageTitle("");
  const { loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!loading && isAuthenticated) {
      setLocation("/dashboard", { replace: true });
    }
  }, [loading, isAuthenticated, setLocation]);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(t);
  }, []);

  if (loading || isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col overflow-hidden">
      {/* Nav */}
      <nav className="relative z-20 flex items-center justify-between px-6 lg:px-12 py-4">
        <div className="flex items-center gap-3">
          <img src="/favicon.png" alt="" className="h-8 w-8 object-contain logo-blend" />
          <span
            className="text-lg tracking-tight"
            style={{ fontFamily: '"Shippori Mincho", serif', fontWeight: 800 }}
          >
            <span className="text-primary">V</span>SEO
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
              ログイン
            </Button>
          </Link>
          <Link href="/register">
            <Button size="sm" className="bg-primary text-primary-foreground">
              無料で始める
            </Button>
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 relative">
        {/* Background layers */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `
              radial-gradient(ellipse 50% 40% at 50% 30%, oklch(0.45 0.18 25 / 0.04), transparent),
              radial-gradient(ellipse 70% 50% at 80% 80%, oklch(0.45 0.12 25 / 0.02), transparent),
              radial-gradient(circle at 1px 1px, oklch(0.45 0.18 25 / 0.02) 1px, transparent 0)
            `,
            backgroundSize: "100% 100%, 100% 100%, 20px 20px",
          }}
        />

        {/* Hero content */}
        <div
          className="relative z-10 max-w-3xl mx-auto text-center space-y-8 transition-all duration-[800ms]"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(24px)",
            transitionTimingFunction: "var(--md-ease-emphasized-decel)",
          }}
        >
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/[0.06] border border-primary/10">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-medium text-primary">AI-Powered Video SEO</span>
          </div>

          <h1
            className="text-5xl md:text-7xl lg:text-8xl tracking-tight leading-[0.95]"
            style={{ fontFamily: '"Shippori Mincho", serif', fontWeight: 800 }}
          >
            <span className="text-primary">V</span>SEO
            <br />
            <span className="text-3xl md:text-4xl lg:text-5xl text-muted-foreground" style={{ fontWeight: 500 }}>
              Analytics
            </span>
          </h1>

          {/* Vermillion rule */}
          <div className="flex justify-center">
            <div
              className="w-24 h-[2px] rounded-full"
              style={{ background: "linear-gradient(90deg, transparent, oklch(0.55 0.20 25), transparent)" }}
            />
          </div>

          <p
            className="text-xl md:text-2xl text-muted-foreground leading-relaxed max-w-lg mx-auto"
            style={{ fontFamily: '"Shippori Mincho", serif', fontWeight: 500 }}
          >
            ショート動画時代の<span className="text-foreground">PR革命</span>ツール
          </p>

          <p className="text-base text-muted-foreground max-w-md mx-auto">
            個人の「感覚」と「バイアス」を排除し、AIが導き出す「正解」を。
          </p>

          <div className="flex items-center justify-center gap-4 pt-2">
            <Button
              size="lg"
              className="bg-primary text-primary-foreground h-12 px-8 font-medium group hover:shadow-lg transition-all duration-300"
              asChild
            >
              <a href={getLoginUrl()}>
                今すぐ始める
                <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
              </a>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 px-6 border-border/60 hover:bg-secondary/60 group transition-all duration-200"
              asChild
            >
              <a href="#features">
                <Play className="mr-2 h-4 w-4 text-primary" />
                詳しく見る
              </a>
            </Button>
          </div>
        </div>
      </div>

      {/* Features */}
      <div id="features" className="relative z-10 px-6 lg:px-12 pb-24 pt-12">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {features.map(({ icon: Icon, title, desc, accent }, i) => (
            <div
              key={title}
              className="group relative p-5 rounded-lg border border-border/40 bg-card/60 backdrop-blur-sm hover:border-border transition-all duration-300 hover:shadow-sm"
              style={{
                opacity: visible ? 1 : 0,
                transform: visible ? "translateY(0)" : "translateY(16px)",
                transition: `all 600ms var(--md-ease-emphasized-decel) ${200 + i * 100}ms`,
              }}
            >
              <div
                className="h-9 w-9 rounded-md flex items-center justify-center mb-3 transition-transform duration-300 group-hover:scale-105"
                style={{ background: `${accent}10` }}
              >
                <Icon className="h-4.5 w-4.5" style={{ color: accent }} />
              </div>
              <h3 className="text-sm font-semibold mb-1.5">{title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
