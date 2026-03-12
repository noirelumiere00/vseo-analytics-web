import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { ArrowLeft, Bookmark, ChevronDown, Download, Eye, FileText, Hash, Heart, Loader2, MessageCircle, Play, Share2, Users } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import TrendStatisticsPanel from "@/components/TrendStatisticsPanel";

export default function TrendDiscoveryDetail() {
  const params = useParams<{ id: string }>();
  const jobId = Number(params.id);
  const [, setLocation] = useLocation();
  const executedRef = useRef(false);

  const jobQuery = trpc.trendDiscovery.getById.useQuery(
    { jobId },
    { enabled: !!jobId, refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === "processing" ? 3000 : false;
    }},
  );

  const progressQuery = trpc.trendDiscovery.getProgress.useQuery(
    { jobId },
    {
      enabled: !!jobId && jobQuery.data?.status === "processing",
      refetchInterval: 2000,
    },
  );

  const executeMutation = trpc.trendDiscovery.execute.useMutation({
    onError: (error) => toast.error(error.message),
  });

  const csvQuery = trpc.trendDiscovery.exportCsv.useQuery(
    { jobId },
    { enabled: false },
  );

  // pending時に自動execute
  useEffect(() => {
    if (jobQuery.data?.status === "pending" && !executedRef.current) {
      executedRef.current = true;
      executeMutation.mutate({ jobId });
    }
  }, [jobQuery.data?.status, jobId]);

  const handleExportCsv = async () => {
    try {
      const result = await csvQuery.refetch();
      if (result.data) {
        const bom = "\uFEFF";
        const blob = new Blob([bom + result.data.csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = result.data.filename;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      toast.error("CSV出力に失敗しました");
    }
  };

  const job = jobQuery.data;
  const progress = progressQuery.data;

  if (jobQuery.isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  if (!job) {
    return (
      <DashboardLayout>
        <div className="text-center py-20 text-muted-foreground">ジョブが見つかりません</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/trend-discovery")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-xl font-bold">{job.persona}</h1>
              <p className="text-sm text-muted-foreground">
                {new Date(job.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
              </p>
            </div>
          </div>
          {job.status === "completed" && (
            <div className="flex items-center gap-2">
              <Button onClick={() => setLocation(`/campaigns/new?trendJobId=${jobId}`)}>
                <FileText className="h-4 w-4 mr-2" />
                施策レポート作成
              </Button>
              <Button variant="outline" onClick={handleExportCsv}>
                <Download className="h-4 w-4 mr-2" />
                CSV出力
              </Button>
            </div>
          )}
        </div>

        {/* Processing */}
        {job.status === "processing" && (
          <Card>
            <CardContent className="py-8">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="font-medium">{progress?.currentStep || "処理中..."}</span>
                </div>
                <Progress value={Math.max(0, progress?.progress ?? 0)} className="h-2" />
                <p className="text-sm text-muted-foreground text-right">
                  {progress?.progress ?? 0}%
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Failed */}
        {job.status === "failed" && (
          <Card className="border-destructive">
            <CardContent className="py-6">
              <p className="text-destructive font-medium">分析に失敗しました。</p>
              <p className="text-sm text-muted-foreground mt-1">
                {progress?.currentStep || "再度お試しください。"}
              </p>
              <Button
                className="mt-4"
                onClick={() => {
                  executedRef.current = false;
                  executeMutation.mutate({ jobId });
                }}
              >
                再実行
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Completed */}
        {job.status === "completed" && (
          <>
            {/* 拡張キーワード・ハッシュタグ */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">拡張されたクエリ</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">キーワード</p>
                  <div className="flex flex-wrap gap-2">
                    {(job.expandedKeywords as string[] || []).map((kw) => (
                      <Badge key={kw} variant="secondary">{kw}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">ハッシュタグ</p>
                  <div className="flex flex-wrap gap-2">
                    {(job.expandedHashtags as string[] || []).map((ht) => (
                      <Badge key={ht} variant="outline">#{ht}</Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* トレンドハッシュタグ */}
            <TrendingHashtags data={(job.crossAnalysis as any)?.trendingHashtags || []} />

            {/* トップ動画 */}
            <TopVideos data={(job.crossAnalysis as any)?.topVideos || []} />

            {/* 共起タグ */}
            <CoOccurringTags data={(job.crossAnalysis as any)?.coOccurringTags || []} />

            {/* キークリエイター */}
            <KeyCreators data={(job.crossAnalysis as any)?.keyCreators || []} />

            {/* 統計分析 */}
            {(job.crossAnalysis as any)?.statistics && (
              <TrendStatisticsPanel statistics={(job.crossAnalysis as any).statistics} />
            )}

            {/* AIサマリー */}
            {(job.crossAnalysis as any)?.summary && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">AIサマリー</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{(job.crossAnalysis as any).summary}</ReactMarkdown>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function TrendingHashtags({ data }: { data: Array<{ tag: string; videoCount: number; queryCount: number; avgER: number }> }) {
  if (data.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Hash className="h-4 w-4" />
          トレンドハッシュタグ
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 pr-4 font-medium text-muted-foreground">#</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground">タグ</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">出現動画数</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">クエリ横断数</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">平均ER(%)</th>
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 30).map((t, i) => (
                <tr key={t.tag} className="border-b last:border-0">
                  <td className="py-2 pr-4 text-muted-foreground">{i + 1}</td>
                  <td className="py-2 pr-4 font-medium">#{t.tag}</td>
                  <td className="py-2 pr-4 text-right">{t.videoCount}</td>
                  <td className="py-2 pr-4 text-right">{t.queryCount}</td>
                  <td className="py-2 text-right">{t.avgER}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

type SortKey = "er" | "playCount" | "diggCount" | "commentCount" | "shareCount" | "collectCount";
const SORT_OPTIONS: Array<{ key: SortKey; label: string; icon: React.ReactNode }> = [
  { key: "er", label: "ER%順", icon: <Play className="h-3 w-3" /> },
  { key: "playCount", label: "再生数順", icon: <Eye className="h-3 w-3" /> },
  { key: "diggCount", label: "いいね順", icon: <Heart className="h-3 w-3" /> },
  { key: "commentCount", label: "コメント順", icon: <MessageCircle className="h-3 w-3" /> },
  { key: "shareCount", label: "シェア順", icon: <Share2 className="h-3 w-3" /> },
  { key: "collectCount", label: "保存順", icon: <Bookmark className="h-3 w-3" /> },
];

function TopVideos({ data }: { data: Array<{
  videoId: string; desc: string; authorUniqueId: string; authorNickname: string;
  playCount: number; diggCount?: number; commentCount?: number; shareCount?: number; collectCount?: number;
  er: number; coverUrl: string; hashtags: string[];
}> }) {
  const [sortBy, setSortBy] = useState<SortKey>("er");
  const [isOpen, setIsOpen] = useState(false);
  if (data.length === 0) return null;

  const formatCount = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  const sorted = [...data].sort((a, b) => {
    const aVal = sortBy === "er" ? a.er : ((a as any)[sortBy] ?? 0);
    const bVal = sortBy === "er" ? b.er : ((b as any)[sortBy] ?? 0);
    return bVal - aVal;
  });

  const currentOption = SORT_OPTIONS.find(o => o.key === sortBy)!;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Play className="h-4 w-4" />
            トップ動画
          </CardTitle>
          <div className="relative">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-md hover:bg-accent transition-colors"
            >
              {currentOption.icon}
              <span>{currentOption.label}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
            {isOpen && (
              <div className="absolute right-0 top-full mt-1 z-10 bg-background border rounded-md shadow-lg py-1 min-w-[140px]">
                {SORT_OPTIONS.map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => { setSortBy(opt.key); setIsOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors ${sortBy === opt.key ? "font-medium bg-accent/50" : ""}`}
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sorted.slice(0, 12).map((v) => (
            <a
              key={v.videoId}
              href={`https://www.tiktok.com/@${v.authorUniqueId}/video/${v.videoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border p-3 hover:bg-accent/50 transition-colors"
            >
              <div className="flex gap-3">
                {v.coverUrl && (
                  <img
                    src={v.coverUrl}
                    alt=""
                    className="w-16 h-20 object-cover rounded flex-shrink-0"
                    loading="lazy"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">@{v.authorUniqueId}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{v.desc}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-0.5"><Eye className="h-3 w-3" /> {formatCount(v.playCount)}</span>
                    <span className="flex items-center gap-0.5"><Heart className="h-3 w-3" /> {formatCount(v.diggCount ?? 0)}</span>
                    <span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" /> {formatCount(v.commentCount ?? 0)}</span>
                    <span className="font-medium text-primary">ER {v.er}%</span>
                  </div>
                </div>
              </div>
              {v.hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {v.hashtags.slice(0, 5).map(tag => (
                    <span key={tag} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">#{tag}</span>
                  ))}
                </div>
              )}
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CoOccurringTags({ data }: { data: Array<{ tagA: string; tagB: string; count: number }> }) {
  if (data.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Share2 className="h-4 w-4" />
          共起タグペア
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {data.slice(0, 15).map((p, i) => (
            <div key={`${p.tagA}-${p.tagB}`} className="flex items-center justify-between border rounded-lg px-3 py-2">
              <div className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">{i + 1}.</span>
                <Badge variant="secondary" className="text-xs">#{p.tagA}</Badge>
                <span className="text-muted-foreground">+</span>
                <Badge variant="secondary" className="text-xs">#{p.tagB}</Badge>
              </div>
              <span className="text-sm font-medium">{p.count}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function KeyCreators({ data }: { data: Array<{ uniqueId: string; nickname: string; avatarUrl: string; followerCount: number; videoCount: number; queryCount: number; totalPlays: number }> }) {
  if (data.length === 0) return null;

  const formatCount = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          キークリエイター
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {data.map((c) => (
            <a
              key={c.uniqueId}
              href={`https://www.tiktok.com/@${c.uniqueId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 border rounded-lg p-3 hover:bg-accent/50 transition-colors"
            >
              {c.avatarUrl ? (
                <img src={c.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" loading="lazy" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <Users className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">@{c.uniqueId}</p>
                <p className="text-xs text-muted-foreground truncate">{c.nickname}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <span>{formatCount(c.followerCount)} followers</span>
                  <span>{c.videoCount}動画</span>
                  <span>{c.queryCount}クエリ</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
