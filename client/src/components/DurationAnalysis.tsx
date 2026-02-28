import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

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

export default function DurationAnalysis({ videos }: { videos: Video[] }) {
  const data = useMemo(() => {
    return RANGES.map(range => {
      const filtered = videos.filter(v => {
        const d = v.duration ?? 0;
        return d >= range.min && d <= range.max;
      });
      const count = filtered.length;
      let avgER = 0;
      let avgViews = 0;
      if (count > 0) {
        let erSum = 0;
        let viewSum = 0;
        for (const v of filtered) {
          const views = Number(v.viewCount) || 0;
          viewSum += views;
          if (views > 0) {
            const eng = (Number(v.likeCount)||0) + (Number(v.commentCount)||0) + (Number(v.shareCount)||0) + (Number(v.saveCount)||0);
            erSum += (eng / views) * 100;
          }
        }
        avgER = erSum / count;
        avgViews = viewSum / count;
      }
      return {
        range: range.label,
        count,
        avgER: Math.round(avgER * 100) / 100,
        avgViews: Math.round(avgViews),
      };
    }).filter(d => d.count > 0);
  }, [videos]);

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">動画尺データがありません</p>;
  }

  const maxER = Math.max(...data.map(d => d.avgER));

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <XAxis dataKey="range" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
          <Tooltip
            formatter={(value: number, name: string) => {
              if (name === "avgER") return [`${value}%`, "平均ER"];
              return [value, name];
            }}
            labelFormatter={l => `尺: ${l}`}
          />
          <Bar dataKey="avgER" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.avgER === maxER ? "#2563eb" : "#93c5fd"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-3 gap-2 text-xs">
        {data.map(d => (
          <div key={d.range} className="p-2 rounded bg-muted/50 text-center">
            <div className="font-medium">{d.range}</div>
            <div className="text-muted-foreground">{d.count}本 / ER {d.avgER}%</div>
            <div className="text-muted-foreground">平均{d.avgViews.toLocaleString()}再生</div>
          </div>
        ))}
      </div>
    </div>
  );
}
