import { useMemo } from "react";

type Video = {
  postedAt?: string | Date | null;
  viewCount?: number | bigint | null;
  likeCount?: number | bigint | null;
  commentCount?: number | bigint | null;
  shareCount?: number | bigint | null;
  saveCount?: number | bigint | null;
};

const DAYS = ["日", "月", "火", "水", "木", "金", "土"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function PostingTimeHeatmap({ videos }: { videos: Video[] }) {
  const { grid, maxCount } = useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let max = 0;
    for (const v of videos) {
      if (!v.postedAt) continue;
      const d = new Date(v.postedAt);
      if (isNaN(d.getTime())) continue;
      const day = d.getDay();
      const hour = d.getHours();
      g[day][hour]++;
      if (g[day][hour] > max) max = g[day][hour];
    }
    return { grid: g, maxCount: max };
  }, [videos]);

  const erGrid = useMemo(() => {
    const g: { total: number; count: number }[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => ({ total: 0, count: 0 }))
    );
    for (const v of videos) {
      if (!v.postedAt) continue;
      const d = new Date(v.postedAt);
      if (isNaN(d.getTime())) continue;
      const views = Number(v.viewCount) || 0;
      if (views === 0) continue;
      const eng = (Number(v.likeCount)||0) + (Number(v.commentCount)||0) + (Number(v.shareCount)||0) + (Number(v.saveCount)||0);
      const er = (eng / views) * 100;
      const day = d.getDay();
      const hour = d.getHours();
      g[day][hour].total += er;
      g[day][hour].count++;
    }
    return g;
  }, [videos]);

  if (videos.filter(v => v.postedAt).length === 0) {
    return <p className="text-sm text-muted-foreground">投稿日時データがありません</p>;
  }

  const getColor = (count: number) => {
    if (maxCount === 0 || count === 0) return "bg-muted";
    const intensity = count / maxCount;
    if (intensity > 0.75) return "bg-blue-600 text-white";
    if (intensity > 0.5) return "bg-blue-400 text-white";
    if (intensity > 0.25) return "bg-blue-200";
    return "bg-blue-100";
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="overflow-x-auto">
          <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `40px repeat(24, 28px)` }}>
            <div />
            {HOURS.map(h => (
              <div key={h} className="text-[10px] text-center text-muted-foreground">{h}</div>
            ))}
            {DAYS.map((day, di) => (
              <>
                <div key={`day-${di}`} className="text-xs font-medium flex items-center">{day}</div>
                {HOURS.map(h => {
                  const count = grid[di][h];
                  const er = erGrid[di][h];
                  const avgEr = er.count > 0 ? (er.total / er.count).toFixed(1) : "-";
                  return (
                    <div
                      key={`${di}-${h}`}
                      className={`w-7 h-7 rounded-sm flex items-center justify-center text-[9px] font-medium ${getColor(count)}`}
                      title={`${day}曜 ${h}時: ${count}本 / 平均ER: ${avgEr}%`}
                    >
                      {count > 0 ? count : ""}
                    </div>
                  );
                })}
              </>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
          <span>少</span>
          <div className="w-4 h-3 bg-blue-100 rounded-sm" />
          <div className="w-4 h-3 bg-blue-200 rounded-sm" />
          <div className="w-4 h-3 bg-blue-400 rounded-sm" />
          <div className="w-4 h-3 bg-blue-600 rounded-sm" />
          <span>多</span>
        </div>
      </div>
    </div>
  );
}
