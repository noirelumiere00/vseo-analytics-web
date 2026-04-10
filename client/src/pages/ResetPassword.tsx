import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PublicLayout from "@/components/PublicLayout";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useLocation, Link } from "wouter";
import { toast } from "sonner";

export default function ResetPassword() {
  usePageTitle("パスワード再設定");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [, setLocation] = useLocation();

  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("パスワードは8文字以上にしてください");
      return;
    }
    if (password !== passwordConfirm) {
      setError("パスワードが一致しません");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "パスワードリセットに失敗しました");
        return;
      }

      toast.success("パスワードを更新しました");
      setLocation("/login");
    } catch {
      setError("サーバーに接続できません");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <PublicLayout>
        <div className="space-y-4 text-center py-8">
          <p className="text-destructive text-sm">無効なリセットリンクです</p>
          <Link href="/login" className="text-primary hover:text-primary/80 text-sm transition-colors">
            ログインに戻る
          </Link>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div className="lg:hidden mb-8 flex flex-col items-center gap-3">
        <img src="/favicon.png" alt="VSEO Analytics" className="h-14 w-14 object-contain logo-blend" />
      </div>

      <div className="space-y-6">
        <div className="space-y-1.5">
          <h2
            className="text-2xl tracking-tight"
            style={{ fontFamily: '"Space Mono", "JetBrains Mono", monospace', fontWeight: 700 }}
          >
            新しいパスワード設定
          </h2>
          <p className="text-sm text-muted-foreground">
            新しいパスワードを入力してください
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password" className="text-xs font-medium tracking-wide uppercase text-muted-foreground">
              新しいパスワード
            </Label>
            <Input
              id="password"
              type="password"
              placeholder="8文字以上"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoFocus
              className="h-11 bg-secondary/50 border-border/60 focus:bg-background transition-colors duration-200"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="passwordConfirm" className="text-xs font-medium tracking-wide uppercase text-muted-foreground">
              パスワード（確認）
            </Label>
            <Input
              id="passwordConfirm"
              type="password"
              placeholder="再入力"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              disabled={loading}
              className="h-11 bg-secondary/50 border-border/60 focus:bg-background transition-colors duration-200"
            />
          </div>
          {error && (
            <div
              className="px-4 py-3 rounded-md border text-sm animate-in fade-in slide-in-from-top-1 duration-200"
              style={{
                background: "rgba(215, 25, 33, 0.06)",
                borderColor: "rgba(215, 25, 33, 0.15)",
                color: "var(--destructive)",
              }}
            >
              {error}
            </div>
          )}
          <Button
            type="submit"
            className="w-full h-11 bg-primary text-primary-foreground font-medium transition-all duration-200 hover:shadow-md"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                更新中...
              </>
            ) : (
              "パスワードを更新"
            )}
          </Button>
        </form>
      </div>
    </PublicLayout>
  );
}
