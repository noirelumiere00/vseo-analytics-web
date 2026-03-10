import { Badge } from "@/components/ui/badge";

type HashtagStrategyData = {
  topCombinations: Array<{ tags: string[]; count: number; avgER: number }>;
  recommendations: string[];
};

function fmtViews(n: number) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return n.toLocaleString();
}

export default function HashtagStrategy({ data }: { data: HashtagStrategyData | null | undefined }) {
  if (!data || (!data.topCombinations?.length && !data.recommendations?.length)) {
    return <p className="text-sm text-muted-foreground">ハッシュタグデータが不足しています</p>;
  }

  const maxViews = Math.max(...(data.topCombinations || []).map(c => c.avgER), 1);

  return (
    <div className="space-y-4">
      {data.recommendations && data.recommendations.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">推奨事項</h4>
          {data.recommendations.map((rec, i) => (
            <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-blue-50 border border-blue-100">
              <span className="text-blue-500 mt-0.5">{i === data.recommendations.length - 1 && rec.includes("避ける") ? "⚠️" : "💡"}</span>
              <span className="text-sm">{rec}</span>
            </div>
          ))}
        </div>
      )}

      {data.topCombinations && data.topCombinations.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2">高再生 ハッシュタグ組み合わせ TOP10</h4>
          <div className="space-y-1.5">
            {data.topCombinations.map((combo, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-5 text-xs text-muted-foreground text-right">{i + 1}.</span>
                <div className="flex gap-1 min-w-[140px]">
                  {combo.tags.map(tag => (
                    <Badge key={tag} variant="secondary" className="text-[10px]">#{tag}</Badge>
                  ))}
                </div>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${(combo.avgER / maxViews) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-medium w-20 text-right">{fmtViews(combo.avgER)}</span>
                <span className="text-[10px] text-muted-foreground w-10">({combo.count}本)</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
