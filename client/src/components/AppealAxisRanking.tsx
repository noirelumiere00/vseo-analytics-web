import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";

interface Video {
  desc: string;
  hashtags: string[];
  diggCount: number;
  playCount: number;
  commentCount: number;
}

const APPEAL_AXES = [
  { key: "悩み起点型", keywords: ["悩み", "困", "解決", "つらい", "改善"] },
  { key: "効果実感型", keywords: ["使ってみた", "レビュー", "ビフォーアフター", "効果", "結果"] },
  { key: "比較・ランキング型", keywords: ["vs", "比較", "ランキング", "TOP", "ベスト"] },
  { key: "共感・あるある型", keywords: ["あるある", "わかる", "共感", "それな", "わかりみ"] },
  { key: "How-to型", keywords: ["やり方", "方法", "コツ", "教え", "手順"] },
  { key: "時短・ラク型", keywords: ["時短", "簡単", "ラク", "楽", "ズボラ"] },
  { key: "トレンド便乗型", keywords: ["バズ", "話題", "流行", "トレンド", "最新"] },
  { key: "ギャップ・意外性型", keywords: ["意外", "実は", "知らなかった", "衝撃", "驚"] },
  { key: "ストーリー型", keywords: ["体験", "日記", "Vlog", "ルーティン", "密着"] },
  { key: "プレゼント・お得型", keywords: ["無料", "お得", "プレゼント", "セール", "割引"] },
] as const;

function classify(video: Video): string[] {
  const text = `${video.desc} ${video.hashtags.join(" ")}`.toLowerCase();
  const matched = APPEAL_AXES.filter((a) =>
    a.keywords.some((kw) => text.includes(kw.toLowerCase()))
  ).map((a) => a.key);
  return matched.length > 0 ? matched : ["未分類"];
}

export default function AppealAxisRanking({ videos }: { videos: Video[] }) {
  const ranked = useMemo(() => {
    const buckets: Record<string, { totalER: number; count: number }> = {};
    for (const v of videos) {
      const er = v.playCount > 0 ? ((v.diggCount + v.commentCount) / v.playCount) * 100 : 0;
      for (const axis of classify(v)) {
        if (!buckets[axis]) buckets[axis] = { totalER: 0, count: 0 };
        buckets[axis].totalER += er;
        buckets[axis].count++;
      }
    }
    return Object.entries(buckets)
      .map(([axis, { totalER, count }]) => ({ axis, avgER: +(totalER / count).toFixed(2), count }))
      .sort((a, b) => b.avgER - a.avgER);
  }, [videos]);

  if (ranked.length === 0) return null;
  const maxER = ranked[0]?.avgER || 1;

  return (
    <div className="space-y-2.5">
      {ranked.map((item, i) => (
        <div key={item.axis} className="flex items-center gap-3">
          <span className="w-5 text-right text-[11px] font-bold text-slate-400 tabular-nums">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-slate-700 truncate">{item.axis}</span>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="rounded-sm text-[10px] px-1.5 py-0 border-slate-200 text-slate-500">
                  {item.count}本
                </Badge>
                <span className="text-sm font-bold text-amber-700 tabular-nums w-16 text-right">{item.avgER}%</span>
              </div>
            </div>
            <div className="h-2 rounded-sm bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-sm bg-gradient-to-r from-amber-400 to-amber-600 transition-all duration-500"
                style={{ width: `${(item.avgER / maxER) * 100}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
