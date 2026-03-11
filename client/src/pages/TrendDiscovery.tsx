import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { Compass, Loader2, Trash2 } from "lucide-react";

export default function TrendDiscovery() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [persona, setPersona] = useState("");

  const jobsQuery = trpc.trendDiscovery.list.useQuery(undefined, {
    enabled: !!user,
  });

  const createMutation = trpc.trendDiscovery.create.useMutation({
    onSuccess: (data) => {
      setLocation(`/trend-discovery/${data.jobId}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = trpc.trendDiscovery.delete.useMutation({
    onSuccess: () => {
      toast.success("削除しました");
      jobsQuery.refetch();
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

        {jobsQuery.data && jobsQuery.data.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-4">過去の分析</h2>
            <div className="space-y-3">
              {jobsQuery.data.map((job) => (
                <Card
                  key={job.id}
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => setLocation(`/trend-discovery/${job.id}`)}
                >
                  <CardContent className="flex items-center justify-between py-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{job.persona}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(job.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={job.status} />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm("この分析を削除しますか？")) {
                            deleteMutation.mutate({ jobId: job.id });
                          }
                        }}
                        disabled={job.status === "processing"}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    pending: { label: "待機中", className: "bg-yellow-100 text-yellow-800" },
    processing: { label: "処理中", className: "bg-blue-100 text-blue-800" },
    completed: { label: "完了", className: "bg-green-100 text-green-800" },
    failed: { label: "失敗", className: "bg-red-100 text-red-800" },
  };
  const c = config[status] || { label: status, className: "bg-gray-100 text-gray-800" };
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}
