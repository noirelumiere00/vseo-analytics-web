import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Eye, Heart, Sparkles } from "lucide-react";

interface TrendingHashtag { tag: string; videoCount: number; avgER: number }
interface TopVideo { desc: string; authorNickname: string; playCount: number; diggCount: number; coverUrl: string }

const IDEA_HINTS = [
  "このタグで「〇〇してみた」系の実体験動画が狙い目",
  "比較・ランキング切り口でこのトレンドに乗ると高ERが期待できる",
  "悩み起点 × このタグで共感を狙うのが効果的",
];

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function TrendBrief({
  trendingHashtags,
  topVideos,
}: {
  trendingHashtags: TrendingHashtag[];
  topVideos: TopVideo[];
}) {
  const top3Tags = trendingHashtags.slice(0, 3);
  const top3Videos = topVideos.slice(0, 3);

  return (
    <div className="space-y-5">
      {/* 乗るべきトレンド */}
      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-amber-500" /> 乗るべきトレンド TOP3
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {top3Tags.map((h, i) => (
            <Card key={h.tag} className="rounded-sm border-slate-200 hover:border-amber-300 transition-colors">
              <CardContent className="p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="rounded-sm border-teal-300 text-teal-800 bg-teal-50 text-[11px] font-bold">
                    #{h.tag}
                  </Badge>
                  <span className="text-[10px] font-semibold text-slate-400">{h.videoCount}本</span>
                </div>
                <p className="text-lg font-extrabold text-amber-700 tabular-nums">{h.avgER}%<span className="text-[10px] font-medium text-slate-400 ml-1">ER</span></p>
                <p className="text-[11px] text-slate-500 leading-snug">{IDEA_HINTS[i % IDEA_HINTS.length]}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* 参考動画 */}
      {top3Videos.length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">参考動画</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {top3Videos.map((v, i) => (
              <div key={i} className="flex gap-3 items-start p-2.5 rounded-sm border border-slate-100 bg-slate-50/50">
                <img src={v.coverUrl} alt="" className="w-16 h-20 object-cover rounded-sm bg-slate-200 shrink-0" loading="lazy" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-slate-700 line-clamp-2 leading-snug mb-1">{v.desc || "動画"}</p>
                  <p className="text-[10px] text-slate-400 truncate mb-1.5">@{v.authorNickname}</p>
                  <div className="flex items-center gap-2.5 text-[10px] text-slate-500">
                    <span className="flex items-center gap-0.5"><Eye className="h-3 w-3" />{fmt(v.playCount)}</span>
                    <span className="flex items-center gap-0.5"><Heart className="h-3 w-3" />{fmt(v.diggCount)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
