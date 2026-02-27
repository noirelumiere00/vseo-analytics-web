import React from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, TrendingUp, TrendingDown, Minus, GitCompare } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocation, useSearch } from "wouter";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { useAuth as useAuthHook } from "@/_core/hooks/useAuth";

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
      <span className="flex items-center gap-0.5 text-muted-foreground text-sm font-medium">
        <Minus className="h-3.5 w-3.5" />
        変化なし
      </span>
    );
  }
  const isPositive = value > 0;
  const isGood = invertColor ? !isPositive : isPositive;
  return (
    <span
      className={`flex items-center gap-0.5 text-sm font-medium ${
        isGood ? "text-green-600" : "text-red-500"
      }`}
    >
      {isPositive ? (
        <TrendingUp className="h-3.5 w-3.5" />
      ) : (
        <TrendingDown className="h-3.5 w-3.5" />
      )}
      {isPositive ? "+" : ""}
      {value.toFixed(decimals)}
      {unit}
    </span>
  );
}

// ==============================
// Helper: 単一指標行
// ==============================
function MetricRow({
  label,
  valueA,
  valueB,
  unit = "",
  decimals = 0,
  invertColor = false,
  formatFn,
}: {
  label: string;
  valueA: number;
  valueB: number;
  unit?: string;
  decimals?: number;
  invertColor?: boolean;
  formatFn?: (v: number) => string;
}) {
  const fmt = formatFn ?? ((v: number) => v.toFixed(decimals) + unit);
  const delta = valueB - valueA;
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 py-3 border-b last:border-0">
      <div className="text-right">
        <span className="font-semibold text-lg">{fmt(valueA)}</span>
      </div>
      <div className="flex flex-col items-center gap-0.5 min-w-[110px]">
        <span className="text-xs text-muted-foreground text-center leading-tight">{label}</span>
        <Delta value={delta} unit={unit} decimals={decimals} invertColor={invertColor} />
      </div>
      <div className="text-left">
        <span className="font-semibold text-lg">{fmt(valueB)}</span>
      </div>
    </div>
  );
}

// ==============================
// Helper: 大きい数値フォーマット
// ==============================
function formatBigNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

// ==============================
// Helper: センチメントバー
// ==============================
function SentimentBar({ positive, neutral, negative }: { positive: number; neutral: number; negative: number }) {
  return (
    <div className="flex rounded-full overflow-hidden h-3 w-full">
      <div className="bg-green-500" style={{ width: `${positive}%` }} />
      <div className="bg-gray-300" style={{ width: `${neutral}%` }} />
      <div className="bg-red-500" style={{ width: `${negative}%` }} />
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

  const labelA = dataA.job.keyword
    ? `「${dataA.job.keyword}」`
    : "手動URL分析";
  const labelB = dataB.job.keyword
    ? `「${dataB.job.keyword}」`
    : "手動URL分析";
  const dateA = format(new Date(dataA.job.createdAt), "yyyy/MM/dd HH:mm", { locale: ja });
  const dateB = format(new Date(dataB.job.createdAt), "yyyy/MM/dd HH:mm", { locale: ja });

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

          {/* ---- 対象ラベル行 ---- */}
          <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
            <Card className="border-primary/50 bg-primary/5">
              <CardContent className="py-4 text-center">
                <p className="font-bold text-lg">{labelA}</p>
                <p className="text-sm text-muted-foreground">{dateA}</p>
                <Badge variant="outline" className="mt-1">分析 A</Badge>
              </CardContent>
            </Card>
            <div className="flex flex-col items-center gap-1 text-muted-foreground">
              <GitCompare className="h-6 w-6" />
              <span className="text-xs">vs</span>
            </div>
            <Card className="border-amber-500/50 bg-amber-500/5">
              <CardContent className="py-4 text-center">
                <p className="font-bold text-lg">{labelB}</p>
                <p className="text-sm text-muted-foreground">{dateB}</p>
                <Badge variant="outline" className="mt-1 border-amber-500 text-amber-600">分析 B</Badge>
              </CardContent>
            </Card>
          </div>

          {/* ---- 概要指標 ---- */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">概要</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <MetricRow
                label="総動画数"
                valueA={mA.totalVideos}
                valueB={mB.totalVideos}
                unit="本"
              />
              <MetricRow
                label="総視聴数"
                valueA={mA.totalViews}
                valueB={mB.totalViews}
                formatFn={formatBigNum}
              />
              <MetricRow
                label="平均視聴数"
                valueA={mA.avgViews}
                valueB={mB.avgViews}
                formatFn={formatBigNum}
              />
              <MetricRow
                label="総いいね"
                valueA={mA.totalLikes}
                valueB={mB.totalLikes}
                formatFn={formatBigNum}
              />
              <MetricRow
                label="総コメント"
                valueA={mA.totalComments}
                valueB={mB.totalComments}
                formatFn={formatBigNum}
              />
              <MetricRow
                label="総シェア"
                valueA={mA.totalShares}
                valueB={mB.totalShares}
                formatFn={formatBigNum}
              />
              <MetricRow
                label="総保存"
                valueA={mA.totalSaves}
                valueB={mB.totalSaves}
                formatFn={formatBigNum}
              />
            </CardContent>
          </Card>

          {/* ---- エンゲージメント指標 ---- */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">エンゲージメント</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0">
              <MetricRow
                label="平均ER%"
                valueA={mA.avgER}
                valueB={mB.avgER}
                unit="%"
                decimals={2}
              />
              <MetricRow
                label="平均総合スコア"
                valueA={mA.avgScore}
                valueB={mB.avgScore}
                decimals={1}
              />
            </CardContent>
          </Card>

          {/* ---- 3重検索・ウィンパターン ---- */}
          {(dataA.tripleSearch || dataB.tripleSearch) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">ウィンパターン（3重検索）</CardTitle>
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
              <CardHeader>
                <CardTitle className="text-base">センチメント分布</CardTitle>
              </CardHeader>
              <CardContent>
                {/* ビジュアルバー比較 */}
                <div className="grid grid-cols-[1fr_auto_1fr] gap-6 mb-6">
                  <div className="space-y-2">
                    <SentimentBar
                      positive={mA.sentPosPct}
                      neutral={mA.sentNeuPct}
                      negative={mA.sentNegPct}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span className="text-green-600">ポジ {mA.sentPosPct.toFixed(1)}%</span>
                      <span>中立 {mA.sentNeuPct.toFixed(1)}%</span>
                      <span className="text-red-500">ネガ {mA.sentNegPct.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-center">
                    <span className="text-xs text-muted-foreground">vs</span>
                  </div>
                  <div className="space-y-2">
                    <SentimentBar
                      positive={mB.sentPosPct}
                      neutral={mB.sentNeuPct}
                      negative={mB.sentNegPct}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span className="text-green-600">ポジ {mB.sentPosPct.toFixed(1)}%</span>
                      <span>中立 {mB.sentNeuPct.toFixed(1)}%</span>
                      <span className="text-red-500">ネガ {mB.sentNegPct.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-0">
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
              className="border-primary/50"
            >
              分析 A の詳細を見る
            </Button>
            <Button
              variant="outline"
              onClick={() => setLocation(`/analysis/${idB}`)}
              className="border-amber-500/50"
            >
              分析 B の詳細を見る
            </Button>
          </div>

        </div>
      </div>
    </div>
  );
}
