export function WinPatternContent({ analysis }: { analysis: { summary: string; keyHook: string; contentTrend: string; formatFeatures: string; hashtagStrategy: string; vseoTips: string } }) {
  return (
    <div className="space-y-4">
      <div className="p-3 bg-white rounded-lg border border-blue-100">
        <p className="text-sm font-medium text-slate-800">{analysis.summary}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 bg-slate-50 rounded-lg">
          <div className="text-xs font-semibold text-blue-700 mb-1">🎣 共通キーフック</div>
          <p className="text-sm text-foreground">{analysis.keyHook}</p>
        </div>
        <div className="p-3 bg-slate-50 rounded-lg">
          <div className="text-xs font-semibold text-blue-700 mb-1">📋 コンテンツ傾向</div>
          <p className="text-sm text-foreground">{analysis.contentTrend}</p>
        </div>
        <div className="p-3 bg-slate-50 rounded-lg">
          <div className="text-xs font-semibold text-blue-700 mb-1">🎬 フォーマット特徴</div>
          <p className="text-sm text-foreground">{analysis.formatFeatures}</p>
        </div>
        <div className="p-3 bg-slate-50 rounded-lg">
          <div className="text-xs font-semibold text-blue-700 mb-1"># ハッシュタグ戦略</div>
          <p className="text-sm text-foreground">{analysis.hashtagStrategy}</p>
        </div>
      </div>
      <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
        <div className="text-xs font-semibold text-blue-700 mb-1">💡 VSEO攻略ポイント</div>
        <p className="text-sm text-blue-900 font-medium">{analysis.vseoTips}</p>
      </div>
    </div>
  );
}

export function LosePatternContent({ analysis }: { analysis: { summary: string; badHook: string; contentWeakness: string; formatProblems: string; hashtagMistakes: string; avoidTips: string } }) {
  return (
    <div className="space-y-4">
      <div className="p-3 bg-white rounded-lg border border-red-100">
        <p className="text-sm font-medium text-slate-800">{analysis.summary}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3 bg-red-50/50 rounded-lg">
          <div className="text-xs font-semibold text-red-700 mb-1">🎣 失敗フック要素</div>
          <p className="text-sm text-foreground">{analysis.badHook}</p>
        </div>
        <div className="p-3 bg-red-50/50 rounded-lg">
          <div className="text-xs font-semibold text-red-700 mb-1">📉 コンテンツの弱点</div>
          <p className="text-sm text-foreground">{analysis.contentWeakness}</p>
        </div>
        <div className="p-3 bg-red-50/50 rounded-lg">
          <div className="text-xs font-semibold text-red-700 mb-1">🎬 フォーマット問題</div>
          <p className="text-sm text-foreground">{analysis.formatProblems}</p>
        </div>
        <div className="p-3 bg-red-50/50 rounded-lg">
          <div className="text-xs font-semibold text-red-700 mb-1"># ハッシュタグの失敗</div>
          <p className="text-sm text-foreground">{analysis.hashtagMistakes}</p>
        </div>
      </div>
      <div className="p-3 bg-red-50 rounded-lg border border-red-200">
        <div className="text-xs font-semibold text-red-700 mb-1">⚠️ 避けるべきポイント</div>
        <p className="text-sm text-red-900 font-medium">{analysis.avoidTips}</p>
      </div>
    </div>
  );
}
