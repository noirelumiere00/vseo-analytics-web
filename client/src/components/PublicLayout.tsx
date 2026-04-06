import { Search, Video, TrendingUp, BarChart3, Sparkles } from "lucide-react";

const features = [
  { icon: Search, text: "定量的な上位動画分析", delay: "0.1s" },
  { icon: Video, text: "OCR + 音声のコンテンツ完全解析", delay: "0.2s" },
  { icon: TrendingUp, text: "AIによる戦略提案レポート", delay: "0.3s" },
  { icon: BarChart3, text: "競合SOV・波及効果の可視化", delay: "0.4s" },
];

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_0.9fr]">
      {/* Left: Immersive Brand Panel */}
      <div
        className="hidden lg:flex flex-col justify-between p-12 relative overflow-hidden"
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 70% 90%, oklch(0.35 0.16 25 / 0.18), transparent),
            radial-gradient(ellipse 60% 40% at 10% 20%, oklch(0.45 0.18 25 / 0.08), transparent),
            radial-gradient(circle at 1px 1px, oklch(0.45 0.18 25 / 0.04) 1px, transparent 0),
            linear-gradient(170deg, oklch(0.16 0.015 55) 0%, oklch(0.12 0.01 50) 100%)
          `,
          backgroundSize: "100% 100%, 100% 100%, 16px 16px, 100% 100%",
        }}
      >
        {/* Floating vermillion accent line */}
        <div
          className="absolute top-0 left-0 w-full h-[2px]"
          style={{
            background: "linear-gradient(90deg, transparent 0%, oklch(0.55 0.20 25) 30%, oklch(0.55 0.20 25) 70%, transparent 100%)",
          }}
        />

        {/* Diagonal grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(45deg, white 1px, transparent 1px),
              linear-gradient(-45deg, white 1px, transparent 1px)
            `,
            backgroundSize: "40px 40px",
          }}
        />

        {/* Main content */}
        <div className="relative z-10 space-y-8 max-w-md">
          <div className="space-y-5">
            {/* Logo */}
            <div className="flex items-center gap-4">
              <div className="relative">
                <img
                  src="/favicon.png"
                  alt="VSEO Analytics"
                  className="h-14 w-14 object-contain"
                  style={{ filter: "brightness(1.1) saturate(1.2)" }}
                  loading="lazy"
                />
                <div className="absolute -inset-1 rounded-full bg-white/5 blur-sm -z-10" />
              </div>
              <div>
                <h1
                  className="text-3xl tracking-tight text-white"
                  style={{ fontFamily: '"Shippori Mincho", serif', fontWeight: 800 }}
                >
                  <span style={{ color: "oklch(0.70 0.20 25)" }}>V</span>SEO Analytics
                </h1>
                <p className="text-[11px] tracking-[0.3em] uppercase text-white/40 mt-0.5">
                  Video Search Engine Optimization
                </p>
              </div>
            </div>

            {/* Vermillion rule */}
            <div
              className="w-20 h-[2px] rounded-full"
              style={{ background: "linear-gradient(90deg, oklch(0.55 0.20 25), oklch(0.55 0.20 25 / 0.2))" }}
            />
          </div>

          <p
            className="text-xl text-white/80 leading-relaxed"
            style={{ fontFamily: '"Shippori Mincho", serif', fontWeight: 500 }}
          >
            ショート動画時代の
            <br />
            <span className="text-white" style={{ color: "oklch(0.75 0.16 25)" }}>
              PR革命ツール
            </span>
          </p>

          <p className="text-sm text-white/50 leading-relaxed max-w-sm">
            個人の「感覚」と「バイアス」を排除し、AIが導き出す「正解」を。
          </p>
        </div>

        {/* Features */}
        <div className="relative z-10 space-y-3">
          {features.map(({ icon: Icon, text, delay }) => (
            <div
              key={text}
              className="group flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-300 hover:bg-white/[0.04]"
              style={{ animationDelay: delay }}
            >
              <div
                className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 transition-colors duration-300 group-hover:bg-white/[0.08]"
                style={{ background: "oklch(0.55 0.18 25 / 0.12)" }}
              >
                <Icon className="h-4 w-4" style={{ color: "oklch(0.70 0.18 25)" }} />
              </div>
              <span className="text-sm text-white/70 group-hover:text-white/90 transition-colors duration-300">
                {text}
              </span>
            </div>
          ))}
        </div>

        {/* Hanko watermark — large, cinematic */}
        <div className="absolute -bottom-8 -right-8 pointer-events-none select-none opacity-[0.04]">
          <div
            className="w-40 h-40 border-[3px] border-white rounded flex items-center justify-center"
            style={{ fontFamily: '"Shippori Mincho", serif', fontSize: "5rem", fontWeight: 800, color: "white" }}
          >
            V
          </div>
        </div>

        {/* Sparkle accent */}
        <Sparkles
          className="absolute top-8 right-8 h-5 w-5 opacity-[0.08] text-white"
          strokeWidth={1}
        />
      </div>

      {/* Right: Form area */}
      <div className="flex items-center justify-center px-6 py-12 lg:py-0 bg-background relative">
        {/* Subtle gradient overlay for right panel */}
        <div
          className="absolute inset-0 pointer-events-none opacity-40"
          style={{
            background: "radial-gradient(ellipse 60% 50% at 50% 0%, oklch(0.45 0.18 25 / 0.03), transparent)",
          }}
        />
        <div className="relative z-10 w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
