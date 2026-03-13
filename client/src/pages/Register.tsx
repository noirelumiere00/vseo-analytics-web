import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import PublicLayout from "@/components/PublicLayout";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Link } from "wouter";

export default function Register() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.includes("@")) {
      setError("有効なメールアドレスを入力してください");
      return;
    }
    if (!name.trim()) {
      setError("名前を入力してください");
      return;
    }
    if (password.length < 8) {
      setError("パスワードは8文字以上にしてください");
      return;
    }
    if (password !== passwordConfirm) {
      setError("パスワードが一致しません");
      return;
    }
    if (!tosAccepted) {
      setError("利用規約に同意してください");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, name: name.trim(), password, tosAccepted }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "登録に失敗しました");
        return;
      }

      window.location.href = "/";
    } catch {
      setError("サーバーに接続できません");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleRegister = () => {
    if (!tosAccepted) {
      setError("利用規約に同意してください");
      return;
    }
    window.location.href = `/api/auth/google?tosAccepted=true`;
  };

  return (
    <PublicLayout>
      <Card className="w-full max-w-sm border-0 shadow-none lg:border lg:shadow-sm">
        <CardHeader className="text-center space-y-2">
          <div className="lg:hidden mb-4 flex flex-col items-center gap-3">
            <img src="/favicon.png" alt="VSEO Analytics" className="h-14 w-14 object-contain logo-blend" />
            <h1 className="text-2xl font-bold">
              <span className="gradient-text">VSEO Analytics</span>
            </h1>
          </div>
          <CardTitle className="text-xl font-semibold">アカウント作成</CardTitle>
          <p className="text-sm text-muted-foreground">
            無料でアカウントを作成
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">メールアドレス</Label>
              <Input
                id="email"
                type="email"
                placeholder="例: user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">名前</Label>
              <Input
                id="name"
                type="text"
                placeholder="例: 田中太郎"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">パスワード</Label>
              <Input
                id="password"
                type="password"
                placeholder="8文字以上"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="passwordConfirm">パスワード（確認）</Label>
              <Input
                id="passwordConfirm"
                type="password"
                placeholder="もう一度入力"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="tos"
                checked={tosAccepted}
                onCheckedChange={(v) => setTosAccepted(v === true)}
                disabled={loading}
              />
              <Label htmlFor="tos" className="text-xs text-muted-foreground leading-snug cursor-pointer">
                <Link href="/terms" className="text-primary hover:underline">利用規約</Link>
                と
                <Link href="/privacy" className="text-primary hover:underline">プライバシーポリシー</Link>
                に同意します
              </Label>
            </div>
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
            <Button type="submit" className="w-full gradient-primary text-white" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  登録中...
                </>
              ) : (
                "アカウントを作成"
              )}
            </Button>
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">または</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleGoogleRegister}
              disabled={loading}
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Googleで登録
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            既にアカウントをお持ちの方は{" "}
            <Link href="/login" className="text-primary hover:underline font-medium">
              サインイン
            </Link>
          </p>
        </CardContent>
      </Card>
    </PublicLayout>
  );
}
