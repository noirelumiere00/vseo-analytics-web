import { Badge } from "@/components/ui/badge";

interface Hashtag {
  tag: string;
  videoCount: number;
  avgER: number;
}

const QUADRANT_LABELS = {
  topLeft: { label: "ニッチ高ER（狙い目）", cls: "bg-teal-50 border-teal-200" },
  topRight: { label: "レッドオーシャン（高競合）", cls: "bg-slate-50 border-slate-200" },
  bottomLeft: { label: "低関心", cls: "bg-slate-50/60 border-slate-100" },
  bottomRight: { label: "飽和（避ける）", cls: "bg-orange-50 border-orange-200" },
} as const;

export default function MarketOpportunityMatrix({ hashtags }: { hashtags: Hashtag[] }) {
  if (hashtags.length === 0) return null;

  const sorted = [...hashtags].sort((a, b) => b.avgER - a.avgER);
  const medianVC = [...hashtags].sort((a, b) => a.videoCount - b.videoCount)[Math.floor(hashtags.length / 2)].videoCount;
  const medianER = [...hashtags].sort((a, b) => a.avgER - b.avgER)[Math.floor(hashtags.length / 2)].avgER;

  const quadrants = { topLeft: [] as Hashtag[], topRight: [] as Hashtag[], bottomLeft: [] as Hashtag[], bottomRight: [] as Hashtag[] };
  for (const h of sorted) {
    const highER = h.avgER >= medianER;
    const highVC = h.videoCount >= medianVC;
    if (highER && !highVC) quadrants.topLeft.push(h);
    else if (highER && highVC) quadrants.topRight.push(h);
    else if (!highER && !highVC) quadrants.bottomLeft.push(h);
    else quadrants.bottomRight.push(h);
  }

  const renderQuadrant = (key: keyof typeof QUADRANT_LABELS, items: Hashtag[]) => {
    const cfg = QUADRANT_LABELS[key];
    return (
      <div className={`rounded-sm border p-3 min-h-[120px] ${cfg.cls}`}>
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{cfg.label}</p>
        <div className="flex flex-wrap gap-1.5">
          {items.slice(0, 8).map((h) => (
            <Badge key={h.tag} variant="outline" className={`text-[11px] font-medium rounded-sm ${key === "topLeft" ? "border-teal-400 text-teal-800 bg-teal-100/60" : "border-slate-300 text-slate-600"}`}>
              #{h.tag}
              <span className="ml-1 text-[9px] opacity-70">{h.avgER}%</span>
            </Badge>
          ))}
          {items.length > 8 && <span className="text-[10px] text-slate-400 self-center">+{items.length - 8}</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400 font-medium">← 投稿数 少 ── 投稿数 多 →</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {renderQuadrant("topLeft", quadrants.topLeft)}
        {renderQuadrant("topRight", quadrants.topRight)}
        {renderQuadrant("bottomLeft", quadrants.bottomLeft)}
        {renderQuadrant("bottomRight", quadrants.bottomRight)}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400">
        <span>↑ 高ER</span>
        <span>↓ 低ER</span>
      </div>
    </div>
  );
}
