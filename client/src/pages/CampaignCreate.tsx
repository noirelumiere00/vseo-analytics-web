import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowLeft, FileBarChart } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function CampaignCreate() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  const [campaignName, setCampaignName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [targetViews, setTargetViews] = useState("");
  const [targetER, setTargetER] = useState("");
  const [adSpend, setAdSpend] = useState("");
  const [videoUrls, setVideoUrls] = useState("");
  const [beforeJobId, setBeforeJobId] = useState<number | undefined>(undefined);

  const { data: availableJobs } = trpc.campaign.availableBeforeJobs.useQuery();

  const createCampaign = trpc.campaign.create.useMutation({
    onSuccess: (data) => {
      toast.success("施策レポートを作成しました");
      setLocation(`/campaign/${data.id}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const urls = videoUrls
      .split("\n")
      .map(u => u.trim())
      .filter(u => u.length > 0);

    if (!campaignName.trim()) {
      toast.error("施策名を入力してください");
      return;
    }
    if (urls.length === 0) {
      toast.error("動画URLを1つ以上入力してください");
      return;
    }

    createCampaign.mutate({
      campaignName: campaignName.trim(),
      keyword: keyword.trim() || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      description: description.trim() || undefined,
      targetViews: targetViews ? parseInt(targetViews) : undefined,
      targetEngagementRate: targetER ? Math.round(parseFloat(targetER) * 100) : undefined,
      adSpend: adSpend ? parseInt(adSpend) : undefined,
      videoUrls: urls,
      beforeJobId,
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container py-8">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/campaign")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold">
                <span className="gradient-text">施策レポート作成</span>
              </h1>
              <p className="text-muted-foreground mt-1">
                TikTok施策の成果を分析し、効果測定・Next提案を生成します
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 基本情報 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileBarChart className="h-5 w-5" />
                  施策情報
                </CardTitle>
                <CardDescription>施策の基本情報を入力してください</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="campaignName">施策名 *</Label>
                  <Input
                    id="campaignName"
                    placeholder="例: 春キャンペーンTikTok施策"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="keyword">キーワード</Label>
                  <Input
                    id="keyword"
                    placeholder="例: スキンケア"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="startDate">施策開始日</Label>
                    <Input
                      id="startDate"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="endDate">施策終了日</Label>
                    <Input
                      id="endDate"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">施策概要</Label>
                  <Textarea
                    id="description"
                    placeholder="施策の概要・目的を入力してください"
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>

            {/* KPI設定 */}
            <Card>
              <CardHeader>
                <CardTitle>KPI目標・広告費</CardTitle>
                <CardDescription>目標値と広告費を入力すると達成率・CPV/CPEが計算されます</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="targetViews">目標再生数</Label>
                    <Input
                      id="targetViews"
                      type="number"
                      placeholder="100000"
                      value={targetViews}
                      onChange={(e) => setTargetViews(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="targetER">目標ER%</Label>
                    <Input
                      id="targetER"
                      type="number"
                      step="0.01"
                      placeholder="5.0"
                      value={targetER}
                      onChange={(e) => setTargetER(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="adSpend">広告費（円）</Label>
                    <Input
                      id="adSpend"
                      type="number"
                      placeholder="500000"
                      value={adSpend}
                      onChange={(e) => setAdSpend(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 動画URL */}
            <Card>
              <CardHeader>
                <CardTitle>施策動画URL *</CardTitle>
                <CardDescription>施策で投稿した動画のTikTok URLを1行に1つ入力してください</CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  placeholder={"https://www.tiktok.com/@user/video/123456789\nhttps://www.tiktok.com/@user/video/987654321"}
                  rows={8}
                  value={videoUrls}
                  onChange={(e) => setVideoUrls(e.target.value)}
                  required
                />
              </CardContent>
            </Card>

            {/* Before比較 */}
            <Card>
              <CardHeader>
                <CardTitle>Before比較（任意）</CardTitle>
                <CardDescription>施策前のSEO分析結果と比較し、Before/After分析を行います</CardDescription>
              </CardHeader>
              <CardContent>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={beforeJobId ?? ""}
                  onChange={(e) => setBeforeJobId(e.target.value ? parseInt(e.target.value) : undefined)}
                >
                  <option value="">比較なし</option>
                  {availableJobs?.map((job) => (
                    <option key={job.id} value={job.id}>
                      #{job.id} {job.keyword || "手動URL"} ({new Date(job.createdAt).toLocaleDateString("ja-JP")})
                    </option>
                  ))}
                </select>
              </CardContent>
            </Card>

            <Button
              type="submit"
              className="w-full gradient-primary text-white"
              disabled={createCampaign.isPending}
              size="lg"
            >
              {createCampaign.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  作成中...
                </>
              ) : (
                "施策レポートを作成"
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
