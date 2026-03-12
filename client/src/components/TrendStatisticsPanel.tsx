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
  { key: "within2w" as const, label: "2週間以内", color: "#059669" },
  { key: "within1m" as const, label: "1ヶ月以内", color: "#10b981" },
  { key: "within2m" as const, label: "2ヶ月以内", color: "#84cc16" },
  { key: "within3m" as const, label: "3ヶ月以内", color: "#eab308" },
  { key: "within6m" as const, label: "6ヶ月以内", color: "#f97316" },
  { key: "older" as const, label: "6ヶ月超", color: "#9ca3af" },
];

function freshnessLabel(score: number): { text: string; className: string } {
  if (score >= 80) return { text: "急上昇", className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" };
  if (score >= 50) return { text: "トレンド中", className: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400" };
  if (score >= 20) return { text: "安定", className: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" };
  return { text: "定番・低調", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" };
}

function QueryFreshnessChart({ data }: { data: NonNullable<TrendStatistics["queryFreshness"]> }) {
  const chartData = data.map(d => ({
    query: d.query,
    ...d.buckets,
    freshnessScore: d.freshnessScore,
    medianAgeDays: d.medianAgeDays,
    totalVideos: d.totalVideos,
    avgER: d.avgER,
    avgPlayCount: d.avgPlayCount,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">クエリ別 鮮度分析</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 36 + 40)}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 100 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fontSize: 11 }} label={{ value: "動画数", position: "insideBottomRight", offset: -5, fontSize: 11 }} />
            <YAxis type="category" dataKey="query" tick={{ fontSize: 11 }} width={95} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-background border rounded-lg shadow-lg p-2 text-xs space-y-0.5">
                    <div className="font-medium">{d.query}</div>
                    <div>鮮度スコア: {d.freshnessScore}%</div>
                    <div>中央値経過日数: {d.medianAgeDays}日</div>
                    <div>平均ER: {d.avgER}%</div>
                    <div>平均再生数: {formatCount(d.avgPlayCount)}</div>
                    <div>動画数: {d.totalVideos}本</div>
                    <hr className="my-1 border-border" />
                    {FRESHNESS_BUCKETS.map(b => (
                      <div key={b.key} className="flex justify-between gap-3">
                        <span>{b.label}</span>
                        <span>{d[b.key]}本</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {FRESHNESS_BUCKETS.map(b => (
              <Bar key={b.key} dataKey={b.key} stackId="freshness" fill={b.color} />
            ))}
          </BarChart>
        </ResponsiveContainer>

        {/* 凡例 */}
        <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
          {FRESHNESS_BUCKETS.map(b => (
            <span key={b.key} className="flex items-center gap-1">
              <span className="w-3 h-3 rounded" style={{ backgroundColor: b.color }} />
              {b.label}
            </span>
          ))}
        </div>

        {/* 鮮度スコアバッジ一覧 */}
        <div className="mt-3 pt-3 border-t space-y-2">
          <p className="text-xs font-medium text-muted-foreground">鮮度スコア（直近2ヶ月以内の動画比率）</p>
          <div className="flex flex-wrap gap-2">
            {data.map(d => {
              const label = freshnessLabel(d.freshnessScore);
              return (
                <div key={d.query} className="flex items-center gap-1.5 text-xs">
                  <span className="font-medium">{d.query}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${label.className}`}>
                    {label.text} {d.freshnessScore}%
                  </span>
                  <span className="text-muted-foreground">中央値{Math.round(d.medianAgeDays)}日</span>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- 3.7 PR/Ad動画インサイト ----

function AdInsightSection({ data }: { data: NonNullable<TrendStatistics["adInsight"]> }) {
  const { comparison } = data;
  const erDiff = round2Fmt(comparison.ad.avgER - comparison.organic.avgER);
  const erSign = comparison.ad.avgER >= comparison.organic.avgER ? "+" : "";

  const chartData = data.topAdHashtags.map(d => ({
    tag: `#${d.tag}`,
    count: d.count,
    avgER: d.avgER,
    avgPlayCount: d.avgPlayCount,
  }));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">PR/Ad動画インサイト</CardTitle>
          <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 font-medium">
            PR率 {data.adRate}%（{data.adCount}/{data.adCount + data.organicCount}本）
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* PR vs オーガニック比較 */}
        <div className="grid grid-cols-2 gap-3">
          {([
            { key: "ad" as const, label: "PR/Ad動画", color: "border-amber-500 bg-amber-50 dark:bg-amber-950/20" },
            { key: "organic" as const, label: "オーガニック動画", color: "border-blue-500 bg-blue-50 dark:bg-blue-950/20" },
          ] as const).map(({ key, label, color }) => {
            const d = comparison[key];
            return (
              <div key={key} className={`border-l-4 rounded-lg p-3 text-sm space-y-1 ${color}`}>
                <div className="font-medium text-xs mb-2">{label}</div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">平均ER</span>
                  <span className="font-medium">{d.avgER}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">平均再生数</span>
                  <span className="font-medium">{formatCount(d.avgPlayCount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">中央値経過日数</span>
                  <span className="font-medium">{Math.round(d.medianAgeDays)}日</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="text-xs text-muted-foreground">
          ER差: <span className={`font-medium ${comparison.ad.avgER >= comparison.organic.avgER ? "text-green-600" : "text-red-600"}`}>
            {erSign}{erDiff}%
          </span>（PR動画がオーガニックより{comparison.ad.avgER >= comparison.organic.avgER ? "高い" : "低い"}）
        </div>

        {/* クエリ別PR率 */}
        {data.perQuery.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">クエリ別PR率</p>
            <div className="space-y-1.5">
              {data.perQuery.map(q => (
                <div key={q.query} className="flex items-center gap-2 text-xs">
                  <span className="font-medium w-32 truncate" title={q.query}>{q.query}</span>
                  <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400 dark:bg-amber-500 rounded-full"
                      style={{ width: `${q.adRate}%` }}
                    />
                  </div>
                  <span className="text-muted-foreground w-24 text-right">
                    {q.adRate}%（{q.adCount}/{q.totalCount}本）
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PR頻出ハッシュタグ */}
        {chartData.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">PR動画の頻出ハッシュタグ</p>
            <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 26 + 40)}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 90 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="tag" tick={{ fontSize: 11 }} width={85} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-background border rounded-lg shadow-lg p-2 text-xs space-y-0.5">
                        <div className="font-medium">{d.tag}</div>
                        <div>PR動画数: {d.count}本</div>
                        <div>平均ER: {d.avgER}%</div>
                        <div>平均再生数: {formatCount(d.avgPlayCount)}</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
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
