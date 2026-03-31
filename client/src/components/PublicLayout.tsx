import { Search, Video, TrendingUp } from "lucide-react";

const features = [
  { icon: Search, text: "定量的な上位動画分析" },
  { icon: Video, text: "OCR + 音声のコンテンツ完全解析" },
  { icon: TrendingUp, text: "AIによる戦略提案レポート" },
];

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left: Editorial Branding Panel */}
      <div className="hidden lg:flex flex-col justify-center px-12 relative overflow-hidden"
        style={{
          background: `
            radial-gradient(circle at 1px 1px, oklch(0.50 0.18 25 / 0.06) 1px, transparent 0),
            linear-gradient(160deg, oklch(0.975 0.005 80) 0%, oklch(0.96 0.015 25 / 30%) 40%, oklch(0.975 0.005 80) 100%)
          `,
          backgroundSize: '20px 20px, 100% 100%',
        }}
      >
        {/* Hanko-style watermark */}
        <div className="absolute bottom-12 right-12 pointer-events-none select-none opacity-[0.06]">
          <div className="w-20 h-20 border-2 border-current rounded-sm flex items-center justify-center"
            style={{ fontFamily: '"Shippori Mincho", serif', fontSize: '2rem', fontWeight: 800 }}>
            V
          </div>
        </div>

        <div className="relative space-y-8 max-w-md">
          <div className="space-y-4">
            <img src="/favicon.png" alt="VSEO Analytics" className="h-16 w-16 object-contain logo-blend" />
            <h1 className="text-4xl tracking-tight" style={{ fontFamily: '"Shippori Mincho", serif', fontWeight: 800 }}>
              <span className="text-primary">V</span>SEO Analytics
            </h1>
            {/* Vermillion horizontal rule — editorial accent */}
            <div className="w-16 h-0.5 bg-primary" />
          </div>
          <p className="text-lg text-muted-foreground leading-relaxed">
            ショート動画時代のPR革命ツール。個人の「感覚」と「バイアス」を排除し、AIが導き出す「正解」。
          </p>

          <div className="space-y-4 pt-4">
            {features.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="h-1 w-1 rounded-full bg-primary shrink-0" />
                <Icon className="h-4 w-4 text-primary shrink-0" />
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
