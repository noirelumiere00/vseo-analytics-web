import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ArrowLeft, Play, Video, FileText, Mic, BarChart3 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";

export default function AnalysisDetail() {
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const jobId = parseInt(params.id || "0");

  const { data, isLoading, refetch } = trpc.analysis.getById.useQuery(
    { jobId },
    { enabled: !!user && jobId > 0 }
  );

  const executeAnalysis = trpc.analysis.execute.useMutation({
    onSuccess: () => {
      toast.success("分析を開始しました");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

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
            <Button variant="outline" onClick={() => setLocation("/history")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              履歴に戻る
            </Button>
          </div>

          {/* Status Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>ステータス</CardTitle>
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
          </Card>

          {/* Videos Grid */}
          {videos.length > 0 ? (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold">分析対象動画 ({videos.length}件)</h2>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {videos.map((video) => (
                  <Card key={video.id} className="overflow-hidden">
                    {video.thumbnailUrl && (
                      <div className="aspect-video bg-muted relative">
                        <img 
                          src={video.thumbnailUrl} 
                          alt={video.title || "動画サムネイル"}
                          className="w-full h-full object-cover"
                        />
                        {(video.duplicateCount ?? 0) > 0 && (
                          <Badge className="absolute top-2 right-2 bg-primary">
                            重複度: {video.duplicateCount}
                          </Badge>
                        )}
                      </div>
                    )}
                    <CardHeader>
                      <CardTitle className="text-base line-clamp-2">
                        {video.title || "タイトルなし"}
                      </CardTitle>
                      <CardDescription>
                        {video.platform === "tiktok" ? "TikTok" : "YouTube Shorts"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Score Display */}
                      {video.score && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2">
                              <Video className="h-4 w-4" />
                              サムネイル
                            </span>
                            <span className="font-medium">{video.score.thumbnailScore}/100</span>
                          </div>
                          <Progress value={video.score.thumbnailScore} className="h-2" />

                          <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2">
                              <FileText className="h-4 w-4" />
                              テキスト
                            </span>
                            <span className="font-medium">{video.score.textScore}/100</span>
                          </div>
                          <Progress value={video.score.textScore} className="h-2" />

                          <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2">
                              <Mic className="h-4 w-4" />
                              音声
                            </span>
                            <span className="font-medium">{video.score.audioScore}/100</span>
                          </div>
                          <Progress value={video.score.audioScore} className="h-2" />

                          <div className="flex items-center justify-between text-sm font-bold mt-4 pt-4 border-t">
                            <span className="flex items-center gap-2">
                              <BarChart3 className="h-4 w-4" />
                              総合スコア
                            </span>
                            <span className="gradient-text text-lg">{video.score.overallScore}/100</span>
                          </div>
                        </div>
                      )}

                      {/* Transcription Preview */}
                      {video.transcription && (
                        <Tabs defaultValue="transcript" className="mt-4">
                          <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="transcript">音声</TabsTrigger>
                            <TabsTrigger value="ocr">OCR</TabsTrigger>
                          </TabsList>
                          <TabsContent value="transcript" className="space-y-2">
                            <p className="text-sm text-muted-foreground line-clamp-3">
                              {video.transcription.fullText}
                            </p>
                          </TabsContent>
                          <TabsContent value="ocr" className="space-y-2">
                            {video.ocrResults && video.ocrResults.length > 0 ? (
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {video.ocrResults.slice(0, 3).map((ocr) => (
                                  <p key={ocr.id} className="text-sm text-muted-foreground">
                                    {ocr.frameTimestamp}秒: {ocr.extractedText}
                                  </p>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">OCR結果なし</p>
                            )}
                          </TabsContent>
                        </Tabs>
                      )}

                      <Button variant="outline" className="w-full" asChild>
                        <a href={video.videoUrl} target="_blank" rel="noopener noreferrer">
                          動画を開く
                        </a>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  {job.status === "pending" 
                    ? "「分析を実行」ボタンをクリックして分析を開始してください" 
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
