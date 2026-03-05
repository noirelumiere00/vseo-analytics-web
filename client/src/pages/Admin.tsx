import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Trash2, ShieldCheck, ShieldOff, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

export default function Admin() {
  const [, navigate] = useLocation();
  const { data: me } = trpc.auth.me.useQuery();
  const { data: users, isLoading, refetch } = trpc.admin.listUsers.useQuery(undefined, {
    enabled: !!me && me.role === "admin",
  });
  const updateRole = trpc.admin.updateUserRole.useMutation({ onSuccess: () => refetch() });
  const deleteUser = trpc.admin.deleteUser.useMutation({ onSuccess: () => refetch() });
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  if (!me) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (me.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-lg font-semibold mb-2">アクセス権限がありません</p>
            <p className="text-sm text-muted-foreground mb-4">
              管理者のみアクセスできます。
            </p>
            <Button variant="outline" onClick={() => navigate("/")}>
              <ArrowLeft className="mr-2 h-4 w-4" /> ホームへ戻る
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">ユーザー管理</h1>
            <p className="text-slate-600 text-sm">ユーザーの一覧・権限変更・削除</p>
          </div>
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
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
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
                      <th className="pb-2 pr-4">ロール</th>
                      <th className="pb-2 pr-4">最終ログイン</th>
                      <th className="pb-2">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className="border-b last:border-0">
                        <td className="py-3 pr-4 text-muted-foreground">{u.id}</td>
                        <td className="py-3 pr-4 font-medium">
                          {u.name || "(名前なし)"}
                          {u.id === me.id && (
                            <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">自分</span>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded ${
                            u.role === "admin"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-600"
                          }`}>
                            {u.role === "admin" ? <ShieldCheck className="h-3 w-3" /> : null}
                            {u.role}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {u.lastSignedIn
                            ? new Date(u.lastSignedIn).toLocaleString("ja-JP")
                            : "-"}
                        </td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            {u.id !== me.id && (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={updateRole.isPending}
                                  onClick={() =>
                                    updateRole.mutate({
                                      userId: u.id,
                                      role: u.role === "admin" ? "user" : "admin",
                                    })
                                  }
                                >
                                  {u.role === "admin" ? (
                                    <><ShieldOff className="h-3 w-3 mr-1" /> 一般に変更</>
                                  ) : (
                                    <><ShieldCheck className="h-3 w-3 mr-1" /> 管理者に変更</>
                                  )}
                                </Button>
                                {confirmDelete === u.id ? (
                                  <div className="flex gap-1">
                                    <Button
                                      variant="destructive"
                                      size="sm"
                                      disabled={deleteUser.isPending}
                                      onClick={() => {
                                        deleteUser.mutate({ userId: u.id });
                                        setConfirmDelete(null);
                                      }}
                                    >
                                      確認
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setConfirmDelete(null)}
                                    >
                                      取消
                                    </Button>
                                  </div>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => setConfirmDelete(u.id)}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
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
    </div>
  );
}
