import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";

type Video = {
  duration?: number | null;
  viewCount?: number | bigint | null;
  likeCount?: number | bigint | null;
  commentCount?: number | bigint | null;
  shareCount?: number | bigint | null;
  saveCount?: number | bigint | null;
};

const RANGES = [
  { label: "~15秒", min: 0, max: 15 },
  { label: "16-30秒", min: 16, max: 30 },
  { label: "31-60秒", min: 31, max: 60 },
  { label: "61-90秒", min: 61, max: 90 },
  { label: "91-180秒", min: 91, max: 180 },
  { label: "180秒~", min: 181, max: Infinity },
];

function formatViews(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export default function DurationAnalysis({ videos }: { videos: Video[] }) {
  const data = useMemo(() => {
    return RANGES.map(range => {
      const filtered = videos.filter(v => {
        const d = v.duration ?? 0;
        return d >= range.min && d <= range.max;
      });
      const count = filtered.length;
      let avgViews = 0;
      if (count > 0) {
        let viewSum = 0;
        for (const v of filtered) {
          viewSum += Number(v.viewCount) || 0;
        }
        avgViews = viewSum / count;
      }
      return {
        range: range.label,
        count,
        avgViews: Math.round(avgViews),
      };
    }).filter(d => d.count > 0);
  }, [videos]);

  const median = useMemo(() => {
    const views = videos.map(v => Number(v.viewCount) || 0).sort((a, b) => a - b);
    if (views.length === 0) return 0;
    const mid = Math.floor(views.length / 2);
    return views.length % 2 === 0 ? Math.round((views[mid - 1] + views[mid]) / 2) : views[mid];
  }, [videos]);

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">動画尺データがありません</p>;
  }

  const maxViews = Math.max(...data.map(d => d.avgViews));

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <XAxis dataKey="range" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={v => formatViews(v)} />
          <Tooltip
            formatter={(value: number) => [formatViews(value), "平均再生数"]}
            labelFormatter={l => `尺: ${l}`}
          />
          <Bar dataKey="avgViews" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.avgViews === maxViews ? "#2563eb" : "#93c5fd"} />
            ))}
          </Bar>
          {median > 0 && (
            <ReferenceLine
              y={median}
              stroke="#ef4444"
              strokeDasharray="5 5"
              label={{ value: `中央値: ${formatViews(median)}`, position: "right", fontSize: 11, fill: "#ef4444" }}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-3 gap-2 text-xs">
        {data.map(d => (
          <div key={d.range} className="p-2 rounded bg-muted/50 text-center">
            <div className="font-medium">{d.range}</div>
            <div className="text-muted-foreground">{d.count}本</div>
            <div className="text-muted-foreground">平均{d.avgViews.toLocaleString()}再生</div>
          </div>
        ))}
      </div>
      {median > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="inline-block w-3 h-0.5 bg-red-500 mr-1 align-middle" />
          全動画の再生数中央値: {median.toLocaleString()}回（{formatViews(median)}）
        </p>
      )}
    </div>
  );
}
