import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PublicLayout from "@/components/PublicLayout";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useState } from "react";
import { Loader2, ArrowRight } from "lucide-react";
import { Link } from "wouter";

export default function Login() {
  usePageTitle("ログイン");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("メールアドレスを入力してください");
      return;
    }
    if (!password) {
      setError("パスワードを入力してください");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: email.trim(),
          password,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "ログインに失敗しました");
        return;
      }

      window.location.href = "/dashboard";
    } catch {
      setError("サーバーに接続できません");
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicLayout>
      {/* Mobile branding */}
      <div className="lg:hidden mb-8 flex flex-col items-center gap-3">
        <img src="/favicon.png" alt="VSEO Analytics" className="h-14 w-14 object-contain logo-blend" />
        <h1
          className="text-2xl tracking-tight"
          style={{ fontFamily: '"Space Mono", "JetBrains Mono", monospace', fontWeight: 700 }}
        >
          <span className="text-primary">V</span>SEO Analytics
        </h1>
      </div>

      <div className="space-y-6">
        <div className="space-y-1.5">
          <h2
            className="text-2xl tracking-tight"
            style={{ fontFamily: '"Space Mono", "JetBrains Mono", monospace', fontWeight: 700 }}
          >
            ログイン
          </h2>
          <p className="text-sm text-muted-foreground">
            登録済みのアカウントでログイン
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-xs font-medium tracking-wide uppercase text-muted-foreground">
              メールアドレス
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              autoFocus
              aria-describedby="form-error"
              className="h-11 bg-secondary/50 border-border/60 focus:bg-background transition-colors duration-200"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="text-xs font-medium tracking-wide uppercase text-muted-foreground">
                パスワード
              </Label>
              <Link href="/forgot-password" className="text-xs text-primary/80 hover:text-primary transition-colors">
                パスワードを忘れた方
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              aria-describedby="form-error"
              className="h-11 bg-secondary/50 border-border/60 focus:bg-background transition-colors duration-200"
            />
          </div>

          {error && (
            <div
              id="form-error"
              className="px-4 py-3 rounded-md border text-sm animate-in fade-in slide-in-from-top-1 duration-200"
              style={{
                background: "rgba(215, 25, 33, 0.06)",
                borderColor: "rgba(215, 25, 33, 0.15)",
                color: "var(--destructive)",
              }}
              role="alert"
            >
              {error}
            </div>
          )}

          <Button
            type="submit"
            className="w-full h-11 bg-primary text-primary-foreground font-medium group transition-all duration-200 hover:shadow-md"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ログイン中...
              </>
            ) : (
              <>
                ログイン
                <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </>
            )}
          </Button>
        </form>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border/60" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-background px-3 text-xs text-muted-foreground/60">または</span>
          </div>
        </div>

        {/* Google */}
        <Button
          type="button"
          variant="outline"
          className="w-full h-11 border-border/60 hover:bg-secondary/60 transition-all duration-200"
          onClick={() => { window.location.href = "/api/auth/google?tosAccepted=true"; }}
          disabled={loading}
        >
          <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          Googleでログイン
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          アカウントをお持ちでない方は{" "}
          <Link href="/register" className="text-primary hover:text-primary/80 font-medium transition-colors">
            アカウント作成
          </Link>
        </p>
      </div>
    </PublicLayout>
  );
}
