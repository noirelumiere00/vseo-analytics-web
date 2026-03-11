import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Plus, Megaphone, Trash2, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  draft: { label: "下書き", variant: "outline" },
  baseline_captured: { label: "ベースライン取得済", variant: "secondary" },
  measurement_captured: { label: "効果測定済", variant: "secondary" },
  report_ready: { label: "レポート完了", variant: "default" },
};

export default function CampaignList() {
  const [, setLocation] = useLocation();

  const campaignsQuery = trpc.campaign.list.useQuery();
  const deleteMutation = trpc.campaign.delete.useMutation({
    onSuccess: () => {
      campaignsQuery.refetch();
      toast.success("キャンペーンを削除しました");
    },
  });

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">施策効果レポート</h1>
            <p className="text-muted-foreground text-sm mt-1">
              VSEO施策の前後比較レポートを作成・管理
            </p>
          </div>
          <Button onClick={() => setLocation("/trend-insights")} className="gap-2">
            <Plus className="h-4 w-4" />
            新規キャンペーン
          </Button>
        </div>

        {campaignsQuery.isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        )}

        {campaignsQuery.data?.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Megaphone className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="font-semibold text-lg">キャンペーンがありません</h3>
              <p className="text-muted-foreground text-sm mt-1">
                「新規キャンペーン」から施策効果の測定を始めましょう
              </p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {campaignsQuery.data?.map((campaign) => {
            const status = statusLabels[campaign.status] || statusLabels.draft;
            return (
              <Card
                key={campaign.id}
                className="cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => setLocation(`/campaigns/${campaign.id}`)}
              >
                <CardContent className="flex items-center justify-between py-4">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold truncate">{campaign.name}</h3>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      {campaign.clientName && <span>{campaign.clientName}</span>}
                      <span>KW: {(campaign.keywords as string[])?.length || 0}件</span>
                      <span>{new Date(campaign.createdAt).toLocaleDateString("ja-JP")}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("このキャンペーンを削除しますか？")) {
                          deleteMutation.mutate({ id: campaign.id });
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

    </DashboardLayout>
  );
}
