import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  ChevronRight, Compass, Eye, FileText, Hash, Loader2,
  Megaphone, Play, Share2, Trash2, Users,
} from "lucide-react";
import { useState } from "react";

export default function TrendInsights() {
  const [, setLocation] = useLocation();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const jobsQuery = trpc.trendDiscovery.list.useQuery();
  const campaignsQuery = trpc.campaign.list.useQuery();
  const deleteMutation = trpc.campaign.delete.useMutation({
    onSuccess: () => {
      campaignsQuery.refetch();
      toast.success("キャンペーンを削除しました");
    },
  });

  const completedJobs = (jobsQuery.data || []).filter(j => j.status === "completed");

  const formatCount = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  const toggleSelect = (jobId: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        if (next.size >= 2) {
          toast.info("選択は2件までです");
          return prev;
        }
        next.add(jobId);
      }
      return next;
    });
  };

  const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    draft: { label: "下書き", variant: "outline" },
    baseline_captured: { label: "ベースライン取得済", variant: "secondary" },
    measurement_captured: { label: "効果測定済", variant: "secondary" },
    report_ready: { label: "レポート完了", variant: "default" },
  };

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">トレンド分析結果</h1>
          <p className="text-muted-foreground text-sm mt-1">
            完了済みのTikTokトレンド分析から得られたインサイト
          </p>
        </div>

        {jobsQuery.isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!jobsQuery.isLoading && completedJobs.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Compass className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="font-semibold text-lg">トレンド分析結果がありません</h3>
              <p className="text-muted-foreground text-sm mt-1">
                TikTokトレンド分析を実行すると、ここに結果が表示されます
              </p>
              <Button className="mt-4" onClick={() => setLocation("/trend-discovery")}>
                トレンド分析を開始
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="space-y-6">
          {completedJobs.map((job) => {
            const cross = job.crossAnalysis as any;
            const trendingHashtags: any[] = cross?.trendingHashtags || [];
            const topVideos: any[] = cross?.topVideos || [];
            const keyCreators: any[] = cross?.keyCreators || [];
            const coOccurringTags: any[] = cross?.coOccurringTags || [];
            const expandedKeywords = (job.expandedKeywords as string[]) || [];
            const isSelected = selectedIds.has(job.id);

            return (
              <Card
                key={job.id}
                className={`transition-colors ${isSelected ? "border-primary ring-2 ring-primary/30" : ""}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(job.id)}
                      />
                      <div>
                        <CardTitle className="text-lg">{job.persona}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(job.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                          {" / "}KW: {expandedKeywords.length}件
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => setLocation(`/campaigns/new?trendJobIds=${job.id}`)}
                      >
                        <FileText className="h-3.5 w-3.5 mr-1.5" />
                        施策レポート作成
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setLocation(`/trend-discovery/${job.id}`)}
                      >
                        詳細
                        <ChevronRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* サマリー統計 */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="flex items-center gap-2 rounded-lg border p-3">
                      <Hash className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-lg font-bold">{trendingHashtags.length}</p>
                        <p className="text-xs text-muted-foreground">トレンドHT</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border p-3">
                      <Play className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-lg font-bold">{topVideos.length}</p>
                        <p className="text-xs text-muted-foreground">トップ動画</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border p-3">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-lg font-bold">{keyCreators.length}</p>
                        <p className="text-xs text-muted-foreground">キークリエイター</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border p-3">
                      <Share2 className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-lg font-bold">{coOccurringTags.length}</p>
                        <p className="text-xs text-muted-foreground">共起タグ</p>
                      </div>
                    </div>
                  </div>

                  {/* トレンドハッシュタグ上位 */}
                  {trendingHashtags.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">トレンドハッシュタグ TOP5</p>
                      <div className="flex flex-wrap gap-2">
                        {trendingHashtags.slice(0, 5).map((t: any) => (
                          <Badge key={t.tag} variant="secondary" className="text-xs">
                            #{t.tag}
                            <span className="ml-1 text-muted-foreground">({t.videoCount}動画 / ER {t.avgER}%)</span>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* キークリエイター上位 */}
                  {keyCreators.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">キークリエイター TOP5</p>
                      <div className="flex flex-wrap gap-2">
                        {keyCreators.slice(0, 5).map((c: any) => (
                          <a
                            key={c.uniqueId}
                            href={`https://www.tiktok.com/@${c.uniqueId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 rounded-lg border px-3 py-1.5 hover:bg-accent/50 transition-colors"
                          >
                            {c.avatarUrl ? (
                              <img src={c.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover" loading="lazy" />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                                <Users className="h-3 w-3 text-muted-foreground" />
                              </div>
                            )}
                            <span className="text-sm font-medium">@{c.uniqueId}</span>
                            <span className="text-xs text-muted-foreground">{formatCount(c.followerCount)}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* トップ動画上位 */}
                  {topVideos.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">トップ動画 TOP3</p>
                      <div className="grid gap-3 md:grid-cols-3">
                        {topVideos.slice(0, 3).map((v: any) => (
                          <a
                            key={v.videoId}
                            href={`https://www.tiktok.com/@${v.authorUniqueId}/video/${v.videoId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex gap-2.5 rounded-lg border p-2.5 hover:bg-accent/50 transition-colors"
                          >
                            {v.coverUrl && (
                              <img src={v.coverUrl} alt="" className="w-12 h-16 object-cover rounded flex-shrink-0" loading="lazy" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">@{v.authorUniqueId}</p>
                              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{v.desc}</p>
                              <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                                <span className="flex items-center gap-0.5">
                                  <Eye className="h-3 w-3" /> {formatCount(v.playCount)}
                                </span>
                                <span className="font-medium text-primary">ER {v.er}%</span>
                              </div>
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AIサマリー */}
                  {cross?.summary && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">AIサマリー</p>
                      <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">{cross.summary}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Floating action bar for 2 selected */}
        {selectedIds.size === 2 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
            <div className="flex items-center gap-4 rounded-xl border bg-background/95 backdrop-blur shadow-lg px-6 py-3">
              <p className="text-sm font-medium">2件選択中</p>
              <Button
                onClick={() => {
                  const ids = Array.from(selectedIds).join(",");
                  setLocation(`/campaigns/new?trendJobIds=${ids}`);
                }}
              >
                <Megaphone className="h-4 w-4 mr-2" />
                2件からキャンペーン作成
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                クリア
              </Button>
            </div>
          </div>
        )}

        {/* 作成済みキャンペーン */}
        {campaignsQuery.data && campaignsQuery.data.length > 0 && (
          <div className="space-y-4 pt-4">
            <h2 className="text-lg font-semibold tracking-tight">作成済みキャンペーン</h2>
            <div className="space-y-3">
              {campaignsQuery.data.map((campaign) => {
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
        )}
      </div>
    </DashboardLayout>
  );
}
