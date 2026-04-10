import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import DashboardLayout from "@/components/DashboardLayout";
import { usePageTitle } from "@/hooks/usePageTitle";
import { trpc } from "@/lib/trpc";
import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { handleTrpcError } from "@/lib/error-handler";
import { Compass, Hash, Loader2, Sparkles, TrendingUp } from "lucide-react";

const STEPS = [
  { icon: Compass, label: "ペルソナ入力", desc: "ターゲット層を設定" },
  { icon: Hash, label: "KW・タグ拡張", desc: "AIが検索クエリを生成" },
  { icon: TrendingUp, label: "TikTok横断分析", desc: "動画データを一括収集" },
  { icon: Sparkles, label: "AIレポート", desc: "インサイト・戦略提案" },
];

export default function TrendDiscovery() {
  usePageTitle("トレンド発掘");
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const params = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const [persona, setPersona] = useState(params.get("keyword") ?? "");
  const createMutation = trpc.trendDiscovery.create.useMutation({
    onSuccess: (data) => {
      setLocation(`/trend-discovery/${data.jobId}`);
    },
    onError: handleTrpcError,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!persona.trim()) return;
    createMutation.mutate({ persona: persona.trim() });
  };

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Compass className="h-6 w-6" />
            TikTokトレンド分析
          </h1>
          <p className="text-muted-foreground mt-1">
            ペルソナや界隈名を入力すると、AIがキーワード・ハッシュタグに拡張し、TikTokの横断トレンドを分析します。
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">新しいトレンド分析</CardTitle>
            <CardDescription>
              ターゲットとなるペルソナや界隈名を入力してください（例: 韓国コスメ、筋トレ初心者、Z世代ファッション）
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex gap-3">
              <Input
                placeholder="ペルソナ / 界隈名を入力..."
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                className="flex-1"
                disabled={createMutation.isPending}
              />
              <Button
                type="submit"
                disabled={!persona.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                分析開始
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* How it works */}
        <Card className="bg-muted/30 border-dashed">
          <CardHeader>
            <CardTitle className="text-base">分析の流れ</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {STEPS.map(({ icon: Icon, label, desc }, i) => (
                <div key={i} className="text-center space-y-2">
                  <div className="mx-auto h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
