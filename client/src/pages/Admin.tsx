import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

export default function Admin() {
  const { data: me } = trpc.auth.me.useQuery();
  const { data: users, isLoading } = trpc.admin.listUsers.useQuery(undefined, {
    enabled: !!me && me.role === "admin",
  });

  if (me && me.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6 text-center">
              <p className="text-lg font-semibold mb-2">アクセス権限がありません</p>
              <p className="text-sm text-muted-foreground">管理者のみアクセスできます。</p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">ユーザー管理</h1>
          <p className="text-muted-foreground text-sm">登録ユーザーの一覧</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              登録ユーザー ({users?.length ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : !users || users.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">ユーザーがいません</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4">ID</th>
                      <th className="pb-2 pr-4">名前</th>
                      <th className="pb-2 pr-4">プラン</th>
                      <th className="pb-2 pr-4">最終ログイン</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className="border-b last:border-0">
                        <td className="py-3 pr-4 text-muted-foreground">{u.id}</td>
                        <td className="py-3 pr-4 font-medium">
                          {u.name || "(名前なし)"}
                          {me && u.id === me.id && (
                            <span className="ml-2 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">自分</span>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`text-xs font-medium px-2 py-1 rounded capitalize ${
                            (u as any).plan === "pro" ? "bg-primary/10 text-primary"
                            : (u as any).plan === "business" ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                          }`}>
                            {(u as any).plan || "free"}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {u.lastSignedIn
                            ? new Date(u.lastSignedIn).toLocaleString("ja-JP")
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
