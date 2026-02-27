import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  GitCompare,
  BarChart2,
  Zap,
  MessageSquare,
  Trophy,
  Eye,
  Heart,
  Share2,
  Bookmark,
  MessageCircle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocation, useSearch } from "wouter";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

// ==============================
// Helper: 数値デルタ表示
// ==============================
function Delta({
  value,
  unit = "",
  decimals = 1,
  invertColor = false,
}: {
  value: number;
  unit?: string;
  decimals?: number;
  invertColor?: boolean;
}) {
  if (value === 0) {
    return (
      <span className="flex items-center gap-0.5 text-muted-foreground text-xs font-medium">
        <Minus className="h-3 w-3" />
        同値
      </span>
    );
  }
  const isPositive = value > 0;
  const isGood = invertColor ? !isPositive : isPositive;
  return (
    <span
      className={`flex items-center gap-0.5 text-xs font-semibold ${
        isGood ? "text-green-600" : "text-red-500"
      }`}
    >
      {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {isPositive ? "+" : ""}
      {value.toFixed(decimals)}
      {unit}
    </span>
  );
}

// ==============================
// Helper: 大きい数値フォーマット
// ==============================
function formatBigNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}

// ==============================
// Helper: 勝者バッジ
// ==============================
function WinnerBadge({ side }: { side: "A" | "B" | "tie" }) {
  if (side === "tie") return null;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
        side === "A"
          ? "bg-blue-100 text-blue-700"
          : "bg-amber-100 text-amber-700"
      }`}
    >
      <Trophy className="h-2.5 w-2.5" />
      {side}
    </span>
  );
}

// ==============================
// Helper: 比較プログレスバー
// ==============================
function CompareBar({ valueA, valueB }: { valueA: number; valueB: number }) {
  const total = valueA + valueB;
  if (total === 0) return <div className="h-1.5 rounded-full bg-muted w-full" />;
  const pctA = (valueA / total) * 100;
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden w-full gap-px">
      <div className="bg-blue-500 rounded-l-full transition-all" style={{ width: `${pctA}%` }} />
      <div className="bg-amber-400 rounded-r-full transition-all" style={{ width: `${100 - pctA}%` }} />
    </div>
  );
}

// ==============================
// Helper: 単一指標行（リッチ版）
// ==============================
function MetricRow({
  label,
  valueA,
  valueB,
  unit = "",
  decimals = 0,
  invertColor = false,
  formatFn,
  icon,
}: {
  label: string;
  valueA: number;
  valueB: number;
  unit?: string;
  decimals?: number;
  invertColor?: boolean;
  formatFn?: (v: number) => string;
  icon?: React.ReactNode;
}) {
  const fmt = formatFn ?? ((v: number) => v.toFixed(decimals) + unit);
  const delta = valueB - valueA;

  const winnerRaw: "A" | "B" | "tie" =
    valueA === valueB ? "tie" : invertColor ? (valueA < valueB ? "A" : "B") : (valueA > valueB ? "A" : "B");

  return (
    <div className="py-3 border-b last:border-0 space-y-2">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {/* A側 */}
        <div className="flex items-center justify-end gap-2">
          {winnerRaw === "A" && <WinnerBadge side="A" />}
          <span className="font-bold text-xl text-blue-700">{fmt(valueA)}</span>
        </div>

        {/* 中央ラベル */}
        <div className="flex flex-col items-center gap-0.5 min-w-[120px]">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {icon}
            <span>{label}</span>
          </div>
          <Delta value={delta} unit={unit} decimals={decimals} invertColor={invertColor} />
        </div>

        {/* B側 */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-xl text-amber-600">{fmt(valueB)}</span>
          {winnerRaw === "B" && <WinnerBadge side="B" />}
        </div>
      </div>

      {/* 相対バー */}
      <CompareBar valueA={valueA} valueB={valueB} />
    </div>
  );
}

// ==============================
// Helper: センチメントバー
// ==============================
function SentimentBar({ positive, neutral, negative }: { positive: number; neutral: number; negative: number }) {
  return (
    <div className="flex rounded-full overflow-hidden h-2.5 w-full">
      <div className="bg-green-500 transition-all" style={{ width: `${positive}%` }} />
      <div className="bg-gray-300 transition-all" style={{ width: `${neutral}%` }} />
      <div className="bg-red-400 transition-all" style={{ width: `${negative}%` }} />
    </div>
  );
}

// ==============================
// Main page
// ==============================
export default function Comparison() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const idA = parseInt(params.get("a") ?? "0");
  const idB = parseInt(params.get("b") ?? "0");

  const { data: dataA, isLoading: loadingA } = trpc.analysis.getById.useQuery(
    { jobId: idA },
    { enabled: !!user && idA > 0 }
  );
  const { data: dataB, isLoading: loadingB } = trpc.analysis.getById.useQuery(
    { jobId: idB },
    { enabled: !!user && idB > 0 }
  );

  if (!idA || !idB) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">比較対象が指定されていません</p>
          <Button variant="outline" onClick={() => setLocation("/history")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            履歴へ戻る
          </Button>
        </div>
      </div>
    );
  }

  if (loadingA || loadingB) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  if (!dataA || !dataB) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">分析データを取得できませんでした</p>
          <Button variant="outline" onClick={() => setLocation("/history")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            履歴へ戻る
          </Button>
        </div>
      </div>
    );
  }

  // ---- データ集計 ----
  const calcMetrics = (d: typeof dataA) => {
    const videos = d.videos ?? [];
    const totalVideos = videos.length;

    const totalViews = videos.reduce((s, v) => s + (v.viewCount ?? 0), 0);
    const totalLikes = videos.reduce((s, v) => s + (v.likeCount ?? 0), 0);
    const totalComments = videos.reduce((s, v) => s + (v.commentCount ?? 0), 0);
    const totalShares = videos.reduce((s, v) => s + (v.shareCount ?? 0), 0);
    const totalSaves = videos.reduce((s, v) => s + (v.saveCount ?? 0), 0);
    const avgViews = totalVideos > 0 ? totalViews / totalVideos : 0;

    const erList = videos
      .filter((v) => (v.viewCount ?? 0) > 0)
      .map((v) => {
        const eng = (v.likeCount ?? 0) + (v.commentCount ?? 0) + (v.shareCount ?? 0) + (v.saveCount ?? 0);
        return (eng / (v.viewCount ?? 1)) * 100;
      });
    const avgER = erList.length > 0 ? erList.reduce((a, b) => a + b, 0) / erList.length : 0;

    const avgScore =
      videos.filter((v) => v.score?.overallScore != null).length > 0
        ? videos
            .filter((v) => v.score?.overallScore != null)
            .reduce((s, v) => s + (v.score!.overallScore ?? 0), 0) /
          videos.filter((v) => v.score?.overallScore != null).length
        : 0;

    const triple = d.tripleSearch?.duplicateAnalysis;
    const overlapRate = triple?.overlapRate ?? 0;
    const winCount = triple?.appearedInAll3Count ?? 0;
    const semi2Count = triple?.appearedIn2Count ?? 0;

    const report = d.report;
    const sentPos = report?.positiveCount ?? 0;
    const sentNeu = report?.neutralCount ?? 0;
    const sentNeg = report?.negativeCount ?? 0;
    const sentTotal = sentPos + sentNeu + sentNeg;
    const sentPosPct = sentTotal > 0 ? (sentPos / sentTotal) * 100 : 0;
    const sentNeuPct = sentTotal > 0 ? (sentNeu / sentTotal) * 100 : 0;
    const sentNegPct = sentTotal > 0 ? (sentNeg / sentTotal) * 100 : 0;

    return {
      totalVideos,
      totalViews,
      totalLikes,
      totalComments,
      totalShares,
      totalSaves,
      avgViews,
      avgER,
      avgScore,
      overlapRate,
      winCount,
      semi2Count,
      sentPosPct,
      sentNeuPct,
      sentNegPct,
    };
  };

  const mA = calcMetrics(dataA);
  const mB = calcMetrics(dataB);

  const labelA = dataA.job.keyword ? `「${dataA.job.keyword}」` : "手動URL分析";
  const labelB = dataB.job.keyword ? `「${dataB.job.keyword}」` : "手動URL分析";
  const dateA = format(new Date(dataA.job.createdAt), "yyyy/MM/dd HH:mm", { locale: ja });
  const dateB = format(new Date(dataB.job.createdAt), "yyyy/MM/dd HH:mm", { locale: ja });

  // 勝利数集計（概要指標のみ）
  const metrics = [
    { a: mA.totalViews, b: mB.totalViews },
    { a: mA.avgViews, b: mB.avgViews },
    { a: mA.totalLikes, b: mB.totalLikes },
    { a: mA.totalComments, b: mB.totalComments },
    { a: mA.totalShares, b: mB.totalShares },
    { a: mA.totalSaves, b: mB.totalSaves },
    { a: mA.avgER, b: mB.avgER },
    { a: mA.avgScore, b: mB.avgScore },
  ];
  const winsA = metrics.filter((m) => m.a > m.b).length;
  const winsB = metrics.filter((m) => m.b > m.a).length;
  const overallWinner: "A" | "B" | "tie" = winsA > winsB ? "A" : winsB > winsA ? "B" : "tie";

  return (
    <div className="min-h-screen bg-background">
      <div className="container py-12">
        <div className="max-w-5xl mx-auto space-y-8">

          {/* ---- ヘッダー ---- */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold">
                <span className="gradient-text">比較レポート</span>
              </h1>
              <p className="text-muted-foreground mt-2">2件の分析結果を並べて比較します</p>
            </div>
            <Button variant="outline" onClick={() => setLocation("/history")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              履歴へ戻る
            </Button>
          </div>

          {/* ---- A vs B ヘッダーカード ---- */}
          <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
            {/* A */}
            <div className="rounded-xl border-2 border-blue-400/60 bg-blue-50/60 dark:bg-blue-950/30 p-5 flex flex-col gap-2">
              <Badge className="w-fit bg-blue-600 text-white text-xs">分析 A</Badge>
              <p className="font-bold text-xl text-blue-800 dark:text-blue-200">{labelA}</p>
              <p className="text-sm text-muted-foreground">{dateA}</p>
              <p className="text-sm text-muted-foreground">{mA.totalVideos} 本の動画</p>
            </div>

            {/* VS */}
            <div className="flex flex-col items-center justify-center gap-2 px-2">
              <div className="rounded-full bg-muted/80 p-2.5">
                <GitCompare className="h-5 w-5 text-muted-foreground" />
              </div>
              <span className="text-sm font-bold text-muted-foreground">VS</span>
            </div>

            {/* B */}
            <div className="rounded-xl border-2 border-amber-400/60 bg-amber-50/60 dark:bg-amber-950/30 p-5 flex flex-col gap-2">
              <Badge className="w-fit bg-amber-500 text-white text-xs">分析 B</Badge>
              <p className="font-bold text-xl text-amber-800 dark:text-amber-200">{labelB}</p>
              <p className="text-sm text-muted-foreground">{dateB}</p>
              <p className="text-sm text-muted-foreground">{mB.totalVideos} 本の動画</p>
            </div>
          </div>

          {/* ---- 総合サマリーバナー ---- */}
          <div
            className={`rounded-xl p-4 border flex items-center justify-between ${
              overallWinner === "A"
                ? "border-blue-400/50 bg-blue-50/50 dark:bg-blue-950/20"
                : overallWinner === "B"
                ? "border-amber-400/50 bg-amber-50/50 dark:bg-amber-950/20"
                : "border-muted bg-muted/20"
            }`}
          >
            <div className="flex items-center gap-3">
              <Trophy
                className={`h-5 w-5 ${
                  overallWinner === "A"
                    ? "text-blue-600"
                    : overallWinner === "B"
                    ? "text-amber-500"
                    : "text-muted-foreground"
                }`}
              />
              <div>
                <p className="font-semibold text-sm">
                  {overallWinner === "tie"
                    ? "引き分け"
                    : `分析 ${overallWinner} がリード`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {overallWinner !== "tie"
                    ? `${overallWinner === "A" ? winsA : winsB} / ${metrics.length} 指標で優勢`
                    : `${metrics.length} 指標すべて同値`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="font-bold text-blue-700">A: {winsA}勝</span>
              <span className="text-muted-foreground">/</span>
              <span className="font-bold text-amber-600">B: {winsB}勝</span>
            </div>
          </div>

          {/* ---- 凡例 ---- */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-blue-500" />
              <span>分析 A</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <span>分析 B</span>
            </div>
            <span className="ml-auto">バーは相対比率を表します</span>
          </div>

          {/* ---- 概要指標 ---- */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Eye className="h-4 w-4 text-primary" />
                リーチ指標
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <MetricRow
                label="総視聴数"
                valueA={mA.totalViews}
                valueB={mB.totalViews}
                formatFn={formatBigNum}
                icon={<Eye className="h-3 w-3" />}
              />
              <MetricRow
                label="平均視聴数"
                valueA={mA.avgViews}
                valueB={mB.avgViews}
                formatFn={formatBigNum}
                icon={<Eye className="h-3 w-3" />}
              />
              <MetricRow
                label="総動画数"
                valueA={mA.totalVideos}
                valueB={mB.totalVideos}
                unit="本"
                icon={<BarChart2 className="h-3 w-3" />}
              />
            </CardContent>
          </Card>

          {/* ---- エンゲージメント指標 ---- */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-4 w-4 text-primary" />
                エンゲージメント
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <MetricRow
                label="総いいね"
                valueA={mA.totalLikes}
                valueB={mB.totalLikes}
                formatFn={formatBigNum}
                icon={<Heart className="h-3 w-3" />}
              />
              <MetricRow
                label="総コメント"
                valueA={mA.totalComments}
                valueB={mB.totalComments}
                formatFn={formatBigNum}
                icon={<MessageCircle className="h-3 w-3" />}
              />
              <MetricRow
                label="総シェア"
                valueA={mA.totalShares}
                valueB={mB.totalShares}
                formatFn={formatBigNum}
                icon={<Share2 className="h-3 w-3" />}
              />
              <MetricRow
                label="総保存"
                valueA={mA.totalSaves}
                valueB={mB.totalSaves}
                formatFn={formatBigNum}
                icon={<Bookmark className="h-3 w-3" />}
              />
              <MetricRow
                label="平均ER%"
                valueA={mA.avgER}
                valueB={mB.avgER}
                unit="%"
                decimals={2}
                icon={<TrendingUp className="h-3 w-3" />}
              />
              <MetricRow
                label="平均総合スコア"
                valueA={mA.avgScore}
                valueB={mB.avgScore}
                decimals={1}
                icon={<BarChart2 className="h-3 w-3" />}
              />
            </CardContent>
          </Card>

          {/* ---- 3重検索・ウィンパターン ---- */}
          {(dataA.tripleSearch || dataB.tripleSearch) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Trophy className="h-4 w-4 text-primary" />
                  ウィンパターン（3重検索）
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-0">
                <MetricRow
                  label="重複率"
                  valueA={mA.overlapRate}
                  valueB={mB.overlapRate}
                  unit="%"
                  decimals={1}
                />
                <MetricRow
                  label="3回出現（Winパターン）"
                  valueA={mA.winCount}
                  valueB={mB.winCount}
                  unit="本"
                />
                <MetricRow
                  label="2回出現"
                  valueA={mA.semi2Count}
                  valueB={mB.semi2Count}
                  unit="本"
                />
              </CardContent>
            </Card>
          )}

          {/* ---- センチメント ---- */}
          {dataA.report && dataB.report && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  センチメント分布
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* バー比較 */}
                <div className="grid grid-cols-[1fr_32px_1fr] gap-3 items-center">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="font-medium text-blue-700">分析 A</span>
                    </div>
                    <SentimentBar
                      positive={mA.sentPosPct}
                      neutral={mA.sentNeuPct}
                      negative={mA.sentNegPct}
                    />
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span className="text-green-600 font-medium">ポジ {mA.sentPosPct.toFixed(1)}%</span>
                      <span>中立 {mA.sentNeuPct.toFixed(1)}%</span>
                      <span className="text-red-500 font-medium">ネガ {mA.sentNegPct.toFixed(1)}%</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-center">
                    <span className="text-xs font-bold text-muted-foreground">vs</span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="font-medium text-amber-600">分析 B</span>
                    </div>
                    <SentimentBar
                      positive={mB.sentPosPct}
                      neutral={mB.sentNeuPct}
                      negative={mB.sentNegPct}
                    />
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span className="text-green-600 font-medium">ポジ {mB.sentPosPct.toFixed(1)}%</span>
                      <span>中立 {mB.sentNeuPct.toFixed(1)}%</span>
                      <span className="text-red-500 font-medium">ネガ {mB.sentNegPct.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>

                {/* 数値比較行 */}
                <div className="pt-2 border-t space-y-0">
                  <MetricRow
                    label="ポジティブ%"
                    valueA={mA.sentPosPct}
                    valueB={mB.sentPosPct}
                    unit="%"
                    decimals={1}
                  />
                  <MetricRow
                    label="ニュートラル%"
                    valueA={mA.sentNeuPct}
                    valueB={mB.sentNeuPct}
                    unit="%"
                    decimals={1}
                  />
                  <MetricRow
                    label="ネガティブ%"
                    valueA={mA.sentNegPct}
                    valueB={mB.sentNegPct}
                    unit="%"
                    decimals={1}
                    invertColor
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* ---- 各分析へのリンク ---- */}
          <div className="grid grid-cols-2 gap-4">
            <Button
              variant="outline"
              onClick={() => setLocation(`/analysis/${idA}`)}
              className="border-blue-400/60 text-blue-700 hover:bg-blue-50"
            >
              <Eye className="h-4 w-4 mr-2" />
              分析 A の詳細を見る
            </Button>
            <Button
              variant="outline"
              onClick={() => setLocation(`/analysis/${idB}`)}
              className="border-amber-400/60 text-amber-700 hover:bg-amber-50"
            >
              <Eye className="h-4 w-4 mr-2" />
              分析 B の詳細を見る
            </Button>
          </div>

        </div>
      </div>
    </div>
  );
}
