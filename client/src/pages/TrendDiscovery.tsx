import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { Compass, Loader2 } from "lucide-react";

export default function TrendDiscovery() {
  const [, setLocation] = useLocation();
  const [persona, setPersona] = useState("");
  const createMutation = trpc.trendDiscovery.create.useMutation({
    onSuccess: (data) => {
      setLocation(`/trend-discovery/${data.jobId}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!persona.trim()) return;
    createMutation.mutate({ persona: persona.trim() });
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-8">
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
            <CardTitle>新しいトレンド分析</CardTitle>
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
      </div>
    </DashboardLayout>
  );
}
