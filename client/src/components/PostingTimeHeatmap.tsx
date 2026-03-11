import { useMemo, useState } from "react";

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

type Mode = "count" | "views";

function formatViews(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

export default function PostingTimeHeatmap({ videos }: { videos: Video[] }) {
  const [mode, setMode] = useState<Mode>("views");

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

  const viewsGrid = useMemo(() => {
    const g: { total: number; count: number }[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => ({ total: 0, count: 0 }))
    );
    let max = 0;
    for (const v of videos) {
      if (!v.postedAt) continue;
      const d = new Date(v.postedAt);
      if (isNaN(d.getTime())) continue;
      const views = Number(v.viewCount) || 0;
      const day = d.getDay();
      const hour = d.getHours();
      g[day][hour].total += views;
      g[day][hour].count++;
    }
    // compute max average
    for (let di = 0; di < 7; di++) {
      for (let h = 0; h < 24; h++) {
        if (g[di][h].count > 0) {
          const avg = g[di][h].total / g[di][h].count;
          if (avg > max) max = avg;
        }
      }
    }
    return { grid: g, maxAvg: max };
  }, [videos]);

  if (videos.filter(v => v.postedAt).length === 0) {
    return <p className="text-sm text-muted-foreground">投稿日時データがありません</p>;
  }

  const getCountColor = (count: number) => {
    if (maxCount === 0 || count === 0) return "bg-muted";
    const intensity = count / maxCount;
    if (intensity > 0.75) return "bg-blue-600 text-white";
    if (intensity > 0.5) return "bg-blue-400 text-white";
    if (intensity > 0.25) return "bg-blue-200";
    return "bg-blue-100";
  };

  const getViewsColor = (avg: number) => {
    if (viewsGrid.maxAvg === 0 || avg === 0) return "bg-muted";
    const intensity = avg / viewsGrid.maxAvg;
    if (intensity > 0.75) return "bg-orange-600 text-white";
    if (intensity > 0.5) return "bg-orange-400 text-white";
    if (intensity > 0.25) return "bg-orange-200";
    return "bg-orange-100";
  };

  return (
    <div className="space-y-4">
      {/* モード切替 */}
      <div className="flex gap-1 p-0.5 bg-muted rounded-lg w-fit">
        <button
          onClick={() => setMode("views")}
          className={`px-3 py-1 text-xs rounded-md transition-colors ${mode === "views" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
        >
          平均再生数
        </button>
        <button
          onClick={() => setMode("count")}
          className={`px-3 py-1 text-xs rounded-md transition-colors ${mode === "count" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
        >
          投稿数
        </button>
      </div>

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
                  const vg = viewsGrid.grid[di][h];
                  const avgViews = vg.count > 0 ? vg.total / vg.count : 0;

                  const cellColor = mode === "count" ? getCountColor(count) : getViewsColor(avgViews);
                  const cellText = mode === "count"
                    ? (count > 0 ? String(count) : "")
                    : (avgViews > 0 ? formatViews(avgViews) : "");

                  return (
                    <div
                      key={`${di}-${h}`}
                      className={`w-7 h-7 rounded-sm flex items-center justify-center text-[8px] font-medium ${cellColor}`}
                      title={`${day}曜 ${h}時: ${count}本 / 平均${formatViews(avgViews)}再生`}
                    >
                      {cellText}
                    </div>
                  );
                })}
              </>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
          <span>少</span>
          {mode === "count" ? (
            <>
              <div className="w-4 h-3 bg-blue-100 rounded-sm" />
              <div className="w-4 h-3 bg-blue-200 rounded-sm" />
              <div className="w-4 h-3 bg-blue-400 rounded-sm" />
              <div className="w-4 h-3 bg-blue-600 rounded-sm" />
            </>
          ) : (
            <>
              <div className="w-4 h-3 bg-orange-100 rounded-sm" />
              <div className="w-4 h-3 bg-orange-200 rounded-sm" />
              <div className="w-4 h-3 bg-orange-400 rounded-sm" />
              <div className="w-4 h-3 bg-orange-600 rounded-sm" />
            </>
          )}
          <span>多</span>
        </div>
      </div>
    </div>
  );
}
