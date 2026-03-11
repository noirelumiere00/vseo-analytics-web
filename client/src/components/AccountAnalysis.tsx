import { useMemo, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

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
  videoId?: string | null;
};

type RankInfoItem = {
  ranks: (number | null)[];
  avgRank: number;
  dominanceScore: number;
  appearanceCount: number;
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
  // rank fields
  bestAvgRank: number;
  totalAppearances: number;
  totalDominance: number;
  avgDominance: number;
  videosInResults: number;
};

const COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#3b82f6", "#84cc16",
  "#a855f7", "#06b6d4", "#e11d48", "#22c55e", "#eab308",
];

type TabKey = "videos" | "views" | "er" | "rank";

type Props = {
  videos: Video[];
  rankInfo?: Record<string, RankInfoItem>;
  numSessions?: number;
};

export default function AccountAnalysis({ videos, rankInfo, numSessions }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("views");

  const accounts = useMemo(() => {
    // Build a map of accountId -> list of videoIds
    const accountVideoIds = new Map<string, string[]>();
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
          bestAvgRank: 999,
          totalAppearances: 0,
          totalDominance: 0,
          avgDominance: 0,
          videosInResults: 0,
        });
        accountVideoIds.set(id, []);
      }
      const acc = map.get(id)!;
      acc.videoCount++;
      if (v.videoId) accountVideoIds.get(id)!.push(v.videoId);
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
    for (const acc of map.values()) {
      if (acc.videoCount > 0) acc.avgER = Math.round((acc.avgER / acc.videoCount) * 100) / 100;

      // Aggregate rank data
      if (rankInfo) {
        const vids = accountVideoIds.get(acc.accountId) || [];
        let rankCount = 0;
        for (const vid of vids) {
          const ri = rankInfo[vid];
          if (!ri) continue;
          rankCount++;
          if (ri.avgRank < acc.bestAvgRank) acc.bestAvgRank = ri.avgRank;
          acc.totalAppearances += ri.appearanceCount;
          acc.totalDominance += ri.dominanceScore;
        }
        acc.videosInResults = rankCount;
        acc.avgDominance = rankCount > 0 ? acc.totalDominance / rankCount : 0;
      }
    }
    return Array.from(map.values());
  }, [videos, rankInfo]);

  const sorted = useMemo(() => {
    const arr = [...accounts];
    if (activeTab === "videos") arr.sort((a, b) => b.videoCount - a.videoCount);
    else if (activeTab === "views") arr.sort((a, b) => b.totalViews - a.totalViews);
    else if (activeTab === "rank") arr.sort((a, b) => b.totalDominance - a.totalDominance);
    else arr.sort((a, b) => b.avgER - a.avgER);
    return arr;
  }, [accounts, activeTab]);

  const pieData = useMemo(() => {
    return sorted.map((acc, i) => ({
      name: acc.accountName,
      value:
        activeTab === "videos" ? acc.videoCount
        : activeTab === "views" ? acc.totalViews
        : activeTab === "rank" ? acc.totalDominance
        : acc.avgER,
      color: COLORS[i % COLORS.length],
    }));
  }, [sorted, activeTab]);

  const totalValue = useMemo(() => pieData.reduce((s, d) => s + d.value, 0), [pieData]);

  if (accounts.length === 0) {
    return <p className="text-sm text-muted-foreground">アカウントデータがありません</p>;
  }

  const fmt = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return n.toString();
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: "views", label: "再生数" },
    { key: "videos", label: "投稿数" },
    { key: "er", label: "ER%" },
    ...(rankInfo ? [{ key: "rank" as TabKey, label: "上位表示力" }] : []),
  ];

  const unitLabel =
    activeTab === "videos" ? "本"
    : activeTab === "views" ? "再生"
    : activeTab === "rank" ? "pt"
    : "%";

  const maxDominance = useMemo(() => {
    if (activeTab !== "rank") return 0;
    return Math.max(...accounts.map(a => a.totalDominance), 1);
  }, [accounts, activeTab]);

  const MEDAL = ["🥇", "🥈", "🥉"];

  return (
    <div className="space-y-4">
      {/* タブ切り替え */}
      <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1 w-fit">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === tab.key
                ? "bg-white dark:bg-zinc-800 text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 円グラフ + アカウント一覧 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* 円グラフ */}
        <div className="relative">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%" cy="50%"
                innerRadius={68} outerRadius={105}
                startAngle={90} endAngle={-270}
                paddingAngle={1}
                animationBegin={0} animationDuration={700}
                labelLine={false}
                dataKey="value"
              >
                {pieData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => {
                  if (activeTab === "er") return [`${value}%`, name];
                  if (activeTab === "rank") {
                    const pct = totalValue > 0 ? ((value / totalValue) * 100).toFixed(1) : "0";
                    return [`${value.toFixed(1)}pt (${pct}%)`, name];
                  }
                  const pct = totalValue > 0 ? ((value / totalValue) * 100).toFixed(1) : "0";
                  return [`${fmt(value)}${unitLabel} (${pct}%)`, name];
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* 中心ラベル */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="text-2xl font-bold leading-none">{accounts.length}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">アカウント</div>
            </div>
          </div>
        </div>

        {/* アカウント一覧 */}
        <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
          {sorted.map((acc, i) => {
            if (activeTab === "rank") {
              // 15位以下は非表示
              if (i >= 15) return null;
              // 上位表示力タブ: ランキング表示
              const pct = totalValue > 0 ? ((acc.totalDominance / totalValue) * 100).toFixed(1) : "0";
              const barWidth = maxDominance > 0 ? (acc.totalDominance / maxDominance) * 100 : 0;
              return (
                <div key={acc.accountId} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-muted/40 transition-colors">
                  {/* ランキング番号/メダル */}
                  <div className="w-6 text-center shrink-0">
                    {i < 3 ? (
                      <span className="text-base">{MEDAL[i]}</span>
                    ) : (
                      <span className="text-xs font-bold text-muted-foreground">{i + 1}</span>
                    )}
                  </div>
                  {/* アバター */}
                  {acc.avatarUrl ? (
                    <img src={acc.avatarUrl} alt="" className="w-7 h-7 rounded-full shrink-0" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] shrink-0">?</div>
                  )}
                  {/* アカウント情報 */}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{acc.accountName}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-2 flex-wrap">
                      {acc.bestAvgRank < 999 && (
                        <span>平均{acc.bestAvgRank.toFixed(1)}位</span>
                      )}
                      <span>{acc.videosInResults}本 × {acc.totalAppearances}回出現</span>
                    </div>
                    {/* スコアバー */}
                    <div className="mt-1 flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${barWidth}%`,
                            backgroundColor: COLORS[i % COLORS.length],
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">
                        {acc.totalDominance.toFixed(1)}pt ({pct}%)
                      </span>
                    </div>
                  </div>
                </div>
              );
            }

            // 既存タブ: 再生数 / 投稿数 / ER%
            const val = activeTab === "videos" ? acc.videoCount : activeTab === "views" ? acc.totalViews : acc.avgER;
            const pct = activeTab !== "er" && totalValue > 0 ? ((val / totalValue) * 100).toFixed(1) : null;
            return (
              <div key={acc.accountId} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 transition-colors">
                {/* カラーインジケーター */}
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: COLORS[i % COLORS.length] }}
                />
                {/* アバター */}
                {acc.avatarUrl ? (
                  <img src={acc.avatarUrl} alt="" className="w-7 h-7 rounded-full shrink-0" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] shrink-0">?</div>
                )}
                {/* アカウント情報 */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{acc.accountName}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {activeTab === "views" && `${fmt(acc.totalViews)}再生`}
                    {activeTab === "videos" && `${acc.videoCount}本`}
                    {activeTab === "er" && `ER ${acc.avgER}%`}
                    {pct && <span className="ml-1 opacity-70">({pct}%)</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
