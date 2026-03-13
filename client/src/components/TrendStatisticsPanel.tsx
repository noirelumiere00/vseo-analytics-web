import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, ReferenceLine, ScatterChart, Scatter, ZAxis, CartesianGrid,
} from "recharts";

// ---- Types ----

interface DescriptiveStats {
  min: number; max: number; mean: number; median: number; stdDev: number; p25: number; p75: number;
}

interface VideoRef {
  videoId: string;
  authorUniqueId: string;
}

interface ExtremeVideos {
  [key: string]: { max?: VideoRef; min?: VideoRef };
}

interface TrendStatistics {
  totalVideos: number;
  adCount: number;
  dateRange: { min: number; max: number };
  engagementStats: {
    playCount: DescriptiveStats;
    er: DescriptiveStats;
    likeRate: DescriptiveStats;
    saveRate: DescriptiveStats;
    commentRate: DescriptiveStats;
    shareRate: DescriptiveStats;
  };
  extremeVideos?: ExtremeVideos;
  followerErScatter: Array<{
    followerCount: number; er: number; playCount: number;
    tier: string; isHighPerformer: boolean; daysSincePosted: number;
  }>;
  followerTierSummary: Array<{ tier: string; count: number; avgER: number; medianER: number }>;
  hashtagPerformance: Array<{
    tag: string; videoCount: number; avgER: number; medianER: number;
    avgPlayCount: number; avgNormalizedPlays: number; isUnderrated: boolean;
    totalPostCount?: number;
  }>;
  durationBands: Array<{
    label: string; videoCount: number; avgER: number; medianER: number;
    avgPlayCount: number; isOptimal: boolean;
  }>;
  postingTimeGrid: Array<{
    day: number; hour: number; videoCount: number; avgER: number; avgPlayCount: number;
  }>;
  bestTimeSlots: Array<{ day: number; hour: number; avgER: number; videoCount: number }>;
  playCountDistribution: Array<{ label: string; count: number; percentage: number; avgER: number }>;
  performanceClassification: {
    trending: ClassBucket;
    average: ClassBucket;
    underperforming: ClassBucket;
  };
  queryFreshness?: Array<{
    query: string;
    totalVideos: number;
    buckets: { within2w: number; within1m: number; within2m: number; within3m: number; within6m: number; older: number };
    freshnessScore: number;
    medianAgeDays: number;
    avgER: number;
    avgPlayCount: number;
  }>;
  adInsight?: {
    adRate: number;
    adCount: number;
    organicCount: number;
    perQuery: Array<{ query: string; adCount: number; totalCount: number; adRate: number }>;
    topAdHashtags: Array<{ tag: string; count: number; avgER: number; avgPlayCount: number }>;
    comparison: {
      ad: { avgER: number; avgPlayCount: number; medianAgeDays: number };
      organic: { avgER: number; avgPlayCount: number; medianAgeDays: number };
    };
  };
  seoMetaKeywords?: {
    videos: Array<{ videoId: string; authorUniqueId: string; keywords: string[] }>;
    keywordRanking: Array<{ keyword: string; count: number; videoIds: string[] }>;
  };
}

interface ClassBucket {
  count: number; avgER: number; avgPlayCount: number; avgNormalizedPlays: number; topTags: string[];
}

// ---- Shared MetricToggle ----

