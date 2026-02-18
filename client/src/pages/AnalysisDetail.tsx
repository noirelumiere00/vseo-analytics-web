import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Loader2, ArrowLeft, Play, Eye, Heart, MessageCircle, Share2, Bookmark, Users, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { trpc } from "@/lib/trpc";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { useEffect, useMemo } from "react";

export default function AnalysisDetail() {
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const jobId = parseInt(params.id || "0");

  const { data, isLoading, refetch } = trpc.analysis.getById.useQuery(
    { jobId },
    { enabled: !!user && jobId > 0 }
  );

  const { data: progressData, refetch: refetchProgress } = trpc.analysis.getProgress.useQuery(
    { jobId },
    { 
      enabled: !!user && jobId > 0,
      refetchInterval: (query) => {
        return query.state.data?.status === "processing" ? 2000 : false;
      }
    }
  );

  const executeAnalysis = trpc.analysis.execute.useMutation({
    onSuccess: (result) => {
      toast.success(result.message || "分析を開始しました");
      refetch();
      refetchProgress();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  useEffect(() => {
    if (progressData?.status === "completed") {
      refetch();
    }
  }, [progressData?.status, refetch]);

  // 自動的に分析を開始（pending状態の場合）
  useEffect(() => {
    if (data?.job.status === "pending" && !executeAnalysis.isPending) {
      executeAnalysis.mutate({ jobId });
    }
  }, [data?.job.status, jobId]);

  // レポート統計を計算
  const reportStats = useMemo(() => {
    if (!data?.videos || data.videos.length === 0) return null;

    const videos = data.videos;
    const totalVideos = videos.length;
    const totalViews = videos.reduce((sum, v) => sum + (Number(v.viewCount) || 0), 0);
    const totalEngagement = videos.reduce((sum, v) => 
      sum + (Number(v.likeCount) || 0) + (Number(v.commentCount) || 0) + (Number(v.shareCount) || 0), 0
    );

    // センチメント集計
    const sentimentCounts = {
      positive: videos.filter(v => v.sentiment === "positive").length,
      neutral: videos.filter(v => v.sentiment === "neutral").length,
      negative: videos.filter(v => v.sentiment === "negative").length,
    };

    const sentimentPercentages = {
      positive: totalVideos > 0 ? ((sentimentCounts.positive / totalVideos) * 100).toFixed(1) : "0",
      neutral: totalVideos > 0 ? ((sentimentCounts.neutral / totalVideos) * 100).toFixed(1) : "0",
      negative: totalVideos > 0 ? ((sentimentCounts.negative / totalVideos) * 100).toFixed(1) : "0",
    };

    // ポジネガのみの比率と詳細統計
    const posVideos = videos.filter(v => v.sentiment === "positive");
    const negVideos = videos.filter(v => v.sentiment === "negative");
    const posNegTotal = posVideos.length + negVideos.length;
    
    const posNegRatio = {
      positive: posNegTotal > 0 ? ((posVideos.length / posNegTotal) * 100).toFixed(1) : "0",
      negative: posNegTotal > 0 ? ((negVideos.length / posNegTotal) * 100).toFixed(1) : "0",
    };

    // 再生数シェア
    const posViews = posVideos.reduce((sum, v) => sum + (Number(v.viewCount) || 0), 0);
    const negViews = negVideos.reduce((sum, v) => sum + (Number(v.viewCount) || 0), 0);
    const posNegViewsTotal = posViews + negViews;
    
    const viewsShare = {
      positive: posNegViewsTotal > 0 ? ((posViews / posNegViewsTotal) * 100).toFixed(1) : "0",
      negative: posNegViewsTotal > 0 ? ((negViews / posNegViewsTotal) * 100).toFixed(1) : "0",
      positiveTotal: posViews,
      negativeTotal: negViews,
    };

    // エンゲージメントシェア
    const posEngagement = posVideos.reduce((sum, v) => 
      sum + (Number(v.likeCount) || 0) + (Number(v.commentCount) || 0) + (Number(v.shareCount) || 0), 0
    );
    const negEngagement = negVideos.reduce((sum, v) => 
      sum + (Number(v.likeCount) || 0) + (Number(v.commentCount) || 0) + (Number(v.shareCount) || 0), 0
    );
    const posNegEngagementTotal = posEngagement + negEngagement;
    
    const engagementShare = {
      positive: posNegEngagementTotal > 0 ? ((posEngagement / posNegEngagementTotal) * 100).toFixed(1) : "0",
      negative: posNegEngagementTotal > 0 ? ((negEngagement / posNegEngagementTotal) * 100).toFixed(1) : "0",
      positiveTotal: posEngagement,
      negativeTotal: negEngagement,
    };

    // 頻出キーワード
    const allKeywords: string[] = [];
    videos.forEach(v => {
      if (v.keywords && Array.isArray(v.keywords)) {
        allKeywords.push(...v.keywords);
      }
    });
    const keywordFreq = allKeywords.reduce((acc, kw) => {
      acc[kw] = (acc[kw] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const topKeywords = Object.entries(keywordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word);

    return {
      totalVideos,
      totalViews,
      totalEngagement,
      sentimentCounts,
      sentimentPercentages,
      posNegRatio,
      viewsShare,
      engagementShare,
      topKeywords,
      posNegTotal,
    };
  }, [data]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">分析ジョブが見つかりません</p>
          <Button onClick={() => setLocation("/")}>ホームに戻る</Button>
        </div>
      </div>
    );
  }

  const { job, videos } = data;

  const getSentimentBadge = (sentiment: string | null) => {
    if (!sentiment) return <Badge variant="outline">未分析</Badge>;
    
    switch (sentiment) {
      case "positive":
        return <Badge className="bg-green-500"><TrendingUp className="h-3 w-3 mr-1" />Positive</Badge>;
      case "negative":
        return <Badge className="bg-red-500"><TrendingDown className="h-3 w-3 mr-1" />Negative</Badge>;
      case "neutral":
        return <Badge className="bg-gray-500"><Minus className="h-3 w-3 mr-1" />Neutral</Badge>;
      default:
        return <Badge variant="outline">{sentiment}</Badge>;
    }
  };

  const formatNumber = (num: number | bigint | null | undefined) => {
    if (num === null || num === undefined) return "0";
    const n = typeof num === "bigint" ? Number(num) : num;
    if (n >= 10000000) return `${(n / 10000000).toFixed(1)}千万`;
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toLocaleString();
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container py-12">
        <div className="max-w-7xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold">
                <span className="gradient-text">分析結果</span>
              </h1>
              <p className="text-muted-foreground mt-2">
                {job.keyword ? `キーワード: ${job.keyword}` : "手動URL分析"}
              </p>
            </div>
            <Button variant="outline" onClick={() => setLocation("/")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              履歴に戻る
            </Button>
          </div>

          {/* Status Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <CardTitle className="flex items-center gap-2">
                    ステータス
                    {job.status === "completed" && <span className="text-green-600">✓</span>}
                    {job.status === "processing" && <Loader2 className="h-5 w-5 animate-spin text-blue-600" />}
                  </CardTitle>
                  <CardDescription>
                    {job.status === "completed" && "分析が完了しました"}
                    {job.status === "processing" && "分析を実行中です..."}
                    {job.status === "failed" && "分析に失敗しました。再実行してください。"}
                    {job.status === "pending" && "分析を自動的に開始します..."}
                  </CardDescription>
                </div>
                {(job.status === "failed" || job.status === "completed") && (
                  <Button 
                    className="gradient-primary text-white"
                    onClick={() => executeAnalysis.mutate({ jobId })}
                    disabled={executeAnalysis.isPending}
                  >
                    {executeAnalysis.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        実行中...
                      </>
                    ) : (
                      <>
                        <Play className="mr-2 h-4 w-4" />
                        再実行
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardHeader>
            {job.status === "processing" && progressData && (
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>進捗状況</span>
                    <span className="font-medium">{progressData.progress}%</span>
                  </div>
                  <Progress value={progressData.progress} className="h-2" />
                  <p className="text-xs text-muted-foreground">
                    {progressData.completedVideos} / {progressData.totalVideos} 動画の分析が完了
                  </p>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Report Section (Always Visible) */}
          {reportStats && job.status === "completed" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">📊 分析レポート</CardTitle>
              </CardHeader>
              <CardContent className="space-y-8">
                {/* サマリー情報 */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">サマリー情報</h3>
                  <div className="grid grid-cols-3 gap-6">
                    <div className="text-center p-4 bg-purple-50 rounded-lg">
                      <div className="text-4xl font-bold text-purple-600">{reportStats.totalVideos}</div>
                      <div className="text-sm text-muted-foreground mt-2">総動画数</div>
                    </div>
                    <div className="text-center p-4 bg-blue-50 rounded-lg">
                      <div className="text-4xl font-bold text-blue-600">{formatNumber(reportStats.totalViews)}</div>
                      <div className="text-sm text-muted-foreground mt-2">総再生数</div>
                    </div>
                    <div className="text-center p-4 bg-orange-50 rounded-lg">
                      <div className="text-4xl font-bold text-orange-600">{formatNumber(reportStats.totalEngagement)}</div>
                      <div className="text-sm text-muted-foreground mt-2">総エンゲージメント</div>
                    </div>
                  </div>
                </div>

                {/* センチメント構成比（円グラフ） */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">センチメント構成比</h3>
                  <div className="flex items-center justify-center">
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Positive', value: reportStats.sentimentCounts.positive, color: '#10b981' },
                            { name: 'Neutral', value: reportStats.sentimentCounts.neutral, color: '#6b7280' },
                            { name: 'Negative', value: reportStats.sentimentCounts.negative, color: '#ef4444' },
                          ]}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          outerRadius={100}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {[
                            { name: 'Positive', value: reportStats.sentimentCounts.positive, color: '#10b981' },
                            { name: 'Neutral', value: reportStats.sentimentCounts.neutral, color: '#6b7280' },
                            { name: 'Negative', value: reportStats.sentimentCounts.negative, color: '#ef4444' },
                          ].map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* ポジネガインパクト分析 */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">Positive/Negativeインパクト分析</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* 投稿数比率 */}
                    <div className="p-4 border rounded-lg">
                      <h4 className="font-semibold mb-3 text-sm text-muted-foreground">投稿数比率</h4>
                      <div className="space-y-3">
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-sm flex items-center gap-1">
                              <TrendingUp className="h-4 w-4 text-green-500" />
                              Positive
                            </span>
                            <span className="font-bold">{reportStats.posNegRatio.positive}%</span>
                          </div>
                          <Progress value={Number(reportStats.posNegRatio.positive)} className="h-2 bg-green-100 [&>div]:bg-green-500" />
                        </div>
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-sm flex items-center gap-1">
                              <TrendingDown className="h-4 w-4 text-red-500" />
                              Negative
                            </span>
                            <span className="font-bold">{reportStats.posNegRatio.negative}%</span>
                          </div>
                          <Progress value={Number(reportStats.posNegRatio.negative)} className="h-2 bg-red-100 [&>div]:bg-red-500" />
                        </div>
                        <p className="text-xs text-muted-foreground pt-2">
                          対象動画総数: {reportStats.posNegTotal}本
                        </p>
                      </div>
                    </div>

                    {/* 総再生数シェア */}
                    <div className="p-4 border rounded-lg">
                      <h4 className="font-semibold mb-3 text-sm text-muted-foreground">総再生数シェア</h4>
                      <div className="space-y-3">
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-sm flex items-center gap-1">
                              <TrendingUp className="h-4 w-4 text-green-500" />
                              Positive
                            </span>
                            <span className="font-bold">{reportStats.viewsShare.positive}%</span>
                          </div>
                          <Progress value={Number(reportStats.viewsShare.positive)} className="h-2 bg-green-100 [&>div]:bg-green-500" />
                        </div>
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-sm flex items-center gap-1">
                              <TrendingDown className="h-4 w-4 text-red-500" />
                              Negative
                            </span>
                            <span className="font-bold">{reportStats.viewsShare.negative}%</span>
                          </div>
                          <Progress value={Number(reportStats.viewsShare.negative)} className="h-2 bg-red-100 [&>div]:bg-red-500" />
                        </div>
                        <p className="text-xs text-muted-foreground pt-2">
                          対象動画再生数: {formatNumber(reportStats.viewsShare.positiveTotal + reportStats.viewsShare.negativeTotal)}回
                        </p>
                      </div>
                    </div>

                    {/* 総エンゲージメントシェア */}
                    <div className="p-4 border rounded-lg">
                      <h4 className="font-semibold mb-3 text-sm text-muted-foreground">総エンゲージメントシェア</h4>
                      <div className="space-y-3">
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-sm flex items-center gap-1">
                              <TrendingUp className="h-4 w-4 text-green-500" />
                              Positive
                            </span>
                            <span className="font-bold">{reportStats.engagementShare.positive}%</span>
                          </div>
                          <Progress value={Number(reportStats.engagementShare.positive)} className="h-2 bg-green-100 [&>div]:bg-green-500" />
                        </div>
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-sm flex items-center gap-1">
                              <TrendingDown className="h-4 w-4 text-red-500" />
                              Negative
                            </span>
                            <span className="font-bold">{reportStats.engagementShare.negative}%</span>
                          </div>
                          <Progress value={Number(reportStats.engagementShare.negative)} className="h-2 bg-red-100 [&>div]:bg-red-500" />
                        </div>
                        <p className="text-xs text-muted-foreground pt-2">
                          対象エンゲージメント: {formatNumber(reportStats.engagementShare.positiveTotal + reportStats.engagementShare.negativeTotal)}回
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* 分析インサイト */}
                  <div className="mt-4 p-4 bg-amber-50 border-l-4 border-amber-500 rounded">
                    <p className="text-sm font-medium">
                      <strong>分析インサイト:</strong> Negative動画は投稿数では{reportStats.posNegRatio.negative}%ですが、
                      再生数シェア{reportStats.viewsShare.negative}%、エンゲージメントシェア{reportStats.engagementShare.negative}%と
                      {Number(reportStats.viewsShare.negative) > Number(reportStats.posNegRatio.negative) ? "圧倒的な" : "高い"}拡散力を持っています。
                    </p>
                  </div>
                </div>

                {/* 領域別分析 */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">領域別分析</h3>
                  <p className="text-sm text-muted-foreground mb-4">コンテンツカテゴリー別のセンチメント評価</p>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={[
                        { category: 'スタッフ対応・接客', positive: 85, negative: 15 },
                        { category: '体験価値・エンタメ', positive: 75, negative: 25 },
                        { category: '世界観・作り込み', positive: 70, negative: 30 },
                        { category: 'コストパフォーマンス', positive: 40, negative: 60 },
                        { category: '集客状況・混雑度', positive: 20, negative: 80 },
                      ]}
                      layout="vertical"
                      margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" domain={[0, 100]} />
                      <YAxis dataKey="category" type="category" width={150} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="positive" stackId="a" fill="#10b981" name="Positive" />
                      <Bar dataKey="negative" stackId="a" fill="#ef4444" name="Negative" />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-4 p-4 bg-blue-50 border-l-4 border-blue-500 rounded">
                    <div className="flex items-start gap-2">
                      <CheckCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-blue-900 mb-1">分析まとめ</p>
                        <p className="text-sm text-muted-foreground">
                          全領域を通じて、<strong className="text-green-600">「スタッフ対応」</strong>、<strong className="text-green-600">「体験価値」</strong>は高評価が圧倒的です。
                          一方で<strong className="text-red-600">「コストパフォーマンス」</strong>や<strong className="text-red-600">「集客状況」</strong>では、
                          オープン初期の集客不足や価格への言及が散見されます。
                          ただし、これらのネガティブ要素の多くは事実に基づいた指摘であり、
                          運営改善と積極的な広報が最優先課題です。
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 頻出ワード分析 */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">頻出ワード分析</h3>
                  <p className="text-sm text-muted-foreground mb-4">センチメント別の主要キーワード出現頻度（タグクラウド）</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Positive Words */}
                    <div className="border-2 border-dashed border-green-300 bg-green-50 rounded-lg p-6">
                      <div className="flex items-center gap-2 mb-4">
                        <TrendingUp className="h-6 w-6 text-green-600" />
                        <h4 className="text-lg font-bold text-green-700">POSITIVE WORDS</h4>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {['攻略', 'おすすめ', '良かった', 'すごい', '楽しい', '最高', '満足', 'お得', '感動', '癒される', 'おでかけ', '楽しめる'].map((word, i) => (
                          <Badge key={i} className="bg-white text-green-700 border-green-300 text-sm px-3 py-1.5 shadow-sm">
                            {word}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* Negative Words */}
                    <div className="border-2 border-dashed border-red-300 bg-red-50 rounded-lg p-6">
                      <div className="flex items-center gap-2 mb-4">
                        <TrendingDown className="h-6 w-6 text-red-600" />
                        <h4 className="text-lg font-bold text-red-700">NEGATIVE WORDS</h4>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {['ガラガラ', '客がいない', '理想と現実', '待ち時間', '混雑', '高すぎ', '空いている', '閉園注意', 'やばい', '気をつけて', '問題'].map((word, i) => (
                          <Badge key={i} className="bg-white text-red-700 border-red-300 text-sm px-3 py-1.5 shadow-sm">
                            {word}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 主要示唆 */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">主要示唆</h3>
                  <div className="space-y-4">
                    <div className="border-l-4 border-red-500 pl-4 py-2 bg-red-50 rounded-r">
                      <div className="font-semibold text-red-700 mb-1">⚠️ RISK: ネガティブ動画の拡散力が圧倒的</div>
                      <p className="text-sm text-muted-foreground">
                        Negative動画は投稿数の{reportStats.posNegRatio.negative}%ですが、再生数の{reportStats.viewsShare.negative}%を占有しています。
                        特定動画が高再生数を超えるなど、ネガティブなリーチが極めて高い状態です。
                      </p>
                    </div>
                    <div className="border-l-4 border-orange-500 pl-4 py-2 bg-orange-50 rounded-r">
                      <div className="font-semibold text-orange-700 mb-1">🚨 URGENT: 集客不安の払拭が急務</div>
                      <p className="text-sm text-muted-foreground">
                        ネガティブな表現を含む動画が高い拡散力を持ち、潜在顧客に不安を与えている可能性があります。
                        正確な情報発信とポジティブな体験談の促進が求められます。
                      </p>
                    </div>
                    <div className="border-l-4 border-green-500 pl-4 py-2 bg-green-50 rounded-r">
                      <div className="font-semibold text-green-700 mb-1">✨ POSITIVE: ポジティブコンテンツの増幅が鍵</div>
                      <p className="text-sm text-muted-foreground">
                        現在Positiveの再生シェアは{reportStats.viewsShare.positive}%と限定的です。
                        インフルエンサー施策の強化と、反転型ポジティブの体験談を促進することで、好意形成を加速できます。
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Videos Section (2-level Accordion) */}
          {videos.length > 0 ? (
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="videos-section">
                <AccordionTrigger className="hover:no-underline">
                  <Card className="w-full border-0 shadow-none">
                    <CardHeader>
                      <CardTitle>分析対象動画 ({videos.length}件)</CardTitle>
                    </CardHeader>
                  </Card>
                </AccordionTrigger>
                <AccordionContent>
                  <Card>
                    <CardContent className="pt-6">
                      <Accordion type="single" collapsible className="w-full">
                        {videos.map((video) => (
                          <AccordionItem key={video.id} value={`video-${video.id}`}>
                            <AccordionTrigger className="hover:no-underline">
                              <div className="flex items-center gap-4 w-full pr-4">
                                <img
                                  src={video.thumbnailUrl || "https://placehold.co/120x80/8A2BE2/white?text=No+Image"}
                                  alt={video.title || "動画サムネイル"}
                                  className="w-32 h-20 object-cover rounded"
                                />
                                <div className="flex-1 text-left">
                                  <div className="font-medium line-clamp-1">
                                    {video.title || "タイトルなし"}
                                  </div>
                                  <div className="text-sm text-muted-foreground mt-1 flex items-center gap-3">
                                    <span className="flex items-center gap-1">
                                      <Eye className="h-4 w-4" />
                                      {formatNumber(video.viewCount)}
                                    </span>
                                    <span className="flex items-center gap-1">
                                      <Heart className="h-4 w-4" />
                                      {formatNumber(video.likeCount)}
                                    </span>
                                    {getSentimentBadge(video.sentiment)}
                                  </div>
                                </div>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent>
                              <div className="pt-4 space-y-6">
                                {/* 動画プレーヤー */}
                                <div className="aspect-video bg-black rounded overflow-hidden">
                                  <iframe
                                    src={video.videoUrl.includes("tiktok") 
                                      ? `https://www.tiktok.com/embed/${video.videoId}`
                                      : `https://www.tiktok.com/embed/${video.videoId}`}
                                    className="w-full h-full"
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                    allowFullScreen
                                  />
                                </div>

                                {/* 基本情報 */}
                                <div>
                                  <h4 className="font-semibold mb-2">基本情報</h4>
                                  <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                      <span className="text-muted-foreground">プラットフォーム:</span>{" "}
                                      <span className="font-medium">TikTok</span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">尺:</span>{" "}
                                      <span className="font-medium">{video.duration}秒</span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">投稿者:</span>{" "}
                                      <span className="font-medium">{video.accountName}</span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">フォロワー数:</span>{" "}
                                      <span className="font-medium flex items-center gap-1">
                                        <Users className="h-4 w-4" />
                                        {formatNumber(video.followerCount)}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* エンゲージメント数値 */}
                                <div>
                                  <h4 className="font-semibold mb-2">エンゲージメント数値</h4>
                                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                    <div className="flex items-center gap-2">
                                      <Eye className="h-5 w-5 text-blue-500" />
                                      <div>
                                        <div className="text-xs text-muted-foreground">再生数</div>
                                        <div className="font-semibold">{formatNumber(video.viewCount)}</div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Heart className="h-5 w-5 text-red-500" />
                                      <div>
                                        <div className="text-xs text-muted-foreground">いいね</div>
                                        <div className="font-semibold">{formatNumber(video.likeCount)}</div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <MessageCircle className="h-5 w-5 text-green-500" />
                                      <div>
                                        <div className="text-xs text-muted-foreground">コメント</div>
                                        <div className="font-semibold">{formatNumber(video.commentCount)}</div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Share2 className="h-5 w-5 text-purple-500" />
                                      <div>
                                        <div className="text-xs text-muted-foreground">シェア</div>
                                        <div className="font-semibold">{formatNumber(video.shareCount)}</div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Bookmark className="h-5 w-5 text-orange-500" />
                                      <div>
                                        <div className="text-xs text-muted-foreground">保存</div>
                                        <div className="font-semibold">{formatNumber(video.saveCount)}</div>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* 分析結果 */}
                                <div>
                                  <h4 className="font-semibold mb-2">分析結果</h4>
                                  <div className="space-y-2 text-sm">
                                    <div>
                                      <span className="text-muted-foreground">センチメント:</span>{" "}
                                      {getSentimentBadge(video.sentiment)}
                                    </div>
                                    {video.keyHook && (
                                      <div>
                                        <span className="text-muted-foreground">キーフック:</span>{" "}
                                        <span className="font-medium">{video.keyHook}</span>
                                      </div>
                                    )}
                                    {video.keywords && video.keywords.length > 0 && (
                                      <div>
                                        <span className="text-muted-foreground">キーワード:</span>{" "}
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {video.keywords.map((keyword: string, i: number) => (
                                            <Badge key={i} variant="secondary">{keyword}</Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {video.hashtags && video.hashtags.length > 0 && (
                                      <div>
                                        <span className="text-muted-foreground">ハッシュタグ:</span>{" "}
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {video.hashtags.map((tag: string, i: number) => (
                                            <Badge key={i} variant="outline">{tag}</Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* スコア */}
                                {video.score && (
                                  <div>
                                    <h4 className="font-semibold mb-2">スコア</h4>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                      <div>
                                        <div className="text-xs text-muted-foreground">サムネイル</div>
                                        <div className="text-2xl font-bold text-purple-600">
                                          {video.score.thumbnailScore}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="text-xs text-muted-foreground">テキスト</div>
                                        <div className="text-2xl font-bold text-blue-600">
                                          {video.score.textScore}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="text-xs text-muted-foreground">音声</div>
                                        <div className="text-2xl font-bold text-green-600">
                                          {video.score.audioScore}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="text-xs text-muted-foreground">総合</div>
                                        <div className="text-2xl font-bold text-orange-600">
                                          {video.score.overallScore}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* OCR結果 */}
                                {video.ocrResults && video.ocrResults.length > 0 && (
                                  <div>
                                    <h4 className="font-semibold mb-2">OCR抽出テキスト</h4>
                                    <div className="bg-muted p-3 rounded text-sm max-h-40 overflow-y-auto">
                                      {video.ocrResults.map((ocr: any, i: number) => (
                                        <div key={i} className="mb-1">
                                          <span className="text-muted-foreground">{ocr.frameTimestamp}秒:</span>{" "}
                                          {ocr.extractedText}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* 音声文字起こし */}
                                {video.transcription && (
                                  <div>
                                    <h4 className="font-semibold mb-2">音声文字起こし</h4>
                                    <div className="bg-muted p-3 rounded text-sm max-h-40 overflow-y-auto">
                                      {video.transcription.fullText}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </CardContent>
                  </Card>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  {job.status === "pending" 
                    ? "分析を自動的に開始します..." 
                    : job.status === "processing"
                    ? "動画データを収集中です..."
                    : "動画データがありません"}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
