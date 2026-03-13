import { Search, Video, TrendingUp } from "lucide-react";

const features = [
  { icon: Search, text: "定量的な上位動画分析" },
  { icon: Video, text: "OCR + 音声のコンテンツ完全解析" },
  { icon: TrendingUp, text: "AIによる戦略提案レポート" },
];

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left: Branding Panel */}
      <div className="hidden lg:flex flex-col justify-center px-12 bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/4 left-1/4 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 h-48 w-48 rounded-full bg-primary/5 blur-3xl" />
          <img
            src="/favicon.png"
            alt=""
            aria-hidden="true"
            className="absolute -bottom-16 -right-16 h-[500px] w-[500px] object-contain opacity-[0.04] dark:opacity-[0.06] logo-watermark select-none"
          />
        </div>

        <div className="relative space-y-8 max-w-md">
          <div className="space-y-4">
            <img src="/favicon.png" alt="VSEO Analytics" className="h-20 w-20 object-contain logo-blend" />
            <h1 className="text-4xl font-bold tracking-tight">
              <span className="gradient-text">VSEO Analytics</span>
            </h1>
          </div>
          <p className="text-lg text-muted-foreground leading-relaxed">
            ショート動画時代のPR革命ツール。個人の「感覚」と「バイアス」を排除し、AIが導き出す「正解」。
          </p>

          <div className="space-y-4 pt-4">
            {features.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <span className="text-sm text-foreground">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Content */}
      <div className="flex items-center justify-center px-4">
        {children}
      </div>
    </div>
  );
}
