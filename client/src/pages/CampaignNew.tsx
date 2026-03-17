import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Loader2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { toast } from "sonner";

export default function CampaignNew() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const trendJobIdsParam = params.get("trendJobIds");
  const trendJobIds = trendJobIdsParam
    ? trendJobIdsParam.split(",").map(Number).filter(n => !isNaN(n))
    : [];

  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [ownAccountIds, setOwnAccountIds] = useState("");
  const [ownVideoIds, setOwnVideoIds] = useState("");
  const [campaignHashtags, setCampaignHashtags] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [brandKeywords, setBrandKeywords] = useState("");
  const [prefilled, setPrefilled] = useState(false);

  // Query each trendJob individually
  const trendJob1Query = trpc.trendDiscovery.getById.useQuery(
    { jobId: trendJobIds[0]! },
    { enabled: trendJobIds.length >= 1 },
  );
  const trendJob2Query = trpc.trendDiscovery.getById.useQuery(
    { jobId: trendJobIds[1]! },
    { enabled: trendJobIds.length >= 2 },
  );

  const allLoaded = trendJobIds.length === 0
    || (trendJobIds.length === 1 && !!trendJob1Query.data)
    || (trendJobIds.length >= 2 && !!trendJob1Query.data && !!trendJob2Query.data);

  const isLoadingJobs = trendJobIds.length > 0 && !allLoaded && (trendJob1Query.isLoading || trendJob2Query.isLoading);

  // Prefill from trend discovery data
  useEffect(() => {
    if (!allLoaded || prefilled) return;
    if (trendJobIds.length === 0) return;

    const jobs = [trendJob1Query.data, trendJob2Query.data].filter(Boolean) as any[];
    if (jobs.length === 0) return;

    setPrefilled(true);

    // Name
    if (jobs.length === 1) {
      setName(`${jobs[0].persona} キャンペーン`);
    } else {
      setName(`${jobs[0].persona} × ${jobs[1].persona} キャンペーン`);
    }

    // Keywords: merge + dedupe
    const allKws = jobs.flatMap(j => (j.expandedKeywords as string[]) || []);
    const uniqueKws = [...new Set(allKws)];
    if (uniqueKws.length > 0) {
      setKeywords(uniqueKws.join("\n"));
    }

    // Hashtags: merge + dedupe
    const allHTs = jobs.flatMap(j => {
      const tags = (j.crossAnalysis as any)?.trendingHashtags || [];
      return tags.slice(0, 10).map((t: any) => `#${t.tag}`);
    });
    const uniqueHTs = [...new Set(allHTs)];
    if (uniqueHTs.length > 0) {
      setCampaignHashtags(uniqueHTs.join("\n"));
    }
  }, [allLoaded, prefilled, trendJob1Query.data, trendJob2Query.data, trendJobIds.length]);

  const createMutation = trpc.campaign.create.useMutation({
    onSuccess: (data) => {
      toast.success("キャンペーンを作成しました");
      setLocation(`/campaigns/${data.id}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleSubmit = () => {
    const kwList = keywords.split("\n").map(s => s.trim()).filter(Boolean);
    const ownIds = ownAccountIds.split("\n").map(s => s.trim()).filter(Boolean);
    if (!name.trim()) { toast.error("キャンペーン名を入力してください"); return; }
    if (kwList.length === 0) { toast.error("キーワードを1つ以上入力してください"); return; }
    if (ownIds.length === 0) { toast.error("自社アカウントIDを1つ以上入力してください"); return; }

    const compList = competitors.split("\n").map(s => s.trim()).filter(Boolean).map(line => {
      const [compName, accountId] = line.split(",").map(s => s.trim());
      return { name: compName || accountId, account_id: accountId || compName };
    });

    createMutation.mutate({
      name: name.trim(),
      clientName: clientName.trim() || undefined,
      keywords: kwList,
      ownAccountIds: ownIds,
      ownVideoIds: ownVideoIds.split("\n").map(s => s.trim()).filter(Boolean),
      campaignHashtags: campaignHashtags.split("\n").map(s => s.trim()).filter(Boolean),
      competitors: compList.length > 0 ? compList : undefined,
      brandKeywords: brandKeywords.split("\n").map(s => s.trim()).filter(Boolean),
    });
  };

  // Merge keyCreators from all jobs
  const allKeyCreators = (() => {
    const jobs = [trendJob1Query.data, trendJob2Query.data].filter(Boolean) as any[];
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const job of jobs) {
      for (const c of ((job.crossAnalysis as any)?.keyCreators || [])) {
        if (!seen.has(c.uniqueId)) {
          seen.add(c.uniqueId);
          merged.push(c);
        }
      }
    }
    return merged;
  })();

  const formatCount = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  // Build subtitle from loaded jobs
  const loadedJobs = [trendJob1Query.data, trendJob2Query.data].filter(Boolean) as any[];

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/campaigns")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">新規キャンペーン作成</h1>
            {loadedJobs.length === 1 && (
              <p className="text-sm text-muted-foreground mt-0.5">
                トレンド発掘「{loadedJobs[0].persona}」からデータを引き継ぎ
              </p>
            )}
            {loadedJobs.length === 2 && (
              <p className="text-sm text-muted-foreground mt-0.5">
                トレンド発掘「{loadedJobs[0].persona}」×「{loadedJobs[1].persona}」からデータをマージ
              </p>
            )}
          </div>
        </div>

        {isLoadingJobs && (
          <Card>
            <CardContent className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin mr-2 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">トレンド発掘データを読み込み中...</span>
            </CardContent>
          </Card>
        )}

        {/* Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">基本設定</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>キャンペーン名 *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="例: 春の新商品プロモーション" />
            </div>
            <div className="space-y-2">
              <Label>クライアント名</Label>
              <Input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="例: 株式会社サンプルコスメ" />
            </div>
            <div className="space-y-2">
              <Label>計測キーワード *（1行1キーワード）</Label>
              <Textarea value={keywords} onChange={e => setKeywords(e.target.value)} placeholder={"韓国コスメ おすすめ\nクッションファンデ"} rows={4} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">アカウント・動画設定</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>自社TikTokアカウントID *（1行1ID）</Label>
              <Textarea value={ownAccountIds} onChange={e => setOwnAccountIds(e.target.value)} placeholder="samplecosme_official" rows={2} />
            </div>
            <div className="space-y-2">
              <Label>施策動画ID（1行1ID、任意）</Label>
              <Textarea value={ownVideoIds} onChange={e => setOwnVideoIds(e.target.value)} placeholder="7340000000000000000" rows={2} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ハッシュタグ・競合設定</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>キャンペーンハッシュタグ（1行1タグ、任意）</Label>
              <Textarea value={campaignHashtags} onChange={e => setCampaignHashtags(e.target.value)} placeholder={"#韓国コスメおすすめ2026\n#サンプルコスメ"} rows={3} />
            </div>
            <div className="space-y-2">
              <Label>競合（1行1社: 表示名,アカウントID）</Label>
              <Textarea value={competitors} onChange={e => setCompetitors(e.target.value)} placeholder={"競合A社,competitor_a\n競合B社,competitor_b"} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>ブランドキーワード（オマージュ検出用、1行1ワード）</Label>
              <Textarea value={brandKeywords} onChange={e => setBrandKeywords(e.target.value)} placeholder={"サンプルコスメ\nSampleCosme"} rows={2} />
            </div>
          </CardContent>
        </Card>

        {/* Key Creators from trend discovery (read-only) */}
        {allKeyCreators.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4" />
                参考: キークリエイター（トレンド発掘より）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                トレンド発掘で特定されたキークリエイターです。競合設定の参考にしてください。
              </p>
              <div className="grid gap-2 md:grid-cols-2">
                {allKeyCreators.map((c: any) => (
                  <div
                    key={c.uniqueId}
                    className="flex items-center gap-3 border rounded-lg p-2.5"
                  >
                    {c.avatarUrl ? (
                      <img src={c.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" loading="lazy" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                        <Users className="h-3 w-3 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">@{c.uniqueId}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatCount(c.followerCount)} followers</span>
                        <span>{c.videoCount}動画</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Submit */}
        <div className="flex justify-end gap-3 pb-8">
          <Button variant="outline" onClick={() => setLocation("/campaigns")}>キャンセル</Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending} className="min-w-[120px]">
            {createMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />作成中...</>
            ) : (
              "作成"
            )}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
