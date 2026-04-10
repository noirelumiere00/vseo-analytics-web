import { Anchor, FileText, Clapperboard, Hash, Lightbulb, AlertTriangle, TrendingDown } from "lucide-react";

export function WinPatternContent({ analysis }: { analysis: { summary: string; keyHook: string; contentTrend: string; formatFeatures: string; hashtagStrategy: string; vseoTips: string; avoidTips?: string } }) {
  return (
    <div className="space-y-4">
      <div className="p-3 bg-card rounded-sm border-l-[3px] border-l-teal-500 border">
        <p className="text-sm font-medium text-foreground">{analysis.summary}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 bg-secondary/30 dark:bg-secondary/20 rounded-sm border-l-[3px] border-l-teal-400">
          <div className="text-xs font-semibold text-teal-700 dark:text-teal-400 mb-1 flex items-center gap-1.5">
            <Anchor className="h-3.5 w-3.5" /> 共通キーフック
          </div>
          <p className="text-sm text-foreground">{analysis.keyHook}</p>
        </div>
        <div className="p-3 bg-secondary/30 dark:bg-secondary/20 rounded-sm border-l-[3px] border-l-teal-400">
          <div className="text-xs font-semibold text-teal-700 dark:text-teal-400 mb-1 flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" /> コンテンツ傾向
          </div>
          <p className="text-sm text-foreground">{analysis.contentTrend}</p>
        </div>
        <div className="p-3 bg-secondary/30 dark:bg-secondary/20 rounded-sm border-l-[3px] border-l-teal-400">
          <div className="text-xs font-semibold text-teal-700 dark:text-teal-400 mb-1 flex items-center gap-1.5">
            <Clapperboard className="h-3.5 w-3.5" /> フォーマット特徴
          </div>
          <p className="text-sm text-foreground">{analysis.formatFeatures}</p>
        </div>
        <div className="p-3 bg-secondary/30 dark:bg-secondary/20 rounded-sm border-l-[3px] border-l-teal-400">
          <div className="text-xs font-semibold text-teal-700 dark:text-teal-400 mb-1 flex items-center gap-1.5">
            <Hash className="h-3.5 w-3.5" /> ハッシュタグ戦略
          </div>
          <p className="text-sm text-foreground">{analysis.hashtagStrategy}</p>
        </div>
      </div>
      <div className="p-3 bg-teal-50 dark:bg-teal-950/30 rounded-sm border border-teal-200 dark:border-teal-800 border-l-[3px] border-l-teal-600">
        <div className="text-xs font-semibold text-teal-700 dark:text-teal-400 mb-1 flex items-center gap-1.5">
          <Lightbulb className="h-3.5 w-3.5" /> VSEO攻略ポイント
        </div>
        <p className="text-sm text-teal-900 dark:text-teal-200 font-medium">{analysis.vseoTips}</p>
      </div>
      {analysis.avoidTips && (
        <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 border-l-[3px] border-l-amber-600">
          <div className="text-xs font-semibold text-amber-700 mb-1 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> 避けるべきポイント
          </div>
          <p className="text-sm text-amber-900 font-medium">{analysis.avoidTips}</p>
        </div>
      )}
    </div>
  );
}

export function LosePatternContent({ analysis }: { analysis: { summary: string; badHook: string; contentWeakness: string; formatProblems: string; hashtagMistakes: string; avoidTips: string } }) {
  return (
    <div className="space-y-4">
      <div className="p-3 bg-card rounded-sm border-l-[3px] border-l-amber-500 border">
        <p className="text-sm font-medium text-foreground">{analysis.summary}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 bg-amber-50/40 dark:bg-amber-950/20 rounded-sm border-l-[3px] border-l-amber-400">
          <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-1.5">
            <Anchor className="h-3.5 w-3.5" /> 失敗フック要素
          </div>
          <p className="text-sm text-foreground">{analysis.badHook}</p>
        </div>
        <div className="p-3 bg-amber-50/40 dark:bg-amber-950/20 rounded-sm border-l-[3px] border-l-amber-400">
          <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-1.5">
            <TrendingDown className="h-3.5 w-3.5" /> コンテンツの弱点
          </div>
          <p className="text-sm text-foreground">{analysis.contentWeakness}</p>
        </div>
        <div className="p-3 bg-amber-50/40 dark:bg-amber-950/20 rounded-sm border-l-[3px] border-l-amber-400">
          <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-1.5">
            <Clapperboard className="h-3.5 w-3.5" /> フォーマット問題
          </div>
          <p className="text-sm text-foreground">{analysis.formatProblems}</p>
        </div>
        <div className="p-3 bg-amber-50/40 dark:bg-amber-950/20 rounded-sm border-l-[3px] border-l-amber-400">
          <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-1.5">
            <Hash className="h-3.5 w-3.5" /> ハッシュタグの失敗
          </div>
          <p className="text-sm text-foreground">{analysis.hashtagMistakes}</p>
        </div>
      </div>
      <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-sm border border-amber-200 dark:border-amber-800 border-l-[3px] border-l-amber-600">
        <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" /> 避けるべきポイント
        </div>
        <p className="text-sm text-amber-900 dark:text-amber-200 font-medium">{analysis.avoidTips}</p>
      </div>
    </div>
  );
}
