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
      {/* Left: Liquid Glass Frost Panel */}
      <div
        className="hidden lg:flex flex-col justify-between p-12 relative overflow-hidden"
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 70% 90%, rgba(10, 10, 10, 0.06), transparent),
            radial-gradient(ellipse 60% 40% at 10% 20%, rgba(10, 10, 10, 0.03), transparent),
            radial-gradient(circle at 1px 1px, rgba(0, 0, 0, 0.03) 1px, transparent 0),
            linear-gradient(170deg, #f5f5f5 0%, #e5e5e5 100%)
          `,
          backgroundSize: "100% 100%, 100% 100%, 16px 16px, 100% 100%",
        }}
      >
        {/* Top accent line */}
        <div
          className="absolute top-0 left-0 w-full h-[2px]"
          style={{
            background: "linear-gradient(90deg, transparent 0%, #171717 30%, #171717 70%, transparent 100%)",
          }}
        />

        {/* Diagonal grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.02] pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(45deg, #0a0a0a 1px, transparent 1px),
              linear-gradient(-45deg, #0a0a0a 1px, transparent 1px)
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
                <div className="absolute -inset-1 rounded-full bg-black/5 blur-sm -z-10" />
              </div>
              <div>
                <h1
                  className="text-3xl tracking-tight text-foreground normal-case"
                  style={{ fontFamily: '"Space Mono", "JetBrains Mono", monospace', fontWeight: 700, letterSpacing: '-0.02em' }}
                >
                  VSEO Analytics
                </h1>
                <p className="text-[11px] tracking-[0.3em] uppercase text-muted-foreground mt-0.5">
                  Video Search Engine Optimization
                </p>
              </div>
            </div>

            {/* Rule */}
            <div
              className="w-20 h-[2px] rounded-full"
              style={{ background: "linear-gradient(90deg, #171717, rgba(23, 23, 23, 0.2))" }}
            />
          </div>

          <p
            className="text-xl text-foreground/80 leading-relaxed"
            style={{ fontFamily: '"Noto Sans JP", sans-serif', fontWeight: 500 }}
          >
            ショート動画時代の
            <br />
            <span className="text-foreground font-bold">
              PR革命ツール
            </span>
          </p>

          <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
            個人の「感覚」と「バイアス」を排除し、AIが導き出す「正解」を。
          </p>
        </div>

        {/* Features */}
        <div className="relative z-10 space-y-3">
          {features.map(({ icon: Icon, text, delay }) => (
            <div
              key={text}
              className="group flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-300 hover:bg-black/[0.03]"
              style={{ animationDelay: delay }}
            >
              <div
                className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 transition-colors duration-300 group-hover:bg-black/[0.06] bg-black/[0.04]"
              >
                <Icon className="h-4 w-4 text-foreground/70" />
              </div>
              <span className="text-sm text-foreground/70 group-hover:text-foreground transition-colors duration-300">
                {text}
              </span>
            </div>
          ))}
        </div>

        {/* Watermark */}
        <div className="absolute -bottom-8 -right-8 pointer-events-none select-none opacity-[0.03]">
          <div
            className="w-40 h-40 border-[3px] border-foreground rounded flex items-center justify-center"
            style={{ fontFamily: '"Space Mono", monospace', fontSize: "5rem", fontWeight: 700, color: "var(--foreground)" }}
          >
            V
          </div>
        </div>

        {/* Sparkle accent */}
        <Sparkles
          className="absolute top-8 right-8 h-5 w-5 opacity-[0.06] text-foreground"
          strokeWidth={1}
        />
      </div>

      {/* Right: Form area */}
      <div className="flex items-center justify-center px-6 py-12 lg:py-0 bg-background relative">
        <div className="relative z-10 w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