function MetricToggle({ value, onChange }: { value: "er" | "plays"; onChange: (v: "er" | "plays") => void }) {
  return (
    <div className="flex gap-1 p-0.5 bg-muted rounded-lg w-fit">
      <button
        onClick={() => onChange("er")}
        className={`px-3 py-1 text-xs rounded-md transition-colors ${value === "er" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
      >
        平均ER
      </button>
      <button
        onClick={() => onChange("plays")}
        className={`px-3 py-1 text-xs rounded-md transition-colors ${value === "plays" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
      >
        平均再生数
      </button>
    </div>
  );
}

// ---- Constants ----

const TIER_COLORS: Record<string, string> = {
  nano: "#10b981", micro: "#6366f1", mid: "#f59e0b", macro: "#ef4444", mega: "#8b5cf6",
};
const TIER_LABELS: Record<string, string> = {
  nano: "ナノ (<10K)", micro: "マイクロ (10K-100K)", mid: "ミドル (100K-500K)",
  macro: "マクロ (500K-1M)", mega: "メガ (1M+)",
};
const DAYS = ["日", "月", "火", "水", "木", "金", "土"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

// ---- Main Component ----

export default function TrendStatisticsPanel({ statistics }: { statistics: TrendStatistics }) {
  if (!statistics || statistics.totalVideos === 0) return null;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">統計分析</h2>
      <PerformanceClassification data={statistics.performanceClassification} total={statistics.totalVideos} />
      <EngagementStatsTable stats={statistics.engagementStats} extremeVideos={statistics.extremeVideos} />
      <FollowerErScatter data={statistics.followerErScatter} tiers={statistics.followerTierSummary} />
      {statistics.queryFreshness && statistics.queryFreshness.length > 0 && (
        <QueryFreshnessChart data={statistics.queryFreshness} />
      )}
      {statistics.adInsight && (
        <AdInsightSection data={statistics.adInsight} />
      )}
      {statistics.seoMetaKeywords && statistics.seoMetaKeywords.keywordRanking.length > 0 && (
        <SeoMetaKeywordsSection data={statistics.seoMetaKeywords} />
      )}
      <HashtagPerformanceChart data={statistics.hashtagPerformance} globalMedianER={statistics.engagementStats.er.median} />
      <DurationBandsChart data={statistics.durationBands} globalMedianER={statistics.engagementStats.er.median} />
      <PostingTimeHeatmap grid={statistics.postingTimeGrid} bestSlots={statistics.bestTimeSlots} />
      <PlayCountDistribution data={statistics.playCountDistribution} />
    </div>
  );
}

// ---- 1. パフォーマンス分類カード ----

function PerformanceClassification({ data, total }: { data: TrendStatistics["performanceClassification"]; total: number }) {
  const items = [
    { key: "trending" as const, label: "トレンド（上位20%）", color: "border-green-500 bg-green-50 dark:bg-green-950/30", textColor: "text-green-700 dark:text-green-400" },
    { key: "average" as const, label: "平均的（中間60%）", color: "border-gray-300 bg-gray-50 dark:bg-gray-900/30", textColor: "text-gray-700 dark:text-gray-400" },
    { key: "underperforming" as const, label: "低パフォーマンス（下位20%）", color: "border-red-500 bg-red-50 dark:bg-red-950/30", textColor: "text-red-700 dark:text-red-400" },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {items.map(({ key, label, color, textColor }) => {
        const bucket = data[key];
        return (
          <Card key={key} className={`border-l-4 ${color}`}>
            <CardHeader className="pb-2">
              <CardTitle className={`text-sm ${textColor}`}>{label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">動画数</span>
                <span className="font-medium">{bucket.count}本 ({total > 0 ? Math.round((bucket.count / total) * 100) : 0}%)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">平均ER</span>
                <span className="font-medium">{bucket.avgER}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">平均再生数</span>
                <span className="font-medium">{formatCount(bucket.avgPlayCount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">日次正規化再生</span>
                <span className="font-medium">{formatCount(bucket.avgNormalizedPlays)}</span>
              </div>
              {bucket.topTags.length > 0 && (
                <div className="pt-1">
                  <span className="text-xs text-muted-foreground">頻出タグ: </span>
                  <span className="text-xs">{bucket.topTags.map(t => `#${t}`).join(" ")}</span>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ---- 2. エンゲージメント基本統計テーブル ----

function EngagementStatsTable({ stats, extremeVideos }: {
  stats: TrendStatistics["engagementStats"];
  extremeVideos?: ExtremeVideos;
}) {
  // 率系指標: 小数2桁固定 (例: "5.23%"), 再生数: 人間可読な略記 (例: "5万")
  const fmtRate = (v: number) => `${Number(v.toFixed(2))}%`;

  const rows = [
    { label: "再生数", key: "playCount", data: stats.playCount, fmt: formatCount },
    { label: "ER", key: "er", data: stats.er, fmt: fmtRate },
    { label: "いいね率", key: "likeRate", data: stats.likeRate, fmt: fmtRate },
    { label: "保存率", key: "saveRate", data: stats.saveRate, fmt: fmtRate },
    { label: "コメント率", key: "commentRate", data: stats.commentRate, fmt: fmtRate },
    { label: "シェア率", key: "shareRate", data: stats.shareRate, fmt: fmtRate },
  ];

  const videoLink = (ref?: VideoRef) =>
    ref && ref.videoId && ref.authorUniqueId
      ? `https://www.tiktok.com/@${ref.authorUniqueId}/video/${ref.videoId}`
      : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">エンゲージメント基本統計</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 pr-3 font-medium text-muted-foreground">指標</th>
                <th className="pb-2 pr-3 font-medium text-muted-foreground text-right">最小</th>
                <th className="pb-2 pr-3 font-medium text-muted-foreground text-right">P25</th>
                <th className="pb-2 pr-3 font-medium text-muted-foreground text-right">中央値</th>
                <th className="pb-2 pr-3 font-medium text-muted-foreground text-right">平均</th>
                <th className="pb-2 pr-3 font-medium text-muted-foreground text-right">P75</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">最大</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ label, key, data, fmt }) => {
                const minLink = videoLink(extremeVideos?.[key]?.min);
                const maxLink = videoLink(extremeVideos?.[key]?.max);
                return (
                  <tr key={label} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{label}</td>
                    <td className="py-2 pr-3 text-right">
                      {minLink ? (
                        <a href={minLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline" title="この動画をTikTokで開く">
                          {fmt(data.min)}
                          <svg className="w-2.5 h-2.5 opacity-60 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        </a>
                      ) : fmt(data.min)}
                    </td>
                    <td className="py-2 pr-3 text-right">{fmt(data.p25)}</td>
                    <td className="py-2 pr-3 text-right font-medium">{fmt(data.median)}</td>
                    <td className="py-2 pr-3 text-right">{fmt(data.mean)}</td>
                    <td className="py-2 pr-3 text-right">{fmt(data.p75)}</td>
                    <td className="py-2 text-right">
                      {maxLink ? (
                        <a href={maxLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline" title="この動画をTikTokで開く">
                          {fmt(data.max)}
                          <svg className="w-2.5 h-2.5 opacity-60 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        </a>
                      ) : fmt(data.max)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- 3. フォロワー×ER散布図 ----

function FollowerErScatter({ data, tiers }: {
  data: TrendStatistics["followerErScatter"];
  tiers: TrendStatistics["followerTierSummary"];
}) {
  if (data.length === 0) return null;

  // log(0) = -Infinity でチャートが壊れるため、followerCount=0 を除外
  const validData = data.filter(d => d.followerCount > 0 && d.er >= 0);
  if (validData.length === 0) return null;

  const tierGroups = new Map<string, typeof validData>();
  for (const d of validData) {
    if (!tierGroups.has(d.tier)) tierGroups.set(d.tier, []);
    tierGroups.get(d.tier)!.push(d);
  }

  // log scale 用の domain を明示的に計算（auto が効かないケース対策）
  const followerValues = validData.map(d => d.followerCount);
  const minFollower = Math.max(1, Math.min(...followerValues));
  const maxFollower = Math.max(...followerValues);
  const erValues = validData.map(d => d.er);
  const maxER = Math.max(...erValues);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">フォロワー数 × ER 散布図</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="followerCount"
              type="number"
              scale="log"
              domain={[minFollower, maxFollower]}
              tick={{ fontSize: 11 }}
              tickFormatter={formatCount}
              name="フォロワー"
              allowDataOverflow={false}
            />
            <YAxis
              dataKey="er"
              type="number"
              domain={[0, Math.ceil(maxER * 1.1)]}
              tick={{ fontSize: 11 }}
              tickFormatter={v => `${v}%`}
              name="ER"
            />
            <ZAxis dataKey="playCount" range={[30, 200]} name="再生数" />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-background border rounded-lg shadow-lg p-2 text-xs space-y-0.5">
                    <div>フォロワー: {formatCount(d.followerCount)}</div>
                    <div>ER: {d.er}%</div>
                    <div>再生数: {formatCount(d.playCount)}</div>
                    <div>経過日数: {d.daysSincePosted}日</div>
                    <div>ティア: {TIER_LABELS[d.tier] || d.tier}</div>
                    {d.isHighPerformer && <div className="text-green-600 font-medium">高パフォーマー</div>}
                  </div>
                );
              }}
            />
            {(["nano", "micro", "mid", "macro", "mega"] as const).map(tier => {
              const points = tierGroups.get(tier);
              if (!points || points.length === 0) return null;
              return (
                <Scatter
                  key={tier}
                  name={TIER_LABELS[tier] || tier}
                  data={points}
                  fill={TIER_COLORS[tier]}
                  opacity={0.7}
                />
              );
            })}
          </ScatterChart>
        </ResponsiveContainer>
        {/* ティアサマリー */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3">
          {tiers.map(t => (
            <div key={t.tier} className="p-2 rounded bg-muted/50 text-center text-xs">
              <div className="flex items-center justify-center gap-1 mb-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: TIER_COLORS[t.tier] }} />
                <span className="font-medium">{TIER_LABELS[t.tier]?.split(" ")[0] || t.tier}</span>
              </div>
              <div className="text-muted-foreground">{t.count}本</div>
              <div className="text-muted-foreground">中央値ER {t.medianER}%</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---- 3.5 クエリ別鮮度分析 ----

const FRESHNESS_BUCKETS = [
  { key: "within2w" as const, label: "2週間以内", shortLabel: "2W", color: "#059669" },
  { key: "within1m" as const, label: "1ヶ月以内", shortLabel: "1M", color: "#10b981" },
  { key: "within2m" as const, label: "2ヶ月以内", shortLabel: "2M", color: "#84cc16" },
  { key: "within3m" as const, label: "3ヶ月以内", shortLabel: "3M", color: "#eab308" },
  { key: "within6m" as const, label: "6ヶ月以内", shortLabel: "6M", color: "#f97316" },
  { key: "older" as const, label: "6ヶ月超", shortLabel: "古", color: "#d1d5db" },
];

interface FreshnessSignal {
  text: string;
  subtext: string;
  badgeClass: string;
  gaugeColor: string;
  borderClass: string;
  glowClass: string;
  icon: string;
}

function getFreshnessSignal(score: number): FreshnessSignal {
  if (score >= 80) return {
    text: "急上昇",
    subtext: "今まさに需要が集中",
    badgeClass: "bg-red-500 text-white",
    gaugeColor: "#ef4444",
    borderClass: "border-l-red-500",
    glowClass: "shadow-red-100 dark:shadow-red-950/40",
    icon: "🔥",
  };
  if (score >= 60) return {
    text: "トレンド中",
    subtext: "活発な投稿が続いている",
    badgeClass: "bg-orange-500 text-white",
    gaugeColor: "#f97316",
    borderClass: "border-l-orange-500",
    glowClass: "shadow-orange-100 dark:shadow-orange-950/30",
    icon: "📈",
  };
  if (score >= 35) return {
    text: "安定需要",
    subtext: "継続的な関心がある",
    badgeClass: "bg-blue-500 text-white",
    gaugeColor: "#3b82f6",
    borderClass: "border-l-blue-500",
    glowClass: "",
    icon: "〜",
  };
  return {
    text: "低調・定番",
    subtext: "新規投稿が少ない",
    badgeClass: "bg-gray-400 text-white dark:bg-gray-600",
    gaugeColor: "#9ca3af",
    borderClass: "border-l-gray-400",
    glowClass: "",
    icon: "↓",
  };
}

function FreshnessRing({ score, color }: { score: number; color: string }) {
  // Arc gauge: draws a 270-degree arc (from 225deg to -45deg, i.e. bottom-left to bottom-right)
  const size = 72;
  const cx = size / 2;
  const cy = size / 2;
  const r = 28;
  const strokeW = 6;
  // 270-degree sweep: start at 135deg (bottom-left), sweep clockwise
  const startAngleDeg = 135;
  const sweepDeg = 270;
  const endAngleDeg = startAngleDeg + sweepDeg;
  const toRad = (d: number) => (d * Math.PI) / 180;

  // Full track arc path
  const trackStart = {
    x: cx + r * Math.cos(toRad(startAngleDeg)),
    y: cy + r * Math.sin(toRad(startAngleDeg)),
  };
  const trackEnd = {
    x: cx + r * Math.cos(toRad(endAngleDeg)),
    y: cy + r * Math.sin(toRad(endAngleDeg)),
  };

  // Progress arc path (clamped)
  const clampedScore = Math.max(0, Math.min(100, score));
  const progressSweep = (clampedScore / 100) * sweepDeg;
  const progressEndDeg = startAngleDeg + progressSweep;
  const progressEnd = {
    x: cx + r * Math.cos(toRad(progressEndDeg)),
    y: cy + r * Math.sin(toRad(progressEndDeg)),
  };
  const largeArcTrack = sweepDeg > 180 ? 1 : 0;
  const largeArcProgress = progressSweep > 180 ? 1 : 0;

  const trackPath = `M ${trackStart.x} ${trackStart.y} A ${r} ${r} 0 ${largeArcTrack} 1 ${trackEnd.x} ${trackEnd.y}`;
  const progressPath = clampedScore > 0
    ? `M ${trackStart.x} ${trackStart.y} A ${r} ${r} 0 ${largeArcProgress} 1 ${progressEnd.x} ${progressEnd.y}`
    : "";

  return (
    <div className="relative flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ overflow: "visible" }}>
        {/* Track */}
        <path
          d={trackPath}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeW}
          strokeLinecap="round"
          className="text-muted-foreground/20"
        />
        {/* Progress */}
        {progressPath && (
          <path
            d={progressPath}
            fill="none"
            stroke={color}
            strokeWidth={strokeW}
            strokeLinecap="round"
          />
        )}
      </svg>
      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ paddingBottom: 6 }}>
        <span className="text-base font-bold leading-none tabular-nums" style={{ color }}>{score}</span>
        <span className="text-[9px] text-muted-foreground leading-none mt-0.5">/ 100</span>
      </div>
    </div>
  );
}

function FreshnessDistributionBar({ buckets, totalVideos }: {
  buckets: { within2w: number; within1m: number; within2m: number; within3m: number; within6m: number; older: number };
  totalVideos: number;
}) {
  if (totalVideos === 0) return null;

  // Only show buckets with data; compute percentages
  const segments = FRESHNESS_BUCKETS.map(b => ({
    ...b,
    count: buckets[b.key],
    pct: totalVideos > 0 ? (buckets[b.key] / totalVideos) * 100 : 0,
  })).filter(s => s.count > 0);

  // "Recent" = within2w + within1m combined for the highlight label
  const recentCount = (buckets.within2w ?? 0) + (buckets.within1m ?? 0);
  const recentPct = totalVideos > 0 ? Math.round((recentCount / totalVideos) * 100) : 0;

  return (
    <div className="space-y-1.5">
      {/* Label row */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">投稿時期の分布</span>
        {recentPct > 0 && (
          <span className="text-[10px] font-semibold" style={{ color: "#059669" }}>
            直近1ヶ月 {recentPct}%
          </span>
        )}
      </div>
      {/* Bar */}
      <div className="flex w-full h-2 rounded-full overflow-hidden gap-px">
        {segments.map(s => (
          <div
            key={s.key}
            className="h-full transition-all"
            style={{ width: `${s.pct}%`, backgroundColor: s.color, minWidth: 3 }}
            title={`${s.label}: ${s.count}本 (${Math.round(s.pct)}%)`}
          />
        ))}
      </div>
      {/* Compact legend: only non-zero buckets */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {segments.map(s => (
          <span key={s.key} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
            <span className="font-medium" style={{ color: s.color }}>{s.shortLabel}</span>
            <span>{Math.round(s.pct)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function QueryFreshnessChart({ data }: { data: NonNullable<TrendStatistics["queryFreshness"]> }) {
  const sorted = [...data].sort((a, b) => b.freshnessScore - a.freshnessScore);

  // Rank context: hottest item gets a crown indicator
  const maxScore = sorted[0]?.freshnessScore ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base">クエリ別 需要トレンド分析</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              鮮度スコアが高い = 直近の投稿が多い = 今まさに需要がある
            </p>
          </div>
          {/* Legend pills */}
          <div className="flex flex-wrap gap-1.5 items-center">
            {[
              { label: "急上昇", color: "bg-red-500" },
              { label: "トレンド中", color: "bg-orange-500" },
              { label: "安定需要", color: "bg-blue-500" },
              { label: "低調・定番", color: "bg-gray-400" },
            ].map(l => (
              <span key={l.label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className={`w-2 h-2 rounded-sm ${l.color}`} />
                {l.label}
              </span>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((d, idx) => {
            const signal = getFreshnessSignal(d.freshnessScore);
            const isTop = d.freshnessScore === maxScore && idx === 0;

            return (
              <div
                key={d.query}
                className={`
                  relative border-l-[3px] rounded-r-xl rounded-l-sm border border-border bg-card
                  p-3.5 flex flex-col gap-3
                  shadow-sm ${signal.glowClass}
                  ${signal.borderClass}
                  ${isTop ? "ring-1 ring-red-200 dark:ring-red-900/50" : ""}
                `}
              >
                {/* Top ribbon for rank-1 */}
                {isTop && (
                  <div className="absolute top-0 right-0 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-bl-lg rounded-tr-xl leading-none">
                    TOP
                  </div>
                )}

                {/* ── Row 1: Query name + demand badge ── */}
                <div className="flex items-start justify-between gap-2 pr-6">
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground leading-none mb-0.5">#{idx + 1}</p>
                    <h3 className="text-sm font-bold leading-snug break-words">{d.query}</h3>
                  </div>
                  <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold leading-tight ${signal.badgeClass}`}>
                    {signal.text}
                  </span>
                </div>

                {/* ── Row 2: Ring gauge + metrics ── */}
                <div className="flex items-center gap-3">
                  {/* Arc gauge */}
                  <FreshnessRing score={d.freshnessScore} color={signal.gaugeColor} />

                  {/* Metric grid: 2x2 */}
                  <div className="flex-1 grid grid-cols-2 gap-x-3 gap-y-2">
                    <div>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wide leading-none mb-0.5">動画数</p>
                      <p className="text-xs font-semibold tabular-nums">{d.totalVideos}<span className="font-normal text-muted-foreground">本</span></p>
                    </div>
                    <div>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wide leading-none mb-0.5">中央値経過</p>
                      <p className="text-xs font-semibold tabular-nums">{Math.round(d.medianAgeDays)}<span className="font-normal text-muted-foreground">日</span></p>
                    </div>
                    <div>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wide leading-none mb-0.5">平均 ER</p>
                      <p className="text-xs font-semibold tabular-nums">{d.avgER}<span className="font-normal text-muted-foreground">%</span></p>
                    </div>
                    <div>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wide leading-none mb-0.5">平均再生</p>
                      <p className="text-xs font-semibold tabular-nums">{formatCount(d.avgPlayCount)}</p>
                    </div>
                  </div>
                </div>

                {/* ── Row 3: Demand signal subtext ── */}
                <p className="text-[10px] text-muted-foreground italic leading-snug -mt-1">
                  {signal.icon} {signal.subtext}
                </p>

                {/* ── Row 4: Time distribution bar ── */}
                <FreshnessDistributionBar buckets={d.buckets} totalVideos={d.totalVideos} />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ---- 3.7 PR/Ad動画インサイト ----

function AdInsightSection({ data }: { data: NonNullable<TrendStatistics["adInsight"]> }) {
  const { comparison } = data;
  const adRateNum = data.adRate;
  const total = data.adCount + data.organicCount;

  // ---- Monetization tier ----
  type AdTier = "hot" | "active" | "moderate" | "low" | "none";
  const tier: AdTier =
    adRateNum >= 30 ? "hot"
    : adRateNum >= 15 ? "active"
    : adRateNum >= 5  ? "moderate"
    : adRateNum > 0   ? "low"
    : "none";

  const tierConfig: Record<AdTier, {
    verdict: string;
    sub: string;
    dot: string;
    heroBg: string;
    heroText: string;
    heroSubText: string;
    barFill: string;
  }> = {
    hot: {
      verdict: "広告主の投資が非常に活発",
      sub: "収益化チャンス大 — ブランドがこの市場に積極投資中",
      dot: "bg-amber-500",
      heroBg: "bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/40 dark:to-yellow-950/30 border-amber-300 dark:border-amber-600",
      heroText: "text-amber-700 dark:text-amber-300",
      heroSubText: "text-amber-600/80 dark:text-amber-400/80",
      barFill: "bg-gradient-to-r from-amber-400 to-yellow-400 dark:from-amber-500 dark:to-yellow-500",
    },
    active: {
      verdict: "広告主の投資が活発なジャンル",
      sub: "スポンサー案件を狙えるニッチ",
      dot: "bg-amber-400",
      heroBg: "bg-amber-50/70 dark:bg-amber-950/25 border-amber-200 dark:border-amber-700",
      heroText: "text-amber-700 dark:text-amber-300",
      heroSubText: "text-amber-600/70 dark:text-amber-400/70",
      barFill: "bg-gradient-to-r from-amber-400 to-amber-500 dark:from-amber-500 dark:to-amber-600",
    },
    moderate: {
      verdict: "一定のPR需要あり",
      sub: "新興市場または特定ブランドが参入中",
      dot: "bg-blue-400",
      heroBg: "bg-blue-50/60 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800",
      heroText: "text-blue-700 dark:text-blue-300",
      heroSubText: "text-blue-600/70 dark:text-blue-400/70",
      barFill: "bg-gradient-to-r from-blue-400 to-blue-500 dark:from-blue-500 dark:to-blue-600",
    },
    low: {
      verdict: "PR少数 — オーガニック中心",
      sub: "クリエイター主導の市場。広告参入余地あり",
      dot: "bg-gray-400",
      heroBg: "bg-gray-50 dark:bg-gray-900/30 border-gray-200 dark:border-gray-700",
      heroText: "text-gray-700 dark:text-gray-300",
      heroSubText: "text-gray-500 dark:text-gray-500",
      barFill: "bg-gray-400 dark:bg-gray-500",
    },
    none: {
      verdict: "PR動画なし — 完全オーガニック",
      sub: "ブランド未参入。先行者優位を狙える可能性",
      dot: "bg-gray-300",
      heroBg: "bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-700",
      heroText: "text-gray-600 dark:text-gray-400",
      heroSubText: "text-gray-400 dark:text-gray-600",
      barFill: "bg-gray-300",
    },
  };

  const cfg = tierConfig[tier];

  // ---- PR vs Organic diff values ----
  const erDiff = comparison.ad.avgER - comparison.organic.avgER;
  const erSign = erDiff >= 0 ? "+" : "";
  const erDiffStr = `${erSign}${round2Fmt(erDiff)}%`;
  const erDiffColor = erDiff >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400";

  const playDiff = comparison.ad.avgPlayCount - comparison.organic.avgPlayCount;
  const playDiffColor = playDiff >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400";
  const playDiffStr = `${playDiff >= 0 ? "+" : ""}${formatCount(playDiff)}`;

  // ---- Hashtag intensity ----
  const maxAdHashtagCount = data.topAdHashtags.length > 0
    ? Math.max(...data.topAdHashtags.map(h => h.count))
    : 1;

  return (
    <Card>
      <CardContent className="pt-5 space-y-4">

        {/* ── Hero KPI strip ── */}
        <div className={`rounded-xl border px-4 py-3 flex items-center gap-4 ${cfg.heroBg}`}>
          {/* Big PR rate number */}
          <div className="flex-shrink-0 text-center min-w-[4.5rem]">
            <div className={`text-4xl font-extrabold tracking-tight leading-none ${cfg.heroText}`}>
              {adRateNum}%
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-0.5">
              PR率
            </div>
          </div>

          {/* Vertical divider */}
          <div className="w-px self-stretch bg-border/60" />

          {/* Verdict + sub-copy + proportion bar */}
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
              <span className={`text-sm font-bold leading-tight ${cfg.heroText}`}>{cfg.verdict}</span>
            </div>
            <p className={`text-xs leading-snug ${cfg.heroSubText}`}>{cfg.sub}</p>
            {/* Ad vs organic proportion mini-bar */}
            <div className="flex items-center gap-2">
              <div className="flex h-1.5 w-full max-w-[160px] rounded-full overflow-hidden bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${cfg.barFill}`}
                  style={{ width: `${Math.max(adRateNum, 1)}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                PR {data.adCount}本 / 計 {total}本
              </span>
            </div>
          </div>
        </div>

        {/* ── Query-level PR rates — slim inline bars, no section header ── */}
        {data.perQuery.length > 0 && (
          <div className="space-y-2">
            {[...data.perQuery].sort((a, b) => b.adRate - a.adRate).map(q => (
              <div key={q.query} className="flex items-center gap-3">
                <span
                  className="text-xs font-medium truncate shrink-0"
                  style={{ width: "38%" }}
                  title={q.query}
                >
                  {q.query}
                </span>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${cfg.barFill}`}
                    style={{ width: `${Math.max(q.adRate, 1)}%` }}
                  />
                </div>
                <div className="text-xs tabular-nums text-right shrink-0 w-20">
                  <span className="font-bold">{q.adRate}%</span>
                  <span className="text-muted-foreground ml-1">({q.adCount}/{q.totalCount})</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── PR vs Organic: compact table-style comparison ── */}
        <div className="rounded-lg border bg-muted/30 overflow-hidden">
          {/* Column header row */}
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-1.5 bg-muted/50 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>指標</span>
            <span className="text-right text-amber-600 dark:text-amber-400 w-16">PR/Ad</span>
            <span className="text-right text-slate-500 dark:text-slate-400 w-16">オーガニック</span>
            <span className="text-right w-14">差分</span>
          </div>
          {/* ER */}
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center px-3 py-2 text-xs border-t border-border/50">
            <span className="text-muted-foreground">平均ER</span>
            <span className="font-bold text-right w-16 text-amber-700 dark:text-amber-300">{comparison.ad.avgER}%</span>
            <span className="font-medium text-right w-16">{comparison.organic.avgER}%</span>
            <span className={`font-bold text-right w-14 ${erDiffColor}`}>{erDiffStr}</span>
          </div>
          {/* Plays */}
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center px-3 py-2 text-xs border-t border-border/50">
            <span className="text-muted-foreground">平均再生数</span>
            <span className="font-bold text-right w-16 text-amber-700 dark:text-amber-300">{formatCount(comparison.ad.avgPlayCount)}</span>
            <span className="font-medium text-right w-16">{formatCount(comparison.organic.avgPlayCount)}</span>
            <span className={`font-bold text-right w-14 ${playDiffColor}`}>{playDiffStr}</span>
          </div>
          {/* Age */}
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center px-3 py-2 text-xs border-t border-border/50">
            <span className="text-muted-foreground">中央値投稿日数</span>
            <span className="font-bold text-right w-16 text-amber-700 dark:text-amber-300">{Math.round(comparison.ad.medianAgeDays)}日</span>
            <span className="font-medium text-right w-16">{Math.round(comparison.organic.medianAgeDays)}日</span>
            <span className="text-right w-14 text-muted-foreground text-[10px]">—</span>
          </div>
        </div>

        {/* ── PR hashtag badge cloud ── */}
        {data.topAdHashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {data.topAdHashtags.map(h => {
              const intensity = h.count / maxAdHashtagCount;
              // Three visual weight tiers: strong / mid / faint
              const badgeCls =
                intensity >= 0.66
                  ? "bg-amber-200 dark:bg-amber-800/70 border-amber-400 dark:border-amber-600 text-amber-900 dark:text-amber-200"
                  : intensity >= 0.33
                  ? "bg-amber-100 dark:bg-amber-900/50 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300"
                  : "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400";
              return (
                <span
                  key={h.tag}
                  className={`inline-flex items-center gap-1 border rounded-full px-2.5 py-1 text-[11px] font-medium leading-none ${badgeCls}`}
                  title={`PR動画数: ${h.count}本 / 平均ER: ${h.avgER}% / 平均再生数: ${formatCount(h.avgPlayCount)}`}
                >
                  <span className="opacity-50">#</span>
                  <span>{h.tag}</span>
                  {/* Count bubble */}
                  <span className="ml-0.5 bg-amber-500/25 dark:bg-amber-400/20 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                    {h.count}
                  </span>
                  {/* ER chip */}
                  <span className="text-[10px] font-normal opacity-70">
                    {h.avgER}%
                  </span>
                </span>
              );
            })}
          </div>
        )}

      </CardContent>
    </Card>
  );
}

function round2Fmt(v: number): string {
  return (Math.round(v * 100) / 100).toFixed(2);
}

// ---- 3.8 TikTok SEOメタキーワード ----

function SeoMetaKeywordsSection({ data }: { data: NonNullable<TrendStatistics["seoMetaKeywords"]> }) {
  const maxCount = data.keywordRanking[0]?.count ?? 1;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">TikTok SEOキーワード（上位動画のmeta keywords）</CardTitle>
          <span className="text-xs text-muted-foreground">{data.videos.length}本の動画から取得</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* キーワードランキング */}
        <div className="space-y-1">
          {data.keywordRanking.slice(0, 20).map((kw, i) => (
            <div key={kw.keyword} className="flex items-center gap-2 text-xs">
              <span className="w-5 text-right text-muted-foreground font-mono">{i + 1}</span>
              <span className="font-medium w-48 truncate" title={kw.keyword}>{kw.keyword}</span>
              <div className="flex-1 h-3.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 dark:bg-emerald-400 rounded-full"
                  style={{ width: `${(kw.count / maxCount) * 100}%` }}
                />
              </div>
              <span className="text-muted-foreground w-16 text-right">{kw.count}本に出現</span>
            </div>
          ))}
        </div>

        {/* 動画別の生データ */}
        <div className="pt-3 border-t">
          <p className="text-xs font-medium text-muted-foreground mb-2">動画別メタキーワード</p>
          <div className="space-y-2">
            {data.videos.map(v => (
              <div key={v.videoId} className="text-xs">
                <a
                  href={`https://www.tiktok.com/@${v.authorUniqueId}/video/${v.videoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5"
                >
                  @{v.authorUniqueId}/{v.videoId.slice(-6)}
                  <svg className="w-2.5 h-2.5 opacity-60 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                </a>
                <div className="flex flex-wrap gap-1 mt-1">
                  {v.keywords.map((kw, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-[10px]">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- 4. ハッシュタグ別ER比較 ----

function HashtagPerformanceChart({ data, globalMedianER }: {
  data: TrendStatistics["hashtagPerformance"];
  globalMedianER: number;
}) {
  const [metric, setMetric] = useState<"er" | "plays">("er");
  if (data.length === 0) return null;

  const chartData = data.slice(0, 15).map(d => ({
    tag: `#${d.tag}`,
    avgER: d.avgER,
    avgPlayCount: d.avgPlayCount,
    videoCount: d.videoCount,
    isUnderrated: d.isUnderrated,
    totalPostCount: d.totalPostCount,
  }));

  const dataKey = metric === "er" ? "avgER" : "avgPlayCount";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">ハッシュタグ別パフォーマンス</CardTitle>
          <MetricToggle value={metric} onChange={setMetric} />
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 28 + 40)}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 80 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={metric === "er" ? (v => `${v}%`) : formatCount} />
            <YAxis type="category" dataKey="tag" tick={{ fontSize: 11 }} width={75} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-background border rounded-lg shadow-lg p-2 text-xs space-y-0.5">
                    <div className="font-medium">{d.tag}</div>
                    <div>平均ER: {d.avgER}%</div>
                    <div>平均再生数: {formatCount(d.avgPlayCount)}</div>
                    <div>動画数: {d.videoCount}本</div>
                    {d.totalPostCount != null && (
                      <div>総投稿数: {formatCount(d.totalPostCount)}本</div>
                    )}
                  </div>
                );
              }}
            />
            <Bar dataKey={dataKey} radius={[0, 4, 4, 0]}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.isUnderrated ? "#10b981" : "#6366f1"} />
              ))}
            </Bar>
            {metric === "er" && globalMedianER > 0 && (
              <ReferenceLine
                x={globalMedianER}
                stroke="#ef4444"
                strokeDasharray="5 5"
                label={{ value: `全体中央値 ${globalMedianER}%`, position: "top", fontSize: 10, fill: "#ef4444" }}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ backgroundColor: "#10b981" }} /> 穴場タグ（高ER・少数動画）
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ backgroundColor: "#6366f1" }} /> 通常
          </span>
        </div>
        {chartData.some(d => d.totalPostCount != null) && (
          <div className="mt-3 pt-3 border-t">
            <p className="text-xs font-medium mb-2 text-muted-foreground">TikTok総投稿数</p>
            <div className="flex flex-wrap gap-2">
              {chartData.filter(d => d.totalPostCount != null).map(d => (
                <span key={d.tag} className="inline-flex items-center gap-1 text-xs bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 px-2 py-1 rounded">
                  <span className="font-medium">{d.tag}</span>
                  <span className="text-muted-foreground">{formatCount(d.totalPostCount!)}本</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- 5. 動画長×ER ----

function DurationBandsChart({ data, globalMedianER }: {
  data: TrendStatistics["durationBands"];
  globalMedianER: number;
}) {
  const [metric, setMetric] = useState<"er" | "plays">("er");
  if (data.length === 0) return null;

  const dataKey = metric === "er" ? "avgER" : "avgPlayCount";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">動画長 × パフォーマンス</CardTitle>
          <MetricToggle value={metric} onChange={setMetric} />
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={metric === "er" ? (v => `${v}%`) : formatCount} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-background border rounded-lg shadow-lg p-2 text-xs space-y-0.5">
                    <div className="font-medium">尺: {d.label}</div>
                    <div>平均ER: {d.avgER}%</div>
                    <div>平均再生数: {formatCount(d.avgPlayCount)}</div>
                    <div>動画数: {d.videoCount}本</div>
                  </div>
                );
              }}
            />
            <Bar dataKey={dataKey} radius={[4, 4, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.isOptimal ? "#2563eb" : "#93c5fd"} />
              ))}
            </Bar>
            {metric === "er" && globalMedianER > 0 && (
              <ReferenceLine
                y={globalMedianER}
                stroke="#ef4444"
                strokeDasharray="5 5"
                label={{ value: `中央値ER ${globalMedianER}%`, position: "right", fontSize: 11, fill: "#ef4444" }}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
        <div className="grid grid-cols-3 gap-2 text-xs mt-2">
          {data.map(d => (
            <div key={d.label} className={`p-2 rounded text-center ${d.isOptimal ? "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800" : "bg-muted/50"}`}>
              <div className="font-medium">{d.label} {d.isOptimal && "★"}</div>
              <div className="text-muted-foreground">{d.videoCount}本</div>
              <div className="text-muted-foreground">ER {d.avgER}% / {formatCount(d.avgPlayCount)}再生</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---- 6. 投稿タイミングヒートマップ ----

function PostingTimeHeatmap({ grid, bestSlots }: {
  grid: TrendStatistics["postingTimeGrid"];
  bestSlots: TrendStatistics["bestTimeSlots"];
}) {
  const [mode, setMode] = useState<"er" | "count" | "plays">("er");

  // Build 7x24 lookup
  const lookup = new Map<string, TrendStatistics["postingTimeGrid"][number]>();
  let maxER = 0, maxCount = 0, maxPlays = 0;
  for (const cell of grid) {
    lookup.set(`${cell.day}-${cell.hour}`, cell);
    if (cell.avgER > maxER) maxER = cell.avgER;
    if (cell.videoCount > maxCount) maxCount = cell.videoCount;
    if (cell.avgPlayCount > maxPlays) maxPlays = cell.avgPlayCount;
  }

  const colorSchemes = {
    er:    { colors: ["bg-teal-100", "bg-teal-200", "bg-teal-400", "bg-teal-600 text-white"] },
    count: { colors: ["bg-blue-100", "bg-blue-200", "bg-blue-400", "bg-blue-600 text-white"] },
    plays: { colors: ["bg-amber-100", "bg-amber-200", "bg-amber-400", "bg-amber-600 text-white"] },
  };

  const getColor = (day: number, hour: number) => {
    const cell = lookup.get(`${day}-${hour}`);
    if (!cell) return "bg-muted";
    const maxVal = mode === "er" ? maxER : mode === "count" ? maxCount : maxPlays;
    const val = mode === "er" ? cell.avgER : mode === "count" ? cell.videoCount : cell.avgPlayCount;
    if (maxVal === 0) return "bg-muted";
    const intensity = val / maxVal;
    const scheme = colorSchemes[mode].colors;
    if (intensity > 0.75) return scheme[3];
    if (intensity > 0.5) return scheme[2];
    if (intensity > 0.25) return scheme[1];
    return scheme[0];
  };

  const getCellText = (cell: TrendStatistics["postingTimeGrid"][number] | undefined) => {
    if (!cell) return "";
    if (mode === "er") return `${cell.avgER}%`;
    if (mode === "count") return String(cell.videoCount);
    return formatCount(cell.avgPlayCount);
  };

  const modeButtons: { key: typeof mode; label: string }[] = [
    { key: "er", label: "平均ER" },
    { key: "count", label: "投稿数" },
    { key: "plays", label: "平均再生数" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">投稿タイミング分析（JST）</CardTitle>
      </CardHeader>
      <CardContent>
        {/* モード切替 */}
        <div className="flex gap-1 p-0.5 bg-muted rounded-lg w-fit mb-4">
          {modeButtons.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${mode === key ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `40px repeat(24, ${mode === "plays" ? "36px" : "28px"})` }}>
            <div />
            {HOURS.map(h => (
              <div key={h} className="text-[10px] text-center text-muted-foreground">{h}</div>
            ))}
            {DAYS.map((day, di) => (
              <div key={`row-${di}`} className="contents">
                <div className="text-xs font-medium flex items-center">{day}</div>
                {HOURS.map(h => {
                  const cell = lookup.get(`${di}-${h}`);
                  return (
                    <div
                      key={`${di}-${h}`}
                      className={`${mode === "plays" ? "w-9" : "w-7"} h-7 rounded-sm flex items-center justify-center text-[8px] font-medium ${getColor(di, h)}`}
                      title={`${day}曜 ${h}時: ${cell ? `${cell.videoCount}本 / ER ${cell.avgER}% / ${formatCount(cell.avgPlayCount)}再生` : "データなし"}`}
                    >
                      {getCellText(cell)}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* 凡例 */}
        <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
          <span>低</span>
          {colorSchemes[mode].colors.map((cls, i) => (
            <div key={i} className={`w-4 h-3 rounded-sm ${cls.split(" ")[0]}`} />
          ))}
          <span>高</span>
        </div>

        {/* ベストタイムスロット */}
        {bestSlots.length > 0 && (
          <div className="mt-3 pt-3 border-t">
            <p className="text-xs font-medium mb-1">おすすめ投稿タイミング（ER上位）</p>
            <div className="flex flex-wrap gap-2">
              {bestSlots.map((s, i) => (
                <span key={i} className="text-xs bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 px-2 py-1 rounded">
                  {DAYS[s.day]}曜 {s.hour}時 (ER {s.avgER}%, {s.videoCount}本)
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- 7. 再生数分布 ----

function PlayCountDistribution({ data }: { data: TrendStatistics["playCountDistribution"] }) {
  if (data.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">再生数分布</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-background border rounded-lg shadow-lg p-2 text-xs space-y-0.5">
                    <div className="font-medium">{d.label}</div>
                    <div>{d.count}本 ({d.percentage}%)</div>
                    <div>平均ER: {d.avgER}%</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill="#6366f1" />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="grid grid-cols-3 gap-2 text-xs mt-2">
          {data.map(d => (
            <div key={d.label} className="p-2 rounded bg-muted/50 text-center">
              <div className="font-medium">{d.label}</div>
              <div className="text-muted-foreground">{d.count}本 ({d.percentage}%)</div>
              <div className="text-muted-foreground">平均ER {d.avgER}%</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
