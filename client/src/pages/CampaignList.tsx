import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, FileBarChart, ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocation } from "wouter";

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "待機中", variant: "outline" },
  processing: { label: "分析中", variant: "secondary" },
  completed: { label: "完了", variant: "default" },
  failed: { label: "失敗", variant: "destructive" },
};

const evaluationLabels: Record<string, { label: string; color: string }> = {
  excellent: { label: "優秀", color: "text-green-600" },
  good: { label: "良好", color: "text-blue-600" },
  needs_improvement: { label: "改善必要", color: "text-yellow-600" },
  poor: { label: "要改善", color: "text-red-600" },
};

export default function CampaignList() {
  const [, setLocation] = useLocation();
  const { data: campaigns, isLoading, refetch } = trpc.campaign.list.useQuery();
  const deleteMutation = trpc.campaign.delete.useMutation({
    onSuccess: () => {
      toast.success("削除しました");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-3xl font-bold">
                  <span className="gradient-text">施策レポート</span>
                </h1>
                <p className="text-muted-foreground mt-1">TikTok施策の成果分析・効果測定</p>
              </div>
            </div>
            <Button className="gradient-primary text-white" onClick={() => setLocation("/campaign/new")}>
              <Plus className="mr-2 h-4 w-4" />
              新規作成
            </Button>
          </div>

          {/* Campaign List */}
          {!campaigns || campaigns.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent>
                <FileBarChart className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-4">施策レポートがまだありません</p>
                <Button onClick={() => setLocation("/campaign/new")}>
                  <Plus className="mr-2 h-4 w-4" />
                  最初のレポートを作成
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {campaigns.map((c) => {
                const status = statusLabels[c.status] || statusLabels.pending;
                const evaluation = c.overallEvaluation ? evaluationLabels[c.overallEvaluation] : null;

                return (
                  <Card
                    key={c.id}
                    className="cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => setLocation(`/campaign/${c.id}`)}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{c.campaignName}</CardTitle>
                        <div className="flex items-center gap-2">
                          {evaluation && (
                            <span className={`text-sm font-medium ${evaluation.color}`}>
                              {evaluation.label}
                            </span>
                          )}
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <div className="flex gap-4">
                          {c.keyword && <span>KW: {c.keyword}</span>}
                          {c.totalVideos ? <span>{c.totalVideos}本</span> : null}
                          {c.totalViews ? <span>{Number(c.totalViews).toLocaleString()}再生</span> : null}
                          {c.avgEngagementRate ? <span>ER {(c.avgEngagementRate / 100).toFixed(2)}%</span> : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <span>{new Date(c.createdAt).toLocaleDateString("ja-JP")}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm("この施策レポートを削除しますか？")) {
                                deleteMutation.mutate({ id: c.id });
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
