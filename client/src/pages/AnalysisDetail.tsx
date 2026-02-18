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
import { Loader2, ArrowLeft, Play, Eye, Heart, MessageCircle, Share2, Bookmark, Users, TrendingUp, TrendingDown, Minus } from "lucide-react";
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

    // ポジネガのみの比率
    const posNegTotal = sentimentCounts.positive + sentimentCounts.negative;
    const posNegRatio = {
      positive: posNegTotal > 0 ? ((sentimentCounts.positive / posNegTotal) * 100).toFixed(1) : "0",
      negative: posNegTotal > 0 ? ((sentimentCounts.negative / posNegTotal) * 100).toFixed(1) : "0",
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
      topKeywords,
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
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
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
                    {job.status === "failed" && "分析に失敗しました"}
                    {job.status === "pending" && "分析を開始してください"}
                  </CardDescription>
                </div>
                {job.status === "pending" && (
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
                        分析を実行
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

          {/* Report Section (Accordion) */}
          {reportStats && job.status === "completed" && (
            <Card>
              <CardHeader>
                <CardTitle>分析レポート</CardTitle>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible className="w-full">
                  {/* サマリー情報 */}
                  <AccordionItem value="summary">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">📊 サマリー情報</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="grid grid-cols-3 gap-4 pt-4">
                        <div className="text-center">
                          <div className="text-3xl font-bold text-purple-600">{reportStats.totalVideos}</div>
                          <div className="text-sm text-muted-foreground">総動画数</div>
                        </div>
                        <div className="text-center">
                          <div className="text-3xl font-bold text-blue-600">{formatNumber(reportStats.totalViews)}</div>
                          <div className="text-sm text-muted-foreground">総再生数</div>
                        </div>
                        <div className="text-center">
                          <div className="text-3xl font-bold text-orange-600">{formatNumber(reportStats.totalEngagement)}</div>
                          <div className="text-sm text-muted-foreground">総エンゲージメント</div>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* センチメント構成比 */}
                  <AccordionItem value="sentiment">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">😊 センチメント構成比</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="pt-4 space-y-4">
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="flex items-center gap-2">
                              <TrendingDown className="h-4 w-4 text-red-500" />
                              Negative
                            </span>
                            <span className="font-semibold">{reportStats.sentimentPercentages.negative}%</span>
                          </div>
                          <Progress value={Number(reportStats.sentimentPercentages.negative)} className="h-2 bg-red-100 [&>div]:bg-red-500" />
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="flex items-center gap-2">
                              <Minus className="h-4 w-4 text-gray-500" />
                              Neutral
                            </span>
                            <span className="font-semibold">{reportStats.sentimentPercentages.neutral}%</span>
                          </div>
                          <Progress value={Number(reportStats.sentimentPercentages.neutral)} className="h-2 bg-gray-100 [&>div]:bg-gray-500" />
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="flex items-center gap-2">
                              <TrendingUp className="h-4 w-4 text-green-500" />
                              Positive
                            </span>
                            <span className="font-semibold">{reportStats.sentimentPercentages.positive}%</span>
                          </div>
                          <Progress value={Number(reportStats.sentimentPercentages.positive)} className="h-2 bg-green-100 [&>div]:bg-green-500" />
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* ポジネガ比較 */}
                  <AccordionItem value="posneg">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">⚖️ ポジネガ比較</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="pt-4 space-y-4">
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="flex items-center gap-2">
                              <TrendingUp className="h-4 w-4 text-green-500" />
                              Positive
                            </span>
                            <span className="font-semibold">{reportStats.posNegRatio.positive}%</span>
                          </div>
                          <Progress value={Number(reportStats.posNegRatio.positive)} className="h-2 bg-green-100 [&>div]:bg-green-500" />
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="flex items-center gap-2">
                              <TrendingDown className="h-4 w-4 text-red-500" />
                              Negative
                            </span>
                            <span className="font-semibold">{reportStats.posNegRatio.negative}%</span>
                          </div>
                          <Progress value={Number(reportStats.posNegRatio.negative)} className="h-2 bg-red-100 [&>div]:bg-red-500" />
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* 頻出ワード */}
                  <AccordionItem value="keywords">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">🏷️ 頻出キーワード</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="pt-4">
                        <div className="flex flex-wrap gap-2">
                          {reportStats.topKeywords.map((keyword, i) => (
                            <Badge key={i} variant="secondary" className="text-sm">
                              {keyword}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  {/* 主要示唆 */}
                  <AccordionItem value="insights">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">💡 主要示唆</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="pt-4 space-y-4">
                        <div className="border-l-4 border-red-500 pl-4">
                          <div className="font-semibold text-red-600">RISK: ネガティブ動画の拡散力</div>
                          <p className="text-sm text-muted-foreground mt-1">
                            Negative動画は投稿数の{reportStats.sentimentPercentages.negative}%を占め、高い拡散力を持っています。
                          </p>
                        </div>
                        <div className="border-l-4 border-green-500 pl-4">
                          <div className="font-semibold text-green-600">POSITIVE: ポジティブコンテンツの増幅</div>
                          <p className="text-sm text-muted-foreground mt-1">
                            Positiveコンテンツは現在{reportStats.sentimentPercentages.positive}%ですが、インフルエンサー施策の強化により好意形成を加速できます。
                          </p>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardContent>
            </Card>
          )}

          {/* Videos Accordion */}
          {videos.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>分析対象動画 ({videos.length}件)</CardTitle>
              </CardHeader>
              <CardContent>
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
                                : `https://www.youtube.com/embed/${video.videoId}`}
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
                                <span className="font-medium">{video.platform === "tiktok" ? "TikTok" : "YouTube Shorts"}</span>
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
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  {job.status === "pending" 
                    ? "「分析を実行」ボタンをクリックして分析を開始してください" 
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
