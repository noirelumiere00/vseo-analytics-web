import { Anchor, FileText, Clapperboard, Hash, Lightbulb, AlertTriangle } from "lucide-react";

export function WinPatternContent({ analysis }: { analysis: { summary: string; keyHook: string; contentTrend: string; formatFeatures: string; hashtagStrategy: string; vseoTips: string; avoidTips?: string } }) {
  return (
    <div className="space-y-4">
      <div className="p-3 bg-card rounded-sm border border-l-2 border-l-emerald-500">
        <p className="text-sm font-medium text-foreground">{analysis.summary}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {([
          { icon: Anchor, label: "共通キーフック", text: analysis.keyHook },
          { icon: FileText, label: "コンテンツ傾向", text: analysis.contentTrend },
          { icon: Clapperboard, label: "フォーマット特徴", text: analysis.formatFeatures },
          { icon: Hash, label: "ハッシュタグ戦略", text: analysis.hashtagStrategy },
        ] as const).map(({ icon: Icon, label, text }) => (
          <div key={label} className="p-3 bg-muted/30 rounded-sm border border-border/50">
            <div className="text-xs font-semibold text-foreground/70 mb-1 flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" /> {label}
            </div>
            <p className="text-sm text-foreground">{text}</p>
          </div>
        ))}
      </div>
      <div className="p-3 bg-foreground/[0.03] rounded-sm border border-border">
        <div className="text-xs font-semibold text-foreground/70 mb-1 flex items-center gap-1.5">
          <Lightbulb className="h-3.5 w-3.5" /> VSEO攻略ポイント
        </div>
        <p className="text-sm text-foreground font-medium">{analysis.vseoTips}</p>
      </div>
      {analysis.avoidTips && (
        <div className="p-3 bg-[#D71921]/[0.04] rounded-sm border border-[#D71921]/15">
          <div className="text-xs font-semibold text-[#D71921]/80 mb-1 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> 避けるべきポイント
          </div>
          <p className="text-sm text-foreground font-medium">{analysis.avoidTips}</p>
        </div>
      )}
    </div>
  );
}

export function LosePatternContent({ analysis }: { analysis: { summary: string; badHook: string; contentWeakness: string; formatProblems: string; hashtagMistakes: string; avoidTips: string } }) {
  return (
    <div className="space-y-4">
      <div className="p-3 bg-card rounded-sm border border-l-2 border-l-[#D71921]/60">
        <p className="text-sm font-medium text-foreground">{analysis.summary}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {([
          { icon: Anchor, label: "失敗フック要素", text: analysis.badHook },
          { icon: FileText, label: "コンテンツの弱点", text: analysis.contentWeakness },
          { icon: Clapperboard, label: "フォーマット問題", text: analysis.formatProblems },
          { icon: Hash, label: "ハッシュタグの失敗", text: analysis.hashtagMistakes },
        ] as const).map(({ icon: Icon, label, text }) => (
          <div key={label} className="p-3 bg-muted/30 rounded-sm border border-border/50">
            <div className="text-xs font-semibold text-foreground/70 mb-1 flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" /> {label}
            </div>
            <p className="text-sm text-foreground">{text}</p>
          </div>
        ))}
      </div>
      <div className="p-3 bg-[#D71921]/[0.04] rounded-sm border border-[#D71921]/15">
        <div className="text-xs font-semibold text-[#D71921]/80 mb-1 flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" /> 避けるべきポイント
        </div>
        <p className="text-sm text-foreground font-medium">{analysis.avoidTips}</p>
      </div>
    </div>
  );
}
