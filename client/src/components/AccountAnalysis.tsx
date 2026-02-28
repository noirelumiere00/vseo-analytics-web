import { useMemo, useState } from "react";

type Video = {
  accountId?: string | null;
  accountName?: string | null;
  accountAvatarUrl?: string | null;
  followerCount?: number | bigint | null;
  viewCount?: number | bigint | null;
  likeCount?: number | bigint | null;
  commentCount?: number | bigint | null;
  shareCount?: number | bigint | null;
  saveCount?: number | bigint | null;
  sentiment?: string | null;
};

type AccountStat = {
  accountId: string;
  accountName: string;
  avatarUrl: string;
  followerCount: number;
  videoCount: number;
  totalViews: number;
  avgER: number;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
};

export default function AccountAnalysis({ videos }: { videos: Video[] }) {
  const [sortBy, setSortBy] = useState<"videos" | "views" | "er">("views");

  const accounts = useMemo(() => {
    const map = new Map<string, AccountStat>();
    for (const v of videos) {
      const id = v.accountId || "unknown";
      if (!map.has(id)) {
        map.set(id, {
          accountId: id,
          accountName: v.accountName || id,
          avatarUrl: v.accountAvatarUrl || "",
          followerCount: Number(v.followerCount) || 0,
          videoCount: 0,
          totalViews: 0,
          avgER: 0,
          sentimentBreakdown: { positive: 0, neutral: 0, negative: 0 },
        });
      }
      const acc = map.get(id)!;
      acc.videoCount++;
      const views = Number(v.viewCount) || 0;
      acc.totalViews += views;
      if (views > 0) {
        const eng = (Number(v.likeCount)||0) + (Number(v.commentCount)||0) + (Number(v.shareCount)||0) + (Number(v.saveCount)||0);
        acc.avgER += (eng / views) * 100;
      }
      const s = v.sentiment as "positive" | "neutral" | "negative";
      if (s && acc.sentimentBreakdown[s] !== undefined) {
        acc.sentimentBreakdown[s]++;
      }
    }
    // avgER を平均に
    for (const acc of map.values()) {
      if (acc.videoCount > 0) acc.avgER = Math.round((acc.avgER / acc.videoCount) * 100) / 100;
    }
    return Array.from(map.values());
  }, [videos]);

  const sorted = useMemo(() => {
    const arr = [...accounts];
    if (sortBy === "videos") arr.sort((a, b) => b.videoCount - a.videoCount);
    else if (sortBy === "views") arr.sort((a, b) => b.totalViews - a.totalViews);
    else arr.sort((a, b) => b.avgER - a.avgER);
    return arr;
  }, [accounts, sortBy]);

  if (accounts.length === 0) {
    return <p className="text-sm text-muted-foreground">アカウントデータがありません</p>;
  }

  const fmt = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return n.toString();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">アカウント別分析（{accounts.length}アカウント）</h4>
        <div className="flex gap-1">
          {(["views", "videos", "er"] as const).map(key => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`px-2 py-0.5 text-xs rounded ${sortBy === key ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              {key === "views" ? "再生数" : key === "videos" ? "投稿数" : "ER%"}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {sorted.map(acc => {
          const total = acc.sentimentBreakdown.positive + acc.sentimentBreakdown.neutral + acc.sentimentBreakdown.negative;
          const posW = total > 0 ? (acc.sentimentBreakdown.positive / total) * 100 : 0;
          const neuW = total > 0 ? (acc.sentimentBreakdown.neutral / total) * 100 : 0;
          const negW = total > 0 ? (acc.sentimentBreakdown.negative / total) * 100 : 0;
          return (
            <div key={acc.accountId} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30 hover:bg-muted/50">
              {acc.avatarUrl ? (
                <img src={acc.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs">?</div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{acc.accountName}</div>
                <div className="text-[10px] text-muted-foreground">
                  {fmt(acc.followerCount)} followers / {acc.videoCount}本 / {fmt(acc.totalViews)}再生 / ER {acc.avgER}%
                </div>
                {total > 0 && (
                  <div className="flex h-1.5 rounded-full overflow-hidden mt-1">
                    <div className="bg-green-500" style={{ width: `${posW}%` }} />
                    <div className="bg-gray-300" style={{ width: `${neuW}%` }} />
                    <div className="bg-red-400" style={{ width: `${negW}%` }} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
