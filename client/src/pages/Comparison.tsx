import React from "react";
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
  Layers,
  Lightbulb,
  Video,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Ghost,
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
function ImproveBadge({ improved }: { improved: "up" | "down" | "same" }) {
  if (improved === "up")   return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">✅ 改善</span>;
  if (improved === "down") return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">❌ 低下</span>;
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">→ 維持</span>;
}

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

  // B が A より良いか（改善チェック）
  const improved: "up" | "down" | "same" =
    valueA === valueB ? "same"
    : invertColor ? (valueB < valueA ? "up" : "down")
    : (valueB > valueA ? "up" : "down");

  return (
    <div className="py-3 border-b last:border-0 space-y-2">
      <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
        {/* A側 */}
        <div className="flex items-center justify-end gap-2">
          {winnerRaw === "A" && <WinnerBadge side="A" />}
          <span className="font-bold text-xl text-blue-700">{fmt(valueA)}</span>
        </div>

        {/* 中央ラベル */}
        <div className="flex flex-col items-center gap-0.5 min-w-[110px]">
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

        {/* 改善バッジ */}
        <ImproveBadge improved={improved} />
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation(`/analysis/${idA}`)}
                className="mt-1 border-blue-400/60 text-blue-700 hover:bg-blue-100 text-xs h-7 w-fit"
              >
                <Eye className="h-3 w-3 mr-1" />
                詳細を見る
              </Button>
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation(`/analysis/${idB}`)}
                className="mt-1 border-amber-400/60 text-amber-700 hover:bg-amber-100 text-xs h-7 w-fit"
              >
                <Eye className="h-3 w-3 mr-1" />
                詳細を見る
              </Button>
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
          {(dataA.tripleSearch || dataB.tripleSearch) && (() => {
            const winDiff = mB.winCount - mA.winCount;
            const overlapDiff = mB.overlapRate - mA.overlapRate;
            const semi2Diff = mB.semi2Count - mA.semi2Count;
            // 判定コメント生成
            const comments: { text: string; color: string }[] = [];
            if (winDiff > 0) comments.push({ text: `Winパターンが${winDiff}本増加 → 検索安定性が向上`, color: "text-green-600" });
            else if (winDiff < 0) comments.push({ text: `Winパターンが${Math.abs(winDiff)}本減少 → 検索安定性が低下`, color: "text-red-500" });
            if (overlapDiff > 1) comments.push({ text: `重複率が+${overlapDiff.toFixed(1)}% → 市場での定番化が進行`, color: "text-green-600" });
            else if (overlapDiff < -1) comments.push({ text: `重複率が${overlapDiff.toFixed(1)}% → 競合構成に変化あり`, color: "text-amber-600" });
            if (winDiff === 0 && overlapDiff === 0 && semi2Diff === 0) comments.push({ text: "重複構成に変化なし → 市場は安定", color: "text-muted-foreground" });
            return (
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
                  label="全セッション出現（Winパターン）"
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
                {comments.length > 0 && (
                  <div className="pt-3 space-y-1">
                    {comments.map((c, i) => (
                      <p key={i} className={`text-xs font-medium ${c.color}`}>
                        {c.text}
                      </p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            );
          })()}

          {/* ---- センチメント ---- */}
          {dataA.report && dataB.report && (() => {
            const sentImproved =
              mB.sentPosPct > mA.sentPosPct && mB.sentNegPct < mA.sentNegPct ? "full"
              : mB.sentPosPct > mA.sentPosPct ? "pos_only"
              : mB.sentNegPct < mA.sentNegPct ? "neg_only"
              : mA.sentPosPct === mB.sentPosPct && mA.sentNegPct === mB.sentNegPct ? "same"
              : "none";
            const sentBadge = {
              full:     <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">✅ ポジ↑ ネガ↓ 改善</span>,
              pos_only: <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-600">△ ポジのみ増加</span>,
              neg_only: <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">△ ネガのみ減少</span>,
              none:     <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">❌ 悪化</span>,
              same:     <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">→ 変化なし</span>,
            }[sentImproved];
            return (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  センチメント分布
                  <span className="ml-auto">{sentBadge}</span>
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
            );
          })()}

          {/* ---- インパクト分析（facets）改善チェック ---- */}
          {((dataA.report?.facets?.length ?? 0) > 0 || (dataB.report?.facets?.length ?? 0) > 0) && (() => {
            const facetsA: any[] = (dataA.report as any)?.facets ?? [];
            const facetsB: any[] = (dataB.report as any)?.facets ?? [];
            const allAspects = Array.from(new Set([
              ...facetsA.map((f: any) => f.aspect || f.name || ""),
              ...facetsB.map((f: any) => f.aspect || f.name || ""),
            ])).filter(Boolean);

            type Verdict = "full" | "pos_only" | "neg_only" | "none" | "unknown";
            const rows = allAspects.map((aspect) => {
              const fA = facetsA.find((f: any) => (f.aspect || f.name) === aspect);
              const fB = facetsB.find((f: any) => (f.aspect || f.name) === aspect);
              const posA: number | null = fA?.positive_percentage ?? fA?.pos ?? null;
              const negA: number | null = fA?.negative_percentage ?? fA?.neg ?? null;
              const posB: number | null = fB?.positive_percentage ?? fB?.pos ?? null;
              const negB: number | null = fB?.negative_percentage ?? fB?.neg ?? null;
              const posDiff = posA !== null && posB !== null ? posB - posA : null;
              const negDiff = negA !== null && negB !== null ? negB - negA : null;
              const posImproved = posDiff !== null ? posDiff > 0 : null;
              const negImproved = negDiff !== null ? negDiff < 0 : null;
              const verdict: Verdict =
                posImproved === null && negImproved === null ? "unknown"
                : posImproved && negImproved ? "full"
                : posImproved ? "pos_only"
                : negImproved ? "neg_only"
                : "none";
              return { aspect, posA, negA, posB, negB, posDiff, negDiff, verdict };
            });

            const fullCount = rows.filter(r => r.verdict === "full").length;
            const noneCount = rows.filter(r => r.verdict === "none").length;

            const verdictUI = (v: Verdict) => ({
              full:     { label: "✅ 改善", cls: "bg-green-100 text-green-700" },
              pos_only: { label: "△ ポジ↑", cls: "bg-green-50 text-green-600" },
              neg_only: { label: "△ ネガ↓", cls: "bg-blue-50 text-blue-600" },
              none:     { label: "❌ 悪化", cls: "bg-red-100 text-red-600" },
              unknown:  { label: "— データなし", cls: "bg-muted text-muted-foreground" },
            }[v]);

            return (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Layers className="h-4 w-4 text-primary" />
                    マクロ分析（改善チェック）
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      {fullCount > 0 && <span className="text-green-600 font-semibold">{fullCount}側面が改善　</span>}
                      {noneCount > 0 && <span className="text-red-500 font-semibold">{noneCount}側面が悪化</span>}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {/* 列ヘッダー */}
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-0 text-[10px] font-semibold text-muted-foreground pb-1.5 border-b mb-1">
                    <span>側面</span>
                    <span className="w-32 text-center">ポジ A→B</span>
                    <span className="w-32 text-center">ネガ A→B</span>
                    <span className="w-16 text-center">判定</span>
                  </div>
                  <div className="space-y-0">
                    {rows.map(({ aspect, posA, negA, posB, negB, posDiff, negDiff, verdict }) => {
                      const ui = verdictUI(verdict);
                      return (
                        <div key={aspect} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center py-2.5 border-b last:border-0">
                          {/* 側面名 */}
                          <span className="text-xs font-medium">{aspect}</span>

                          {/* ポジ A→B */}
                          <div className="w-32 space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-blue-600">{posA !== null ? `${posA}%` : "—"}</span>
                              <span className="text-muted-foreground mx-1">→</span>
                              <span className={`font-semibold ${posA !== null && posB !== null ? (posB > posA ? "text-green-600" : posB < posA ? "text-red-500" : "text-muted-foreground") : "text-muted-foreground"}`}>
                                {posB !== null ? `${posB}%` : "—"}
                              </span>
                              {posDiff !== null && posDiff !== 0 && (
                                <span className={`ml-1 text-[10px] font-bold ${posDiff > 0 ? "text-green-600" : "text-red-500"}`}>
                                  {posDiff > 0 ? `+${posDiff}` : posDiff}
                                </span>
                              )}
                            </div>
                            {posA !== null && posB !== null && (
                              <div className="flex h-1.5 rounded-full bg-muted overflow-hidden">
                                <div className="bg-blue-400 transition-all" style={{ width: `${posA}%` }} />
                              </div>
                            )}
                            {posB !== null && (
                              <div className="flex h-1.5 rounded-full bg-muted overflow-hidden">
                                <div className={`transition-all ${(posB ?? 0) >= (posA ?? 0) ? "bg-green-500" : "bg-orange-400"}`} style={{ width: `${posB}%` }} />
                              </div>
                            )}
                          </div>

                          {/* ネガ A→B */}
                          <div className="w-32 space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-red-400">{negA !== null ? `${negA}%` : "—"}</span>
                              <span className="text-muted-foreground mx-1">→</span>
                              <span className={`font-semibold ${negA !== null && negB !== null ? (negB < negA ? "text-green-600" : negB > negA ? "text-red-500" : "text-muted-foreground") : "text-muted-foreground"}`}>
                                {negB !== null ? `${negB}%` : "—"}
                              </span>
                              {negDiff !== null && negDiff !== 0 && (
                                <span className={`ml-1 text-[10px] font-bold ${negDiff < 0 ? "text-green-600" : "text-red-500"}`}>
                                  {negDiff > 0 ? `+${negDiff}` : negDiff}
                                </span>
                              )}
                            </div>
                            {negA !== null && negB !== null && (
                              <div className="flex h-1.5 rounded-full bg-muted overflow-hidden">
                                <div className="bg-red-300 transition-all" style={{ width: `${negA}%` }} />
                              </div>
                            )}
                            {negB !== null && (
                              <div className="flex h-1.5 rounded-full bg-muted overflow-hidden">
                                <div className={`transition-all ${(negB ?? 0) <= (negA ?? 0) ? "bg-green-500" : "bg-red-500"}`} style={{ width: `${negB}%` }} />
                              </div>
                            )}
                          </div>

                          {/* 判定 */}
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full w-16 text-center ${ui.cls}`}>
                            {ui.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* ---- ポジ/ネガ頻出ワード比較 ---- */}
          {((dataA.report?.positiveWords?.length ?? 0) > 0 || (dataA.report?.negativeWords?.length ?? 0) > 0 ||
            (dataB.report?.positiveWords?.length ?? 0) > 0 || (dataB.report?.negativeWords?.length ?? 0) > 0) && (() => {
            const posA: string[] = (dataA.report as any)?.positiveWords ?? [];
            const posB: string[] = (dataB.report as any)?.positiveWords ?? [];
            const negA: string[] = (dataA.report as any)?.negativeWords ?? [];
            const negB: string[] = (dataB.report as any)?.negativeWords ?? [];
            const posSetA = new Set(posA);
            const posSetB = new Set(posB);
            const negSetA = new Set(negA);
            const negSetB = new Set(negB);
            // ポジ: 新登場(B only) / 継続(both) / 消えた(A only)
            const posNew      = posB.filter(w => !posSetA.has(w));
            const posContinue = posB.filter(w => posSetA.has(w));
            const posGone     = posA.filter(w => !posSetB.has(w));
            // ネガ: 新登場(B only) / 継続(both) / 消えた(A only)
            const negNew      = negB.filter(w => !negSetA.has(w));
            const negGone     = negA.filter(w => !negSetB.has(w));
            const negContinue = negB.filter(w => negSetA.has(w));
            const WordTag = ({ word, variant }: { word: string; variant: "new" | "gone" | "cont" }) => (
              <span className={`inline-flex items-center text-[11px] px-1.5 py-0.5 rounded font-medium ${
                variant === "new"  ? "bg-green-100 text-green-700" :
                variant === "gone" ? "bg-red-50 text-red-400 line-through" :
                "bg-muted text-muted-foreground"
              }`}>{word}</span>
            );
            return (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  頻出ワード変化（A→B）
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* ポジ */}
                {(posA.length > 0 || posB.length > 0) && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-green-700">ポジティブワード</span>
                      {posNew.length > 0 && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-bold">✨ +{posNew.length}語 新登場</span>}
                      {posGone.length > 0 && <span className="text-[10px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded-full font-bold">👻 {posGone.length}語 消えた</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {posNew.map(w => <WordTag key={`pn-${w}`} word={w} variant="new" />)}
                      {posContinue.map(w => <WordTag key={`pc-${w}`} word={w} variant="cont" />)}
                      {posGone.map(w => <WordTag key={`pg-${w}`} word={w} variant="gone" />)}
                    </div>
                    <div className="flex gap-3 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-green-100 inline-block" />✨ 新登場</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-muted inline-block" />継続</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-red-50 inline-block" />👻 消えた</span>
                    </div>
                  </div>
                )}

                {/* ネガ */}
                {(negA.length > 0 || negB.length > 0) && (
                  <div className="space-y-2 pt-3 border-t">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-red-600">ネガティブワード</span>
                      {negGone.length > 0 && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-bold">✅ {negGone.length}語 消えた（改善）</span>}
                      {negNew.length > 0 && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold">⚠️ {negNew.length}語 新登場</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {negGone.map(w => <WordTag key={`ng-${w}`} word={w} variant="gone" />)}
                      {negContinue.map(w => <WordTag key={`nc-${w}`} word={w} variant="cont" />)}
                      {negNew.map(w => <WordTag key={`nn-${w}`} word={w} variant="new" />)}
                    </div>
                    <div className="flex gap-3 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-red-50 inline-block" />👻 消えた（改善）</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-muted inline-block" />継続中</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-green-100 inline-block" />⚠️ 新登場</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
            );
          })()}

          {/* ---- 動画ミクロ分析（keyInsights）比較 ---- */}
          {((dataA.report?.keyInsights?.length ?? 0) > 0 || (dataB.report?.keyInsights?.length ?? 0) > 0) && (() => {
            const insightsA: any[] = (dataA.report as any)?.keyInsights ?? [];
            const insightsB: any[] = (dataB.report as any)?.keyInsights ?? [];
            const maxLen = Math.max(insightsA.length, insightsB.length);
            // videoId → 参照番号マップ（再生数降順 top15）
            const buildRefMap = (videos: any[]) => {
              const sorted = [...videos].sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0)).slice(0, 15);
              return new Map<string, number>(sorted.map((v, i) => [v.videoId, i + 1]));
            };
            const refMapA = buildRefMap(dataA.videos ?? []);
            const refMapB = buildRefMap(dataB.videos ?? []);
            const renderRefs = (sourceVideoIds: string[] | undefined, refMap: Map<string, number>, videos: any[], color: "blue" | "amber") => {
              if (!sourceVideoIds?.length) return null;
              const refs = sourceVideoIds
                .map(id => ({ id, num: refMap.get(id), video: videos.find((v: any) => v.videoId === id) }))
                .filter(r => r.num !== undefined);
              if (!refs.length) return null;
              const linkCls = color === "blue" ? "text-blue-600 hover:text-blue-800" : "text-amber-600 hover:text-amber-800";
              return (
                <div className="flex flex-wrap gap-1 pt-1">
                  {refs.map(r => (
                    <a
                      key={r.id}
                      href={`https://www.tiktok.com/@${r.video?.accountId}/video/${r.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={r.video?.title || r.id}
                      className={`text-[10px] font-medium hover:underline ${linkCls}`}
                    >
                      [参照{r.num}]
                    </a>
                  ))}
                </div>
              );
            };
            const catBadge = (cat: string) => {
              const map: Record<string, { label: string; cls: string }> = {
                avoid: { label: "🚫 回避", cls: "bg-red-50 text-red-600 border-red-200" },
                risk: { label: "🚫 回避", cls: "bg-red-50 text-red-600 border-red-200" },
                caution: { label: "⚠️ 注意", cls: "bg-orange-50 text-orange-600 border-orange-200" },
                urgent: { label: "⚠️ 注意", cls: "bg-orange-50 text-orange-600 border-orange-200" },
                leverage: { label: "✅ 活用", cls: "bg-green-50 text-green-600 border-green-200" },
                positive: { label: "✅ 活用", cls: "bg-green-50 text-green-600 border-green-200" },
              };
              const entry = map[cat] ?? { label: cat, cls: "bg-muted text-muted-foreground border-border" };
              return (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${entry.cls}`}>
                  {entry.label}
                </span>
              );
            };
            return (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Lightbulb className="h-4 w-4 text-primary" />
                    動画ミクロ分析
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 mb-2">
                    <div className="text-xs font-semibold text-blue-700 px-1">分析 A</div>
                    <div className="text-xs font-semibold text-amber-600 px-1">分析 B</div>
                  </div>
                  <div className="space-y-2">
                    {Array.from({ length: maxLen }).map((_, i) => {
                      const iA = insightsA[i];
                      const iB = insightsB[i];
                      return (
                        <div key={i} className="grid grid-cols-2 gap-3">
                          {iA ? (
                            <div className="p-2.5 rounded-lg bg-blue-50/60 border border-blue-200/60 space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {catBadge(iA.category)}
                              </div>
                              <p className="text-xs font-semibold leading-snug">{iA.title}</p>
                              <p className="text-[11px] text-muted-foreground leading-relaxed">{iA.description}</p>
                              {renderRefs(iA.sourceVideoIds, refMapA, dataA.videos ?? [], "blue")}
                            </div>
                          ) : <div />}
                          {iB ? (
                            <div className="p-2.5 rounded-lg bg-amber-50/60 border border-amber-200/60 space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {catBadge(iB.category)}
                              </div>
                              <p className="text-xs font-semibold leading-snug">{iB.title}</p>
                              <p className="text-[11px] text-muted-foreground leading-relaxed">{iB.description}</p>
                              {renderRefs(iB.sourceVideoIds, refMapB, dataB.videos ?? [], "amber")}
                            </div>
                          ) : <div />}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* ---- 分析対象動画 比較（継続・新規・消えた）---- */}
          {(() => {
            const videosA = dataA.videos ?? [];
            const videosB = dataB.videos ?? [];
            const idsA = new Set(videosA.map((v: any) => v.videoId));
            const idsB = new Set(videosB.map((v: any) => v.videoId));

            const continued = videosA
              .filter((v: any) => idsB.has(v.videoId))
              .map((vA: any) => {
                const rankA = videosA.findIndex((v: any) => v.videoId === vA.videoId) + 1;
                const rankB = videosB.findIndex((v: any) => v.videoId === vA.videoId) + 1;
                return { ...vA, rankA, rankB, diff: rankA - rankB };
              })
              .sort((a: any, b: any) => a.rankB - b.rankB);

            const newlyIn = videosB
              .filter((v: any) => !idsA.has(v.videoId))
              .map((v: any, i: number) => ({ ...v, rankB: i + 1 }));

            const disappeared = videosA
              .filter((v: any) => !idsB.has(v.videoId))
              .map((v: any, i: number) => ({ ...v, rankA: i + 1 }));

            const VideoRow = ({ v, rankA, rankB, diff, side }: any) => (
              <div className={`flex items-center gap-3 p-2.5 rounded-lg border ${
                side === "new" ? "bg-green-50/50 border-green-200/60" :
                side === "gone" ? "bg-gray-50/50 border-gray-200/60 opacity-70" :
                "bg-muted/30 border-border/60"
              }`}>
                <img
                  src={v.thumbnailUrl || "https://placehold.co/48x32/8A2BE2/white?text=No"}
                  alt=""
                  className="w-16 h-10 object-cover rounded shrink-0"
                  referrerPolicy="no-referrer"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = "https://placehold.co/48x32/8A2BE2/white?text=No"; }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium line-clamp-1">{v.title || "タイトルなし"}</p>
                  <p className="text-[10px] text-muted-foreground">@{v.accountId}</p>
                </div>
                <div className="shrink-0 text-right">
                  {side === "continued" && (
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-muted-foreground">A:{rankA}位</span>
                      <span className="text-[11px]">→</span>
                      <span className="text-[11px] font-bold">B:{rankB}位</span>
                      {diff > 0 && <span className="text-[10px] text-green-600 font-bold flex items-center gap-0.5"><ArrowUp className="h-2.5 w-2.5" />{diff}</span>}
                      {diff < 0 && <span className="text-[10px] text-red-500 font-bold flex items-center gap-0.5"><ArrowDown className="h-2.5 w-2.5" />{Math.abs(diff)}</span>}
                      {diff === 0 && <span className="text-[10px] text-muted-foreground">—</span>}
                    </div>
                  )}
                  {side === "new" && <span className="text-[11px] font-bold text-green-600">B:{rankB}位 NEW</span>}
                  {side === "gone" && <span className="text-[11px] text-muted-foreground">A:{rankA}位 消</span>}
                </div>
              </div>
            );

            return (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Video className="h-4 w-4 text-primary" />
                    分析対象動画
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      A:{videosA.length}本 / B:{videosB.length}本
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* 継続出現 */}
                  {continued.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold text-foreground">🔁 継続出現</span>
                        <span className="text-[10px] text-muted-foreground">{continued.length}本 — 両方の分析に登場</span>
                      </div>
                      <div className="space-y-1.5">
                        {continued.slice(0, 10).map((v: any) => (
                          <VideoRow key={v.videoId} v={v} rankA={v.rankA} rankB={v.rankB} diff={v.diff} side="continued" />
                        ))}
                        {continued.length > 10 && (
                          <p className="text-[11px] text-muted-foreground text-center pt-1">…他 {continued.length - 10} 本</p>
                        )}
                      </div>
                    </div>
                  )}
                  {/* 新規出現 */}
                  {newlyIn.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="h-3.5 w-3.5 text-green-500" />
                        <span className="text-xs font-semibold text-green-700">B で新規出現</span>
                        <span className="text-[10px] text-muted-foreground">{newlyIn.length}本 — A には未登場</span>
                      </div>
                      <div className="space-y-1.5">
                        {newlyIn.slice(0, 8).map((v: any) => (
                          <VideoRow key={v.videoId} v={v} rankB={v.rankB} side="new" />
                        ))}
                        {newlyIn.length > 8 && (
                          <p className="text-[11px] text-muted-foreground text-center pt-1">…他 {newlyIn.length - 8} 本</p>
                        )}
                      </div>
                    </div>
                  )}
                  {/* 消えた動画 */}
                  {disappeared.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Ghost className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground">A から消えた</span>
                        <span className="text-[10px] text-muted-foreground">{disappeared.length}本 — B に未登場</span>
                      </div>
                      <div className="space-y-1.5">
                        {disappeared.slice(0, 8).map((v: any) => (
                          <VideoRow key={v.videoId} v={v} rankA={v.rankA} side="gone" />
                        ))}
                        {disappeared.length > 8 && (
                          <p className="text-[11px] text-muted-foreground text-center pt-1">…他 {disappeared.length - 8} 本</p>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}


        </div>
      </div>
    </div>
  );
}
