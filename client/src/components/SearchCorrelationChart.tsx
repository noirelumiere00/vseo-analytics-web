import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, RefreshCw, TrendingUp, TrendingDown, BarChart3, Search, Info, ChevronDown, ChevronUp, Play, ArrowUpDown } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface Props {
  jobId: number;
  keyword?: string | null;
}

interface CorrelationInfo {
  label: string;
  description: string;
  color: string;
  bgColor: string;
  borderColor: string;
  strength: number;
}

function getCorrelationInfo(r: number | null): CorrelationInfo {
  if (r === null) return {
    label: "データ不足", description: "相関を計算するためのデータが不足しています",
    color: "text-gray-500", bgColor: "bg-gray-50", borderColor: "border-gray-200", strength: 0,
  };
  const abs = Math.abs(r);
  if (abs >= 0.7) return {
    label: "強い相関", description: r > 0
      ? "Google検索トレンドとTikTok活動が強く連動しています。検索需要の変動がTikTokに大きく反映されるキーワードです。"
      : "Google検索トレンドとTikTok活動が強い逆相関を示しています。",
    color: "text-green-700", bgColor: "bg-green-50", borderColor: "border-green-200", strength: abs * 100,
  };
  if (abs >= 0.4) return {
    label: "中程度の相関", description: r > 0
      ? "検索トレンドとTikTok活動に一定の連動が見られます。トレンド上昇時に投稿を強化すると効果的です。"
      : "検索トレンドとTikTok活動にやや逆方向の動きがあります。",
    color: "text-blue-700", bgColor: "bg-blue-50", borderColor: "border-blue-200", strength: abs * 100,
  };
  if (abs >= 0.2) return {
    label: "弱い相関", description: "検索トレンドとTikTok活動の関係は弱く、他の要因がTikTokの動向を左右している可能性があります。",
    color: "text-orange-600", bgColor: "bg-orange-50", borderColor: "border-orange-200", strength: abs * 100,
  };
  return {
    label: "ほぼ無相関", description: "Google検索トレンドとTikTok活動は独立して動いています。TikTokのバズが検索行動に直結しにくいキーワードです。",
    color: "text-gray-600", bgColor: "bg-gray-50", borderColor: "border-gray-200", strength: abs * 100,
  };
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

type SortKey = "postedAt" | "viewCount";
type SortDir = "asc" | "desc";

export default function SearchCorrelationChart({ jobId, keyword }: Props) {
  const [metric, setMetric] = useState<"postCount" | "views">("postCount");
  const [showVideoList, setShowVideoList] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("viewCount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const { data, isLoading, error, refetch, isFetching } = trpc.analysis.getSearchCorrelation.useQuery(
    { jobId },
    { enabled: !!jobId, retry: 1, staleTime: 5 * 60 * 1000 },
  );

  const stats = useMemo(() => {
    if (!data) return null;
    const trends = data.trendsData;
    const vStats = data.videoStats;

    const trendPeak = trends.length > 0 ? Math.max(...trends.map(t => t.value)) : 0;
    const trendAvg = trends.length > 0 ? Math.round(trends.reduce((s, t) => s + t.value, 0) / trends.length) : 0;
    const trendLatest = trends.length > 0 ? trends[trends.length - 1].value : 0;
    const trendPrev = trends.length > 1 ? trends[trends.length - 2].value : trendLatest;
    const trendDirection = trendLatest > trendPrev ? "up" : trendLatest < trendPrev ? "down" : "flat";

    const totalPosts = vStats.reduce((s, v) => s + v.postCount, 0);
    const totalViews = vStats.reduce((s, v) => s + v.totalViews, 0);
    const daysWithData = vStats.length;
    const avgViewsPerPost = totalPosts > 0 ? Math.round(totalViews / totalPosts) : 0;
    const avgPostsPerDay = daysWithData > 0 ? (totalPosts / daysWithData).toFixed(1) : "0";

    return { trendPeak, trendAvg, trendLatest, trendDirection, totalPosts, totalViews, daysWithData, trendDays: trends.length, avgViewsPerPost, avgPostsPerDay };
  }, [data]);

  // テーブルソート
  const sortedVideos = useMemo(() => {
    if (!data?.individualVideos) return [];
    return [...data.individualVideos].sort((a: any, b: any) => {
      const mul = sortDir === "asc" ? 1 : -1;
      if (sortKey === "postedAt") return mul * a.postedAt.localeCompare(b.postedAt);
      return mul * (a.viewCount - b.viewCount);
    });
  }, [data?.individualVideos, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "viewCount" ? "desc" : "asc");
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-3">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <div className="text-center">
          <p className="text-sm font-medium">Google Trendsデータを取得中...</p>
          <p className="text-xs text-muted-foreground mt-1">初回取得は最大30秒かかる場合があります</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-10">
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 max-w-md text-center space-y-2">
          <p className="text-sm text-red-600 font-medium">データ取得に失敗しました</p>
          <p className="text-xs text-red-500">{error.message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-2">
            <RefreshCw className="h-4 w-4 mr-1" />
            再試行
          </Button>
        </div>
      </div>
    );
  }

  if (!data || (data.trendsData.length === 0 && data.videoStats.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center py-10 space-y-2">
        <Search className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm font-medium text-muted-foreground">表示可能なデータがありません</p>
        <p className="text-xs text-muted-foreground">
          Google Trendsデータまたは投稿データが見つかりませんでした。分析完了後に再度お試しください。
        </p>
      </div>
    );
  }

  // 日付でデータを統合
  const dateMap = new Map<string, { date: string; trends: number | null; tiktok: number | null }>();
  for (const t of data.trendsData) {
    dateMap.set(t.date, { date: t.date, trends: t.value, tiktok: null });
  }
  for (const v of data.videoStats) {
    const existing = dateMap.get(v.date);
    const tiktokValue = metric === "postCount" ? v.postCount : v.totalViews;
    if (existing) {
      existing.tiktok = tiktokValue;
    } else {
      dateMap.set(v.date, { date: v.date, trends: null, tiktok: tiktokValue });
    }
  }

  const chartData = [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  const correlation = metric === "postCount" ? data.correlationPostCount : data.correlationViews;
  const corrInfo = getCorrelationInfo(correlation);
  const otherCorrelation = metric === "postCount" ? data.correlationViews : data.correlationPostCount;

  const tiktokLabel = metric === "postCount" ? "TikTok投稿数" : "TikTok再生数";

  return (
    <div className="space-y-4 pt-2">
      {/* 1. インサイト（最初に結論を見せる） */}
      {correlation !== null && (
        <div className={`p-3 rounded-lg border ${corrInfo.bgColor} ${corrInfo.borderColor}`}>
          <div className="flex gap-2">
            <Info className={`h-4 w-4 mt-0.5 shrink-0 ${corrInfo.color}`} />
            <div className="space-y-1">
              <p className={`text-sm font-medium ${corrInfo.color}`}>{corrInfo.label}（r = {correlation}）</p>
              <p className="text-xs text-muted-foreground">{corrInfo.description}</p>
              {otherCorrelation !== null && (
                <p className="text-xs text-muted-foreground">
                  比較: {metric === "postCount" ? "再生数" : "投稿数"}との相関は r = {otherCorrelation}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. サマリーカード 3列（平均再生数/投稿を追加） */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3 border rounded-lg space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-blue-600">
              <Search className="h-3.5 w-3.5" />
              Google Trends
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{stats.trendLatest}</span>
              <span className="text-xs text-muted-foreground">/ 100</span>
              {stats.trendDirection === "up" && <TrendingUp className="h-4 w-4 text-green-500" />}
              {stats.trendDirection === "down" && <TrendingDown className="h-4 w-4 text-red-500" />}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>平均 {stats.trendAvg}</span>
              <span>最高 {stats.trendPeak}</span>
            </div>
          </div>

          <div className="p-3 border rounded-lg space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-red-500">
              <BarChart3 className="h-3.5 w-3.5" />
              TikTokデータ
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{formatNumber(stats.totalPosts)}</span>
              <span className="text-xs text-muted-foreground">投稿</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>平均 {formatNumber(stats.avgViewsPerPost)}再生/本</span>
              <span>{stats.avgPostsPerDay}本/日</span>
            </div>
          </div>

          <div className={`p-3 border rounded-lg space-y-1.5 ${corrInfo.bgColor} ${corrInfo.borderColor}`}>
            <div className={`flex items-center gap-1.5 text-xs font-medium ${corrInfo.color}`}>
              <TrendingUp className="h-3.5 w-3.5" />
              相関度
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{correlation !== null ? correlation : "—"}</span>
              <Badge variant="outline" className={`text-xs ${corrInfo.color} ${corrInfo.borderColor}`}>
                {corrInfo.label}
              </Badge>
            </div>
            <Progress value={corrInfo.strength} className="h-1.5" />
          </div>
        </div>
      )}

      {/* 3. メトリック切り替え + リフレッシュ */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">比較指標:</span>
          <div className="flex rounded-lg border overflow-hidden">
            <button
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                metric === "postCount"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/30 hover:bg-muted text-muted-foreground"
              }`}
              onClick={() => setMetric("postCount")}
            >
              投稿数
            </button>
            <button
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-l ${
                metric === "views"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/30 hover:bg-muted text-muted-foreground"
              }`}
              onClick={() => setMetric("views")}
            >
              再生数
            </button>
          </div>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {metric === "postCount" ? "トレンドと投稿量の関係" : "トレンドと視聴者の関心"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          更新
        </Button>
      </div>

      {/* 4. チャート */}
      <div className="border rounded-lg p-3 bg-card">
        <div className="flex items-center justify-center gap-4 sm:gap-6 mb-3 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-[#ff6b6b] rounded" />
            <span className="text-muted-foreground">{tiktokLabel}（左軸）</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-[#4dabf7] rounded" />
            <span className="text-muted-foreground">Google検索トレンド（右軸 0-100）</span>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickFormatter={(v: string) => {
                const [, m, d] = v.split("-");
                return Number(d) === 1 ? `${Number(m)}月` : `${Number(m)}/${Number(d)}`;
              }}
              interval={Math.max(0, Math.ceil(chartData.length / 12) - 1)}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11 }}
              width={45}
              tickFormatter={(v: number) => formatNumber(v)}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 100]}
              tick={{ fontSize: 11 }}
              width={35}
            />
            <Tooltip
              contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
              labelFormatter={(label: string) => {
                const [y, m, d] = label.split("-");
                return `${y}年${Number(m)}月${Number(d)}日`;
              }}
              formatter={(value: any, name: string) => {
                if (value === null || value === undefined) return ["—", name];
                if (name === "Google検索トレンド") return [`${value} / 100`, name];
                if (metric === "views") return [Number(value).toLocaleString() + " 回", tiktokLabel];
                return [`${value} 件`, tiktokLabel];
              }}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="tiktok"
              name={tiktokLabel}
              stroke="#ff6b6b"
              strokeWidth={2}
              dot={false}
              connectNulls
              activeDot={{ r: 4, strokeWidth: 2 }}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="trends"
              name="Google検索トレンド"
              stroke="#4dabf7"
              strokeWidth={2}
              dot={false}
              connectNulls
              activeDot={{ r: 4, strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 5. 相関度の目安（チャート直下） */}
      <div className="grid grid-cols-4 gap-1.5 text-center">
        {[
          { range: "0.7+", label: "強い", dots: "●●●", color: "text-green-600 bg-green-50" },
          { range: "0.4–0.7", label: "中程度", dots: "●●○", color: "text-blue-600 bg-blue-50" },
          { range: "0.2–0.4", label: "弱い", dots: "●○○", color: "text-orange-500 bg-orange-50" },
          { range: "< 0.2", label: "無相関", dots: "○○○", color: "text-gray-400 bg-gray-50" },
        ].map((g) => (
          <div key={g.range} className={`py-1.5 px-1 rounded text-xs ${g.color}`}>
            <div className="font-medium">{g.dots}</div>
            <div>{g.label}</div>
            <div className="text-[10px] opacity-70">{g.range}</div>
          </div>
        ))}
      </div>

      {/* 6. 動画一覧（ソート付き・4列） */}
      {data.individualVideos && data.individualVideos.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors"
            onClick={() => setShowVideoList(!showVideoList)}
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <Play className="h-4 w-4 text-red-500" />
              対象動画一覧
              <Badge variant="secondary" className="text-xs">
                {data.individualVideos.length}/{data.totalVideoCount}本
              </Badge>
            </div>
            {showVideoList
              ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
              : <ChevronDown className="h-4 w-4 text-muted-foreground" />
            }
          </button>
          {showVideoList && (
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                  <tr>
                    <th
                      className="text-left px-3 py-2 font-medium cursor-pointer hover:text-foreground select-none"
                      onClick={() => toggleSort("postedAt")}
                    >
                      <span className="inline-flex items-center gap-1">
                        投稿日
                        {sortKey === "postedAt" && (
                          <ArrowUpDown className="h-3 w-3" />
                        )}
                      </span>
                    </th>
                    <th className="text-left px-3 py-2 font-medium">アカウント</th>
                    <th className="text-left px-3 py-2 font-medium">タイトル</th>
                    <th
                      className="text-right px-3 py-2 font-medium cursor-pointer hover:text-foreground select-none"
                      onClick={() => toggleSort("viewCount")}
                    >
                      <span className="inline-flex items-center gap-1">
                        再生数
                        {sortKey === "viewCount" && (
                          <ArrowUpDown className="h-3 w-3" />
                        )}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedVideos.map((v: any) => (
                    <tr key={v.videoId} className="border-t hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {(() => {
                          const [, m, d] = v.postedAt.split("-");
                          return `${Number(m)}/${Number(d)}`;
                        })()}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground truncate max-w-[120px]">
                        @{v.accountName || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <a
                          href={`https://www.tiktok.com/@${v.accountName || "_"}/video/${v.videoId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline line-clamp-1"
                        >
                          {v.title || v.videoId}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(v.viewCount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
